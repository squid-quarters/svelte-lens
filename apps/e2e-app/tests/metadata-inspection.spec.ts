import { test, expect } from "@playwright/test";

test("explicit client-rendered inspection restores exact child metadata", async ({ page }) => {
  const html = await (await page.request.get("/metadata-inspect")).text();
  expect(html).not.toContain('data-testid="trailing-source"');
  await page.goto("/metadata-inspect");
  await page.waitForSelector("[data-svelte-lens]");
  const result = await page.evaluate(async () => {
    const target = document.querySelector('[data-testid="trailing-source"]')!;
    return {
      meta: Reflect.get(target, "__svelte_meta")?.loc,
      source: await window.__SVELTE_LENS__!.getSource(target),
    };
  });
  expect(result.meta.file).toContain("MetadataProbe.svelte");
  expect(result.meta.line).toBe(7);
  expect(result.meta.column).toBe(0);
  expect(result.source?.filePath).toContain("MetadataProbe.svelte");
  expect(result.source?.lineNumber).toBe(7);
  expect(result.source?.columnNumber).toBe(1);
});

test("the normal route retains development SSR", async ({ page }) => {
  const html = await (await page.request.get("/metadata-hydrated")).text();
  expect(html).toContain('data-testid="trailing-source"');
  await page.goto("/metadata-hydrated");
  await expect(page.getByTestId("trailing-source")).toHaveText("Exact trailing source location");
  await expect(page.locator("button.lens-toolbar")).toBeVisible();
});
