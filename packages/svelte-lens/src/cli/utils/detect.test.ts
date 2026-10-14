import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectProject } from "./detect.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "svelte-lens-detect-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
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
