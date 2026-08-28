// Layout invariants swept across the width matrix: phones (320-414),
// foldables/small tablets (568-820), laptop (1024-1280). Geometric
// assertions rather than pixel snapshots: they express what "renders and
// scales correctly" means and don't flake on font rasterisation.

const { test, expect } = require("@playwright/test");
const { pageReady } = require("./helpers");

const WIDTHS = [320, 360, 375, 390, 414, 568, 640, 768, 820, 1024, 1280];

for (const width of WIDTHS) {
  test.describe(`viewport ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await pageReady(page);
      // scroll through the whole page so lazy content and observers fire
      await page.evaluate(async () => {
        for (let y = 0; y <= document.body.scrollHeight; y += 700) {
          window.scrollTo(0, y);
          await new Promise(r => setTimeout(r, 40));
        }
        window.scrollTo(0, 0);
      });
    });

    test("no horizontal overflow anywhere on the page", async ({ page }) => {
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBe(0);
    });

    test("every key component fits the viewport", async ({ page }) => {
      const tooWide = await page.evaluate(() => {
        const cw = document.documentElement.clientWidth;
        const sel = [
          ".hero", ".ba-compare", ".fa-stage", ".fa-bench",
          ".progress-explorer", ".table-wrap", "pre.bibtex",
          ".method-strip", ".figure-block", "footer"
        ];
        return sel.flatMap(s => [...document.querySelectorAll(s)])
          .filter(el => el.offsetParent)
          .filter(el => el.getBoundingClientRect().width > cw + 1)
          .map(el => `${el.tagName}.${String(el.className).split(" ")[0]}`);
      });
      expect(tooWide).toEqual([]);
    });

    test("images keep their aspect ratio (no distortion)", async ({ page }) => {
      // browsers only fetch loading=lazy images near the viewport; force the
      // stragglers eager so every image can be measured
      await page.evaluate(() =>
        document.querySelectorAll("img[loading=lazy]").forEach(i => { i.loading = "eager"; }));
      await expect.poll(() => page.evaluate(() =>
        [...document.images].filter(i => i.src && !i.naturalWidth).length),
        { timeout: 20000 }).toBe(0);
      const distorted = await page.evaluate(() =>
        [...document.images]
          .filter(i => i.naturalWidth && i.getBoundingClientRect().width > 0)
          .filter(i => {
            const r = i.getBoundingClientRect();
            const shown = r.width / r.height;
            const natural = i.naturalWidth / i.naturalHeight;
            return Math.abs(shown - natural) / natural > 0.01;
          })
          .map(i => i.getAttribute("src")));
      expect(distorted).toEqual([]);
    });

    test("grids collapse at the intended breakpoints", async ({ page }) => {
      const cols = sel => page.evaluate(s => {
        const el = document.querySelector(s);
        return el ? getComputedStyle(el).gridTemplateColumns.split(" ").length : null;
      }, sel);
      if (width <= 640) {
        expect(await cols(".pe-pair")).toBe(1); // explorer stacks on phones
      } else {
        expect(await cols(".pe-pair")).toBe(2);
      }
      if (width <= 720) {
        expect(await cols(".method-strip")).toBe(2);
      } else {
        expect(await cols(".method-strip")).toBe(5);
      }
    });

    test("text stays readable and controls stay tappable", async ({ page }) => {
      const fonts = await page.evaluate(() => ({
        body: parseFloat(getComputedStyle(document.body).fontSize),
        caption: parseFloat(getComputedStyle(document.querySelector(".caption")).fontSize)
      }));
      expect(fonts.body).toBeGreaterThanOrEqual(15);
      expect(fonts.caption).toBeGreaterThanOrEqual(12);

      // WCAG 2.5.8: interactive targets at least 24x24 (inline text links exempt)
      const small = await page.evaluate(() =>
        [...document.querySelectorAll("button, input[type=range], .ba-handle, .lb-close")]
          .filter(el => el.offsetParent)
          .map(el => ({ n: String(el.className || el.tagName).slice(0, 24), r: el.getBoundingClientRect() }))
          .filter(x => x.r.width > 0 && (x.r.width < 24 || x.r.height < 24))
          .map(x => `${x.n} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`));
      expect(small).toEqual([]);
    });
  });
}
