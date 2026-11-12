import assert from "node:assert/strict";
import { execFileSync, spawn as nativeSpawn } from "node:child_process";
import {
  symlinkSync,
  copyFileSync,
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { checkEnvironment, installHook, runQuality as runQualityImpl } from "./local-quality.mjs";

import { processTable, rememberDescendants, signalOwned } from "./owned-process.mjs";
function spawn(...args) {
  const child = nativeSpawn(...args),
    known = new Map();
  rememberDescendants(processTable(), child.pid, known);
  child.kill = (signal) => {
    rememberDescendants(processTable(), child.pid, known);
    signalOwned(known, signal);
    return true;
  };
  return child;
}

const runQuality = (root, options = {}) =>
  runQualityImpl(root, { packageVersion: () => "10.16.1", ...options });

const git = (root, ...args) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
function fixturePath(root) {
  const bin = resolve(root, "fixture-bin");
  mkdirSync(bin);
  writeFileSync(resolve(bin, "pnpm"), "#!/bin/sh\nprintf '10.16.1\\n'\n");
  chmodSync(resolve(bin, "pnpm"), 0o755);
  return `${bin}:${process.env.PATH}`;
}

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), "sq-quality-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q");
  mkdirSync(resolve(root, ".github/scripts"), { recursive: true });
  copyFileSync(
    new URL("./owned-process.mjs", import.meta.url),
    resolve(root, ".github/scripts/owned-process.mjs"),
  );
  git(root, "config", "user.name", "Quality Fixture");
  git(root, "config", "user.email", "fixture@example.invalid");
  for (const file of [".github/scripts/local-quality.mjs", ".githooks/pre-commit"]) {
    mkdirSync(dirname(resolve(root, file)), { recursive: true });
    copyFileSync(resolve(file), resolve(root, file));
  }
  writeFileSync(resolve(root, ".nvmrc"), process.versions.node);
  writeFileSync(resolve(root, "package.json"), JSON.stringify({ packageManager: "pnpm@10.16.1" }));
  writeFileSync(
    resolve(root, ".local-quality.json"),
    JSON.stringify({
      commands: [
        ["fixture", "check"],
        ["fixture", "test"],
      ],
    }),
  );
  writeFileSync(resolve(root, "file.txt"), "original");
  git(root, "add", ".");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
  return root;
}

test("checks staged bytes without stashing or copying unstaged/untracked files", async (t) => {
  const root = fixture(t);
  writeFileSync(resolve(root, "file.txt"), "staged");
  git(root, "add", "file.txt");
  writeFileSync(resolve(root, "file.txt"), "unstaged");
  writeFileSync(resolve(root, "private-untracked.txt"), "do not copy");
  const before = git(root, "status", "--porcelain");
  let calls = 0;
  const receipt = await runQuality(root, {
    run: (_bin, _args, options) => {
      calls++;
      assert.equal(readFileSync(resolve(options.cwd, "file.txt"), "utf8"), "staged");
      assert.equal(existsSync(resolve(options.cwd, "private-untracked.txt")), false);
      assert.equal(options.env.GIT_INDEX_FILE, undefined);
      return { status: 0 };
    },
  });
  assert.equal(calls, 2);
  assert.equal(receipt.status, "passed");
  assert.equal(receipt.reuse, false);
  assert.equal(git(root, "status", "--porcelain"), before);
  assert.equal(readFileSync(resolve(root, "file.txt"), "utf8"), "unstaged");
  assert.equal(git(root, "worktree", "list", "--porcelain").split("worktree ").length, 2);
});

test("failed commands block and leave a failed receipt, not a reusable success", async (t) => {
  const root = fixture(t);
  await assert.rejects(
    () => runQuality(root, { run: () => ({ status: 7 }) }),
    /Failed: fixture check/,
  );
  assert.equal(
    JSON.parse(readFileSync(resolve(root, ".git/local-quality/last.json"))).status,
    "failed",
  );
});

