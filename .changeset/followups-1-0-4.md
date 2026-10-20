---
"@gear-null/svelte-lens": patch
---

Fix follow-ups from 1.0.3 release testing:

- Custom `activationKey` letters with Alt/Option now match on macOS, where Option changes the typed glyph.
- A disposed instance can no longer be re-activated or re-enabled, and disposing it again leaves a newer instance untouched.
- An open context menu is re-clamped into the viewport when the window shrinks.
- `svelte-lens-mcp --stdio`: if the context server can't listen (e.g. port 5174 is taken), `get_element_context` now reports that instead of "No context has been submitted yet".
- `svelte-lens init` uses the invoking package manager (e.g. `pnpm dlx`) when the project has no lockfile.
- SvelteKit route components are labelled after their file (`+page`, `+layout`) instead of `Component`, and copied stacks omit `node_modules`/`.svelte-kit` frames.
- `init --skip-install` no longer claims the package was installed and prints the install command instead.
- Package README: added the MCP bridge plugin snippet and a compilable API example.
