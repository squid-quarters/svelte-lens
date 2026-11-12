---
"@gear-null/svelte-lens": patch
---

Make disposed handles inert, cancel their pending copy continuations, and prevent
reentrant plugin setup or cleanup from leaking registrations. Preserve context-menu
action order when replacing plugins, refresh surviving highlight geometry after DOM
changes, and document initialization after component mount.
Copy all elements supplied to the existing array API through one copy pipeline.
