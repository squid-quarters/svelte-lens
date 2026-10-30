import assert from "node:assert/strict";
import { test } from "node:test";
import { delimiter, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  assert.ok(args.includes("--pull=missing"));
  assert.ok(args.includes("type=bind,src=/workspace,dst=/src,readonly"));
  assert.ok(args.includes("SEMGREP_APP_TOKEN="));
  assert.ok(args.includes(scannerImage));
  assert.ok(scannerArguments("test").includes("--test"));
});

test("fresh image cache acquires the pinned digest once before offline rule tests and scan", (t) => {
  const root = mkdtempSync(resolve(tmpdir(), "lens-scanner-cold-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const docker = resolve(root, "docker");
  const state = resolve(root, "cached");
  const calls = resolve(root, "calls.jsonl");
  writeFileSync(
    docker,
    `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const image = ${JSON.stringify(scannerImage)};
const state = ${JSON.stringify(state)};
const policy = args.find(arg => arg.startsWith("--pull="));
const cold = !fs.existsSync(state);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({policy, cold, image: args[args.indexOf("semgrep") + 1]}) + "\\n");
if (!args.includes(image) || !args.includes("--network=none")) process.exit(2);
if (cold && policy === "--pull=never") process.exit(125);
if (cold && policy !== "--pull=missing") process.exit(3);
fs.writeFileSync(state, image);
if (!args.includes("--test")) {
  const mount = args.find(arg => arg.startsWith("type=bind,src=") && arg.endsWith(",dst=/reports"));
  const reports = mount.slice("type=bind,src=".length, -",dst=/reports".length);
  fs.writeFileSync(path.join(reports, "semgrep.json"), JSON.stringify({version: ${JSON.stringify(scannerVersion)}, results: [], errors: [], paths: {scanned: ["apps/fixture.ts"]}}));
}
`,
  );
  chmodSync(docker, 0o755);
  const env = { ...process.env, PATH: `${root}${delimiter}${process.env.PATH}` };
  const negative = spawnSync(
    docker,
    dockerArguments(root, resolve(root, "reports"), "test").map((arg) =>
      arg === "--pull=missing" ? "--pull=never" : arg,
    ),
    { env, encoding: "utf8" },
  );
  assert.equal(negative.status, 125, negative.stderr);
  const result = spawnSync(process.execPath, [resolve(".github/scripts/ci-semgrep.mjs")], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const recorded = readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(recorded, [
    { policy: "--pull=never", cold: true, image: scannerImage },
    { policy: "--pull=missing", cold: true, image: scannerImage },
    { policy: "--pull=missing", cold: false, image: scannerImage },
  ]);
  assert.equal(readFileSync(state, "utf8"), scannerImage);
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
