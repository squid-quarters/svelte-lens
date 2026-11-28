# AGENTS.md — svelte-lens

Read the [adopted common review and integration rules](https://github.com/squid-quarters/.github/blob/9efdabfe3ffe356c9bd82f7f8ef0a71ef0531b7b/REVIEW.md) before working on changes. Apply the local rules below.

Project work uses the common tier. The npm package uses the public installed-tool
delivery gates. Routine PRs target `main`. Use GitHub Issues for new non-trivial
work. GEA-64 is the historical gate rollout.

## Project-specific conventions

### Monorepo layout

```
packages/svelte-lens/     → @gear-null/svelte-lens (npm package)
  src/
    index.ts              → main library entry (init, plugins, API)
    mcp/                  → MCP server (stdio + HTTP)
    cli/                  → CLI (svelte-lens init, detect)
apps/e2e-app/             → Playwright E2E test harness
```

### Key commands

```bash
pnpm install --frozen-lockfile   # install (CI uses --ignore-scripts too)
pnpm build                       # build all packages
pnpm test                        # unit tests (vitest)
pnpm typecheck                   # svelte-check
pnpm format:check                # prettier
pnpm --filter @svelte-lens/e2e-app test:e2e   # E2E
```

### Full local commit gate

Install this checkout’s gate with `pnpm quality:install`, using Node from
`.nvmrc` and the pinned package manager. Every commit runs the full staged
snapshot through [the local quality contract](docs/local-quality.md).
Do not bypass the hook or substitute a pre-push check. Installation is
per checkout; merging this file does not install hooks in other checkouts.

### Security posture

This package is intended for enterprise use. All security audit findings
are tracked in `SECURITY_AUDIT.md`. Changes touching MCP, CLI, plugin
system, or the browser runtime must be reviewed with extra care for:

- Injection vectors (CWE-77/78/79)
- Supply-chain risks (CWE-426/829)
- Prototype pollution (CWE-1321)
- Cross-origin / CORS issues

### Release workflow

The Version PR bumps package versions. Publishing a GitHub Release triggers
npm publication, as does the emergency workflow dispatch. Obtain Dois's
authorization before either publish action. Verify the release candidate via
the consumer install path and record recovery before publication.

#### Step 1 — Create a changeset and bump versions

1. For shipping changes, run `pnpm changeset`. Docs-only PRs can use the
   exemption in the PR template. Choose `patch` | `minor` | `major` and write a
   summary. This creates a markdown file under `.changeset/`.
2. Commit the changeset file and push to `main` (via PR).
3. The `version.yml` workflow picks up the changeset and opens/updates
   the **Version PR** titled "chore: version packages".
4. Review and **merge the Version PR**. This bumps `package.json`
   versions and consumes the changeset file. Do NOT skip this step —
   the publish workflow verifies that `package.json` matches the
   release tag.

#### Step 2 — Create a GitHub Release to trigger publishing

1. Read the new version from `packages/svelte-lens/package.json`.
2. Create a GitHub Release with:
   - **Tag**: `@gear-null/svelte-lens@VERSION` (e.g.
     `@gear-null/svelte-lens@1.0.1`)
   - **Title**: same as the tag
   - **Body**: changelog summary (copy from `CHANGELOG.md` or the
     Version PR description)
3. The `release.yml` workflow triggers automatically:
   - Verifies `package.json` version matches the tag
   - Builds the package
   - Publishes to npm with OIDC provenance
4. The `smoke-test.yml` workflow runs post-publish verification.

#### CLI cheat sheet

```bash
# Step 1: create changeset, push, merge Version PR
pnpm changeset
git add .changeset/ && git commit -m "chore: add changeset"
# ... push, wait for Version PR, merge it ...

# Step 2: create GitHub Release (the publish trigger)
VERSION=$(node -p "require('./packages/svelte-lens/package.json').version")
gh release create "@gear-null/svelte-lens@$VERSION" \
  --title "@gear-null/svelte-lens@$VERSION" \
  --notes "See CHANGELOG.md for details."
```

#### Safety checks

- `release.yml` will **fail** if `package.json` version doesn't match
  the release tag (prevents publishing stale code).
- `smoke-test.yml` runs after every publish and will catch broken
  packages.
- Provenance attestation is generated automatically via OIDC — consumers
  can verify the package was built from this repository's CI.
- `workflow_dispatch` with a `version` input is available for emergency
  manual publishes (requires `NPM_TOKEN` secret).

### Agent context

`AGENTS.md` is the cross-tool source of truth for agent context.
`CLAUDE.md` is a one-line `@AGENTS.md` import. Edit `AGENTS.md` — never
`CLAUDE.md` directly.
