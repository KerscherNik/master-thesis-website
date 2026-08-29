const { expect } = require("@playwright/test");

/** Navigate and wait until the asset loader has finished and removed itself. */
async function pageReady(page) {
  await page.goto("/index.html");
  await expect(page.locator("#loader")).toHaveCount(0, { timeout: 60000 });
  await expect(page.locator("body")).not.toHaveClass(/loading/);
}

/** State of the arena reel — the one video driving every arena surface. */
function reelState(page) {
  return page.evaluate(() => {
    const r = document.querySelector(".fa-compare .fa-reel");
    return { rs: r.readyState, t: r.currentTime, paused: r.paused, rate: r.playbackRate };
  });
}

/** Mean luminance (0-255) of a canvas; ~0 = nothing was ever painted. */
function canvasLum(page, selector) {
  return page.evaluate((selector) => {
    const c = document.querySelector(selector);
    if (!c) return -1;
    const x = document.createElement("canvas");
    x.width = 32; x.height = 24;
    const g = x.getContext("2d");
    g.drawImage(c, 0, 0, 32, 24);
    const d = g.getImageData(0, 0, 32, 24).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return Math.round(s / (d.length / 4) / 3);
  }, selector);
}

module.exports = { pageReady, reelState, canvasLum };
