import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { Framework } from "./detect.js";
import {
  SVELTEKIT_LAYOUT_BLOCK,
  VITE_SVELTE_IMPORT,
  lensOnMountCode,
  lensScriptImport,
  sveltekitLayoutBlock,
  sveltekitLayoutFile,
} from "./templates.js";

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

// Indent the inserted lines like the file does (sv create uses tabs): the
// leading whitespace of the first indented line, else two spaces.
const detectIndent = (...sources: string[]): string => {
  for (const source of sources) {
    const indent = /^([ \t]+)\S/m.exec(source)?.[1];
    if (indent) return indent;
  }
  return "  ";
};

// sv create writes tsconfig.json for TypeScript projects (jsconfig.json
// otherwise), so new script blocks follow the project's language.
const isTypeScriptProject = (projectRoot: string): boolean =>
  existsSync(join(projectRoot, "tsconfig.json"));

const readIfExists = (path: string): string =>
  existsSync(path) ? readFileSync(path, "utf-8") : "";

// For a file created from scratch: indent like the project's other templates.
const projectIndent = (projectRoot: string): string =>
  detectIndent(
    ...["src/routes/+page.svelte", "src/app.html"].map((file) =>
      readIfExists(join(projectRoot, file)),
    ),
  );

interface ScriptBlock {
  start: number;
  end: number;
  openTag: string;
  body: string;
  attrs: string;
}

interface SvelteScriptNode {
  start: number;
  end: number;
  content: { start: number; end: number };
}

type SvelteParse = (
  source: string,
  options: { modern: true },
) => { instance: SvelteScriptNode | null; module: SvelteScriptNode | null };

// Svelte's own parser decides which <script> is the component's: regexes can't
// tell a real script from `<script` text in comments, <svelte:head>, or markup
// expressions like {@html "<script>…</script>"}. Prefer the project's svelte,
// falling back to the one resolvable from this package (peer dependency).
const loadSvelteParse = (projectRoot: string): SvelteParse | null => {
  for (const from of [join(projectRoot, "package.json"), import.meta.url]) {
    try {
      return (createRequire(from)("svelte/compiler") as { parse: SvelteParse }).parse;
    } catch {
      // try the next location
    }
  }
  return null;
};

const toBlock = (content: string, node: SvelteScriptNode | null): ScriptBlock | undefined => {
  if (!node) return undefined;
  const openTag = content.slice(node.start, node.content.start);
  return {
    start: node.start,
    end: node.end,
    openTag,
    body: content.slice(node.content.start, node.content.end),
    attrs: openTag.slice("<script".length, -1),
  };
};

// Svelte parses <style> bodies as plain CSS regardless of lang, so SCSS
// (`//` comments, `$vars`) throws. Blank the bodies to equal-length whitespace
// (newlines kept) so AST offsets still index into the original content. Spans
// containing `<script` are left alone: blanking them could hide a real script.
const blankStyleBodies = (content: string): string =>
  content.replace(
    /(<style\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*?)(<\/style\s*>)/gi,
    (match, open: string, body: string, close: string) =>
      /<script\b/i.test(body) ? match : open + body.replace(/[^\n]/g, " ") + close,
  );

// Only retry with blanked styles when the plain parse fails, so layouts that
// already parse are handled exactly as before.
const parseLayout = (content: string, parse: SvelteParse): ReturnType<SvelteParse> => {
  try {
    return parse(content, { modern: true });
  } catch (error) {
    const blanked = blankStyleBodies(content);
    if (blanked === content) throw error;
    return parse(blanked, { modern: true });
  }
};

// Returns null when the file has no component script to merge into.
const mergeIntoExistingScript = (content: string, parse: SvelteParse): string | null => {
  const ast = parseLayout(content, parse);
  const instance = toBlock(content, ast.instance);
  const module = toBlock(content, ast.module);

  if (!instance) {
    if (!module) return null;
    // Only a module script: add a new instance script after it, same lang.
    const lang = module.attrs.match(/\blang\s*=\s*["'][^"']*["']/)?.[0];
    const indent = detectIndent(module.body, content);
    const block = [
      lang ? `<script ${lang}>` : "<script>",
      lensScriptImport(indent),
      lensOnMountCode(indent),
      "</script>",
    ].join("\n");
    return `${content.slice(0, module.end)}\n\n${block}${content.slice(module.end)}`;
  }

  // Imports are hoisted, so they can go right after the open tag; the existing
  // statements are kept as-is (no line-based import parsing).
  const body = instance.body.replace(/\s*$/, "");
  const indent = detectIndent(instance.body, content);
  const newBlock = [
    instance.openTag,
    lensScriptImport(indent),
    `${body.startsWith("\n") ? body.slice(1) : body}\n${lensOnMountCode(indent)}`,
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
      newContent: sveltekitLayoutFile(projectIndent(projectRoot), isTypeScriptProject(projectRoot)),
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

  const parse = loadSvelteParse(projectRoot);
  let merged: string | null;
  try {
    if (!parse) throw new Error("svelte/compiler not found");
    merged = mergeIntoExistingScript(originalContent, parse);
  } catch {
    return {
      success: false,
      filePath: layoutPath,
      message: `Could not parse ${layoutPath}. Add this to your root layout yourself:\n\n${SVELTEKIT_LAYOUT_BLOCK}`,
    };
  }
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
  const newContent = `${sveltekitLayoutBlock(
    detectIndent(originalContent),
    isTypeScriptProject(projectRoot),
  )}\n\n${originalContent}`;

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