test("spawn failure and cancellation fail closed", async (t) => {
  const root = fixture(t);
  for (const result of [
    { status: null, error: new Error("missing binary") },
    { status: null, signal: "SIGTERM" },
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- Exercise failure cleanup serially in one fixture.
    await assert.rejects(() => runQuality(root, { run: () => result }), /Failed: fixture check/);
  }
});

test("index edits during validation and edits made by checks invalidate success", async (t) => {
  const root = fixture(t);
  await assert.rejects(
    () =>
      runQuality(root, {
        run: () => {
          writeFileSync(resolve(root, "file.txt"), "new staged content");
          git(root, "add", "file.txt");
          return { status: 0 };
        },
      }),
    /changed during checks/,
  );
  await assert.rejects(() =>
    runQuality(root, {
      run: (_bin, _args, options) => {
        writeFileSync(resolve(options.cwd, "file.txt"), "modified by check");
        return { status: 0 };
      },
    }),
  );
});

test("unstaged runner changes cannot substitute for the staged gate", async (t) => {
  const root = fixture(t);
  writeFileSync(resolve(root, ".github/scripts/local-quality.mjs"), "process.exit(0);");
  await assert.rejects(() => runQuality(root), /differs from the staged gate/);
});

test("installer refuses to overwrite an existing hook manager", async (t) => {
  const root = fixture(t);
  git(root, "config", "core.hooksPath", "existing-hooks");
  assert.throws(() => installHook(root), /Existing core.hooksPath/);
  assert.equal(git(root, "config", "core.hooksPath"), "existing-hooks");
  git(root, "config", "--unset", "core.hooksPath");
  installHook(root);
  installHook(root); // Reinstall/update must preserve the managed loader.
  assert.match(git(root, "config", "core.hooksPath"), /local-quality\/hooks$/);
});

test("check environment excludes cloud credentials and inherited git indices", () => {
  const env = checkEnvironment({
    PATH: "/bin",
    HOME: "/tmp",
    GIT_INDEX_FILE: "/private/index",
    FIREBASE_SERVICE_ACCOUNT_JSON: "secret",
    AWS_SECRET_ACCESS_KEY: "secret",
    NODE_OPTIONS: "--require=untrusted",
  });
  assert.deepEqual(env, { PATH: "/bin", HOME: "/tmp", CI: "true", TURBO_TELEMETRY_DISABLED: "1" });
});

test("exports raw bytes even when Git filters would turn staged failure into success", async (t) => {
  const root = fixture(t);
  writeFileSync(resolve(root, ".gitattributes"), "file.txt filter=fixture\n");
  git(root, "config", "filter.fixture.smudge", "sed s/FAIL/PASS/g");
  git(root, "config", "filter.fixture.clean", "sed s/PASS/FAIL/g");
  writeFileSync(resolve(root, "file.txt"), "FAIL");
  git(root, "add", ".");
  const receipt = await runQuality(root, {
    run: (_bin, _args, options) => {
      assert.equal(readFileSync(resolve(options.cwd, "file.txt"), "utf8"), "FAIL");
      return { status: 0 };
    },
  });
  assert.equal(receipt.status, "passed");
});

test("rejects tracked symlinks instead of letting checks follow external files", async (t) => {
  const root = fixture(t);
  symlinkSync("/tmp/external-unstaged", resolve(root, "link"));
  git(root, "add", "link");
  await assert.rejects(
    () => runQuality(root, { run: () => assert.fail("must not execute checks") }),
    /Unsupported staged link/,
  );
});

test("hook installation leaves another linked worktree's effective hooks unchanged", async (t) => {
  const root = fixture(t);
  const other = resolve(root, "..", `other-${root.split("/").at(-1)}`);
  git(root, "worktree", "add", "--detach", other, "HEAD");
  t.after(() => rmSync(other, { recursive: true, force: true }));
  const before = git(other, "config", "--default", "", "--get", "core.hooksPath");
  installHook(root);
  assert.equal(git(other, "config", "--default", "", "--get", "core.hooksPath"), before);
  assert.match(git(root, "config", "--get", "core.hooksPath"), /local-quality\/hooks$/);
});

test("SIGTERM blocks, terminates the running check and cleans up its worktree", async (t) => {
  const root = fixture(t);
  writeFileSync(
    resolve(root, ".local-quality.json"),
    JSON.stringify({ commands: [[process.execPath, "-e", "setInterval(()=>{},1000)"]] }),
  );
  git(root, "add", ".local-quality.json");
  const path = fixturePath(root);
  const child = spawn(process.execPath, [".github/scripts/local-quality.mjs"], {
    cwd: root,
    env: { ...process.env, PATH: path },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10000);
  let sent = false;
  child.stdout.on("data", (data) => {
    if (!sent && data.toString().includes("Local quality:")) {
      sent = true;
      child.kill("SIGTERM");
    }
  });
  const exit = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolveExit({ code, signal }));
  });
  clearTimeout(timeout);
  assert.equal(sent, true);
  assert.equal(exit.code, 1);
  const receipt = JSON.parse(readFileSync(resolve(root, ".git/local-quality/last.json")));
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.interruptedBy, "SIGTERM");
  assert.equal(git(root, "worktree", "list", "--porcelain").split("worktree ").length, 2);
});

