import { describe, it, expect, vi } from "vitest";
import { getElementAtPosition } from "./get-element-at-position.js";
import { HOST_ATTRIBUTE } from "../constants.js";

describe("getElementAtPosition", () => {
  it("returns null when no elements found at position", () => {
    vi.spyOn(Document.prototype, "elementsFromPoint").mockReturnValue([]);
    expect(getElementAtPosition(0, 0)).toBe(null);
    vi.restoreAllMocks();
  });

  it("returns the topmost element", () => {
    const target = document.createElement("button");
    const below = document.createElement("div");
    document.body.appendChild(target);
    document.body.appendChild(below);

    vi.spyOn(Document.prototype, "elementsFromPoint").mockReturnValue([target, below]);
    expect(getElementAtPosition(10, 10)).toBe(target);

    target.remove();
    below.remove();
    vi.restoreAllMocks();
  });

  it("returns null when the lens UI is topmost, not the page element under it", () => {
    const host = document.createElement("div");
    host.setAttribute(HOST_ATTRIBUTE, "true");
    const hostChild = document.createElement("span");
    host.appendChild(hostChild);
    const target = document.createElement("div");
    document.body.appendChild(host);
    document.body.appendChild(target);

    vi.spyOn(Document.prototype, "elementsFromPoint").mockReturnValue([host, target]);
    expect(getElementAtPosition(10, 10)).toBe(null);
    vi.spyOn(Document.prototype, "elementsFromPoint").mockReturnValue([hostChild, host, target]);
    expect(getElementAtPosition(10, 10)).toBe(null);

    host.remove();
    target.remove();
    vi.restoreAllMocks();
  });

  it("looks through the lens UI to the first page element with throughLensUi", () => {
    const host = document.createElement("div");
    host.setAttribute(HOST_ATTRIBUTE, "true");
    const hostChild = document.createElement("span");
    host.appendChild(hostChild);
    const target = document.createElement("div");
    document.body.appendChild(host);
    document.body.appendChild(target);

    vi.spyOn(Document.prototype, "elementsFromPoint").mockReturnValue([hostChild, host, target]);
    expect(getElementAtPosition(10, 10, { throughLensUi: true })).toBe(target);

    host.remove();
    target.remove();
    vi.restoreAllMocks();
  });

  it("returns null for non-finite coordinates", () => {
    expect(getElementAtPosition(NaN, 0)).toBe(null);
    expect(getElementAtPosition(0, Infinity)).toBe(null);
  });
});
