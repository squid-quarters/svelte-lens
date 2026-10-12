---
"@gear-null/svelte-lens": patch
---

Fix the context-menu Copy action (previously a no-op), stale element detection after fast pointer moves and scrolls, plugin hook error isolation, `dispose()` cleanup, and implement `activationMode: "hold"`. Harden the MCP server against aborted uploads, orphaned `--stdio` processes and abandoned sessions. Make `svelte-lens init` transforms safe for multi-line imports, `$$props`, existing imports and `<script module>` blocks. Keep the context menu and selection label inside the viewport. Bump `@modelcontextprotocol/sdk` to ^1.31.0 for upstream security fixes.
