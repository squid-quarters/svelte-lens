import { describe, it, expect } from "vitest";
import { resolveSource, resolveStack } from "./source.js";

interface Meta {
  loc: { file: string; line: number; column: number };
  parent: Parent | null;
}
interface Parent {
  file: string;
  line: number;
  column: number;
  componentTag: string;
  parent: Parent | null;
}

const elementWithMeta = (meta: Meta): Element => {
  const element = document.createElement("button");
  Object.assign(element, { __svelte_meta: meta });
  return element;
};

// What SvelteKit's root renders a route with: a dynamic `<Component>`.
const kitRoot = (file: string): Parent => ({
  file,
  line: 10,
  column: 2,
  componentTag: "Component",
  parent: null,
});

describe("source resolution", () => {
  it("names a SvelteKit route component after its file", async () => {
    const element = elementWithMeta({
      loc: { file: "src/routes/about/+page.svelte", line: 3, column: 0 },
      parent: kitRoot("node_modules/@sveltejs/kit/src/runtime/components/svelte-5/root.svelte"),
    });
    const source = await resolveSource(element);
    expect(source?.componentName).toBe("+page");
    expect(source?.filePath).toBe("src/routes/about/+page.svelte");
  });

  it("drops dependency and generated SvelteKit frames from the stack", async () => {
    const element = elementWithMeta({
      loc: { file: "src/lib/Counter.svelte", line: 4, column: 2 },
      parent: {
        file: "src/routes/+page.svelte",
        line: 7,
        column: 0,
        componentTag: "Counter",
        parent: {
          ...kitRoot(".svelte-kit/generated/root.svelte"),
          parent: kitRoot("node_modules/@sveltejs/kit/src/runtime/components/svelte-5/root.svelte"),
        },
      },
    });
    const stack = await resolveStack(element);
    expect(stack.map((frame) => frame.filePath)).toEqual([
      "src/lib/Counter.svelte",
      "src/routes/+page.svelte",
    ]);
    expect(stack[0]?.componentName).toBe("Counter");
  });

  it("keeps the element's own frame when it is inside a dependency", async () => {
    const element = elementWithMeta({
      loc: { file: "node_modules/ui-kit/Button.svelte", line: 2, column: 0 },
      parent: {
        file: "src/routes/+page.svelte",
        line: 5,
        column: 0,
        componentTag: "Button",
        parent: null,
      },
    });
    const stack = await resolveStack(element);
    expect(stack[0]?.filePath).toBe("node_modules/ui-kit/Button.svelte");
    expect(stack).toHaveLength(2);
  });
});
