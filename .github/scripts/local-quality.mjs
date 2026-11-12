import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { runOwned } from "./owned-process.mjs";
import {
  chmodSync,
  accessSync,
  constants,
  readdirSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const script = ".github/scripts/local-quality.mjs";
const hook = ".githooks/pre-commit";
const configFile = ".local-quality.json";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const git = (root, args, env = process.env) =>
  execFileSync("git", ["-C", root, ...args], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

export function checkEnvironment(env) {
  // Do not forward cloud/service credentials or a commit's temporary index to checks.
  const allowed = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "JAVA_HOME",
    "SystemRoot",
    "USER",
    "LANG",
    "LC_ALL",
    "PNPM_HOME",
    "XDG_CACHE_HOME",
    "PLAYWRIGHT_BROWSERS_PATH",
    "npm_config_cache",
    "npm_config_offline",
    "npm_config_logs_dir",
    "COREPACK_ENABLE_NETWORK",
  ];
  return {
    ...Object.fromEntries(allowed.filter((key) => env[key]).map((key) => [key, env[key]])),
    CI: "true",
    TURBO_TELEMETRY_DISABLED: "1",
  };
}

export function installHook(root) {
  const target = resolve(root, git(root, ["rev-parse", "--git-path", "local-quality/hooks"]));
  const existing = git(root, ["config", "--default", "", "--get", "core.hooksPath"]);
  if (existing && existing !== target)
    throw new Error(
      `Existing core.hooksPath=${existing}; reconcile it before installing. Nothing changed.`,
    );
  const defaultHooks = resolve(root, git(root, ["rev-parse", "--git-common-dir"]), "hooks");
  const activeHooks = existsSync(defaultHooks)
    ? readdirSync(defaultHooks).filter((name) => {
        if (name.endsWith(".sample")) return false;
        try {
          accessSync(resolve(defaultHooks, name), constants.X_OK);
          return (
            lstatSync(resolve(defaultHooks, name)).isFile() ||
            lstatSync(resolve(defaultHooks, name)).isSymbolicLink()
          );
        } catch {
          return false;
        }
      })
    : [];
  if (activeHooks.length)
    throw new Error(
      `Existing default Git hooks (${activeHooks.join(", ")}); reconcile them before installing. Nothing changed.`,
    );
  const extensions = git(root, [
    "config",
    "--default",
    "false",
    "--get",
    "extensions.worktreeConfig",
  ]);
  if (extensions !== "true") {
    const worktree = git(root, ["config", "--local", "--default", "", "--get", "core.worktree"]);
    const bare = git(root, ["config", "--local", "--default", "false", "--get", "core.bare"]);
    if (worktree || bare === "true")
      throw new Error(
        "Custom core.worktree/bare configuration needs explicit reconciliation; nothing changed.",
      );
    git(root, ["config", "--local", "extensions.worktreeConfig", "true"]);
  }
  mkdirSync(target, { recursive: true });
  copyFileSync(resolve(root, hook), resolve(target, "pre-commit"));
  chmodSync(resolve(target, "pre-commit"), 0o755);
  git(root, ["config", "--worktree", "core.hooksPath", target]);
  process.stdout.write(
    "Installed full local pre-commit gate for this worktree; other worktrees retain their hook configuration.\n",
  );
}

export function exportRaw(snapshot, tree, env) {
  const entries = execFileSync("git", ["-C", snapshot, "ls-tree", "-rz", "--full-tree", tree], {
    env,
    maxBuffer: 16 * 1024 * 1024,
  });
  const records = new TextDecoder("utf-8", { fatal: true })
    .decode(entries)
    .split("\0")
    .filter(Boolean);
  const files = [];
  for (const entry of records) {
    const split = entry.indexOf("\t");
    const [mode, type, object] = entry.slice(0, split).split(" ");
    const name = entry.slice(split + 1);
    if (type !== "blob" || !["100644", "100755"].includes(mode))
      throw new Error(
        `Unsupported staged link/submodule/mode: ${name}. Resolve it before committing.`,
      );
    const path = resolve(snapshot, name);
    if (!path.startsWith(`${snapshot}/`)) throw new Error("Invalid staged path");
    const contents = execFileSync("git", ["-C", snapshot, "cat-file", "blob", object], {
      env,
      maxBuffer: 256 * 1024 * 1024,
    });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    chmodSync(path, mode === "100755" ? 0o755 : 0o644);
    files.push({ path, hash: sha256(contents), executable: mode === "100755" });
  }
  return files;
}

function assertRaw(files) {
  for (const file of files) {
    const info = lstatSync(file.path);
    if (
      !info.isFile() ||
      Boolean(info.mode & 0o100) !== file.executable ||
      sha256(readFileSync(file.path)) !== file.hash
    )
      throw new Error(`Checks changed staged snapshot file: ${file.path}`);
  }
}

const runCommand = runOwned;

export async function runQuality(root, options = {}) {
  const attemptId = randomUUID(),
    startedAt = new Date().toISOString();
  try {
    return await runQualityChecked(root, { ...options, attemptId });
  } catch (error) {
    const target = resolve(root, git(root, ["rev-parse", "--git-path", "local-quality/last.json"]));
    let prior;
    try {
      prior = JSON.parse(readFileSync(target, "utf8"));
    } catch {}
    const receipt =
      prior?.attemptId === attemptId
        ? prior
        : { attemptId, startedAt, phase: "preflight", tree: null, reuse: false };
    receipt.status = "failed";
    receipt.error = error.message;
    receipt.finishedAt = new Date().toISOString();
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(receipt, null, 2) + "\n");
    throw error;
  }
}

