// Degraded-environment behaviour: no JavaScript, a leftover service worker
// from the old caching deploy, assets that 404, and screens the page was not
// laid out for (high DPR, resized mid-session).
const { test, expect } = require("@playwright/test");
const { pageReady, reelState, canvasLum } = require("./helpers");

test.describe("no JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the page is readable without scripts and the loader gets out of the way",
    async ({ page }) => {
      await page.goto("/index.html");
      // the noscript style takes the overlay down and unlocks scrolling
      await expect(page.locator("#loader")).toBeHidden();
      expect(await page.evaluate(() =>
        getComputedStyle(document.body).overflow)).toBe("auto");

      await expect(page.locator(".hero h1")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Abstract" })).toBeVisible();
      // the comparison images are plain <img> until JS enhances them
      await expect(page.locator(".ba-compare img").first()).toBeVisible();
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBe(0);
    });
});

test.describe("service worker posture", () => {
  test("a visit leaves no worker and no cache behind", async ({ page }) => {
    await pageReady(page);
    const state = await page.evaluate(async () => ({
      regs: (await navigator.serviceWorker.getRegistrations()).length,
      caches: (await caches.keys()).length
    }));
    expect(state).toEqual({ regs: 0, caches: 0 });
  });

  test("a leftover worker and its caches from the old deploy are cleaned up",
    async ({ page }) => {
      await page.goto("/index.html");
      // recreate what a visitor pinned to the caching deploy carries
      await page.evaluate(async () => {
        const c = await caches.open("sad-page-v1");
        await c.put(new Request(location.origin + "/index.html"),
                    new Response("stale html from an old deploy"));
        try { await navigator.serviceWorker.register("/sw.js"); } catch (e) { /* raced */ }
      });

      await pageReady(page);
      await expect.poll(() => page.evaluate(async () => ({
        regs: (await navigator.serviceWorker.getRegistrations()).length,
        caches: (await caches.keys()).length
      })), { timeout: 20000 }).toEqual({ regs: 0, caches: 0 });

      // and the page really came from the network, not from that cache
      await expect(page.locator(".hero h1")).toBeVisible();
    });
});

test.describe("broken assets", () => {
  test("a 404 grid reel still reveals the page and other scenes work",
    async ({ page }) => {
      // 404 exercises the !res.ok branch; the existing specs abort instead
      for (const p of ["**/grid/flygrid_flowers.mp4", "**/av1/grid/flygrid_flowers.mp4"]) {
        await page.route(p, r => r.fulfill({ status: 404, contentType: "text/plain", body: "no" }));
      }
      const errors = [];
      page.on("pageerror", e => errors.push("pageerror: " + e.message));

      await pageReady(page);
      await page.locator("#flythrough-arena").scrollIntoViewIfNeeded();
      await page.locator('[data-fly-scene="truck"]').click();
      await expect(page.locator(".fa-compare")).not.toHaveClass(/fa-loading/, { timeout: 60000 });
      await expect.poll(async () => (await reelState(page)).rs, { timeout: 30000 })
        .toBeGreaterThanOrEqual(2);
      await expect.poll(() => canvasLum(page, ".fa-wipe"), { timeout: 10000 }).toBeGreaterThan(15);
      expect(errors).toEqual([]);
    });

  test("a 404 image does not stall the loader", async ({ page }) => {
    await page.route("**/images/teaser/*", r =>
      r.fulfill({ status: 404, contentType: "text/plain", body: "no" }));
    // the loader counts images by completion, error included, so it finishes
    await pageReady(page);
    await expect(page.locator(".hero h1")).toBeVisible();
  });

  test("a truncated grid reel is rejected rather than half-decoded", async ({ page }) => {
    // Content-Length says one thing, the body another: the streaming reader
    // must notice instead of handing a short blob to the decoder
    await page.route("**/grid/flygrid_bicycle.mp4", async route => {
      const res = await route.fetch();
      const body = await res.body();
      await route.fulfill({
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": String(body.length) },
        body: body.subarray(0, Math.floor(body.length / 3))
      });
    });
    await pageReady(page);
    await page.locator("#flythrough-arena").scrollIntoViewIfNeeded();
    await expect.poll(async () => (await reelState(page)).rs, { timeout: 60000 })
      .toBeGreaterThanOrEqual(2);

    await page.locator('[data-fly-scene="bicycle"]').click();
    await expect(page.locator(".fa-compare")).not.toHaveClass(/fa-loading/, { timeout: 60000 });
    // the flowers reel is still on screen and alive
    expect(await canvasLum(page, ".fa-wipe")).toBeGreaterThan(15);
  });
});

