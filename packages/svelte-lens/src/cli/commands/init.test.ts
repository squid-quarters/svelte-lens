import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { installPackages, prompts } = vi.hoisted(() => ({
  installPackages: vi.fn(),
  prompts: vi.fn(),
}));
vi.mock("../utils/install.js", () => ({ installPackages }));
vi.mock("prompts", () => ({ default: prompts }));

let root: string;
const layoutPath = () => join(root, "src/routes/+layout.svelte");

const writeKitProject = (devDependencies: Record<string, string>, layout: string) => {
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ devDependencies: { "@sveltejs/kit": "^2.0.0", ...devDependencies } }),
  );
  mkdirSync(join(root, "src/routes"), { recursive: true });
  writeFileSync(layoutPath(), layout);
};

// Fresh module per run: commander keeps parsed option values on the command.
const runInit = async (...args: string[]) => {
  vi.resetModules();
  const { init } = await import("./init.js");
  await init.parseAsync(["--cwd", root, ...args], { from: "user" });
};

const PLAIN_LAYOUT = "<script>\n  let x = 1;\n</script>\n";
const originalIsTTY = process.stdin.isTTY;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "svelte-lens-init-"));
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  process.stdin.isTTY = originalIsTTY;
  vi.restoreAllMocks();
  installPackages.mockReset();
  prompts.mockReset();
});

describe("init command", () => {
  it("wires the layout when the package is already in deps but not imported", async () => {
    writeKitProject({ "@gear-null/svelte-lens": "^1.0.0" }, PLAIN_LAYOUT);
    await runInit("--yes");
    expect(readFileSync(layoutPath(), "utf-8")).toContain("@gear-null/svelte-lens");
    expect(installPackages).not.toHaveBeenCalled();
  });

  it("is a no-op when the package is installed and the layout is wired", async () => {
    writeKitProject({ "@gear-null/svelte-lens": "^1.0.0" }, PLAIN_LAYOUT);
    await runInit("--yes");
    const wired = readFileSync(layoutPath(), "utf-8");
    await runInit("--yes");
    expect(readFileSync(layoutPath(), "utf-8")).toBe(wired);
    expect(installPackages).not.toHaveBeenCalled();
  });

  it("installs the scoped package when only the deprecated one is present", async () => {
    writeKitProject({ "svelte-lens": "^0.3.0" }, PLAIN_LAYOUT);
    await runInit("--yes", "--force");
    expect(installPackages).toHaveBeenCalledWith(["@gear-null/svelte-lens"], "npm", root);
    expect(readFileSync(layoutPath(), "utf-8")).toContain("@gear-null/svelte-lens");
  });

  it("exits with an error instead of prompting when stdin is not a TTY", async () => {
    writeKitProject({}, PLAIN_LAYOUT);
    process.stdin.isTTY = false;
    await expect(runInit("--skip-install")).rejects.toThrow("exit 1");
    expect(prompts).not.toHaveBeenCalled();
    expect(readFileSync(layoutPath(), "utf-8")).toBe(PLAIN_LAYOUT);
  });

  it("prompts for confirmation on a TTY", async () => {
    writeKitProject({}, PLAIN_LAYOUT);
    process.stdin.isTTY = true;
    prompts.mockResolvedValue({ proceed: true });
    await runInit("--skip-install");
    expect(prompts).toHaveBeenCalledOnce();
    expect(readFileSync(layoutPath(), "utf-8")).toContain("@gear-null/svelte-lens");
  });
});
