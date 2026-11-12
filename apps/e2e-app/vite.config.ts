import { sveltekit } from "@sveltejs/kit/vite";
import adapter from "@sveltejs/adapter-auto";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter(),
      preprocess: vitePreprocess(),
      compilerOptions: { runes: true },
    }),
  ],
  server: { port: 5174, strictPort: false },
});
