import assert from "node:assert/strict";
import { test } from "node:test";
import { delimiter, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  assertReport,
  dockerArguments,
  scannerArguments,
  scannerEnvironment,
  scannerImage,
  scannerVersion,
  gitMetadataDirectories,
} from "./ci-semgrep.mjs";

test("an explicit local scanner uses sibling tools and clears inherited credentials", () => {
  const base = { PATH: "/global/bin", SEMGREP_APP_TOKEN: "inherited-token" };
  const env = scannerEnvironment("/isolated/bin/semgrep", base);
  assert.equal(env.PATH, `/isolated/bin${delimiter}/global/bin`);
  assert.equal(env.SEMGREP_APP_TOKEN, "");
  assert.equal(env.SEMGREP_SEND_METRICS, "off");
  assert.equal(env.SEMGREP_ENABLE_VERSION_CHECK, "0");
  assert.equal(scannerEnvironment("semgrep", base).PATH, base.PATH);
  assert.equal(base.SEMGREP_APP_TOKEN, "inherited-token");
});

test("scanner uses local rules, disables telemetry, and fails on findings/errors", () => {
  const args = scannerArguments("scan", "/reports/semgrep.json");
  for (const option of [
    "--metrics=off",
    "--disable-version-check",
    "--no-trace",
    "--oss-only",
    "--error",
    "--strict",
    "--disable-nosem",
  ])
    assert.ok(args.includes(option), option);
  assert.equal(args[args.indexOf("--config") + 1], ".semgrep/rules");
  assert.deepEqual(args.slice(-3), ["apps", "packages", ".github/scripts"]);
  assert.throws(() => scannerArguments("unknown", "/reports/out.json"));
  assert.throws(() => scannerArguments("scan"));
});

test("container cannot send code or telemetry and cannot modify the source mount", () => {
  const args = dockerArguments("/workspace", "/workspace/test-results/semgrep", "scan");
  assert.match(scannerImage, /^semgrep\/semgrep:1\.180\.0@sha256:[a-f0-9]{64}$/);
  assert.ok(args.includes("--network=none"));
  assert.ok(args.includes("--pull=never"));
  assert.ok(args.includes("type=bind,src=/workspace,dst=/src,readonly"));
  assert.ok(args.includes("SEMGREP_APP_TOKEN="));
  assert.ok(args.includes(scannerImage));
  assert.ok(scannerArguments("test").includes("--test"));
});

test("gate rejects findings, scan errors, missing coverage and scanner-version drift", () => {
  const clean = {
    version: scannerVersion,
    results: [],
    errors: [],
    paths: { scanned: ["apps/web/src/hooks.server.ts"] },
  };
  assert.doesNotThrow(() => assertReport(clean));
  for (const bad of [
    { ...clean, results: [{ check_id: "domaine-no-dynamic-eval" }] },
    { ...clean, errors: [{ type: "Timeout" }] },
    { ...clean, paths: { scanned: [] } },
    { ...clean, paths: undefined },
    { ...clean, results: undefined },
    { ...clean, errors: undefined },
    { ...clean, version: "0.0.0" },
  ])
    assert.throws(() => assertReport(bad));
});

test("linked snapshot exposes only readonly Git metadata", (t) => {
  const root = mkdtempSync(resolve(tmpdir(), "lens-scanner-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(resolve(root, "file"), "fixture");
  git("add", "file");
  git("-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
  assert.deepEqual(gitMetadataDirectories(root), []);
  const snapshot = resolve(root, "snapshot");
  git("worktree", "add", "--detach", snapshot, "HEAD");
  const metadata = gitMetadataDirectories(snapshot);
  assert.deepEqual(metadata, [git("rev-parse", "--path-format=absolute", "--git-common-dir")]);
  const args = dockerArguments(snapshot, resolve(root, "reports"), "scan", metadata);
  assert(args.includes(`type=bind,src=${metadata[0]},dst=${metadata[0]},readonly`));
});
