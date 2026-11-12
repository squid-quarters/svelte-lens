import { expect, it } from "vitest";
import { resolveSource } from "../core/source.js";

it("already resolves unannotated static children through their annotated ancestor", async () => {
  const parent = document.createElement("section");
  const child = document.createElement("p");
  Reflect.set(parent, "__svelte_meta", {
    loc: { file: "/src/Parent.svelte", line: 12, column: 3 },
  });
  parent.appendChild(child);
  document.body.appendChild(parent);
  try {
    expect(await resolveSource(child)).toMatchObject({
      filePath: "/src/Parent.svelte",
      lineNumber: 12,
      columnNumber: 4,
    });
  } finally {
    parent.remove();
  }
});
