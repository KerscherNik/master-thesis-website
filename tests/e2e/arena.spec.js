// Fly-through arena interactions on the reel architecture: swaps are crop
// changes (instant, no network), pause is one element, drag-and-drop uses
// real mouse events end to end.
const { test, expect } = require("@playwright/test");
const { pageReady, reelState, canvasLum } = require("./helpers");

const CMP = ".fa-compare";

test.beforeEach(async ({ page }) => {
  await pageReady(page);
  await page.locator("#flythrough-arena").scrollIntoViewIfNeeded();
  await expect.poll(async () => (await reelState(page)).rs, { timeout: 60000 })
    .toBeGreaterThanOrEqual(2);
});

test("starts with SAD vs 3DGS in the ring and the other methods on the bench", async ({ page }) => {
  await expect(page.locator(`${CMP} .ba-label.a`)).toHaveText("SAD (ours)");
  await expect(page.locator(`${CMP} .ba-label.b`)).toHaveText("3DGS");
  await expect(page.locator(".fa-tile")).toHaveCount(2);
  await expect(page.locator('.fa-tile[data-method="mcmc"] .fa-tile-name')).toHaveText("3DGS-MCMC");
  await expect(page.locator('.fa-tile[data-method="fds"] .fa-tile-name')).toHaveText("FDS-GS");
  await expect.poll(() => canvasLum(page, '.fa-tile[data-method="mcmc"] canvas'),
    { timeout: 10000 }).toBeGreaterThan(15);
});

test("fly-through playback is slowed to the configured rate", async ({ page }) => {
  expect((await reelState(page)).rate).toBeCloseTo(0.6, 2);
});

test("tile swap is instant: labels flip, the replaced method benches, no loading", async ({ page }) => {
  const t0 = Date.now();
  await page.locator('.fa-tile[data-method="mcmc"] .fa-swap[data-side="b"]').click();
  await expect(page.locator(`${CMP} .ba-label.b`)).toHaveText("3DGS-MCMC");
  expect(Date.now() - t0).toBeLessThan(1500); // no fetch, no veil
  expect(await page.locator(`${CMP}.fa-loading`).count()).toBe(0);
  await expect(page.locator('.fa-tile[data-method="gs"] .fa-tile-name')).toHaveText("3DGS");
  await expect(page.locator('.fa-tile[data-method="mcmc"]')).toHaveCount(0);
  await expect.poll(() => canvasLum(page, '.fa-tile[data-method="gs"] canvas'),
    { timeout: 5000 }).toBeGreaterThan(15);
});

async function realDragTileTo(page, method, sideFraction) {
  const tile = page.locator(`.fa-tile[data-method="${method}"]`);
  await tile.scrollIntoViewIfNeeded();
  const t = await tile.boundingBox();
  const c = await page.locator(CMP).boundingBox();
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2 + 12, t.y + t.height / 2 - 12, { steps: 4 });
  await page.mouse.move(c.x + c.width * sideFraction, c.y + c.height / 2, { steps: 18 });
  await page.mouse.up();
}

test("real mouse drag-and-drop swaps the dragged method in", async ({ page }) => {
  await realDragTileTo(page, "mcmc", 0.75); // right half
  await expect(page.locator(`${CMP} .ba-label.b`)).toHaveText("3DGS-MCMC");
  await expect(page.locator('.fa-tile[data-method="gs"]')).toHaveCount(1);
});

test("scene tabs swap the reel and keep the method line-up", async ({ page }) => {
  await page.locator('.fa-tile[data-method="fds"] .fa-swap[data-side="a"]').click();
  await expect(page.locator(`${CMP} .ba-label.a`)).toHaveText("FDS-GS");

  await page.locator('[data-fly-scene="garden"]').click();
  await expect(page.locator(CMP)).not.toHaveClass(/fa-loading/, { timeout: 60000 });
  await expect(page.locator(`${CMP} .ba-label.a`)).toHaveText("FDS-GS"); // line-up kept
  const src = await page.evaluate(() => document.querySelector(".fa-reel").src);
  expect(src).toMatch(/^blob:/);
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
  await expect.poll(() => canvasLum(page, ".fa-wipe"), { timeout: 10000 }).toBeGreaterThan(15);
});

test("pausing freezes everything; a paused swap keeps the exact frame", async ({ page }) => {
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
  await page.locator(`${CMP} .ba-playpause`).click();
  const t0 = (await reelState(page)).t;

  await page.locator('.fa-tile[data-method="fds"] .fa-swap[data-side="b"]').click();
  await expect(page.locator(`${CMP} .ba-label.b`)).toHaveText("FDS-GS");
  const st = await reelState(page);
  expect(st.paused).toBe(true);
  expect(Math.abs(st.t - t0)).toBeLessThan(0.05); // same frame, by construction
  expect(await canvasLum(page, ".fa-wipe")).toBeGreaterThan(15); // never black

  await page.locator(`${CMP} .ba-playpause`).click();
  await expect.poll(async () => (await reelState(page)).t, { timeout: 10000 })
    .toBeGreaterThan(t0 + 0.3);
});

test("a failing scene fetch keeps the previous scene alive", async ({ page }) => {
  await page.route("**/grid/flygrid_stump.mp4", r => r.abort());
  await page.route("**/av1/grid/flygrid_stump.mp4", r => r.abort());
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);

  await page.locator('[data-fly-scene="stump"]').click();
  await expect(page.locator(CMP)).not.toHaveClass(/fa-loading/, { timeout: 30000 });
  // the previous reel still paints and plays; the page did not break
  expect(await canvasLum(page, ".fa-wipe")).toBeGreaterThan(15);
  await page.locator('[data-fly-scene="flowers"]').click();
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 30000 }).toBe(true);
});

test("user repro: pause, drag a method in, play - it moves from the frozen frame", async ({ page }) => {
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
  await page.locator(`${CMP} .ba-playpause`).click();
  const tRef = (await reelState(page)).t;

  await realDragTileTo(page, "fds", 0.75);
  await expect(page.locator(`${CMP} .ba-label.b`)).toHaveText("FDS-GS");
  const st = await reelState(page);
  expect(st.paused).toBe(true);
  expect(Math.abs(st.t - tRef)).toBeLessThan(0.05);
  expect(await canvasLum(page, ".fa-wipe")).toBeGreaterThan(15);

  await page.locator(`${CMP} .ba-playpause`).click();
  await expect.poll(async () => (await reelState(page)).t, { timeout: 10000 })
    .toBeGreaterThan(tRef + 0.3);
  expect(await canvasLum(page, ".fa-wipe")).toBeGreaterThan(15);
});
