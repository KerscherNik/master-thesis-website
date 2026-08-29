# A High-Frequency Perspective on 3D Gaussian Splatting — project page

Project page for the MSc thesis on **SAD (Spectral-Aware Densification)**:
steering 3D Gaussian Splatting densification with a frequency-domain deficit
signal — about 25% fewer Gaussians at matched quality on Mip-NeRF 360.

**Live site:** https://kerschernik.github.io/master-thesis-website/
(public URL but *unlisted*: `noindex` meta + crawl-permitting `robots.txt`
keep it out of search engines until the thesis is published — see
[Privacy](#privacy--publishing) below.)

A static, dependency-free page: one HTML file, one stylesheet, two small
scripts. No CDN, no framework, no build step. `npm` is used only for the
test suite.

## What is on the page

1. **Hero** — title, author, supervisors, resource buttons
   (Thesis PDF / Code are placeholders until the links exist).
2. **Teaser** — full-frame *flowers* test view, SAD vs 3DGS behind a
   draggable comparison slider.
3. **Abstract & Method** — thesis abstract; the five-step method strip
   (training image → render → pixel residual → spectral deficit → result).
4. **Results table** — nine-scene Mip-NeRF 360 averages plus
   Tanks & Temples and Deep Blending transfer results.
5. **Comparison grid** — six detail-crop sliders (flowers, bicycle, garden,
   stump, truck, drjohnson), covering all three benchmarks. Crops are
   auto-selected where the visible SAD-vs-3DGS difference is largest among
   regions where SAD beats the baseline against ground truth.
6. **Density map** — where each method's primitives sit.
7. **Fly-through arena** — 4 methods (SAD, 3DGS, 3DGS-MCMC, FDS-GS) ×
   6 scenes, 24 videos. Two methods play synchronized behind the slider;
   the others wait as drag-and-drop bench tiles (buttons as the touch
   fallback). One play/pause button freezes the whole arena at a single
   moment on the shared camera path; swapping or switching scenes while
   paused stays paused with the new video frame-aligned to that moment.
8. **Training progress** — 4 scenes (flowers, bicycle, truck, drjohnson);
   a timeline scrubber steps SAD and 3DGS through the same 11 checkpoints
   (500 → 30,000 iterations) side by side.
9. **Pareto plot, BibTeX, footer** (license, credits, accessibility note).

## Repository layout

```
index.html               the page
static/css/index.css     all styling (system fonts, thesis-colormap accents)
static/js/core.js        pure logic (checkpoint math, path helpers) — UMD,
                         imported by both the page and the unit tests
static/js/compare.js     all behaviour (loader, sliders, arena, explorer,
                         lightbox, service-worker registration)
static/images/           renders, figures, AVIF twins (copy_assets.py)
static/videos/           H.264 videos + AV1 twins under av1/
sw.js                    service worker (build-id injected at deploy)
manifest.webmanifest     minimal web app manifest + icons
tests/unit/              Vitest: core logic + repo contracts
tests/e2e/               Playwright: desktop + phone + tablet projects
tests/server.py          range-capable local server (see Development)
asset_scripts/           render scripts + SLURM templates (own README)
.github/workflows/ci.yml test + deploy pipeline
```

## How the page works

- **Loader**: a progress overlay streams only the hero pair (~26 MB AV1)
  into blob URLs, then reveals; a skip button appears after 4 s, and
  Save-Data/2G users skip the preload entirely (progressive playback).
  On `file://` everything degrades to plain `src` playback.
- **Blob playback + pair sync**: comparison pairs play from fully buffered
  blobs so seeks never stall; a rAF loop corrects drift > 0.08 s, and a
  watchdog restarts any visible-but-stuck pair. An explicit pause (button
  or `prefers-reduced-motion`) outranks all auto-play.
- **Codec/format negotiation**: AV1 via `MediaSource.isTypeSupported` with
  per-file H.264 fallback; AVIF via `<picture>` with JPEG fallback.
- **Background loading**: after reveal, progress videos first, then every
  scene's active pair, then bench videos — two parallel streams at
  `priority: "low"` that yield entirely to user-initiated loads, abort on
  `pagehide` (keeps back/forward-cache eligibility) and resume on restore.
- **Service worker**: cache-first for `/static/`, cache name = deploy SHA
  (old caches deleted on activate). This substitutes for the immutable
  caching GitHub Pages cannot express (`max-age=600` only). Repeat visits
  are 0-byte and work offline.
- **Explorer math**: progress videos hold each checkpoint for 21 frames at
  30 fps (final ×3, 273 frames); the scrubber seeks both videos to
  `(21k + 10.5)/30` s. Contracted by unit tests against `ffprobe`.
- **Lightbox**: native `<dialog>` + `showModal()` (platform focus
  containment and Escape); comparisons, figures and tiles all enlarge.

## Asset pipeline (GPU renders)

All media are real renders from trained checkpoints under
`/export/scratch/ra28kuc/output/`. See `asset_scripts/README.md` for the
model-directory table and submission commands. Key facts:

- **Camera path** (`campath.py`): elliptical orbit fitted through the
  training cameras with a raised-cosine *dolly* into the focus region at
  mid-loop and an *eased* (slower) sweep there — at full-scene distance
  the methods are indistinguishable; differences live in high-frequency
  detail. Per scene: dolly 0.45 (flowers, garden, truck), 0.60 (bicycle,
  stump — into the handles/bark), 0.35 + orbit 0.75 (drjohnson, indoor).
  All methods per scene share the exact path → frame-aligned sliders.
- **FDS-GS** must be rendered with its own codebase/env: its plys carry a
  per-Gaussian filter radius `R` and log-scales up to ~11 that crash the
  vanilla rasterizer (`slurm/web-flythrough-dolly2-fds.sh`).
- **Progress runs**: fresh trainings with dense `--save_iterations`
  (SAD FINAL config; T&T/DB at `--resolution -1`).
- **AV1 encode** (`slurm/web-av1-encode.sh`, runs on the login node —
  compute-node ffmpeg is broken): SVT-AV1 preset 6, CRF 30 (garden CRF 26),
  every file SSIM-gated ≥ 0.97 against its H.264 original.
- **Images** (`copy_assets.py`): test-view crops chosen by the thesis
  criterion / visible-difference criterion; AVIF at CRF 18 for evidence
  crops (SSIM ≥ 0.988), CRF 30 for plots.

## Security, accessibility, performance

Grounded in a 2026 research pass (OWASP/MDN/W3C/web.dev + live probing):

- **Security**: meta CSP `default-src 'none'` with explicit allowances —
  the maximum possible on GitHub Pages, which permits no custom headers
  (so `frame-ancestors` is unavailable; acceptable for a read-only page).
  `no-referrer`, SHA-pinned Actions with least-privilege permissions,
  Dependabot for pins and dev deps, SW never caches error pages.
  If the noscript `<style>` ever changes, recompute its CSP sha256 hash.
- **Accessibility (WCAG 2.2 AA)**: zero axe violations enforced in CI plus
  the manual-only criteria — single-pointer alternatives for every drag,
  one pause control for all moving content, `prefers-reduced-motion`
  honored in JS (CSS cannot stop `<video autoplay>`), `aria-valuetext` on
  sliders, labeled videos, skip link, forced-colors support, native
  dialog, footer accessibility statement.
- **Performance**: dual codec + dual image format, hero-only critical
  path, bfcache-safe background loading, service worker, `text-wrap`
  balance/pretty. The loading overlay is a deliberate design choice; with
  `noindex` there is no ranking cost to its LCP impact.

## Development

```bash
npm run serve        # range-capable server on http://127.0.0.1:4173
```

Serving locally **must** support HTTP Range requests (GitHub Pages does):
`python -m http.server` does not, and Chromium-suspended videos then never
become seekable. `tests/server.py` (behind `npm run serve`) handles this.
VS Code Live Server also works; after multi-file edits, hard-refresh —
its hot reload can show mixed intermediate states.

## Tests

```bash
npm install
npx playwright install chromium   # >= 1.57 so the browser decodes H.264/AV1
npm test                          # unit + e2e (142 tests)
```

Vitest covers the pure logic and repo contracts (assets exist, CSP
directives, SHA-pinned workflow, AVIF/AV1 twins present, checkpoint math
matches the rendered videos). Playwright runs three projects — desktop,
Pixel 7, iPad (touch emulation) — covering the loader (including throttled
network and missing-file degradation), slider drag/tap/keyboard, pair-sync
drift across scrolling and loop boundaries, the arena state machine
(swap, drag-and-drop, pause semantics), the explorer, lightbox, an
11-width responsive matrix (320–1280 px), reduced motion, forced colors,
and an axe-clean gate.

## CI / deployment

Every push and PR runs the full suite; a green push to `main` deploys
`index.html`, `robots.txt`, `manifest.webmanifest`, `sw.js` (build SHA
injected) and `static/` to GitHub Pages. Pages source is already set to
"GitHub Actions" in the repo settings.

## Privacy / publishing

The site is deliberately unlisted: `noindex, nofollow` meta (with
crawling *allowed* so robots can read it) and zero tracking/third-party
requests. To make it indexable when the thesis is published, remove the
robots meta line in `index.html` (marked with a comment) and `robots.txt`.

## Open items

- Hero "Thesis (PDF)" and "Code" buttons are disabled placeholders.
- Git history carries every video re-render (~1.5 GB); consider squashing
  or moving media to LFS/releases if render iterations continue.

## Credits

Page layout adapted from the [Nerfies](https://nerfies.github.io) project
page (CC BY-SA 4.0), reimplemented without its CDN dependencies. Renders
use the [Mip-NeRF 360](https://jonbarron.info/mipnerf360/),
Tanks & Temples and Deep Blending scenes and build on the
[3D Gaussian Splatting](https://github.com/graphdeco-inria/gaussian-splatting)
codebase (Inria, GRAPHDECO).
