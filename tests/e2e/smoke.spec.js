const { test, expect } = require("@playwright/test");
const { pageReady } = require("./helpers");

test("page loads without console errors and all images render", async ({ page }) => {
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push("pageerror: " + e.message));

  await pageReady(page);

  // scroll through the whole page so lazy paths execute too
  await page.evaluate(async () => {
    for (let y = 0; y <= document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);

  expect(errors).toEqual([]);

  const badImages = await page.evaluate(() =>
    [...document.images]
      .filter(i => i.src && !i.naturalWidth)
      .map(i => i.getAttribute("src")));
  expect(badImages).toEqual([]);

  for (const heading of ["Abstract", "Method", "Results", "BibTeX"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});

test("browser under test can decode H.264 (required for video assertions)", async ({ page }) => {
  await page.goto("/index.html");
  const canPlay = await page.evaluate(() =>
    document.createElement("video").canPlayType('video/mp4; codecs="avc1.640028"'));
  expect(canPlay, "H.264 unsupported: use a Chrome-for-Testing based browser (Playwright >= 1.57)").not.toBe("");
});
