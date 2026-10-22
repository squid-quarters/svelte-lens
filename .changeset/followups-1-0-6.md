---
"@gear-null/svelte-lens": patch
---

Fix follow-ups from 1.0.5 release testing:

- A repeat `init()` returns the running instance instead of an API that silently does nothing, so plugins registered on it take effect. It warns if options are passed, since they're ignored.
- The copied HTML preview notes block children it leaves out when the element also has text, e.g. `<a>Sub (+1 children)</a>`.
- `svelte-lens init` creates `+layout.svelte` with `<script lang="ts">` in TypeScript projects and in the project's indentation.
