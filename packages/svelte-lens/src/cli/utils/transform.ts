import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Framework } from "./detect.js";
import { SVELTEKIT_LAYOUT_BLOCK, VITE_SVELTE_IMPORT } from "./templates.js";

export interface TransformResult {
  success: boolean;
  filePath: string;
  message: string;
  originalContent?: string;
  newContent?: string;
  noChanges?: boolean;
}

const ROOT_LAYOUT_PATHS = [
  "src/routes/+layout.svelte",
  "src/routes/+layout.ts",
  "src/routes/+layout.js",
];

const VITE_ENTRY_PATHS = [
  "src/main.ts",
  "src/main.js",
  "src/main.tsx",
  "src/main.jsx",
  "src/index.ts",
  "src/index.js",
];

const findFirst = (projectRoot: string, candidates: string[]): string | null => {
  for (const candidate of candidates) {
    const fullPath = join(projectRoot, candidate);
    if (existsSync(fullPath)) return fullPath;
  }
  return null;
};

const fileContainsLensImport = (content: string): boolean =>
  /["'`](?:@gear-null\/svelte-lens|svelte-lens)["'`]/.test(content);

// Aliased bindings so the merged code can't collide with (or depend on) the
// user's own imports of `dev` / `onMount`. Duplicate imports are valid ES.
const LENS_ONMOUNT_CODE = `
  __lensOnMount(() => {
    if (__lensDev) import("@gear-null/svelte-lens").then((m) => m.init());
  });`;

const LENS_SCRIPT_IMPORTS = [
  `  import { dev as __lensDev } from "$app/environment";`,
  `  import { onMount as __lensOnMount } from "svelte";`,
];

// Instance script only: onMount in a `<script module>` / `context="module"`
// block runs outside component init and throws.
const MODULE_ATTR = String.raw`\b(?:module\b|context\s*=\s*["']module["'])`;
const INSTANCE_SCRIPT_RE = new RegExp(
  String.raw`(<script(?![^>]*${MODULE_ATTR})[^>]*>)([\s\S]*?)(<\/script>)`,
);
const MODULE_SCRIPT_RE = new RegExp(
  String.raw`<script(?=[^>]*${MODULE_ATTR})([^>]*)>[\s\S]*?<\/script>`,
);

const mergeIntoExistingScript = (content: string): string => {
  if (fileContainsLensImport(content)) return content;

  const scriptMatch = content.match(INSTANCE_SCRIPT_RE);
  if (!scriptMatch || scriptMatch.index === undefined) {
    // Only a module script: add a new instance script after it, same lang.
    const moduleMatch = content.match(MODULE_SCRIPT_RE);
    if (!moduleMatch || moduleMatch.index === undefined) return content;
    const lang = moduleMatch[1]?.match(/\blang\s*=\s*["'][^"']*["']/)?.[0];
    const block = [
      lang ? `<script ${lang}>` : "<script>",
      ...LENS_SCRIPT_IMPORTS,
      LENS_ONMOUNT_CODE,
      "</script>",
    ].join("\n");
    const end = moduleMatch.index + moduleMatch[0].length;
    return `${content.slice(0, end)}\n\n${block}${content.slice(end)}`;
  }

  const [whole, openTag = "<script>", scriptBody = "", closeTag = "</script>"] = scriptMatch;

  // Imports are hoisted, so they can go right after the open tag; the existing
  // statements are kept as-is (no line-based import parsing).
  const body = scriptBody.replace(/\s*$/, "");
  const newBlock = [
    openTag,
    ...LENS_SCRIPT_IMPORTS,
    `${body.startsWith("\n") ? body.slice(1) : body}\n${LENS_ONMOUNT_CODE}`,
    closeTag,
  ].join("\n");

  // Splice by index rather than String.replace so `$$props` etc. survive.
  const start = scriptMatch.index;
  return content.slice(0, start) + newBlock + content.slice(start + whole.length);
};

const transformSvelteKit = (projectRoot: string, force: boolean): TransformResult => {
  const layoutPath = findFirst(projectRoot, ROOT_LAYOUT_PATHS);

  if (!layoutPath || !layoutPath.endsWith(".svelte")) {
    const fallbackPath = join(projectRoot, "src/routes/+layout.svelte");
    return {
      success: true,
      filePath: fallbackPath,
      message: "Will create src/routes/+layout.svelte",
      originalContent: "",
      newContent: `${SVELTEKIT_LAYOUT_BLOCK}\n\n<slot />\n`,
    };
  }

  const originalContent = readFileSync(layoutPath, "utf-8");
  if (fileContainsLensImport(originalContent) && !force) {
    return {
      success: true,
      filePath: layoutPath,
      message: "svelte-lens already imported in layout",
      noChanges: true,
    };
  }

  // If layout has an existing <script> block, merge into it
  if (/<script[^>]*>/.test(originalContent)) {
    const newContent = mergeIntoExistingScript(originalContent);
    if (newContent === originalContent) {
      return {
        success: true,
        filePath: layoutPath,
        message: "svelte-lens already imported in layout",
        noChanges: true,
      };
    }
    return {
      success: true,
      filePath: layoutPath,
      message: "Merges svelte-lens dev import into existing layout script",
      originalContent,
      newContent,
    };
  }

  // No existing script — prepend the full block
  const newContent = `${SVELTEKIT_LAYOUT_BLOCK}\n\n${originalContent}`;

  return {
    success: true,
    filePath: layoutPath,
    message: "Adds svelte-lens dev import to root layout",
    originalContent,
    newContent,
  };
};

const transformViteSvelte = (projectRoot: string): TransformResult => {
  const entryPath = findFirst(projectRoot, VITE_ENTRY_PATHS);

  if (!entryPath) {
    return {
      success: false,
      filePath: "",
      message:
        "Could not find a Vite entry file. Add `if (import.meta.env.DEV) import('@gear-null/svelte-lens').then(m => m.init());` to your entry yourself.",
    };
  }

  const originalContent = readFileSync(entryPath, "utf-8");
  if (fileContainsLensImport(originalContent)) {
    return {
      success: true,
      filePath: entryPath,
      message: "svelte-lens already imported",
      noChanges: true,
    };
  }

  const newContent = `${VITE_SVELTE_IMPORT}\n\n${originalContent}`;

  return {
    success: true,
    filePath: entryPath,
    message: "Adds svelte-lens dev import to entry",
    originalContent,
    newContent,
  };
};

export const previewTransform = (
  projectRoot: string,
  framework: Framework,
  force = false,
): TransformResult => {
  if (framework === "sveltekit") return transformSvelteKit(projectRoot, force);
  if (framework === "vite-svelte") return transformViteSvelte(projectRoot);
  return {
    success: false,
    filePath: "",
    message: "Unsupported framework. svelte-lens supports SvelteKit and Vite + Svelte projects.",
  };
};

export const applyTransform = (result: TransformResult): void => {
  if (!result.success || result.noChanges || !result.newContent) return;
  writeFileSync(result.filePath, result.newContent);
};
