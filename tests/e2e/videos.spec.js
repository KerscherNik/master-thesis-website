const { test, expect } = require("@playwright/test");
const { pageReady, videoPair, sampleDrift } = require("./helpers");

test.beforeEach(async ({ page }) => { await pageReady(page); });

test("fly-through pair plays in sync while visible", async ({ page }) => {
  const pair = videoPair(page);
  await pair.scrollIntoViewIfNeeded();

  // both actually advance
  await expect.poll(async () =>
    page.evaluate(() => {
      const el = [...document.querySelectorAll(".ba-compare")].find(e => e.querySelector("video"));
      const [a, b] = el.querySelectorAll("video");
      return !a.paused && !b.paused && a.currentTime > 0.2 && b.currentTime > 0.2;
    }), { timeout: 15000 }).toBe(true);

  const drift = await sampleDrift(page, 3000);
  expect(drift).toBeLessThan(0.2);
});

test("pair pauses offscreen and resumes in sync after scrolling back", async ({ page }) => {
  const pair = videoPair(page);
  await pair.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(async () =>
    page.evaluate(() => {
      const el = [...document.querySelectorAll(".ba-compare")].find(e => e.querySelector("video"));
      const [a, b] = el.querySelectorAll("video");
      return a.paused && b.paused;
    }), { timeout: 10000 }).toBe(true);

  await pair.scrollIntoViewIfNeeded();
  await expect.poll(async () =>
    page.evaluate(() => {
      const el = [...document.querySelectorAll(".ba-compare")].find(e => e.querySelector("video"));
      const [a, b] = el.querySelectorAll("video");
      return !a.paused && !b.paused;
    }), { timeout: 10000 }).toBe(true);

  const drift = await sampleDrift(page, 2000);
  expect(drift).toBeLessThan(0.2);
});

test("pair survives the loop boundary without lasting drift", async ({ page }) => {
  const pair = videoPair(page);
  await pair.scrollIntoViewIfNeeded();
  // video is 8 s; sampling 9 s guarantees at least one wrap
  const drift = await sampleDrift(page, 9000);
  expect(drift).toBeLessThan(0.3);
});

test("bench tile loads and its preview opens a lightbox with controls", async ({ page }) => {
  const card = page.locator('.fa-tile[data-method="mcmc"]');
  await card.scrollIntoViewIfNeeded();
  await expect(card).toHaveClass(/loaded/, { timeout: 60000 });

  await card.locator(".fa-tile-media").click();
  const lb = page.locator(".lightbox");
  await expect(lb).toHaveClass(/open/);
  const v = lb.locator("video");
  await expect(v).toHaveCount(1);
  expect(await v.evaluate(el => el.src)).toMatch(/^blob:/);
  expect(await v.evaluate(el => el.controls)).toBe(true);
  await expect.poll(() => v.evaluate(el => el.currentTime), { timeout: 10000 }).toBeGreaterThan(0.1);

  await page.keyboard.press("Escape");
  await expect(lb).not.toHaveClass(/open/);
});

test("expanding the pair opens a synced comparison lightbox", async ({ page }) => {
  const pair = videoPair(page);
  await pair.scrollIntoViewIfNeeded();
  await pair.locator(".ba-expand").click();

  const lb = page.locator(".lightbox");
  await expect(lb).toHaveClass(/open/);
  await expect(lb.locator("video")).toHaveCount(2);

  await expect.poll(async () =>
    page.evaluate(() => {
      const [a, b] = document.querySelectorAll(".lightbox video");
      return !a.paused && !b.paused && a.currentTime > 0.2;
    }), { timeout: 15000 }).toBe(true);

  const drift = await page.evaluate(() => {
    const [a, b] = document.querySelectorAll(".lightbox video");
    return Math.abs(a.currentTime - b.currentTime);
  });
  expect(drift).toBeLessThan(0.3);

  await page.keyboard.press("Escape");
  await expect(lb).not.toHaveClass(/open/);
});
