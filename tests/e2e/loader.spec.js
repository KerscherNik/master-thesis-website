const { test, expect } = require("@playwright/test");
const { pageReady } = require("./helpers");

test("loader shows, finishes, and hands the pair blob-backed sources", async ({ page }) => {
  await page.goto("/index.html");
  // Either we catch the overlay mid-flight or it already finished on a fast
  // local disk; the end state is what matters.
  await expect(page.locator("#loader")).toHaveCount(0, { timeout: 60000 });
  await expect(page.locator("body")).not.toHaveClass(/loading/);

  // the arena reel (the one video behind every comparison surface) is
  // blob-backed, so playback and seeks never touch the network
  const src = await page.evaluate(() => document.querySelector(".fa-reel").src);
  expect(src).toMatch(/^blob:/);
});

test("on a slow connection the skip button appears and reveals the page early", async ({ page }) => {
  // hold back every video so the loader cannot finish
  await page.route("**/*.mp4", async route => {
    await new Promise(r => setTimeout(r, 30000));
    await route.abort().catch(() => {});
  });

  await page.goto("/index.html");
  const loader = page.locator("#loader");
  await expect(loader).toBeVisible();

  // still loading after 3 s, skip not yet offered
  await page.waitForTimeout(3000);
  await expect(loader).toBeVisible();

  const skip = page.locator(".loader-skip");
  await expect(skip).toHaveClass(/show/, { timeout: 5000 });
  await skip.click();

  await expect(loader).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveClass(/loading/);
  // page is usable: hero is visible and scrollable
  await expect(page.locator(".hero h1")).toBeVisible();
});

test("a failing scene reel leaves the page alive and other scenes recover", async ({ page }) => {
  // the flowers reel is unreachable in BOTH codecs; the page must still
  // reveal, and switching to an intact scene must bring the arena to life
  await page.route("**/grid/flygrid_flowers.mp4", route => route.abort());
  await page.route("**/av1/grid/flygrid_flowers.mp4", route => route.abort());
  await pageReady(page);

  await expect(page.locator(".fa-compare .ba-label.a")).toHaveText("SAD (ours)");
  await page.locator("#flythrough-arena").scrollIntoViewIfNeeded();
  await page.locator('[data-fly-scene="bicycle"]').click();
  await expect(page.locator(".fa-compare")).not.toHaveClass(/fa-loading/, { timeout: 60000 });
  await expect.poll(() => page.evaluate(() => {
    const r = document.querySelector(".fa-reel");
    return r.readyState >= 2 && !r.paused;
  }), { timeout: 30000 }).toBe(true);
});
