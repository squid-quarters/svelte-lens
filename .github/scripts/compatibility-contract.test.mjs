import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import test from "node:test";

const read = (file) => JSON.parse(readFileSync(resolve(file), "utf8"));
const legacy = read("apps/e2e-kit2-floor/package.json");
const modern = read("apps/e2e-floor/package.json");
const library = read("packages/svelte-lens/package.json");

test("Kit 3 bump keeps supported peers and a separate unchanged Kit 2 consumer floor", () => {
  assert.equal(modern.devDependencies["@sveltejs/kit"], "3.2.0");
  assert.equal(modern.devDependencies["@sveltejs/adapter-auto"], "8.0.1");
  assert.equal(modern.devDependencies.svelte, "5.57.1");
  assert.equal(modern.devDependencies.typescript, "6.0.3");
  assert.equal(legacy.devDependencies["@sveltejs/kit"], "2.70.4");
  assert.equal(legacy.devDependencies["@sveltejs/adapter-auto"], "7.0.1");
  assert.equal(legacy.devDependencies.svelte, library.devDependencies.svelte);
  assert.equal(legacy.devDependencies.svelte, "5.56.3");
  for (const [folder, kitMajor] of [
    ["e2e-floor", "3"],
    ["e2e-kit2-floor", "2"],
  ]) {
    const require = createRequire(resolve(`apps/${folder}/package.json`));
    const adapter = require("@sveltejs/adapter-auto/package.json");
    assert.ok(adapter.peerDependencies["@sveltejs/kit"].startsWith(`^${kitMajor}.`));
    assert.ok(require("@sveltejs/kit/package.json").version.startsWith(`${kitMajor}.`));
  }
});

test("legacy fixture keeps experimental remote functions unreachable", async () => {
  const config = (await import("../../apps/e2e-kit2-floor/svelte.config.js")).default;
  assert.equal(config.kit.experimental.remoteFunctions, false);
  const walk = (root) =>
    readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    });
  for (const path of [...walk("apps/e2e-app/src"), ...walk("apps/e2e-kit2-floor/src")]) {
    assert.doesNotMatch(
      path,
      /\.remote\.[cm]?[jt]s$/,
      "legacy fixture must not acquire remote handlers",
    );
  }
});

test("both consumer fixtures stay in local and forge browser/SSR checks", () => {
  const commands = read(".local-quality.json").commands;
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const ssr = readFileSync(".github/scripts/ci-production-ssr.mjs", "utf8");
  for (const fixture of ["e2e-floor", "e2e-kit2-floor"]) {
    assert.ok(
      commands.some(
        (args) => args.includes(`@svelte-lens/${fixture}`) && args.includes("test:e2e"),
      ),
    );
    assert.ok(
      ci.includes(`pnpm --filter @svelte-lens/${fixture} test:e2e --workers=1 --retries=0`),
    );
    assert.ok(ssr.includes(`"${fixture}"`));
  }
});
