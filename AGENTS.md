# AGENTS.md — svelte-lens

## Org conventions

<https://github.com/gear-null/.github/blob/main/AGENTS.md> is the
cross-repo source of truth. Key rules reproduced here for locality:

### Branching

GitHub Flow: `main` is the canonical branch. Cut feature branches from
`main`; PRs target `main`. Use `type/short-description` branch names
(`feat/…`, `fix/…`, etc.).

### Commits

Conventional Commits: `type(scope): description`.

### Pull requests

All changes land via PR — never commit directly to `main`. Keep PRs
scoped to one logical change. PRs are lightweight: a short description
of intent and key design decisions is sufficient — no template required.

### Verify before commit

Run every check the repo configures — lint, type-check, build, and
tests — and make them all pass. Do not skip checks or bypass hooks
(`--no-verify`, etc.) to push past failures; fix the underlying issue.

### Agent autonomy & pre-merge review

When working at high autonomy, every PR you cut MUST pass an
agent-driven pre-merge review loop before it's presented to a developer:

1. Author the change on a feature branch; run all checks green.
2. Spawn separate agent code reviews — as many as the change warrants
   (parallel specialists across code, tests, behavior).
3. Analyze every review's findings; fix all important issues on the
   same branch.
4. Re-run all tests and checks after the fixes.
5. Repeat steps 2–4 iteratively until a review pass surfaces no
   important issues.
6. Only then present the work back to the developer for review.

CI green is necessary but not sufficient — the review loop catches what
CI and self-review miss. Do not surface a PR for human review mid-loop.

### Tracked work

Track this local-gate rollout in the existing human-owned Paperclip GEA-64.
Do not create a duplicate GitHub issue or assign a Paperclip agent. Other
non-trivial work should use its established human-owned tracker.

### Defaults

- Stay in scope. No files created unless asked, no refactors, and no
  speculative error handling beyond the task.

---

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

Publishing is a **two-step, human-gated** process. The Version PR bumps
package versions; creating a GitHub Release is the explicit publish
trigger. AI agents may cut releases by following this procedure:

#### Step 1 — Create a changeset and bump versions

1. Run `pnpm changeset`. Choose `patch` | `minor` | `major` and write a
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
