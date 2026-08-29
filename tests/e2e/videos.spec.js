// Reel fundamentals: one hidden video drives every arena surface as canvas
// crops of the same decoded frame, so "sync" has no failure modes to test -
// these cover playback, pausing, looping, painting and lifecycle instead.
const { test, expect } = require("@playwright/test");
const { pageReady, reelState, canvasLum } = require("./helpers");

test.beforeEach(async ({ page }) => {
  await pageReady(page);
  await page.locator("#flythrough-arena").scrollIntoViewIfNeeded();
  await expect.poll(async () => (await reelState(page)).rs, { timeout: 60000 })
    .toBeGreaterThanOrEqual(2);
});

test("reel plays at the configured rate and paints the wipe and tiles", async ({ page }) => {
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
  const st = await reelState(page);
  expect(st.rate).toBeCloseTo(0.6, 2);
  await expect.poll(() => canvasLum(page, ".fa-wipe"), { timeout: 10000 }).toBeGreaterThan(15);
  expect(await canvasLum(page, '.fa-tile[data-method="mcmc"] canvas')).toBeGreaterThan(15);
  expect(await canvasLum(page, '.fa-tile[data-method="fds"] canvas')).toBeGreaterThan(15);
});

test("pause freezes the clock, play resumes it", async ({ page }) => {
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
  await page.click(".fa-compare .ba-playpause");
  const t1 = (await reelState(page)).t;
  await page.waitForTimeout(1200);
  const st = await reelState(page);
  expect(st.paused).toBe(true);
  expect(Math.abs(st.t - t1)).toBeLessThan(0.05);
  // the frozen frame stays on screen
  expect(await canvasLum(page, ".fa-wipe")).toBeGreaterThan(15);

  await page.click(".fa-compare .ba-playpause");
  await expect.poll(async () => (await reelState(page)).t, { timeout: 10000 })
    .toBeGreaterThan(t1 + 0.3);
});

test("the reel loops without stalling", async ({ page }) => {
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
  // 8 s video at 0.6x: watching for a wrap needs patience; force one instead
  await page.evaluate(() => {
    const r = document.querySelector(".fa-reel");
    r.currentTime = Math.max(0, r.duration - 0.4);
  });
  await expect.poll(async () => {
    const st = await reelState(page);
    return !st.paused && st.t < 2; // wrapped and kept going
  }, { timeout: 10000 }).toBe(true);
  expect(await canvasLum(page, ".fa-wipe")).toBeGreaterThan(15);
});

test("tile preview opens a canvas lightbox driven by the same reel", async ({ page }) => {
  await page.locator('.fa-tile[data-method="mcmc"] .fa-tile-media').click();
  await expect(page.locator(".lightbox")).toHaveClass(/open/);
  await expect.poll(() => canvasLum(page, ".lightbox .lb-canvas"), { timeout: 10000 })
    .toBeGreaterThan(15);
  // the reel keeps playing behind it - it IS the lightbox's source
  expect((await reelState(page)).paused).toBe(false);
  await page.keyboard.press("Escape");
  await expect(page.locator(".lightbox")).not.toHaveClass(/open/);
});

test("reel pauses offscreen and resumes when scrolled back", async ({ page }) => {
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(async () => (await reelState(page)).paused, { timeout: 10000 }).toBe(true);
  await page.locator("#flythrough-arena").scrollIntoViewIfNeeded();
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 10000 }).toBe(true);
});

test("simulated bfcache restore resumes playback", async ({ page }) => {
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
  await page.evaluate(() => {
    document.querySelectorAll("video").forEach(v => v.pause());
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 10000 }).toBe(true);
});
