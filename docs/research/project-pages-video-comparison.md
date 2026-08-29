# How research project pages actually implement interactive video comparisons

Survey of real, deployed implementations, read from source on 2026-08-29. Sources
were cloned/fetched into
`/tmp/claude-1095914420/-export-home-ra28kuc-projects-thesis-webpage/4ffa960f-8635-4170-8540-6a566f71693d/scratchpad/research/`
(nerfies is a full clone; the rest are the deployed pages' HTML/JS fetched with curl).

**Headline finding: not one of the eight pages investigated synchronizes two
`<video>` elements with JavaScript. Every wipe comparison over moving video is a
SINGLE mp4 with both methods baked side-by-side, split at render time.** The only
JS "sync" code found anywhere is a commented-out, abandoned attempt in the nerfies
repo (see below).

---

## 1. Nerfies — https://github.com/nerfies/nerfies.github.io (canonical template)

Clone: `.../scratchpad/research/nerfies/`. Relevant files: `index.html`,
`static/js/index.js`, `static/css/index.css`.

### (a) Techniques used

Nerfies has **no video-vs-video wipe slider at all**. It uses three patterns:

1. **Plain single videos, one file per clip** — hero teaser and an 8-video bulma
   carousel (`index.html:181`, `index.html:200-245`):
   ```html
   <video poster="" id="steve" autoplay controls muted loop playsinline height="100%">
     <source src="./static/videos/steve.mp4" type="video/mp4">
   </video>
   ```
   Every `poster` attribute is the empty string — posters are declared but unused.

2. **Comparisons baked into one file** — when two things are shown together, the
   composite is rendered offline into a single mp4:
   `static/videos/dollyzoom-stacked.mp4` (`index.html:320-321`). There is no
   runtime compositing and therefore no sync code.

3. **Slider scrubbing over pre-extracted JPEG frames, not video** — the
   "Interpolating states" slider (`index.html:362-383`) is an
   `<input type="range">` driving an image swap. `static/js/index.js:3-20`:
   ```js
   var INTERP_BASE = "./static/interpolation/stacked";
   var NUM_INTERP_FRAMES = 240;

   function preloadInterpolationImages() {
     for (var i = 0; i < NUM_INTERP_FRAMES; i++) {
       var path = INTERP_BASE + '/' + String(i).padStart(6, '0') + '.jpg';
       interp_images[i] = new Image();
       interp_images[i].src = path;
     }
   }
   ```
   All 240 JPEGs (`static/interpolation/stacked/000000.jpg` … `000239.jpg`) are
   eagerly preloaded on `$(document).ready`; slider `input` calls
   `setInterpolationImage(this.value)` which swaps the `<img>` into
   `#interpolation-image-wrapper` (`index.js:70-74`).

   **Crucially, `static/js/index.js:61-67` contains the corpse of a video-scrub
   approach they abandoned:**
   ```js
   /*var player = document.getElementById('interpolation-video');
   player.addEventListener('loadedmetadata', function() {
     $('#interpolation-slider').on('input', function(event) {
       console.log(this.value, player.duration);
       player.currentTime = player.duration / 100 * this.value;
     })
   }, false);*/
   ```
   They tried seeking a `<video>` per slider tick and replaced it with dumb JPEG
   frames. That is the closest thing to "video sync JS" in the whole template.

### (b) Sync correctness
By construction: one file per view, composites baked offline, scrubbing done on
still frames. Zero runtime sync.

### (c) Safari measures
`autoplay muted loop playsinline` on every video (`index.html:181` etc.). The
replay video additionally has a bare `preload` attribute (= `auto`)
(`index.html:396-401`). No posters (empty strings), no `preload="none"`, no lazy
loading, no IntersectionObserver anywhere in the repo.

---

## 2. Ref-NeRF — https://dorverbin.github.io/refnerf/ (origin of the canvas-wipe script)

Fetched: `refnerf.html`, `refnerf-video_comparison.js`, `refnerf-app.css` in the
scratchpad research dir. This is the page every splatting page credits —
mip-splatting's footer says: *"The video comparison with sliding bar is from
Ref-NeRF"* (`mip-splatting.html:520`).

### (a) Exact technique: single half-and-half mp4, hidden `<video>`, visible `<canvas>`

Markup (`refnerf.html:149-152`):
```html
<div class="video-compare-container" id="materialsDiv">
    <video class="video" id="materials" loop playsinline autoPlay muted
           src="video/materials_circle_mipnerf_ours.mp4"
           onplay="resizeAndPlay(this)"></video>
    <canvas height=0 class="videoMerge" id="materialsMerge"></canvas>
</div>
```
Note the filename: `materials_circle_mipnerf_ours.mp4` — **both methods are baked
left|right into one video that is twice the display width.**

`js/video_comparison.js` (header: "Written by Dor Verbin, October 2021 … based on
http://thenewcode.com/364/Interactive-Before-and-After-Video-Comparison-in-HTML5-Canvas"):

```js
function resizeAndPlay(element)
{
  var cv = document.getElementById(element.id + "Merge");
  cv.width = element.videoWidth/2;   // canvas is HALF the encoded width
  cv.height = element.videoHeight;
  element.play();
  element.style.height = "0px";  // Hide video without stopping it
  playVids(element.id);
}
```
The `<video>` is collapsed to `height: 0px` — **not** `display:none` — precisely
so the browser keeps decoding it (their own comment: "Hide video without stopping
it").

The wipe itself, in `playVids` (verbatim, this is the whole trick):
```js
var position = 0.5;
var vidWidth = vid.videoWidth/2;
var vidHeight = vid.videoHeight;
var mergeContext = videoMerge.getContext("2d");

if (vid.readyState > 3) {
    vid.play();
    function trackLocation(e) {
        bcr = videoMerge.getBoundingClientRect();
        position = ((e.pageX - bcr.x) / bcr.width);
    }
    videoMerge.addEventListener("mousemove",  trackLocation, false);
    videoMerge.addEventListener("touchstart", trackLocationTouch, false);
    videoMerge.addEventListener("touchmove",  trackLocationTouch, false);

    function drawLoop() {
        mergeContext.drawImage(vid, 0, 0, vidWidth, vidHeight, 0, 0, vidWidth, vidHeight);
        var colStart = (vidWidth * position).clamp(0.0, vidWidth);
        var colWidth = (vidWidth - (vidWidth * position)).clamp(0.0, vidWidth);
        mergeContext.drawImage(vid, colStart+vidWidth, 0, colWidth, vidHeight,
                               colStart, 0, colWidth, vidHeight);
        requestAnimationFrame(drawLoop);
        // ... then draws the divider line + arrows directly on the canvas
    }
    requestAnimationFrame(drawLoop);
}
```
Two `drawImage` calls per rAF frame from the SAME `HTMLVideoElement`: draw the
left half fully, then overdraw columns `[colStart, vidWidth)` from the right half
of the source. The slider handle, divider line, and arrow glyph are also drawn on
the canvas (no DOM handle). There is no `<input>`; the "slider" is just
`mousemove`/`touchmove` position tracking, no click needed.

CSS (`refnerf/css/app.css:174-198`): `.video-compare-container { position:
relative; line-height: 0 }`, `.video { width:100% }`, `.videoMerge {
position:relative; z-index:10; width:100% }` — canvas scales responsively via
CSS width while its backing store stays at native half-width resolution.

### (b) Sync correctness
**Absolute by construction: one file, one decoder, one `currentTime`.** Both
halves of every painted frame come from the same decoded frame. Nothing can
drift; there is no sync code to break.

### (c) Safari measures
`loop playsinline autoPlay muted` on the comparison videos; entry point is the
`onplay` DOM attribute (fires after autoplay actually starts, so canvas sizing
happens when `videoWidth` is known); `height:0` instead of `display:none`;
`readyState > 3` guard before wiring the loop (if data isn't ready at `onplay`
time, `playVids` silently does nothing — a known fragility of this script;
`loop` means `onplay` won't refire, so a too-early first fire could leave a dead
widget; in practice `onplay` fires when playback truly starts so it works).
No posters, no lazy loading.

---

## 3. Mip-Splatting — https://niujinshuchong.github.io/mip-splatting/

Fetched: `mip-splatting.html`, `mip-splatting-video_comparison.js`,
`mip-splatting-event_handler.js`, `mip-splatting-dics.js`.

### (a) Techniques

**Video wipes: verbatim Ref-NeRF script** (`static/js/video_comparison.js` is
byte-identical to Zip-NeRF's copy; differs from Ref-NeRF's original only in two
arrow-color constants `#444444` → `#AAAAAA`). Six comparison instances, e.g.
(`mip-splatting.html:164-165`):
```html
<video class="video" width="100%" id="xyalias6" loop playsinline autoplay muted
       src="resources/bicycle_3dgs_vs_ours.mp4"
       onplay="resizeAndPlay(this)" style="height: 0px;"></video>
<canvas height=0 class="videoMerge" id="xyalias6Merge"></canvas>
```
Note they additionally set `style="height: 0px;"` inline in the markup (Ref-NeRF
relied on JS alone), so the raw video never flashes before `resizeAndPlay` runs.

**Every pairing is its own pre-baked file.** They wanted several different A-vs-B
pairs, so they rendered one double-wide mp4 per pair:
`bicycle_3dgs_vs_ours.mp4`, `ship_3dgs_vs_ours.mp4`,
`materials_3dgs_ewa_vs_ours.mp4`, `bonsai_3dgs_ewa_vs_ours.mp4`,
`chair_ours_no2d_vs_ours.mp4`, `drums_ours_no3d_vs_ours.mp4`
(`mip-splatting.html:164,283,298,304,361,377`). N-way choice = N baked files, not
runtime composition.

**Multi-way still comparisons: the Dics library on JPEGs, not video.**
`static/js/dics.original.js` is "Dics: Definitive image comparison slider" by
Abel Cabeza Román (https://github.com/abelcabezaroman/definitive-image-comparison-slider).
It supports N simultaneous panes: the container is a flexbox of
`.b-dics__section` divs, each holding a **full copy of its image shifted left by
`i * -containerWidth` px** so each section reveals only its slice
(`dics.original.js:124-131`):
```js
section$$.style.flex = `0 0 ${initialImagesContainerWidth}px`;
section$$.querySelector(".b-dics__image").style[this.config.positionField] =
    `${i * -initialImagesContainerWidth}px`;
```
Dragging a divider rewrites the neighboring sections' `flex` bases
(`dics.original.js:518-528`). Scene switching is brute-force `src` swapping on
the four panes (`static/js/event_handler.js`, functions `objectSceneEvent`/
`ablation3DEvent`: 4 panes × `_ewa/_ours/_upgt/_gt.jpg` suffixes). **They chose
stills, not videos, for the 4-way case.**

### (b) Sync correctness
Video wipes: single baked file per pair (same as Ref-NeRF, perfect by
construction). 4-way comparison: sidestepped entirely by using stills.

### (c) Safari measures
`loop playsinline autoplay muted` + inline `height:0px` + `onplay` bootstrap.
No posters, no `preload` attributes, no lazy loading — the page simply loads six
double-wide mp4s eagerly.

---

## 4. Zip-NeRF — https://jonbarron.info/zipnerf/

Fetched: `zipnerf.html`, `zipnerf-video_comparison.js`, `zipnerf-app.js`.

- `js/video_comparison.js` is **byte-identical to mip-splatting's copy** (verified
  with `diff`). One wipe instance (`zipnerf.html:213-214`):
  ```html
  <video class="video" width=100% id="xyalias" loop playsinline autoplay muted
         src="img/xy_alias_swipe_crf27.mp4" onplay="resizeAndPlay(this)"></video>
  <canvas height=0 class="videoMerge" id="xyaliasMerge"></canvas>
  ```
  Filename says it: a pre-rendered "swipe" asset at CRF 27.
- Everything else is plain single `<video autoplay loop muted>` elements
  (`zipnerf.html:133-137,187-194,226-228`). Two videos are placed side by side in
  columns (`hexify_train.mp4` / `hexify_test.mp4`) **with no sync between them** —
  they just both autoplay and loop, and any drift is accepted.
- `js/app.js` contains only CodeMirror/bibtex/tooltip setup plus ~25 lines of
  **commented-out** scroll-scrubbing code (`vid.currentTime =
  window.pageYOffset/playbackConst`) — again an abandoned seek-based idea.
- Same story on Mip-NeRF 360 (`jonbarron.info/mipnerf360/`, fetched:
  `mipnerf360.html`): plain `<video autoplay loop muted controls>` only, no
  comparison widget at all.

---

## 5. 2D Gaussian Splatting / SurfSplatting — https://surfsplatting.github.io/

Fetched: `surfsplatting.html`.

- Wipes: same Ref-NeRF canvas script (`assets/js/bog/video_comparison.js`), same
  markup, used for the teaser and a counter-scene comparison
  (`surfsplatting.html:149-150, 292-293`):
  ```html
  <video class="video" width="100%" id="teaser" loop playsinline autoplay muted
         src="video/teaser.mp4" onplay="resizeAndPlay(this)" style="height: 0px;"></video>
  <canvas height=0 class="videoMerge" id="teaserMerge"></canvas>
  ```
- Also loads `assets/js/bog/dics.min.js` for still comparisons.
- Grid-of-results sections (`surfsplatting.html:242-263`) put multiple
  independent `<video playsinline autoplay loop muted>` elements next to each
  other; each file is itself a pre-composited comparison
  (`comp_barn_mesh.mp4`, `2dgs_vs_3dgs.mp4`). No cross-element sync attempted.

---

## 6. Original 3DGS page (Kerbl et al.) — https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/

Fetched: `3dgs.html`, `3dgs-script.js`.

### (a) Technique: two-element CSS overlay wipe — but for STILL IMAGES only

Videos on this page are all plain, single, pre-composited files
(`3dgs.html:194-215`, `content/videos/bicycle.mp4` etc.) — and notably they have
`autoplay controls muted loop` **without `playsinline`** (grep confirms zero
occurrences in the page), so on iPhone Safari these would go fullscreen/not
autoplay. A nerfies fork that dropped the attribute.

The interactive comparisons are image sliders (`BeforeAfter`, ids
`#example1/2/4/5`), instantiated inline at `3dgs.html:544-558`. Markup
(`3dgs.html:393-414`):
```html
<div id="example4" class="bal-container-small">
  <div class="bal-after">
    <img src="content/images/comparisons/ours_garden.png">
    ...
  </div>
  <div class="bal-before">
    <div class="bal-before-inset">
      <img src="content/images/comparisons/ingp_garden.JPG">
      ...
    </div>
  </div>
  <div class="bal-handle">...</div>
</div>
```
`static/js/script.js` (52 lines, class `BeforeAfter`): the `.bal-before` overlay's
`width` is set as a percentage on `mousemove`/`touchmove`, while
`.bal-before-inset` is pinned to the full container pixel width so the inner
image is cropped, not squashed:
```js
beforeAfterContainer.querySelector('.bal-before-inset')
    .setAttribute("style", "width: " + beforeAfterContainer.offsetWidth + "px;")
...
beforeAfterContainer.addEventListener('mousemove', (e) => {
    let newWidth = e.offsetX * 100 / containerWidth;
    if (e.offsetX > 10 && e.offsetX < beforeAfterContainer.offsetWidth - 10) {
        before.setAttribute('style', "width:" + newWidth + "%;");
        handle.setAttribute('style', "left:" + newWidth + "%;");
    }
})
```
This is the classic "clip the top element by resizing an overflow container"
pattern. It would work mechanically with two `<video>` elements — **and the 3DGS
authors did not do that**; where motion was needed they baked the comparison into
one mp4 instead.

### (b) Sync correctness
Stills: N/A. Videos: baked composites.

### (c) Safari measures
Weakest of the set: no `playsinline`, no posters, no preload strategy.

---

## 7. Briefly checked, no comparison widgets found

- **4D Gaussian Splatting** (https://guanjunwu.github.io/4dgs/, fetched
  `4dgs.html`): nerfies fork; every result is a plain single
  `<video autoplay muted loop playsinline>`; comparisons are baked files
  (`cut_roasted_beef_time.mp4` etc.). No slider, no canvas, no sync JS.
- **SAGA / Segment Any 3D Gaussians** (https://jumpat.github.io/SAGA/, fetched
  `saga.html`): nerfies fork; grid of independent autoplay videos
  (`./img/counter/scene_video.mp4` …), empty `poster=""` attributes, no
  comparison widget, no sync.

Also checked across ALL fetched pages: zero hits for `IntersectionObserver`,
`loading="lazy"`, non-empty `poster=`, or any `preload=` value except nerfies'
one bare `preload`. These pages simply eager-load everything and rely on
`autoplay muted` — none of them solve lazy loading; they just have short, heavily
compressed clips (e.g. Zip-NeRF's `_crf27` suffix).

---

## Patterns that hold up

Ranked for the three needs of the thesis page rebuild (wipe between 2 of 4
methods; small always-visible preview tiles of the other methods; paused
frame-accurate display). Ranking is based only on what the surveyed code
demonstrates.

### Rank 1 — One multi-view video file + canvas cropping (Ref-NeRF `video_comparison.js` family)

Proven on Ref-NeRF, Zip-NeRF, mip-splatting, SurfSplatting — the entire
Gaussian-splatting page ecosystem converged on this.

- **Sync:** structurally perfect. One `HTMLVideoElement`, one decode clock; the
  wipe is two `drawImage` source-rect crops of the same decoded frame. There is
  literally nothing to drift, and no black-frame risk from a second element,
  because there is no second element.
- **2 of 4 methods:** the surveyed pages solve N-way pairing by baking one
  double-wide mp4 per pair (mip-splatting: 6 files). The direct generalization —
  bake all 4 methods as a 4-wide (or 2×2) strip in ONE file and pick the two
  source-rect x-offsets (`methodIndex * vidWidth`) in `drawLoop` — is a
  ~5-line change to Verbin's script and keeps the single-decoder guarantee while
  letting the user choose any pair at runtime. (Cost: 4× encoded width; the
  surveyed pages accept 2× width at CRF ~27 without issue.)
- **Preview tiles:** the same hidden `<video>` can be drawn into any number of
  additional small canvases in the same rAF callback (one `drawImage` with that
  method's source rect per tile). All tiles are then the same frame as the wipe,
  by construction. No surveyed page does tiles-from-one-element — their tiles
  are independent unsynced videos — but the canvas API used (`drawImage` with
  source rects) is exactly the one already proven in `drawLoop`.
- **Paused frame:** pause the one element; `drawLoop` keeps repainting the held
  frame every rAF, so wipe interaction keeps working while paused, pixel-exact.
  (Optimization: gate the rAF on `!vid.paused || positionChanged`.)
- **Safari recipe as shipped:** `loop playsinline autoplay muted` + inline
  `style="height:0px"` (mip-splatting's addition — keeps decode alive, avoids
  pre-init flash; never `display:none`) + bootstrap from the `onplay` event +
  `readyState > 3` guard. Harden the known weakness: `onplay` firing before
  `readyState > 3` currently no-ops forever; retry on `canplaythrough` as well.

### Rank 2 — Pre-extracted frame images for scrubbed/paused comparison (nerfies interpolation slider)

- The only surveyed pattern where "paused, frame-accurate, scrub to any frame"
  is trivially exact: a range input indexes into 240 preloaded JPEGs
  (`nerfies/static/js/index.js:3-20,70-74`). No decoder involved, so no Safari
  seek/black-frame behavior can exist. Nerfies adopted this after abandoning
  `video.currentTime` scrubbing (the commented-out block at `index.js:61-67`).
- Costs: 240 requests eagerly fired, no audio, awkward for continuous playback.
  Best fit as the *paused inspection* mode, not the playback mode.

### Rank 3 — Two-element CSS overlay wipe (3DGS `BeforeAfter`, Dics)

- Proven for stills on the original 3DGS page (`static/js/script.js`) and, in
  N-way flexbox form, by Dics on mip-splatting (`dics.original.js`). Layout
  mechanism (overlay whose width is clipped while the inner content stays
  container-width) is sound and cheap, and Dics shows how to do a 4-pane divider.
- For video it would require two `<video>` elements — which is exactly the setup
  every surveyed page avoided for moving content. Acceptable only if both
  elements point at the SAME single-view file (same URL, so same cache entry) and
  even then the two decoders' clocks are not tied; the surveyed authors, given
  this exact choice, baked composites or used canvas instead. Use for still
  screenshots (per-scene PSNR crops) where it is the simplest thing that works.

### Anti-pattern — confirmed by absence: multi-video JS synchronization

Across nerfies, Ref-NeRF, Zip-NeRF, Mip-NeRF 360, mip-splatting, SurfSplatting,
3DGS, 4DGS, and SAGA: **zero** occurrences of `playbackRate` nudging, `seeked`
cross-correction, or any two-element sync. Where two videos appear side by side
(Zip-NeRF `hexify_*`, SurfSplatting `comp_*`), they are left free-running and
unsynced. The two places sync-by-seeking was drafted (nerfies `index.js:61-67`,
Zip-NeRF `app.js` scroll-scrub block) are both commented out in the shipped
pages. The current thesis-page architecture (two `<video>` elements +
playbackRate nudge) has no precedent among these pages — the field's answer to
the Safari problems it causes is "one file, one decoder, crop at paint time."

### Concrete recommendation for the rebuild

1. Bake all 4 methods into one strip/grid mp4 per scene (plus the camera path
   identical by construction).
2. One hidden `<video loop playsinline autoplay muted style="height:0">` per
   scene; one main wipe canvas + three small tile canvases painted from it in a
   single rAF loop (Verbin's `drawLoop` extended with per-canvas source-rect
   x-offsets chosen by the method selector).
3. Play/pause toggles the single element; keep repainting on interaction while
   paused for frame-accurate inspection.
4. Follow the shipped Safari recipe (`onplay` bootstrap + `readyState` guard,
   hardened with a `canplaythrough` fallback), and — unlike every surveyed page —
   add `preload="none"`/IntersectionObserver lazy loading yourself; nobody in
   this survey solves that.
