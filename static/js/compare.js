/* Self-contained page behaviour, no dependencies.
   - Asset loader: streams the critical videos into memory behind a progress
     overlay, so comparison pairs play from fully-buffered blob URLs and can
     never stall or drift on network seeks. Remaining videos load in the
     background; on file:// everything falls back to plain src playback.
   - Before/after comparison sliders (images or synced videos, Nerfies-style:
     no native controls, autoplay muted loop), with an enlarge button.
   - Lightbox for figures, fly-throughs and comparisons.
   - Training-progress explorer: scene tabs + one checkpoint timeline that
     seeks the SAD and 3DGS progress videos to the same iteration. */

(function () {
  "use strict";

  var ARROWS =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 6.6 3.2 12l5.4 5.4 1.4-1.4-4-4 4-4zm6.8 0-1.4 1.4 4 4-4 4 1.4 1.4L20.8 12z"/></svg>';
  var EXPAND =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h6v2H7v4H5zm8 0h6v6h-2V7h-4zM5 13h2v4h4v2H5zm12 0h2v6h-6v-2h4z"/></svg>';
  var CLOSE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z"/></svg>';
  var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6L19 12z"/></svg>';
  var PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.4v14H7zm6.6 0H17v14h-3.4z"/></svg>';

  /* pure logic (checkpoint timing, loader math) lives in core.js */
  var core = window.SADCore;
  var CHECKPOINTS = core.CHECKPOINTS;
  var checkpointTime = core.checkpointTime;
  var PROGRESS_SCENES = core.PROGRESS_SCENES;
  var clamp = core.clamp;

  var isFile = location.protocol === "file:";
  /* prefers-reduced-motion cannot stop <video autoplay> via CSS; honour it in
     JS: nothing autoplays, everything waits for an explicit play action */
  var REDUCED = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  function reducedMotion() { return !!REDUCED.matches; }
  var blobs = {}; /* path -> object URL, once fully fetched */

  /* AV1 twins are ~50% smaller at the same visual quality; fall back to the
     H.264 originals wherever AV1 decode is unavailable (older Safari) */
  var AV1 = false;
  try {
    /* canPlayType matches how we actually play (blob in a <video>);
       MSE support can differ from element playback support in Safari */
    AV1 = document.createElement("video")
      .canPlayType('video/mp4; codecs="av01.0.08M.08"') !== "";
  } catch (e) { /* keep H.264 */ }
  function netPath(p) { return AV1 ? core.av1Path(p) : p; }
  /* runtime canary: if an AV1 blob errors in the element, drop AV1 for the
     whole session and refetch that file as H.264 */
  var blobCodec = {}; /* path -> "av1" | "h264" */
  function revokeAV1(path) {
    if (blobCodec[path] !== "av1") return false;
    AV1 = false;
    delete blobs[path];
    delete blobCodec[path];
    return true;
  }
  var openLightbox, closeLightbox;
  var criticalPhaseDone = false; /* bench fetches wait for the hero pair */

  /* on-demand loads (scene switch, swap, explorer switch) own the network:
     every background chain parks while one is pending, so the user's two
     files get the whole connection instead of a seventh of it */
  var demandLoads = 0, demandStamp = 0;
  var promoteBg = null; /* set by the loader: move paths to the queue front */
  function demandUp() { demandLoads += 1; demandStamp = Date.now(); }
  function demandDown() { demandLoads = Math.max(0, demandLoads - 1); demandStamp = Date.now(); }
  function demandBusy() {
    /* failsafe: a leaked counter (an element that never fires loadeddata
       or error) must not park the background forever */
    return demandLoads > 0 && (Date.now() - demandStamp) < 30000;
  }
  function src(path) { return blobs[path] || netPath(path); }

  /* Seek that survives Safari: an early currentTime write on a just-loaded
     video can silently clamp to 0; assert the target and re-apply on the
     readiness events until it sticks. */
  function ensureSeek(v, t) {
    var tries = 0;
    function attempt() {
      if (v.readyState >= 1) { try { v.currentTime = t; } catch (e) { /* retry below */ } }
      if (Math.abs(v.currentTime - t) < 0.2 || tries >= 4) {
        ["loadeddata", "canplay", "canplaythrough"].forEach(function (ev) {
          v.removeEventListener(ev, attempt);
        });
        return;
      }
      tries += 1;
    }
    ["loadeddata", "canplay", "canplaythrough"].forEach(function (ev) {
      v.addEventListener(ev, attempt);
    });
    attempt();
  }

  /* Safari composites NO frame for a video that has never played since
     its source was attached - readyState 4 and a completed seek still
     show black. A muted micro play-pause forces the first frame out.
     Deferred and gated on "zero frames decoded", so browsers that painted
     already (Chromium does at loadeddata) never run it. */
  function paintPausedFrame(v, t) {
    ensureSeek(v, t);
    setTimeout(function () {
      if (!v.paused) return; /* something started it; playing paints */
      var q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
      var frames = q ? q.totalVideoFrames : v.webkitDecodedFrameCount;
      if (!(frames === 0)) return;
      var pr;
      try { pr = v.play(); } catch (e) { return; }
      if (pr && pr.then) {
        pr.then(function () { v.pause(); ensureSeek(v, t); })
          .catch(function () { /* autoplay denied: a user gesture will paint */ });
      } else {
        v.pause();
        ensureSeek(v, t);
      }
    }, 250);
  }

  /* Attach a source and force the fetch/decode to start. Elements shipped
     with preload="none" can otherwise suspend at HAVE_METADATA and never
     deliver frames, even from a fully-buffered blob with a pending play(). */
  function attachSrc(v, url) {
    v.preload = "auto";
    v.src = url;
    v.load();
  }

  /* ---------- asset loader with progress overlay ---------- */

  var inflight = {}; /* path -> pending Promise, so nothing fetches twice */

  /* background downloads must never block the back/forward cache: abort them
     on pagehide, re-arm and resume when the page is restored (pageshow with
     persisted). They also run at low network priority so they cannot compete
     with anything the user asked for. */
  var bgAborter = ("AbortController" in window) ? new AbortController() : null;
  var bgResumers = [];
  window.addEventListener("pagehide", function () {
    if (bgAborter) bgAborter.abort();
  });
  window.addEventListener("pageshow", function (ev) {
    if (!ev.persisted) return;
    if ("AbortController" in window) bgAborter = new AbortController();
    bgResumers.splice(0).forEach(function (resume) { resume(); });
    /* the browser paused all media on entering the bfcache; the ring's
       watchdog self-heals, bench and slots need the nudge */
    document.querySelectorAll(".fa-bench, .video-slot").forEach(function (el) {
      if (el._userPaused || el._visible === false) return;
      el.querySelectorAll("video").forEach(function (v) {
        if (v.readyState >= 2) v.play().catch(function () {});
      });
    });
  });
  function isAbort(err) { return !!(err && err.name === "AbortError"); }

  function fetchToBlob(path, onBytes, onTotal, bg) {
    if (blobs[path]) return Promise.resolve(blobs[path]);
    if (inflight[path]) return inflight[path];
    var codec = netPath(path) === path ? "h264" : "av1";
    var p = doFetchToBlob(netPath(path), onBytes, onTotal, bg)
      .catch(function (err) {
        if (isAbort(err)) throw err; /* page is leaving; not a media failure */
        /* AV1 twin missing or failed: retry the H.264 original */
        if (netPath(path) === path) throw err;
        codec = "h264";
        return doFetchToBlob(path, onBytes, onTotal, bg);
      })
      .then(function (url) {
        blobs[path] = url;
        blobCodec[path] = codec;
        delete inflight[path];
        return url;
      }, function (err) {
        delete inflight[path];
        throw err;
      });
    inflight[path] = p;
    return p;
  }

  function doFetchToBlob(path, onBytes, onTotal, bg) {
    var init = {};
    if (bg) {
      if (bgAborter) init.signal = bgAborter.signal;
      init.priority = "low";
    }
    return fetch(path, init).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status + " for " + path);
      var len = +res.headers.get("Content-Length") || 0;
      if (onTotal) onTotal(len);
      if (!res.body || !res.body.getReader) return res.blob();
      var reader = res.body.getReader();
      var chunks = [];
      var received = 0;
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            if (len && received !== len) {
              throw new Error("truncated: " + received + "/" + len + " bytes for " + path);
            }
            return new Blob(chunks, { type: "video/mp4" });
          }
          chunks.push(r.value);
          received += r.value.length;
          if (!bg) demandStamp = Date.now(); /* progressing: keep the gate shut */
          if (onBytes) onBytes(r.value.length);
          return pump();
        });
      }
      return pump();
    }).then(function (blob) {
      return URL.createObjectURL(blob);
    });
  }

  function markFailed(v) {
    var slot = v && v.closest && v.closest(".video-slot");
    if (slot) {
      var badge = slot.querySelector(".pending-badge");
      if (badge) {
        badge.innerHTML = '<span class="tag">unavailable</span><span>Render not available yet</span>';
      }
    }
    /* comparison pairs listen for the error event themselves */
    try { v.dispatchEvent(new Event("error")); } catch (e) { /* ignore */ }
  }

  function startLoader() {
    var overlay = document.getElementById("loader");
    var fill = overlay && overlay.querySelector(".loader-fill");
    var status = overlay && overlay.querySelector(".loader-status");
    var skip = overlay && overlay.querySelector(".loader-skip");

    var criticalVids = [].slice.call(document.querySelectorAll("video[data-critical]"));
    var lazyVids = [].slice.call(document.querySelectorAll("video[data-src]:not([data-critical])"));
    /* progress-explorer videos stream progressively until their background
       blobs arrive, so only the hero pair blocks the reveal */
    var extraPaths = [];
    Object.keys(core.PROGRESS_SCENES).forEach(function (s) {
      extraPaths.push(core.PROGRESS_SCENES[s].sad, core.PROGRESS_SCENES[s].gs);
    });

    var revealed = false;
    function reveal() {
      if (revealed) return;
      revealed = true;
      document.body.classList.remove("loading");
      if (overlay) {
        overlay.classList.add("done");
        setTimeout(function () { overlay.remove(); }, 600);
      }
    }
    function criticalReady() {
      criticalPhaseDone = true;
      document.dispatchEvent(new Event("critical-assets"));
    }

    /* respect Save-Data and very slow connections: no big up-front download,
       videos stream progressively instead */
    var conn = navigator.connection;
    var lite = !!(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || "")));

    if (isFile || lite || !window.fetch) {
      /* no loader possible (or not wanted): plain progressive playback */
      criticalVids.concat(lazyVids).forEach(function (v) {
        attachSrc(v, netPath(v.getAttribute("data-src")));
      });
      reveal();
      criticalReady();
      return;
    }

    var IMG_WEIGHT = 0.08;
    var imgs = [].slice.call(document.images).filter(function (i) { return !i.complete; });
    var imgTotal = Math.max(1, imgs.length);
    var imgDone = imgs.length ? 0 : imgTotal;
    var vidTotal = 0, vidLoaded = 0;

    function update() {
      if (!fill) return;
      var p = core.loaderProgress(imgDone, imgTotal, vidLoaded, vidTotal, IMG_WEIGHT);
      fill.style.width = (100 * p).toFixed(1) + "%";
      if (status && vidTotal) {
        status.textContent = "loading renders — " +
          (vidLoaded / 1048576).toFixed(0) + " / " + (vidTotal / 1048576).toFixed(0) + " MB";
      }
    }
    function imgTick() { imgDone += 1; update(); }
    imgs.forEach(function (i) {
      i.addEventListener("load", imgTick, { once: true });
      i.addEventListener("error", imgTick, { once: true });
    });

    var tasks = criticalVids.map(function (v) {
      return { v: v, path: v.getAttribute("data-src") };
    });

    var pending = tasks.length;
    function settle() {
      pending -= 1;
      if (pending === 0) {
        reveal();
        criticalReady();
        nextLazy();
      }
    }
    tasks.forEach(function (t) {
      fetchToBlob(t.path,
        function (n) { vidLoaded += n; update(); },
        function (len) { vidTotal += len; update(); })
      .then(function (url) { if (t.v) attachSrc(t.v, url); })
      .catch(function () { if (t.v) markFailed(t.v); })
      .then(settle);
    });
    if (!tasks.length) { reveal(); criticalReady(); nextLazy(); }

    /* background: progress-explorer videos first (small, drive a whole
       section), then any remaining data-src videos */
    var queue = extraPaths.map(function (p) { return { v: null, path: p }; })
      .concat(lazyVids.map(function (v) { return { v: v, path: v.getAttribute("data-src") }; }));
    promoteBg = function (paths) {
      /* the explorer switched scene: its two files jump the queue */
      paths.forEach(function (p) {
        if (blobs[p]) return;
        for (var i = queue.length - 1; i >= 0; i--) {
          if (queue[i].path === p) queue.splice(i, 1);
        }
        queue.unshift({ v: null, path: p });
      });
    };
    function nextLazy() {
      if (!queue.length) return;
      if (demandBusy()) { setTimeout(nextLazy, 400); return; }
      var t = queue.shift();
      fetchToBlob(t.path, null, null, true)
        .then(function (url) {
          if (t.v) attachSrc(t.v, url);
          else document.dispatchEvent(new CustomEvent("blob-ready", { detail: t.path }));
        })
        .catch(function (err) {
          if (isAbort(err)) { queue.unshift(t); bgResumers.push(nextLazy); return "parked"; }
          if (t.v) markFailed(t.v);
        })
        .then(function (state) { if (state !== "parked") nextLazy(); });
    }

    /* escape hatch on slow connections */
    setTimeout(function () {
      if (!revealed && skip) skip.classList.add("show");
    }, 4000);
    if (skip) skip.addEventListener("click", reveal);
  }

  /* ---------- synced video pairs ---------- */

  function pairSync(a, b, rate) {
    [a, b].forEach(function (v) {
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.removeAttribute("controls");
      if (rate) { v.defaultPlaybackRate = rate; v.playbackRate = rate; }
    });
    var active = false, rafOn = false;
    /* explicit pause wins over all auto-play; under prefers-reduced-motion
       nothing starts until the user presses play */
    var userPaused = reducedMotion();
    /* held while a side is reloading: stale content must not play, and the
       user's play/pause intent is applied once the new media has arrived */
    var held = false;
    var baseRate = rate || 1;
    function tick() {
      if (active && !userPaused && !held && !b.paused &&
          a.readyState >= 2 && !a.seeking) {
        var d = a.currentTime - b.currentTime;
        if (Math.abs(d) > 0.75) {
          /* loop wrap or a fresh attach: pause the partner for one exact
             seek (otherwise it moves on during the seek and leaves a
             residual), then canplay -> start() resumes both aligned */
          a.playbackRate = baseRate;
          b.pause();
          a.currentTime = b.currentTime;
        } else if (Math.abs(d) > 0.04) {
          /* converge by nudging a's clock up to 12%: no seeks, no stalls,
             and no seek-chase (a seek lands behind a still-playing b) */
          var adj = Math.max(-0.12, Math.min(0.12, d * 0.5));
          a.playbackRate = baseRate * (1 - adj);
        } else if (a.playbackRate !== baseRate) {
          a.playbackRate = baseRate;
        }
      }
      requestAnimationFrame(tick);
    }
    function start() {
      if (!active || userPaused || held || a.readyState < 2 || b.readyState < 2) return;
      /* never resume mid-seek: playing b now hands it a head start equal to
         a's seek latency (the watchdog loves doing this right after a wrap).
         "seeked" re-enters start() with the pair already aligned. */
      if (a.seeking) return;
      /* hard-align only when playback is being (re)started or the gap is
         wrap-scale. While playing, small drift is converged by the tick's
         playbackRate nudge - a seek here would land behind the still-playing
         partner, whose "canplay" re-enters start(): an endless seek chase. */
      var d = Math.abs(a.currentTime - b.currentTime);
      if ((b.paused || d > 0.75) && d > 0.08) {
        try { a.currentTime = b.currentTime; } catch (e) { /* not seekable yet */ }
        if (a.seeking) return;
      }
      a.play().catch(function () {});
      b.play().catch(function () {});
      if (!rafOn) { rafOn = true; requestAnimationFrame(tick); }
    }
    [a, b].forEach(function (v) {
      v.addEventListener("loadeddata", start);
      /* if one side ever rebuffers (non-blob fallback), halt the other and
         re-enter in sync instead of letting them drift apart */
      v.addEventListener("waiting", function () {
        /* a seek fires "waiting" too; pausing the partner for those caused a
           visible stall at every loop boundary */
        if (v.seeking) return;
        (v === a ? b : a).pause();
      });
      v.addEventListener("canplay", function () { if (active) start(); });
    });
    /* only a is ever seek-aligned; once the seek lands, resume the pair
       (start() refused to while a.seeking, so this is the re-entry point) */
    a.addEventListener("seeked", function () { if (active) start(); });
    /* watchdog: a visible pair must be playing. If either side ends up
       paused while both are decodable (missed event, rejected play(),
       hot-reload races), re-enter start() — it re-syncs and resumes. */
    setInterval(function () {
      if (active && !userPaused && !held && a.readyState >= 2 && b.readyState >= 2 &&
          (a.paused || b.paused)) {
        start();
      }
    }, 1500);
    return {
      resume: function () { active = true; start(); },
      pause: function () { active = false; a.pause(); b.pause(); },
      /* user-facing play/pause; returns true when now playing */
      toggle: function () {
        userPaused = !userPaused;
        if (userPaused) { a.pause(); b.pause(); } else { start(); }
        return !userPaused;
      },
      play: function () { userPaused = false; start(); },
      isUserPaused: function () { return userPaused; },
      setUserPaused: function (v) {
        userPaused = !!v;
        if (userPaused) { a.pause(); b.pause(); } else { start(); }
      },
      /* freeze stale content while media reloads; releasing applies intent */
      hold: function (v) {
        held = !!v;
        if (held) { a.pause(); b.pause(); } else { start(); }
      },
      isHeld: function () { return held; }
    };
  }

  /* ---------- comparison slider ---------- */

  function initCompare(root, opts) {
    opts = opts || {};
    /* children may be <img>, <video>, or <picture> wrapping an <img> */
    var media = [], wraps = [];
    Array.prototype.forEach.call(root.children, function (el) {
      if (el.tagName === "IMG" || el.tagName === "VIDEO") {
        media.push(el); wraps.push(el);
      } else if (el.tagName === "PICTURE") {
        var im = el.querySelector("img");
        if (im) { media.push(im); wraps.push(el); }
      }
    });
    if (media.length !== 2) return;
    var a = media[0]; /* left side */
    var b = media[1]; /* right side, stays in flow and sets the height */
    var wrapA = wraps[0], wrapB = wraps[1];
    var isVideo = a.tagName === "VIDEO" && b.tagName === "VIDEO";

    var rate = parseFloat(root.getAttribute("data-rate")) || 0;

    /* remember sources for the lightbox clone */
    root._compare = {
      isVideo: isVideo,
      srcs: [a.getAttribute("data-src") || a.getAttribute("src"),
             b.getAttribute("data-src") || b.getAttribute("src")],
      labels: [root.getAttribute("data-label-a"), root.getAttribute("data-label-b")],
      rate: rate
    };

    var top = document.createElement("div");
    top.className = "ba-top";
    root.insertBefore(top, wrapB);
    top.appendChild(wrapA);

    var divider = document.createElement("div");
    divider.className = "ba-divider";
    var handle = document.createElement("div");
    handle.className = "ba-handle";
    handle.innerHTML = ARROWS;
    root.appendChild(divider);
    root.appendChild(handle);

    var labelA = root.getAttribute("data-label-a");
    var labelB = root.getAttribute("data-label-b");
    [["a", labelA], ["b", labelB]].forEach(function (pair) {
      if (!pair[1]) return;
      var el = document.createElement("span");
      el.className = "ba-label " + pair[0];
      el.innerHTML = pair[1];
      root.appendChild(el);
    });

    var pos = 50;
    function plainLabels() {
      var l = (root._compare && root._compare.labels) || [];
      return [
        (l[0] || "left").replace(/<[^>]*>/g, ""),
        (l[1] || "right").replace(/<[^>]*>/g, "")
      ];
    }
    function apply() {
      top.style.clipPath = "inset(0 " + (100 - pos) + "% 0 0)";
      divider.style.left = pos + "%";
      handle.style.left = pos + "%";
      handle.setAttribute("aria-valuenow", Math.round(pos));
      var names = plainLabels();
      handle.setAttribute("aria-valuetext",
        Math.round(pos) + "% " + names[0] + ", " + (100 - Math.round(pos)) + "% " + names[1]);
    }

    /* the slider role lives on the handle, not the container: the container
       also holds the enlarge button, and interactive controls must not nest */
    handle.setAttribute("tabindex", "0");
    handle.setAttribute("role", "slider");
    handle.setAttribute("aria-valuemin", "0");
    handle.setAttribute("aria-valuemax", "100");
    handle.setAttribute("aria-label", "Comparison slider: " +
      (labelA || "left").replace(/<[^>]*>/g, "") + " versus " +
      (labelB || "right").replace(/<[^>]*>/g, ""));
    apply();

    function fromEvent(ev) {
      var rect = root.getBoundingClientRect();
      var x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
      pos = clamp(100 * x / rect.width, 0, 100);
      apply();
    }

    var dragging = false;
    root.addEventListener("pointerdown", function (ev) {
      dragging = true;
      root.setPointerCapture && root.setPointerCapture(ev.pointerId);
      fromEvent(ev);
    });
    root.addEventListener("pointermove", function (ev) {
      if (dragging) fromEvent(ev);
    });
    ["pointerup", "pointercancel"].forEach(function (t) {
      root.addEventListener(t, function () { dragging = false; });
    });
    handle.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowLeft") { pos = clamp(pos - 2, 0, 100); apply(); ev.preventDefault(); }
      if (ev.key === "ArrowRight") { pos = clamp(pos + 2, 0, 100); apply(); ev.preventDefault(); }
    });

    if (isVideo) {
      /* a media error must never destroy the widget: revoke AV1 if that
         blob was AV1 (Safari can accept the codec probe yet fail to
         decode), refetch as H.264, and reattach - once per element */
      [a, b].forEach(function (v) {
        v._recovered = 0;
        v.addEventListener("error", function () {
          if (v._recovered >= 2) return;
          v._recovered += 1;
          var path = root._compare && root._compare.srcs[v === a ? 0 : 1];
          if (!path) return;
          /* recover like any other load: veil + held pair + parked
             background chains. The silent refetch this used to be left one
             side stuck while the other played. */
          root._loadHoldUp();
          demandUp();
          var released = false;
          var release = function () {
            if (released) return;
            released = true;
            v.removeEventListener("loadeddata", release);
            v.removeEventListener("error", release);
            demandDown();
            root._loadHoldDown();
          };
          /* listeners added during dispatch don't fire for this event */
          v.addEventListener("loadeddata", release);
          v.addEventListener("error", release);
          revokeAV1(path);
          delete blobs[path];
          fetchToBlob(path).then(function (url) {
            attachSrc(v, url);
          }).catch(function () { release(); /* leave the last frame */ });
        });
      });
      /* loading veil + pair hold, refcounted: attachSide loads and in-place
         recoveries overlap, and the veil must outlast all of them */
      root._loadHold = 0;
      root._loadHoldUp = function () {
        root._loadHold += 1;
        root.classList.add("fa-loading");
        if (root._pair) root._pair.hold(true);
      };
      root._loadHoldDown = function () {
        root._loadHold = Math.max(0, root._loadHold - 1);
        if (!root._loadHold) {
          root.classList.remove("fa-loading");
          if (root._pair) root._pair.hold(false);
        }
      };
      root._pair = pairSync(a, b, rate);
      if (opts.autoplay) root._pair.resume();

      /* freeze the comparison at any moment */
      var pp = document.createElement("button");
      pp.type = "button";
      pp.className = "ba-playpause";
      pp.innerHTML = root._pair.isUserPaused() ? PLAY : PAUSE;
      pp.setAttribute("aria-label",
        root._pair.isUserPaused() ? "Play the fly-through" : "Pause the fly-through");
      pp.addEventListener("pointerdown", function (ev) { ev.stopPropagation(); });
      pp.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var playing = root._pair.toggle();
        pp.innerHTML = playing ? PAUSE : PLAY;
        pp.setAttribute("aria-label", playing ? "Pause the fly-through" : "Play the fly-through");
      });
      root.appendChild(pp);
      root._ppBtn = pp;
    }

    if (!opts.noExpand) {
      var ex = document.createElement("button");
      ex.type = "button";
      ex.className = "ba-expand";
      ex.innerHTML = EXPAND;
      ex.setAttribute("aria-label", "Enlarge comparison");
      ex.addEventListener("pointerdown", function (ev) { ev.stopPropagation(); });
      ex.addEventListener("click", function (ev) {
        ev.stopPropagation();
        openCompareLightbox(root);
      });
      root.appendChild(ex);
    }
  }

  /* ---------- lightbox ---------- */

  function initLightbox() {
    /* native <dialog>: free focus containment, Escape, inert background */
    var lb = document.createElement("dialog");
    lb.className = "lightbox";
    lb.setAttribute("aria-label", "Enlarged view");
    lb.innerHTML =
      '<button class="lb-close" type="button" aria-label="Close">' + CLOSE + "</button>" +
      '<div class="lb-stage"></div><p class="lb-caption"></p>';
    document.body.appendChild(lb);
    var stage = lb.querySelector(".lb-stage");
    var cap = lb.querySelector(".lb-caption");
    var closeBtn = lb.querySelector(".lb-close");
    var pausedPairs = [];
    var heldPairs = [];
    var opener = null;

    function spinUntilLoaded(stage) {
      var vids = stage.querySelectorAll("video");
      if (!vids.length) return;
      var spin = document.createElement("span");
      spin.className = "spinner lb-spinner";
      spin.setAttribute("aria-hidden", "true");
      stage.appendChild(spin);
      var done = function () { if (spin.parentNode) spin.remove(); };
      var ready = 0;
      vids.forEach(function (v) {
        if (v.readyState >= 2) { ready += 1; return; }
        v.addEventListener("loadeddata", function once() {
          v.removeEventListener("loadeddata", once);
          ready += 1;
          if (ready >= vids.length) done();
        });
        v.addEventListener("error", done); // never spin forever over a dead video
      });
      if (ready >= vids.length) done();
    }

    openLightbox = function (build, captionText) {
      stage.innerHTML = "";
      build(stage);
      spinUntilLoaded(stage);
      cap.textContent = captionText || "";
      cap.style.display = captionText ? "" : "none";
      opener = document.activeElement;
      if (lb.showModal && !lb.open) lb.showModal();
      lb.classList.add("open");
      document.body.classList.add("no-scroll");
      closeBtn.focus();
      /* silence page videos behind the overlay; hold pairs so the
         watchdog cannot resume them under the modal */
      pausedPairs = [];
      document.querySelectorAll("video").forEach(function (v) {
        if (!lb.contains(v) && !v.paused) { pausedPairs.push(v); v.pause(); }
      });
      heldPairs = [];
      document.querySelectorAll(".ba-compare").forEach(function (el) {
        if (!lb.contains(el) && el._pair && !el._pair.isHeld()) {
          el._pair.hold(true);
          heldPairs.push(el._pair);
        }
      });
    };
    closeLightbox = function () {
      if (!lb.classList.contains("open")) return;
      if (lb.open && lb.close) lb.close(); /* native cleanup + focus restore */
      lb.classList.remove("open");
      document.body.classList.remove("no-scroll");
      if (opener && opener.focus) opener.focus();
      opener = null;
      stage.querySelectorAll("video").forEach(function (v) {
        v.pause();
        v.removeAttribute("src");
        v.load();
      });
      stage.innerHTML = "";
      heldPairs.forEach(function (p) { p.hold(false); });
      heldPairs = [];
      pausedPairs.forEach(function (v) { v.play().catch(function () {}); });
      pausedPairs = [];
    };
    lb.addEventListener("click", function (ev) {
      if (ev.target === lb || ev.target.closest(".lb-close")) closeLightbox();
    });
    /* native Escape fires "cancel"; route it through the same cleanup.
       Focus containment is native too: showModal() makes the page inert,
       so the old manual Tab trap is gone. */
    lb.addEventListener("cancel", function (ev) {
      ev.preventDefault();
      closeLightbox();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closeLightbox();
    });
  }

  /* ---------- tablist keyboard pattern (ARIA APG) ---------- */

  function initTablists() {
    document.querySelectorAll(".pe-tabs").forEach(function (list) {
      var tabs = [].slice.call(list.querySelectorAll("[role=tab]"));
      list.addEventListener("keydown", function (ev) {
        var i = tabs.indexOf(document.activeElement);
        if (i < 0) return;
        var j = null;
        if (ev.key === "ArrowRight") j = (i + 1) % tabs.length;
        if (ev.key === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
        if (ev.key === "Home") j = 0;
        if (ev.key === "End") j = tabs.length - 1;
        if (j !== null) {
          tabs[j].focus();
          tabs[j].click();
          ev.preventDefault();
        }
      });
    });
  }

  function openImageLightbox(imgSrc, caption) {
    openLightbox(function (stage) {
      var im = document.createElement("img");
      im.src = imgSrc;
      im.alt = caption || "";
      stage.appendChild(im);
    }, caption);
  }

  function openVideoLightbox(path, caption, rate, opts) {
    opts = opts || {};
    openLightbox(function (stage) {
      var v = document.createElement("video");
      v.preload = "auto";
      v.src = src(path);
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.controls = true;
      if (rate) { v.defaultPlaybackRate = rate; v.playbackRate = rate; }
      stage.appendChild(v);
      if (opts.paused || reducedMotion()) {
        /* a paused source stays paused at the same moment; the native
           controls let the viewer play */
        paintPausedFrame(v, opts.time || 0);
      } else {
        v.autoplay = true;
        v.play().catch(function () {});
      }
    }, caption);
  }

  function openCompareLightbox(origRoot) {
    var info = origRoot._compare;
    if (!info) return;
    openLightbox(function (stage) {
      var el = document.createElement("div");
      el.className = "ba-compare lb-compare";
      if (info.labels[0]) el.setAttribute("data-label-a", info.labels[0]);
      if (info.labels[1]) el.setAttribute("data-label-b", info.labels[1]);
      if (info.rate) el.setAttribute("data-rate", info.rate);
      var liveImgs = origRoot.querySelectorAll("img");
      info.srcs.forEach(function (s, i) {
        var m;
        if (info.isVideo) {
          m = document.createElement("video");
          m.muted = true; m.loop = true; m.playsInline = true;
          m.preload = "auto";
          m.src = src(s);
        } else {
          m = document.createElement("img");
          m.src = (liveImgs[i] && liveImgs[i].currentSrc) || s;
          m.alt = "";
        }
        el.appendChild(m);
      });
      stage.appendChild(el);
      initCompare(el, { noExpand: true, autoplay: true });
      /* inherit the source pair's pause state and frozen frame */
      if (info.isVideo && origRoot._pair && origRoot._pair.isUserPaused() && el._pair) {
        el._pair.setUserPaused(true);
        var t = origRoot.querySelector("video").currentTime;
        el.querySelectorAll("video").forEach(function (v) { paintPausedFrame(v, t); });
        if (el._ppBtn) {
          el._ppBtn.innerHTML = PLAY;
          el._ppBtn.setAttribute("aria-label", "Play the fly-through");
        }
      }
    });
  }

  function initLightboxTriggers() {
    /* figures: density map, pareto plot, method strip */
    document.querySelectorAll(".figure-block img, .method-strip img").forEach(function (im) {
      im.classList.add("zoomable");
      im.addEventListener("click", function () {
        openImageLightbox(im.currentSrc || im.src, im.alt);
      });
    });
    /* fly-through slots: click anywhere on the slot */
    document.querySelectorAll(".video-slot").forEach(function (slot) {
      var v = slot.querySelector("video[data-src]");
      if (!v) return;
      slot.classList.add("zoomable");
      var hint = document.createElement("span");
      hint.className = "slot-expand";
      hint.innerHTML = EXPAND;
      slot.appendChild(hint);
      slot.addEventListener("click", function () {
        var fig = slot.closest("figure");
        var capEl = fig && fig.querySelector("figcaption");
        openVideoLightbox(v.getAttribute("data-src"), capEl ? capEl.textContent.trim() : "");
      });
    });
  }

  /* ---------- pending video slots ---------- */

  function initSlot(slot) {
    var video = slot.querySelector("video");
    if (!video) return;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.removeAttribute("controls");
    function loaded() {
      slot.classList.add("loaded");
      if (slot._visible !== false && !reducedMotion()) video.play().catch(function () {});
    }
    if (video.readyState >= 2) loaded();
    else video.addEventListener("loadeddata", loaded, { once: true });
    /* on fetch error the badge is rewritten by markFailed() */
  }

  /* ---------- pause offscreen videos, resync pairs on re-entry ---------- */

  function initVisibility() {
    if (!("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var el = e.target;
        el._visible = e.isIntersecting;
        if (el._pair) {
          /* pairs re-enter through resume(), which re-syncs before playing */
          if (e.isIntersecting) el._pair.resume();
          else el._pair.pause();
          return;
        }
        el.querySelectorAll("video").forEach(function (v) {
          if (!v.src || v.error) return;
          if (e.isIntersecting) {
            if (!el._userPaused) v.play().catch(function () {});
          } else {
            v.pause();
          }
        });
      });
    }, { threshold: 0.15 });
    document.querySelectorAll(".ba-compare, .video-slot, .fa-bench").forEach(function (el) {
      io.observe(el);
    });
  }

  /* ---------- fly-through arena ---------- */

  function initArena() {
    var root = document.getElementById("flythrough-arena");
    if (!root) return;
    var cmp = root.querySelector(".fa-compare");
    var sideVids = cmp.querySelectorAll("video"); /* [a, b], moved by initCompare */
    var vA = sideVids[0], vB = sideVids[1];
    var benchEl = root.querySelector(".fa-bench");
    var tabs = [].slice.call(root.querySelectorAll("[data-fly-scene]"));
    var zones = [].slice.call(root.querySelectorAll(".fa-drop"));
    var RATE = parseFloat(cmp.getAttribute("data-rate")) || 0;

    var scene = "flowers", left = "sad", right = "gs";
    var dragged = null;
    benchEl._userPaused = reducedMotion(); /* tiles wait for explicit play too */

    function label(m) { return core.FLY_METHODS[m].label; }
    function benched() { return core.benchedMethods(left, right); }

    function syncTexts() {
      var la = cmp.querySelector(".ba-label.a");
      var lb = cmp.querySelector(".ba-label.b");
      if (la) la.textContent = label(left);
      if (lb) lb.textContent = label(right);
      root.querySelector(".fa-drop.left .fa-drop-name").textContent = label(left);
      root.querySelector(".fa-drop.right .fa-drop-name").textContent = label(right);
      var hd = cmp.querySelector(".ba-handle");
      if (hd) {
        hd.setAttribute("aria-label",
          "Comparison slider: " + label(left) + " versus " + label(right) + ", " + scene + " scene");
      }
      vA.setAttribute("aria-label", label(left) + " fly-through, " + scene + " scene");
      vB.setAttribute("aria-label", label(right) + " fly-through, " + scene + " scene");
      if (cmp._compare) {
        cmp._compare.srcs = [core.flyPath(scene, left), core.flyPath(scene, right)];
        cmp._compare.labels = [label(left), label(right)];
      }
    }

    function attachSide(v, path) {
      /* a newer attach supersedes a pending one on the same element */
      v._gen = (v._gen || 0) + 1;
      var gen = v._gen;
      if (v._sideDone) { /* the superseded attach will never complete */
        v.removeEventListener("loadeddata", v._sideDone);
        v._sideDone = null;
        cmp._loadHoldDown();
        demandDown();
      }
      cmp._loadHoldUp(); /* veil + held pair, shared with error recovery */
      demandUp(); /* parks the background chains for the duration */
      v.style.opacity = "0.25";
      var done = function () {
        v.removeEventListener("loadeddata", done);
        if (v._sideDone === done) v._sideDone = null;
        v.style.opacity = "";
        demandDown();
        if (isPaused() && pausedAlignT != null) ensureSeek(v, pausedAlignT);
        cmp._loadHoldDown(); /* releasing applies the recorded intent */
      };
      v._sideDone = done;
      v.addEventListener("loadeddata", done);
      fetchToBlob(path).then(function (url) {
        if (v._gen !== gen) return; /* superseded by a newer swap/scene */
        attachSrc(v, url);
      }).catch(function () {
        if (v._gen !== gen) return;
        /* transient (SW killed, network blip): one retry, then give up
           quietly - the previous frame stays, nothing is destroyed */
        setTimeout(function () {
          if (v._gen !== gen) return;
          fetchToBlob(path).then(function (url) {
            if (v._gen !== gen) return;
            attachSrc(v, url);
          }).catch(function () {
            if (v._gen !== gen) return;
            v.style.opacity = "";
            demandDown();
            cmp._loadHoldDown();
          });
        }, 1200);
      });
    }

    function makeTile(m) {
      var tile = document.createElement("div");
      tile.className = "fa-tile";
      tile.setAttribute("draggable", "true");
      tile.setAttribute("data-method", m);
      tile.innerHTML =
        '<div class="fa-tile-media">' +
        '<video muted loop playsinline preload="none"></video>' +
        '<span class="spinner" aria-hidden="true"></span></div>' +
        '<div class="fa-tile-side"><span class="fa-tile-name"></span>' +
        '<div class="fa-tile-actions">' +
        '<button type="button" class="fa-swap" data-side="a" title="Swap into left side" aria-label="Swap into left side">&#9664;</button>' +
        '<button type="button" class="fa-swap" data-side="b" title="Swap into right side" aria-label="Swap into right side">&#9654;</button>' +
        "</div></div>";
      tile.querySelector(".fa-tile-name").textContent = label(m);

      function whenRevealed(fn) {
        if (criticalPhaseDone) fn();
        else document.addEventListener("critical-assets", fn, { once: true });
      }
      var tv = tile.querySelector("video");
      tv._recovered = 0;
      tv.addEventListener("error", function () {
        var path = core.flyPath(scene, m);
        tile.classList.remove("loaded"); /* spinner back while recovering */
        if (tv._recovered < 1) {
          tv._recovered += 1;
          revokeAV1(path);
          delete blobs[path];
          fetchToBlob(path).then(function (url) { attachSrc(tv, url); })
            .catch(function () { markTileUnavailable(); });
        } else {
          markTileUnavailable();
        }
      });
      function markTileUnavailable() {
        tile.classList.remove("loaded");
        tile.classList.add("fa-unavailable");
        tile.setAttribute("draggable", "false");
        tile.querySelectorAll(".fa-swap").forEach(function (b) { b.disabled = true; });
        tile.querySelector(".fa-tile-name").textContent = label(m) + " — not available";
      }
      tv.setAttribute("aria-label", label(m) + " fly-through preview, " + scene + " scene");
      if (RATE) { tv.defaultPlaybackRate = RATE; tv.playbackRate = RATE; }
      /* permanent, not once: every (re)attach lands here — first load, AV1
         canary recovery, late arrival on a slow link — and joins the tile to
         the ring's clock and play state instead of leaving it stuck */
      tv.addEventListener("loadeddata", function () {
        tile.classList.add("loaded");
        /* a loaded tile must never sit black: Safari paints no frame until
           a seek or a play. Playing tiles get a one-shot align (ensureSeek
           would keep yanking them back to a stale target); paused, offscreen
           or autoplay-denied tiles get the retrying seek so a frame paints. */
        if (!isPaused() && benchEl._visible !== false) {
          /* the ring's wrap recipe: exact seek while still paused, play the
             moment it lands (never seek a playing video); the nudge loop
             converges the seek-latency residual */
          var target = ringTime();
          if (Math.abs(tv.currentTime - target) < 0.05) {
            tv.play().catch(function () {});
          } else {
            tv._lastSnap = Date.now(); /* the join seek counts as a snap */
            var onJoin = function () {
              tv.removeEventListener("seeked", onJoin);
              if (!isPaused() && benchEl._visible !== false) tv.play().catch(function () {});
            };
            tv.addEventListener("seeked", onJoin);
            try { tv.currentTime = target; } catch (e) {
              tv.removeEventListener("seeked", onJoin);
              tv.play().catch(function () {});
            }
          }
        } else {
          paintPausedFrame(tv, ringTime());
        }
      });
      function tileFetch() {
        /* a pending on-demand load (scene switch, swap) owns the network;
           the bench follows once the ring is served — and holds the gate
           itself so the background chains don't race the visible tiles */
        if (demandBusy()) { setTimeout(tileFetch, 300); return; }
        demandUp();
        fetchToBlob(core.flyPath(scene, m)).then(function (url) {
          demandDown();
          attachSrc(tv, url);
        }).catch(function () { demandDown(); markTileUnavailable(); });
      }
      whenRevealed(tileFetch);

      tile.addEventListener("dragstart", function (ev) {
        if (tile.classList.contains("fa-unavailable")) { ev.preventDefault(); return; }
        dragged = m;
        if (ev.dataTransfer) {
          ev.dataTransfer.setData("text/plain", m);
          ev.dataTransfer.effectAllowed = "move";
        }
        root.classList.add("dragging");
      });
      tile.addEventListener("dragend", function () {
        root.classList.remove("dragging");
        zones.forEach(function (z) { z.classList.remove("over"); });
      });
      tile.querySelectorAll(".fa-swap").forEach(function (b) {
        b.addEventListener("click", function () { swap(b.getAttribute("data-side"), m); });
      });
      tile.querySelector(".fa-tile-media").addEventListener("click", function () {
        if (tile.classList.contains("fa-unavailable")) return;
        openVideoLightbox(core.flyPath(scene, m), label(m) + " — " + scene, RATE,
          { paused: isPaused(), time: ringTime() });
      });
      return tile;
    }

    function buildBench() {
      benchEl.innerHTML = "";
      benched().forEach(function (m) { benchEl.appendChild(makeTile(m)); });
    }

    /* one playback state for the whole arena: pausing freezes the ring AND
       the bench at the same moment on the shared camera path; swaps and
       scene switches while paused stay paused, with the reloaded videos
       frame-aligned to the paused timestamp */
    var pausedAlignT = null;
    function isPaused() { return !!(cmp._pair && cmp._pair.isUserPaused()); }
    function ringTime() {
      return pausedAlignT != null ? pausedAlignT : (vB.currentTime || vA.currentTime || 0);
    }
    /* recovery re-attaches bypass attachSide: whatever lands in a ring
       video while the arena is paused must sit on the paused frame, and
       Safari needs the seek to paint anything at all */
    [vA, vB].forEach(function (v) {
      v.addEventListener("loadeddata", function () {
        if (isPaused()) paintPausedFrame(v, ringTime());
      });
    });
    /* keep playing tiles converged on the ring's clock the way the ring
       keeps its own pair converged: playbackRate nudges, never seeks on a
       playing video (a seek always lands behind the moving target and
       chasing it pins readyState). Wrap-scale gaps get one exact seek
       with the tile paused, then resume. */
    setInterval(function () {
      if (benchEl._visible === false || isPaused() ||
          !cmp._pair || cmp._pair.isHeld()) return;
      var ref = ringTime();
      var base = RATE || 1;
      benchEl.querySelectorAll(".fa-tile.loaded video").forEach(function (v) {
        if (v.paused || v.readyState < 2 || v.seeking) return;
        var d = v.currentTime - ref;
        /* previews can converge harder than the ring: a strong rate nudge
           closes medium gaps WHILE PLAYING (a snap always lands one
           seek-latency behind, so snapping medium gaps on a slow machine
           livelocks); the paused exact snap is only for wrap-scale gaps */
        if (Math.abs(d) > 1.5 && Date.now() - (v._lastSnap || 0) > 1200) {
          v._lastSnap = Date.now();
          v.pause();
          var onSeeked = function () {
            v.removeEventListener("seeked", onSeeked);
            v.play().catch(function () {});
          };
          v.addEventListener("seeked", onSeeked);
          try { v.currentTime = ringTime(); } catch (e) {
            v.removeEventListener("seeked", onSeeked);
            v.play().catch(function () {});
          }
        } else if (Math.abs(d) > 0.06) {
          var adj = Math.max(-0.35, Math.min(0.35, d * 0.9));
          v.playbackRate = base * (1 - adj);
        } else if (v.playbackRate !== base) {
          v.playbackRate = base;
        }
      });
    }, 400);

    function syncBenchPlayState() {
      var paused = isPaused();
      benchEl._userPaused = paused;
      var t = ringTime();
      benchEl.querySelectorAll("video").forEach(function (v) {
        if (paused) {
          v.pause();
          ensureSeek(v, t);
        } else if (benchEl._visible !== false) {
          v.play().catch(function () {});
        }
      });
      if (!paused) pausedAlignT = null;
    }
    /* capture phase: the button's own handler stops propagation, but capture
       runs first; the deferred sync then reads the already-toggled state */
    cmp.addEventListener("click", function (ev) {
      if (!ev.target.closest || !ev.target.closest(".ba-playpause")) return;
      setTimeout(syncBenchPlayState, 0);
    }, true);
    /* bench watchdog, the tiles' version of the ring's: a loaded, visible
       tile must share the arena's play state (missed events, rejected
       play() calls, recovery re-attaches). Held = lightbox open or a side
       reloading; everything stays frozen then. */
    setInterval(function () {
      if (benchEl._visible === false || !cmp._pair || cmp._pair.isHeld()) return;
      var paused = isPaused();
      benchEl.querySelectorAll(".fa-tile.loaded video").forEach(function (v) {
        if (v.readyState < 2) return;
        if (paused && !v.paused) {
          v.pause();
          ensureSeek(v, ringTime());
        } else if (!paused && v.paused) {
          v.play().catch(function () {});
        }
      });
    }, 2000);

    function swap(side, m) {
      if (!m || m === left || m === right) return;
      if (isPaused()) pausedAlignT = (side === "a" ? vB : vA).currentTime;
      if (side === "a") left = m; else right = m;
      syncTexts();
      attachSide(side === "a" ? vA : vB, core.flyPath(scene, m));
      buildBench();
    }

    function setScene(s) {
      if (s === scene) return;
      if (isPaused()) pausedAlignT = vB.currentTime;
      scene = s;
      tabs.forEach(function (b) {
        var on = b.getAttribute("data-fly-scene") === s;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      syncTexts();
      attachSide(vA, core.flyPath(scene, left));
      attachSide(vB, core.flyPath(scene, right));
      buildBench();
    }

    tabs.forEach(function (b) {
      b.addEventListener("click", function () { setScene(b.getAttribute("data-fly-scene")); });
    });

    zones.forEach(function (z) {
      z.addEventListener("dragover", function (ev) {
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
        z.classList.add("over");
      });
      z.addEventListener("dragleave", function () { z.classList.remove("over"); });
      z.addEventListener("drop", function (ev) {
        ev.preventDefault();
        root.classList.remove("dragging");
        zones.forEach(function (x) { x.classList.remove("over"); });
        swap(z.getAttribute("data-side"),
             (ev.dataTransfer && ev.dataTransfer.getData("text/plain")) || dragged);
      });
    });

    /* the two ring videos arrive via the loader (data-critical); the bench
       and the other scenes are fetched in the background afterwards */
    buildBench(); /* tiles with spinners from the first paint */
    document.addEventListener("critical-assets", function () {
      syncTexts();
      /* background prefetch, ring videos of every scene before bench videos:
         a scene tab click most likely needs the current left/right methods */
      var rest = [];
      function push(p) { if (!blobs[p] && rest.indexOf(p) < 0) rest.push(p); }
      /* the bench tiles of the CURRENT scene are on screen right now;
         everything else comes after */
      core.benchedMethods(left, right).forEach(function (m) { push(core.flyPath(scene, m)); });
      core.FLY_SCENES.forEach(function (s) {
        [left, right].forEach(function (m) { push(core.flyPath(s, m)); });
      });
      core.FLY_SCENES.forEach(function (s) {
        Object.keys(core.FLY_METHODS).forEach(function (m) { push(core.flyPath(s, m)); });
      });
      /* two parallel streams, but yield entirely while the user waits on an
         on-demand load (scene switch / swap) so it gets the bandwidth */
      function next() {
        if (!rest.length) return;
        if (demandBusy()) { setTimeout(next, 400); return; }
        var p = rest.shift();
        fetchToBlob(p, null, null, true).catch(function (err) {
          if (isAbort(err)) { rest.unshift(p); bgResumers.push(next); return "parked"; }
        }).then(function (state) { if (state !== "parked") next(); });
      }
      next();
      next();
    }, { once: true });

    syncTexts();
  }

  /* ---------- training-progress explorer ---------- */

  function initProgressExplorer() {
    var root = document.getElementById("progress-explorer");
    if (!root) return;
    var vSad = root.querySelector('video[data-role="sad"]');
    var vGs = root.querySelector('video[data-role="gs"]');
    var slider = root.querySelector('input[type="range"]');
    var label = root.querySelector(".pe-iter");
    var playBtn = root.querySelector(".pe-play");
    var ticksEl = root.querySelector(".pe-ticks");
    var tabs = [].slice.call(root.querySelectorAll(".pe-tab"));
    var k = 0, scene = "flowers", playing = false, timer = null;

    playBtn.innerHTML = PLAY;

    /* honest loading state: a spinner over each frame until the attached
       sources have data — scene switches on slow links are otherwise a
       silent freeze on the previous frame */
    root.querySelectorAll(".pe-frame").forEach(function (f) {
      var sp = document.createElement("span");
      sp.className = "spinner";
      sp.setAttribute("aria-hidden", "true");
      f.appendChild(sp);
    });
    function updateSpin() {
      var ok = vSad.readyState >= 2 && vGs.readyState >= 2;
      root.classList.toggle("pe-loading", !ok);
    }
    /* permanent: any later (re)load — a blob upgrade, a recovery after an
       aborted progressive fetch — must re-evaluate the loading state */
    [vSad, vGs].forEach(function (v) {
      v.addEventListener("loadeddata", updateSpin);
      v.addEventListener("error", updateSpin);
    });

    /* tick marks under the slider; labels on a readable subset */
    var LABELED = { 500: "500", 5000: "5k", 10000: "10k", 20000: "20k", 30000: "30k" };
    CHECKPOINTS.forEach(function (it, i) {
      var t = document.createElement("span");
      t.className = "pe-tick" + (LABELED[it] ? " labeled" : "");
      /* 9px ~ half the range thumb, so ticks line up with thumb stops */
      t.style.left = "calc(9px + " + core.tickFraction(i, CHECKPOINTS.length) + " * (100% - 18px))";
      if (LABELED[it]) t.setAttribute("data-label", LABELED[it]);
      ticksEl.appendChild(t);
    });

    function seekAll() {
      var t = checkpointTime(k);
      [vSad, vGs].forEach(function (v) {
        if (v.readyState >= 1) {
          try { v.currentTime = t; } catch (e) { /* metadata not ready */ }
        }
      });
      label.textContent = core.formatIteration(CHECKPOINTS[k]);
      slider.value = k;
      slider.setAttribute("aria-valuetext",
        core.formatIteration(CHECKPOINTS[k]) + " of 30,000");
    }

    function loadScene(s) {
      scene = s;
      tabs.forEach(function (b) {
        var on = b.getAttribute("data-scene") === s;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      root.querySelectorAll(".pe-frame").forEach(function (f) {
        f.style.aspectRatio = PROGRESS_SCENES[s].ar;
      });
      /* the background chain should deliver these two next, not last */
      if (promoteBg) promoteBg([PROGRESS_SCENES[s].sad, PROGRESS_SCENES[s].gs]);
      [[vSad, PROGRESS_SCENES[s].sad], [vGs, PROGRESS_SCENES[s].gs]].forEach(function (p) {
        var v = p[0];
        v.pause();
        demandUp(); /* the switch owns the network until the frame shows */
        var settled = false;
        function settle() {
          if (!settled) { settled = true; demandDown(); }
          updateSpin();
        }
        v.addEventListener("loadeddata", function once() {
          v.removeEventListener("loadeddata", once);
          seekAll();
          paintPausedFrame(v, checkpointTime(k));
          settle();
        });
        v.addEventListener("error", function onceE() {
          v.removeEventListener("error", onceE);
          settle();
        });
        attachSrc(v, src(p[1]));
      });
      updateSpin();
    }

    function stop() {
      playing = false;
      clearTimeout(timer);
      playBtn.innerHTML = PLAY;
      playBtn.setAttribute("aria-label", "Play training progression");
    }
    function step() {
      k = (k + 1) % CHECKPOINTS.length;
      seekAll();
      /* hold the converged model longer, like the source videos do */
      timer = setTimeout(step, k === CHECKPOINTS.length - 1 ? 2100 : 700);
    }
    playBtn.addEventListener("click", function () {
      if (playing) { stop(); return; }
      playing = true;
      playBtn.innerHTML = PAUSE;
      playBtn.setAttribute("aria-label", "Pause training progression");
      timer = setTimeout(step, 700);
    });
    slider.addEventListener("input", function () {
      stop();
      k = +slider.value;
      seekAll();
    });
    tabs.forEach(function (b) {
      b.addEventListener("click", function () {
        stop();
        var s = b.getAttribute("data-scene");
        if (s !== scene) loadScene(s);
      });
    });

    document.addEventListener("critical-assets", function () { loadScene(scene); }, { once: true });

    /* progressive src -> blob upgrade once the background fetch lands:
       keeps the shown frame, makes scrubbing instant */
    document.addEventListener("blob-ready", function (ev) {
      [[vSad, PROGRESS_SCENES[scene].sad], [vGs, PROGRESS_SCENES[scene].gs]].forEach(function (pair) {
        var v = pair[0];
        if (ev.detail !== pair[1] || v.src.indexOf("blob:") === 0) return;
        /* keep the shown frame; if the progressive load never produced one
           (aborted on a slow link), land on the current checkpoint */
        var t = v.readyState >= 2 ? v.currentTime : checkpointTime(k);
        attachSrc(v, src(pair[1]));
        paintPausedFrame(v, t);
      });
    });
  }

  /* ---------- boot ---------- */

  if (REDUCED.addEventListener) {
    REDUCED.addEventListener("change", function () {
      if (!REDUCED.matches) return; /* user can press play; nothing to force */
      document.querySelectorAll(".ba-compare").forEach(function (el) {
        if (el._pair && !el._pair.isUserPaused() && el._ppBtn) el._ppBtn.click();
      });
      document.querySelectorAll(".video-slot video, .fa-bench video").forEach(function (v) { v.pause(); });
    });
  }

  /* offline-capable repeat visits: cache-first for static assets */
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(function () { /* optional */ });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initLightbox();
    document.querySelectorAll(".ba-compare").forEach(function (el) { initCompare(el); });
    document.querySelectorAll(".video-slot").forEach(initSlot);
    initLightboxTriggers();
    initArena();
    initProgressExplorer();
    initTablists();
    initVisibility();
    startLoader();
  });
})();
