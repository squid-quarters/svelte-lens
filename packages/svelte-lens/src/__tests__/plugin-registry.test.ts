import { describe, it, expect, vi } from "vitest";
import { createPluginRegistry } from "../core/plugin-registry.svelte.js";
import type { Plugin, SvelteLensAPI } from "../types.js";

const noopApi: SvelteLensAPI = {
  activate: vi.fn(),
  deactivate: vi.fn(),
  toggle: vi.fn(),
  isActive: () => false,
  isEnabled: () => true,
  setEnabled: vi.fn(),
  copyElement: vi.fn().mockResolvedValue(false),
  getSource: vi.fn().mockResolvedValue(null),
  getStackContext: vi.fn().mockResolvedValue(""),
  getState: () => ({ isActive: false, isDragging: false, isCopying: false, targetElement: null }),
  setOptions: vi.fn(),
  registerPlugin: vi.fn(),
  unregisterPlugin: vi.fn(),
  getPlugins: () => [],
  dispose: vi.fn(),
};

describe("createPluginRegistry", () => {
  it("starts with default options", () => {
    const registry = createPluginRegistry();
    expect(registry.store.options.activationMode).toBe("toggle");
    expect(registry.store.actions).toEqual([]);
  });

  it("merges initial options", () => {
    const registry = createPluginRegistry({ activationMode: "hold", keyHoldDuration: 500 });
    expect(registry.store.options.activationMode).toBe("hold");
    expect(registry.store.options.keyHoldDuration).toBe(500);
  });

  it("registers a plugin and merges its config", () => {
    const registry = createPluginRegistry();
    const plugin: Plugin = {
      name: "test-plugin",
      theme: { hue: 120 },
      options: { activationMode: "hold" },
    };
    registry.register(plugin, noopApi);
    expect(registry.getPluginNames()).toContain("test-plugin");
    expect(registry.store.theme.hue).toBe(120);
    expect(registry.store.options.activationMode).toBe("hold");
  });

  it("unregisters a plugin and recomputes", () => {
    const registry = createPluginRegistry();
    const plugin: Plugin = { name: "removable", theme: { hue: 60 } };
    registry.register(plugin, noopApi);
    expect(registry.store.theme.hue).toBe(60);

    registry.unregister("removable");
    expect(registry.getPluginNames()).not.toContain("removable");
    expect(registry.store.theme.hue).toBe(240); // default
  });

  it("calls plugin setup with API", () => {
    const registry = createPluginRegistry();
    const setup = vi.fn().mockReturnValue({});
    const plugin: Plugin = { name: "setup-plugin", setup };
    registry.register(plugin, noopApi);
    expect(setup).toHaveBeenCalledWith(noopApi);
  });

  it("calls cleanup on unregister", () => {
    const registry = createPluginRegistry();
    const cleanup = vi.fn();
    const plugin: Plugin = {
      name: "cleanup-plugin",
      setup: () => ({ cleanup }),
    };
    registry.register(plugin, noopApi);
    registry.unregister("cleanup-plugin");
    expect(cleanup).toHaveBeenCalled();
  });

  it("calls hooks in order", () => {
    const registry = createPluginRegistry();
    const onActivate = vi.fn();
    const onDeactivate = vi.fn();
    const plugin: Plugin = {
      name: "hooked",
      setup: () => ({
        hooks: { onActivate, onDeactivate },
      }),
    };
    registry.register(plugin, noopApi);
    registry.hooks.onActivate();
    expect(onActivate).toHaveBeenCalled();
    registry.hooks.onDeactivate();
    expect(onDeactivate).toHaveBeenCalled();
  });

  it("replaces plugin when re-registered with same name", () => {
    const registry = createPluginRegistry();
    const v1: Plugin = { name: "versioned", theme: { hue: 100 } };
    const v2: Plugin = { name: "versioned", theme: { hue: 200 } };
    registry.register(v1, noopApi);
    registry.register(v2, noopApi);
    expect(registry.getPluginNames().filter((n) => n === "versioned")).toHaveLength(1);
    expect(registry.store.theme.hue).toBe(200);
  });

  it("setOptions overrides direct options", () => {
    const registry = createPluginRegistry();
    registry.setOptions({ activationMode: "hold" });
    expect(registry.store.options.activationMode).toBe("hold");
  });

  it("aggregates actions from plugins", () => {
    const registry = createPluginRegistry();
    const plugin1: Plugin = {
      name: "p1",
      actions: [{ id: "a1", label: "Action 1", onAction: vi.fn() }],
    };
    const plugin2: Plugin = {
      name: "p2",
      actions: [{ id: "a2", label: "Action 2", onAction: vi.fn() }],
    };
    registry.register(plugin1, noopApi);
    registry.register(plugin2, noopApi);
    expect(registry.store.actions).toHaveLength(2);
    expect(registry.store.actions[0]!.id).toBe("a1");
    expect(registry.store.actions[1]!.id).toBe("a2");
  });

  it("transformCopyContent chains through plugins", async () => {
    const registry = createPluginRegistry();
    const upper: Plugin = {
      name: "upper",
      setup: () => ({
        hooks: {
          transformCopyContent: async (content: string) => content.toUpperCase(),
        },
      }),
    };
    registry.register(upper, noopApi);
    const result = await registry.hooks.transformCopyContent("hello", []);
    expect(result).toBe("HELLO");
  });

  it("onCopyError hook receives error", () => {
    const registry = createPluginRegistry();
    const onError = vi.fn();
    const plugin: Plugin = {
      name: "err-handler",
      setup: () => ({ hooks: { onCopyError: onError } }),
    };
    registry.register(plugin, noopApi);
    const err = new Error("boom");
    registry.hooks.onCopyError(err);
    expect(onError).toHaveBeenCalledWith(err);
  });

  it("ignores undefined initial options so defaults survive", () => {
    const registry = createPluginRegistry({
      allowActivationInsideInput: undefined,
      activationMode: undefined,
      keyHoldDuration: undefined,
    });
    expect(registry.store.options.allowActivationInsideInput).toBe(true);
    expect(registry.store.options.activationMode).toBe("toggle");
    expect(registry.store.options.keyHoldDuration).toBe(100);
    registry.register({ name: "p", options: { allowActivationInsideInput: undefined } }, noopApi);
    expect(registry.store.options.allowActivationInsideInput).toBe(true);
  });

  it("isolates a throwing hook from other plugins and the caller", () => {
    const registry = createPluginRegistry();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onActivate = vi.fn();
    registry.register(
      {
        name: "bad",
        hooks: {
          onActivate: () => {
            throw new Error("boom");
          },
        },
      },
      noopApi,
    );
    registry.register({ name: "good", hooks: { onActivate } }, noopApi);
    expect(() => registry.hooks.onActivate()).not.toThrow();
    expect(onActivate).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("onElementSelect resolves true when a sync or async hook intercepts", async () => {
    const sync = createPluginRegistry();
    sync.register({ name: "s", hooks: { onElementSelect: () => true } }, noopApi);
    await expect(sync.hooks.onElementSelect(document.body)).resolves.toBe(true);

    const async = createPluginRegistry();
    async.register({ name: "a", hooks: { onElementSelect: async () => true } }, noopApi);
    await expect(async.hooks.onElementSelect(document.body)).resolves.toBe(true);

    const none = createPluginRegistry();
    none.register({ name: "n", hooks: { onElementSelect: () => {} } }, noopApi);
    await expect(none.hooks.onElementSelect(document.body)).resolves.toBe(false);
  });
});
