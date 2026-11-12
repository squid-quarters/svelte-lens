# Consumer floor compatibility fixture

This private, loopback-only test fixture uses Kit 2 and exactly Svelte 5.56.3.
Thin route wrappers share the Kit 3 harness’s page, layout, components and browser tests.
Additional fixture-only routes exercise the two Kit advisories directly. Its Vite
plugin asserts that both the shared application entry and built Lens resolve
the consumer runtime at the published Svelte floor. The normal harness and
latest-peer variant continue to test Kit 3.

Run `pnpm --filter @svelte-lens/e2e-floor test:e2e --workers=1 --retries=0`.
The dedicated build and check run only in this compatibility stage, not every
root Turbo build. This fixture is never published or deployed; the legacy Kit
version is retained solely to test the supported consumer floor.

The cache-header probe parses actual prerendered HTML. The enhanced-form probe
uses a real catch-all path beginning with `//`, verifies successful local form
updates and preserves a normal server redirect. Metadata inspection routes also
test the explicit development-only client-rendering workaround; a separate HTTP
preview check verifies production SSR for both harnesses.
