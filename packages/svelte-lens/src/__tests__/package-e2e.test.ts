import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "../..");
const pkgJson = JSON.parse(readFileSync(resolve(pkgRoot, "package.json"), "utf8"));

const REQUIRED_FILES = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/core/index.js",
  "dist/core/index.svelte.d.ts",
  "dist/cli/cli.js",
  "dist/mcp/cli.js",
  "dist/mcp/server.js",
  "bin/cli.js",
  "bin/mcp.js",
  "LICENSE",
  "README.md",
];

const REQUIRED_EXPORTS = [".", "./core"];

const REQUIRED_BINS = ["svelte-lens", "svelte-lens-mcp"];

const REQUIRED_API_EXPORTS = [
  "init",
  "copyPlugin",
  "openPlugin",
  "getSource",
  "getStack",
  "getStackContext",
  "getElementContext",
  "isLensHost",
  "getGlobalApi",
  "registerPlugin",
  "unregisterPlugin",
];

// Plugins are objects, not functions
const OBJECT_EXPORTS = new Set(["copyPlugin", "openPlugin"]);

describe("package tarball validation", () => {
  let packOutput: string;

  it("npm pack --dry-run succeeds", () => {
    const result = execSync("npm pack --dry-run 2>&1", { cwd: pkgRoot, encoding: "utf8" });
    packOutput = result;
    expect(result).toContain(pkgJson.name);
  });

  it("contains all required files", () => {
    for (const file of REQUIRED_FILES) {
      expect(packOutput, `Missing ${file} in tarball`).toContain(file);
    }
  });

  it("does not include test files", () => {
    expect(packOutput).not.toContain("__tests__");
    expect(packOutput).not.toContain(".test.");
  });

  it("does not include source maps in production", () => {
    expect(packOutput).not.toContain(".map");
  });

  it("package.json has correct name", () => {
    expect(pkgJson.name).toBe("@gear-null/svelte-lens");
  });

  it("package.json has version set", () => {
    expect(pkgJson.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("package.json has all required exports", () => {
    for (const exp of REQUIRED_EXPORTS) {
      expect(pkgJson.exports, `Missing export "${exp}"`).toHaveProperty(exp);
    }
  });

  it("package.json has all required bin entries", () => {
    for (const bin of REQUIRED_BINS) {
      expect(pkgJson.bin, `Missing bin "${bin}"`).toHaveProperty(bin);
    }
  });

  it("package.json has publishConfig.access = public", () => {
    expect(pkgJson.publishConfig?.access).toBe("public");
  });

  it("package.json has publishConfig.provenance = true", () => {
    expect(pkgJson.publishConfig?.provenance).toBe(true);
  });

  it("package.json has license MIT", () => {
    expect(pkgJson.license).toBe("MIT");
  });

  // The repo moved to squid-quarters; npm rejects provenance publishes whose
  // repository.url does not match the building repository (E422).
  it("package.json repository metadata points to squid-quarters/svelte-lens", () => {
    expect(pkgJson.repository?.url).toBe("git+https://github.com/squid-quarters/svelte-lens.git");
    expect(pkgJson.homepage).toContain("github.com/squid-quarters/svelte-lens");
    expect(pkgJson.bugs?.url).toContain("github.com/squid-quarters/svelte-lens");
  });

  // `npx -y @gear-null/svelte-lens` runs the `svelte-lens` init CLI, which has
  // no --mcp flag; MCP clients must launch the `svelte-lens-mcp` bin in stdio mode.
  it("README MCP config launches the svelte-lens-mcp bin over stdio", () => {
    const readme = readFileSync(resolve(pkgRoot, "README.md"), "utf8");
    expect(readme).toContain(
      '"args": ["-y", "-p", "@gear-null/svelte-lens", "svelte-lens-mcp", "--stdio"]',
    );
    expect(readme).not.toContain('"--mcp"');
    expect(readme).not.toMatch(/npx svelte-lens-mcp/);
    expect(pkgJson.bin?.["svelte-lens-mcp"]).toBe("./bin/mcp.js");
  });

  it("has no workspace: protocol in dependencies", () => {
    const deps = { ...pkgJson.dependencies, ...pkgJson.peerDependencies };
    for (const [name, version] of Object.entries(deps)) {
      expect(version, `${name} still uses workspace:`).not.toContain("workspace:");
    }
  });
});

describe("export resolution", () => {
  it("all documented API exports are importable", async () => {
    const mod = await import(resolve(pkgRoot, "dist/index.js"));
    for (const name of REQUIRED_API_EXPORTS) {
      expect(mod, `Missing export: ${name}`).toHaveProperty(name);
      const kind = OBJECT_EXPORTS.has(name) ? "object" : "function";
      expect(typeof mod[name as keyof typeof mod], `${name} is not a ${kind}`).toBe(kind);
    }
  });

  it("type definitions file exists and is non-empty", () => {
    const dts = readFileSync(resolve(pkgRoot, "dist/index.d.ts"), "utf8");
    expect(dts.length).toBeGreaterThan(0);
    for (const name of REQUIRED_API_EXPORTS) {
      expect(dts, `Missing type declaration for: ${name}`).toContain(name);
    }
  });
});

describe("CLI bin", () => {
  it("svelte-lens --version returns the package version", () => {
    const result = execSync("node bin/cli.js --version", { cwd: pkgRoot, encoding: "utf8" });
    expect(result.trim()).toBe(pkgJson.version);
  });

  it("svelte-lens --help returns usage info", () => {
    const result = execSync("node bin/cli.js --help", { cwd: pkgRoot, encoding: "utf8" });
    expect(result).toContain("init");
    expect(result).toContain("svelte-lens");
  });

  it("svelte-lens init --help returns init options", () => {
    const result = execSync("node bin/cli.js init --help", { cwd: pkgRoot, encoding: "utf8" });
    expect(result).toContain("--yes");
    expect(result).toContain("--force");
    expect(result).toContain("--skip-install");
  });
});

describe("MCP bin", () => {
  it("svelte-lens-mcp starts and responds to /health", async () => {
    const { spawn } = await import("node:child_process");
    const port = 25000 + Math.floor(Math.random() * 5000);

    const server = spawn("node", ["bin/mcp.js", "--port", String(port)], {
      cwd: pkgRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let started = false;
    let stderr = "";

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        server.kill();
        reject(new Error(`Server start timeout. stderr: ${stderr}`));
      }, 8000);

      server.stdout.on("data", (data: Buffer) => {
        const msg = data.toString();
        if (msg.includes("listening") && !started) {
          started = true;
          clearTimeout(timeout);
          resolve();
        }
      });

      server.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      // Also check stderr for the context server message (stdio mode logs there)
      server.stderr.on("data", (data: Buffer) => {
        if (data.toString().includes("listening") && !started) {
          started = true;
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    // Hit /health endpoint
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe("ok");

    // Hit /mcp endpoint with GET (should 400)
    const mcpResponse = await fetch(`http://127.0.0.1:${port}/mcp`);
    expect(mcpResponse.status).toBe(400);

    server.kill();
  });
});
