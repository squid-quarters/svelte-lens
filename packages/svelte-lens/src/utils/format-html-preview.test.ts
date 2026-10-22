import { describe, it, expect } from "vitest";
import { formatHtmlPreview } from "./format-html-preview.js";

describe("formatHtmlPreview", () => {
  it("renders a simple div with no content as self-closing", () => {
    const div = document.createElement("div");
    expect(formatHtmlPreview(div)).toBe("<div />");
  });

  it("renders a button with direct text content", () => {
    const button = document.createElement("button");
    button.textContent = "Click me";
    expect(formatHtmlPreview(button)).toBe("<button>Click me</button>");
  });

  it("renders element with id attribute", () => {
    const div = document.createElement("div");
    div.id = "app";
    expect(formatHtmlPreview(div)).toBe('<div id="app" />');
  });

  it("renders element with class attribute", () => {
    const div = document.createElement("div");
    div.className = "container";
    expect(formatHtmlPreview(div)).toBe('<div class="container" />');
  });

  it("renders element with children as count", () => {
    const div = document.createElement("div");
    const child = document.createElement("span");
    div.appendChild(child);
    expect(formatHtmlPreview(div)).toBe("<div>(1 children)</div>");
  });

  it("excludes internal svelte attributes", () => {
    const div = document.createElement("div");
    div.setAttribute("data-svelte-h", "abc");
    expect(formatHtmlPreview(div)).toBe("<div />");
  });

  it("excludes data-svelte-source attribute", () => {
    const div = document.createElement("div");
    div.setAttribute("data-svelte-source", "Counter.svelte:5");
    expect(formatHtmlPreview(div)).toBe("<div />");
  });

  it("renders element with both id and class", () => {
    const div = document.createElement("div");
    div.id = "root";
    div.className = "main";
    expect(formatHtmlPreview(div)).toBe('<div id="root" class="main" />');
  });

  it("renders element with data-testid", () => {
    const div = document.createElement("div");
    div.setAttribute("data-testid", "counter");
    expect(formatHtmlPreview(div)).toBe('<div data-testid="counter" />');
  });

  it("truncates long text content", () => {
    const p = document.createElement("p");
    p.textContent = "a".repeat(200);
    const result = formatHtmlPreview(p);
    expect(result).toContain("...");
    expect(result.length).toBeLessThan(200);
  });

  it("includes the text of inline children such as links", () => {
    const p = document.createElement("p");
    p.innerHTML = 'Visit <a href="/docs">the docs</a> to <strong>learn</strong> more';
    expect(formatHtmlPreview(p)).toBe("<p>Visit the docs to learn more</p>");
  });

  it("joins inline fragments without inventing spaces", () => {
    const span = document.createElement("span");
    span.innerHTML = "<b>Hel</b>lo";
    expect(formatHtmlPreview(span)).toBe("<span>Hello</span>");
  });

  it("does not pull text up from block children", () => {
    const div = document.createElement("div");
    div.innerHTML = "<p>Nested paragraph</p>";
    expect(formatHtmlPreview(div)).toBe("<div>(1 children)</div>");
  });

  it("notes block children that the text leaves out", () => {
    const a = document.createElement("a");
    a.innerHTML = "<div>Title</div><span>Sub</span>";
    expect(formatHtmlPreview(a)).toBe("<a>Sub (+1 children)</a>");
  });

  it("does not count line breaks, icons, images or inputs as left-out children", () => {
    const cases: Array<[string, string, string]> = [
      ["p", "text<br>more", "<p>text more</p>"],
      ["button", "<svg></svg>Save", "<button>Save</button>"],
      ["label", '<input type="checkbox"> Remember me', "<label>Remember me</label>"],
      ["a", "<img>Home", "<a>Home</a>"],
    ];
    for (const [tag, html, expected] of cases) {
      const el = document.createElement(tag);
      el.innerHTML = html;
      expect(formatHtmlPreview(el)).toBe(expected);
    }
  });
});
