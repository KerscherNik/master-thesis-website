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
  function netPath(p) {
    /* grid reels ship H.264-only (AV1 measured LARGER on 4-up content);
       asking for a twin that intentionally does not exist would only put
       a 404 in every visitor's console */
    if (p.indexOf("/grid/") !== -1) return p;
    return AV1 ? core.av1Path(p) : p;
  }
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
    /* the browser paused all media on entering the bfcache; nudge the
       arena reel and the slot videos back (the explorer reel is seek-only
       and stays paused by design) */
    document.querySelectorAll(".fa-compare, .video-slot").forEach(function (el) {
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
    /* the explorer fetches its current scene itself; queue every scene's
       pair reel (in-flight dedupe makes the overlap free) */
    var extraPaths = Object.keys(core.PROGRESS_SCENES).map(function (sc) {
      return core.progGridPath(sc);
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

    var onCloseHook = null;
    var exemptVideo = null;
    openLightbox = function (build, captionText, opts) {
      opts = opts || {};
      onCloseHook = opts.onClose || null;
      exemptVideo = opts.exempt || null; /* fn(video) -> keep it playing */
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
        if (lb.contains(v) || v.paused) return;
        if (exemptVideo && exemptVideo(v)) return; /* a reel driving lb canvases */
        pausedPairs.push(v);
        v.pause();
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
      if (onCloseHook) { try { onCloseHook(); } catch (e) { /* ignore */ } }
      onCloseHook = null;
      exemptVideo = null;
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

  /* One hidden reel per scene carries all four methods in a 2x2 grid; the
     wipe, the bench tiles and the lightbox are canvas crops of the SAME
     decoded frame. Sync is correct by construction (see
     docs/research/rebuild-design.md); swaps are crop-offset changes and
     cost nothing. */
  function initArena() {
    var root = document.getElementById("flythrough-arena");
    if (!root) return;
    var cmp = root.querySelector(".fa-compare");
    var reel = cmp.querySelector(".fa-reel");
    var wipe = cmp.querySelector(".fa-wipe");
    var ctx = wipe.getContext("2d", { alpha: false });
    /* paint at display resolution: a tile shown at ~100 CSS px must not be
       rasterised at 478px every frame - that alone saturated a mid-range
       phone's main thread (measured: 15 s of long tasks per drag) */
    function fitCanvas(c) {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.round((c.clientWidth || c.width) * dpr);
      if (!w) return;
      var h = Math.round(w * 630 / 956);
      if (Math.abs(c.width - w) > c.width * 0.2) { c.width = w; c.height = h; }
    }
    var benchEl = root.querySelector(".fa-bench");
    var tabs = [].slice.call(root.querySelectorAll("[data-fly-scene]"));
    var zones = [].slice.call(root.querySelectorAll(".fa-drop"));
    var RATE = parseFloat(cmp.getAttribute("data-rate")) || 1;
    var QUADS = core.METHOD_QUADS;

    reel.defaultPlaybackRate = RATE;
    reel.playbackRate = RATE;
    reel.loop = true;

    var scene = "flowers", left = "sad", right = "gs";
    var frac = 0.5;                    /* wipe split, 0..1 */
    var userPaused = reducedMotion();  /* an explicit pause outranks all */
    var dragged = null;
    cmp._userPaused = userPaused;      /* initVisibility respects this */

    function label(m) { return core.FLY_METHODS[m].label; }
    function benched() { return core.benchedMethods(left, right); }
    function quadRect(m) {
      var q = QUADS[m];
      var qw = reel.videoWidth / 2, qh = reel.videoHeight / 2;
      return { x: q[0] * qw, y: q[1] * qh, w: qw, h: qh };
    }

    /* ---- painting ---- */
    var tilePainters = [];
    var lbPainter = null;
    function paintWipe() {
      fitCanvas(wipe);
      var cw = wipe.width, ch = wipe.height;
      var L = quadRect(left), R = quadRect(right);
      var split = Math.round(cw * frac);
      if (split > 0) {
        ctx.drawImage(reel, L.x, L.y, L.w * frac, L.h, 0, 0, split, ch);
      }
      if (split < cw) {
        ctx.drawImage(reel, R.x + R.w * frac, R.y, R.w * (1 - frac), R.h,
                      split, 0, cw - split, ch);
      }
    }
    var tick = 0;
    function paintAll(everything) {
      if (reel.readyState < 2) return;
      try { paintWipe(); } catch (e) { /* keep going */ }
      tick += 1;
      /* tiles are small previews: a third of the frame rate is plenty,
         and none at all while the slider is being dragged */
      if (!draggingSlider && (everything || tick % 3 === 0)) {
        tilePainters.forEach(function (p) { try { p(); } catch (e) { /* ditto */ } });
      }
      if (lbPainter) { try { lbPainter(); } catch (e) { /* ditto */ } }
    }
    /* rVFC paints exactly when a frame is presented; rAF is the fallback.
       Paused states repaint on demand - a canvas keeps its last pixels. */
    /* plain requestAnimationFrame drives the painting, exactly like the
       proven video_comparison.js pattern. requestVideoFrameCallback was
       tried first and starves in Safari for a height-0 video (it treats
       it as invisible, worse after a src swap) - the divider then tracks
       the pointer while the painted split lags seconds behind. The
       dirty/time gate keeps paused frames free; the adaptive skip keeps
       slow phones responsive (paint cost measured, ticks dropped). */
    var lastPaintT = -1, dirty = true;
    var paintCost = 0, skipLeft = 0;
    function requestRepaint() { dirty = true; }
    function loop() {
      var t = reel.currentTime;
      if ((dirty || t !== lastPaintT) && reel.readyState >= 2) {
        if (skipLeft > 0) {
          skipLeft -= 1;
        } else {
          var t0 = performance.now();
          paintAll();
          lastPaintT = t;
          dirty = false;
          paintCost = 0.8 * paintCost + 0.2 * (performance.now() - t0);
          skipLeft = paintCost > 24 ? 2 : (paintCost > 12 ? 1 : 0);
        }
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
    /* double-paint after seeks and loads: WebKit has served stale frames */
    function paintSoon() {
      requestRepaint();
      setTimeout(function () { requestRepaint(); }, 90);
    }
    reel.addEventListener("seeked", paintSoon);

    /* ---- slider chrome (canvas-backed port of the DOM wipe) ---- */
    var divider = document.createElement("div");
    divider.className = "ba-divider";
    var handle = document.createElement("div");
    handle.className = "ba-handle";
    handle.innerHTML = ARROWS;
    cmp.appendChild(divider);
    cmp.appendChild(handle);
    var labelEls = {};
    ["a", "b"].forEach(function (side) {
      var el = document.createElement("span");
      el.className = "ba-label " + side;
      cmp.appendChild(el);
      labelEls[side] = el;
    });
    handle.setAttribute("tabindex", "0");
    handle.setAttribute("role", "slider");
    handle.setAttribute("aria-valuemin", "0");
    handle.setAttribute("aria-valuemax", "100");

    function applySlider() {
      var pos = 100 * frac;
      divider.style.left = pos + "%";
      handle.style.left = pos + "%";
      handle.setAttribute("aria-valuenow", Math.round(pos));
      handle.setAttribute("aria-valuetext",
        Math.round(pos) + "% " + label(left) + ", " +
        (100 - Math.round(pos)) + "% " + label(right));
      requestRepaint(); /* the rAF loop repaints with the new split */
    }
    var dragRect = null;
    function fromEvent(ev) {
      var rect = dragRect || wipe.getBoundingClientRect();
      var x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
      frac = clamp(x / rect.width, 0, 1);
      applySlider();
    }
    var draggingSlider = false;
    cmp.addEventListener("pointerdown", function (ev) {
      if (ev.target.closest && ev.target.closest(".ba-playpause, .ba-expand, .fa-drop")) return;
      draggingSlider = true;
      dragRect = wipe.getBoundingClientRect();
      if (cmp.setPointerCapture) cmp.setPointerCapture(ev.pointerId);
      fromEvent(ev);
    });
    cmp.addEventListener("pointermove", function (ev) { if (draggingSlider) fromEvent(ev); });
    ["pointerup", "pointercancel"].forEach(function (t) {
      cmp.addEventListener(t, function () {
        draggingSlider = false;
        dragRect = null;
        paintAll(true); /* tiles catch up after the drag */
      });
    });
    handle.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowLeft") { frac = clamp(frac - 0.02, 0, 1); applySlider(); ev.preventDefault(); }
      if (ev.key === "ArrowRight") { frac = clamp(frac + 0.02, 0, 1); applySlider(); ev.preventDefault(); }
    });

    /* ---- one element, one play state ---- */
    var pp = document.createElement("button");
    pp.type = "button";
    pp.className = "ba-playpause";
    pp.addEventListener("pointerdown", function (ev) { ev.stopPropagation(); });
    pp.addEventListener("click", function (ev) {
      ev.stopPropagation();
      setPaused(!userPaused);
    });
    cmp.appendChild(pp);
    cmp._ppBtn = pp;
    function syncButton() {
      pp.innerHTML = userPaused ? PLAY : PAUSE;
      pp.setAttribute("aria-label", userPaused ? "Play the fly-through" : "Pause the fly-through");
    }
    function setPaused(p) {
      userPaused = p;
      cmp._userPaused = p;
      syncButton();
      if (userPaused) { reel.pause(); paintAll(); }
      else if (!pendingLoad) reel.play().catch(function () {});
      /* play() legally pends through seeks and low readyState - gating it
         on readiness silently swallowed presses landing mid-seek. The only
         real gate is a pending load: the stale frame must never start
         moving behind the veil, so that intent is applied by the
         loadeddata handler when the new reel arrives */
    }
    syncButton();
    if (REDUCED.addEventListener) {
      REDUCED.addEventListener("change", function () {
        if (REDUCED.matches && !userPaused) setPaused(true);
      });
    }

    /* ---- enlarge: big canvases driven by the same reel ---- */
    function reelExempt(v) { return v === reel; }
    function openQuadLightbox(m) {
      openLightbox(function (stage) {
        var c = document.createElement("canvas");
        c.width = reel.videoWidth / 2 || 956;
        c.height = reel.videoHeight / 2 || 630;
        c.className = "lb-canvas";
        c.setAttribute("role", "img");
        c.setAttribute("aria-label", label(m) + " fly-through, " + scene + " scene");
        stage.appendChild(c);
        var cctx = c.getContext("2d");
        lbPainter = function () {
          var r = quadRect(m);
          cctx.drawImage(reel, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
        };
        c.addEventListener("click", function () { setPaused(!userPaused); });
        paintSoon();
      }, label(m) + " — " + scene + " (click the image to play or pause)",
      { exempt: reelExempt, onClose: function () { lbPainter = null; } });
    }
    function openWipeLightbox() {
      openLightbox(function (stage) {
        var c = document.createElement("canvas");
        c.width = reel.videoWidth / 2 || 956;
        c.height = reel.videoHeight / 2 || 630;
        c.className = "lb-canvas";
        c.setAttribute("role", "img");
        c.setAttribute("aria-label",
          label(left) + " versus " + label(right) + ", " + scene + " scene");
        stage.appendChild(c);
        var cctx = c.getContext("2d");
        lbPainter = function () {
          var cw = c.width, ch = c.height;
          var L = quadRect(left), R = quadRect(right);
          var split = Math.round(cw * frac);
          if (split > 0) cctx.drawImage(reel, L.x, L.y, L.w * frac, L.h, 0, 0, split, ch);
          if (split < cw) cctx.drawImage(reel, R.x + R.w * frac, R.y, R.w * (1 - frac), R.h,
                                         split, 0, cw - split, ch);
          cctx.fillStyle = "#fff";
          cctx.fillRect(split - 1, 0, 2, ch);
        };
        c.addEventListener("pointerdown", function (ev) {
          var rect = c.getBoundingClientRect();
          frac = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
          applySlider();
          paintAll();
        });
        paintSoon();
      }, label(left) + " versus " + label(right) + " — " + scene + " (drag to compare)",
      { exempt: reelExempt, onClose: function () { lbPainter = null; } });
    }
    var ex = document.createElement("button");
    ex.type = "button";
    ex.className = "ba-expand";
    ex.innerHTML = EXPAND;
    ex.setAttribute("aria-label", "Enlarge comparison");
    ex.addEventListener("pointerdown", function (ev) { ev.stopPropagation(); });
    ex.addEventListener("click", function (ev) {
      ev.stopPropagation();
      openWipeLightbox();
    });
    cmp.appendChild(ex);

    /* ---- bench: two tiles, each a crop of the reel ---- */
    function makeTile(m) {
      var tile = document.createElement("div");
      tile.className = "fa-tile";
      tile.setAttribute("draggable", "true");
      tile.setAttribute("data-method", m);
      tile.innerHTML =
        '<div class="fa-tile-media">' +
        '<canvas width="478" height="315"></canvas>' +
        '<span class="spinner" aria-hidden="true"></span></div>' +
        '<div class="fa-tile-side"><span class="fa-tile-name"></span>' +
        '<div class="fa-tile-actions">' +
        '<button type="button" class="fa-swap" data-side="a" title="Swap into left side" aria-label="Swap into left side">&#9664;</button>' +
        '<button type="button" class="fa-swap" data-side="b" title="Swap into right side" aria-label="Swap into right side">&#9654;</button>' +
        "</div></div>";
      tile.querySelector(".fa-tile-name").textContent = label(m);
      var tc = tile.querySelector("canvas");
      tc.setAttribute("role", "img");
      tc.setAttribute("aria-label", label(m) + " fly-through preview, " + scene + " scene");
      var tctx = tc.getContext("2d", { alpha: false });
      tilePainters.push(function () {
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var w = Math.round((tc.clientWidth || 104) * dpr);
        if (w && Math.abs(tc.width - w) > tc.width * 0.2) {
          tc.width = w;
          tc.height = Math.round(w * 630 / 956);
        }
        var r = quadRect(m);
        tctx.drawImage(reel, r.x, r.y, r.w, r.h, 0, 0, tc.width, tc.height);
      });
      tile.addEventListener("dragstart", function (ev) {
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
        openQuadLightbox(m);
      });
      return tile;
    }
    function refreshTilesLoaded() {
      var ok = reel.readyState >= 2;
      benchEl.querySelectorAll(".fa-tile").forEach(function (t) {
        t.classList.toggle("loaded", ok);
      });
    }
    function buildBench() {
      benchEl.innerHTML = "";
      tilePainters = [];
      benched().forEach(function (m) { benchEl.appendChild(makeTile(m)); });
      refreshTilesLoaded();
    }

    /* ---- swaps: crop-offset changes, instant, nothing to load ---- */
    function syncTexts() {
      labelEls.a.textContent = label(left);
      labelEls.b.textContent = label(right);
      root.querySelector(".fa-drop.left .fa-drop-name").textContent = label(left);
      root.querySelector(".fa-drop.right .fa-drop-name").textContent = label(right);
      handle.setAttribute("aria-label",
        "Comparison slider: " + label(left) + " versus " + label(right) + ", " + scene + " scene");
      wipe.setAttribute("aria-label",
        label(left) + " versus " + label(right) + " fly-through, " + scene + " scene");
      applySlider();
    }
    function swap(side, m) {
      if (!m || m === left || m === right) return;
      if (side === "a") left = m; else right = m;
      syncTexts();
      buildBench();
      paintAll();
    }

    zones.forEach(function (z) {
      z.addEventListener("dragover", function (ev) {
        ev.preventDefault();
        z.classList.add("over");
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
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

    /* ---- reel loading: the veil owns the truth ---- */
    var pendingLoad = null;
    function beginLoad(path) {
      if (pendingLoad) pendingLoad.cancel();
      var my = { canceled: false };
      my.onLoaded = function () {
        reel.removeEventListener("loadeddata", my.onLoaded);
        if (my.canceled) return;
        my.canceled = true;
        pendingLoad = null;
        demandDown();
        /* the veil stays up: the arrival handler drops it once a frame is
           provably painted (or immediately when playing) */
      };
      my.cancel = function () {
        if (my.canceled) return;
        my.canceled = true;
        reel.removeEventListener("loadeddata", my.onLoaded);
        demandDown();
      };
      pendingLoad = my;
      cmp.classList.add("fa-loading");
      demandUp();
      fetchToBlob(path).then(function (url) {
        if (my.canceled) return;
        reel.addEventListener("loadeddata", my.onLoaded);
        attachSrc(reel, url);
      }).catch(function () {
        if (my.canceled) return;
        my.cancel();
        cmp.classList.remove("fa-loading");
        /* the canvases keep the previous frame - nothing goes black */
      });
    }

    /* every (re)attach lands here. Playing intent: seek back, play, done.
       Paused intent: Safari yields no frames from a never-played element
       and can answer a post-seek drawImage with nothing - so seek FIRST,
       micro-play AT that position, then paint and read the pixels back,
       retrying under the veil until a frame is provably on screen. The
       veil (raised by beginLoad) drops only on proof - the user asked for
       exactly this: loading state until fully ready. */
    function canvasHasPixels(c) {
      try {
        var g = c.getContext("2d");
        var d = g.getImageData(Math.max(0, (c.width >> 1) - 8),
                               Math.max(0, (c.height >> 1) - 6), 16, 12).data;
        var sum = 0;
        for (var i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
        return sum / (d.length / 4) > 9; /* an unpainted canvas reads ~0 */
      } catch (e) { return true; /* unreadable: assume painted */ }
    }
    function unveil() { cmp.classList.remove("fa-loading"); }
    reel.addEventListener("loadeddata", function () {
      refreshTilesLoaded();
      var t = reel._keepT || 0;
      reel._keepT = 0;
      if (!userPaused && cmp._visible !== false) {
        if (t) ensureSeek(reel, t);
        reel.play().catch(function () { paintSoon(); });
        paintSoon();
        unveil();
        return;
      }
      var tries = 0;
      function attempt() {
        if (!userPaused) { unveil(); return; } /* play pressed meanwhile */
        tries += 1;
        var pr = reel.play();
        var settle = function () {
          if (!userPaused) { unveil(); return; } /* now playing: leave it */
          reel.pause();
          paintAll(true);
          if (canvasHasPixels(wipe) || tries >= 8) { unveil(); requestRepaint(); }
          else setTimeout(attempt, 160);
        };
        if (pr && pr.then) {
          pr.then(settle).catch(function () {
            /* autoplay denied: cannot prime without a gesture; paint what
               is available and unveil - the play button will paint */
            paintAll(true);
            unveil();
          });
        } else settle();
      }
      if (t && Math.abs(reel.currentTime - t) > 0.05) {
        var onSeeked = function () {
          reel.removeEventListener("seeked", onSeeked);
          attempt();
        };
        reel.addEventListener("seeked", onSeeked);
        try { reel.currentTime = t; } catch (e) {
          reel.removeEventListener("seeked", onSeeked);
          attempt();
        }
      } else {
        attempt();
      }
    });

    /* AV1 canary: decode error -> refetch the H.264 grid behind the veil */
    reel._recovered = 0;
    reel.addEventListener("error", function () {
      if (reel._recovered >= 2) return;
      reel._recovered += 1;
      var path = core.gridPath(scene);
      revokeAV1(path);
      delete blobs[path];
      beginLoad(path);
    });

    /* ---- scenes: one file each, position carried over ---- */
    function setScene(s) {
      if (s === scene) return;
      scene = s;
      reel._keepT = reel.currentTime || 0; /* same camera path: keep position */
      tabs.forEach(function (b) {
        var on = b.getAttribute("data-fly-scene") === s;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      syncTexts();
      buildBench(); /* fresh aria labels; spinners until the reel is ready */
      beginLoad(core.gridPath(s));
    }
    tabs.forEach(function (b) {
      b.addEventListener("click", function () { setScene(b.getAttribute("data-fly-scene")); });
    });

    /* ---- boot + background prefetch of the other scenes ---- */
    buildBench();
    syncTexts();
    document.addEventListener("critical-assets", function () {
      /* the flowers reel arrived with the loader; fetch the rest behind
         the demand gate, one at a time */
      var rest = core.FLY_SCENES.filter(function (s) { return s !== scene; })
        .map(core.gridPath).filter(function (p) { return !blobs[p]; });
      function next() {
        if (!rest.length) return;
        if (demandBusy()) { setTimeout(next, 400); return; }
        var p = rest.shift();
        fetchToBlob(p, null, null, true).catch(function (err) {
          if (isAbort(err)) { rest.unshift(p); bgResumers.push(next); return "parked"; }
        }).then(function (state) { if (state !== "parked") next(); });
      }
      next();
    }, { once: true });
  }

  /* ---------- training-progress explorer ---------- */

  /* SAD and 3DGS live side by side in one reel per scene; the two panes are
     left/right crops of the same frame, so a checkpoint seek is a single
     currentTime assignment that cannot diverge. */
  function initProgressExplorer() {
    var root = document.getElementById("progress-explorer");
    if (!root) return;
    var reel = root.querySelector(".pe-reel");
    var cSad = root.querySelector('canvas[data-role="sad"]');
    var cGs = root.querySelector('canvas[data-role="gs"]');
    var slider = root.querySelector('input[type="range"]');
    var label = root.querySelector(".pe-iter");
    var playBtn = root.querySelector(".pe-play");
    var ticksEl = root.querySelector(".pe-ticks");
    var tabs = [].slice.call(root.querySelectorAll(".pe-tab"));
    var k = 0, scene = "flowers", playing = false, timer = null;

    playBtn.innerHTML = PLAY;

    /* spinners over each pane while the reel has no data */
    root.querySelectorAll(".pe-frame").forEach(function (f) {
      var sp = document.createElement("span");
      sp.className = "spinner";
      sp.setAttribute("aria-hidden", "true");
      f.appendChild(sp);
    });

    var LABELED = { 500: "500", 5000: "5k", 10000: "10k", 20000: "20k", 30000: "30k" };
    CHECKPOINTS.forEach(function (it, i) {
      var t = document.createElement("span");
      t.className = "pe-tick" + (LABELED[it] ? " labeled" : "");
      t.style.left = "calc(9px + " + core.tickFraction(i, CHECKPOINTS.length) + " * (100% - 18px))";
      if (LABELED[it]) t.setAttribute("data-label", LABELED[it]);
      ticksEl.appendChild(t);
    });

    function paintPanes() {
      if (reel.readyState < 2) return;
      var hw = reel.videoWidth / 2, hh = reel.videoHeight;
      [[cSad, 0], [cGs, hw]].forEach(function (pane) {
        var c = pane[0];
        if (c.width !== hw || c.height !== hh) { c.width = hw; c.height = hh; }
        c.getContext("2d").drawImage(reel, pane[1], 0, hw, hh, 0, 0, hw, hh);
      });
    }
    function paintSoon() { paintPanes(); setTimeout(paintPanes, 80); }
    reel.addEventListener("seeked", paintSoon);

    function seekAll() {
      ensureSeek(reel, checkpointTime(k));
      label.textContent = core.formatIteration(CHECKPOINTS[k]);
      slider.value = k;
      slider.setAttribute("aria-valuetext",
        core.formatIteration(CHECKPOINTS[k]) + " of 30,000");
    }

    /* every (re)attach: seek to the current checkpoint FIRST, then prime
       the decoder AT that position (Safari yields no frames from a
       never-played element, and a post-seek drawImage can return
       nothing), then paint and verify pixels before dropping the veil */
    function paneHasPixels() {
      try {
        var g = cSad.getContext("2d");
        var d = g.getImageData(Math.max(0, (cSad.width >> 1) - 8),
                               Math.max(0, (cSad.height >> 1) - 6), 16, 12).data;
        var sum = 0;
        for (var i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
        return sum / (d.length / 4) > 9;
      } catch (e) { return true; }
    }
    reel.addEventListener("loadeddata", function () {
      seekAll(); /* label, slider, and the seek toward checkpointTime(k) */
      var tries = 0;
      function attempt() {
        tries += 1;
        var pr = reel.play();
        var settle = function () {
          reel.pause();
          paintPanes();
          if (paneHasPixels() || tries >= 8) {
            root.classList.remove("pe-loading");
            paintSoon();
          } else {
            setTimeout(attempt, 160);
          }
        };
        if (pr && pr.then) {
          pr.then(settle).catch(function () {
            paintPanes();
            root.classList.remove("pe-loading");
          });
        } else settle();
      }
      var onSeeked = function () {
        reel.removeEventListener("seeked", onSeeked);
        attempt();
      };
      reel.addEventListener("seeked", onSeeked);
      /* if the seek is a no-op (already at target), seeked never fires */
      if (Math.abs(reel.currentTime - checkpointTime(k)) < 0.05) {
        reel.removeEventListener("seeked", onSeeked);
        attempt();
      }
    });
    reel._recovered = 0;
    reel.addEventListener("error", function () {
      if (reel._recovered >= 2) return; /* veil stays: data truly absent */
      reel._recovered += 1;
      var path = core.progGridPath(scene);
      revokeAV1(path);
      delete blobs[path];
      loadReel(path);
    });

    var pendingLoad = null;
    function loadReel(path) {
      if (pendingLoad) pendingLoad.cancel();
      var my = { canceled: false };
      my.onLoaded = function () {
        reel.removeEventListener("loadeddata", my.onLoaded);
        if (my.canceled) return;
        my.canceled = true;
        pendingLoad = null;
        demandDown();
      };
      my.cancel = function () {
        if (my.canceled) return;
        my.canceled = true;
        reel.removeEventListener("loadeddata", my.onLoaded);
        demandDown();
      };
      pendingLoad = my;
      root.classList.add("pe-loading");
      demandUp();
      if (promoteBg) promoteBg([path]);
      fetchToBlob(path).then(function (url) {
        if (my.canceled) return;
        reel.addEventListener("loadeddata", my.onLoaded);
        attachSrc(reel, url);
      }).catch(function () {
        if (my.canceled) return;
        my.cancel(); /* veil stays on: the reel really has no data */
      });
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
      loadReel(core.progGridPath(s));
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

    root.classList.add("pe-loading");
    document.addEventListener("critical-assets", function () { loadScene(scene); }, { once: true });
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

  /* The old caching service worker could pin Safari visitors to a stale
     deploy (its update checks are unreliable); it is gone for good.
     Unregister any leftover worker and clear its caches. */
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (r) { r.unregister().catch(function () {}); });
    }).catch(function () {});
    if (window.caches && caches.keys) {
      caches.keys().then(function (keys) {
        keys.forEach(function (k) { caches.delete(k).catch(function () {}); });
      }).catch(function () {});
    }
  }

  /* visible build id: turns "still broken" reports into diagnosable ones */
  (function () {
    var tag = document.querySelector("[data-build]");
    var b = tag ? tag.getAttribute("data-build") : "";
    var label = (!b || b.indexOf("__") === 0) ? "local" : b.slice(0, 7);
    if (tag) tag.textContent = "build " + label;
    try { console.info("SAD page build: " + label); } catch (e) { /* ignore */ }
  })();

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
