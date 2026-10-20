import { describe, it, expect } from "vitest";
import { matchesLetter } from "./matches-letter.js";

const keydown = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent("keydown", init);

describe("matchesLetter", () => {
  it("matches the typed letter case-insensitively", () => {
    expect(matchesLetter(keydown({ key: "G", code: "KeyG" }), "g")).toBe(true);
  });

  it("falls back to the physical key for a non-letter glyph", () => {
    expect(matchesLetter(keydown({ key: "©", code: "KeyG" }), "g")).toBe(true);
  });

  it("does not fall back when another letter was typed", () => {
    expect(matchesLetter(keydown({ key: "i", code: "KeyG" }), "g")).toBe(false);
  });

  it("does not fall back under AltGr", () => {
    const event = keydown({ key: "]", code: "KeyG" });
    Object.defineProperty(event, "getModifierState", {
      value: (state: string) => state === "AltGraph",
    });
    expect(matchesLetter(event, "g")).toBe(false);
  });
});
