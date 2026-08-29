# A High-Frequency Perspective on 3D Gaussian Splatting: project page

Project page for the MSc thesis on SAD (Spectral-Aware Densification),
which steers 3D Gaussian Splatting densification with a frequency-domain
deficit signal and reaches matched quality on Mip-NeRF 360 with about 25%
fewer Gaussians.

Live site: https://kerschernik.github.io/master-thesis-website/

The URL is public but unlisted. A `noindex` meta plus a crawl-permitting
`robots.txt` keep the page out of search engines until the thesis is
published; see "Privacy and publishing" below.

The page itself is static and has no dependencies: one HTML file, one
stylesheet, two small scripts. There is no CDN, framework, or build step.
`npm` is only used for the test suite.

## What is on the page

1. Hero: title, author, supervisors, resource buttons. The Thesis PDF and
   Code buttons are placeholders until those links exist.
2. Teaser: the full-frame flowers test view, SAD vs 3DGS behind a
   draggable comparison slider.
3. Abstract and method: the thesis abstract and the five-step method
   strip (training image, render, pixel residual, spectral deficit,
   result after SAD).
4. Results table: nine-scene Mip-NeRF 360 averages, plus Tanks & Temples
   and Deep Blending transfer results.
5. Comparison grid: six detail-crop sliders (flowers, bicycle, garden,
   stump, truck, drjohnson) covering all three benchmarks. Crops are
   picked automatically where the visible SAD-vs-3DGS difference is
   largest, restricted to regions where SAD also beats the baseline
   against ground truth.
6. Density map: where each method places its primitives.
7. Fly-through arena: 4 methods (SAD, 3DGS, 3DGS-MCMC, FDS-GS) times
   6 scenes, 24 videos. Two methods play synchronized behind the slider.
   The remaining methods wait as bench tiles that can be dragged onto
   either side; buttons on each tile are the touch fallback. One
   play/pause button freezes the whole arena at a single moment on the
   shared camera path. Swapping methods or switching scenes while paused
   stays paused, and the incoming video is seeked to the frozen
   timestamp, so methods can be compared frame by frame.
8. Training progress: four scenes (flowers, bicycle, truck, drjohnson).
   A timeline scrubber steps SAD and 3DGS through the same 11 checkpoints
   from 500 to 30,000 iterations.
9. Pareto plot, BibTeX, footer with license, credits, and an
   accessibility note.

## Repository layout

```
index.html               the page
static/css/index.css     all styling (system fonts, thesis-colormap accents)
static/js/core.js        pure logic (checkpoint math, path helpers); UMD,
                         imported by the page and by the unit tests
static/js/compare.js     behaviour: loader, sliders, arena, explorer,
                         lightbox, service-worker registration
static/images/           renders, figures, AVIF twins (copy_assets.py)
static/videos/           H.264 videos, AV1 twins under av1/
sw.js                    service worker (build id injected at deploy)
manifest.webmanifest     web app manifest and icons
tests/unit/              Vitest: core logic and repo contracts
tests/e2e/               Playwright: desktop, phone, and tablet projects
tests/server.py          range-capable local server (see Development)
asset_scripts/           render scripts and SLURM templates (own README)
.github/workflows/ci.yml test and deploy pipeline
```

## How the page works

The loading overlay streams only the hero pair (about 26 MB as AV1) into
blob URLs, then reveals the page. A skip button appears after 4 seconds.
Visitors with Save-Data or a 2G connection skip the preload and get
progressive playback; the same fallback covers `file://`.

Comparison pairs play from fully buffered blobs, so seeks cannot stall.
A requestAnimationFrame loop corrects drift above 0.08 s, and a watchdog
restarts any pair that is visible but stuck. An explicit pause, whether
from the button or from `prefers-reduced-motion`, overrides every
automatic play.

Codecs and formats are negotiated per browser: AV1 through
`canPlayType` with a per-file H.264 fallback, AVIF through `<picture>`
with JPEG fallback. If an AV1 blob fails to decode at runtime, the page
drops AV1 for the session and refetches that file as H.264.

After the reveal, background loading fetches the progress videos first,
then each scene's active pair, then the bench videos. Two parallel
streams run at `priority: "low"`, yield to user-initiated loads, abort
on `pagehide` to keep back/forward-cache eligibility, and resume when
the page is restored.

The service worker caches HTML, CSS, JS, and images, with the cache name
set to the deploy SHA and old caches deleted on activation. This stands
in for the immutable caching that GitHub Pages cannot express (it serves
everything with `max-age=600`). Videos are not intercepted: Safari kills
service workers aggressively, and a worker dying mid-download corrupted
playback, so videos rely on the page's own blob streaming plus the HTTP
cache.

Progress videos hold each checkpoint for 21 frames at 30 fps, with the
final checkpoint held three times as long (273 frames). The scrubber
seeks both videos to `(21k + 10.5)/30` seconds; unit tests pin this
layout against `ffprobe` output.

The lightbox is a native `<dialog>` opened with `showModal()`, which
provides focus containment and Escape handling. Comparisons, figures,
and bench tiles all enlarge into it.

## Asset pipeline (GPU renders)

All media are renders from trained checkpoints under
`/export/scratch/ra28kuc/output/`. `asset_scripts/README.md` has the
model-directory table and submission commands. The main points:

