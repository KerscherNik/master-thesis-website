/* Pure page logic, shared between the browser script (compare.js) and the
   unit tests (tests/unit). No DOM access here. Loads as window.SADCore in
   the browser and as a CommonJS module under Node. */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SADCore = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* progress videos: one segment per saved checkpoint, each held HOLD_FRAMES
     frames at VIDEO_FPS, final checkpoint held FINAL_HOLD_MULT times as long
     (see asset_scripts/render_progress.py, --hold 0.7 at 30 fps). */
  var CHECKPOINTS = [500, 1000, 2000, 3000, 5000, 7000, 10000, 15000, 20000, 25000, 30000];
  var HOLD_FRAMES = 21;
  var VIDEO_FPS = 30;
  var FINAL_HOLD_MULT = 3;

  var PROGRESS_SCENES = {
    flowers: { sad: "static/videos/progress_sad_flowers.mp4",
               gs: "static/videos/progress_3dgs_flowers.mp4", ar: "1256 / 828" },
    bicycle: { sad: "static/videos/progress_sad_bicycle.mp4",
               gs: "static/videos/progress_3dgs_bicycle.mp4", ar: "1236 / 820" },
    truck: { sad: "static/videos/progress_sad_truck.mp4",
             gs: "static/videos/progress_3dgs_truck.mp4", ar: "1600 / 892" },
    drjohnson: { sad: "static/videos/progress_sad_drjohnson.mp4",
                 gs: "static/videos/progress_3dgs_drjohnson.mp4", ar: "1332 / 876" }
  };

  /* fly-through arena: 3 methods x 3 scenes, all pre-rendered */
  var FLY_METHODS = {
    sad:  { label: "SAD (ours)", file: "sad" },
    gs:   { label: "3DGS", file: "3dgs" },
    mcmc: { label: "3DGS-MCMC", file: "mcmc" },
    fds:  { label: "FDS-GS", file: "fdsgs" }
  };
  var FLY_SCENES = ["flowers", "bicycle", "garden", "stump", "truck", "drjohnson"];

  function flyPath(scene, method) {
    return "static/videos/flythrough_" + FLY_METHODS[method].file + "_" + scene + ".mp4";
  }

  /* every method not currently in the comparison waits on the bench */
  function benchedMethods(left, right) {
    return Object.keys(FLY_METHODS).filter(function (m) {
      return m !== left && m !== right;
    });
  }

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  /* seek target for checkpoint k: the middle of its hold segment */
  function checkpointTime(k) { return (k * HOLD_FRAMES + HOLD_FRAMES / 2) / VIDEO_FPS; }

  /* total frame count the videos must have for checkpointTime to be valid */
  function totalFrames() {
    return HOLD_FRAMES * (CHECKPOINTS.length - 1) + HOLD_FRAMES * FINAL_HOLD_MULT;
  }

  function formatIteration(it) { return "iteration " + it.toLocaleString("en-US"); }

  /* overall loader progress in [0, 1]: images by count, videos by bytes */
  function loaderProgress(imgDone, imgTotal, vidLoaded, vidTotal, imgWeight) {
    var iw = imgWeight === undefined ? 0.08 : imgWeight;
    var imgPart = imgTotal > 0 ? imgDone / imgTotal : 1;
    var vidPart = vidTotal > 0 ? clamp(vidLoaded / vidTotal, 0, 1) : 0;
    return iw * imgPart + (1 - iw) * vidPart;
  }

  /* horizontal fraction of tick i among n evenly spaced slider stops */
  function tickFraction(i, n) { return n > 1 ? i / (n - 1) : 0; }

  return {
    CHECKPOINTS: CHECKPOINTS,
    HOLD_FRAMES: HOLD_FRAMES,
    VIDEO_FPS: VIDEO_FPS,
    FINAL_HOLD_MULT: FINAL_HOLD_MULT,
    PROGRESS_SCENES: PROGRESS_SCENES,
    FLY_METHODS: FLY_METHODS,
    FLY_SCENES: FLY_SCENES,
    flyPath: flyPath,
    benchedMethods: benchedMethods,
    clamp: clamp,
    checkpointTime: checkpointTime,
    totalFrames: totalFrames,
    formatIteration: formatIteration,
    loaderProgress: loaderProgress,
    tickFraction: tickFraction
  };
}));
