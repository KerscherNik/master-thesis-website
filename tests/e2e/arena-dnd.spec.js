// Bench drag-and-drop matrix and the painting invariants the reel design
// rests on: every arena surface is a crop of the same decoded frame, so a
// swap, a seek or a resize must leave the tiles and the wipe on that frame -
// including while paused, when nothing else will ever repaint them.
const { test, expect } = require("@playwright/test");
const { pageReady, reelState, canvasLum } = require("./helpers");

const CMP = ".fa-compare";

async function ready(page) {
  await pageReady(page);
  await page.locator("#flythrough-arena").scrollIntoViewIfNeeded();
  await expect.poll(async () => (await reelState(page)).rs, { timeout: 60000 })
    .toBeGreaterThanOrEqual(2);
}

/* real HTML5 drag: mouse down on the tile, cross into the ring, release */
async function dragTile(page, method, sideFraction) {
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

/* Mean absolute difference between a bench tile and the reel quad it crops.
   The tile is rasterised at ~104 px and the reference straight from the
   video, so the two resampling chains never agree exactly: a matching frame
   measures around 13, a stale one (tiles left on the pre-seek frame) around
   53. Anything under 25 is the same frame. */
function tileMatchesReel(page, method) {
  return page.evaluate((method) => {
    const QUADS = window.SADCore.METHOD_QUADS;
    const reel = document.querySelector(".fa-reel");
    const tile = document.querySelector(`.fa-tile[data-method="${method}"] canvas`);
    if (!tile) return -1;
    const W = 24, H = 16;
    const shrink = (draw) => {
      const x = document.createElement("canvas");
      x.width = W; x.height = H;
      const g = x.getContext("2d");
      draw(g);
      return g.getImageData(0, 0, W, H).data;
    };
    const q = QUADS[method];
    const qw = reel.videoWidth / 2, qh = reel.videoHeight / 2;
    const live = shrink(g => g.drawImage(reel, q[0] * qw, q[1] * qh, qw, qh, 0, 0, W, H));
    const shown = shrink(g => g.drawImage(tile, 0, 0, W, H));
    let sum = 0;
    for (let i = 0; i < live.length; i += 4) {
      sum += Math.abs(live[i] - shown[i]) + Math.abs(live[i + 1] - shown[i + 1]) +
             Math.abs(live[i + 2] - shown[i + 2]);
    }
    return sum / (live.length / 4) / 3;
  }, method);
}

test.describe("bench drag-and-drop matrix", () => {
  test.beforeEach(async ({ page }) => { await ready(page); });

  test("every method drags onto either side, mouse, while playing", async ({ page }) => {
    await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);

    // left side: mcmc in, sad benched, then sad back in
    await dragTile(page, "mcmc", 0.2);
    await expect(page.locator(`${CMP} .ba-label.a`)).toHaveText("3DGS-MCMC");
    await expect(page.locator('.fa-tile[data-method="sad"]')).toHaveCount(1);
    await dragTile(page, "sad", 0.2);
    await expect(page.locator(`${CMP} .ba-label.a`)).toHaveText("SAD (ours)");

    // right side: fds in, gs benched, then gs back in
    await dragTile(page, "fds", 0.8);
    await expect(page.locator(`${CMP} .ba-label.b`)).toHaveText("FDS-GS");
    await expect(page.locator('.fa-tile[data-method="gs"]')).toHaveCount(1);
    await dragTile(page, "gs", 0.8);
    await expect(page.locator(`${CMP} .ba-label.b`)).toHaveText("3DGS");

    // the ring never holds the same method twice
    await expect(page.locator(".fa-tile")).toHaveCount(2);
  });

  test("dragging while paused keeps the frozen frame and swaps anyway", async ({ page }) => {
    await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
    await page.locator(`${CMP} .ba-playpause`).click();
    const tRef = (await reelState(page)).t;

    await dragTile(page, "mcmc", 0.2);
    await expect(page.locator(`${CMP} .ba-label.a`)).toHaveText("3DGS-MCMC");
    const st = await reelState(page);
    expect(st.paused).toBe(true);
    expect(Math.abs(st.t - tRef)).toBeLessThan(0.05);
  });

  test("a drag released outside the ring changes nothing and clears the drop zones",
    async ({ page }) => {
      const before = await page.locator(`${CMP} .ba-label.a`).textContent();
      const tile = page.locator('.fa-tile[data-method="mcmc"]');
      const t = await tile.boundingBox();
      const foot = await page.locator("footer, .footer").first().boundingBox();
      await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
      await page.mouse.down();
      await page.mouse.move(t.x + t.width / 2 + 12, t.y + t.height / 2 - 12, { steps: 4 });
      await page.mouse.move(foot.x + foot.width / 2, foot.y + 10, { steps: 12 });
      await page.mouse.up();

      await expect(page.locator(`${CMP} .ba-label.a`)).toHaveText(before);
      await expect(page.locator('.fa-tile[data-method="mcmc"]')).toHaveCount(1);
      // the drop overlays are drag-only chrome: they must not stay up
      await expect(page.locator("#flythrough-arena")).not.toHaveClass(/dragging/);
      await expect(page.locator(".fa-drop.left")).toBeHidden();
    });

  test("swap buttons cover the same matrix by keyboard", async ({ page }) => {
    // Enter on a focused swap button is the drag-free path to both sides
    await page.locator('.fa-tile[data-method="mcmc"] .fa-swap[data-side="a"]').focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(`${CMP} .ba-label.a`)).toHaveText("3DGS-MCMC");
    await page.locator('.fa-tile[data-method="fds"] .fa-swap[data-side="b"]').focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(`${CMP} .ba-label.b`)).toHaveText("FDS-GS");
    await page.locator('.fa-tile[data-method="sad"] .fa-swap[data-side="a"]').focus();
    await page.keyboard.press(" ");
    await expect(page.locator(`${CMP} .ba-label.a`)).toHaveText("SAD (ours)");
  });

  test("a bench tile is reachable and enlargeable by keyboard", async ({ page }) => {
    const media = page.locator('.fa-tile[data-method="mcmc"] .fa-tile-media');
    await media.focus();
    await expect(media).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(".lightbox")).toHaveClass(/open/);
    await page.keyboard.press("Escape");
    await expect(page.locator(".lightbox")).not.toHaveClass(/open/);
  });
});

