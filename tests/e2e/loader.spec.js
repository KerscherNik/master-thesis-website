const { test, expect } = require("@playwright/test");
const { pageReady } = require("./helpers");

test("loader shows, finishes, and hands the pair blob-backed sources", async ({ page }) => {
  await page.goto("/index.html");
  // Either we catch the overlay mid-flight or it already finished on a fast
  // local disk; the end state is what matters.
  await expect(page.locator("#loader")).toHaveCount(0, { timeout: 60000 });
  await expect(page.locator("body")).not.toHaveClass(/loading/);

  const srcs = await page.evaluate(() =>
    [...document.querySelectorAll(".ba-compare video")].map(v => v.src));
  expect(srcs.length).toBe(2);
  for (const s of srcs) expect(s).toMatch(/^blob:/);
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

test("a missing bench video degrades to an 'unavailable' card, not a broken page", async ({ page }) => {
  await page.route("**/flythrough_mcmc_flowers.mp4", route => route.abort());
  await pageReady(page);

  const card = page.locator('.fa-tile[data-method="mcmc"]');
  await card.scrollIntoViewIfNeeded();
  await expect(card).toHaveClass(/fa-unavailable/, { timeout: 30000 });
  await expect(card.locator(".fa-tile-name")).toContainText(/not available/i);
  // the comparison itself still works
  await expect(page.locator(".fa-compare .ba-label.a")).toHaveText("SAD (ours)");
});
