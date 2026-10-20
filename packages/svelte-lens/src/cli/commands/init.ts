import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import prompts from "prompts";
import { detectProject } from "../utils/detect.js";
import { applyTransform, previewTransform } from "../utils/transform.js";
import { formatInstallCommand, installPackages } from "../utils/install.js";
import { logger, colors } from "../utils/logger.js";

const FRAMEWORK_LABELS = {
  sveltekit: "SvelteKit",
  "vite-svelte": "Vite + Svelte",
  unknown: "Unknown",
} as const;

export const init = new Command("init")
  .description("install svelte-lens into your project")
  .option("-y, --yes", "skip confirmation prompts", false)
  .option("-f, --force", "overwrite existing config", false)
  .option("--skip-install", "skip package installation", false)
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .action(async (opts) => {
    const cwd = resolve(opts.cwd);

    if (!existsSync(cwd)) {
      logger.error(`Directory does not exist: ${cwd}`);
      process.exit(1);
    }

    const project = await detectProject(cwd);

    logger.log(`${colors.bold("svelte-lens init")}`);
    logger.break();
    logger.log(`  framework      ${colors.info(FRAMEWORK_LABELS[project.framework])}`);
    logger.log(`  package mgr    ${colors.info(project.packageManager)}`);
    logger.log(`  monorepo       ${project.isMonorepo ? "yes" : "no"}`);
    logger.break();

    if (project.framework === "unknown") {
      logger.error(
        "Could not detect a SvelteKit or Vite + Svelte project. svelte-lens requires either.",
      );
      process.exit(1);
    }

    if (project.hasLegacySvelteLens && !project.hasSvelteLens) {
      logger.warn(
        "Found deprecated `svelte-lens` dependency; svelte-lens now ships as `@gear-null/svelte-lens`. You can remove the old package.",
      );
    }

    const result = previewTransform(project.projectRoot, project.framework, opts.force);
    if (!result.success) {
      logger.error(result.message);
      process.exit(1);
    }

    if (result.noChanges) {
      logger.success(result.message);
      if (project.hasSvelteLens) {
        logger.success("svelte-lens is already set up.");
        return;
      }
    } else {
      logger.info(result.message);
      logger.log(`  file: ${colors.dim(result.filePath)}`);
      logger.break();
    }

    if (!opts.yes && !result.noChanges) {
      // prompts never settles on stdin EOF, so a non-TTY run would hang.
      if (!process.stdin.isTTY) {
        logger.error("Non-interactive shell detected. Re-run with --yes to apply these changes.");
        process.exit(1);
      }
      const { proceed } = await prompts({
        type: "confirm",
        name: "proceed",
        message: "Apply these changes?",
        initial: true,
      });
      if (!proceed) {
        logger.log("Cancelled.");
        process.exit(0);
      }
    }

    const needsInstall = !project.hasSvelteLens;
    if (!opts.skipInstall && needsInstall) {
      logger.info("Installing svelte-lens as dev dependency...");
      await installPackages(
        ["@gear-null/svelte-lens"],
        project.packageManager,
        project.projectRoot,
      );
    }

    if (!result.noChanges && result.newContent) {
      mkdirSync(dirname(result.filePath), { recursive: true });
      applyTransform(result);
    }

    logger.break();
    if (opts.skipInstall && needsInstall) {
      logger.success("svelte-lens configured.");
      logger.warn(
        `Package not installed (--skip-install). Install it to finish: ${colors.highlight(
          formatInstallCommand(["@gear-null/svelte-lens"], project.packageManager),
        )}`,
      );
      return;
    }
    logger.success("svelte-lens installed.");
    logger.log("Restart your dev server to load it.");
  });
