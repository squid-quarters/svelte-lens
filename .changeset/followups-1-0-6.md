---
"@gear-null/svelte-lens": patch
---

Fix follow-ups from 1.0.5 release testing:

- A repeat `init()` returns a handle to the running instance instead of an API that silently does nothing, so plugins registered through it take effect. Its `dispose()` removes only those plugins, and it warns if options are passed, since they're ignored.
- The copied HTML preview notes block children it leaves out when the element also has text, e.g. `<a>Sub (+1 children)</a>`.
- `svelte-lens init` uses `<script lang="ts">` in TypeScript projects, both when it creates `+layout.svelte` and when it adds a script to a layout without one. A newly created layout uses the project's indentation.
