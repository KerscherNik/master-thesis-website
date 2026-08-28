const { expect } = require("@playwright/test");

/** Navigate and wait until the asset loader has finished and removed itself. */
async function pageReady(page) {
  await page.goto("/index.html");
  await expect(page.locator("#loader")).toHaveCount(0, { timeout: 60000 });
  await expect(page.locator("body")).not.toHaveClass(/loading/);
}

/** The fly-through comparison: the only .ba-compare that contains videos. */
function videoPair(page) {
  return page.locator(".ba-compare:has(video)").first();
}

/** Max |tA - tB| sampled over `ms`, ignoring momentary loop-wrap outliers. */
async function sampleDrift(page, ms) {
  return page.evaluate(async (ms) => {
    const el = [...document.querySelectorAll(".ba-compare")].find(e => e.querySelector("video"));
    const [a, b] = el.querySelectorAll("video");
    let max = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const d = Math.abs(a.currentTime - b.currentTime);
      if (d < 4) max = Math.max(max, d); // a loop wrap shows as ~8 s for one frame
      await new Promise(r => setTimeout(r, 250));
    }
    return max;
  }, ms);
}

module.exports = { pageReady, videoPair, sampleDrift };