test.describe("paint invariants: every surface on the same frame", () => {
  test.beforeEach(async ({ page }) => { await ready(page); });

  test("a paused swap paints the newly benched tile immediately", async ({ page }) => {
    await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
    await page.locator(`${CMP} .ba-playpause`).click();
    expect((await reelState(page)).paused).toBe(true);

    // walk four swaps: the tile repaint used to run on every third paint,
    // so a fresh tile stayed black for a third of paused swaps
    const steps = [
      ["fds", "b", "gs"],    // fds into the right side -> 3DGS benched
      ["gs", "b", "fds"],    // and back
      ["mcmc", "a", "sad"],  // mcmc into the left side -> SAD benched
      ["sad", "a", "mcmc"]
    ];
    for (const [method, side, appears] of steps) {
      await page.locator(`.fa-tile[data-method="${method}"] .fa-swap[data-side="${side}"]`).click();
      await expect(page.locator(`.fa-tile[data-method="${appears}"]`)).toHaveCount(1);
      await page.waitForTimeout(250); // two rAF frames are plenty
      expect(await canvasLum(page, `.fa-tile[data-method="${appears}"] canvas`),
        `${appears} tile after a paused swap`).toBeGreaterThan(15);
      expect((await reelState(page)).paused).toBe(true);
    }
  });

  test("a paused seek moves the tiles to the new frame, not just the wipe",
    async ({ page }) => {
      await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
      await page.locator(`${CMP} .ba-playpause`).click();

      for (const frac of [0.6, 0.15, 0.85]) {
        await page.evaluate((f) => {
          const r = document.querySelector(".fa-reel");
          r.currentTime = r.duration * f;
        }, frac);
        // poll rather than sleep: a contended machine can still be decoding
        // the seek. Tiles left on the old frame never converge, because a
        // paused reel is repainted only on request.
        await expect.poll(async () => Math.max(await tileMatchesReel(page, "mcmc"),
                                               await tileMatchesReel(page, "fds")),
          { timeout: 10000, message: `tiles after seeking to ${frac} of the reel` })
          .toBeLessThan(25);
      }
    });

  test("pausing leaves the tiles on the frame the wipe froze on", async ({ page }) => {
    await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
    await page.waitForTimeout(600);
    await page.locator(`${CMP} .ba-playpause`).click();
    await expect.poll(() => tileMatchesReel(page, "mcmc"), { timeout: 10000 })
      .toBeLessThan(25);
  });

  test("the canvases re-rasterise after a resize while paused", async ({ page }) => {
    await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
    await page.locator(`${CMP} .ba-playpause`).click();

    await page.setViewportSize({ width: 480, height: 900 });
    await page.locator("#flythrough-arena").scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    const fit = await page.evaluate(() => {
      const c = document.querySelector(".fa-wipe");
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      return { w: c.width, want: Math.round(c.clientWidth * dpr) };
    });
    // within the painter's own 20% hysteresis
    expect(Math.abs(fit.w - fit.want)).toBeLessThanOrEqual(fit.want * 0.2);
    expect(await canvasLum(page, ".fa-wipe")).toBeGreaterThan(15);
  });
});

