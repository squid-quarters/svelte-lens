# @gear-null/svelte-lens

Hover any UI element in your browser, copy its source context for AI agents. Built for Svelte 5. Includes CLI and MCP server.

## Install

```bash
npm install @gear-null/svelte-lens
```

## Quick Start

```svelte
<script>
  import { dev } from "$app/environment";
  import { onMount } from "svelte";
  import { init } from "@gear-null/svelte-lens";

  onMount(() => {
    if (dev) init();
  });
</script>
```

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

The lens does not send context to the MCP server automatically. Submit it with `POST http://127.0.0.1:5174/context` (JSON body `{ "content": string[], "prompt"?: string }`, loopback origins only), for example from a plugin's `transformCopyContent` hook. Agents read it with the `get_element_context` tool.

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

api.activate();
api.deactivate();
api.registerPlugin({ name: "my-plugin", hooks: { ... } });
api.setEnabled(false);
api.dispose();
```

## License

MIT
