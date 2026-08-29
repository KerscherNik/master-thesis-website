# Frame-Synchronized Video Comparison on the Web — Best Practices (Safari-first)

Research notes for the thesis-page rebuild. Compiled 2026-08-29. Every claim carries a source
URL; claims marked **[verified locally]** were measured with `curl` against the live GitHub
Pages deployment (`kerschernik.github.io/master-thesis-website`) on 2026-08-29.

---

## 1. The single-file technique (all views encoded into ONE video)

Encoding all synchronized views into one file (side-by-side or grid mosaic) and displaying
crops is the only approach in which "same frame" is a property of the *data*, not of runtime
scheduling. There are three ways to display the crops; they are **not** equivalent.

### 1a. Two `<video>` elements playing the same file — does NOT guarantee frame equality

Two media elements are two independent playback pipelines even when `src` is identical. HTML
imposes no shared clock: *"one second on the wall clock may not correspond to one second of
playback, and two media elements playing at once on the same page may follow different clocks,
with media offset diverging over time even if playback was initiated simultaneously"* — the
W3C Multi-Device Timing CG's MediaSync book
(https://www.w3.org/community/webtiming/files/2018/05/arntzen_mediasync_web_author_edition.pdf).
Same file ≠ same decoder instance, so this variant inherits every problem of §2 (drift,
seek-landing skew) — you only save bandwidth via HTTP caching. Practical comparison tools that
took this path report exactly that: *"the two videos might fall out of sync during playback"*
(comp-r, https://github.com/simpajj/video-comparison-tool). **Rejected.**

### 1b. One element + CSS cropping (overflow hidden / `object-fit`+`object-position` / transform)

A single element = a single decoder = every pixel on screen is from one decoded frame. Frame
equality is guaranteed *by construction*. The limitation is structural: a DOM element renders
in exactly one place, so CSS cropping gives you **one crop per element**. It works for showing
a single grid cell (wrapper with `overflow:hidden`, oversized video positioned/scaled inside,
or `object-fit: cover` + `object-position`), but it cannot produce a wipe (two overlapping
views of different crops) or several tiles from the same element. Use it only when each visible
surface needs exactly one region of the mosaic — and then each surface is its own element and
you are back to multi-element sync (§2) between surfaces.

Also note the CSS-cropped element is still a plain `<video>`, so it inherits Safari's
never-played-black-frame behavior (§3).

### 1c. One element + canvas `drawImage` crops — guarantees frame equality, and fixes §3 for free

`drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh)` accepts a source rectangle, so N crops of
the same mosaic frame are N `drawImage` calls from one element. All calls inside one
`requestVideoFrameCallback` (or rAF) tick read the *same* decoded frame — frame equality across
the wipe and all tiles is guaranteed by construction. When a video is used as a `drawImage`
source, the *"frame at the current playback position"* is drawn — this works on paused videos
too, provided a frame has actually been decoded/presented
(https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage).

Decisive extra property: **a canvas retains its last painted pixels**. Once you have painted a
frame, pausing, backgrounding, or Safari deciding not to composite the video element cannot
black out your UI — the black-frame class of bugs (§3) is eliminated at the display layer.
And while paused, moving the wipe slider is a pure repaint from the already-decoded frame — no
seek, no video interaction at all.

**Safari specifics and pitfalls:**

- **Same-origin / tainting.** Drawing a video onto a canvas is always allowed; it is *readback*
  (`getImageData`, `toBlob`, `toDataURL`) that is blocked once the canvas is tainted by
  cross-origin media without CORS approval
  (https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image). Assets served
  from the same GitHub Pages origin — or `blob:` URLs created from same-origin fetches — never
  taint. GitHub Pages additionally sends `access-control-allow-origin: *` **[verified
  locally]**, so even a cross-origin asset host would work with `crossorigin="anonymous"`.
  Since we never read pixels back, tainting is a non-issue either way.
- **Paused/never-played draws.** A never-played, never-seeked element may have no presented
  frame; historic WebKit regressions made `drawImage` paint the *first* frame regardless of
  `currentTime`, or paint nothing: WebKit bug 153588 *"REGRESSION (Safari 9): drawImage doesn't
  paint the current frame of a video"* (intermittent, worst when the video element is hidden
  and not recently interacted with; a reporter's mitigation was drawing twice with a delay)
  (https://bugs.webkit.org/show_bug.cgi?id=153588), and blank `drawImage` screenshots in Safari
  reported against hls.js (https://github.com/video-dev/hls.js/issues/1806). Mitigations that
  compose well: prime the pipeline once (muted `play()` → `pause()`, or a media-fragment/
  `currentTime` seek) before the first draw; repaint on `seeked` *and* on the next
  `requestVideoFrameCallback` after a seek rather than trusting a single immediate draw.
- **Performance.** 2–5 crop draws per tick at 720p–1080p source is well within what the
  canvas-paint pattern is designed for — painting video frames to canvas per frame is the
  canonical `requestVideoFrameCallback` use case
  (https://web.dev/articles/requestvideoframecallback-rvfc). Callbacks fire at the *video's*
  frame rate (e.g., 30 Hz for 30 fps content), not the display rate, so a 30 fps mosaic costs
  30 paint batches/s, not 60. Keep it fast by (i) never calling `getImageData`/readback (forces
  GPU→CPU sync), (ii) sizing canvases once (backing store = CSS px × `devicePixelRatio`, capped
  sanely), (iii) drawing crops directly rather than via intermediate canvases. Historic
  mobile-Safari canvas-from-video freezes exist (iOS 11-era,
  https://github.com/jeeliz/jeelizFaceFilter/issues/14) — old, but justify a smoke test on a
  real device.
- **Off-viewport suspension.** Safari can blank/suspend a muted video element outside the
  viewport (WebKit bug 241152, https://bugs.webkit.org/show_bug.cgi?id=241152). Since the
  driving element is hidden anyway, hide it as `opacity:0`/clipped *inside* the viewport (or
  `visibility:hidden` near the canvas) rather than `display:none` or far off-screen, and treat
  "canvas keeps last frame" as the safety net it is.

**Verdict: 1c is the correct technique.** One decoder, one clock, one seek target; sync is
unfalsifiable because it is encoded in the pixels.

---

## 2. Multi-element sync: state of the art — honestly, best-effort

- **No shared clock exists.** See the MediaSync book quote in §1a; drift between two playing
  elements is expected behavior, not a bug
  (https://www.w3.org/community/webtiming/files/2018/05/arntzen_mediasync_web_author_edition.pdf).
- **`timeupdate` is useless for sync**: it fires "every 15 to 250 ms", which is why Bocoup's
  classic write-up drives correction from rAF instead
  (https://bocoup.com/blog/html5-video-synchronizing-playback-of-two-videos).
- **Best known technique** is exactly what the current implementation does: continuous
  `playbackRate` adjustment (the "media sync" / timingsrc approach). The MediaSync literature
  reports ~±25 ms achievable with variable playbackRate — i.e., *about one frame at 30 fps, in
  the good case* (https://www.w3.org/community/webtiming/files/2018/05/arntzen_mediasync_web_author_edition.pdf).
- **`requestVideoFrameCallback` support**: Chrome/Edge 83+, Firefox 132+, **Safari 15.4+**
  (desktop and iOS) (https://caniuse.com/mdn-api_htmlvideoelement_requestvideoframecallback,
  https://webstatus.dev/features/request-video-frame-callback). Caveats: it is explicitly
  *best-effort* — main-thread callback vs. compositor-thread presentation, no strict guarantee
  (https://web.dev/articles/requestvideoframecallback-rvfc); Safari's implementation is broken
  under DRM (irrelevant here, but shows WebKit's rVFC is the least battle-tested:
  https://github.com/videojs/video.js/pull/7854). rVFC gives you *observation* of per-element
  frame times (`metadata.mediaTime` identifies the exact presented frame,
  https://wicg.github.io/video-rvfc/) — it does not give you *control* of when the next frame
  presents.
- **Seeking is not frame-accurate either**: WebKit has a long-standing bug "Frame accurate
  seeking isn't always accurate" (https://bugs.webkit.org/show_bug.cgi?id=52697) — matching the
  observed "seek lands behind a moving target" failures.
- **Audio-less playback** doesn't help: without an audio track there is no audio clock to slave
  to; Chromium derives `currentTime` from the audio clock when present, otherwise from a
  monotonic media clock — either way, two elements = two clocks
  (https://web.dev/articles/requestvideoframecallback-rvfc).

**Conclusion:** There is no reliable way to *frame-lock* two independent `<video>` elements on
Safari (or anywhere). Rate-nudging + rVFC observation can hold ~1 frame of agreement while
both are steadily playing, but every pause, seek, tab-switch, stall, or Safari power-saving
intervention is a resync event. Multi-element sync is fundamentally best-effort; the observed
Safari bug tail (black paused frames, seek-behind-target, post-pause desync) is the expected
cost. Use it only where being ±1–2 frames off is acceptable.

---

## 3. Safari paused-video rendering (the black-frame problem)

**Documented behavior:** iOS Safari does not render a frame for a video element that has never
played, even with data loaded — only mac Safari shows the first frame; iOS shows it only if
autoplaying. `preload="auto"` does not help. This is tracked publicly in WordPress/Gutenberg
issue #51995, open since 2019 (https://github.com/WordPress/gutenberg/issues/51995), and
matches long-standing WebKit behavior where nothing is displayed until a frame is available
and WebKit declines to make one available without playback (cf. old WebKit bug 44010 on
`preload="none"` display, https://bugs.webkit.org/show_bug.cgi?id=44010).

**Accepted workarounds, ranked for current Safari (17/18):**

1. **Media fragment `#t=0.001` on the source URL** — forces Safari to decode and present that
   frame; the Gutenberg-adopted fix and the most widely validated
   (https://github.com/WordPress/gutenberg/issues/51995,
   https://muffinman.io/blog/hack-for-ios-safari-to-display-html-video-thumbnail/). Costs a
   download of the first chunk. Equivalently, programmatically set `currentTime` to a small
   epsilon after `loadedmetadata`.
2. **Micro play–pause priming**: `video.muted = true; video.playsInline = true;
   await video.play(); video.pause();` — requires the muted+playsinline autoplay carve-out
   (https://www.sitelint.com/blog/fixing-html-video-autoplay-blank-poster-first-frame-and-improving-performance-in-safari-and-ios-devices).
   Reliable, but racy if fired before enough data buffered, and it can advance time slightly.
3. **`poster` attribute** — sidesteps decoding entirely; correct for static covers but useless
   for a scrubber that must show *arbitrary* paused frames
   (https://www.sitelint.com/blog/fixing-html-video-autoplay-blank-poster-first-frame-and-improving-performance-in-safari-and-ios-devices).
4. **Draw to canvas** — displaces the problem from "will Safari composite a frame?" (not
   controllable) to "has one frame ever been decoded?" (controllable via 1 or 2), after which
   the canvas persists pixels regardless of what the element does. Most *robust* on current
   Safari, because it removes the element from the visual path entirely (§1c).

For a plain `<video>` the most reliable single fix on Safari 17/18 is **#t=0.001 (or an
explicit epsilon seek) plus repaint-relevant state driven from `seeked`**; for this project the
canvas path makes the question moot.

---

## 4. Streaming vs. full-download (blob) for interactive scrubbing

**Safari's Range requirements are real and strict.** Safari refuses to play progressive media
from servers that answer a `Range` request with `200` + full body; it demands `206 Partial
Content`, and it opens with a `Range: bytes=0-1` two-byte probe before requesting real ranges,
then fetches in many chunked range requests
(https://corevo.io/the-weird-case-of-video-streaming-in-safari/,
https://blog.logrocket.com/streaming-video-in-safari/,
https://stephenweiss.dev/safari-streaming-video/). If a service worker intercepts media
fetches, it must reproduce 206 semantics itself or Safari breaks
(https://philna.sh/blog/2018/10/23/service-workers-beware-safaris-range-request/).

**GitHub Pages passes. [verified locally 2026-08-29]** Against
`https://kerschernik.github.io/master-thesis-website/static/videos/flythrough_sad_flowers.mp4`
(27.4 MB, served by Fastly for GitHub Pages):

- `GET` + `Range: bytes=0-1` → `HTTP/2 206`, `content-range: bytes 0-1/27446099`, 2 bytes —
  i.e., Safari's probe is answered correctly.
- Mid-file `Range: bytes=10000000-10000999` → `206`, exactly 1000 bytes; tail range → `206`.
- Cold-cache (cache-busted URL, `x-cache-hits: 0`) → still `206`.
- `Accept-Ranges: bytes` is advertised. (Caveat noted for methodology: `HEAD` requests return
  `200` ignoring `Range` — permitted behavior, irrelevant to playback.)

So progressive playback + Range seeking works on GitHub Pages for Safari today. (The
frequently-cited "Pages doesn't do 206" issue is **GitLab** Pages, since fixed:
https://gitlab.com/gitlab-org/gitlab-pages/-/issues/504. General Range mechanics:
https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests.)

**Is blob-URL full-download still needed?** Not for *correctness* — Range suffices. It remains
the right choice for the *scrub-heavy* interactions, for latency reasons rather than protocol
reasons: a network seek in Safari means new range round-trips (Safari also closes and reopens
connections every few MB during range streaming,
https://corevo.io/the-weird-case-of-video-streaming-in-safari/), during which the element sits
in `seeking` with a stale/blank presentation — exactly the "seek lands behind the target"
failure mode when the target keeps moving. With the file fully in memory (`fetch` → `Blob` →
`URL.createObjectURL`), every seek is local and bounded only by decode. Recommendation:
progressive+Range for anything that just plays; **full-download-then-blob (or
download-then-play gating) for the scrubber and the wipe arena**, with a visible download
progress affordance. This also makes behavior deterministic in tests.

---

## 5. Encoding practices for comparison/scrub videos

- **Keyframe interval.** Seeks land on / decode from I-frames; more keyframes = finer, faster
  scrubbing at the cost of bitrate (every keyframe is a full picture)
  (https://www.totalmedia.ai/en/resources/blog/keyframe-interval-explained-its-effect-on-video-compression-seeking-and-playback,
  https://liveapi.com/blog/keyframe-interval/). For scrub-heavy content use a short, *regular*
  GOP: `-g <fps> -keyint_min <fps> -sc_threshold 0` (keyframe every second, no scene-cut
  surprises); for the checkpoint scrubber where every position is a seek target, go shorter
  (`-g 15` at 30 fps ≈ 0.5 s granularity) or **all-intra (`-g 1`)** for perfectly uniform,
  instant seeks on short clips — accept ~3–5× the file size, or place keyframes exactly at
  checkpoint timestamps with `-force_key_frames "expr:..."` as the middle path.
- **H.264 profile/level.** H.264 (AVC) in MP4 is the universally-safe codec for Safari back to
  ancient versions. Use High profile (every Safari-17-capable device decodes High in hardware);
  pick the level from the mosaic dimensions — per the AVC level tables, a 3840×1080@30 (2×1080p
  side-by-side) stream fits Level 5.0, @60 needs 5.1; a 3840×2160 2×2 grid @30 needs 5.1
  (https://en.wikipedia.org/wiki/Advanced_Video_Coding#Levels). Let x264 derive the level
  rather than forcing one, but verify the mosaic resolution stays within 4096-wide hardware
  decoder comfort.
- **AV1 is not viable as the only codec.** Safari 17+ plays AV1 **only with hardware decode**:
  iPhone 15 Pro (A17 Pro)+, M3+ Macs, M4 iPad Pro; M1/M2, Intel Macs and earlier iPhones get
  no software fallback at all (https://bitmovin.com/blog/apple-av1-support/,
  https://bitmovin.com/blog/av1-playback-support/,
  https://developer.apple.com/forums/thread/739953). At most an optional `<source>` above the
  H.264 one.
- **`yuv420p` is mandatory.** 8-bit 4:2:0 is the only pixel format all H.264 web/hardware
  decoders must support; 4:2:2/4:4:4 or 10-bit yields black frames or failures outside
  Chrome's software paths
  (https://academysoftwarefoundation.github.io/EncodingGuidelines/Encodeh264.html,
  https://news.ycombinator.com/item?id=34968507). Tag color explicitly:
  `-color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709`.
- **`-movflags +faststart`** relocates the `moov` atom to the front so metadata arrives before
  media data — required for immediate progressive start/seek
  (https://academysoftwarefoundation.github.io/EncodingGuidelines/Encodeh264.html).
- Reference recipe (ORI web-review guidance + above):
  `ffmpeg -i left.mp4 -i right.mp4 -filter_complex hstack \`
  `-c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -g 30 -keyint_min 30 -sc_threshold 0 \`
  `-color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 \`
  `-movflags +faststart -an out_sxs.mp4` (use `xstack` for 2×2 grids; `-g 1` variant for the
  scrubber clips). Strip audio (`-an`) — no audio clock is needed when nothing must sync to it.

---

## Recommended architecture

Principle: **one decoded frame is the single source of truth for every pixel on screen.**
Eliminate runtime synchronization instead of improving it.

### (a) Wipe comparison (method A vs. method B)

- Encode A|B **side-by-side into one H.264 file** (2W×H, `hstack`, recipe above, GOP = 1 s).
- One **hidden** driver element: `<video muted playsinline preload="auto"
  src="...mp4#t=0.001">` — kept inside the viewport but visually hidden (not `display:none`,
  not off-screen; §1c off-viewport caveat). The `#t=0.001` fragment plus a one-time muted
  play→pause priming guarantees a decoded frame exists before the first paint (§3).
- One **visible canvas** (W×H CSS px, backing store × devicePixelRatio). Per frame:
  `drawImage(v, 0,0,W,H → canvas)` for A, then clip to `[0, sliderX]` and
  `drawImage(v, W,0,W,H → canvas)` for B (or draw partial source rect directly). Two
  `drawImage` calls per tick — cheap (§1c).
- Paint scheduling: `requestVideoFrameCallback` loop while playing (fires at video fps;
  Safari ≥15.4); repaint on `seeked`; after any seek also repaint on the next rVFC tick
  (double-paint guards WebKit's stale-frame history, bug 153588); repaint on slider input —
  which while paused touches only the canvas, never the video. **Playing and paused states are
  the same code path and cannot desync — the two methods share literal pixels of one frame.**

### (b) Preview tiles (methods C and D — all four views on the same frame)

- Extend the mosaic: **one 2×2 grid file** (A B / C D) at the largest per-view resolution the
  level/bitrate budget allows (3840×2160@30 fits Level 5.1). The wipe canvas draws from cells
  A/B; each tile is a small canvas drawing its cell in the same rVFC callback. Four views, one
  element, one clock: frame equality across arena *and* tiles by construction — including
  while paused and across play/pause/swap transitions that broke the multi-element design.
- If the grid's resolution compromise is unacceptable for the arena, fall back to two files
  (A|B hi-res for the arena, C|D low-res for tiles) — but then tile↔arena agreement is
  best-effort rate-nudged sync again (§2, ~±1 frame while playing, resync on every pause).
  State this trade-off explicitly; prefer the single grid.

### (c) Training-progress scrubber (two methods, seek to same checkpoint)

- Same construction: one side-by-side file per scene, both methods in-frame; a checkpoint seek
  is **one** `currentTime` assignment on one element — the two methods cannot land on
  different checkpoints, by construction.
- Encode for seeking: all-intra (`-g 1`) if clips are short, else
  `-force_key_frames` exactly at checkpoint timestamps, so every checkpoint seek is an
  I-frame hit (fast, exact) (§5).
- Treat a seek as complete only at `seeked` (+ one paint), never on issuing it; ignore stale
  `seeked`s by comparing against the last requested target (WebKit seek accuracy, bug 52697).
- Serve from GitHub Pages (Range verified, §4), but for this scrub-centric widget prefetch the
  full file → blob URL before enabling the scrubber, so every checkpoint jump is
  local-latency and no seek ever waits on Fastly round-trips.

### Cross-cutting

- All files: H.264 High, `yuv420p`, bt709 tags, `+faststart`, `-an`, short/regular GOP (§5).
  AV1/HEVC only as optional additional `<source>`s (§5).
- Keep `#t=0.001` on any *plain* `<video>` that still exists (e.g., simple non-compared clips).
- One real-device Safari/iOS smoke test of the canvas paint path (never-played prime → paused
  draw → seek → draw) belongs in the deploy checklist; the WebKit history in §1c/§3 is exactly
  the class of thing only a device test catches.
