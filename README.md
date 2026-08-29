# A High-Frequency Perspective on 3D Gaussian Splatting: project page

Project page for the MSc thesis on SAD (Spectral-Aware Densification).
SAD steers 3D Gaussian Splatting densification with a frequency-domain
deficit signal and reaches matched quality on Mip-NeRF 360 with about
25% fewer Gaussians.

Live site: https://kerschernik.github.io/master-thesis-website/

The URL is public but unlisted: a `noindex` meta and a crawl-permitting
`robots.txt` keep the page out of search engines. To publish, remove the
robots meta line in `index.html` (marked with a comment) and delete
`robots.txt`.

## Technologies

- Page: hand-written HTML, CSS, and JavaScript. No framework, no CDN,
  no build step, system fonts only.
- Media: H.264 and AV1 video (SVT-AV1), JPEG and AVIF images, encoded
  with ffmpeg.
- Renders: PyTorch / 3DGS pipelines on a SLURM cluster
  (see `asset_scripts/`).
- Tests: Vitest (unit) and Playwright (end-to-end).
- Hosting: GitHub Pages, deployed by GitHub Actions.

## Page content

1. Hero with title, author, supervisors, and resource buttons
   (Thesis PDF and Code are placeholders until those links exist).
2. Teaser: the flowers test view, SAD vs 3DGS behind a draggable
   comparison slider.
3. Abstract and the five-step method strip.
4. Results table: Mip-NeRF 360 averages plus Tanks & Temples and
   Deep Blending.
5. Comparison grid: six detail-crop sliders, one per scene across the
   three benchmarks. `copy_assets.py` picks each crop where the visible
   SAD-vs-3DGS difference is largest among regions where SAD also beats
   the baseline against ground truth.
6. Density map figure.
7. Fly-through arena: 4 methods x 6 scenes, 24 videos. Two methods play
   synchronized behind the slider; the others are bench tiles that can
   be dragged onto either side (each tile also has swap buttons for
   touch). A play/pause button freezes ring and bench at the same
   timestamp. Swaps and scene switches while paused stay paused, with
   the incoming video seeked to the frozen timestamp.
8. Training progress: SAD and 3DGS side by side, stepped through 11
   checkpoints (500 to 30,000 iterations) by a timeline scrubber, for
   four scenes.
9. Pareto plot, BibTeX, footer.

## Repository layout

```
index.html               the page
static/css/index.css     all styling
static/js/core.js        pure logic (checkpoint math, path helpers); UMD,
                         imported by the page and the unit tests
static/js/compare.js     behaviour: loader, sliders, arena, explorer,
                         lightbox, service-worker registration
static/images/           renders and figures, plus AVIF twins
static/videos/           H.264 videos, AV1 twins under av1/
sw.js                    service worker (build id injected at deploy)
manifest.webmanifest     web app manifest and icons
tests/unit/              Vitest: core logic and repo contracts
tests/e2e/               Playwright: desktop, phone, tablet projects
tests/server.py          local server with HTTP Range support
asset_scripts/           render scripts and SLURM templates (own README)
.github/workflows/ci.yml test and deploy pipeline
```

## How the page works

Loading. An overlay streams the hero video pair (about 26 MB as AV1)
into blob URLs, then reveals the page. A skip button appears after 4
seconds. Save-Data and 2G visitors skip the preload and get progressive
playback, as does `file://`.

Playback. Comparison pairs play from fully buffered blobs. A
requestAnimationFrame loop corrects drift above 0.08 s; a watchdog
restarts a pair that is visible but stuck. A pause from the button or
from `prefers-reduced-motion` overrides all automatic play.

Codecs. AV1 is chosen per browser via `canPlayType`, per file, with
H.264 fallback. If an AV1 blob fails to decode, the page drops AV1 for
the session and refetches that file as H.264. Images use `<picture>`
with AVIF and JPEG.

Background loading. After the reveal: progress videos, then each
scene's active pair, then bench videos. Two parallel streams run at
`priority: "low"`, yield to user-initiated loads, abort on `pagehide`
(keeps back/forward-cache eligibility), and resume on restore.

Service worker. Caches HTML, CSS, JS, and images. The cache name is the
deploy SHA; old caches are deleted on activation. GitHub Pages serves
everything with `max-age=600` and no header control, so this is the
only long-lived cache. Videos are not intercepted: Safari terminates
service workers mid-download, which corrupted video fetches, so videos
use the page's blob streaming plus the HTTP cache.

Explorer. Progress videos hold each checkpoint for 21 frames at 30 fps,
final checkpoint 3x (273 frames). The scrubber seeks both videos to
`(21k + 10.5)/30` s. Unit tests pin this layout against ffprobe output.

