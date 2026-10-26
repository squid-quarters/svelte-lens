# @gear-null/svelte-lens

## 1.0.6

### Patch Changes

- [#63](https://github.com/squid-quarters/svelte-lens/pull/63) [`4e57049`](https://github.com/squid-quarters/svelte-lens/commit/4e57049905d29470d6e430ff8f17946e5484a147) Thanks [@DoisKoh](https://github.com/DoisKoh)! - Fix follow-ups from 1.0.5 release testing:

  - A repeat `init()` returns a handle to the running instance instead of an API that silently does nothing, so plugins registered through it take effect. Its `dispose()` removes only those plugins, and it warns if options are passed, since they're ignored.
  - The copied HTML preview notes block children it leaves out when the element also has text, e.g. `<a>Sub (+1 children)</a>`.
  - `svelte-lens init` uses `<script lang="ts">` in TypeScript projects, both when it creates `+layout.svelte` and when it adds a script to a layout without one. A newly created layout uses the project's indentation.

- [#65](https://github.com/squid-quarters/svelte-lens/pull/65) [`60ddcc9`](https://github.com/squid-quarters/svelte-lens/commit/60ddcc9ba2fdc1e7db875d702fb3ff6208488c9b) Thanks [@DoisKoh](https://github.com/DoisKoh)! - Make repeat `init()` calls safe in any mount order. Every `init()` now returns its own handle onto one shared instance, and svelte-lens keeps running until every handle has been disposed. Previously, on a hard page load, a page component's `init()` (Svelte runs a child's `onMount` before its root layout's) became the owner, and the component's cleanup shut svelte-lens down app-wide. A handle's `dispose()` also restores any plugin, such as a built-in, that its plugins had replaced. `window.__SVELTE_LENS__` is now the shared instance rather than the first caller's handle. The README API examples can be pasted as-is.

## 1.0.5

### Patch Changes

- [#58](https://github.com/squid-quarters/svelte-lens/pull/58) [`508de6d`](https://github.com/squid-quarters/svelte-lens/commit/508de6d3d7ee9a9eee34bde79fa4d135afedb6c2) Thanks [@DoisKoh](https://github.com/DoisKoh)! - Fix follow-ups from 1.0.4 release testing:

  - `get_element_context` frames page content with markers carrying a per-response id, so page content can no longer forge the end-of-untrusted-content marker.
  - `activate()`, `deactivate()` and `setEnabled(false)` fire `onActivate`/`onDeactivate` only when the state actually changes.
  - `setOptions({ key: undefined })` clears an earlier override, e.g. restoring the default activation key.
  - The copied HTML preview includes the text of inline children such as links.
  - `svelte-lens init` says "configured" rather than "installed" when the package was already a dependency.
  - READMEs: the MCP bridge snippet is self-contained and compiles as pasted.

## 1.0.4

### Patch Changes

- [#54](https://github.com/squid-quarters/svelte-lens/pull/54) [`cbb1e60`](https://github.com/squid-quarters/svelte-lens/commit/cbb1e606d12b3ba7674c2417a32c4e2d934c874a) Thanks [@DoisKoh](https://github.com/DoisKoh)! - Fix follow-ups from 1.0.3 release testing:

  - Custom `activationKey` letters with Alt/Option now match on macOS, where Option changes the typed glyph.
  - A disposed instance can no longer be re-activated or re-enabled, and disposing it again leaves a newer instance untouched.
  - An open context menu is re-clamped into the viewport when the window shrinks.
  - `svelte-lens-mcp --stdio`: if the context server can't listen (e.g. port 5174 is taken), `get_element_context` now reports that instead of "No context has been submitted yet".
  - `svelte-lens init` uses the invoking package manager (e.g. `pnpm dlx`) when the project has no lockfile.
  - SvelteKit route components are labelled after their file (`+page`, `+layout`) instead of `Component`, and copied stacks omit `node_modules`/`.svelte-kit` frames.
  - `init --skip-install` no longer claims the package was installed and prints the install command instead.
  - Package README: added the MCP bridge plugin snippet and a compilable API example.

## 1.0.3

### Patch Changes

- [#44](https://github.com/squid-quarters/svelte-lens/pull/44) [`80d1d0b`](https://github.com/squid-quarters/svelte-lens/commit/80d1d0ba36567cc95afd25fe3a6936c426da7ff0) Thanks [@DoisKoh](https://github.com/DoisKoh)! - Fix the overlay crashing on Svelte 5.56.x (the declared peer floor): the package is now built against its minimum supported Svelte, and a package test verifies every Svelte internal used by `dist` exists in that version. `svelte-lens init` and the README quick start now gate on `import.meta.env.DEV` instead of `$app/environment` (deprecated in SvelteKit 3 and missing from its types), match the layout's indentation (tabs in `sv create` projects), and create or document complete Svelte 5 layouts that render `{@render children()}`. The MCP server now reports the real package version in `serverInfo`.

## 1.0.2

### Patch Changes

- [#41](https://github.com/squid-quarters/svelte-lens/pull/41) [`e03ec17`](https://github.com/squid-quarters/svelte-lens/commit/e03ec17686168ee6699f4091910046ecca037a91) Thanks [@DoisKoh](https://github.com/DoisKoh)! - Fix the context-menu Copy action (previously a no-op), stale element detection after fast pointer moves and scrolls, plugin hook error isolation, `dispose()` cleanup, and implement `activationMode: "hold"`. Harden the MCP server against aborted uploads, orphaned `--stdio` processes and abandoned sessions. Make `svelte-lens init` transforms safe for multi-line imports, `$$props`, existing imports and `<script module>` blocks, using Svelte's parser to find the layout's component script. Keep the context menu and selection label inside the viewport. Bump `@modelcontextprotocol/sdk` to ^1.32.1 for upstream security fixes.

## 1.0.1

### Patch Changes

- [#23](https://github.com/gear-null/svelte-lens/pull/23) [`1782246`](https://github.com/gear-null/svelte-lens/commit/17822463bcfe25e37283732438d63d62c91e0d3a) Thanks [@DoisKoh](https://github.com/DoisKoh)! - Security hardening release. This is the first release published from CI with an npm provenance attestation.
  - `init()` must now be called explicitly; importing the package no longer auto-initializes. Migration: `import("@gear-null/svelte-lens").then((m) => m.init())` (the CLI generates this pattern).
  - `init()` is a no-op in production builds unless `window.__SVELTE_LENS_FORCE_ENABLE__ = true` is set, preventing the inspector from shipping to end users when misconfigured.
  - `window.__SVELTE_LENS__` is locked against overwrite by third-party scripts; the `svelte-lens:init` event only fires from explicit `init()`.
  - HTML previews escape `&`, `"`, `<`, `>`; `setOptions()` filters prototype-pollution keys.
  - MCP server: loopback-only origin checks, 1 MiB body limit, session cap with leak-free lifecycle, and untrusted-content framing of page-derived context passed to agents.
  - CLI templates and detection use the scoped `@gear-null/svelte-lens` package name; custom `activationKey` option is wired through with exact modifier matching.

## 1.0.0

### Major Changes

- [`b318a82`](https://github.com/gear-null/svelte-lens/commit/b318a82cc20944bfc3543771c68699ff089d8599) Thanks [@DoisKoh](https://github.com/DoisKoh)! - Initial v1.0.0 release of svelte-lens
  - Core library: hover any Svelte 5 UI element, copy source context for AI agents
  - Shadow-DOM overlay with selection highlight, element label, toolbar
  - Cmd+Alt+G activation toggle, Escape to deactivate
  - Cmd+C copies element context (HTML preview + source stack)
  - Source resolution via element-source + Svelte 5 `__svelte_meta`
  - Plugin system with 8 hooks (onActivate, onDeactivate, onElementSelect, onBeforeCopy, transformCopyContent, onAfterCopy, onCopyError, onContextMenu)
  - Built-in copy and open plugins
  - CLI for SvelteKit/Vite-Svelte project setup
  - MCP server with HTTP + stdio transport for AI agent integration
