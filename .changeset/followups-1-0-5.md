---
"@gear-null/svelte-lens": patch
---

Fix follow-ups from 1.0.4 release testing:

- `get_element_context` frames page content with markers carrying a per-response id, so page content can no longer forge the end-of-untrusted-content marker.
- `activate()`, `deactivate()` and `setEnabled(false)` fire `onActivate`/`onDeactivate` only when the state actually changes.
- `setOptions({ key: undefined })` clears an earlier override, e.g. restoring the default activation key.
- The copied HTML preview includes the text of inline children such as links.
- `svelte-lens init` says "configured" rather than "installed" when the package was already a dependency.
- READMEs: the MCP bridge snippet is self-contained and compiles as pasted.