Lightbox. A native `<dialog>` opened with `showModal()`. Comparisons,
figures, and bench tiles enlarge into it.

## Asset pipeline

All media are renders from trained checkpoints under
`/export/scratch/ra28kuc/output/`. `asset_scripts/README.md` lists the
model directories and submission commands.

Camera path (`campath.py`): an elliptical orbit fitted through the
training cameras, with a raised-cosine dolly into the focus region at
mid-loop and a slower sweep there. Dolly per scene: 0.45 for flowers,
garden, truck; 0.60 for bicycle and stump; 0.35 with orbit scale 0.75
for the indoor drjohnson. All methods of a scene share the same path,
so the sliders stay frame-aligned.

FDS-GS renders need the FDS-GS codebase and conda env: its plys carry a
per-Gaussian filter radius `R` and log-scales up to about 11, which
crash the vanilla rasterizer (`slurm/web-flythrough-dolly2-fds.sh`).

Progress runs are trainings with dense `--save_iterations` in the SAD
FINAL configuration; Tanks & Temples and Deep Blending use
`--resolution -1`.

AV1 encoding (`slurm/web-av1-encode.sh`, login node; the compute-node
ffmpeg is broken): SVT-AV1 preset 6, CRF 30, garden CRF 26. Each file
must reach SSIM 0.97 against its H.264 original or the script fails.
Image AVIFs: CRF 18 for the comparison crops (SSIM 0.988+), CRF 30 for
plots.

## Security

GitHub Pages allows no custom response headers, so the security policy
is a meta CSP: `default-src 'none'` with explicit allowances for
same-origin scripts, styles, images, and `blob:` media.
`frame-ancestors` only works as a real header and is therefore not set.
The page sends no referrer on outbound links. Workflow actions are
pinned to commit SHAs, the workflow runs with `contents: read`, and
Dependabot updates the pins and the dev dependencies. If the noscript
`<style>` changes, its CSP sha256 hash must be recomputed.

## Accessibility

Target: WCAG 2.2 AA. CI enforces zero axe violations. Beyond that:
every drag interaction has a click alternative (track click on sliders,
buttons on tiles), one pause control stops all moving content,
`prefers-reduced-motion` disables video autoplay in JS (CSS cannot),
sliders expose `aria-valuetext`, videos have accessible names, a skip
link precedes the content, forced-colors mode keeps dividers and
handles visible via borders, and the footer links to the issue tracker
for accessibility reports.

## Development

```bash
npm run serve        # http://127.0.0.1:4173
```

The local server must support HTTP Range requests, which GitHub Pages
does. `python -m http.server` does not; Chromium then suspends video
downloads that never finish and the videos stay unseekable.
`tests/server.py` handles ranges. VS Code Live Server also works;
hard-refresh after multi-file edits because its hot reload can serve
mixed intermediate states.

## Tests

```bash
npm install
npx playwright install chromium   # 1.57+ ships H.264 and AV1 decoders
npm test                          # unit + e2e
```

Unit tests cover the core logic and repo contracts: referenced assets
exist, CSP directives present, workflow SHA-pinned, AVIF and AV1 twins
on disk, checkpoint math matching the rendered videos. Playwright runs
three projects (desktop, Pixel 7, iPad with touch) covering the loader
(including throttled network and missing files), slider
drag/tap/keyboard, pair-sync drift across scrolling and loop
boundaries, the arena (swap by button, synthetic and real mouse
drag-and-drop, pause semantics including paused swaps), the explorer,
the lightbox, an 11-width responsive matrix (320 to 1280 px), reduced
motion, forced colors, and an axe gate.

## CI and deployment

Every push and pull request runs the full suite. A green push to `main`
deploys `index.html`, `robots.txt`, `manifest.webmanifest`, `sw.js`
(build SHA injected) and `static/` to GitHub Pages. The Pages source is
set to "GitHub Actions" in the repository settings.

## Open items

- Hero Thesis (PDF) and Code buttons are disabled placeholders.
- Git history carries every video re-render (about 1.5 GB). If renders
  keep changing, squash the history or move media to LFS or release
  assets.

## Credits

Page layout adapted from the [Nerfies](https://nerfies.github.io)
project page (CC BY-SA 4.0), reimplemented without its CDN
dependencies. Renders use the
[Mip-NeRF 360](https://jonbarron.info/mipnerf360/), Tanks & Temples,
and Deep Blending scenes, and build on the
[3D Gaussian Splatting](https://github.com/graphdeco-inria/gaussian-splatting)
codebase (Inria, GRAPHDECO).
