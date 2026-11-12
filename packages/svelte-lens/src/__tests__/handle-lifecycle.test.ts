import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SvelteLensAPI } from "../types.js";
import { HOST_ATTRIBUTE, MOUNT_ROOT_RECHECK_DELAY_MS } from "../constants.js";

describe("handle lifetime", () => {
  const instances: SvelteLensAPI[] = [];
  beforeEach(() => {
    vi.resetModules();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });
  afterEach(() => {
    for (const api of instances.splice(0)) api.dispose();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  const start = async () => {
    const { init } = await import("../core/index.svelte.js");
    const { instanceOf } = await import("../core/handles.js");
    const handle = init();
    instances.push(instanceOf(handle)!);
    return { init, handle, shared: instanceOf(handle)! };
  };

  it("makes every released handle mutator inert while another owner survives", async () => {
    const { init, handle, shared } = await start();
    const survivor = init();
    handle.dispose();
    survivor.activate();
    const setup = vi.fn();
    handle.registerPlugin({ name: "leak", setup });
    handle.unregisterPlugin("copy");
    handle.setEnabled(false);
    handle.setOptions({ activationKey: "x" });
    handle.deactivate();
    handle.toggle();
    handle.activate();
    expect(await handle.copyElement(document.body)).toBe(false);
    handle.dispose();
    expect(setup).not.toHaveBeenCalled();
    expect(shared.getPlugins()).toEqual(["copy", "open"]);
    expect(survivor.isEnabled()).toBe(true);
    expect(survivor.isActive()).toBe(true);
    expect(handle.getState().isActive).toBe(false);
    survivor.deactivate();
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "g",
        code: "KeyG",
        metaKey: true,
        altKey: true,
        bubbles: true,
      }),
    );
    expect(survivor.isActive()).toBe(true);
  });

  it("unwinds registration when setup disposes its handle", async () => {
    const { init, handle, shared } = await start();
    init();
    const cleanup = vi.fn();
    handle.registerPlugin({
      name: "pending",
      setup: () => {
        handle.dispose();
        return { cleanup };
      },
    });
    expect(shared.getPlugins()).not.toContain("pending");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("cannot resurrect a plugin after setup disposes the last handle", async () => {
    const { init, handle, shared } = await start();
    const cleanup = vi.fn();
    handle.registerPlugin({
      name: "pending",
      setup: () => {
        handle.dispose();
        return { cleanup };
      },
    });
    expect(shared.getPlugins()).toEqual([]);
    expect(cleanup).toHaveBeenCalledTimes(1);
    const newer = init();
    instances.push(newer);
    handle.setEnabled(false);
    handle.registerPlugin({ name: "late" });
    handle.dispose();
    expect(newer.isEnabled()).toBe(true);
    expect(newer.getPlugins()).toEqual(["copy", "open"]);
  });

  it("preserves direct same-name registration made during setup", async () => {
    const { init, handle, shared } = await start();
    init();
    const cleanup = vi.fn();
    const winner = {
      name: "same",
      actions: [{ id: "winner", label: "Winner", onAction: vi.fn() }],
    };
    handle.registerPlugin({
      name: "same",
      setup: (api) => {
        api.registerPlugin(winner);
        return { cleanup };
      },
    });
    handle.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
    // Direct registration wins until shared-instance teardown.
    expect(shared.getPlugins()).toContain("same");
  });

  it("retains ownership of a nested same-handle registration", async () => {
    const { init, handle, shared } = await start();
    init();
    const outerCleanup = vi.fn();
    const innerCleanup = vi.fn();
    handle.registerPlugin({
      name: "nested",
      setup: () => {
        handle.registerPlugin({ name: "nested", setup: () => ({ cleanup: innerCleanup }) });
        return { cleanup: outerCleanup };
      },
    });
    expect(outerCleanup).toHaveBeenCalledTimes(1);
    expect(shared.getPlugins()).toContain("nested");
    handle.dispose();
    expect(innerCleanup).toHaveBeenCalledTimes(1);
    expect(shared.getPlugins()).not.toContain("nested");
  });

  it("does not share an unowned layer after setup throws and is retried", async () => {
    const { init, handle, shared } = await start();
    init();
    const cleanup = vi.fn();
    const plugin = {
      name: "retry",
      setup: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error("setup failed");
        })
        .mockImplementation(() => ({ cleanup })),
    };
    expect(() => handle.registerPlugin(plugin)).toThrow("setup failed");
    handle.registerPlugin(plugin);
    handle.dispose();
    expect(shared.getPlugins()).not.toContain("retry");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("rolls back a failed shared-layer retry after a replacement throws", async () => {
    const { init, handle: first, shared } = await start();
    const second = init();
    init();
    const cleanup = vi.fn();
    const plugin = {
      name: "retry-shared",
      setup: vi
        .fn()
        .mockImplementationOnce(() => ({ cleanup }))
        .mockImplementationOnce(() => {
          throw new Error("shared retry failed");
        })
        .mockImplementation(() => ({ cleanup })),
    };
    first.registerPlugin(plugin);
    expect(() =>
      second.registerPlugin({
        name: "retry-shared",
        setup: () => {
          throw new Error("replacement failed");
        },
      }),
    ).toThrow("replacement failed");
    expect(() => second.registerPlugin(plugin)).toThrow("shared retry failed");
    second.registerPlugin(plugin);
    first.dispose();
    second.dispose();
    expect(shared.getPlugins()).not.toContain("retry-shared");
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("copies an array snapshot in order through one hook pipeline", async () => {
    const { handle, shared } = await start();
    const first = document.createElement("div");
    first.id = "first";
    const second = document.createElement("div");
    second.id = "second";
    document.body.append(first, second);
    const elements = [first, second];
    let resume!: () => void;
    const before = vi.fn(
      (_elements: Element[]) =>
        new Promise<void>((resolve) => {
          resume = resolve;
        }),
    );
    const transform = vi.fn((value: string) => value);
    const after = vi.fn();
    shared.registerPlugin({
      name: "pipeline",
      hooks: {
        onBeforeCopy: before,
        transformCopyContent: transform,
        onAfterCopy: after,
      },
    });
    const write = vi.spyOn(navigator.clipboard, "writeText");
    const pending = handle.copyElement(elements);
    await vi.waitFor(() => expect(resume).toBeTypeOf("function"));
    elements.pop();
    resume();
    expect(await pending).toBe(true);
    expect(before).toHaveBeenCalledTimes(1);
    expect(before.mock.calls[0]?.[0]).toEqual([first, second]);
    expect(transform).toHaveBeenCalledWith(expect.any(String), [first, second]);
    expect(after).toHaveBeenCalledWith([first, second], true);
    const content = write.mock.calls[0]![0];
    expect(content).toContain('id="first"');
    expect(content).toContain('id="second"');
    expect(content.indexOf('id="first"')).toBeLessThan(content.indexOf('id="second"'));
  });

  it("passes the entire array to custom getContent and keeps empty copies inert", async () => {
    const { handle, shared } = await start();
    const content = vi.fn(() => "custom");
    shared.setOptions({ getContent: content });
    expect(await handle.copyElement([])).toBe(false);
    expect(content).not.toHaveBeenCalled();
    expect(await handle.copyElement([document.body, document.documentElement])).toBe(true);
    expect(content).toHaveBeenCalledWith([document.body, document.documentElement]);
  });

  it("cancels a handle's pending copy before clipboard write", async () => {
    const { init, handle, shared } = await start();
    init();
    let finish!: () => void;
    const after = vi.fn();
    shared.registerPlugin({
      name: "barrier",
      hooks: {
        onBeforeCopy: () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
        onAfterCopy: after,
      },
    });
    const write = vi.spyOn(navigator.clipboard, "writeText");
    const pending = handle.copyElement(document.body);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    handle.dispose();
    finish();
    expect(await pending).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(shared.getState().isCopying).toBe(false);
  });

  for (const phase of ["content", "transform", "clipboard"] as const) {
    it(`stops later copy phases after disposal during ${phase}`, async () => {
      const { init, handle, shared } = await start();
      const survivor = init();
      let finish!: () => void;
      const barrier = () =>
        new Promise<string>((resolve) => {
          finish = () => resolve("content");
        });
      const after = vi.fn();
      shared.setOptions({ getContent: phase === "content" ? barrier : () => "content" });
      shared.registerPlugin({
        name: "barrier",
        hooks: {
          transformCopyContent: phase === "transform" ? barrier : (value) => value,
          onAfterCopy: after,
        },
      });
      const write = vi.spyOn(navigator.clipboard, "writeText");
      if (phase === "clipboard")
        write.mockImplementationOnce(async () => {
          await barrier();
        });
      const pending = handle.copyElement(document.body);
      await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
      handle.dispose();
      finish();
      expect(await pending).toBe(false);
      expect(write).toHaveBeenCalledTimes(phase === "clipboard" ? 1 : 0);
      expect(after).not.toHaveBeenCalled();
      expect(shared.getState().isCopying).toBe(false);
      shared.unregisterPlugin("barrier");
      shared.setOptions({ getContent: () => "survivor" });
      expect(await survivor.copyElement(document.body)).toBe(true);
    });
  }

  it("allows deactivation callbacks to dispose and create a newer instance safely", async () => {
    const { init, handle, shared } = await start();
    let newer: SvelteLensAPI | undefined;
    const cleanup = vi.fn();
    shared.registerPlugin({
      name: "reentrant",
      setup: () => ({ cleanup }),
      hooks: {
        onDeactivate: () => {
          shared.dispose();
          newer = init();
          instances.push(newer);
        },
      },
    });
    handle.activate();
    handle.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(newer?.isEnabled()).toBe(true);
    expect(newer?.getPlugins()).toEqual(["copy", "open"]);
    newer?.activate();
    const host = document.querySelector(`[${HOST_ATTRIBUTE}]`);
    expect(host?.isConnected).toBe(true);
    expect(host?.shadowRoot?.querySelector(".lens-toolbar")).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, MOUNT_ROOT_RECHECK_DELAY_MS + 10));
    expect(host?.isConnected).toBe(true);
    expect(document.querySelectorAll(`[${HOST_ATTRIBUTE}]`)).toHaveLength(1);
  });
});
