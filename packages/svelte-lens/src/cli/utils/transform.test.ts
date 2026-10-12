import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "svelte/compiler";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyTransform, previewTransform } from "./transform.js";
import { SVELTEKIT_LAYOUT_BLOCK, VITE_SVELTE_IMPORT } from "./templates.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "svelte-lens-transform-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const writeLayout = (content: string) => {
  mkdirSync(join(root, "src/routes"), { recursive: true });
  writeFileSync(join(root, "src/routes/+layout.svelte"), content);
};

const mergeLayout = (content: string): string => {
  writeLayout(content);
  const result = previewTransform(root, "sveltekit");
  expect(result.success).toBe(true);
  expect(result.noChanges).toBeFalsy();
  return result.newContent ?? "";
};

const scripts = (content: string): string[] =>
  [...content.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");

const LENS_IMPORTS = `  import { dev as __lensDev } from "$app/environment";
  import { onMount as __lensOnMount } from "svelte";
`;

const expectWired = (script: string) => {
  expect(script).toContain('import { dev as __lensDev } from "$app/environment";');
  expect(script).toContain('import { onMount as __lensOnMount } from "svelte";');
  expect(script).toContain(
    '__lensOnMount(() => {\n    if (__lensDev) import("@gear-null/svelte-lens")',
  );
};

describe("previewTransform (sveltekit merge)", () => {
  it("keeps multi-line imports intact", () => {
    const input = `<script lang="ts">
  import {
    page,
    navigating
  } from "$app/state";
  import { tick } from "svelte";

  let { children } = $props();
</script>

{@render children()}
`;
    const out = mergeLayout(input);
    expect(out).toContain(`  import {
    page,
    navigating
  } from "$app/state";
  import { tick } from "svelte";

  let { children } = $props();`);
    expectWired(scripts(out)[0] ?? "");
    expect(out.endsWith("</script>\n\n{@render children()}\n")).toBe(true);
  });

  it("imports its own bindings when svelte / $app/environment are already imported", () => {
    const out = mergeLayout(`<script>
  import { browser } from "$app/environment";
  import { tick } from "svelte";
</script>
`);
    const script = scripts(out)[0] ?? "";
    expect(script).toContain('import { browser } from "$app/environment";');
    expect(script).toContain('import { tick } from "svelte";');
    expectWired(script);
  });

  it("does not collide with the user's own dev / onMount imports", () => {
    const out = mergeLayout(`<script>
  import { dev } from "$app/environment";
  import { onMount } from "svelte";
  onMount(() => console.log(dev));
</script>
`);
    const script = scripts(out)[0] ?? "";
    expect(script.match(/import \{ dev \}/g)).toHaveLength(1);
    expect(script.match(/import \{ onMount \}/g)).toHaveLength(1);
    expectWired(script);
  });

  it("does not expand $ replacement patterns in the existing script", () => {
    const out = mergeLayout(`<script>
  const p = $$props;
  const r = $$restProps;
  const s = $$slots;
  const re = "a".replace(/a/, "$&$\`$'");
</script>
`);
    expect(out).toContain("const p = $$props;");
    expect(out).toContain("const r = $$restProps;");
    expect(out).toContain("const s = $$slots;");
    expect(out).toContain(`"$&$\`$'"`);
  });

  it.each([
    ['<script module lang="ts">', '<script lang="ts">'],
    ['<script context="module" lang="ts">', '<script lang="ts">'],
  ])("targets the instance script, not %s", (moduleTag, instanceTag) => {
    const out = mergeLayout(`${moduleTag}
  export const prerender = true;
</script>

${instanceTag}
  let { children } = $props();
</script>
`);
    const [moduleScript, instanceScript] = scripts(out);
    expect(moduleScript).toBe("\n  export const prerender = true;\n");
    expectWired(instanceScript ?? "");
    expect(out.startsWith(moduleTag)).toBe(true);
  });

  it("merges after a script open tag whose quoted attribute contains '>'", () => {
    const openTag = '<script lang="ts" generics="T extends Record<string, unknown>">';
    const out = mergeLayout(`${openTag}
  let { children } = $props();
</script>
`);
    expect(out.startsWith(`${openTag}\n${LENS_IMPORTS}`)).toBe(true);
    const script = out.slice(openTag.length, out.indexOf("</script>"));
    expect(script).toContain("let { children } = $props();");
    expectWired(script);
  });

  it("adds an instance script when only a module script exists", () => {
    const out = mergeLayout(`<script module lang="ts">
  export const prerender = true;
</script>

<slot />
`);
    const [moduleScript, instanceScript] = scripts(out);
    expect(moduleScript).toBe("\n  export const prerender = true;\n");
    expect(out).toMatch(/<\/script>\n\n<script lang="ts">\n/);
    expectWired(instanceScript ?? "");
    expect(out.endsWith("<slot />\n")).toBe(true);
  });

  it("prepends a new script instead of merging into a <svelte:head> JSON-LD script", () => {
    const head = `<svelte:head>
  <script type="application/ld+json">{"@context":"https://schema.org"}</script>
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>
</svelte:head>
<slot />
`;
    const out = mergeLayout(head);
    expect(out.endsWith(head)).toBe(true);
    expect(out.startsWith(`${SVELTEKIT_LAYOUT_BLOCK}\n\n`)).toBe(true);
  });

  it("skips <script> in markup when the layout also has an instance script", () => {
    const out = mergeLayout(`<svelte:head>
  <script>window.dataLayer = [];</script>
</svelte:head>
<script type="text/javascript">
  let x = 1;
</script>
`);
    expect(out).toContain("<script>window.dataLayer = [];</script>");
    expectWired(scripts(out)[1] ?? "");
  });

  it("ignores a <script> mention inside an HTML comment", () => {
    const out = mergeLayout(`<!-- <script> tags go below -->
<script>
  let x = 1;
</script>
`);
    expect(out.startsWith("<!-- <script> tags go below -->\n<script>\n")).toBe(true);
    const instance = out.slice(out.indexOf("-->") + 3);
    expectWired(scripts(instance)[0] ?? "");
    expect(scripts(instance)[0]).toContain("let x = 1;");
  });

  it.each([
    ["a <svelte:head> mentioned in a script comment", "  // title is set in <svelte:head> below"],
    ["a <!-- inside a script string", '  const isComment = (h: string) => h.startsWith("<!--");'],
  ])("merges into the instance script despite %s", (_, line) => {
    const input = `<script lang="ts">
${line}
  let { children } = $props();
</script>
<!-- nav -->
<svelte:head><title>x</title></svelte:head>
{@render children()}
`;
    const out = mergeLayout(input);
    expect(out.startsWith('<script lang="ts">\n')).toBe(true);
    const all = scripts(out);
    expect(all).toHaveLength(1);
    expect(all[0]).toContain(line);
    expectWired(all[0] ?? "");
    expect(
      out.endsWith(
        "<!-- nav -->\n<svelte:head><title>x</title></svelte:head>\n{@render children()}\n",
      ),
    ).toBe(true);
  });

  it("prepends a new script instead of merging into an {@html} <script> string", () => {
    const markup =
      "<slot />\n\n{@html `<script>window.dataLayer = window.dataLayer || [];</script>`}\n";
    const out = mergeLayout(markup);
    expect(out).toBe(`${SVELTEKIT_LAYOUT_BLOCK}\n\n${markup}`);
    expect(() => compile(out, { filename: "+layout.svelte" })).not.toThrow();
  });

  it.each([
    ["a string expression", '<p>hi</p>\n<code>{"<script>"}</code>\n'],
    ["an {@html} string", "{@html '<script>x</script>'}\n"],
  ])("merges into the instance script after <script> text in %s", (_, before) => {
    const instance = "<script>\n  let { children } = $props();\n</script>\n{@render children()}\n";
    const out = mergeLayout(`${before}${instance}`);
    expect(out.startsWith(before)).toBe(true);
    const merged = out.slice(before.length);
    expect(merged.startsWith(`<script>\n${LENS_IMPORTS}`)).toBe(true);
    expectWired(scripts(merged)[0] ?? "");
    expect(() => compile(out, { filename: "+layout.svelte" })).not.toThrow();
  });

  it("fails with manual instructions when the layout cannot be parsed", () => {
    writeLayout("<script>\n  let x = ;\n</script>\n");
    const result = previewTransform(root, "sveltekit");
    expect(result.success).toBe(false);
    expect(result.message).toContain(SVELTEKIT_LAYOUT_BLOCK);
  });

  it("rewrites a deprecated unscoped svelte-lens import instead of treating it as wired", () => {
    const legacy = `<script>
  import { onMount } from "svelte";
  onMount(() => import("svelte-lens").then((m) => m.init()));
</script>
`;
    writeLayout(legacy);
    const result = previewTransform(root, "sveltekit");
    expect(result.noChanges).toBeFalsy();
    expect(result.newContent).toBe(legacy.replace('"svelte-lens"', '"@gear-null/svelte-lens"'));
    applyTransform(result);
    expect(previewTransform(root, "sveltekit").noChanges).toBe(true);
  });

  it("is idempotent under --force", () => {
    writeLayout(`<script>
  let x = 1;
</script>
`);
    applyTransform(previewTransform(root, "sveltekit", true));
    const once = readFileSync(join(root, "src/routes/+layout.svelte"), "utf-8");
    const second = previewTransform(root, "sveltekit", true);
    expect(second.noChanges).toBe(true);
    applyTransform(second);
    expect(readFileSync(join(root, "src/routes/+layout.svelte"), "utf-8")).toBe(once);
  });
});

describe("previewTransform (vite-svelte)", () => {
  it("does not duplicate the init block under --force", () => {
    mkdirSync(join(root, "src"), { recursive: true });
    const entry = join(root, "src/main.ts");
    writeFileSync(entry, 'import App from "./App.svelte";\n');
    applyTransform(previewTransform(root, "vite-svelte", true));
    applyTransform(previewTransform(root, "vite-svelte", true));
    const content = readFileSync(entry, "utf-8");
    expect(content.split(VITE_SVELTE_IMPORT)).toHaveLength(2);
  });

  it("rewrites a deprecated unscoped svelte-lens import", () => {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/main.ts"), 'import("svelte-lens").then((m) => m.init());\n');
    const result = previewTransform(root, "vite-svelte");
    expect(result.newContent).toBe('import("@gear-null/svelte-lens").then((m) => m.init());\n');
  });
});