test.describe("loading edges", () => {
  test("play works again after a scene fetch failed", async ({ page }) => {
    await page.route("**/grid/flygrid_stump.mp4", r => r.abort());
    await page.route("**/av1/grid/flygrid_stump.mp4", r => r.abort());
    await ready(page);
    await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);

    await page.locator('[data-fly-scene="stump"]').click();
    await expect(page.locator(CMP)).not.toHaveClass(/fa-loading/, { timeout: 30000 });

    // the failed load must not leave a pending-load gate holding the button down
    await page.locator(`${CMP} .ba-playpause`).click(); // pause
    await expect.poll(async () => (await reelState(page)).paused, { timeout: 5000 }).toBe(true);
    await page.locator(`${CMP} .ba-playpause`).click(); // play
    await expect.poll(async () => !(await reelState(page)).paused, { timeout: 10000 }).toBe(true);
  });

  test("a play pressed during a load that then fails is still honoured", async ({ page }) => {
    let fail;
    const held = new Promise(res => { fail = res; });
    const handler = async route => { await held; await route.abort().catch(() => {}); };
    await page.route("**/grid/flygrid_garden.mp4", handler);
    await page.route("**/av1/grid/flygrid_garden.mp4", handler);
    await ready(page);
    await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);

    await page.locator(`${CMP} .ba-playpause`).click(); // pause
    await page.locator('[data-fly-scene="garden"]').click();
    await expect(page.locator(CMP)).toHaveClass(/fa-loading/);
    await page.locator(`${CMP} .ba-playpause`).click(); // play: intent recorded
    await expect(page.locator(`${CMP} .ba-playpause`)).toHaveAttribute("aria-label", /Pause/);

    fail();
    await expect(page.locator(CMP)).not.toHaveClass(/fa-loading/, { timeout: 30000 });
    // the button says "playing"; the reel must agree
    await expect.poll(async () => !(await reelState(page)).paused, { timeout: 10000 }).toBe(true);
  });

  test("a swap during a pending scene load survives the arrival", async ({ page }) => {
    let release;
    const held = new Promise(res => { release = res; });
    const handler = async route => { await held; await route.continue().catch(() => {}); };
    await page.route("**/grid/flygrid_truck.mp4", handler);
    await page.route("**/av1/grid/flygrid_truck.mp4", handler);
    await ready(page);

    await page.locator('[data-fly-scene="truck"]').click();
    await expect(page.locator(CMP)).toHaveClass(/fa-loading/);
    await page.locator('.fa-tile[data-method="fds"] .fa-swap[data-side="a"]').click();
    await expect(page.locator(`${CMP} .ba-label.a`)).toHaveText("FDS-GS");

    release();
    await expect(page.locator(CMP)).not.toHaveClass(/fa-loading/, { timeout: 60000 });
    await expect(page.locator(`${CMP} .ba-label.a`)).toHaveText("FDS-GS");
    await expect(page.locator('.fa-tile[data-method="sad"]')).toHaveCount(1);
    await expect.poll(() => canvasLum(page, ".fa-wipe"), { timeout: 10000 }).toBeGreaterThan(15);
  });
});
