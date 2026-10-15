// `import.meta.env.DEV`, not `$app/environment`: SvelteKit 3 deprecated that
// module and dropped it from its types. Vite statically replaces
// `import.meta.env.DEV` on Kit 2, Kit 3 and plain Vite, so production builds
// drop the dynamic import entirely.
const LENS_INIT = `if (import.meta.env.DEV) import("@gear-null/svelte-lens").then((m) => m.init());`;

export const sveltekitLayoutBlock = (indent = "  "): string =>
  [
    "<script>",
    `${indent}import { onMount } from "svelte";`,
    "",
    `${indent}onMount(() => {`,
    `${indent}${indent}${LENS_INIT}`,
    `${indent}});`,
    "</script>",
  ].join("\n");

export const SVELTEKIT_LAYOUT_BLOCK = sveltekitLayoutBlock();

// A complete Svelte 5 root layout, for projects that have none yet.
export const SVELTEKIT_LAYOUT_FILE = [
  "<script>",
  '  import { onMount } from "svelte";',
  "",
  "  let { children } = $props();",
  "",
  "  onMount(() => {",
  `    ${LENS_INIT}`,
  "  });",
  "</script>",
  "",
  "{@render children()}",
  "",
].join("\n");

// Aliased binding so merged code can't collide with (or depend on) the user's
// own `onMount` import. Duplicate imports are valid ES.
export const lensScriptImport = (indent: string): string =>
  `${indent}import { onMount as __lensOnMount } from "svelte";`;

export const lensOnMountCode = (indent: string): string =>
  ["", `${indent}__lensOnMount(() => {`, `${indent}${indent}${LENS_INIT}`, `${indent}});`].join(
    "\n",
  );

export const VITE_SVELTE_IMPORT = `if (import.meta.env.DEV) {\n  import("@gear-null/svelte-lens").then((m) => m.init());\n}`;
