// The deployed sw.js is a tombstone, not a cache. A caching worker combined
// with Safari's unreliable update checks once pinned visitors to a weeks-old
// deploy, so the contract is the opposite of the usual one: nothing may be
// intercepted, everything cached must be deleted, and the page must not
// register a worker at all.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sw = readFileSync(resolve(ROOT, "sw.js"), "utf8");
const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
const compare = readFileSync(resolve(ROOT, "static/js/compare.js"), "utf8");
const ci = readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8");

describe("service worker tombstone", () => {
  it("intercepts nothing: no fetch handler, no cache reads", () => {
    expect(sw).not.toMatch(/addEventListener\(\s*["']fetch["']/);
    expect(sw).not.toMatch(/caches\.(match|open)\b/);
    expect(sw).not.toMatch(/\bcache\.(put|add|addAll)\b/);
  });

  it("takes over immediately, deletes every cache, then unregisters", () => {
    expect(sw).toMatch(/skipWaiting\(\)/);
    const activate = sw.slice(sw.indexOf('addEventListener("activate"'));
    expect(activate).toMatch(/caches\.keys\(\)/);
    expect(activate).toMatch(/caches\.delete\(/);
    expect(activate).toMatch(/registration\.unregister\(\)/);
    // the deletion must complete before the worker goes away
    expect(activate.indexOf("caches.delete")).toBeLessThan(activate.indexOf("unregister"));
    // and the event must be kept alive for all of it
    expect(activate).toMatch(/waitUntil\(/);
  });

  it("carries a build marker so each deploy is a byte-fresh worker", () => {
    expect(sw).toContain("__BUILD__");
    expect(ci).toMatch(/sed .*__BUILD__.*sw\.js > _site\/sw\.js/);
  });
});

describe("the page keeps no worker", () => {
  it("index.html never registers a service worker", () => {
    expect(html).not.toMatch(/serviceWorker\.register/);
  });

  it("compare.js unregisters leftovers and drops their caches", () => {
    expect(compare).not.toMatch(/serviceWorker\.register\(/);
    expect(compare).toMatch(/getRegistrations\(\)/);
    expect(compare).toMatch(/r\.unregister\(\)/);
    expect(compare).toMatch(/caches\.delete\(/);
  });

  it("asset URLs still carry the deploy SHA, so no layer can serve stale JS", () => {
    for (const asset of ["static/css/index.css", "static/js/core.js", "static/js/compare.js"]) {
      expect(ci).toContain(`s|${asset}|${asset}?v=`);
    }
  });
});
