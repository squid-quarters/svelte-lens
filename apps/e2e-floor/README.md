# Consumer floor compatibility fixture

This private, loopback-only test fixture uses Kit 3.2.0, adapter-auto 8.0.1 and exactly Svelte 5.57.1 (Kit 3’s peer floor).
Thin route wrappers share the Kit 3 harness’s page, layout, components and browser tests.
Additional fixture-only routes exercise the two Kit advisories directly. Its Vite
plugin asserts that both the shared application entry and built Lens resolve
the consumer runtime at the Kit 3’s Svelte peer floor. The normal harness and
latest-peer variant continue to test Kit 3. `../e2e-kit2-floor` retains Kit 2 /
Svelte 5.56.3 coverage instead of silently replacing that support contract.

Run `pnpm --filter @svelte-lens/e2e-floor test:e2e --workers=1 --retries=0`.
The dedicated build and check run only in this compatibility stage, not every
root Turbo build. This fixture is never published or deployed; it is separate from the legacy Kit 2 fixture.

The cache-header probe parses actual prerendered HTML. The enhanced-form probe
uses a real catch-all path beginning with `//`, verifies successful local form
updates and preserves a normal server redirect. Metadata inspection routes also
test the explicit development-only client-rendering workaround; a separate HTTP
preview check verifies production SSR for both harnesses.
