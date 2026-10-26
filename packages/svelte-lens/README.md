# @gear-null/svelte-lens

Hover any UI element in your browser, copy its source context for AI agents. Built for Svelte 5. Includes CLI and MCP server.

## Install

```bash
npm install @gear-null/svelte-lens
```

## Quick Start

In your root layout (`src/routes/+layout.svelte`):

```svelte
<script>
  import { onMount } from "svelte";

  let { children } = $props();

  onMount(() => {
    if (import.meta.env.DEV) import("@gear-null/svelte-lens").then((m) => m.init());
  });
</script>

{@render children()}
```

`import.meta.env.DEV` is replaced at build time, so production builds drop svelte-lens entirely.

## CLI

```bash
npx @gear-null/svelte-lens init
```

Detects SvelteKit and Vite+Svelte projects, and wires svelte-lens into your `+layout.svelte` automatically.

## MCP Server

For AI agent integration (Claude Code, Cursor, Windsurf):

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

Or run directly: `npx -y -p @gear-null/svelte-lens svelte-lens-mcp` (HTTP mode on `127.0.0.1:5174`; add `--stdio` for stdio transport).

The lens does not send context to the MCP server automatically. Submit it with `POST http://127.0.0.1:5174/context` (JSON body `{ "content": string[], "prompt"?: string }`, loopback origins only). Agents read it with the `get_element_context` tool. For example, a plugin that forwards everything you copy:

```ts
// In your root layout's onMount, alongside or instead of the Quick Start code:
if (import.meta.env.DEV) {
  import("@gear-null/svelte-lens").then((m) => {
    m.init(); // a handle onto the running instance if there is one
    m.registerPlugin({
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
  });
}
```

With `--stdio`, the server still listens on port 5174 for `/context`. If that port is taken (often by another `svelte-lens-mcp`), `get_element_context` returns an error saying so.

## Features

- **Hover-to-select** — shadow-DOM overlay highlights any element
- **Cmd/Ctrl+C to copy** — copies HTML preview + source stack to clipboard
- **Source resolution** — uses `__svelte_meta` via [element-source](https://github.com/aidenybai/element-source) to pinpoint component/file/line
- **Plugin system** — 8 hooks: `onActivate`, `onDeactivate`, `onElementSelect`, `onBeforeCopy`, `transformCopyContent`, `onAfterCopy`, `onCopyError`, `onContextMenu`
- **CLI** — `npx @gear-null/svelte-lens init` to scaffold into SvelteKit or Vite-Svelte projects
- **MCP server** — expose context POSTed to `/context` to AI coding agents

## Activation

- **Toggle**: `Cmd+Alt+G` (macOS) / `Ctrl+Alt+G` (Windows/Linux)
- **Deactivate**: `Escape`
- **Copy**: `Cmd+C` / `Ctrl+C` while hovering

## API

```ts
import { init } from "@gear-null/svelte-lens";

const api = init();

api.registerPlugin({
  name: "my-plugin",
  hooks: {
    onAfterCopy: (elements, success) => console.log("copied", elements, success),
  },
});

// Other methods (a reference; they act on the shared instance):
// api.activate()          turn the overlay on
// api.deactivate()        turn it off
// api.setEnabled(false)   disable svelte-lens for every caller until setEnabled(true)
// api.dispose()           release this handle and the plugins registered through it
```

Each `init()` call returns its own handle onto one shared instance, so any component can call it, in any mount order. svelte-lens keeps running until every handle has been disposed. A handle's `dispose()` removes the plugins registered through it and restores any plugin they had replaced. `window.__SVELTE_LENS__` is the shared instance itself, and its `dispose()` tears everything down.

## License

MIT
