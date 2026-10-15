---
"@gear-null/svelte-lens": patch
---

Fix the overlay crashing on Svelte 5.56.x (the declared peer floor): the package is now built against its minimum supported Svelte, and a package test verifies every Svelte internal used by `dist` exists in that version. `svelte-lens init` and the README quick start now gate on `import.meta.env.DEV` instead of `$app/environment` (deprecated in SvelteKit 3 and missing from its types), match the layout's indentation (tabs in `sv create` projects), and create or document complete Svelte 5 layouts that render `{@render children()}`. The MCP server now reports the real package version in `serverInfo`.
