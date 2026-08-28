const { test, expect } = require("@playwright/test");
const { pageReady } = require("./helpers");

test.beforeEach(async ({ page }) => { await pageReady(page); });

test("dragging the divider moves the comparison position", async ({ page }) => {
  const cmp = page.locator(".ba-compare").first();
  await cmp.scrollIntoViewIfNeeded();
  const box = await cmp.boundingBox();

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  const pos = +(await cmp.getAttribute("aria-valuenow"));
  expect(pos).toBeGreaterThan(15);
  expect(pos).toBeLessThan(35);
});

test("arrow keys move the divider", async ({ page }) => {
  const cmp = page.locator(".ba-compare").first();
  await cmp.scrollIntoViewIfNeeded();
  await cmp.focus();
  const before = +(await cmp.getAttribute("aria-valuenow"));
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  const after = +(await cmp.getAttribute("aria-valuenow"));
  expect(after).toBe(before + 6);
});

test("comparison labels name both methods", async ({ page }) => {
  const cmp = page.locator(".ba-compare").first();
  await expect(cmp.locator(".ba-label.a")).toContainText("SAD");
  await expect(cmp.locator(".ba-label.b")).toContainText("3DGS");
});

test("expand button opens the comparison in a lightbox, Escape closes it", async ({ page }) => {
  const cmp = page.locator(".ba-compare").first();
  await cmp.scrollIntoViewIfNeeded();
  await cmp.locator(".ba-expand").click();

  const lb = page.locator(".lightbox");
  await expect(lb).toHaveClass(/open/);
  await expect(lb.locator(".ba-compare")).toHaveCount(1);
  await expect(lb.locator("img")).toHaveCount(2);

  await page.keyboard.press("Escape");
  await expect(lb).not.toHaveClass(/open/);
  await expect(page.locator("body")).not.toHaveClass(/no-scroll/);
});

test("result figures open in an image lightbox on click", async ({ page }) => {
  const fig = page.locator(".figure-block img").first();
  await fig.scrollIntoViewIfNeeded();
  await fig.click();

  const lb = page.locator(".lightbox");
  await expect(lb).toHaveClass(/open/);
  const src = await lb.locator("img").first().getAttribute("src");
  expect(src).toContain("density_map");

  await lb.locator(".lb-close").click();
  await expect(lb).not.toHaveClass(/open/);
});
