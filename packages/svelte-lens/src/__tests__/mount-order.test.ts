import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HOST_ATTRIBUTE } from "../constants.js";

// Svelte runs a child's onMount before its parent's, so on a hard page load
// a page component's init() runs before the root layout's Quick Start init().
describe("init() from a page mounted before the root layout", () => {
  let target: HTMLElement;

  beforeEach(() => {
    vi.resetModules();
    for (const el of document.querySelectorAll(`[${HOST_ATTRIBUTE}]`)) el.remove();
    delete window.__SVELTE_LENS__;
    target = document.createElement("div");
    document.body.appendChild(target);
  });

  afterEach(() => {
    window.__SVELTE_LENS__?.dispose();
    target.remove();
  });

  it("keeps svelte-lens running when the page unmounts", async () => {
    // After resetModules, load svelte with the component so both share one runtime.
    const { flushSync, mount, unmount } = await import("svelte");
    const { default: Layout } = await import("./fixtures/MountOrderLayout.svelte");
    const order: string[] = [];
    (globalThis as { __mountOrder?: string[] }).__mountOrder = order;
    const app = mount(Layout, { target });
    flushSync();
    // The ordering this test is about.
    expect(order).toEqual(["page", "layout"]);

    const lens = window.__SVELTE_LENS__!;
    expect(lens.getPlugins()).toContain("page-plugin");

    // Navigating away unmounts the page, which disposes its handle.
    app.hidePage();
    flushSync();

    expect(lens.isEnabled()).toBe(true);
    expect(window.__SVELTE_LENS__).toBe(lens);
    expect(document.querySelectorAll(`[${HOST_ATTRIBUTE}]`).length).toBe(1);
    expect(lens.getPlugins()).not.toContain("page-plugin");
    expect(lens.getPlugins()).toEqual(expect.arrayContaining(["copy", "open"]));

    unmount(app);
  });
});
