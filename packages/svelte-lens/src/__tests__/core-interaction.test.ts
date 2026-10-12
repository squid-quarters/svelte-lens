import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HOST_ATTRIBUTE } from "../constants.js";
import type { ActionContext, SvelteLensAPI } from "../types.js";

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const keydown = (init: KeyboardEventInit, target: EventTarget = document): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

const keyup = (init: KeyboardEventInit): void => {
  document.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, ...init }));
};

// jsdom has no PointerEvent; core only reads clientX/clientY.
const pointerMove = (x: number, y: number): void => {
  document.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y, bubbles: true }));
};

const getShadowRoot = (): ShadowRoot =>
  (document.querySelector(`[${HOST_ATTRIBUTE}]`) as HTMLElement).shadowRoot!;

describe("core/index.svelte.ts — interaction", () => {
  let api: SvelteLensAPI | null = null;
  let elementAt: Element | null = null;
  let writeText: ReturnType<typeof vi.fn>;

  const setup = async (options?: Parameters<typeof import("../core/index.svelte.js").init>[0]) => {
    const { init } = await import("../core/index.svelte.js");
    api = init(options);
    return api;
  };

  beforeEach(() => {
    vi.resetModules();
    for (const el of document.querySelectorAll(`[${HOST_ATTRIBUTE}]`)) el.remove();
    elementAt = null;
    vi.spyOn(document, "elementsFromPoint").mockImplementation(() =>
      elementAt ? [elementAt] : [],
    );
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
  });

  afterEach(() => {
    api?.dispose();
    api = null;
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  const makeEl = (id: string, tag = "div"): HTMLElement => {
    const el = document.createElement(tag);
    el.id = id;
    document.body.appendChild(el);
    return el;
  };

  // Opens the context menu on `target` and waits for it to render.
  const openMenu = async (target: Element): Promise<void> => {
    elementAt = target;
    pointerMove(10, 10);
    document.dispatchEvent(
      new MouseEvent("contextmenu", { clientX: 10, clientY: 10, bubbles: true, cancelable: true }),
    );
    await wait(10);
  };

  describe("context menu Copy (#0)", () => {
    it("copies the element and closes the menu", async () => {
      const lens = await setup();
      const target = makeEl("target");
      lens.activate();
      await openMenu(target);

      const copyItem = Array.from(getShadowRoot().querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Copy") && b.getAttribute("role") === "menuitem",
      );
      expect(copyItem).toBeDefined();
      copyItem!.click();
      await wait(10);

      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText.mock.calls[0]![0]).toContain('id="target"');
      expect(getShadowRoot().querySelector('[role="menu"]')).toBe(null);
    });
  });

  describe("element detection (#1)", () => {
    it("detects the final pointer position after a throttled move", async () => {
      const lens = await setup();
      const a = makeEl("a");
      const b = makeEl("b");
      lens.activate();
      elementAt = a;
      pointerMove(1, 1);
      expect(lens.getState().targetElement).toBe(a);
      elementAt = b;
      pointerMove(2, 2);
      await wait(60);
      expect(lens.getState().targetElement).toBe(b);
    });

    it("re-detects under the stationary pointer on scroll", async () => {
      const lens = await setup();
      const a = makeEl("a");
      const b = makeEl("b");
      lens.activate();
      elementAt = a;
      pointerMove(1, 1);
      elementAt = b;
      window.dispatchEvent(new Event("scroll"));
      expect(lens.getState().targetElement).toBe(b);
    });

    it("detects under the pointer immediately on activation", async () => {
      const lens = await setup();
      const a = makeEl("a");
      elementAt = a;
      pointerMove(1, 1);
      lens.activate();
      expect(lens.getState().targetElement).toBe(a);
    });
  });

  describe("input handling (#2)", () => {
    it("toggles from inside an input by default", async () => {
      const lens = await setup();
      const input = makeEl("i", "input");
      keydown({ key: "g", code: "KeyG", metaKey: true, altKey: true }, input);
      expect(lens.isActive()).toBe(true);
    });

    it("leaves native copy alone inside inputs while active", async () => {
      const lens = await setup();
      const input = makeEl("i", "input");
      elementAt = makeEl("a");
      pointerMove(1, 1);
      lens.activate();
      const event = keydown({ key: "c", metaKey: true }, input);
      expect(event.defaultPrevented).toBe(false);
      await wait(10);
      expect(writeText).not.toHaveBeenCalled();
    });
  });

  describe("plugin hook isolation (#3)", () => {
    it("a throwing onAfterCopy does not turn a successful copy into a failure", async () => {
      const lens = await setup();
      vi.spyOn(console, "error").mockImplementation(() => {});
      const onCopyError = vi.fn();
      lens.registerPlugin({
        name: "bad",
        hooks: {
          onAfterCopy: () => {
            throw new Error("plugin bug");
          },
          onCopyError,
        },
      });
      const result = await lens.copyElement(makeEl("a"));
      expect(result).toBe(true);
      expect(onCopyError).not.toHaveBeenCalled();
    });
  });

  describe("ActionContext.cleanup (#4)", () => {
    it("fully deactivates and hides the selection overlay", async () => {
      const lens = await setup();
      const onDeactivate = vi.fn();
      let captured: ActionContext | null = null;
      lens.registerPlugin({
        name: "capture",
        hooks: { onDeactivate },
        actions: [{ id: "capture", label: "Capture", onAction: (ctx) => void (captured = ctx) }],
      });
      lens.activate();
      await openMenu(makeEl("a"));
      const item = Array.from(getShadowRoot().querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Capture"),
      );
      item!.click();
      await wait();
      expect(captured).not.toBe(null);
      captured!.cleanup();
      await wait();

      expect(lens.isActive()).toBe(false);
      expect(onDeactivate).toHaveBeenCalledTimes(1);
      expect(getShadowRoot().querySelector('[role="menu"]')).toBe(null);
    });
  });

  describe("dispose (#5)", () => {
    it("runs plugin cleanup and onDeactivate, and leaves exactly one host after re-init", async () => {
      const lens = await setup();
      const cleanup = vi.fn();
      const onDeactivate = vi.fn();
      lens.registerPlugin({ name: "p", setup: () => ({ cleanup, hooks: { onDeactivate } }) });
      lens.activate();
      lens.dispose();
      api = null;
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(onDeactivate).toHaveBeenCalledTimes(1);

      await setup();
      await wait(100);
      expect(document.body.querySelectorAll(`:scope > [${HOST_ATTRIBUTE}]`)).toHaveLength(1);
    });
  });

  describe("default activation combo (#6)", () => {
    it("matches with Caps Lock on (key 'G')", async () => {
      const lens = await setup();
      keydown({ key: "G", code: "KeyG", metaKey: true, altKey: true });
      expect(lens.isActive()).toBe(true);
    });

    it("matches an Option-modified key via code", async () => {
      const lens = await setup();
      keydown({ key: "©", code: "KeyG", metaKey: true, altKey: true });
      expect(lens.isActive()).toBe(true);
    });

    it("ignores key repeat", async () => {
      const lens = await setup();
      keydown({ key: "g", code: "KeyG", metaKey: true, altKey: true });
      const repeat = keydown({ key: "g", code: "KeyG", metaKey: true, altKey: true, repeat: true });
      expect(lens.isActive()).toBe(true);
      expect(repeat.defaultPrevented).toBe(true);
    });
  });

  describe("activation options (#7)", () => {
    it("honours activationKey changed via setOptions", async () => {
      const lens = await setup();
      lens.setOptions({ activationKey: "Alt+L" });
      keydown({ key: "l", code: "KeyL", altKey: true });
      expect(lens.isActive()).toBe(true);
      keydown({ key: "l", code: "KeyL", altKey: true });
      expect(lens.isActive()).toBe(false);
      keydown({ key: "g", code: "KeyG", metaKey: true, altKey: true });
      expect(lens.isActive()).toBe(false);
    });

    it("hold mode activates after keyHoldDuration and deactivates on release", async () => {
      const lens = await setup({ activationMode: "hold", keyHoldDuration: 30 });
      keydown({ key: "g", code: "KeyG", metaKey: true, altKey: true });
      expect(lens.isActive()).toBe(false);
      await wait(60);
      expect(lens.isActive()).toBe(true);
      // Releasing a modifier of the combo ends the hold (macOS drops keyup for
      // the main key while Cmd is held).
      keyup({ key: "Meta", code: "MetaLeft", altKey: true });
      expect(lens.isActive()).toBe(false);
    });

    it("hold mode does not activate when released before keyHoldDuration", async () => {
      const lens = await setup({ activationMode: "hold", keyHoldDuration: 50 });
      keydown({ key: "g", code: "KeyG", metaKey: true, altKey: true });
      keyup({ key: "g", code: "KeyG", metaKey: true, altKey: true });
      await wait(80);
      expect(lens.isActive()).toBe(false);
    });
  });

  describe("context menu freezes hover (#24)", () => {
    it("keeps the target and copies the menu element while the menu is open", async () => {
      const lens = await setup();
      const a = makeEl("a");
      const b = makeEl("b");
      lens.activate();
      await openMenu(a);
      elementAt = b;
      await wait(40);
      pointerMove(50, 50);
      await wait(40);
      expect(lens.getState().targetElement).toBe(a);

      keydown({ key: "c", metaKey: true });
      await wait(10);
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText.mock.calls[0]![0]).toContain('id="a"');
    });
  });

  describe("onElementSelect (#26)", () => {
    it("is called on Cmd+C and skips the default copy when it returns true", async () => {
      const lens = await setup();
      const onElementSelect = vi.fn().mockResolvedValue(true);
      lens.registerPlugin({ name: "select", hooks: { onElementSelect } });
      const a = makeEl("a");
      elementAt = a;
      pointerMove(1, 1);
      lens.activate();
      keydown({ key: "c", metaKey: true });
      await wait(10);
      expect(onElementSelect).toHaveBeenCalledWith(a);
      expect(writeText).not.toHaveBeenCalled();
    });

    it("copies as usual when no plugin intercepts", async () => {
      const lens = await setup();
      const onElementSelect = vi.fn();
      lens.registerPlugin({ name: "select", hooks: { onElementSelect } });
      elementAt = makeEl("a");
      pointerMove(1, 1);
      lens.activate();
      keydown({ key: "c", metaKey: true });
      await wait(10);
      expect(onElementSelect).toHaveBeenCalled();
      expect(writeText).toHaveBeenCalledTimes(1);
    });
  });
});
