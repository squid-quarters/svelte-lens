import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve, join } from "node:path";
import { mkdtempSync, openSync, closeSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, constants } from "node:os";
import { stripVTControlCharacters } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { checkEnvironment } from "./local-quality.mjs";
import { runOwned, processTable } from "./owned-process.mjs";

for (const app of ["e2e-app", "e2e-floor"]) {
  const cwd = resolve("apps", app);
  const require = createRequire(resolve(cwd, "package.json"));
  const vite = resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js");
  const directory = mkdtempSync(join(tmpdir(), "lens-production-ssr-"));
  const log = join(directory, "preview.log"),
    fd = openSync(log, "w");
  let child, identity, identityError, interrupted, result, running, failure;
  const cancel = () => {
    interrupted = true;
    void child?.cancel().catch((error) => {
      identityError = error;
    });
  };
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  const live = () => {
    if (identityError) throw identityError;
    assert.ok(!interrupted, "Production preview interrupted");
    assert.ok(identity && child, "Production preview has no verified identity");
    const current = processTable().get(child.pid);
    assert.ok(
      current?.start === identity.start &&
        current.group === identity.group &&
        !current.state.startsWith("Z"),
      "Launched production preview is no longer live",
    );
  };
  try {
    running = runOwned(
      process.execPath,
      [vite, "preview", "--host", "127.0.0.1", "--port", "5176", "--strictPort"],
      { cwd, env: checkEnvironment(process.env), stdio: ["ignore", fd, fd] },
      (handle) => {
        child = handle;
        try {
          identity = processTable().get(handle.pid);
        } catch (error) {
          identityError = error;
        }
        if (interrupted)
          void handle.cancel().catch((error) => {
            identityError = error;
          });
      },
    );
    running.then(
      (value) => {
        result = value;
      },
      (error) => {
        identityError = error;
      },
    );
    const deadline = Date.now() + 30000;
    while (true) {
      live();
      if (result)
        throw Error(`Production preview exited before readiness: ${readFileSync(log, "utf8")}`);
      if (stripVTControlCharacters(readFileSync(log, "utf8")).includes("http://127.0.0.1:5176"))
        break;
      assert.ok(Date.now() < deadline, "Production preview startup timed out");
      await delay(100);
    }
    for (const route of ["metadata-inspect", "metadata-hydrated"]) {
      live();
      const response = await fetch(`http://127.0.0.1:5176/${route}`, {
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(response.status, 200);
      const html = await response.text();
      live();
      assert.ok(
        html.includes('data-testid="trailing-source"'),
        `${app}/${route} must retain production SSR`,
      );
      assert.ok(html.includes("Exact trailing source location"));
      console.log(`Verified production SSR: ${app}/${route}`);
    }
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (child) await child.cancel();
      if (running) result = await running;
      assert.ok(!result?.cleanupUncertain, "Production preview cleanup is uncertain");
      assert.ifError(result?.error);
      if (running)
        console.log(
          `Production preview owned shutdown: ${JSON.stringify({ status: result?.status, signal: result?.signal, cleanupUncertain: result?.cleanupUncertain ?? false })}`,
        );
      if (running)
        assert.ok(
          result?.status === 0 ||
            result?.signal === "SIGTERM" ||
            // Vite handles SIGTERM and exits with the conventional numeric status.
            (result?.signal === null && result?.status === 128 + constants.signals.SIGTERM),
          "Production preview exited unexpectedly",
        );
      rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      console.error(
        JSON.stringify({
          retainedPreviewLog: log,
          previewPid: child?.pid,
          owned: result?.owned ?? [],
        }),
      );
      failure = failure
        ? new AggregateError([failure, error], "Production SSR and cleanup failed")
        : error;
    } finally {
      closeSync(fd);
      process.off("SIGINT", cancel);
      process.off("SIGTERM", cancel);
    }
  }
  if (interrupted) failure ??= Error("Production SSR validation interrupted");
  if (failure) throw failure;
}
