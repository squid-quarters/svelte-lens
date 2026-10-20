import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectPackageManager, detectProject } from "./detect.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "svelte-lens-detect-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const writePkg = (devDependencies: Record<string, string>) =>
  writeFileSync(join(root, "package.json"), JSON.stringify({ devDependencies }));

describe("detectProject", () => {
  it("does not treat the deprecated unscoped package as installed", async () => {
    writePkg({ "@sveltejs/kit": "^2.0.0", "svelte-lens": "^0.3.0" });
    const project = await detectProject(root);
    expect(project.hasSvelteLens).toBe(false);
    expect(project.hasLegacySvelteLens).toBe(true);
  });

  it("detects the scoped package", async () => {
    writePkg({ "@sveltejs/kit": "^2.0.0", "@gear-null/svelte-lens": "^1.0.0" });
    const project = await detectProject(root);
    expect(project.hasSvelteLens).toBe(true);
    expect(project.hasLegacySvelteLens).toBe(false);
  });
});

describe("detectPackageManager", () => {
  it("uses the invoking package manager when the project has no lockfile", async () => {
    writePkg({});
    vi.stubEnv("npm_config_user_agent", "pnpm/10.12.1 npm/? node/v22.0.0 darwin arm64");
    expect(await detectPackageManager(root)).toBe("pnpm");
  });

  it("prefers the project's lockfile over the invoking package manager", async () => {
    writePkg({});
    writeFileSync(join(root, "yarn.lock"), "");
    vi.stubEnv("npm_config_user_agent", "pnpm/10.12.1 npm/? node/v22.0.0 darwin arm64");
    expect(await detectPackageManager(root)).toBe("yarn");
  });

  it("falls back to npm when nothing identifies a package manager", async () => {
    writePkg({});
    vi.stubEnv("npm_config_user_agent", "");
    expect(await detectPackageManager(root)).toBe("npm");
  });
});