test("real commit -a and path-only commits validate Git's temporary index", (t) => {
  const root = fixture(t);
  const path = fixturePath(root);
  for (const [args, expected] of [
    [["-a"], "all"],
    [["--", "file.txt"], "path-only"],
  ]) {
    writeFileSync(
      resolve(root, ".local-quality.json"),
      JSON.stringify({
        commands: [
          [
            process.execPath,
            "-e",
            `if(require('fs').readFileSync('file.txt','utf8')!==${JSON.stringify(expected)})process.exit(2)`,
          ],
        ],
      }),
    );
    git(root, "add", ".local-quality.json");
    // Prepare a distinct fixture policy before installing its real hook.
    git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "policy");
    installHook(root);
    writeFileSync(resolve(root, "file.txt"), expected);
    execFileSync(
      "git",
      ["-C", root, "-c", "commit.gpgsign=false", "commit", "-m", "tested", ...args],
      { env: { ...process.env, PATH: path }, stdio: "pipe" },
    );
    assert.equal(git(root, "show", "HEAD:file.txt"), expected);
    assert.equal(
      JSON.parse(readFileSync(resolve(root, ".git/local-quality/last.json"))).status,
      "passed",
    );
    // Only remove the fixture's own configuration between independent scenarios.
    git(root, "config", "--worktree", "--unset", "core.hooksPath");
  }
});

test("cancellation kills a TERM-ignoring descendant after its leader exits", async (t) => {
  const root = fixture(t);
  const pidfile = resolve(root, "descendant.pid");
  const descendant = `process.on('SIGTERM',()=>{});require('fs').writeFileSync(${JSON.stringify(pidfile)},String(process.pid));setInterval(()=>{},1000)`;
  const leader = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});setInterval(()=>{},1000)`;
  writeFileSync(
    resolve(root, ".local-quality.json"),
    JSON.stringify({ commands: [[process.execPath, "-e", leader]] }),
  );
  git(root, "add", ".local-quality.json");
  const child = spawn(process.execPath, [".github/scripts/local-quality.mjs"], {
    cwd: root,
    env: { ...process.env, PATH: fixturePath(root) },
    stdio: "ignore",
  });
  const exit = new Promise((done, reject) => {
    child.once("error", reject);
    child.once("close", done);
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10000);
  await new Promise((done, reject) => {
    const poll = setInterval(() => {
      if (existsSync(pidfile)) {
        clearInterval(poll);
        done();
      }
    }, 20);
    setTimeout(() => {
      clearInterval(poll);
      reject(new Error("descendant did not start"));
    }, 5000).unref();
  });
  const pid = Number(readFileSync(pidfile, "utf8"));
  const known = new Map();
  rememberDescendants(processTable(), pid, known);
  t.after(() => signalOwned(known, "SIGKILL"));
  child.kill("SIGTERM");
  assert.equal(await exit, 1);
  clearTimeout(timeout);
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  assert.equal(git(root, "worktree", "list", "--porcelain").split("worktree ").length, 2);
});

test("installer preserves an existing default pre-commit hook", (t) => {
  const root = fixture(t);
  const hook = resolve(root, ".git/hooks/pre-commit");
  writeFileSync(hook, "#!/bin/sh\nexit 7\n");
  chmodSync(hook, 0o755);
  assert.throws(() => installHook(root), /Existing default Git hooks/);
  assert.equal(git(root, "config", "--default", "", "--get", "core.hooksPath"), "");
  assert.equal(
    git(root, "config", "--default", "false", "--get", "extensions.worktreeConfig"),
    "false",
  );
  assert.equal(readFileSync(hook, "utf8"), "#!/bin/sh\nexit 7\n");
});

test("installer refuses to disable other active default Git hooks", (t) => {
  const root = fixture(t);
  const hook = resolve(root, ".git/hooks/commit-msg");
  writeFileSync(hook, "#!/bin/sh\nexit 7\n");
  chmodSync(hook, 0o755);
  assert.throws(() => installHook(root), /Existing default Git hooks \(commit-msg\)/);
  assert.equal(git(root, "config", "--default", "", "--get", "core.hooksPath"), "");
  assert.equal(
    git(root, "config", "--default", "false", "--get", "extensions.worktreeConfig"),
    "false",
  );
  assert.equal(readFileSync(hook, "utf8"), "#!/bin/sh\nexit 7\n");
});

test("preflight failure replaces prior success evidence", async (t) => {
  const root = fixture(t);
  await runQuality(root, { run: async () => ({ status: 0 }) });
  const path = resolve(root, ".git/local-quality/last.json"),
    before = JSON.parse(readFileSync(path, "utf8"));
  await assert.rejects(runQuality(root, { packageVersion: () => "0.0.0" }), /Use pnpm/);
  const after = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(after.status, "failed");
  assert.equal(after.phase, "preflight");
  assert.equal(after.tree, null);
  assert.notEqual(after.attemptId, before.attemptId);
});
