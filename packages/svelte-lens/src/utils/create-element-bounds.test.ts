import { describe, it, expect } from "vitest";
import { createElementBounds } from "./create-element-bounds.js";

describe("createElementBounds", () => {
  it("returns bounds from getBoundingClientRect", () => {
    const div = document.createElement("div");
    div.style.position = "absolute";
    div.style.left = "10px";
    div.style.top = "20px";
    div.style.width = "100px";
    div.style.height = "50px";
    document.body.appendChild(div);

    const bounds = createElementBounds(div);
    expect(bounds).toHaveProperty("x");
    expect(bounds).toHaveProperty("y");
    expect(bounds).toHaveProperty("width");
    expect(bounds).toHaveProperty("height");
    expect(bounds).toHaveProperty("borderRadius");
    div.remove();
  });

  it("preserves authored stylesheet borderRadius and subsequent style changes", () => {
    const style = document.createElement("style");
    style.textContent = ".bounds-target { border-radius: 8px; }";
    const div = document.createElement("div");
    div.className = "bounds-target";
    document.head.appendChild(style);
    document.body.appendChild(div);
    try {
      expect(createElementBounds(div).borderRadius).toBe("8px");
      style.textContent = ".bounds-target { border-radius: 12px; }";
      expect(createElementBounds(div).borderRadius).toBe("12px");
    } finally {
      div.remove();
      style.remove();
    }
  });
});