Camera path (`campath.py`): an elliptical orbit fitted through the
training cameras, with a raised-cosine dolly into the focus region at
mid-loop and a slower sweep there. At full-scene distance the methods
look identical; the differences sit in high-frequency detail, so the
camera goes where that detail is. Dolly values per scene: 0.45 for
flowers, garden, and truck; 0.60 for bicycle and stump (into the
handlebars and bark); 0.35 with orbit scale 0.75 for the indoor
drjohnson. All methods of a scene share the exact path, which keeps the
sliders frame-aligned.

FDS-GS must be rendered with its own codebase and conda env. Its plys
carry a per-Gaussian filter radius `R` and log-scales up to about 11,
which crash the vanilla rasterizer
(`slurm/web-flythrough-dolly2-fds.sh`).

Progress runs are fresh trainings with dense `--save_iterations`, using
the SAD FINAL configuration; Tanks & Temples and Deep Blending train at
`--resolution -1`.

AV1 encoding (`slurm/web-av1-encode.sh`, run on the login node because
the compute-node ffmpeg is broken): SVT-AV1 preset 6 at CRF 30, garden
at CRF 26. Every file must reach SSIM 0.97 or better against its H.264
original or the script fails.

Images (`copy_assets.py`): test-view crops chosen by the criteria above,
AVIF at CRF 18 for the evidence crops (SSIM at least 0.988) and CRF 30
for plots.

## Security, accessibility, performance

These decisions came out of a 2026 research pass over OWASP, MDN, W3C,
and web.dev material, combined with live probing of GitHub Pages.

Security. GitHub Pages allows no custom response headers, so the page
carries a meta CSP with `default-src 'none'` and explicit allowances;
`frame-ancestors` cannot be set this way, which is acceptable for a
read-only page. Outbound clicks send no referrer. Workflow actions are
pinned to commit SHAs, the workflow runs with least-privilege
permissions, and Dependabot keeps both the pins and the dev dependencies
current. The service worker never caches error pages. If the noscript
`<style>` ever changes, its CSP hash must be recomputed.

Accessibility, targeting WCAG 2.2 AA. CI enforces zero axe violations,
and the criteria that tools cannot check are handled by hand: every drag
interaction has a single-pointer alternative, one pause control stops
all moving content, `prefers-reduced-motion` is honored in JS because
CSS cannot stop video autoplay, sliders expose `aria-valuetext`, every
video has an accessible name, the page has a skip link, forced-colors
mode keeps the structure visible, and the footer carries an
accessibility statement.

Performance. Two codecs and two image formats with quality gates,
a hero-only critical path, background loading that cannot compete with
user actions or block the back/forward cache, the service worker for
repeat visits, and `text-wrap: balance`/`pretty` for typography. The
loading overlay costs LCP in lab measurements; it stays because it is
the design the site wants, and with `noindex` there is no ranking to
lose.

## Development

```bash
npm run serve        # range-capable server on http://127.0.0.1:4173
```

Local serving must support HTTP Range requests, as GitHub Pages does.
`python -m http.server` does not, and Chromium then suspends video
downloads that can never finish, leaving videos unseekable.
`tests/server.py`, behind `npm run serve`, handles ranges. VS Code Live
Server also works; hard-refresh after multi-file edits, because its hot
reload can serve mixed intermediate states.

## Tests

```bash
npm install
npx playwright install chromium   # 1.57+ ships H.264 and AV1 decoders
npm test                          # unit + e2e
```

Vitest covers the pure logic and the repo contracts: referenced assets
exist, CSP directives are present, the workflow is SHA-pinned, AVIF and
AV1 twins exist on disk, and the checkpoint math matches the rendered
videos. Playwright runs three projects (desktop, Pixel 7, iPad with
touch emulation) covering the loader including throttled networks and
missing files, slider drag/tap/keyboard, pair-sync drift across
scrolling and loop boundaries, the arena state machine with swap,
drag-and-drop, and pause semantics, the explorer, the lightbox, an
11-width responsive matrix from 320 to 1280 px, reduced motion, forced
colors, and an axe gate.

## CI and deployment

Every push and pull request runs the full suite. A green push to `main`
deploys `index.html`, `robots.txt`, `manifest.webmanifest`, `sw.js`
(with the build SHA injected), and `static/` to GitHub Pages. The Pages
source is set to "GitHub Actions" in the repository settings.

## Privacy and publishing

The site is unlisted: a `noindex, nofollow` meta with crawling allowed
so robots can read it, and no tracking or third-party requests. To make
the page indexable once the thesis is published, remove the robots meta
line in `index.html` (marked with a comment) and `robots.txt`.

## Open items

The hero Thesis (PDF) and Code buttons are disabled placeholders. Git
history carries every video re-render, about 1.5 GB; if render
iterations continue, consider squashing the history or moving media to
LFS or release assets.

## Credits

Page layout adapted from the [Nerfies](https://nerfies.github.io)
project page (CC BY-SA 4.0), reimplemented without its CDN
dependencies. Renders use the
[Mip-NeRF 360](https://jonbarron.info/mipnerf360/), Tanks & Temples,
and Deep Blending scenes, and build on the
[3D Gaussian Splatting](https://github.com/graphdeco-inria/gaussian-splatting)
codebase (Inria, GRAPHDECO).
