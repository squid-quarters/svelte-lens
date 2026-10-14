export const copyToClipboard = async (content: string): Promise<boolean> => {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(content);
      return true;
    } catch {
      // fall through to legacy path
    }
  }
  if (typeof document === "undefined") return false;
  // select() moves focus and replaces the page selection; save both so the
  // host app gets them back after the copy.
  const previouslyFocused = document.activeElement;
  const selection = document.getSelection();
  const savedRanges: Range[] = [];
  if (selection) {
    for (let i = 0; i < selection.rangeCount; i++) savedRanges.push(selection.getRangeAt(i));
  }
  const textarea = document.createElement("textarea");
  textarea.value = content;
  // readonly keeps mobile keyboards from opening.
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  let ok = false;
  try {
    textarea.select();
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    textarea.remove();
    if (selection) {
      selection.removeAllRanges();
      for (const range of savedRanges) selection.addRange(range);
    }
    if (previouslyFocused instanceof HTMLElement && previouslyFocused !== document.body) {
      previouslyFocused.focus({ preventScroll: true });
    }
  }
  return ok;
};
