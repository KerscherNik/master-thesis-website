// Contract tests between index.html, core.js and the files on disk:
// every asset the page references must exist, and the UI ranges must
// agree with the checkpoint schedule.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import core from "../../static/js/core.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "index.html"), "utf8");

describe("index.html asset references", () => {
  it("every src / data-src / poster / href asset exists on disk", () => {
    const refs = [...html.matchAll(/(?:src|data-src|poster|href)="(static\/[^"]+)"/g)]
      .map(m => m[1]);
    expect(refs.length).toBeGreaterThan(10);
    const missing = refs.filter(r => !existsSync(resolve(ROOT, r)));
    expect(missing).toEqual([]);
  });

  it("loads core.js before compare.js", () => {
    const iCore = html.indexOf("static/js/core.js");
    const iCompare = html.indexOf("static/js/compare.js");
    expect(iCore).toBeGreaterThan(-1);
    expect(iCompare).toBeGreaterThan(-1);
    expect(iCore).toBeLessThan(iCompare);
  });
});

describe("progress explorer contract", () => {
  it("slider range matches the checkpoint count", () => {
    const m = html.match(/<input type="range" min="(\d+)" max="(\d+)" step="1"/);
    expect(m).not.toBeNull();
    expect(+m[1]).toBe(0);
    expect(+m[2]).toBe(core.CHECKPOINTS.length - 1);
  });

  it("every progress scene has its side-by-side pair reel on disk", () => {
    for (const scene of Object.keys(core.PROGRESS_SCENES)) {
      expect(existsSync(resolve(ROOT, core.progGridPath(scene)))).toBe(true);
    }
  });

  it("scene tabs in the HTML match the scenes core.js knows about", () => {
    const tabs = [...html.matchAll(/data-scene="([^"]+)"/g)].map(m => m[1]);
    expect(new Set(tabs)).toEqual(new Set(Object.keys(core.PROGRESS_SCENES)));
  });
});

