// State matrix for the reel arena. The old file fought multi-video sync
// races; the reel design removed those states, so this matrix covers what
// remains: loading edges (gated routes), intent during loads, codec
// fallback and recovery, lightbox interplay, reduced motion, lifecycle.
const { test, expect } = require("@playwright/test");
const { pageReady, reelState, canvasLum } = require("./helpers");

const CMP = ".fa-compare";

/* route both codec variants of one grid file; returns a release fn */
async function gate(page, file) {
  let release;
  const held = new Promise(res => { release = res; });
  const handler = async route => { await held; await route.continue().catch(() => {}); };
  await page.route(`**/grid/${file}`, handler);
  await page.route(`**/av1/grid/${file}`, handler);
  return release;
}

async function ready(page) {
  await pageReady(page);
  await page.locator("#flythrough-arena").scrollIntoViewIfNeeded();
  await expect.poll(async () => (await reelState(page)).rs, { timeout: 60000 })
    .toBeGreaterThanOrEqual(2);
}

test("paused scene switch then play: intent applies when the reel arrives", async ({ page }) => {
  const release = await gate(page, "flygrid_bicycle.mp4");
  await ready(page);
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);

  await page.locator(`${CMP} .ba-playpause`).click(); // pause
  await page.locator('[data-fly-scene="bicycle"]').click(); // held fetch
  await expect(page.locator(CMP)).toHaveClass(/fa-loading/);

  // press play while the reel is still loading: intent is recorded, the
  // button flips, and the OLD frame must not start moving
  await page.locator(`${CMP} .ba-playpause`).click();
  await expect(page.locator(`${CMP} .ba-playpause`)).toHaveAttribute("aria-label", /Pause/);
  await page.waitForTimeout(800);
  expect((await reelState(page)).paused).toBe(true); // stale reel frozen

  release();
  await expect(page.locator(CMP)).not.toHaveClass(/fa-loading/, { timeout: 30000 });
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
  await expect.poll(() => canvasLum(page, ".fa-wipe"), { timeout: 10000 }).toBeGreaterThan(15);
});

test("paused scene switch stays paused, keeps the camera position", async ({ page }) => {
  await ready(page);
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
  await page.locator(`${CMP} .ba-playpause`).click();
  const tRef = (await reelState(page)).t;

  await page.locator('[data-fly-scene="garden"]').click();
  await expect(page.locator(CMP)).not.toHaveClass(/fa-loading/, { timeout: 60000 });
  await expect.poll(async () => {
    const st = await reelState(page);
    return st.paused && Math.abs(st.t - tRef) < 0.25 && st.rs >= 2;
  }, { timeout: 15000 }).toBe(true);
  await expect(page.locator(`${CMP} .ba-playpause`)).toHaveAttribute("aria-label", /Play/);
  // the new scene's paused frame is painted (Safari priming path)
  await expect.poll(() => canvasLum(page, ".fa-wipe"), { timeout: 10000 }).toBeGreaterThan(15);
});

test("rapid double scene switch: the last one wins", async ({ page }) => {
  const relGarden = await gate(page, "flygrid_garden.mp4");
  const relTruck = await gate(page, "flygrid_truck.mp4");
  await ready(page);

  await page.locator('[data-fly-scene="garden"]').click();
  await page.locator('[data-fly-scene="truck"]').click();
  relGarden();
  relTruck();
  await expect(page.locator(CMP)).not.toHaveClass(/fa-loading/, { timeout: 60000 });
  await expect(page.locator('[data-fly-scene="truck"]')).toHaveClass(/active/);
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
});

test("lightbox from a tile while paused: reel stays paused, canvas painted", async ({ page }) => {
  await ready(page);
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
  await page.locator(`${CMP} .ba-playpause`).click();
  const tRef = (await reelState(page)).t;

  await page.locator('.fa-tile[data-method="mcmc"] .fa-tile-media').click();
  await expect(page.locator(".lightbox")).toHaveClass(/open/);
  await expect.poll(() => canvasLum(page, ".lightbox .lb-canvas"), { timeout: 10000 })
    .toBeGreaterThan(15); // paused but painted - never black
  expect((await reelState(page)).paused).toBe(true);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const st = await reelState(page);
  expect(st.paused).toBe(true); // closing does not resume
  expect(Math.abs(st.t - tRef)).toBeLessThan(0.05);
});

test("lightbox while playing: the reel keeps driving it; slot videos pause", async ({ page }) => {
  await ready(page);
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
  await page.locator(`${CMP} .ba-expand`).click();
  await expect(page.locator(".lightbox")).toHaveClass(/open/);
  expect((await reelState(page)).paused).toBe(false); // exempt: it drives the canvas
  const t1 = (await reelState(page)).t;
  await page.waitForTimeout(900);
  expect((await reelState(page)).t).not.toBeCloseTo(t1, 1); // actually advancing
  const slotsPlaying = await page.evaluate(() =>
    [...document.querySelectorAll(".video-slot video")].filter(v => !v.paused).length);
  expect(slotsPlaying).toBe(0);
  await page.keyboard.press("Escape");
});

