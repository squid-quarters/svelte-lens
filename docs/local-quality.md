# Local commit quality contract

Use Node 24.22.1 (`.nvmrc`), Corepack’s pinned pnpm 9.15.0, Git, Docker,
and an installed Playwright Chromium matching the lockfile. Run
`pnpm --filter @svelte-lens/e2e-app exec playwright install chromium` once
if the browser is missing. Then run `pnpm quality:install` in this checkout.
The installer refuses existing hook managers or executable default hooks;
resolve that conflict explicitly instead of replacing them. Other linked
worktrees retain their hook configuration.

Every commit exports the exact staged Git tree into an owned temporary
worktree, without stashing or changing the source checkout. This includes
Git’s temporary index for path-only commits and `commit -a`. Raw Git blobs
avoid checkout-filter substitution; symlinks and submodules are rejected.
The staged runner and loader must match their working copies. Checks receive
a minimal environment without inherited credentials or Git index settings.
Tracked bytes, executable bits, both indexes and the original HEAD are
checked again before a pass. Cancellation discovers owned descendants by ancestry and the uniquely owned session, then revalidates each positive PID/start identity before signalling it. No group or name-based signal is sent. Cleanup removes only the gate’s temporary worktree.

The full sequence is recorded in `.local-quality.json`: frozen installation,
gate safety fixtures, formatting, lint, security, build, type checking, unit
tests, package/CLI/MCP validation, floor-Svelte browser tests, then latest-Svelte
browser tests. Browser tests use one worker, no retries and strict port 5174;
a running server on that port causes failure. They run headlessly. Normal
build-tool caches may be used; receipts never skip a gate invocation.

The latest-peer check deliberately changes only the app manifest and lockfile
inside the verified disposable snapshot. It resolves the registry version
once and installs that exact version, verifies the library remains at its
staged Svelte floor, builds and tests, then restores the two staged files.
The receipt records the resolved floor/latest versions and variant lockfile
SHA-256. The original staged tree must still match afterwards. This is a
compatibility variant, not a change to the committed dependency inputs.
The helper refuses ordinary clones and requires the gate-owned context.

Security uses the official Semgrep 1.180.0 image pinned by digest, checked-in
JavaScript/TypeScript rules and positive/negative rule fixtures. Docker runs
without networking and mounts source read-only. Strict scans reject findings,
parse errors and empty scans. The four rules cover dynamic evaluation, dynamic
shell commands, disabled TLS and URL-to-HTML injection; this is a bounded
static check, not a complete security assessment. Existing SECURITY_AUDIT.md
remains the record for application findings.

Fresh evidence is written under this worktree’s Git directory at
`local-quality/last.json`, including the staged tree, command results, tool
versions, external variant inputs and timestamps. Failed runs replace prior
success evidence. Receipts are local evidence, not signed attestations or
release authorization. Remote CI independently runs all six required checks
and latest-Svelte compatibility; it never accepts a local receipt as a pass.
Pull-request runs may cancel older runs, while main pushes keep distinct runs.

The gate and validation workflows have no deployment or publishing step.
The existing Version, Release and post-publish smoke workflows are unchanged:
a separate approved release remains necessary. Installing or passing this gate
does not authorize a changeset, version bump, npm publication or deployment.
No hooks are installed into another owner’s checkout by this change.
