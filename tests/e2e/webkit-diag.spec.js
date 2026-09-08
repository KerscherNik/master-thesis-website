/* Diagnostic dump for the training-progress explorer, written for the macOS
   WebKit job: records what the reel and the panes look like instead of
   asserting, so a Safari-only failure can be read from the results branch. */
const { test } = require("@playwright/test");
const fs = require("fs");

test("explorer diagnostics", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "webkit", "diagnostic dump for the manual WebKit job only");
  const log = [];
  page.on("console", (m) => log.push(`[console.${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => log.push(`[pageerror] ${e.message}`));
  page.on("requestfailed", (r) => log.push(`[requestfailed] ${r.url()} ${r.failure() && r.failure().errorText}`));
  await page.goto("/index.html");
  await page.locator("#loader").waitFor({ state: "detached", timeout: 60000 }).catch(() => log.push("[diag] loader still present after 60s"));
  const root = page.locator("#progress-explorer");
  await root.scrollIntoViewIfNeeded();
  const snap = async (tag) => {
    const d = await page.evaluate(() => {
      const r = document.querySelector("#progress-explorer");
      const v = r.querySelector(".pe-reel");
      const cs = getComputedStyle(v); const rect = v.getBoundingClientRect();
      const played = []; for (let i = 0; i < v.played.length; i++) played.push([v.played.start(i), v.played.end(i)]);
      const panes = Array.from(r.querySelectorAll("canvas")).map((c) => {
        const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let s = 0, s2 = 0, n = 0;
        for (let i = 0; i < d.length; i += 4 * 97) { const x = (d[i] + d[i + 1] + d[i + 2]) / 3; s += x; s2 += x * x; n++; }
        const m = s / n; return { w: c.width, h: c.height, mean: +m.toFixed(1), sd: +Math.sqrt(Math.max(0, s2 / n - m * m)).toFixed(1) };
      });
      return { loading: r.classList.contains("pe-loading"), iter: (r.querySelector(".pe-iter") || {}).textContent,
        video: { src: (v.currentSrc || "").slice(0, 60), readyState: v.readyState, networkState: v.networkState, paused: v.paused, ended: v.ended,
          currentTime: v.currentTime, duration: v.duration, videoWidth: v.videoWidth, videoHeight: v.videoHeight, error: v.error && { code: v.error.code, message: v.error.message },
          muted: v.muted, playsInline: v.playsInline, preload: v.preload, played }, reelStyle: { display: cs.display, position: cs.position, width: cs.width, height: cs.height, rect: [rect.x, rect.y, rect.width, rect.height] }, panes };
    });
    log.push(`[${tag}] ${JSON.stringify(d)}`);
    return d;
  };
  await page.waitForTimeout(4000); await snap("t+4s");
  await page.waitForTimeout(8000); await snap("t+12s");
  await root.locator('button:has-text("bicycle")').click().catch(() => log.push("[diag] no bicycle tab"));
  await page.waitForTimeout(10000); await snap("after bicycle +10s");
  await page.evaluate(() => { const s = document.querySelector("#progress-explorer input[type=range]"); if (s) { s.value = 10; s.dispatchEvent(new Event("input", { bubbles: true })); } });
  await page.waitForTimeout(4000); await snap("after scrub to 30k +4s");
  const ua = await page.evaluate(() => navigator.userAgent); log.unshift(`[env] ${browserName} ${ua}`);
  await root.screenshot({ path: testInfo.outputPath("explorer.png") }).catch(() => {});
  fs.writeFileSync(testInfo.outputPath("diag.txt"), log.join("\n"));
  fs.mkdirSync("ci-diag", { recursive: true });
  fs.writeFileSync("ci-diag/webkit-diag-" + browserName + ".txt", log.join("\n"));
  try { fs.copyFileSync(testInfo.outputPath("explorer.png"), "ci-diag/explorer-" + browserName + ".png"); } catch (e) {}
});
