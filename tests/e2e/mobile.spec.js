// Touch-device behaviour, run under real device emulation (see the phone and
// tablet projects in playwright.config.js: isMobile, hasTouch, coarse
// pointer, device pixel ratio). tap() throws without hasTouch, which guards
// these tests from silently running as mouse tests.

const { test, expect } = require("@playwright/test");
const { pageReady } = require("./helpers");

test("loads clean under touch emulation (no console errors)", async ({ page }) => {
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  await pageReady(page);
  await page.evaluate(async () => {
    for (let y = 0; y <= document.body.scrollHeight; y += 700) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 40));
    }
  });
  expect(errors).toEqual([]);
});

test("touch adaptations apply: coarse pointer, tap hint, finger-sized swap buttons", async ({ page }) => {
  await pageReady(page);
  expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true);
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);

  await page.locator("#flythrough-arena").scrollIntoViewIfNeeded();
  await expect(page.locator(".fa-bench-hint .hint-tap")).toBeVisible();
  await expect(page.locator(".fa-bench-hint .hint-drag")).toBeHidden();

  const btn = await page.locator(".fa-swap").first().boundingBox();
  expect(btn.width).toBeGreaterThanOrEqual(32);
  expect(btn.height).toBeGreaterThanOrEqual(32);
});

test("comparison slider follows a tap", async ({ page }) => {
  await pageReady(page);
  const cmp = page.locator(".ba-compare").first();
  await cmp.scrollIntoViewIfNeeded();
  const box = await cmp.boundingBox();
  await cmp.tap({ position: { x: box.width * 0.75, y: box.height / 2 } });
  const pos = +(await cmp.locator(".ba-handle").getAttribute("aria-valuenow"));
  expect(pos).toBeGreaterThan(65);
  expect(pos).toBeLessThan(85);
});

test("comparison slider follows a touch drag", async ({ page }) => {
  await pageReady(page);
  const cmp = page.locator(".ba-compare").first();
  await cmp.scrollIntoViewIfNeeded();
  await cmp.evaluate(el => {
    const r = el.getBoundingClientRect();
    const opts = x => ({
      bubbles: true, pointerId: 1, pointerType: "touch", isPrimary: true,
      clientX: r.left + r.width * x, clientY: r.top + r.height / 2
    });
    el.dispatchEvent(new PointerEvent("pointerdown", opts(0.5)));
    el.dispatchEvent(new PointerEvent("pointermove", opts(0.35)));
    el.dispatchEvent(new PointerEvent("pointermove", opts(0.2)));
    el.dispatchEvent(new PointerEvent("pointerup", opts(0.2)));
  });
  const pos = +(await cmp.locator(".ba-handle").getAttribute("aria-valuenow"));
  expect(pos).toBeGreaterThan(12);
  expect(pos).toBeLessThan(28);
});

test("slider drag does not hijack page scrolling (touch-action pan-y)", async ({ page }) => {
  await pageReady(page);
  const ta = await page.locator(".ba-compare").first()
    .evaluate(el => getComputedStyle(el).touchAction);
  expect(ta).toBe("pan-y");
});

test("arena works by tap: scene tabs and method swap", async ({ page }) => {
  await pageReady(page);
  await page.locator("#flythrough-arena").scrollIntoViewIfNeeded();

  await page.locator('#flythrough-arena [data-fly-scene="garden"]').tap();
  await expect(page.locator('#flythrough-arena [data-fly-scene="garden"]')).toHaveClass(/active/);
  expect(await page.evaluate(() =>
    document.querySelector(".fa-compare")._compare.srcs[0])).toContain("garden");

  await page.locator('.fa-tile[data-method="mcmc"] .fa-swap[data-side="b"]').tap();
  await expect(page.locator(".fa-compare .ba-label.b")).toHaveText("3DGS-MCMC");
  await expect(page.locator('.fa-tile[data-method="gs"]')).toHaveCount(1);
});

test("progress explorer: frames stack on narrow screens, keyboard seeks", async ({ page }) => {
  await pageReady(page);
  await page.locator("#progress-explorer").scrollIntoViewIfNeeded();

  const viewport = page.viewportSize();
  const cols = await page.evaluate(() =>
    getComputedStyle(document.querySelector(".pe-pair")).gridTemplateColumns.split(" ").length);
  expect(cols).toBe(viewport.width <= 640 ? 1 : 2);

  const slider = page.locator("#progress-explorer input[type=range]");
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".pe-iter")).toHaveText("iteration 1,000");
});

test("lightbox: tap to open, big close target, backdrop tap closes", async ({ page }) => {
  await pageReady(page);
  const tile = page.locator('.fa-tile[data-method="mcmc"]');
  await tile.scrollIntoViewIfNeeded();
  await expect(tile).toHaveClass(/loaded/, { timeout: 60000 });
  await tile.locator(".fa-tile-media").tap();

  const lb = page.locator(".lightbox");
  await expect(lb).toHaveClass(/open/);
  const close = await page.locator(".lb-close").boundingBox();
  expect(close.width).toBeGreaterThanOrEqual(40);
  expect(close.height).toBeGreaterThanOrEqual(40);

  await lb.tap({ position: { x: 8, y: 8 } }); // backdrop corner
  await expect(lb).not.toHaveClass(/open/);
});

test("landscape orientation has no overflow either", async ({ page }) => {
  const { width, height } = page.viewportSize();
  await page.setViewportSize({ width: height, height: width });
  await pageReady(page);
  await page.evaluate(async () => {
    for (let y = 0; y <= document.body.scrollHeight; y += 700) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 30));
    }
  });
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});

test.describe("reduced motion", () => {
  test("animations and smooth scrolling are disabled", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/index.html");
    expect(await page.evaluate(() =>
      matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    const styles = await page.evaluate(() => {
      const probe = document.querySelector(".loader-fill") || document.body;
      return {
        scroll: getComputedStyle(document.documentElement).scrollBehavior,
        transition: getComputedStyle(probe).transitionDuration
      };
    });
    expect(styles.scroll).toBe("auto");
    expect(styles.transition).toBe("0s");
  });
});
