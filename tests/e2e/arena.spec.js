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
  // the sync engine nudges the follower's rate up to +-12% around the base
  // while converging drift; the master stays exactly at the configured rate
  expect(rates[1]).toBe(0.6);
  expect(rates[0]).toBeGreaterThanOrEqual(0.6 * 0.88 - 1e-9);
  expect(rates[0]).toBeLessThanOrEqual(0.6 * 1.12 + 1e-9);
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

test("pausing the ring pauses the bench, and a paused swap stays paused and frame-aligned", async ({ page }) => {
  // wait for the ring to actually play
  await expect.poll(() => pairPlaying(page), { timeout: 60000 }).toBe(true);
  await expect(page.locator('.fa-tile[data-method="mcmc"]')).toHaveClass(/loaded/, { timeout: 60000 });

  await page.locator(".fa-compare .ba-playpause").click();

  // ring and every bench tile freeze
  await expect.poll(() => page.evaluate(() =>
    [...document.querySelectorAll(".fa-compare video, .fa-bench video")]
      .every(v => v.paused)), { timeout: 5000 }).toBe(true);
  const tRef = await page.evaluate(() =>
    document.querySelectorAll(".fa-compare video")[1].currentTime);

  // swap while paused: still paused everywhere, new side aligned to the frozen frame
  await page.locator('.fa-tile[data-method="mcmc"] .fa-swap[data-side="b"]').click();
  await expect.poll(() => page.evaluate(() => {
    const [a, b] = document.querySelectorAll(".fa-compare video");
    return b.readyState >= 2 && a.paused && b.paused;
  }), { timeout: 60000 }).toBe(true);
  const after = await page.evaluate(() => {
    const [a, b] = document.querySelectorAll(".fa-compare video");
    return { tB: b.currentTime, benchPaused: [...document.querySelectorAll(".fa-bench video")].every(v => v.paused) };
  });
  expect(Math.abs(after.tB - tRef)).toBeLessThan(0.2); // frame-aligned swap
  expect(after.benchPaused).toBe(true);

  // resume: ring and bench play again
  await page.locator(".fa-compare .ba-playpause").click();
  await expect.poll(() => pairPlaying(page), { timeout: 15000 }).toBe(true);
  await expect.poll(() => page.evaluate(() =>
    [...document.querySelectorAll(".fa-bench video")]
      .filter(v => v.readyState >= 2).some(v => !v.paused)), { timeout: 15000 }).toBe(true);
});

test("swaps compose: every method can reach the ring", async ({ page }) => {
  await page.locator('.fa-tile[data-method="mcmc"] .fa-swap[data-side="b"]').click(); // MCMC replaces 3DGS
  await expect(page.locator('.fa-tile[data-method="gs"]')).toHaveCount(1);
  await page.locator('.fa-tile[data-method="gs"] .fa-swap[data-side="a"]').click(); // 3DGS replaces SAD
  await expect(page.locator(".fa-compare .ba-label.a")).toHaveText("3DGS");
  await expect(page.locator(".fa-compare .ba-label.b")).toHaveText("3DGS-MCMC");
  await expect(page.locator('.fa-tile[data-method="sad"] .fa-tile-name')).toHaveText("SAD (ours)");
});

test("a failing video fetch during swap degrades gracefully, arena survives", async ({ page }) => {
  await pageReady(page);
  await page.locator(ARENA).scrollIntoViewIfNeeded();
  await expect.poll(() => pairPlaying(page), { timeout: 60000 }).toBe(true);

  // kill both codec variants of the incoming method mid-session
  await page.route("**/flythrough_mcmc_flowers.mp4", r => r.abort());
  await page.route("**/av1/flythrough_mcmc_flowers.mp4", r => r.abort());
  await page.evaluate(() => { /* forget any prefetched copy */
    const el = document.querySelector(".fa-compare");
    el._compare.srcs; /* touch */
  });
  await page.locator('.fa-tile[data-method="mcmc"] .fa-swap[data-side="b"]').click();
  await page.waitForTimeout(4000); // includes the one auto-retry

  const state = await page.evaluate(() => {
    const el = document.querySelector(".fa-compare");
    const [a] = el.querySelectorAll("video");
    return {
      arenaAlive: !!el.querySelector(".ba-handle") && el.querySelectorAll("video").length === 2,
      labelB: el.querySelector(".ba-label.b").textContent,
      leftStillPlays: !a.paused
    };
  });
  expect(state.arenaAlive).toBe(true);      // never wiped
  expect(state.labelB).toBe("3DGS-MCMC");   // UI state consistent
  expect(state.leftStillPlays).toBe(true);  // healthy side unaffected
});

