import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copyToClipboard } from "./copy-to-clipboard.js";

describe("copyToClipboard", () => {
  it("uses navigator.clipboard.writeText when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const result = await copyToClipboard("hello");
    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when clipboard API fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });

    // jsdom doesn't have execCommand, so we define it on Document.prototype
    const execMock = vi.fn().mockReturnValue(true);
    Document.prototype.execCommand = execMock;
    const result = await copyToClipboard("fallback");
    expect(result).toBe(true);
    expect(execMock).toHaveBeenCalledWith("copy");
    delete (Document.prototype as unknown as Record<string, unknown>).execCommand;
  });

  it("returns false when both methods fail", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });

    const execMock = vi.fn().mockReturnValue(false);
    Document.prototype.execCommand = execMock;
    const result = await copyToClipboard("fails");
    expect(result).toBe(false);
    delete (Document.prototype as unknown as Record<string, unknown>).execCommand;
  });

  describe("execCommand fallback", () => {
    let select: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      Object.assign(navigator, { clipboard: undefined });
      Document.prototype.execCommand = vi.fn().mockReturnValue(true);
      // jsdom's select() neither focuses nor touches the page selection;
      // mimic what browsers do.
      select = vi.spyOn(HTMLTextAreaElement.prototype, "select").mockImplementation(function (
        this: HTMLTextAreaElement,
      ) {
        this.focus();
        document.getSelection()?.removeAllRanges();
      });
    });

    afterEach(() => {
      select.mockRestore();
      document.body.replaceChildren();
      delete (Document.prototype as unknown as Record<string, unknown>).execCommand;
      Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    });

    it("gives focus back to the previously focused element", async () => {
      const button = document.createElement("button");
      document.body.append(button);
      button.focus();

      expect(await copyToClipboard("fallback")).toBe(true);
      expect(document.activeElement).toBe(button);
      expect(document.querySelector("textarea")).toBe(null);
    });

    it("restores the page selection", async () => {
      const text = document.createElement("p");
      text.textContent = "selected text";
      document.body.append(text);
      const range = document.createRange();
      range.selectNodeContents(text);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);

      expect(await copyToClipboard("fallback")).toBe(true);
      expect(document.getSelection()?.rangeCount).toBe(1);
      expect(document.getSelection()?.getRangeAt(0).startContainer).toBe(text);
    });
  });
});
