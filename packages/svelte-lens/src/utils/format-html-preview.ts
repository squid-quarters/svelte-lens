import { PREVIEW_TEXT_MAX_LENGTH, INTERNAL_ATTRIBUTES } from "../constants.js";
import { getTagName } from "./get-tag-name.js";
import { truncateString } from "./truncate-string.js";

/** Escape characters that are significant in HTML attribute/text contexts. */
const escapeHtml = (str: string): string =>
  str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const PRIORITY_ATTRS: ReadonlyArray<string> = [
  "id",
  "data-testid",
  "data-test",
  "name",
  "role",
  "aria-label",
  "type",
  "href",
];

const formatAttrs = (element: Element): string => {
  const parts: string[] = [];
  for (const { name, value } of Array.from(element.attributes)) {
    if (INTERNAL_ATTRIBUTES.has(name)) continue;
    if (name === "class" || name === "style") continue;
    if (PRIORITY_ATTRS.includes(name) || value) {
      const valueText = truncateString(value, 60);
      parts.push(value ? ` ${name}="${escapeHtml(valueText)}"` : ` ${name}`);
    }
  }
  const classValue = element.getAttribute("class");
  if (classValue) parts.push(` class="${escapeHtml(truncateString(classValue, 60))}"`);
  return parts.join("");
};

// Inline (phrasing) elements whose text reads as part of the parent's, e.g.
// the link in <p>Visit <a>the docs</a> today</p>.
const INLINE_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "cite",
  "code",
  "data",
  "dfn",
  "em",
  "i",
  "kbd",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
]);

// The element's own text, including inline descendants', plus how many block
// (non-inline) descendants were left out of it.
const getDirectText = (element: Element): { text: string; blockCount: number } => {
  let text = "";
  let blockCount = 0;
  const collect = (parent: Element): void => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent ?? "";
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const child = node as Element;
        if (INLINE_TAGS.has(getTagName(child))) {
          collect(child);
        } else {
          // Summarised by count below; keep a word break.
          blockCount += 1;
          text += " ";
        }
      }
    }
  };
  collect(element);
  return { text: text.replace(/\s+/g, " ").trim(), blockCount };
};

export const formatHtmlPreview = (element: Element): string => {
  const tagName = getTagName(element);
  const attrs = formatAttrs(element);
  const direct = getDirectText(element);
  const text = truncateString(direct.text, PREVIEW_TEXT_MAX_LENGTH);
  if (text) {
    // Note block children the text leaves out, e.g. <a><div>Title</div>Sub</a>.
    const more = direct.blockCount > 0 ? ` (+${direct.blockCount} children)` : "";
    return `<${tagName}${attrs}>${escapeHtml(text)}${more}</${tagName}>`;
  }
  const childCount = element.children.length;
  if (childCount > 0) {
    return `<${tagName}${attrs}>(${childCount} children)</${tagName}>`;
  }
  return `<${tagName}${attrs} />`;
};
