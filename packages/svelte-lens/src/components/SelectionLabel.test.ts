import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import SelectionLabel from "./SelectionLabel.svelte";
import type { Bounds } from "../types.js";

const LABEL_WIDTH = 120;

type LabelProps = {
  visible: boolean;
  bounds: Bounds | null;
  tagName: string | null;
  componentName: string | null;
  status: "idle" | "copying" | "copied" | "error";
  statusText?: string;
};

const bounds = (x: number, y: number): Bounds => ({
  x,
  y,
  width: 40,
  height: 20,
  borderRadius: "0px",
});

const renderLabel = (props: LabelProps) => {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const component = mount(SelectionLabel, { target, props });
  flushSync();
  const label = target.querySelector<HTMLElement>(".lens-label")!;
  return { component, target, label };
};

describe("SelectionLabel", () => {
  let mounted: ReturnType<typeof renderLabel> | null = null;

  beforeEach(() => {
    vi.stubGlobal("innerWidth", 1000);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: LABEL_WIDTH,
      bottom: 20,
      width: LABEL_WIDTH,
      height: 20,
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

  it("does not repeat the tag name when no component name is resolved", () => {
    mounted = renderLabel({
      visible: true,
      bounds: bounds(100, 100),
      tagName: "button",
      componentName: null,
      status: "idle",
    });
    expect(mounted.label.textContent?.trim()).toBe("button");
    expect(mounted.label.querySelector(".lens-label-name")).toBeNull();
  });

  it("shows the component name next to the tag name", () => {
    mounted = renderLabel({
      visible: true,
      bounds: bounds(100, 100),
      tagName: "button",
      componentName: "Counter",
      status: "idle",
    });
    expect(mounted.label.querySelector(".lens-label-tag")?.textContent).toBe("button");
    expect(mounted.label.querySelector(".lens-label-name")?.textContent).toBe("Counter");
  });

  it("keeps the label at the element's left edge when it fits", () => {
    mounted = renderLabel({
      visible: true,
      bounds: bounds(100, 100),
      tagName: "div",
      componentName: "Card",
      status: "idle",
    });
    expect(mounted.label.style.left).toBe("100px");
  });

  it("clamps the label inside the viewport near the right edge", () => {
    mounted = renderLabel({
      visible: true,
      bounds: bounds(980, 100),
      tagName: "button",
      componentName: null,
      status: "copied",
    });
    expect(mounted.label.style.left).toBe(`${1000 - LABEL_WIDTH - 4}px`);
  });

  it("clamps against the scrollbar-free viewport when classic scrollbars are shown", () => {
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(983);
    mounted = renderLabel({
      visible: true,
      bounds: bounds(980, 100),
      tagName: "button",
      componentName: null,
      status: "copied",
    });
    expect(mounted.label.style.left).toBe(`${983 - LABEL_WIDTH - 4}px`);
  });
});
