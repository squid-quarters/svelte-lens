import adapter from "@sveltejs/adapter-auto";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
const shared = (path) => fileURLToPath(new URL(`../e2e-app/${path}`, import.meta.url));
export default {
  preprocess: vitePreprocess(),
  compilerOptions: { runes: true },
  kit: {
    adapter: adapter(),
    files: {
      routes: shared("src/routes"),
      appTemplate: shared("src/app.html"),
      assets: shared("static"),
    },
  },
};