test.describe("high device pixel ratio", () => {
  test.use({ deviceScaleFactor: 2 });

  test("the arena canvases are rasterised for the screen, capped at 2x",
    async ({ page }) => {
      await pageReady(page);
      await page.locator("#flythrough-arena").scrollIntoViewIfNeeded();
      await expect.poll(async () => (await reelState(page)).rs, { timeout: 60000 })
        .toBeGreaterThanOrEqual(2);
      await expect.poll(() => canvasLum(page, ".fa-wipe"), { timeout: 15000 }).toBeGreaterThan(15);

      const fit = await page.evaluate(() => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const read = (sel) => {
          const c = document.querySelector(sel);
          return { w: c.width, h: c.height, want: Math.round(c.clientWidth * dpr) };
        };
        return { dpr: window.devicePixelRatio, wipe: read(".fa-wipe"),
                 tile: read('.fa-tile[data-method="mcmc"] canvas') };
      });
      expect(fit.dpr).toBe(2);
      for (const c of [fit.wipe, fit.tile]) {
        // the painter re-fits outside a 20% band, so that is the tolerance
        expect(Math.abs(c.w - c.want)).toBeLessThanOrEqual(c.want * 0.2);
        // and the crop keeps the quad's aspect ratio (956 x 630)
        expect(c.w / c.h).toBeCloseTo(956 / 630, 1);
      }
    });
});

test.describe("timeline scrubber keyboard control", () => {
  test("arrows, Home and End step and bound the checkpoint", async ({ page }) => {
    await pageReady(page);
    await page.locator("#progress-explorer").scrollIntoViewIfNeeded();
    const range = page.locator("#progress-explorer input[type=range]");
    const iter = page.locator("#progress-explorer .pe-iter");
    await range.focus();

    await page.keyboard.press("End");
    await expect(iter).toHaveText("iteration 30,000");
    await expect(range).toHaveAttribute("aria-valuetext", "iteration 30,000 of 30,000");

    await page.keyboard.press("ArrowLeft");
    await expect(iter).toHaveText("iteration 25,000");

    await page.keyboard.press("Home");
    await expect(iter).toHaveText("iteration 500");
    // already at the floor: another step must not walk off the end
    await page.keyboard.press("ArrowLeft");
    await expect(iter).toHaveText("iteration 500");

    // the reel followed the keyboard, not just the label
    await expect.poll(() => page.evaluate(() =>
      document.querySelector("#progress-explorer .pe-reel").currentTime),
      { timeout: 10000 }).toBeCloseTo(10.5 / 30, 1);
  });

  test("a keyboard seek stops the automatic play-through", async ({ page }) => {
    await pageReady(page);
    await page.locator("#progress-explorer").scrollIntoViewIfNeeded();
    await page.locator("#progress-explorer .pe-play").click();
    await page.waitForTimeout(900);

    await page.locator("#progress-explorer input[type=range]").focus();
    await page.keyboard.press("Home");
    await expect(page.locator("#progress-explorer .pe-play"))
      .toHaveAttribute("aria-label", /Play/);
    await expect(page.locator("#progress-explorer .pe-iter")).toHaveText("iteration 500");
    await page.waitForTimeout(1300);
    await expect(page.locator("#progress-explorer .pe-iter")).toHaveText("iteration 500");
  });
});
