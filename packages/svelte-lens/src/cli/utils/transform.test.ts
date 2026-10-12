import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyTransform, previewTransform } from "./transform.js";
import { VITE_SVELTE_IMPORT } from "./templates.js";

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
});
