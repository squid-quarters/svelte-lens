import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { runLatest, snapshotContext } from "./ci-latest.mjs";

const git = (root, ...args) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
function fixture(t) {
  const directory = mkdtempSync("/tmp/sq-local-quality-latest-test-");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = resolve(directory, "source"),
    snapshot = resolve(directory, "snapshot");
  mkdirSync(source);
  git(source, "init", "-q");
  git(source, "config", "user.name", "Latest Fixture");
  git(source, "config", "user.email", "fixture@example.invalid");
  for (const [file, contents] of [
    ["package.json", "{}"],
    ["pnpm-lock.yaml", "original lock\n"],
    [
      "apps/e2e-app/package.json",
      '{"name":"@svelte-lens/e2e-app","devDependencies":{"svelte":"5.57.2"}}\n',
    ],
    [
      "packages/svelte-lens/package.json",
      '{"name":"@gear-null/svelte-lens","devDependencies":{"svelte":"5.56.3"}}\n',
    ],
  ]) {
    mkdirSync(dirname(resolve(source, file)), { recursive: true });
    writeFileSync(resolve(source, file), contents);
  }
  git(source, "add", ".");
  git(source, "-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
  git(source, "worktree", "add", "--detach", snapshot, "HEAD");
  const tree = git(snapshot, "write-tree"),
    contextFile = resolve(directory, "context.json");
  writeFileSync(contextFile, JSON.stringify({ snapshot, tree }));
  for (const [folder, version] of [
    ["apps/e2e-app", "5.57.2"],
    ["packages/svelte-lens", "5.56.3"],
  ]) {
    const path = resolve(snapshot, folder, "node_modules/svelte/package.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ version }));
  }
  return { source, snapshot, contextFile, tree };
}

test("latest-peer checks refuse the caller's ordinary clone without touching files", (t) => {
  const f = fixture(t),
    before = readFileSync(resolve(f.source, "pnpm-lock.yaml"));
  assert.throws(() => snapshotContext(f.source, f.contextFile));
  assert.throws(() => snapshotContext(f.snapshot, undefined));
  assert.deepEqual(readFileSync(resolve(f.source, "pnpm-lock.yaml")), before);
});

for (const fail of [false, true])
  test(`latest peer restores staged manifest/lock bytes after ${fail ? "failure" : "success"}`, (t) => {
    const f = fixture(t),
      lock = resolve(f.snapshot, "pnpm-lock.yaml"),
      manifest = resolve(f.snapshot, "apps/e2e-app/package.json");
    const before = [readFileSync(lock), readFileSync(manifest)];
    let calls = 0;
    const execute = (args) => {
      calls++;
      if (args[0] === "npm") return "5.57.2\n";
      if (args.includes("add")) {
        writeFileSync(lock, "latest variant lock\n");
        writeFileSync(manifest, "{}");
      }
      if (args.includes("build") && fail) throw new Error("build failed");
      return "";
    };
    if (fail)
      assert.throws(
        () => runLatest(f.snapshot, { contextFile: f.contextFile, execute }),
        /build failed/,
      );
    else {
      const inputs = runLatest(f.snapshot, { contextFile: f.contextFile, execute });
      assert.equal(inputs.svelteLatest, "5.57.2");
      assert.equal(inputs.svelteFloor, "5.56.3");
      assert.match(inputs.latestLockSha256, /^[a-f0-9]{64}$/);
    }
    assert.ok(calls >= 3);
    assert.deepEqual(readFileSync(lock), before[0]);
    assert.deepEqual(readFileSync(manifest), before[1]);
    assert.equal(git(f.snapshot, "write-tree"), f.tree);
  });
