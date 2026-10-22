import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HOST_ATTRIBUTE } from "../constants.js";

describe("core/index.svelte.ts — init()", () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    vi.resetModules();
    const existing = document.querySelectorAll(`[${HOST_ATTRIBUTE}]`);
    for (const el of existing) el.remove();
  });

  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    vi.restoreAllMocks();
  });

  it("returns a no-op API when window is undefined (SSR-safe)", async () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error — deliberately deleting for SSR test
    delete globalThis.window;
    const { init } = await import("../core/index.svelte.js");
    const api = init();
    expect(api.isActive()).toBe(false);
    expect(api.isEnabled()).toBe(false);
    globalThis.window = originalWindow;
  });

  it("returns a no-op API when enabled=false", async () => {
    const { init } = await import("../core/index.svelte.js");
    const api = init({ enabled: false });
    expect(api.isActive()).toBe(false);
    expect(api.isEnabled()).toBe(false);
  });

  it("initializes and returns a working API", async () => {
    const { init } = await import("../core/index.svelte.js");
    const api = init();
    cleanup = api.dispose;
    expect(api.isActive()).toBe(false);
    expect(api.isEnabled()).toBe(true);
    expect(typeof api.toggle).toBe("function");
    expect(typeof api.dispose).toBe("function");
  });

  it("toggle activates and deactivates the lens", async () => {
    const { init } = await import("../core/index.svelte.js");
    const api = init();
    cleanup = api.dispose;

    api.toggle();
    expect(api.isActive()).toBe(true);

    api.toggle();
    expect(api.isActive()).toBe(false);
  });

  it("setEnabled(false) deactivates and prevents reactivation", async () => {
    const { init } = await import("../core/index.svelte.js");
    const api = init();
    cleanup = api.dispose;

    api.toggle();
    expect(api.isActive()).toBe(true);

    api.setEnabled(false);
    expect(api.isEnabled()).toBe(false);
    expect(api.isActive()).toBe(false);

    api.activate();
    expect(api.isActive()).toBe(false);
  });

  it("setEnabled(true) re-enables the lens", async () => {
    const { init } = await import("../core/index.svelte.js");
    const api = init();
    cleanup = api.dispose;

    api.setEnabled(false);
    expect(api.isEnabled()).toBe(false);

    api.setEnabled(true);
    expect(api.isEnabled()).toBe(true);
    api.activate();
    expect(api.isActive()).toBe(true);
  });

  it("dispose cleans up event listeners and removes host", async () => {
    const { init } = await import("../core/index.svelte.js");
    const api = init();

    api.toggle();
    api.dispose();
    cleanup = null;

    const hosts = document.querySelectorAll(`[${HOST_ATTRIBUTE}]`);
    expect(hosts.length).toBe(0);
  });

  it("dispose completes teardown when a plugin cleanup throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { init } = await import("../core/index.svelte.js");
    const api = init();
    api.registerPlugin({
      name: "bad",
      setup: () => ({
        cleanup: () => {
          throw new Error("boom");
        },
      }),
    });

    expect(() => api.dispose()).not.toThrow();
    cleanup = null;

    expect(errorSpy).toHaveBeenCalled();
    expect(document.querySelectorAll(`[${HOST_ATTRIBUTE}]`).length).toBe(0);
    // The old instance's activation listener is gone.
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "g",
        metaKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(api.isActive()).toBe(false);

    // The guard was reset, so a fresh init() is fully functional.
    const next = init();
    cleanup = next.dispose;
    expect(next.isEnabled()).toBe(true);
  });

  it("a repeat init() returns a working handle onto the running instance", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { init } = await import("../core/index.svelte.js");
    const first = init();
    cleanup = first.dispose;

    const again = init({ enabled: true });
    expect(warn).not.toHaveBeenCalled();
    expect(document.querySelectorAll(`[${HOST_ATTRIBUTE}]`).length).toBe(1);

    // It drives the same instance.
    again.registerPlugin({ name: "late" });
    expect(first.getPlugins()).toContain("late");
    again.activate();
    expect(first.isActive()).toBe(true);
  });

  it("a repeat init()'s dispose() only removes its own plugins", async () => {
    const { init } = await import("../core/index.svelte.js");
    const first = init();
    cleanup = first.dispose;
    first.registerPlugin({ name: "owner" });

    const borrowed = init();
    borrowed.registerPlugin({ name: "borrowed" });
    borrowed.dispose();

    expect(first.isEnabled()).toBe(true);
    expect(first.getPlugins()).toContain("owner");
    expect(first.getPlugins()).not.toContain("borrowed");
    expect(document.querySelectorAll(`[${HOST_ATTRIBUTE}]`).length).toBe(1);
  });

  it("a repeat init()'s dispose() leaves a same-named plugin registered by someone else", async () => {
    const { init } = await import("../core/index.svelte.js");
    const first = init();
    cleanup = first.dispose;
    const cleanupOwner = vi.fn();

    // The owner re-registers the name after a borrowed handle did.
    const borrowed = init();
    borrowed.registerPlugin({ name: "x" });
    first.registerPlugin({ name: "x", setup: () => ({ cleanup: cleanupOwner }) });
    borrowed.dispose();
    expect(first.getPlugins()).toContain("x");
    expect(cleanupOwner).not.toHaveBeenCalled();

    // Two borrowed handles (e.g. two mounted components) using one name.
    const h1 = init();
    const h2 = init();
    h1.registerPlugin({ name: "y" });
    h2.registerPlugin({ name: "y" });
    h1.dispose();
    expect(first.getPlugins()).toContain("y");
    h2.dispose();
    expect(first.getPlugins()).not.toContain("y");
  });

  it("keeps a shared plugin object until the last repeat-init() handle using it is disposed", async () => {
    const { init } = await import("../core/index.svelte.js");
    const first = init();
    cleanup = first.dispose;
    const shared = { name: "shared" };

    // The same component mounted twice, each registering a shared constant.
    const a = init();
    const b = init();
    a.registerPlugin(shared);
    b.registerPlugin(shared);
    a.dispose();
    expect(first.getPlugins()).toContain("shared");
    b.dispose();
    expect(first.getPlugins()).not.toContain("shared");
  });

  it("warns that options passed to a repeat init() are ignored", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { init } = await import("../core/index.svelte.js");
    const first = init();
    cleanup = first.dispose;

    init({ activationMode: "hold" });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/already running/));
  });

  it("starts a fresh instance after dispose()", async () => {
    const { init } = await import("../core/index.svelte.js");
    const first = init();
    first.dispose();
    const second = init();
    cleanup = second.dispose;
    expect(second).not.toBe(first);
    expect(second.isEnabled()).toBe(true);
  });

  it("a disposed API cannot be activated again", async () => {
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const { init } = await import("../core/index.svelte.js");
    const api = init();
    api.dispose();
    cleanup = null;

    api.activate();
    api.toggle();
    api.setEnabled(true);
    api.activate();

    expect(api.isActive()).toBe(false);
    expect(api.isEnabled()).toBe(false);
    expect(observe).not.toHaveBeenCalled();
  });

  it("disposing a stale API twice leaves a newer instance intact", async () => {
    const { init } = await import("../core/index.svelte.js");
    const first = init();
    first.dispose();
    const second = init();
    cleanup = second.dispose;
    window.__SVELTE_LENS__ = second;

    first.dispose();

    expect(window.__SVELTE_LENS__).toBe(second);
    expect(document.querySelectorAll(`[${HOST_ATTRIBUTE}]`).length).toBe(1);
    // The init guard still belongs to the live instance.
    expect(init().isEnabled()).toBe(true);
    expect(document.querySelectorAll(`[${HOST_ATTRIBUTE}]`).length).toBe(1);
  });

  it("dispose clears window.__SVELTE_LENS__ when set", async () => {
    const { init } = await import("../core/index.svelte.js");
    const api = init();
    cleanup = api.dispose;

    // Manually set window.__SVELTE_LENS__ as the index.ts wrapper does
    window.__SVELTE_LENS__ = api;
    expect(window.__SVELTE_LENS__).toBeDefined();

    api.dispose();
    cleanup = null;
    expect(window.__SVELTE_LENS__).toBeUndefined();
  });

  it("registers built-in plugins (copy, open)", async () => {
    const { init } = await import("../core/index.svelte.js");
    const api = init();
    cleanup = api.dispose;
    const plugins = api.getPlugins();
    expect(plugins).toContain("copy");
    expect(plugins).toContain("open");
  });

  it("registerPlugin adds a custom plugin", async () => {
    const { init } = await import("../core/index.svelte.js");
    const api = init();
    cleanup = api.dispose;

    api.registerPlugin({
      name: "test-plugin",
      theme: { hue: 180 },
    });

    const plugins = api.getPlugins();
    expect(plugins).toContain("test-plugin");
  });

  it("unregisterPlugin removes a plugin", async () => {
    const { init } = await import("../core/index.svelte.js");
    const api = init();
    cleanup = api.dispose;

    api.registerPlugin({ name: "custom" });
    expect(api.getPlugins()).toContain("custom");

    api.unregisterPlugin("custom");
    expect(api.getPlugins()).not.toContain("custom");
  });

  it("creates shadow DOM mount host in document", async () => {
    const { init } = await import("../core/index.svelte.js");
    const api = init();
    cleanup = api.dispose;

    await new Promise((r) => setTimeout(r, 100));

    const host = document.querySelector(`[${HOST_ATTRIBUTE}]`);
    expect(host).not.toBe(null);
    expect((host as Element).shadowRoot).not.toBe(null);
  });

  it("keydown Cmd+Alt+G toggles activation", async () => {
    const { init } = await import("../core/index.svelte.js");
    const api = init();
    cleanup = api.dispose;

    expect(api.isActive()).toBe(false);

    const event = new KeyboardEvent("keydown", {
      key: "g",
      metaKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(api.isActive()).toBe(true);
  });

  it("keydown Escape deactivates the lens", async () => {
    const { init } = await import("../core/index.svelte.js");
    const api = init();
    cleanup = api.dispose;

    api.activate();
    expect(api.isActive()).toBe(true);

    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(api.isActive()).toBe(false);
  });

  it("keydown Escape while active clears overlay state", async () => {
    const { init } = await import("../core/index.svelte.js");
    const api = init();
    cleanup = api.dispose;

    api.activate();
    expect(api.isActive()).toBe(true);

    const stateBefore = api.getState();
    expect(stateBefore.isActive).toBe(true);

    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(api.isActive()).toBe(false);
    const stateAfter = api.getState();
    expect(stateAfter.targetElement).toBe(null);
  });

  it("getState returns isCopying=false after deactivate during copy", async () => {
    const { init } = await import("../core/index.svelte.js");
    const api = init();
    cleanup = api.dispose;

    api.activate();
    // Simulate starting a copy then deactivating
    // The store should reset isCopying on deactivate
    api.deactivate();
    const state = api.getState();
    expect(state.isCopying).toBe(false);
  });
});
