import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
const require = createRequire(import.meta.url);
const cliRoot = dirname(require.resolve("@changesets/cli/package.json"));
const cli = join(cliRoot, "bin.js");

test("Changesets3 versions only the pending public patch and explicitly fails a no-op", (t) => {
  const root = mkdtempSync(join(tmpdir(), "lens-changesets-version-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, value) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  };
  write(
    "package.json",
    JSON.stringify({
      name: "fixture-root",
      private: true,
      packageManager: require("../../package.json").packageManager,
    }),
  );
  write("pnpm-workspace.yaml", "packages:\n  - packages/*\n");
  write(
    "packages/public/package.json",
    JSON.stringify({ name: "fixture-public", version: "1.0.8" }),
  );
  write(
    "packages/private/package.json",
    JSON.stringify({ name: "fixture-private", version: "0.0.0", private: true }),
  );
  write(
    ".changeset/config.json",
    JSON.stringify({
      changelog: false,
      commit: false,
      fixed: [],
      linked: [],
      access: "public",
      baseBranch: "main",
      updateInternalDependencies: "patch",
      ignore: ["fixture-private"],
    }),
  );
  const run = () =>
    spawnSync(process.execPath, [cli, "version"], { cwd: root, encoding: "utf8", timeout: 30000 });
  const noOp = run();
  assert.equal(noOp.status, 1, noOp.stdout + noOp.stderr);
  assert.equal(
    JSON.parse(readFileSync(join(root, "packages/public/package.json"))).version,
    "1.0.8",
  );
  write(
    ".changeset/bounded-patch.md",
    '---\n"fixture-public": patch\n---\n\nA bounded fixture patch.\n',
  );
  const changed = run();
  assert.equal(changed.status, 0, changed.stdout + changed.stderr);
  assert.equal(
    JSON.parse(readFileSync(join(root, "packages/public/package.json"))).version,
    "1.0.9",
  );
  assert.equal(
    JSON.parse(readFileSync(join(root, "packages/private/package.json"))).version,
    "0.0.0",
  );
  assert.equal(existsSync(join(root, ".changeset/bounded-patch.md")), false);
  const repeated = run();
  assert.equal(repeated.status, 1, repeated.stdout + repeated.stderr);
});
