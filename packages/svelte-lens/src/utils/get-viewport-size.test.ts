import { afterEach, describe, expect, it, vi } from "vitest";
import { getViewportSize } from "./get-viewport-size.js";

describe("getViewportSize", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("excludes classic scrollbars by using the root element's client size", () => {
    vi.stubGlobal("innerWidth", 1280);
    vi.stubGlobal("innerHeight", 720);
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1263);
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(703);
    expect(getViewportSize()).toEqual({ width: 1263, height: 703 });
  });

  it("falls back to the window size when layout reports 0", () => {
    vi.stubGlobal("innerWidth", 1000);
    vi.stubGlobal("innerHeight", 800);
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(0);
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(0);
    expect(getViewportSize()).toEqual({ width: 1000, height: 800 });
  });
});
