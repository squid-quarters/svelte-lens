import { execFileSync, spawn } from "node:child_process";

export function processTable() {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,stat=,lstart="], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return new Map(
    rows
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
        if (!match) throw new Error("Cannot verify process identities");
        return [
          Number(match[1]),
          {
            pid: Number(match[1]),
            parent: Number(match[2]),
            group: Number(match[3]),
            state: match[4],
            start: match[5],
          },
        ];
      }),
  );
}
export function rememberDescendants(table, root, known, ownedGroup) {
  // A dedicated session attributes orphans after a fast parent exit. Discovery only:
  // signals still target individually revalidated positive PIDs, never a group.
  const originalRoot = known.get(root),
    currentRoot = table.get(root);
  const groupSafe = !originalRoot || !currentRoot || originalRoot.start === currentRoot.start;
  if (ownedGroup && groupSafe)
    for (const row of table.values()) {
      if (row.group === ownedGroup && !known.has(row.pid))
        known.set(row.pid, { ...row, root: row.pid === root });
    }
  if (!known.has(root) && table.has(root)) known.set(root, { ...table.get(root), root: true });
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of table.values()) {
      const parent = known.get(row.parent);
      const current = table.get(row.parent);
      if (parent && current?.start === parent.start && !known.has(row.pid)) {
        known.set(row.pid, row);
        changed = true;
      }
    }
  }
}
export function signalOwned(known, signal, read = processTable, send = process.kill) {
  // Revalidate each positive PID immediately before delivery. Never signal by name/group.
  const depth = (identity) => {
    let value = identity,
      level = 0;
    const seen = new Set();
    while (known.has(value.parent) && !seen.has(value.parent)) {
      seen.add(value.parent);
      value = known.get(value.parent);
      level++;
    }
    return level;
  };
  const ordered = [...known].sort(
    (a, b) => Number(a[1].root ?? false) - Number(b[1].root ?? false) || depth(b[1]) - depth(a[1]),
  );
  for (const [pid, identity] of ordered) {
    const current = read().get(pid);
    if (
      current?.start === identity.start &&
      current.group === identity.group &&
      !current.state.startsWith("Z")
    ) {
      try {
        send(pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }
}
export function runOwned(bin, args, options, onChild, { read = processTable } = {}) {
  read(); // Refuse to start if descendant/identity inspection is unavailable.
  return new Promise((resolve) => {
    const child = spawn(bin, args, { ...options, detached: true });
    const known = new Map();
    let failure,
      stopping,
      monitor,
      settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearInterval(monitor);
      if (result.cleanupUncertain) child.unref();
      resolve({ ...result, owned: result.owned ?? [...known.values()] });
    };
    const uncertain = (error) => {
      failure = error;
      finish({
        status: null,
        error,
        cleanupUncertain: true,
        pid: child.pid,
        owned: [...known.values()],
      });
    };
    const observe = () => rememberDescendants(read(), child.pid, known, child.pid);
    const cancel = () => {
      if (!stopping)
        stopping = (async () => {
          observe();
          signalOwned(known, "SIGTERM", read);
          await new Promise((done) => setTimeout(done, 5000));
          observe();
          signalOwned(known, "SIGKILL", read);
          await new Promise((done) => setTimeout(done, 100));
          const live = read();
          if (
            [...known].some(
              ([pid, row]) =>
                live.get(pid)?.start === row.start && !live.get(pid).state.startsWith("Z"),
            )
          )
            throw new Error("Owned process cleanup remains unverified");
        })().catch((error) => {
          uncertain(error);
          throw error;
        });
      return stopping;
    };
    child.once("error", (error) => {
      failure = error;
    });
    child.once("close", async (status, signal) => {
      if (settled) return;
      try {
        observe();
        const table = read();
        const left = [...known].some(
          ([pid, row]) =>
            pid !== child.pid &&
            table.get(pid)?.start === row.start &&
            !table.get(pid).state.startsWith("Z"),
        );
        if (left && !stopping) {
          failure = new Error("Command left owned descendants");
          await cancel();
        }
        if (stopping) await stopping;
      } catch (error) {
        uncertain(error);
        return;
      }
      clearInterval(monitor);
      finish({ status, signal, error: failure });
    });
    if (child.pid) {
      try {
        observe();
      } catch (error) {
        failure = new Error("Owned process identity inspection failed; cleanup is uncertain", {
          cause: error,
        });
        uncertain(failure); // Retain evidence; never issue an unverified fallback signal.
      }
      if (!settled)
        monitor = setInterval(() => {
          try {
            observe();
          } catch (error) {
            failure = error;
            void cancel().catch((value) => {
              failure = value;
            });
          }
        }, 250);
      onChild({ pid: child.pid, cancel });
    }
  });
}