async function runQualityChecked(
  root,
  {
    run = runCommand,
    now = () => new Date(),
    attemptId,
    packageVersion = (env) => execFileSync("pnpm", ["--version"], { env, encoding: "utf8" }).trim(),
  } = {},
) {
  const tree = git(root, ["write-tree"]);
  const head = git(root, ["rev-parse", "HEAD"]);
  const blobs = Object.fromEntries(
    [script, hook, configFile, ".github/scripts/owned-process.mjs"].map((file) => [
      file,
      git(root, ["show", `:${file}`]),
    ]),
  );
  for (const file of [script, hook, ".github/scripts/owned-process.mjs"]) {
    if (readFileSync(resolve(root, file), "utf8").trim() !== blobs[file]) {
      throw new Error(
        `${file} differs from the staged gate. Stage the intended gate files before committing.`,
      );
    }
  }
  const config = JSON.parse(blobs[configFile]);
  if (
    !Array.isArray(config.commands) ||
    !config.commands.length ||
    !config.commands.every(
      (args) =>
        Array.isArray(args) &&
        args.length &&
        args.every((arg) => typeof arg === "string" && arg.length),
    )
  ) {
    throw new Error("Invalid staged quality command list");
  }
  const expectedNode = git(root, ["show", ":.nvmrc"]).replace(/^v/, "");
  if (process.versions.node !== expectedNode)
    throw new Error(
      `Use Node ${expectedNode} (fnm use) before running the commit gate; found ${process.versions.node}.`,
    );
  const env = checkEnvironment(process.env);
  const packageManager = JSON.parse(git(root, ["show", ":package.json"])).packageManager;
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(packageManager ?? ""))
    throw new Error("Expected an exact pnpm packageManager pin");
  const version = packageVersion(env);
  if (`pnpm@${version}` !== packageManager)
    throw new Error(`Use ${packageManager}; found pnpm@${version}`);
  const tools = (config.tools ?? []).map((args) => {
    if (
      !Array.isArray(args) ||
      !args.length ||
      !args.every((arg) => typeof arg === "string" && arg.length)
    )
      throw new Error("Invalid staged tool probe");
    return {
      command: args,
      version: execFileSync(args[0], args.slice(1), {
        env,
        encoding: "utf8",
        timeout: 10000,
      }).trim(),
    };
  });
  const directory = mkdtempSync(
    resolve(process.platform === "win32" ? tmpdir() : "/tmp", "sq-local-quality-"),
  );
  const snapshot = resolve(directory, "snapshot");
  const receipt = {
    attemptId,
    version: 1,
    tree,
    parentHead: head,
    node: process.versions.node,
    packageManager,
    tools,
    platform: process.platform,
    arch: process.arch,
    configSha256: sha256(blobs[configFile]),
    environment: env,
    startedAt: now().toISOString(),
    commands: config.commands,
    results: [],
    status: "failed",
    scope:
      "Exact staged tree with original HEAD metadata; not a release artifact or remote attestation",
    reuse: false,
  };
  // Record only non-secret reproducibility inputs, not machine/user path values.
  receipt.environment = { CI: env.CI, TURBO_TELEMETRY_DISABLED: env.TURBO_TELEMETRY_DISABLED };
  let registered = false;
  let child;
  let interrupted;
  let terminated, cancellationFailed;
  const cancellationFailure = new Promise((done) => {
    cancellationFailed = done;
  });
  const terminate = (signal) => {
    interrupted = signal;
    if (child?.cancel && !terminated)
      terminated = Promise.resolve()
        .then(() => child.cancel(signal))
        .catch((error) => {
          receipt.processCleanupFailed = true;
          cancellationFailed({ status: null, error, cleanupUncertain: true, pid: child?.pid });
        });
  };
  const onInt = () => terminate("SIGINT");
  const onTerm = () => terminate("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  let failure;
  try {
    git(root, ["worktree", "add", "--detach", "--no-checkout", snapshot, head], env);
    registered = true;
    git(snapshot, ["read-tree", tree], env);
    const files = exportRaw(snapshot, tree, env);
    const contextFile = resolve(directory, "context.json");
    writeFileSync(contextFile, JSON.stringify({ snapshot, tree }));
    writeFileSync(resolve(directory, "runtime-inputs.json"), "{}");
    env.LOCAL_QUALITY_CONTEXT = contextFile;
    if (git(snapshot, ["write-tree"], env) !== tree)
      throw new Error("Snapshot index does not match staged tree");
    for (const args of config.commands) {
      process.stdout.write(`Local quality: ${args.join(" ")}\n`);
      const start = Date.now();
      if (interrupted) throw new Error(`Interrupted by ${interrupted}`);
      // oxlint-disable-next-line no-await-in-loop -- Keep builds and emulators serial.
      const result = await Promise.race([
        run(args[0], args.slice(1), { cwd: snapshot, env, stdio: "inherit" }, (value) => {
          child = value;
          if (interrupted) terminate(interrupted);
        }),
        cancellationFailure,
      ]);
      if (result.cleanupUncertain) {
        receipt.processCleanupFailed = true;
        receipt.uncertainProcessIdentities = result.owned;
        receipt.uncertainChildPid = result.pid;
        receipt.retainedSnapshot = snapshot;
      }
      child = undefined;

      if (interrupted) throw new Error(`Interrupted by ${interrupted}`);
      receipt.results.push({
        command: args,
        exit: result.status,
        signal: result.signal ?? null,
        processIdentities: result.owned ?? [],
        seconds: (Date.now() - start) / 1000,
      });
      if (result.status !== 0 || result.error || result.signal)
        throw new Error(
          `Failed: ${args.join(" ")}. Fix this staged snapshot and retry. ${result.error?.message ?? ""}`,
        );
    }
    const inputsPath = resolve(directory, "runtime-inputs.json");
    if (
      !lstatSync(inputsPath).isFile() ||
      lstatSync(inputsPath).isSymbolicLink() ||
      lstatSync(inputsPath).size > 65536
    )
      throw new Error("Invalid runtime input receipt");
    const inputsBytes = readFileSync(inputsPath);
    if (inputsBytes.length > 65536) throw new Error("Runtime input receipt exceeds its bound");
    const inputs = JSON.parse(inputsBytes);
    if (
      !inputs ||
      Array.isArray(inputs) ||
      typeof inputs !== "object" ||
      !Object.entries(inputs).every(
        ([key, value]) =>
          typeof value === "string" &&
          (["svelteLatest", "svelteFloor"].includes(key)
            ? /^\d+\.\d+\.\d+$/.test(value)
            : key === "latestLockSha256" && /^[a-f0-9]{64}$/.test(value)),
      )
    )
      throw new Error("Unexpected runtime input receipt");
    receipt.externalInputs = inputs;
    assertRaw(files);
    if (git(snapshot, ["write-tree"], env) !== tree)
      throw new Error("Checks changed the snapshot index");
    if (git(root, ["write-tree"]) !== tree || git(root, ["rev-parse", "HEAD"]) !== head)
      throw new Error(
        "Staged tree or HEAD changed during checks. Retry the commit against the new snapshot.",
      );
    receipt.status = "passed";
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (terminated) await terminated;
    } catch (error) {
      receipt.status = "failed";
      receipt.processCleanupFailed = true;
      failure = error;
    }
    process.removeListener("SIGINT", onInt);
    process.removeListener("SIGTERM", onTerm);
    receipt.interruptedBy = interrupted ?? null;
    const target = resolve(root, git(root, ["rev-parse", "--git-path", "local-quality/last.json"]));
    try {
      if (!receipt.processCleanupFailed) {
        if (registered) git(root, ["worktree", "remove", "--force", snapshot], env);
        rmSync(directory, { recursive: true, force: true });
      }
    } catch (error) {
      receipt.status = "failed";
      receipt.cleanupFailed = true;
      failure ??= error;
    } finally {
      receipt.finishedAt = now().toISOString();
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(receipt, null, 2)}\n`);
      process.stdout.write(`Local quality receipt: ${target} (${receipt.status})\n`);
    }
  }
  if (failure) throw failure;
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
    if (process.argv[2] === "--install") installHook(root);
    else if (process.argv.length > 2)
      throw new Error("Usage: node .github/scripts/local-quality.mjs [--install]");
    else await runQuality(root);
  } catch (error) {
    console.error(`Local quality blocked commit: ${error.message}`);
    process.exitCode = 1;
  }
}
