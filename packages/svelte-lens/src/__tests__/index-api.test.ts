import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HOST_ATTRIBUTE } from "../constants.js";

describe("index.ts public API", () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    vi.resetModules();
    const existing = document.querySelectorAll(`[${HOST_ATTRIBUTE}]`);
    for (const el of existing) el.remove();
    if (typeof window !== "undefined" && window.__SVELTE_LENS__) {
      delete window.__SVELTE_LENS__;
    }
  });

  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    vi.restoreAllMocks();
  });

  it("registerPlugin queues a plugin before init, then flushes on init", async () => {
    const { registerPlugin, getGlobalApi, init } = await import("../index.js");

    // Before init, registerPlugin queues the plugin.
    registerPlugin({
      name: "queued-plugin",
      theme: { hue: 90 },
    });

    // No global API yet — init() is required explicitly.
    expect(getGlobalApi()).toBeNull();

    const api = init();
    expect(api.getPlugins()).toContain("queued-plugin");
    cleanup = api.dispose;
  });

  it("registerPlugin adds directly after init", async () => {
    const { registerPlugin, init } = await import("../index.js");

    const api = init();
    registerPlugin({ name: "direct-plugin", theme: { hue: 90 } });
    expect(api.getPlugins()).toContain("direct-plugin");
    cleanup = api.dispose;
  });

  it("unregisterPlugin removes a plugin from the initialized API", async () => {
    const { registerPlugin, unregisterPlugin, init } = await import("../index.js");

    const api = init();
    registerPlugin({ name: "removable-plugin" });
    expect(api.getPlugins()).toContain("removable-plugin");

    unregisterPlugin("removable-plugin");
    expect(api.getPlugins()).not.toContain("removable-plugin");
    cleanup = api.dispose;
  });

  it("init() sets window.__SVELTE_LENS__ with Object.defineProperty", async () => {
    const { init } = await import("../index.js");

    const api = init();
    expect(window.__SVELTE_LENS__).toBeDefined();
    expect(window.__SVELTE_LENS__).toBe(api);

    // Verify the property is non-writable (finding #13).
    const descriptor = Object.getOwnPropertyDescriptor(window, "__SVELTE_LENS__");
    expect(descriptor?.writable).toBe(false);
    expect(descriptor?.configurable).toBe(true);
    cleanup = api.dispose;
  });

  it("getGlobalApi returns the initialized API", async () => {
    const { getGlobalApi, init } = await import("../index.js");

    const api = init();
    cleanup = api.dispose;

    const globalApi = getGlobalApi();
    expect(globalApi).not.toBeNull();
    expect(globalApi?.isEnabled()).toBe(true);
  });

  it("init() dispatches svelte-lens:init CustomEvent", async () => {
    const { init } = await import("../index.js");

    const handler = vi.fn();
    window.addEventListener("svelte-lens:init", handler);

    const api = init();
    cleanup = api.dispose;

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]?.detail).toBe(api);
    window.removeEventListener("svelte-lens:init", handler);
  });

  it("__SVELTE_LENS_DISABLED__ prevents initialization", async () => {
    (window as unknown as Record<string, unknown>).__SVELTE_LENS_DISABLED__ = true;

    const { init } = await import("../index.js");
    const api = init();

    expect(api.isEnabled()).toBe(false);
    expect(window.__SVELTE_LENS__).toBeUndefined();

    delete (window as unknown as Record<string, unknown>).__SVELTE_LENS_DISABLED__;
  });

  it("init() is a no-op in production builds", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const { init } = await import("../index.js");
      const api = init();

      expect(api.isEnabled()).toBe(false);
      expect(window.__SVELTE_LENS__).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("__SVELTE_LENS_FORCE_ENABLE__ overrides the production guard", async () => {
    vi.stubEnv("NODE_ENV", "production");
    window.__SVELTE_LENS_FORCE_ENABLE__ = true;

    try {
      const { init } = await import("../index.js");
      const api = init();

      expect(api.isEnabled()).toBe(true);
      cleanup = api.dispose;
    } finally {
      delete window.__SVELTE_LENS_FORCE_ENABLE__;
      vi.unstubAllEnvs();
    }
  });

  it("disposing a stale API again keeps the newer instance as the global", async () => {
    const { getGlobalApi, init } = await import("../index.js");
    const first = init();
    first.dispose();
    const second = init();
    cleanup = second.dispose;

    first.dispose();

    expect(getGlobalApi()).toBe(second);
    expect(window.__SVELTE_LENS__).toBe(second);
  });

  it("a repeat init() returns the running instance without re-announcing it", async () => {
    const { getGlobalApi, init } = await import("../index.js");
    const announced = vi.fn();
    window.addEventListener("svelte-lens:init", announced);
    const first = init();
    cleanup = first.dispose;

    expect(init()).toBe(first);
    expect(getGlobalApi()).toBe(first);
    expect(announced).toHaveBeenCalledTimes(1);
    window.removeEventListener("svelte-lens:init", announced);

    // One dispose still tears it down and clears the global.
    first.dispose();
    cleanup = null;
    expect(getGlobalApi()).toBeNull();
    expect(document.querySelectorAll(`[${HOST_ATTRIBUTE}]`).length).toBe(0);
  });
});
