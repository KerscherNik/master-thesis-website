# Arena & explorer rebuild: one reel, many crops

Decision record for the 2026-08-29 rebuild, synthesizing
`project-pages-video-comparison.md` (survey of deployed research pages) and
`synced-video-best-practices.md` (platform evidence, all claims cited there).

## Why the old architecture could not be saved

The arena synchronized four independent `<video>` elements (two in the wipe,
two bench tiles) with playbackRate nudging, hold/intent bookkeeping, and
watchdogs. The research verdict is unambiguous:

- No shared clock exists between HTML media elements; ~one frame of drift is
  the documented best case, and every pause/swap/seek re-fights the battle.
- Not one of seven surveyed research pages (Nerfies, Ref-NeRF, Zip-NeRF,
  mip-splatting, SurfSplatting, 3DGS, MipNeRF-360) attempts multi-video JS
  sync. The standard technique — a shared `video_comparison.js` by Dor
  Verbin — bakes both methods into ONE video and paints crops on a canvas.
- Safari renders nothing for a never-played element (the "black frame"
  class), WebKit seeks are not frame-accurate, and a dying service worker
  had been pinning stale code on top of it all.

## The new model

One **reel** per section: a single hidden `<video>` (muted, playsinline,
`height: 0` in-layout — never `display:none`, WebKit blanks off-viewport
video) whose file contains every view of the same camera path:

- `static/videos/grid/flygrid_<scene>.mp4` — 2×2 grid, 956×630 per
  quadrant (1912×1260): SAD top-left, 3DGS top-right, MCMC bottom-left,
  FDS-GS bottom-right. One file per scene replaces four.
- `static/videos/grid/proggrid_<scene>.mp4` — SAD|3DGS side-by-side for
  the training explorer, keyframes forced at the 11 checkpoint seek times.

Every visible surface is a `<canvas>` painted from the reel with
`drawImage` source-rect crops:

- the wipe: left-method crop up to the slider x, right-method crop after it;
- the bench tiles: the two unbenched quadrants, small;
- the lightbox: a larger canvas from the same reel;
- the explorer: two canvases, left and right half.

**Sync is correct by construction** — every surface shows the same decoded
frame because there is only one frame. Swaps and drag-and-drop change crop
offsets: instantaneous, no fetch, no alignment, no black. Pause/play is one
element. A scene switch loads one file. Canvases retain their last pixels,
so nothing visible can ever go black while data loads behind the veil.

Encoding (per the platform evidence): H.264 High, yuv420p, `-g 30
-sc_threshold 0` (checkpoint keyframes for the explorer), `+faststart`,
no audio. Grid at CRF 25 ≈ 29 MB/scene — roughly half of the four separate
files it replaces. AV1 twins stay optional (Safari decodes AV1 only on
recent hardware; H.264 is the Safari-first primary).

## Safari specifics honored

- Prime each reel once after attach: muted `play()` → `pause()` (forces the
  decode pipeline; canvases then paint paused frames reliably).
- Double-paint after seeks (WebKit stale-frame drawImage history).
- Paint loop on `requestVideoFrameCallback` (Safari 15.4+) with a rAF
  fallback; paused repaints happen on demand (slider drag, swap, seek).

## What survives from the old code

The loader (critical = flowers grid), the demand gate (background prefetch
of the other nine grid files parks during on-demand loads), blob caching
with progressive fallback, the lightbox chrome, all page-level a11y, and
the standalone fly-through slots (single videos, no sync needed).
What dies: pairSync, hold/intent bookkeeping, both watchdogs, the tile
nudge loop, per-tile fetch orchestration — the bug tail of an architecture
no working page ever shipped.
