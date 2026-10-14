# svelte-lens

[![npm version](https://img.shields.io/npm/v/@gear-null/svelte-lens.svg)](https://www.npmjs.com/package/@gear-null/svelte-lens)
[![CI](https://github.com/squid-quarters/svelte-lens/actions/workflows/ci.yml/badge.svg)](https://github.com/squid-quarters/svelte-lens/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Provenance](https://img.shields.io/badge/npm-provenance-blue)](https://docs.npmjs.com/generating-provenance-statements)

**Hover any UI element, copy its source context for AI agents. Built for Svelte 5.**

svelte-lens gives your AI coding agent eyes inside your running app. Activate it, hover any DOM element, and press Cmd+C to copy the element's HTML preview and component source stack straight to your clipboard. Your agent gets precise, grounded context about what's on screen instead of guessing from file listings.

Inspired by [react-grab](https://github.com/aidenybai/react-grab) by [Aiden Bai](https://github.com/aidenybai) — the same "hover and copy" concept, adapted for Svelte 5 with source resolution via `__svelte_meta`, a plugin system, and built-in MCP + CLI.

## How it works

1. **Activate** — press `Cmd+Alt+G` (macOS) or `Ctrl+Alt+G` (Linux/Windows)
2. **Hover** — a shadow-DOM overlay highlights any element on the page
3. **Copy** — press `Cmd+C` / `Ctrl+C` to copy the element's context to your clipboard

The copied context includes:

- The element's rendered HTML preview
- The component source stack (file path, line number, component name) resolved via Svelte 5's `__svelte_meta` through [element-source](https://github.com/aidenybai/element-source)
- Any additional context injected by plugins

## Install

```bash
npm install @gear-null/svelte-lens
```

## Quick start

Add to your root layout and call `init()` in dev mode:

```svelte
<!-- +layout.svelte -->
<script lang="ts">
  import { dev } from "$app/environment";
  import { onMount } from "svelte";

  onMount(() => {
    if (dev) {
      void import("@gear-null/svelte-lens").then((m) => m.init());
    }
  });
</script>
```

Or use the CLI to scaffold it automatically:

```bash
npx @gear-null/svelte-lens init
```

## MCP server

Connect svelte-lens to your AI agent via the built-in MCP server (the `svelte-lens-mcp` bin):

```json
{
  "mcpServers": {
    "svelte-lens": {
      "command": "npx",
      "args": ["-y", "-p", "@gear-null/svelte-lens", "svelte-lens-mcp", "--stdio"]
    }
  }
}
```

Works with Claude Code, Cursor, Windsurf, and any MCP-compatible agent. Without `--stdio`, the server runs in HTTP mode only, at `http://127.0.0.1:5174/mcp` (change the port with `--port`).

The server exposes one tool, `get_element_context`, which returns the most recently submitted context once (it expires after 5 minutes). The browser lens does **not** send context to the server automatically — submit it with `POST http://127.0.0.1:5174/context` and a JSON body `{ "content": string[], "prompt"?: string }`. The endpoint only accepts requests from loopback origins (`localhost`, `127.x.x.x`, `::1`). For example, a plugin that forwards everything you copy:

```ts
api.registerPlugin({
  name: "mcp-bridge",
  hooks: {
    transformCopyContent: (content) => {
      void fetch("http://127.0.0.1:5174/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: [content] }),
      }).catch(() => {});
      return content;
    },
  },
});
```

## Keyboard shortcuts

| Action               | macOS       | Linux/Windows |
| -------------------- | ----------- | ------------- |
| Toggle on/off        | `Cmd+Alt+G` | `Ctrl+Alt+G`  |
| Deactivate           | `Escape`    | `Escape`      |
| Copy element context | `Cmd+C`     | `Ctrl+C`      |

## API

```ts
import { init } from "@gear-null/svelte-lens";

const api = init();

api.activate(); // Turn on the overlay
api.deactivate(); // Turn off and clean up
api.setEnabled(false); // Disable entirely
api.dispose(); // Tear down everything

// Plugin system — hooks live under `hooks`
api.registerPlugin({
  name: "my-plugin",
  hooks: {
    onActivate: () => {},
    onDeactivate: () => {},
    onBeforeCopy: (elements) => {},
    transformCopyContent: (content, elements) => {
      // Modify what gets copied to clipboard
      return content;
    },
    onAfterCopy: (elements, success) => {},
    onCopyError: (error) => {},
    onContextMenu: (element, position) => {},
  },
});
```

Hooks go under `hooks` (or in the `{ hooks }` object returned from `setup(api)`). Available hooks: `onActivate`, `onDeactivate`, `onElementSelect`, `onBeforeCopy`, `transformCopyContent`, `onAfterCopy`, `onCopyError`, `onContextMenu`.

Built-in plugins: `copyPlugin` (clipboard copy), `openPlugin` (open source in editor).

## Architecture

- **Shadow DOM overlay** — isolated from your app's styles, zero CSS leaks
- **Svelte 5 runes** — built with `$state`, `$derived`, `$props` throughout
- **Source resolution** — uses `__svelte_meta` via [element-source](https://github.com/aidenybai/element-source) to trace any element back to its component, file, and line
- **Plugin system** — extend copy behavior, add context menu actions, or transform content before it reaches the clipboard
- **CLI** — `npx @gear-null/svelte-lens init` auto-detects SvelteKit or Vite+Svelte and wires the import into your layout
- **MCP server** — HTTP + stdio transport; agents can read the latest context POSTed to its `/context` endpoint

## Acknowledgements

svelte-lens is a Svelte 5 port of [react-grab](https://github.com/aidenybai/react-grab) by [Aiden Bai](https://github.com/aidenybai). React-grab introduced the idea of hovering a UI element to grab its source context for AI agents — svelte-lens brings that same workflow to the Svelte ecosystem with Svelte 5-specific source resolution, a plugin architecture, and native MCP + CLI support.

## License

MIT
