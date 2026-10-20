import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const scannerVersion = "1.180.0";
// Official multi-platform image index, verified against Docker Hub on 2026-10-09.
export const scannerImage =
  "semgrep/semgrep:1.180.0@sha256:529ee8a277ec8adc5b534d7c74eea0a47e9de21d62852b6ba7ac6ba9566845c3";

export function scannerArguments(mode, output) {
  const args = [
    "scan",
    "--config",
    ".semgrep/rules",
    "--metrics=off",
    "--disable-version-check",
    "--no-trace",
    "--oss-only",
    "--no-rewrite-rule-ids",
  ];
  if (mode === "test") return [...args, "--test", ".semgrep/tests"];
  if (mode !== "scan" || !output) throw new Error("Invalid Semgrep mode or report path");
  return [
    ...args,
    "--error",
    "--strict",
    "--disable-nosem",
    "--json",
    "--output",
    output,
    "apps",
    "packages",
    ".github/scripts",
  ];
}

export function dockerArguments(root, reports, mode) {
  return [
    "run",
    "--rm",
    "--network=none",
    "--mount",
    `type=bind,src=${root},dst=/src,readonly`,
    "--mount",
    `type=bind,src=${reports},dst=/reports`,
    "--workdir",
    "/src",
    "--env",
    "SEMGREP_SEND_METRICS=off",
    "--env",
    "SEMGREP_ENABLE_VERSION_CHECK=0",
    "--env",
    "SEMGREP_APP_TOKEN=",
    "--entrypoint",
    "semgrep",
    scannerImage,
    ...scannerArguments(mode, "/reports/semgrep.json"),
  ];
}

export function assertReport(report) {
  if (report.version !== scannerVersion) throw new Error("Unexpected Semgrep version");
  if (!Array.isArray(report.results) || !Array.isArray(report.errors))
    throw new Error("Incomplete Semgrep report");
  if (report.errors.length) throw new Error(`Semgrep reported ${report.errors.length} scan errors`);
  if (report.results.length) throw new Error(`Semgrep reported ${report.results.length} findings`);
  if (!Array.isArray(report.paths?.scanned) || !report.paths.scanned.length)
    throw new Error("Semgrep did not scan any source files");
}

function run(command, args, env) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
}

export function scannerEnvironment(binary, base = process.env) {
  return {
    ...base,
    // Semgrep's launcher can invoke sibling tools by name. Keep an explicitly
    // selected virtual environment ahead of unrelated global installations.
    PATH: isAbsolute(binary) ? `${dirname(binary)}${delimiter}${base.PATH || ""}` : base.PATH,
    SEMGREP_SEND_METRICS: "off",
    SEMGREP_ENABLE_VERSION_CHECK: "0",
    SEMGREP_APP_TOKEN: "",
  };
}

export function main(local = false) {
  const root = process.cwd();
  const reports = resolve(root, "test-results/semgrep");
  mkdirSync(reports, { recursive: true });
  const binary = process.env.SEMGREP_BIN || "semgrep";
  const env = scannerEnvironment(local ? binary : "docker");
  if (local) {
    const version = spawnSync(binary, ["--version"], { encoding: "utf8", env });
    if (version.status !== 0 || version.stdout.trim() !== scannerVersion)
      throw new Error(`Local Semgrep must be exactly ${scannerVersion}`);
    for (const mode of ["test", "scan"])
      run(binary, scannerArguments(mode, resolve(reports, "semgrep.json")), env);
  } else {
    for (const mode of ["test", "scan"]) run("docker", dockerArguments(root, reports, mode), env);
  }
  const report = JSON.parse(readFileSync(resolve(reports, "semgrep.json"), "utf8"));
  assertReport(report);
  process.stdout.write(
    `Semgrep ${scannerVersion}: ${report.paths.scanned.length} files, zero findings or scan errors.\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "--local"))
    throw new Error("Usage: node .github/scripts/ci-semgrep.mjs [--local]");
  main(process.argv[2] === "--local");
}
