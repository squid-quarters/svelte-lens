import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { installPackages, prompts } = vi.hoisted(() => ({
  installPackages: vi.fn(),
  prompts: vi.fn(),
}));
vi.mock("../utils/install.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/install.js")>()),
  installPackages,
}));
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

// CI forces colour on, so drop ANSI codes before matching text.
const loggedOutput = () =>
  stripVTControlCharacters(vi.mocked(console.log).mock.calls.flat().join("\n"));

const PLAIN_LAYOUT = "<script>\n  let x = 1;\n</script>\n";
const originalIsTTY = process.stdin.isTTY;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "svelte-lens-init-"));
  // The test runner's own package manager must not leak into detection.
  vi.stubEnv("npm_config_user_agent", "");
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
  vi.unstubAllEnvs();
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

  it("migrates a layout wired to the deprecated package before advising its removal", async () => {
    const legacyLayout = `<script>
  import { onMount } from "svelte";
  onMount(() => import("svelte-lens").then((m) => m.init()));
</script>
`;
    writeKitProject({ "svelte-lens": "^1.0.0" }, legacyLayout);
    await runInit("--yes");
    expect(installPackages).toHaveBeenCalledWith(["@gear-null/svelte-lens"], "npm", root);
    const layout = readFileSync(layoutPath(), "utf-8");
    expect(layout).toContain('import("@gear-null/svelte-lens")');
    expect(layout).not.toMatch(/["']svelte-lens["']/);
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

  it("does not claim the package is installed after --skip-install", async () => {
    writeKitProject({}, PLAIN_LAYOUT);
    vi.stubEnv("npm_config_user_agent", "pnpm/10.12.1 npm/? node/v22.0.0 darwin arm64");
    await runInit("--yes", "--skip-install");

    const output = loggedOutput();
    expect(installPackages).not.toHaveBeenCalled();
    expect(output).not.toContain("svelte-lens installed.");
    expect(output).toContain("pnpm add -D @gear-null/svelte-lens");
    expect(readFileSync(layoutPath(), "utf-8")).toContain("@gear-null/svelte-lens");
  });

  it("tells the user where to install when --cwd is another directory", async () => {
    writeKitProject({}, PLAIN_LAYOUT);
    vi.spyOn(process, "cwd").mockReturnValue(join(root, ".."));
    await runInit("--yes", "--skip-install");

    const output = loggedOutput();
    expect(output).toContain(
      `Install it in ${root}: npm install --save-dev @gear-null/svelte-lens`,
    );
  });

  it("names no directory when the shell is already in the project", async () => {
    writeKitProject({}, PLAIN_LAYOUT);
    vi.spyOn(process, "cwd").mockReturnValue(root);
    await runInit("--yes", "--skip-install");

    const output = loggedOutput();
    expect(output).toContain("Install it to finish: npm install --save-dev @gear-null/svelte-lens");
  });

  it("says configured, not installed, when the package was already a dependency", async () => {
    writeKitProject({ "@gear-null/svelte-lens": "^1.0.0" }, PLAIN_LAYOUT);
    await runInit("--yes");

    const output = loggedOutput();
    expect(installPackages).not.toHaveBeenCalled();
    expect(output).toContain("svelte-lens configured.");
    expect(output).not.toContain("svelte-lens installed.");
  });

  it("says installed after installing the package", async () => {
    writeKitProject({}, PLAIN_LAYOUT);
    await runInit("--yes");

    expect(installPackages).toHaveBeenCalled();
    expect(loggedOutput()).toContain("svelte-lens installed.");
  });
});
