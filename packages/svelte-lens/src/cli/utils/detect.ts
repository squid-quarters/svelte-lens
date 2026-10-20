import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { detect, getUserAgent } from "package-manager-detector/detect";

export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";
export type Framework = "sveltekit" | "vite-svelte" | "unknown";

export interface ProjectInfo {
  projectRoot: string;
  packageManager: PackageManager;
  framework: Framework;
  hasSvelteLens: boolean;
  hasLegacySvelteLens: boolean;
  isMonorepo: boolean;
}

const PACKAGE_MANAGERS = new Set<PackageManager>(["npm", "yarn", "pnpm", "bun"]);

const toPackageManager = (agent: string | null | undefined): PackageManager | null => {
  const name = agent?.split("@")[0];
  return PACKAGE_MANAGERS.has(name as PackageManager) ? (name as PackageManager) : null;
};

// A lockfile or packageManager field wins; without either (a fresh project),
// use whichever package manager is running the CLI, e.g. pnpm under `pnpm dlx`.
export const detectPackageManager = async (projectRoot: string): Promise<PackageManager> => {
  const result = await detect({ cwd: projectRoot });
  return toPackageManager(result?.agent) ?? toPackageManager(getUserAgent()) ?? "npm";
};

const readDependencies = (projectRoot: string): Record<string, string> | null => {
  const path = join(projectRoot, "package.json");
  if (!existsSync(path)) return null;
  try {
    const json = JSON.parse(readFileSync(path, "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return { ...json.dependencies, ...json.devDependencies };
  } catch {
    return null;
  }
};

const isSveltekitProject = (deps: Record<string, string> | null): boolean =>
  Boolean(deps?.["@sveltejs/kit"]);

const isViteSvelteProject = (deps: Record<string, string> | null): boolean =>
  Boolean(deps?.["@sveltejs/vite-plugin-svelte"]);

export const detectFramework = (projectRoot: string): Framework => {
  const deps = readDependencies(projectRoot);
  if (isSveltekitProject(deps)) return "sveltekit";
  if (isViteSvelteProject(deps)) return "vite-svelte";
  return "unknown";
};

const detectMonorepo = (projectRoot: string): boolean => {
  if (existsSync(join(projectRoot, "pnpm-workspace.yaml"))) return true;
  if (existsSync(join(projectRoot, "lerna.json"))) return true;
  const path = join(projectRoot, "package.json");
  if (!existsSync(path)) return false;
  try {
    const json = JSON.parse(readFileSync(path, "utf-8")) as { workspaces?: unknown };
    return Boolean(json.workspaces);
  } catch {
    return false;
  }
};

// Only the scoped package satisfies the import the CLI writes; the deprecated
// unscoped name is tracked separately so init still installs the scoped one.
const hasSvelteLensInDeps = (deps: Record<string, string> | null): boolean =>
  Boolean(deps?.["@gear-null/svelte-lens"]);

const hasLegacySvelteLensInDeps = (deps: Record<string, string> | null): boolean =>
  Boolean(deps?.["svelte-lens"]);

export const detectProject = async (cwd: string): Promise<ProjectInfo> => {
  const packageManager = await detectPackageManager(cwd);
  const framework = detectFramework(cwd);
  const deps = readDependencies(cwd);
  return {
    projectRoot: cwd,
    packageManager,
    framework,
    hasSvelteLens: hasSvelteLensInDeps(deps),
    hasLegacySvelteLens: hasLegacySvelteLensInDeps(deps),
    isMonorepo: detectMonorepo(cwd),
  };
};
