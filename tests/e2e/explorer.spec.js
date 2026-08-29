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

function times(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("#progress-explorer video")].map(v => v.currentTime));
}

test.beforeEach(async ({ page }) => {
  await pageReady(page);
  await page.locator(EXPLORER).scrollIntoViewIfNeeded();
  // both progress videos decoded and seekable
  await expect.poll(() => page.evaluate(() =>
    [...document.querySelectorAll("#progress-explorer video")]
      .every(v => v.readyState >= 2)), { timeout: 30000 }).toBe(true);
});

test("renders one tick per checkpoint and starts at iteration 500", async ({ page }) => {
  await expect(page.locator(`${EXPLORER} .pe-tick`)).toHaveCount(11);
  await expect(page.locator(`${EXPLORER} .pe-iter`)).toHaveText("iteration 500");
});

test("scrubbing the timeline seeks both methods to the same checkpoint", async ({ page }) => {
  await setSlider(page, 6);
  await expect(page.locator(`${EXPLORER} .pe-iter`)).toHaveText("iteration 10,000");
  await expect.poll(async () => {
    const [a, b] = await times(page);
    return Math.abs(a - 4.55) < 0.1 && Math.abs(b - 4.55) < 0.1;
  }, { timeout: 10000 }).toBe(true);
});

test("switching scene keeps the selected checkpoint", async ({ page }) => {
  await setSlider(page, 8);
  await expect(page.locator(`${EXPLORER} .pe-iter`)).toHaveText("iteration 20,000");

  await page.locator(`${EXPLORER} .pe-tab[data-scene="bicycle"]`).click();
  await expect(page.locator(`${EXPLORER} .pe-tab[data-scene="bicycle"]`)).toHaveClass(/active/);
  await expect(page.locator(`${EXPLORER} .pe-iter`)).toHaveText("iteration 20,000");

  await expect.poll(async () => {
    const ts = await times(page);
    return ts.every(t => Math.abs(t - (8 * 21 + 10.5) / 30) < 0.1);
  }, { timeout: 15000 }).toBe(true);
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
  for (const f of ["progress_sad_truck.mp4", "progress_3dgs_truck.mp4"]) {
    await page.route(`**/videos/${f}`, handler);
    await page.route(`**/videos/av1/${f}`, handler);
  }
  await pageReady(page);

  await page.locator(`${EXPLORER} [data-scene="truck"]`).click();
  // no data yet: honest loading state instead of a silent freeze
  await expect(page.locator(EXPLORER)).toHaveClass(/pe-loading/, { timeout: 5000 });
  await expect(page.locator(`${EXPLORER} .pe-frame .spinner`).first()).toBeVisible();

  release();
  await expect(page.locator(EXPLORER)).not.toHaveClass(/pe-loading/, { timeout: 30000 });
  // both videos sit on the first checkpoint frame (k=0 -> 10.5/30 s)
  await expect.poll(async () => {
    const t = await times(page);
    return t.length === 2 && t.every(x => Math.abs(x - 0.35) < 0.1);
  }, { timeout: 10000 }).toBe(true);
});
