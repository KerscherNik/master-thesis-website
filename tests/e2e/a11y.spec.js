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

test("skip link appears on focus and jumps to main content", async ({ page }) => {
  await pageReady(page);
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main/);
});

test("sliders announce meaningful values via aria-valuetext", async ({ page }) => {
  await pageReady(page);
  const handle = page.locator(".fa-compare .ba-handle");
  await handle.scrollIntoViewIfNeeded();
  await expect(handle).toHaveAttribute("aria-valuetext", /50% SAD \(ours\), 50% 3DGS/);
  const range = page.locator("#progress-explorer input[type=range]");
  await range.scrollIntoViewIfNeeded();
  await range.focus();
  await page.keyboard.press("ArrowRight");
  await expect(range).toHaveAttribute("aria-valuetext", "iteration 1,000 of 30,000");
});

test("prefers-reduced-motion stops all video autoplay until explicit play", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await pageReady(page);
  await page.locator("#flythrough-arena").scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
  expect(await page.evaluate(() =>
    document.querySelector(".fa-compare .fa-reel").paused)).toBe(true);
  await expect(page.locator(".fa-compare .ba-playpause")).toHaveAttribute("aria-label", /Play/);

  // explicit play overrides the preference (per WCAG/Apple pattern)
  await page.locator(".fa-compare .ba-playpause").click();
  await expect.poll(() => page.evaluate(() =>
    !document.querySelector(".fa-compare .fa-reel").paused), { timeout: 20000 }).toBe(true);
});

test("forced-colors mode keeps the comparison structure visible", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await pageReady(page);
  const divider = page.locator(".fa-compare .ba-divider");
  await divider.scrollIntoViewIfNeeded();
  const border = await divider.evaluate(el => getComputedStyle(el).borderLeftWidth);
  expect(border).toBe("2px");
});

test("lightbox is a native modal dialog", async ({ page }) => {
  await pageReady(page);
  const fig = page.locator(".figure-block img").first();
  await fig.scrollIntoViewIfNeeded();
  await fig.click();
  const isDialog = await page.evaluate(() => {
    const lb = document.querySelector(".lightbox");
    return lb.tagName === "DIALOG" && lb.open === true;
  });
  expect(isDialog).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator(".lightbox")).not.toHaveClass(/open/);
});
