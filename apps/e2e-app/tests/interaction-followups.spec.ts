import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("[data-svelte-lens]");
});

test("active inspection right-click does not focus the underlying button", async ({ page }) => {
  const counter = page.locator("button.counter");
  await page.evaluate(() => window.__SVELTE_LENS__!.activate());
  await counter.click({ button: "right" });
  await expect(page.locator(".lens-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".lens-menu")).toBeHidden();
  await expect(counter).not.toBeFocused();
});

test("empty document canvas does not select or copy the html root", async ({ page }) => {
  await page.evaluate(() => {
    document.body.style.height = "100px";
    document.body.style.overflow = "hidden";
    window.__SVELTE_LENS__!.activate();
    return navigator.clipboard.writeText("empty-canvas-sentinel");
  });
  expect(await page.evaluate(() => document.elementFromPoint(5, 700)?.tagName)).toBe("HTML");
  await page.mouse.move(5, 700);
  await expect
    .poll(() =>
      page.evaluate(() => window.__SVELTE_LENS__!.getState().targetElement?.tagName ?? null),
    )
    .toBe(null);
  await page.keyboard.press("Meta+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("empty-canvas-sentinel");
});

test("inspection preserves a separately focused input and Escape closes its menu", async ({
  page,
}) => {
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "previous-focus";
    input.style.cssText = "position:fixed;right:20px;top:20px";
    document.body.appendChild(input);
    input.focus();
    window.__SVELTE_LENS__!.activate();
  });
  const input = page.locator("#previous-focus");
  await page.locator("button.counter").click({ button: "right" });
  await expect(page.locator(".lens-menu")).toBeVisible();
  await expect(input).toBeFocused();
  // Replacing the menu right-clicks its backdrop, not the page target itself.
  const heading = await page.locator("h1").boundingBox();
  await page.mouse.click(heading!.x + 5, heading!.y + 5, { button: "right" });
  await expect(page.locator(".lens-menu")).toBeVisible();
  await expect(input).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => window.__SVELTE_LENS__!.getState().targetElement?.tagName))
    .toBe("H1");
  await page.keyboard.press("Escape");
  await expect(page.locator(".lens-menu")).toBeHidden();
  await expect(input).toBeFocused();
  expect(await page.evaluate(() => window.__SVELTE_LENS__!.isActive())).toBe(false);
});

test("inactive right-click and active primary click retain native button focus", async ({
  page,
}) => {
  const counter = page.locator("button.counter");
  await counter.click({ button: "right" });
  await expect(counter).toBeFocused();
  await expect(page.locator(".lens-menu")).toBeHidden();
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    (document.activeElement as HTMLElement).blur();
    window.__SVELTE_LENS__!.activate();
  });
  await counter.click();
  await expect(counter).toBeFocused();
  await expect(counter).toContainText("Clicked 1 times");
});

test("lens toolbar and menu buttons retain their native focus behavior", async ({ page }) => {
  const toolbar = page.locator("button.lens-toolbar");
  await toolbar.click();
  await expect(toolbar).toBeFocused();
  await page.locator("button.counter").click({ button: "right" });
  const menu = page.locator(".lens-menu");
  await expect(menu).toBeVisible();
  const copy = menu.getByRole("menuitem", { name: /Copy/ });
  await copy.click({ button: "right" });
  await expect(copy).toBeFocused();
  await expect(menu).toBeVisible();
  await copy.click();
  await expect(menu).toBeHidden();
  await expect(page.locator(".lens-label")).toContainText("Copied");
});

test("body targeting and explicit root and array API Copy remain available", async ({ page }) => {
  await page.evaluate(() => window.__SVELTE_LENS__!.activate());
  expect(await page.evaluate(() => document.elementFromPoint(5, 50)?.tagName)).toBe("BODY");
  await page.mouse.move(5, 50);
  await expect
    .poll(() => page.evaluate(() => window.__SVELTE_LENS__!.getState().targetElement?.tagName))
    .toBe("BODY");
  await page.keyboard.press("Meta+c");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("<body");
  expect(
    await page.evaluate(() => window.__SVELTE_LENS__!.copyElement(document.documentElement)),
  ).toBe(true);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("<html");
  expect(
    await page.evaluate(() =>
      window.__SVELTE_LENS__!.copyElement([document.documentElement, document.body]),
    ),
  ).toBe(true);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("<html");
  expect(copied).toContain("<body");
});