test("grid fetches never ask for AV1 twins (H.264-only by design)", async ({ page }) => {
  const av1Reqs = [];
  page.on("request", r => { if (/av1\/grid\//.test(r.url())) av1Reqs.push(r.url()); });
  await ready(page);
  await page.locator('[data-fly-scene="bicycle"]').click();
  await expect(page.locator(CMP)).not.toHaveClass(/fa-loading/, { timeout: 60000 });
  expect(av1Reqs).toEqual([]);
});

test("an undecodable grid payload recovers behind the veil on refetch", async ({ page }) => {
  // first delivery of the bicycle grid is garbage; the element decode error
  // must trigger a veiled refetch that succeeds
  const garbage = Buffer.from("definitely not an mp4");
  let poisoned = false;
  await page.route("**/grid/flygrid_bicycle.mp4", async r => {
    if (!poisoned) {
      poisoned = true;
      await r.fulfill({ status: 200, contentType: "video/mp4", body: garbage });
    } else {
      await r.continue().catch(() => {});
    }
  });
  await ready(page);
  await page.locator('[data-fly-scene="bicycle"]').click();
  await expect(page.locator(CMP)).not.toHaveClass(/fa-loading/, { timeout: 60000 });
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 30000 }).toBe(true);
  await expect.poll(() => canvasLum(page, ".fa-wipe"), { timeout: 10000 }).toBeGreaterThan(15);
});

test("an on-demand switch parks the background prefetch", async ({ page }) => {
  // hold every non-flowers reel; watch which files get requested
  const reqs = [];
  page.on("request", r => {
    const m = r.url().match(/flygrid_([a-z]+)\.mp4/);
    if (m) reqs.push(m[1]);
  });
  const rel = {};
  for (const s of ["bicycle", "garden", "stump", "truck", "drjohnson"]) {
    rel[s] = await gate(page, `flygrid_${s}.mp4`);
  }
  await ready(page);
  const before = reqs.length;
  await page.locator('[data-fly-scene="truck"]').click();
  await page.waitForTimeout(1200);
  // only truck may join the request log while the user waits
  const added = reqs.slice(before).filter(s => s !== "truck");
  expect(added).toEqual([]);
  for (const s of Object.keys(rel)) rel[s]();
  await expect(page.locator(CMP)).not.toHaveClass(/fa-loading/, { timeout: 60000 });
});

test("reduced motion: nothing plays, the frame still paints, play works", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ready(page);
  await page.waitForTimeout(1500);
  expect((await reelState(page)).paused).toBe(true);
  // primed paused frame - visible content without motion
  await expect.poll(() => canvasLum(page, ".fa-wipe"), { timeout: 10000 }).toBeGreaterThan(15);
  await page.locator(`${CMP} .ba-playpause`).click();
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
});

test("double-click on play/pause settles consistently", async ({ page }) => {
  await ready(page);
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
  await page.locator(`${CMP} .ba-playpause`).dblclick(); // pause+play
  await page.waitForTimeout(1500);
  const st = await reelState(page);
  const btn = await page.locator(`${CMP} .ba-playpause`).getAttribute("aria-label");
  expect(st.paused ? /Play/.test(btn) : /Pause/.test(btn)).toBe(true);
});

test("user pause survives an offscreen round trip", async ({ page }) => {
  await ready(page);
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
  await page.locator(`${CMP} .ba-playpause`).click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1200);
  await page.locator("#flythrough-arena").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  expect((await reelState(page)).paused).toBe(true);
  await expect(page.locator(`${CMP} .ba-playpause`)).toHaveAttribute("aria-label", /Play/);
});

test("the footer names the build", async ({ page }) => {
  await pageReady(page);
  await expect(page.locator(".build-tag")).toHaveText(/build (local|[0-9a-f]{7})/);
});

test("cached scene switch while paused, then play: the press sticks", async ({ page }) => {
  // the priming micro play-pause resolves late on a cached (instant)
  // switch; its deferred pause must not swallow a play pressed meanwhile
  await ready(page);
  await expect.poll(async () => !(await reelState(page)).paused, { timeout: 15000 }).toBe(true);
  await page.locator('[data-fly-scene="bicycle"]').click(); // warm the cache
  await expect(page.locator(CMP)).not.toHaveClass(/fa-loading/, { timeout: 60000 });
  await page.locator('[data-fly-scene="flowers"]').click(); // cached too (loader)
  await expect(page.locator(CMP)).not.toHaveClass(/fa-loading/, { timeout: 60000 });

  await page.locator(`${CMP} .ba-playpause`).click(); // pause
  await page.locator('[data-fly-scene="bicycle"]').click(); // instant, cached
  await page.waitForTimeout(150); // land inside the prime's resolution window
  await page.locator(`${CMP} .ba-playpause`).click(); // play
  await expect.poll(async () => {
    const st = await reelState(page);
    return !st.paused && st.rs >= 2;
  }, { timeout: 5000 }).toBe(true);
  // and it stays playing - no late pause clobbers it
  await page.waitForTimeout(1200);
  expect((await reelState(page)).paused).toBe(false);
});
