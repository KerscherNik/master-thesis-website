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

  it("every progress-scene video exists on disk", () => {
    for (const scene of Object.values(core.PROGRESS_SCENES)) {
      expect(existsSync(resolve(ROOT, scene.sad))).toBe(true);
      expect(existsSync(resolve(ROOT, scene.gs))).toBe(true);
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
  it("every H.264 video has an AV1 twin of plausible size", () => {
    const { readdirSync, statSync } = require("node:fs");
    const dir = resolve(ROOT, "static/videos");
    const mp4s = readdirSync(dir).filter(f => f.endsWith(".mp4"));
    expect(mp4s.length).toBeGreaterThan(20);
    const missing = [], suspicious = [];
    for (const f of mp4s) {
      const twin = resolve(dir, "av1", f);
      if (!existsSync(twin)) { missing.push(f); continue; }
      const ratio = statSync(twin).size / statSync(resolve(dir, f)).size;
      if (ratio <= 0.1 || ratio >= 1.1) suspicious.push(`${f} ratio ${ratio.toFixed(2)}`);
    }
    expect(missing).toEqual([]);
    expect(suspicious).toEqual([]);
  });
});

describe("fly-through arena contract", () => {
  it("all 9 method x scene fly-through videos exist on disk", () => {
    const missing = [];
    for (const scene of core.FLY_SCENES) {
      for (const method of Object.keys(core.FLY_METHODS)) {
        const p = core.flyPath(scene, method);
        if (!existsSync(resolve(ROOT, p))) missing.push(p);
      }
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
