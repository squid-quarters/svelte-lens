---
"@gear-null/svelte-lens": patch
---

Make repeat `init()` calls safe in any mount order. Every `init()` now returns its own handle onto one shared instance, and svelte-lens keeps running until every handle has been disposed. Previously, on a hard page load, a page component's `init()` (Svelte runs a child's `onMount` before its root layout's) became the owner, and the component's cleanup shut svelte-lens down app-wide. A handle's `dispose()` also restores any plugin, such as a built-in, that its plugins had replaced. `window.__SVELTE_LENS__` is now the shared instance rather than the first caller's handle. The README API examples can be pasted as-is.
