import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import ContextMenu from "./ContextMenu.svelte";
import { VIEWPORT_MARGIN_PX } from "../constants.js";
import type { ActionContext, ContextMenuAction, Position } from "../types.js";

const MENU_WIDTH = 160;
const MENU_HEIGHT = 64;

const actions: ContextMenuAction[] = [
  { id: "copy", label: "Copy", onAction: () => {} },
  { id: "open", label: "Open", onAction: () => {} },
];

const renderMenu = (position: Position) => {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const component = mount(ContextMenu, {
    target,
    props: {
      position,
      actions,
      actionContext: {} as ActionContext,
      onDismiss: () => {},
    },
  });
  flushSync();
  const menu = target.querySelector<HTMLElement>(".lens-menu")!;
  return { component, target, menu };
};

describe("ContextMenu", () => {
  let mounted: ReturnType<typeof renderMenu> | null = null;

  beforeEach(() => {
    vi.stubGlobal("innerWidth", 1000);
    vi.stubGlobal("innerHeight", 800);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: MENU_WIDTH,
      bottom: MENU_HEIGHT,
      width: MENU_WIDTH,
      height: MENU_HEIGHT,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    if (mounted) {
      unmount(mounted.component);
      mounted.target.remove();
      mounted = null;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders at the click position when the menu fits", () => {
    mounted = renderMenu({ x: 100, y: 200 });
    expect(mounted.menu.style.left).toBe("100px");
    expect(mounted.menu.style.top).toBe("200px");
  });

  it("keeps the menu inside the viewport near the bottom-right edge", () => {
    mounted = renderMenu({ x: 990, y: 790 });
    expect(mounted.menu.style.left).toBe(`${1000 - MENU_WIDTH - VIEWPORT_MARGIN_PX}px`);
    expect(mounted.menu.style.top).toBe(`${800 - MENU_HEIGHT - VIEWPORT_MARGIN_PX}px`);
  });

  it("clamps against the scrollbar-free viewport when classic scrollbars are shown", () => {
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(983);
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(783);
    mounted = renderMenu({ x: 990, y: 790 });
    expect(mounted.menu.style.left).toBe(`${983 - MENU_WIDTH - VIEWPORT_MARGIN_PX}px`);
    expect(mounted.menu.style.top).toBe(`${783 - MENU_HEIGHT - VIEWPORT_MARGIN_PX}px`);
  });

  it("re-clamps an open menu when the viewport shrinks", () => {
    mounted = renderMenu({ x: 700, y: 600 });
    expect(mounted.menu.style.left).toBe("700px");

    vi.stubGlobal("innerWidth", 600);
    vi.stubGlobal("innerHeight", 500);
    window.dispatchEvent(new Event("resize"));
    flushSync();

    expect(mounted.menu.style.left).toBe(`${600 - MENU_WIDTH - VIEWPORT_MARGIN_PX}px`);
    expect(mounted.menu.style.top).toBe(`${500 - MENU_HEIGHT - VIEWPORT_MARGIN_PX}px`);
  });
});
