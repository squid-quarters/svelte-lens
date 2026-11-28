import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkEnvironment } from "./local-quality.mjs";

async function checkMcp(cwd, env, version) {
  const child = spawn(
    process.execPath,
    ["node_modules/@gear-null/svelte-lens/bin/mcp.js", "--stdio", "--port", "0"],
    {
      cwd,
      env,
      signal: AbortSignal.timeout(8000),
      killSignal: "SIGKILL",
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  let output = "";
  let childError;
  child.once("error", (error) => {
    childError = error;
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (text) => {
    output += text;
    if (output.includes("\n") && !child.stdin.writableEnded) child.stdin.end();
  });
  const closed = new Promise((done) => child.once("close", (...result) => done(result)));
  child.stdin.on("error", (error) => {
    childError = error;
    child.kill();
  });
  child.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "floor-smoke", version: "0.0.0" },
      },
    }) + "\n",
  );
  const result = await closed;
  assert.ifError(childError);
  assert.deepEqual(result, [0, null]);
  const message = JSON.parse(output.trim());
  assert.equal(message.id, 1);
  assert.deepEqual(message.result.serverInfo, { name: "svelte-lens-mcp", version });
}

const packageRoot = resolve("packages/svelte-lens");
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
assert.equal(
  manifest.engines.node,
  ">=" + process.versions.node,
  "Select the exact consumer floor.",
);
const scratch = mkdtempSync(join(tmpdir(), "lens-node-floor-"));
try {
  const env = { ...checkEnvironment(process.env), npm_config_userconfig: join(scratch, "npmrc") };
  writeFileSync(env.npm_config_userconfig, "");
  const run = (name, args, cwd) =>
    execFileSync(name, args, { cwd, env, encoding: "utf8", timeout: 120_000 });
  const [archive] = JSON.parse(
    run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", scratch], packageRoot),
  );
  const consumer = join(scratch, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), '{"name":"lens-floor-smoke","private":true}');
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--engine-strict",
      "--no-audit",
      "--no-fund",
      join(scratch, archive.filename),
      "svelte@5.56.3",
    ],
    consumer,
  );
  const version = run(
    process.execPath,
    ["node_modules/@gear-null/svelte-lens/bin/cli.js", "--version"],
    consumer,
  );
  assert.equal(version.trim(), manifest.version);
  run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import { init } from "@gear-null/svelte-lens"; if (typeof init !== "function") throw new Error("Missing init");',
    ],
    consumer,
  );
  await checkMcp(consumer, env, manifest.version);
  console.log(`Packed CLI, API and MCP passed on Node ${process.versions.node}.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
