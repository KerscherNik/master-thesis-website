const { test, expect } = require("@playwright/test");
const { pageReady } = require("./helpers");

const ARENA = "#flythrough-arena";

function currentSrcs(page) {
  return page.evaluate(() =>
    document.querySelector(".fa-compare")._compare.srcs);
}

function pairPlaying(page) {
  return page.evaluate(() => {
    const el = document.querySelector(".fa-compare");
    const [a, b] = el.querySelectorAll("video");
    return !a.paused && !b.paused && a.readyState >= 2 && b.readyState >= 2;
  });
}

test.beforeEach(async ({ page }) => {
  await pageReady(page);
  await page.locator(ARENA).scrollIntoViewIfNeeded();
});

test("starts with SAD vs 3DGS in the ring and the other methods on the bench", async ({ page }) => {
  await expect(page.locator(".fa-compare .ba-label.a")).toHaveText("SAD (ours)");
  await expect(page.locator(".fa-compare .ba-label.b")).toHaveText("3DGS");
  expect(await currentSrcs(page)).toEqual([
    "static/videos/flythrough_sad_flowers.mp4",
    "static/videos/flythrough_3dgs_flowers.mp4"
  ]);

  // bench holds every method not in the ring, as small draggable tiles
  const expected = await page.evaluate(() => window.SADCore.benchedMethods("sad", "gs"));
  await expect(page.locator(".fa-tile")).toHaveCount(expected.length);
  await expect(page.locator('.fa-tile[data-method="mcmc"] .fa-tile-name')).toHaveText("3DGS-MCMC");
});

test("fly-through playback is slowed to the configured rate", async ({ page }) => {
  const rates = await page.evaluate(() =>
    [...document.querySelectorAll(".fa-compare video")].map(v => v.playbackRate));
  expect(rates).toEqual([0.6, 0.6]);
});

test("tile swap button puts that method in the ring and benches the replaced one", async ({ page }) => {
  await page.locator('.fa-tile[data-method="mcmc"] .fa-swap[data-side="b"]').click();

  await expect(page.locator(".fa-compare .ba-label.b")).toHaveText("3DGS-MCMC");
  await expect(page.locator(".fa-compare .ba-label.a")).toHaveText("SAD (ours)");
  await expect(page.locator('.fa-tile[data-method="gs"] .fa-tile-name')).toHaveText("3DGS");
  expect(await currentSrcs(page)).toEqual([
    "static/videos/flythrough_sad_flowers.mp4",
    "static/videos/flythrough_mcmc_flowers.mp4"
  ]);

  // the ring resumes synced playback with the new method
  await expect.poll(() => pairPlaying(page), { timeout: 60000 }).toBe(true);
  // and the replaced method's fly-through plays on the bench
  await expect(page.locator('.fa-tile[data-method="gs"]')).toHaveClass(/loaded/, { timeout: 60000 });
});

test("drag and drop swaps the dragged method into the chosen side", async ({ page }) => {
  // dragstart reveals the drop zones
  await page.locator('.fa-tile[data-method="mcmc"]').evaluate(el =>
    el.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: new DataTransfer() })));
  await expect(page.locator(ARENA)).toHaveClass(/dragging/);
  await expect(page.locator(".fa-drop.left")).toBeVisible();
  await expect(page.locator(".fa-drop.left")).toContainText("replace SAD (ours)");

  // dropping on the left zone replaces the left method
  await page.locator(".fa-drop.left").evaluate(el =>
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: new DataTransfer() })));
  await expect(page.locator(ARENA)).not.toHaveClass(/dragging/);
  await expect(page.locator(".fa-compare .ba-label.a")).toHaveText("3DGS-MCMC");
  await expect(page.locator('.fa-tile[data-method="sad"] .fa-tile-name')).toHaveText("SAD (ours)");
  expect(await currentSrcs(page)).toEqual([
    "static/videos/flythrough_mcmc_flowers.mp4",
    "static/videos/flythrough_3dgs_flowers.mp4"
  ]);
});

test("scene tabs switch all fly-throughs and keep the method line-up", async ({ page }) => {
  await page.locator(`${ARENA} [data-fly-scene="bicycle"]`).click();
  await expect(page.locator(`${ARENA} [data-fly-scene="bicycle"]`)).toHaveClass(/active/);

  expect(await currentSrcs(page)).toEqual([
    "static/videos/flythrough_sad_bicycle.mp4",
    "static/videos/flythrough_3dgs_bicycle.mp4"
  ]);
  await expect(page.locator(".fa-compare .ba-label.a")).toHaveText("SAD (ours)");

  // bicycle videos are fetched on demand, then the ring plays again
  await expect.poll(() => pairPlaying(page), { timeout: 60000 }).toBe(true);
  await expect(page.locator('.fa-tile[data-method="mcmc"]')).toHaveClass(/loaded/, { timeout: 60000 });
});

test("swaps compose: every method can reach the ring", async ({ page }) => {
  await page.locator('.fa-tile[data-method="mcmc"] .fa-swap[data-side="b"]').click(); // MCMC replaces 3DGS
  await expect(page.locator('.fa-tile[data-method="gs"]')).toHaveCount(1);
  await page.locator('.fa-tile[data-method="gs"] .fa-swap[data-side="a"]').click(); // 3DGS replaces SAD
  await expect(page.locator(".fa-compare .ba-label.a")).toHaveText("3DGS");
  await expect(page.locator(".fa-compare .ba-label.b")).toHaveText("3DGS-MCMC");
  await expect(page.locator('.fa-tile[data-method="sad"] .fa-tile-name')).toHaveText("SAD (ours)");
});
