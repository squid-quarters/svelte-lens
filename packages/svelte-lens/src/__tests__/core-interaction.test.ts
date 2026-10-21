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

  const labelDisplay = (): string =>
    getShadowRoot().querySelector<HTMLElement>(".lens-label")?.style.display ?? "";

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

    it("keeps the selection and 'Copied' label on the copied element", async () => {
      const lens = await setup();
      const icon = makeEl("icon");
      const neighbour = makeEl("neighbour");
      lens.activate();
      await openMenu(icon);
      // The page element under the Copy menu item.
      elementAt = neighbour;
      pointerMove(40, 40);

      const copyItem = Array.from(getShadowRoot().querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Copy") && b.getAttribute("role") === "menuitem",
      );
      copyItem!.click();
      await wait(10);

      expect(writeText.mock.calls[0]![0]).toContain('id="icon"');
      expect(lens.getState().targetElement).toBe(icon);
      expect(getShadowRoot().querySelector(".lens-label")?.textContent).toContain("Copied");
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

    it("does not match another letter at the G position (Dvorak Cmd+Option+I)", async () => {
      const lens = await setup();
      const ev = keydown({ key: "i", code: "KeyG", metaKey: true, altKey: true });
      expect(lens.isActive()).toBe(false);
      expect(ev.defaultPrevented).toBe(false);
    });

    it("does not match AltGr+G typing ']' (Windows Czech layout), even in inputs", async () => {
      const lens = await setup();
      const input = makeEl("i", "input");
      const ev = keydown(
        { key: "]", code: "KeyG", ctrlKey: true, altKey: true, modifierAltGraph: true },
        input,
      );
      expect(ev.getModifierState("AltGraph")).toBe(true);
      expect(lens.isActive()).toBe(false);
      expect(ev.defaultPrevented).toBe(false);
    });

    it("does not hijack another letter at the C position as copy (Dvorak Cmd+J)", async () => {
      const lens = await setup();
      elementAt = makeEl("a");
      pointerMove(1, 1);
      keydown({ key: "g", code: "KeyG", metaKey: true, altKey: true });
      expect(lens.isActive()).toBe(true);
      const ev = keydown({ key: "j", code: "KeyC", metaKey: true });
      await wait(10);
      expect(ev.defaultPrevented).toBe(false);
      expect(writeText).not.toHaveBeenCalled();
    });

    it("ignores key repeat", async () => {
      const lens = await setup();
      keydown({ key: "g", code: "KeyG", metaKey: true, altKey: true });
      const repeat = keydown({ key: "g", code: "KeyG", metaKey: true, altKey: true, repeat: true });
      expect(lens.isActive()).toBe(true);
      expect(repeat.defaultPrevented).toBe(true);
    });

    it("ignores key-less keydown events (Chrome autofill)", async () => {
      const lens = await setup();
      const input = makeEl("field", "input");
      const errors: unknown[] = [];
      const onError = (e: ErrorEvent) => errors.push(e.error);
      window.addEventListener("error", onError);
      try {
        input.dispatchEvent(new Event("keydown", { bubbles: true, cancelable: true }));
      } finally {
        window.removeEventListener("error", onError);
      }
      expect(errors).toEqual([]);
      expect(lens.isActive()).toBe(false);
    });
  });

  describe("activation options (#7)", () => {
    it("setOptions({ activationKey: undefined }) restores the default shortcut", async () => {
      const lens = await setup();
      lens.setOptions({ activationKey: "Alt+L" });
      lens.setOptions({ activationKey: undefined });
      keydown({ key: "l", code: "KeyL", altKey: true });
      expect(lens.isActive()).toBe(false);
      keydown({ key: "g", code: "KeyG", metaKey: true, altKey: true });
      expect(lens.isActive()).toBe(true);
    });

    it("fires onActivate/onDeactivate only on real state changes", async () => {
      const lens = await setup();
      const calls: string[] = [];
      lens.registerPlugin({
        name: "log",
        hooks: {
          onActivate: () => void calls.push("activate"),
          onDeactivate: () => void calls.push("deactivate"),
        },
      });
      lens.activate();
      lens.activate();
      lens.deactivate();
      lens.deactivate();
      lens.setEnabled(false);
      expect(calls).toEqual(["activate", "deactivate"]);
    });

    it("a hold cancelled before activation does not report a deactivation", async () => {
      const lens = await setup({ activationMode: "hold", keyHoldDuration: 30 });
      const onDeactivate = vi.fn();
      lens.registerPlugin({ name: "log", hooks: { onDeactivate } });
      keydown({ key: "g", code: "KeyG", metaKey: true, altKey: true });
      lens.setEnabled(false);
      await wait(60);
      expect(lens.isActive()).toBe(false);
      expect(onDeactivate).not.toHaveBeenCalled();
    });

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

    it("hold mode copies with Cmd+Option+C while the chord is held (macOS key 'ç')", async () => {
      const lens = await setup({ activationMode: "hold", keyHoldDuration: 30 });
      elementAt = makeEl("a");
      pointerMove(1, 1);
      keydown({ key: "©", code: "KeyG", metaKey: true, altKey: true });
      await wait(60);
      expect(lens.isActive()).toBe(true);
      const copy = keydown({ key: "ç", code: "KeyC", metaKey: true, altKey: true });
      await wait(10);
      expect(copy.defaultPrevented).toBe(true);
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText.mock.calls[0]![0]).toContain('id="a"');
      expect(lens.isActive()).toBe(true);
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

  describe("context menu retargets after hover freeze", () => {
    const rightClick = (x: number, y: number): void => {
      document.dispatchEvent(
        new MouseEvent("contextmenu", { clientX: x, clientY: y, bubbles: true, cancelable: true }),
      );
    };

    it("a second right-click while the menu is open targets the element under it", async () => {
      const lens = await setup();
      const a = makeEl("a");
      const b = makeEl("b");
      lens.activate();
      await openMenu(a);
      elementAt = b;
      rightClick(50, 50);
      await wait(10);
      expect(lens.getState().targetElement).toBe(b);

      keydown({ key: "c", metaKey: true });
      await wait(10);
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText.mock.calls[0]![0]).toContain('id="b"');
    });

    it("a right-click on the open menu itself keeps its target", async () => {
      const lens = await setup();
      const a = makeEl("a");
      const b = makeEl("b");
      lens.activate();
      await openMenu(a);
      elementAt = b;
      const item = getShadowRoot().querySelector('[role="menuitem"]')!;
      const event = new MouseEvent("contextmenu", {
        clientX: 12,
        clientY: 12,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      item.dispatchEvent(event);
      await wait(10);
      expect(event.defaultPrevented).toBe(true);
      expect(lens.getState().targetElement).toBe(a);
      expect(getShadowRoot().querySelector('[role="menu"]')).not.toBe(null);
    });

    it("dismissing the menu re-detects under the pointer", async () => {
      const lens = await setup();
      const a = makeEl("a");
      const b = makeEl("b");
      lens.activate();
      await openMenu(a);
      elementAt = b;
      pointerMove(50, 50);
      (getShadowRoot().querySelector(".lens-menu-backdrop") as HTMLElement).click();
      await wait(10);
      expect(getShadowRoot().querySelector('[role="menu"]')).toBe(null);
      expect(lens.getState().targetElement).toBe(b);

      keydown({ key: "c", metaKey: true });
      await wait(10);
      expect(writeText.mock.calls[0]![0]).toContain('id="b"');
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

  describe("context menu single-key shortcuts", () => {
    const registerAction = (lens: SvelteLensAPI, enabled = true) => {
      const onAction = vi.fn();
      lens.registerPlugin({
        name: "shortcut",
        actions: [{ id: "x", label: "Do X", shortcut: "X", enabled, onAction }],
      });
      return onAction;
    };

    it("runs the action for its key, case-insensitively, while the menu is open", async () => {
      const lens = await setup();
      const onAction = registerAction(lens);
      const a = makeEl("a");
      lens.activate();
      await openMenu(a);

      const event = keydown({ key: "x" });
      expect(event.defaultPrevented).toBe(true);
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction.mock.calls[0]![0].element).toBe(a);

      keydown({ key: "X" });
      expect(onAction).toHaveBeenCalledTimes(2);
    });

    it("runs once per press and swallows auto-repeats of a held key", async () => {
      const lens = await setup();
      const onAction = registerAction(lens);
      lens.activate();
      await openMenu(makeEl("a"));

      expect(keydown({ key: "x" }).defaultPrevented).toBe(true);
      for (let i = 0; i < 3; i++) {
        expect(keydown({ key: "x", repeat: true }).defaultPrevented).toBe(true);
      }
      expect(onAction).toHaveBeenCalledTimes(1);

      keydown({ key: "x" });
      expect(onAction).toHaveBeenCalledTimes(2);
    });

    it("ignores the key with modifiers, from inputs, when disabled, or with no menu", async () => {
      const lens = await setup();
      const onAction = registerAction(lens);
      lens.activate();
      elementAt = makeEl("a");
      pointerMove(1, 1);
      expect(keydown({ key: "x" }).defaultPrevented).toBe(false);

      await openMenu(makeEl("b"));
      expect(keydown({ key: "x", metaKey: true }).defaultPrevented).toBe(false);
      expect(keydown({ key: "X", shiftKey: true }).defaultPrevented).toBe(false);
      lens.setOptions({ allowActivationInsideInput: true });
      expect(keydown({ key: "x" }, makeEl("i", "input")).defaultPrevented).toBe(false);
      expect(onAction).not.toHaveBeenCalled();
    });

    it("does not run a disabled action", async () => {
      const lens = await setup();
      const onAction = registerAction(lens, false);
      lens.activate();
      await openMenu(makeEl("a"));
      expect(keydown({ key: "x" }).defaultPrevented).toBe(false);
      expect(onAction).not.toHaveBeenCalled();
    });

    it("'O' opens the element's source in the editor", async () => {
      const openFileInEditor = vi.fn().mockResolvedValue(true);
      vi.doMock("../utils/open-file-in-editor.js", () => ({ openFileInEditor }));
      vi.doMock("../core/source.js", async (importOriginal) => ({
        ...(await importOriginal<typeof import("../core/source.js")>()),
        resolveSource: vi.fn().mockResolvedValue({
          filePath: "/src/App.svelte",
          lineNumber: 3,
          componentName: "App",
        }),
      }));
      try {
        const lens = await setup();
        lens.activate();
        await openMenu(makeEl("a"));
        keydown({ key: "o" });
        await wait(10);
        expect(openFileInEditor).toHaveBeenCalledWith("/src/App.svelte", 3);
        expect(lens.isActive()).toBe(false);
      } finally {
        vi.doUnmock("../utils/open-file-in-editor.js");
        vi.doUnmock("../core/source.js");
      }
    });

    it("leaves Cmd+C to the copy handling", async () => {
      const lens = await setup();
      lens.activate();
      await openMenu(makeEl("a"));
      keydown({ key: "c" });
      await wait(10);
      expect(writeText).not.toHaveBeenCalled();
      keydown({ key: "c", metaKey: true });
      await wait(10);
      expect(writeText).toHaveBeenCalledTimes(1);
    });
  });

  describe("pointer over the lens UI", () => {
    it("clears the target instead of targeting the page element under the toolbar", async () => {
      const lens = await setup();
      const a = makeEl("a");
      const host = document.querySelector(`[${HOST_ATTRIBUTE}]`)!;
      lens.activate();
      elementAt = a;
      pointerMove(1, 1);
      expect(lens.getState().targetElement).toBe(a);

      vi.mocked(document.elementsFromPoint).mockImplementation(() => [host, a]);
      window.dispatchEvent(new Event("scroll"));
      expect(lens.getState().targetElement).toBe(null);
      await wait();
      expect(labelDisplay()).toBe("none");

      keydown({ key: "c", metaKey: true });
      await wait(10);
      expect(writeText).not.toHaveBeenCalled();
    });

    it("a right-click on the menu backdrop still targets the page element under it", async () => {
      const lens = await setup();
      const a = makeEl("a");
      const b = makeEl("b");
      const host = document.querySelector(`[${HOST_ATTRIBUTE}]`)!;
      lens.activate();
      await openMenu(a);
      vi.mocked(document.elementsFromPoint).mockImplementation(() => [host, b]);
      document.dispatchEvent(
        new MouseEvent("contextmenu", {
          clientX: 50,
          clientY: 50,
          bubbles: true,
          cancelable: true,
        }),
      );
      await wait(10);
      expect(lens.getState().targetElement).toBe(b);
    });
  });

  describe("removed target (client-side navigation)", () => {
    it("Cmd+C re-detects under the pointer instead of copying a removed element", async () => {
      const lens = await setup();
      const stale = makeEl("stale");
      lens.activate();
      elementAt = stale;
      pointerMove(1, 1);
      stale.remove();
      elementAt = makeEl("fresh");

      keydown({ key: "c", metaKey: true });
      await wait(10);
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText.mock.calls[0]![0]).toContain('id="fresh"');
      expect(lens.getState().targetElement?.id).toBe("fresh");
    });

    it("Cmd+C copies nothing when nothing is under the pointer any more", async () => {
      const lens = await setup();
      const stale = makeEl("stale");
      lens.activate();
      elementAt = stale;
      pointerMove(1, 1);
      // Remove without a mutation callback having run yet.
      stale.remove();
      elementAt = null;
      const event = keydown({ key: "c", metaKey: true });
      expect(event.defaultPrevented).toBe(false);
      await wait(10);
      expect(writeText).not.toHaveBeenCalled();
      expect(lens.getState().targetElement).toBe(null);
    });

    it("drops the highlight when the target is removed under a stationary pointer", async () => {
      const lens = await setup();
      const stale = makeEl("stale");
      lens.activate();
      elementAt = stale;
      pointerMove(1, 1);
      await wait();
      expect(labelDisplay()).not.toBe("none");

      stale.remove();
      elementAt = null;
      await wait();
      expect(lens.getState().targetElement).toBe(null);
      expect(labelDisplay()).toBe("none");
    });

    it("menu Copy on a removed element closes the menu without copying", async () => {
      const lens = await setup();
      const stale = makeEl("stale");
      lens.activate();
      await openMenu(stale);
      const copyItem = Array.from(getShadowRoot().querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Copy") && b.getAttribute("role") === "menuitem",
      );
      // Detach without letting the mutation observer close the menu first.
      elementAt = null;
      stale.remove();
      copyItem!.click();
      await wait(10);
      expect(writeText).not.toHaveBeenCalled();
      expect(getShadowRoot().querySelector('[role="menu"]')).toBe(null);
      expect(lens.getState().targetElement).toBe(null);
    });

    it("closes the menu when its element is removed", async () => {
      const lens = await setup();
      const stale = makeEl("stale");
      lens.activate();
      await openMenu(stale);
      elementAt = null;
      stale.remove();
      await wait();
      expect(getShadowRoot().querySelector('[role="menu"]')).toBe(null);
      expect(lens.getState().targetElement).toBe(null);
    });
  });
});
