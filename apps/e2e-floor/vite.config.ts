import adapter from "@sveltejs/adapter-auto";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath as pathFromUrl } from "node:url";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
const require = createRequire(import.meta.url);
const floor = require("./package.json").devDependencies.svelte;
assert.equal(require("svelte/package.json").version, floor);
const client = realpathSync(require.resolve("svelte/internal/client"));
export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter(),
      preprocess: vitePreprocess(),
      compilerOptions: { runes: true },
      files: {
        routes: "src/routes",
        appTemplate: "src/app.html",
        assets: pathFromUrl(new URL("../e2e-app/static", import.meta.url)),
      },
    }),
    {
      name: "verify-consumer-svelte-floor",
      async buildStart() {
        for (const path of [
          "../../packages/svelte-lens/dist/index.js",
          "../e2e-app/src/routes/+layout.svelte",
        ]) {
          const resolved = await this.resolve(
            "svelte/internal/client",
            fileURLToPath(new URL(path, import.meta.url)),
          );
          assert.ok(resolved, `Missing Svelte runtime for ${path}`);
          assert.equal(
            realpathSync(resolved.id.split("?")[0]!),
            client,
            `Consumer must resolve Svelte ${floor}`,
          );
        }
        console.log(`Verified consumer Svelte floor ${floor}: ${client}`);
      },
    },
  ],
  resolve: { dedupe: ["svelte"] },
  // Keep the asserted consumer runtime as source modules instead of a
  // not-yet-created optimized-dependency URL during dev startup.
  optimizeDeps: { exclude: ["svelte"] },
  server: { port: 5174, strictPort: true },
});