describe("security & privacy contract", () => {
  it("ships a CSP meta tag with the required directives", () => {
    const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
    expect(m).not.toBeNull();
    for (const d of ["default-src 'none'", "script-src 'self'", "media-src 'self' blob:",
                     "worker-src 'self'", "manifest-src 'self'", "base-uri 'self'"]) {
      expect(m[1]).toContain(d);
    }
  });

  it("robots.txt allows crawling so the noindex meta can be honored", () => {
    const robots = readFileSync(resolve(ROOT, "robots.txt"), "utf8");
    expect(robots).not.toMatch(/Disallow:\s*\/\s*$/m);
    expect(html).toContain('name="robots" content="noindex');
  });

  it("uses no-referrer and no insecure http:// links", () => {
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(html).not.toMatch(/href="http:\/\//);
  });

  it("workflow actions are SHA-pinned with least-privilege permissions", () => {
    const ci = readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toMatch(/^permissions: \{\}/m);          // deny-all at workflow level
    expect(ci).toMatch(/^      contents: read/m);        // per-job grants exist
    expect(ci).toMatch(/persist-credentials: false/);
    const uses = [...ci.matchAll(/uses: ([^\s]+)/g)].map(m => m[1]);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
  });
});

describe("image variants", () => {
  it("every picture-wrapped image has its AVIF twin on disk", () => {
    const avifs = [...html.matchAll(/srcset="(static\/images\/[^"]+\.avif)"/g)].map(m => m[1]);
    expect(avifs.length).toBeGreaterThan(15);
    const missing = avifs.filter(a => !existsSync(resolve(ROOT, a)));
    expect(missing).toEqual([]);
  });
});

describe("codec variants", () => {
  it("AV1 twins, where present, have a plausible size ratio", () => {
    // AV1 is optional per file (the fetch falls back to H.264 on 404);
    // grids ship H.264-only after AV1 measured LARGER on 4-up content
    const { readdirSync, statSync } = require("node:fs");
    const dir = resolve(ROOT, "static/videos");
    const suspicious = [];
    for (const sub of ["", "grid/"]) {
      const base = resolve(dir, sub);
      if (!existsSync(base)) continue;
      for (const f of readdirSync(base).filter(f => f.endsWith(".mp4"))) {
        const twin = resolve(dir, "av1", sub, f);
        if (!existsSync(twin)) continue;
        const ratio = statSync(twin).size / statSync(resolve(base, f)).size;
        if (ratio <= 0.1 || ratio >= 1.05) suspicious.push(`${sub}${f} ratio ${ratio.toFixed(2)}`);
      }
    }
    expect(suspicious).toEqual([]);
  });
});

describe("fly-through arena contract", () => {
  it("every scene has its grid reel, every progress scene its pair reel", () => {
    const missing = [];
    for (const scene of core.FLY_SCENES) {
      if (!existsSync(resolve(ROOT, core.gridPath(scene)))) missing.push(core.gridPath(scene));
    }
    for (const scene of Object.keys(core.PROGRESS_SCENES)) {
      if (!existsSync(resolve(ROOT, core.progGridPath(scene)))) missing.push(core.progGridPath(scene));
    }
    expect(missing).toEqual([]);
  });

  it("arena scene tabs in the HTML match core.FLY_SCENES", () => {
    const arena = html.match(/<div class="flythrough-arena"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
    expect(arena).not.toBeNull();
    const tabs = [...arena[0].matchAll(/data-fly-scene="([^"]+)"/g)].map(m => m[1]);
    expect(tabs).toEqual(core.FLY_SCENES);
  });
});

describe("quad crop geometry", () => {
  // The 2x2 reel is cropped by three places that each hard-code the quad
  // aspect: the canvas element, the tile box, and the painter. They must
  // agree, or a scene switch silently letterboxes one surface.
  const css = readFileSync(resolve(ROOT, "static/css/index.css"), "utf8");
  const js = readFileSync(resolve(ROOT, "static/js/compare.js"), "utf8");

  it("the wipe canvas, the tile box and the painter share one aspect ratio", () => {
    const tag = html.match(/<canvas[^>]*class="fa-wipe"[^>]*>/);
    expect(tag, "index.html must keep a canvas.fa-wipe").not.toBeNull();
    const w = tag[0].match(/width="(\d+)"/), h = tag[0].match(/height="(\d+)"/);
    expect(w, "canvas.fa-wipe needs width/height attributes").not.toBeNull();
    expect(h).not.toBeNull();
    const fromCanvas = +w[1] / +h[1];

    const tile = css.match(/\.fa-tile-media\s*\{[^}]*aspect-ratio:\s*(\d+)\s*\/\s*(\d+)/);
    expect(tile).not.toBeNull();
    const fromCss = +tile[1] / +tile[2];

    const painted = [...js.matchAll(/\*\s*(\d+)\s*\/\s*(\d+)\s*\)?;?\s*(?:\}|\n)/g)]
      .map(m => +m[1] / +m[2]);
    expect(painted).toContain(630 / 956); // the painter's h = w * 630/956

    // the CSS box is written as 1256/828 and the canvas as 956/630: the same
    // ratio to 0.04%, which is below a pixel at the 104 px the tile is drawn
    expect(fromCanvas).toBeCloseTo(fromCss, 2);
    expect(fromCanvas).toBeCloseTo(1 / (630 / 956), 3);
  });

  it("the progress panes declare the aspect of the reel half they crop", () => {
    // ar is "<half width> / <height>" of the scene's proggrid reel
    for (const [scene, cfg] of Object.entries(core.PROGRESS_SCENES)) {
      const m = cfg.ar.match(/^(\d+) \/ (\d+)$/);
      expect(m, scene).not.toBeNull();
      expect(+m[1]).toBeGreaterThan(+m[2]); // landscape, always
    }
  });
});
