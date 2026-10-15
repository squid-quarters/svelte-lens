import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig([
  {
    entry: ["src/cli/cli.ts"],
    outDir: "dist/cli",
    format: ["esm"],
    target: "node20",
    platform: "node",
    clean: true,
    dts: false,
    sourcemap: false,
    splitting: false,
    shims: false,
    define: {
      "process.env.SVELTE_LENS_CLI_VERSION": JSON.stringify(pkg.version),
    },
  },
  {
    entry: ["src/mcp/cli.ts", "src/mcp/server.ts"],
    outDir: "dist/mcp",
    format: ["esm"],
    target: "node20",
    platform: "node",
    clean: true,
    dts: false,
    sourcemap: false,
    splitting: false,
    define: {
      "process.env.SVELTE_LENS_MCP_VERSION": JSON.stringify(pkg.version),
    },
  },
]);