/* Real HTML5 drag-and-drop through actual mouse input (Chromium performs
   native DnD for draggable elements on mouse gestures), as opposed to the
   synthetic-event test above which only exercises the handler wiring. */
async function realDragTileTo(page, method, sideFraction) {
  const tile = page.locator(`.fa-tile[data-method="${method}"]`);
  await tile.scrollIntoViewIfNeeded();
  const t = await tile.boundingBox();
  const c = await page.locator(".fa-compare").boundingBox();
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2 + 12, t.y + t.height / 2 - 12, { steps: 4 });
  await page.mouse.move(c.x + c.width * sideFraction, c.y + c.height / 2, { steps: 18 });
  await page.mouse.up();
}

test("real mouse drag-and-drop swaps the dragged method in", async ({ page }) => {
  await realDragTileTo(page, "mcmc", 0.75); // right half
  await expect(page.locator(".fa-compare .ba-label.b")).toHaveText("3DGS-MCMC");
  await expect(page.locator('.fa-tile[data-method="gs"]')).toHaveCount(1);
});

test("user repro: pause, drag a method in, play - both sides move from the frozen frame", async ({ page }) => {
  await expect.poll(() => pairPlaying(page), { timeout: 60000 }).toBe(true);
  await expect(page.locator('.fa-tile[data-method="fds"]')).toHaveClass(/loaded/, { timeout: 60000 });

  await page.locator(".fa-compare .ba-playpause").click();
  await expect.poll(() => page.evaluate(() =>
    [...document.querySelectorAll(".fa-compare video")].every(v => v.paused)),
    { timeout: 5000 }).toBe(true);
  const tRef = await page.evaluate(() =>
    document.querySelectorAll(".fa-compare video")[1].currentTime);

  await realDragTileTo(page, "fds", 0.75);
  await expect(page.locator(".fa-compare .ba-label.b")).toHaveText("FDS-GS");

  // incoming video lands on the frozen frame, still paused
  await expect.poll(() => page.evaluate(() => {
    const [a, b] = document.querySelectorAll(".fa-compare video");
    return b.readyState >= 2 && a.paused && b.paused;
  }), { timeout: 60000 }).toBe(true);
  const aligned = await page.evaluate(() => {
    const [a, b] = document.querySelectorAll(".fa-compare video");
    return { tA: a.currentTime, tB: b.currentTime };
  });
  expect(Math.abs(aligned.tB - tRef)).toBeLessThan(0.2);
  expect(Math.abs(aligned.tA - tRef)).toBeLessThan(0.2);

  // play: BOTH sides must advance together (the bug was one frozen side)
  await page.locator(".fa-compare .ba-playpause").click();
  await expect.poll(() => page.evaluate(() =>
    [...document.querySelectorAll(".fa-compare video")].every(v => !v.paused)),
    { timeout: 20000 }).toBe(true);
  await page.waitForTimeout(2000);
  const after = await page.evaluate(() => {
    const [a, b] = document.querySelectorAll(".fa-compare video");
    return { tA: a.currentTime, tB: b.currentTime,
             drift: Math.abs(a.currentTime - b.currentTime) };
  });
  expect(after.tA).toBeGreaterThan(tRef + 0.4);
  expect(after.tB).toBeGreaterThan(tRef + 0.4);
  expect(after.drift).toBeLessThan(0.25);
});
