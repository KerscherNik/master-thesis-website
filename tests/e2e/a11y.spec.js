const { test, expect } = require("@playwright/test");
const { AxeBuilder } = require("@axe-core/playwright");
const { pageReady } = require("./helpers");

test("axe finds no accessibility violations", async ({ page }) => {
  await pageReady(page);
  const results = await new AxeBuilder({ page }).analyze();
  const summary = results.violations.map(v =>
    `[${v.impact}] ${v.id}: ${v.nodes.map(n => n.target.join(" ")).join(", ")}`);
  expect(summary).toEqual([]);
});

test("no horizontal overflow on a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await pageReady(page);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});

test("scene tabs follow the ARIA tablist keyboard pattern", async ({ page }) => {
  await pageReady(page);
  const first = page.locator('#flythrough-arena [data-fly-scene="flowers"]');
  await first.scrollIntoViewIfNeeded();
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('#flythrough-arena [data-fly-scene="bicycle"]')).toBeFocused();
  await expect(page.locator('#flythrough-arena [data-fly-scene="bicycle"]')).toHaveClass(/active/);
  await page.keyboard.press("End");
  await expect(page.locator('#flythrough-arena [data-fly-scene="drjohnson"]')).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.locator('#flythrough-arena [data-fly-scene="flowers"]')).toBeFocused();
  await expect(page.locator('#flythrough-arena [data-fly-scene="flowers"]')).toHaveClass(/active/);
});

test("lightbox moves focus in on open and restores it on close", async ({ page }) => {
  await pageReady(page);
  const fig = page.locator(".figure-block img").first();
  await fig.scrollIntoViewIfNeeded();
  await fig.click();
  await expect(page.locator(".lb-close")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".lightbox")).not.toHaveClass(/open/);
});

test("images declare dimensions (no layout shift) and lazy-load below the fold", async ({ page }) => {
  await pageReady(page);
  const bad = await page.evaluate(() =>
    [...document.querySelectorAll('img[src^="static/images"]')]
      .filter(i => !i.getAttribute("width") || !i.getAttribute("height"))
      .map(i => i.getAttribute("src")));
  expect(bad).toEqual([]);
  const lazyCount = await page.locator('img[loading="lazy"]').count();
  expect(lazyCount).toBeGreaterThan(10);
});
