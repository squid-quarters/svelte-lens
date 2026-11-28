import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

test("prerendered cache headers remain attribute data, not executable HTML", async ({ page }) => {
  const html = readFileSync(
    fileURLToPath(
      new URL("../.svelte-kit/output/prerendered/pages/audit-cache.html", import.meta.url),
    ),
    "utf8",
  );
  await page.setContent(html);
  await expect(page.locator('meta[http-equiv="cache-control"]')).toHaveAttribute(
    "content",
    'max-age=300"><script data-cache-probe>window.cacheProbe=true</script>&',
  );
  await expect(page.locator("script[data-cache-probe]")).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "cacheProbe"))).toBeUndefined();
});

for (const path of ["/audit-form", "//attacker.invalid/path"])
  test(`non-redirect enhanced form at ${path} stays on origin`, async ({ page }) => {
    const external: string[] = [];
    let injected = 0;
    await page.route(/^https?:\/\/attacker\.invalid\//, async (route) => {
      external.push(route.request().url());
      await route.abort();
    });
    await page.route(/\/(?:audit-form|\/attacker\.invalid\/path)(?:\?|$)/, async (route) => {
      if (route.request().method() !== "POST" || !route.request().url().includes("/submit"))
        return route.continue();
      expect(route.request().headers()["x-sveltekit-action"]).toBe("true");
      expect(new URL(route.request().url()).pathname).toBe(path);
      const response = await route.fetch();
      const result = await response.json();
      expect(result.type).toBe("success");
      injected++;
      await route.fulfill({ response, json: { ...result, location: "//attacker.invalid/path" } });
    });
    await page.goto(`http://localhost:5174${path}`);
    await page.waitForSelector("[data-svelte-lens]");
    await page.getByRole("button", { name: "Submit probe" }).click();
    await expect(page.getByTestId("form-result")).toHaveText("accepted");
    await expect(page).toHaveURL(`http://localhost:5174${path}`);
    expect(injected).toBe(1);
    expect(external).toEqual([]);
    // A server-directed redirect is still allowed; this is not a blanket navigation block.
    await page.getByRole("button", { name: "Redirect normally" }).click();
    await expect(page).toHaveURL("http://localhost:5174/");
    await expect(page.locator("h1")).toHaveText("svelte-lens playground");
  });
