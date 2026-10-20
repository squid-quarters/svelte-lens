import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkEnvironment } from "./local-quality.mjs";

export function snapshotContext(root, contextFile) {
  assert.ok(contextFile, "Run latest-peer checks through the staged quality gate");
  const actual = realpathSync(root);
  const context = realpathSync(contextFile);
  assert.equal(
    basename(actual),
    "snapshot",
    "Latest-peer checks require the owned temporary snapshot",
  );
  assert.ok(basename(dirname(actual)).startsWith("sq-local-quality-"));
  assert.equal(dirname(context), dirname(actual));
  assert.equal(basename(context), "context.json");
  assert.ok(lstatSync(resolve(actual, ".git")).isFile(), "Never mutate a primary clone");
  assert.ok(lstatSync(context).isFile() && !lstatSync(context).isSymbolicLink());
  const value = JSON.parse(readFileSync(context, "utf8"));
  assert.equal(realpathSync(value.snapshot), actual);
  assert.match(value.tree, /^[a-f0-9]{40}$/);
  const tree = execFileSync("git", ["-C", actual, "write-tree"], {
    env: checkEnvironment(process.env),
    encoding: "utf8",
  }).trim();
  assert.equal(tree, value.tree, "Snapshot index changed before latest-peer checks");
  return { ...value, snapshot: actual, inputs: resolve(dirname(context), "runtime-inputs.json") };
}

function run(args, { cwd, env, capture = false }) {
  console.log(`Latest-peer check: ${args.join(" ")}`);
  return (
    execFileSync(args[0], args.slice(1), {
      cwd,
      env,
      encoding: "utf8",
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
      timeout: 600000,
    }) ?? ""
  );
}

export function runLatest(
  root = process.cwd(),
  { execute = run, contextFile = process.env.LOCAL_QUALITY_CONTEXT } = {},
) {
  const context = snapshotContext(root, contextFile);
  const env = checkEnvironment(process.env);
  const options = { cwd: context.snapshot, env };
  const latest = execute(["npm", "view", "svelte", "version"], {
    ...options,
    capture: true,
  }).trim();
  assert.match(latest, /^\d+\.\d+\.\d+$/);
  const files = ["apps/e2e-app/package.json", "pnpm-lock.yaml"];
  const original = files.map((file) => [
    resolve(context.snapshot, file),
    readFileSync(resolve(context.snapshot, file)),
  ]);
  try {
    execute(
      [
        "pnpm",
        "--filter",
        "@svelte-lens/e2e-app",
        "add",
        "--save-dev",
        "--save-exact",
        "--ignore-scripts",
        `svelte@${latest}`,
      ],
      options,
    );
    const resolved = (directory) =>
      JSON.parse(
        readFileSync(
          createRequire(resolve(context.snapshot, directory, "package.json")).resolve(
            "svelte/package.json",
          ),
          "utf8",
        ),
      ).version;
    const floor = JSON.parse(
      readFileSync(resolve(context.snapshot, "packages/svelte-lens/package.json"), "utf8"),
    ).devDependencies.svelte;
    assert.match(floor, /^\d+\.\d+\.\d+$/);
    assert.equal(resolved("apps/e2e-app"), latest, "The app must use the resolved latest peer");
    assert.equal(
      resolved("packages/svelte-lens"),
      floor,
      "Build the library against its unchanged peer floor",
    );
    const inputs = {
      svelteLatest: latest,
      svelteFloor: floor,
      latestLockSha256: createHash("sha256")
        .update(readFileSync(resolve(context.snapshot, "pnpm-lock.yaml")))
        .digest("hex"),
    };
    writeFileSync(context.inputs, JSON.stringify(inputs));
    console.log(`Latest-peer inputs: ${JSON.stringify(inputs)}`);
    execute(["pnpm", "build"], options);
    execute(
      ["pnpm", "--filter", "@svelte-lens/e2e-app", "test:e2e", "--workers=1", "--retries=0"],
      options,
    );
    return inputs;
  } finally {
    // Only this verified disposable snapshot is changed. Preserve the original staged bytes.
    for (const [path, bytes] of original) writeFileSync(path, bytes);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runLatest();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
