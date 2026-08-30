const { test, expect } = require("@playwright/test");
const { pageReady } = require("./helpers");

const EXPLORER = "#progress-explorer";

async function setSlider(page, value) {
  await page.evaluate((v) => {
    const s = document.querySelector("#progress-explorer input[type=range]");
    s.value = v;
    s.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

/* one reel drives both panes; its clock is the only clock */
function reelTime(page) {
  return page.evaluate(() =>
    document.querySelector("#progress-explorer .pe-reel").currentTime);
}

test.beforeEach(async ({ page }) => {
  await pageReady(page);
  await page.locator(EXPLORER).scrollIntoViewIfNeeded();
  // the pair reel decoded and unveiled
  await expect(page.locator(EXPLORER)).not.toHaveClass(/pe-loading/, { timeout: 30000 });
});

test("renders one tick per checkpoint and starts at iteration 500", async ({ page }) => {
  await expect(page.locator(`${EXPLORER} .pe-tick`)).toHaveCount(11);
  await expect(page.locator(`${EXPLORER} .pe-iter`)).toHaveText("iteration 500");
});

test("scrubbing the timeline seeks both methods to the same checkpoint", async ({ page }) => {
  await setSlider(page, 6);
  await expect(page.locator(`${EXPLORER} .pe-iter`)).toHaveText("iteration 10,000");
  await expect.poll(async () => Math.abs(await reelTime(page) - 4.55) < 0.1,
    { timeout: 10000 }).toBe(true);
});

test("switching scene keeps the selected checkpoint", async ({ page }) => {
  await setSlider(page, 8);
  await expect(page.locator(`${EXPLORER} .pe-iter`)).toHaveText("iteration 20,000");

  await page.locator(`${EXPLORER} .pe-tab[data-scene="bicycle"]`).click();
  await expect(page.locator(`${EXPLORER} .pe-tab[data-scene="bicycle"]`)).toHaveClass(/active/);
  await expect(page.locator(`${EXPLORER} .pe-iter`)).toHaveText("iteration 20,000");

  await expect.poll(async () =>
    Math.abs(await reelTime(page) - (8 * 21 + 10.5) / 30) < 0.1,
    { timeout: 15000 }).toBe(true);
});

test("play steps through checkpoints, pause halts it", async ({ page }) => {
  const label = page.locator(`${EXPLORER} .pe-iter`);
  const play = page.locator(`${EXPLORER} .pe-play`);

  await play.click(); // play
  await expect.poll(() => label.textContent(), { timeout: 5000 }).not.toBe("iteration 500");

  await play.click(); // pause
  const frozen = await label.textContent();
  await page.waitForTimeout(1200);
  await expect(label).toHaveText(frozen);
});

test("scrubbing while playing stops playback", async ({ page }) => {
  await page.locator(`${EXPLORER} .pe-play`).click();
  await page.waitForTimeout(900);
  await setSlider(page, 3);
  await expect(page.locator(`${EXPLORER} .pe-iter`)).toHaveText("iteration 3,000");
  await page.waitForTimeout(1200);
  await expect(page.locator(`${EXPLORER} .pe-iter`)).toHaveText("iteration 3,000");
});

test("scene switch on a slow connection shows spinners, then lands on the checkpoint", async ({ page }) => {
  // beforeEach already navigated; arm gated routes and load again so the
  // truck files are held from the start
  let release;
  const held = new Promise(res => { release = res; });
  const handler = async route => { await held; await route.continue().catch(() => {}); };
  await page.route("**/grid/proggrid_truck.mp4", handler);
  await page.route("**/av1/grid/proggrid_truck.mp4", handler);
  await pageReady(page);

  await page.locator(`${EXPLORER} [data-scene="truck"]`).click();
  // no data yet: honest loading state instead of a silent freeze
  await expect(page.locator(EXPLORER)).toHaveClass(/pe-loading/, { timeout: 5000 });
  await expect(page.locator(`${EXPLORER} .pe-frame .spinner`).first()).toBeVisible();

  release();
  await expect(page.locator(EXPLORER)).not.toHaveClass(/pe-loading/, { timeout: 30000 });
  // the reel sits on the first checkpoint frame (k=0 -> 10.5/30 s)
  await expect.poll(async () => Math.abs(await reelTime(page) - 0.35) < 0.1,
    { timeout: 10000 }).toBe(true);
});

test("the two panes sit side by side on desktop, reel takes no cell", async ({ page }) => {
  const boxes = await page.evaluate(() => {
    const [a, b] = document.querySelectorAll("#progress-explorer .pe-frame");
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return { aTop: ra.top, bTop: rb.top, aLeft: ra.left, bLeft: rb.left, aW: ra.width };
  });
  expect(Math.abs(boxes.aTop - boxes.bTop)).toBeLessThan(2); // same row
  expect(boxes.bLeft).toBeGreaterThan(boxes.aLeft + boxes.aW * 0.8); // side by side
});

test("scene switch: the veil drops only after the panes are painted", async ({ page }) => {
  let release;
  const held = new Promise(res => { release = res; });
  const handler = async route => { await held; await route.continue().catch(() => {}); };
  await page.route("**/grid/proggrid_bicycle.mp4", handler);
  await page.route("**/av1/grid/proggrid_bicycle.mp4", handler);
  await pageReady(page);
  await page.locator(EXPLORER).scrollIntoViewIfNeeded();
  await expect(page.locator(EXPLORER)).not.toHaveClass(/pe-loading/, { timeout: 30000 });

  await page.locator(`${EXPLORER} [data-scene="bicycle"]`).click();
  await expect(page.locator(EXPLORER)).toHaveClass(/pe-loading/, { timeout: 5000 });
  release();
  await expect(page.locator(EXPLORER)).not.toHaveClass(/pe-loading/, { timeout: 30000 });
  // no grace period: unveiled panes must ALREADY be painted
  const lum = await page.evaluate(() => {
    const c = document.querySelector('canvas[data-role="sad"]');
    const x = document.createElement("canvas"); x.width = 32; x.height = 24;
    const g = x.getContext("2d"); g.drawImage(c, 0, 0, 32, 24);
    const d = g.getImageData(0, 0, 32, 24).data;
    let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i];
    return Math.round(s / (d.length / 4));
  });
  expect(lum).toBeGreaterThan(15);
});
