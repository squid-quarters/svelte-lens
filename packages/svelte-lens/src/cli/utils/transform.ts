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
  /["'`]@gear-null\/svelte-lens["'`]/.test(content);

// Releases before the rename wired `import("svelte-lens")`; the unscoped
// package is deprecated, so point those specifiers at the scoped one.
const LEGACY_SPECIFIER_RE =
  /(\bimport\s*\(\s*|\bfrom\s*|\bimport\s*)(["'`])svelte-lens(\/[^"'`]*)?\2/g;

const rewriteLegacyImports = (content: string): string =>
  content.replace(
    LEGACY_SPECIFIER_RE,
    (_match, prefix: string, quote: string, subpath = "") =>
      `${prefix}${quote}@gear-null/svelte-lens${subpath}${quote}`,
  );

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

// onMount in a `<script module>` / `context="module"` block runs outside
// component init and throws, so only the instance script may be merged into.
const MODULE_ATTR_RE = /\b(?:module\b|context\s*=\s*["']module["'])/;
// Scanned left to right, so whichever region opens first swallows the others:
// comments and <svelte:head> hold markup scripts (JSON-LD, analytics), never
// the component's own scripts, while a `<!--` or `<svelte:head>` mentioned
// inside a <script>/<style> body is just code. Open tags skip quoted attribute
// values so a `>` in e.g. `generics="T extends Array<string>"` doesn't end them.
const TOP_LEVEL_REGION_RE =
  /<!--[\s\S]*?-->|<svelte:head\b[\s\S]*?<\/svelte:head>|<style\b(?:"[^"]*"|'[^']*'|[^>"'])*>[\s\S]*?<\/style>|<script\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/script>/g;

interface ScriptBlock {
  start: number;
  end: number;
  openTag: string;
  body: string;
  attrs: string;
}

const isComponentScriptAttrs = (attrs: string): boolean => {
  if (/\bsrc\s*=/.test(attrs)) return false;
  const type = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/)?.[1];
  return !type || /^(?:text|application)\/(?:javascript|typescript)$/i.test(type);
};

const findComponentScripts = (
  content: string,
): { instance?: ScriptBlock; module?: ScriptBlock } => {
  const found: { instance?: ScriptBlock; module?: ScriptBlock } = {};
  for (const match of content.matchAll(TOP_LEVEL_REGION_RE)) {
    if (!match[0].startsWith("<script")) continue;
    const attrs = match[1] ?? "";
    if (!isComponentScriptAttrs(attrs)) continue;
    const start = match.index;
    const block: ScriptBlock = {
      start,
      end: start + match[0].length,
      openTag: `<script${attrs}>`,
      body: match[2] ?? "",
      attrs,
    };
    const kind = MODULE_ATTR_RE.test(attrs) ? "module" : "instance";
    found[kind] ??= block;
  }
  return found;
};

// Returns null when the file has no component script to merge into.
const mergeIntoExistingScript = (content: string): string | null => {
  const { instance, module } = findComponentScripts(content);

  if (!instance) {
    if (!module) return null;
    // Only a module script: add a new instance script after it, same lang.
    const lang = module.attrs.match(/\blang\s*=\s*["'][^"']*["']/)?.[0];
    const block = [
      lang ? `<script ${lang}>` : "<script>",
      ...LENS_SCRIPT_IMPORTS,
      LENS_ONMOUNT_CODE,
      "</script>",
    ].join("\n");
    return `${content.slice(0, module.end)}\n\n${block}${content.slice(module.end)}`;
  }

  // Imports are hoisted, so they can go right after the open tag; the existing
  // statements are kept as-is (no line-based import parsing).
  const body = instance.body.replace(/\s*$/, "");
  const newBlock = [
    instance.openTag,
    ...LENS_SCRIPT_IMPORTS,
    `${body.startsWith("\n") ? body.slice(1) : body}\n${LENS_ONMOUNT_CODE}`,
    "</script>",
  ].join("\n");

  // Splice by index rather than String.replace so `$$props` etc. survive.
  return content.slice(0, instance.start) + newBlock + content.slice(instance.end);
};

const transformSvelteKit = (projectRoot: string): TransformResult => {
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
  const migrated = rewriteLegacyImports(originalContent);
  if (migrated !== originalContent) {
    return {
      success: true,
      filePath: layoutPath,
      message: "Rewrites deprecated `svelte-lens` import in layout to `@gear-null/svelte-lens`",
      originalContent,
      newContent: migrated,
    };
  }

  if (fileContainsLensImport(originalContent)) {
    return {
      success: true,
      filePath: layoutPath,
      message: "svelte-lens already imported in layout",
      noChanges: true,
    };
  }

  const merged = mergeIntoExistingScript(originalContent);
  if (merged !== null) {
    return {
      success: true,
      filePath: layoutPath,
      message: "Merges svelte-lens dev import into existing layout script",
      originalContent,
      newContent: merged,
    };
  }

  // No component script — prepend the full block
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
  const migrated = rewriteLegacyImports(originalContent);
  if (migrated !== originalContent) {
    return {
      success: true,
      filePath: entryPath,
      message: "Rewrites deprecated `svelte-lens` import in entry to `@gear-null/svelte-lens`",
      originalContent,
      newContent: migrated,
    };
  }

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
  // Transforms are idempotent, so --force has nothing extra to overwrite.
  _force = false,
): TransformResult => {
  if (framework === "sveltekit") return transformSvelteKit(projectRoot);
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
