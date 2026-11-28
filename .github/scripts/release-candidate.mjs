import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  copyFileSync,
  openSync,
  closeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { checkEnvironment } from "./local-quality.mjs";
import { runOwned } from "./owned-process.mjs";

export const digest = (bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
export function assertIntegrity(bytes, expected) {
  assert.match(expected, /^sha512-[A-Za-z0-9+/]{86}==$/);
  assert.equal(digest(bytes), expected, "Tarball differs from the verified release input");
}

// A failed candidate must still exercise restoration, then fail the release gate.
export async function verifyRecovery({ install, inspect, assertData }) {
  await install("previous");
  await inspect("previous");
  await assertData();
  let failure;
  try {
    await install("candidate");
    await inspect("candidate");
    await assertData();
  } catch (error) {
    failure = error;
  }
  await install("previous");
  await inspect("previous");
  await assertData();
  if (failure) throw failure;
}

const execute = (command, args, cwd, extraEnv) =>
  execFileSync(command, args, {
    cwd,
    env: { ...checkEnvironment(process.env), ...extraEnv },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

async function inspectMcp(root) {
  const probe = createServer();
  await new Promise((done, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", done);
  });
  const port = probe.address().port;
  await new Promise((done, reject) => probe.close((error) => (error ? reject(error) : done())));
  const logfile = join(root, "mcp.log"),
    fd = openSync(logfile, "w");
  let handle, result, childError;
  const running = runOwned(
    process.execPath,
    ["node_modules/@gear-null/svelte-lens/bin/mcp.js", "--port", String(port)],
    { cwd: root, env: checkEnvironment(process.env), stdio: ["ignore", fd, fd] },
    (value) => {
      handle = value;
    },
  );
  running.then(
    (value) => {
      result = value;
    },
    (error) => {
      childError = error;
    },
  );
  let interrupted = false;
  const cancel = () => {
    interrupted = true;
    void handle?.cancel();
  };
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    const deadline = Date.now() + 15000;
    while (!readFileSync(logfile, "utf8").includes(`127.0.0.1:${port}/mcp`)) {
      assert.ifError(childError);
      assert.ok(!result, `Installed MCP exited: ${readFileSync(logfile, "utf8")}`);
      assert.ok(Date.now() < deadline, "Installed MCP startup timed out");
      await delay(50);
    }
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "ok");
  } finally {
    await handle?.cancel();
    const stopped = await running;
    closeSync(fd);
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    assert.ok(!stopped.cleanupUncertain && !stopped.error, "Installed MCP cleanup failed");
    assert.equal(interrupted, false, "Interrupted while verifying the installed MCP");
  }
}

export async function verifyCandidate(root = process.cwd()) {
  const packageRoot = resolve(root, "packages/svelte-lens");
  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const recovery = JSON.parse(readFileSync(join(root, ".release-recovery.json"), "utf8"));
  assert.match(recovery.version, /^\d+\.\d+\.\d+$/);
  assert.match(recovery.svelte, /^\d+\.\d+\.\d+$/);
  const directory = mkdtempSync(join(tmpdir(), "lens-release-candidate-"));
  const output = resolve(root, ".local/release-candidate");
  const receipt = join(output, "verification.json");
  try {
    mkdirSync(output, { recursive: true });
    rmSync(receipt, { force: true });
    const npmrc = join(directory, "npmrc");
    writeFileSync(npmrc, "");
    const npm = (args, cwd) => execute("npm", args, cwd, { npm_config_userconfig: npmrc });
    const candidateDirectory = join(directory, "candidate");
    const previousDirectory = join(directory, "previous");
    mkdirSync(candidateDirectory);
    mkdirSync(previousDirectory);
    const candidatePack = JSON.parse(
      npm(
        ["pack", "--ignore-scripts", "--json", "--pack-destination", candidateDirectory],
        packageRoot,
      ),
    )[0];
    const candidate = join(candidateDirectory, candidatePack.filename);
    assertIntegrity(readFileSync(candidate), candidatePack.integrity);
    const previousPack = JSON.parse(
      npm(
        [
          "pack",
          `@gear-null/svelte-lens@${recovery.version}`,
          "--ignore-scripts",
          "--json",
          "--pack-destination",
          previousDirectory,
        ],
        directory,
      ),
    )[0];
    const previous = join(previousDirectory, previousPack.filename);
    assert.equal(previousPack.version, recovery.version);
    assertIntegrity(readFileSync(previous), recovery.integrity);
    const consumer = join(directory, "consumer");
    mkdirSync(consumer);
    writeFileSync(
      join(consumer, "package.json"),
      JSON.stringify({ name: "lens-release-consumer", private: true, type: "module" }),
    );
    writeFileSync(join(consumer, "user-data.txt"), "synthetic user state\n");
    mkdirSync(join(consumer, "src"));
    writeFileSync(join(consumer, "src/+page.svelte"), "<h1>Keep this project</h1>\n");
    const snapshots = ["user-data.txt", "src/+page.svelte"].map((path) => [
      path,
      readFileSync(join(consumer, path)),
    ]);
    const inspected = [];
    await verifyRecovery({
      install: (phase) =>
        npm(
          [
            "install",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--save-exact",
            phase === "candidate" ? candidate : previous,
            `svelte@${recovery.svelte}`,
          ],
          consumer,
        ),
      inspect: async (phase) => {
        const installed = JSON.parse(
          readFileSync(join(consumer, "node_modules/@gear-null/svelte-lens/package.json"), "utf8"),
        );
        assert.equal(installed.version, phase === "candidate" ? pkg.version : recovery.version);
        const lock = readFileSync(join(consumer, "package-lock.json"));
        const installedArtifact = JSON.parse(lock).packages["node_modules/@gear-null/svelte-lens"];
        const expectedIntegrity =
          phase === "candidate" ? candidatePack.integrity : recovery.integrity;
        assert.equal(installedArtifact.integrity, expectedIntegrity);
        execute(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            'import * as api from "@gear-null/svelte-lens"; for (const name of ["init","copyPlugin","openPlugin","getSource","getStack","getStackContext","getElementContext","isLensHost","getGlobalApi","registerPlugin","unregisterPlugin"]) if (!(name in api)) throw Error("Missing export: " + name);',
          ],
          consumer,
        );
        assert.equal(
          execute(
            process.execPath,
            ["node_modules/@gear-null/svelte-lens/bin/cli.js", "--version"],
            consumer,
          ).trim(),
          installed.version,
        );
        assert.ok(
          execute(
            process.execPath,
            ["node_modules/@gear-null/svelte-lens/bin/cli.js", "init", "--help"],
            consumer,
          ).includes("--skip-install"),
        );
        await inspectMcp(consumer);
        inspected.push({
          phase,
          version: installed.version,
          integrity: installedArtifact.integrity,
          lockSha256: createHash("sha256").update(lock).digest("hex"),
        });
      },
      assertData: () => {
        for (const [path, bytes] of snapshots)
          assert.deepEqual(
            readFileSync(join(consumer, path)),
            bytes,
            "Install/recovery changed consumer data",
          );
      },
    });
    copyFileSync(candidate, join(output, "candidate.tgz"));
    const record = {
      version: pkg.version,
      integrity: candidatePack.integrity,
      sourceCommit: execute("git", ["rev-parse", "HEAD"], root).trim(),
      recoveryVersion: recovery.version,
      checks: inspected,
    };
    writeFileSync(receipt, JSON.stringify(record, null, 2) + "\n");
    console.log(JSON.stringify(record));
    return record;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function assertVerified(root = process.cwd()) {
  const record = JSON.parse(
    readFileSync(resolve(root, ".local/release-candidate/verification.json"), "utf8"),
  );
  assertIntegrity(
    readFileSync(resolve(root, ".local/release-candidate/candidate.tgz")),
    record.integrity,
  );
  assert.equal(record.sourceCommit, execute("git", ["rev-parse", "HEAD"], root).trim());
  const manifest = JSON.parse(
    readFileSync(resolve(root, "packages/svelte-lens/package.json"), "utf8"),
  );
  assert.equal(record.version, manifest.version);
  assert.equal(
    record.checks.find(({ phase }) => phase === "candidate")?.integrity,
    record.integrity,
  );
  assert.deepEqual(
    record.checks.map(({ phase }) => phase),
    ["previous", "candidate", "previous"],
  );
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--assert-verified") assertVerified();
  else {
    assert.equal(process.argv.length, 2, "Unexpected candidate verification argument");
    await verifyCandidate();
  }
}
