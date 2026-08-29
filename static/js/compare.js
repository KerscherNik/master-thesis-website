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
  var blobs = {}; /* path -> object URL, once fully fetched */

  /* AV1 twins are ~50% smaller at the same visual quality; fall back to the
     H.264 originals wherever AV1 decode is unavailable (older Safari) */
  var AV1 = false;
  try {
    AV1 = typeof MediaSource !== "undefined" &&
      MediaSource.isTypeSupported('video/mp4; codecs="av01.0.08M.08"');
  } catch (e) { /* keep H.264 */ }
  function netPath(p) { return AV1 ? core.av1Path(p) : p; }
  var openLightbox, closeLightbox;
  function src(path) { return blobs[path] || netPath(path); }

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

  function fetchToBlob(path, onBytes, onTotal) {
    if (blobs[path]) return Promise.resolve(blobs[path]);
    if (inflight[path]) return inflight[path];
    var p = doFetchToBlob(netPath(path), onBytes, onTotal)
      .catch(function (err) {
        /* AV1 twin missing or failed: retry the H.264 original */
        if (netPath(path) === path) throw err;
        return doFetchToBlob(path, onBytes, onTotal);
      })
      .then(function (url) {
        blobs[path] = url;
        delete inflight[path];
        return url;
      }, function (err) {
        delete inflight[path];
        throw err;
      });
    inflight[path] = p;
    return p;
  }

  function doFetchToBlob(path, onBytes, onTotal) {
    return fetch(path).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status + " for " + path);
      var len = +res.headers.get("Content-Length") || 0;
      if (onTotal) onTotal(len);
      if (!res.body || !res.body.getReader) return res.blob();
      var reader = res.body.getReader();
      var chunks = [];
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return new Blob(chunks, { type: "video/mp4" });
          chunks.push(r.value);
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
    function nextLazy() {
      if (!queue.length) return;
      var t = queue.shift();
      fetchToBlob(t.path)
        .then(function (url) {
          if (t.v) attachSrc(t.v, url);
          else document.dispatchEvent(new CustomEvent("blob-ready", { detail: t.path }));
        })
        .catch(function () { if (t.v) markFailed(t.v); })
        .then(nextLazy);
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
    var userPaused = false; /* explicit pause via the button wins over all auto-play */
    function tick() {
      if (active && !b.paused && a.readyState >= 2 &&
          Math.abs(a.currentTime - b.currentTime) > 0.08) {
        a.currentTime = b.currentTime;
      }
      requestAnimationFrame(tick);
    }
    function start() {
      if (!active || userPaused || a.readyState < 2 || b.readyState < 2) return;
      /* only seek on real drift: an unconditional seek fires "waiting",
         which pauses the partner, whose "canplay" would re-enter start()
         and seek again — an infinite loop that freezes the pair */
      if (Math.abs(a.currentTime - b.currentTime) > 0.08) {
        try { a.currentTime = b.currentTime; } catch (e) { /* not seekable yet */ }
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
        (v === a ? b : a).pause();
      });
      v.addEventListener("canplay", function () { if (active) start(); });
    });
    /* watchdog: a visible pair must be playing. If either side ends up
       paused while both are decodable (missed event, rejected play(),
       hot-reload races), re-enter start() — it re-syncs and resumes. */
    setInterval(function () {
      if (active && !userPaused && a.readyState >= 2 && b.readyState >= 2 &&
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
      isUserPaused: function () { return userPaused; }
    };
  }

  /* ---------- comparison slider ---------- */

  function initCompare(root, opts) {
    opts = opts || {};
    var media = Array.prototype.filter.call(root.children, function (el) {
      return el.tagName === "IMG" || el.tagName === "VIDEO";
    });
    if (media.length !== 2) return;
    var a = media[0]; /* left side */
    var b = media[1]; /* right side, stays in flow and sets the height */
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
    root.insertBefore(top, b);
    top.appendChild(a);

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
    function apply() {
      top.style.clipPath = "inset(0 " + (100 - pos) + "% 0 0)";
      divider.style.left = pos + "%";
      handle.style.left = pos + "%";
      handle.setAttribute("aria-valuenow", Math.round(pos));
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
      var failed = false;
      function onFail() {
        if (failed) return;
        failed = true;
        root.classList.add("pending");
        var poster = root.getAttribute("data-poster");
        var slot = document.createElement("div");
        slot.className = "video-slot";
        slot.innerHTML =
          (poster ? '<img class="poster" src="' + poster + '" alt="">' : "") +
          '<div class="pending-badge"><span class="tag">unavailable</span>' +
          "<span>Fly-through pair not rendered yet</span></div>";
        root.innerHTML = ""; /* also removes the handle and its slider role */
        root.appendChild(slot);
        root.style.cursor = "default";
      }
      [a, b].forEach(function (v) {
        v.addEventListener("error", onFail);
        if (v.error) onFail();
      });
      root._pair = pairSync(a, b, rate);
      if (opts.autoplay) root._pair.resume();

      /* freeze the comparison at any moment */
      var pp = document.createElement("button");
      pp.type = "button";
      pp.className = "ba-playpause";
      pp.innerHTML = PAUSE;
      pp.setAttribute("aria-label", "Pause the fly-through");
      pp.addEventListener("pointerdown", function (ev) { ev.stopPropagation(); });
      pp.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var playing = root._pair.toggle();
        pp.innerHTML = playing ? PAUSE : PLAY;
        pp.setAttribute("aria-label", playing ? "Pause the fly-through" : "Resume the fly-through");
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
    var lb = document.createElement("div");
    lb.className = "lightbox";
    lb.setAttribute("role", "dialog");
    lb.setAttribute("aria-modal", "true");
    lb.innerHTML =
      '<button class="lb-close" type="button" aria-label="Close">' + CLOSE + "</button>" +
      '<div class="lb-stage"></div><p class="lb-caption"></p>';
    document.body.appendChild(lb);
    var stage = lb.querySelector(".lb-stage");
    var cap = lb.querySelector(".lb-caption");
    var closeBtn = lb.querySelector(".lb-close");
    var pausedPairs = [];
    var opener = null;

    openLightbox = function (build, captionText) {
      stage.innerHTML = "";
      build(stage);
      cap.textContent = captionText || "";
      cap.style.display = captionText ? "" : "none";
      lb.classList.add("open");
      document.body.classList.add("no-scroll");
      /* move focus into the dialog; return it on close */
      opener = document.activeElement;
      closeBtn.focus();
      /* silence page videos behind the overlay */
      pausedPairs = [];
      document.querySelectorAll("video").forEach(function (v) {
        if (!lb.contains(v) && !v.paused) { pausedPairs.push(v); v.pause(); }
      });
    };
    closeLightbox = function () {
      if (!lb.classList.contains("open")) return;
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
      pausedPairs.forEach(function (v) { v.play().catch(function () {}); });
      pausedPairs = [];
    };
    lb.addEventListener("click", function (ev) {
      if (ev.target === lb || ev.target.closest(".lb-close")) closeLightbox();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closeLightbox();
      /* keep Tab inside the dialog while it is open */
      if (ev.key === "Tab" && lb.classList.contains("open")) {
        var focusables = lb.querySelectorAll(
          "button, video[controls], [tabindex]:not([tabindex='-1'])");
        if (!focusables.length) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if (ev.shiftKey && document.activeElement === first) {
          last.focus(); ev.preventDefault();
        } else if (!ev.shiftKey && document.activeElement === last) {
          first.focus(); ev.preventDefault();
        } else if (!lb.contains(document.activeElement)) {
          first.focus(); ev.preventDefault();
        }
      }
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

  function openVideoLightbox(path, caption, rate) {
    openLightbox(function (stage) {
      var v = document.createElement("video");
      v.preload = "auto";
      v.src = src(path);
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.controls = true;
      v.autoplay = true;
      if (rate) { v.defaultPlaybackRate = rate; v.playbackRate = rate; }
      stage.appendChild(v);
      v.play().catch(function () {});
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
      info.srcs.forEach(function (s) {
        var m;
        if (info.isVideo) {
          m = document.createElement("video");
          m.muted = true; m.loop = true; m.playsInline = true;
          m.preload = "auto";
          m.src = src(s);
        } else {
          m = document.createElement("img");
          m.src = s;
          m.alt = "";
        }
        el.appendChild(m);
      });
      stage.appendChild(el);
      initCompare(el, { noExpand: true, autoplay: true });
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
      if (slot._visible !== false) video.play().catch(function () {});
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
          if (e.isIntersecting) v.play().catch(function () {});
          else v.pause();
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
    var pendingSides = 0;
    var dragged = null;

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
          "Comparison slider: " + label(left) + " versus " + label(right));
      }
      if (cmp._compare) {
        cmp._compare.srcs = [core.flyPath(scene, left), core.flyPath(scene, right)];
        cmp._compare.labels = [label(left), label(right)];
      }
    }

    function attachSide(v, path) {
      pendingSides += 1;
      cmp.classList.add("fa-loading");
      v.style.opacity = "0.25";
      v.addEventListener("loadeddata", function done() {
        v.removeEventListener("loadeddata", done);
        v.style.opacity = "";
        pendingSides = Math.max(0, pendingSides - 1);
        if (!pendingSides) cmp.classList.remove("fa-loading");
      });
      fetchToBlob(path).then(function (url) {
        attachSrc(v, url);
      }).catch(function () {
        v.style.opacity = "";
        pendingSides = Math.max(0, pendingSides - 1);
        if (!pendingSides) cmp.classList.remove("fa-loading");
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

      var tv = tile.querySelector("video");
      if (RATE) { tv.defaultPlaybackRate = RATE; tv.playbackRate = RATE; }
      fetchToBlob(core.flyPath(scene, m)).then(function (url) {
        tv.addEventListener("loadeddata", function done() {
          tv.removeEventListener("loadeddata", done);
          tile.classList.add("loaded");
          if (benchEl._visible !== false) tv.play().catch(function () {});
        });
        attachSrc(tv, url);
      }).catch(function () {
        tile.classList.add("fa-unavailable");
        tile.setAttribute("draggable", "false");
        tile.querySelector(".fa-tile-name").textContent = label(m) + " — not available";
      });

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
        openVideoLightbox(core.flyPath(scene, m), label(m) + " — " + scene, RATE);
      });
      return tile;
    }

    function buildBench() {
      benchEl.innerHTML = "";
      benched().forEach(function (m) { benchEl.appendChild(makeTile(m)); });
    }

    function resetPlayback() {
      if (cmp._pair) cmp._pair.play();
      if (cmp._ppBtn) {
        cmp._ppBtn.innerHTML = PAUSE;
        cmp._ppBtn.setAttribute("aria-label", "Pause the fly-through");
      }
    }

    function swap(side, m) {
      if (!m || m === left || m === right) return;
      if (side === "a") left = m; else right = m;
      resetPlayback();
      syncTexts();
      attachSide(side === "a" ? vA : vB, core.flyPath(scene, m));
      buildBench();
    }

    function setScene(s) {
      if (s === scene) return;
      scene = s;
      resetPlayback();
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
    document.addEventListener("critical-assets", function () {
      syncTexts();
      buildBench();
      /* background prefetch, ring videos of every scene before bench videos:
         a scene tab click most likely needs the current left/right methods */
      var rest = [];
      core.FLY_SCENES.forEach(function (s) {
        [left, right].forEach(function (m) {
          var p = core.flyPath(s, m);
          if (!blobs[p]) rest.push(p);
        });
      });
      core.FLY_SCENES.forEach(function (s) {
        Object.keys(core.FLY_METHODS).forEach(function (m) {
          var p = core.flyPath(s, m);
          if (!blobs[p] && rest.indexOf(p) < 0) rest.push(p);
        });
      });
      /* two parallel streams, but yield entirely while the user waits on an
         on-demand load (scene switch / swap) so it gets the bandwidth */
      function next() {
        if (!rest.length) return;
        if (pendingSides > 0) { setTimeout(next, 400); return; }
        var p = rest.shift();
        fetchToBlob(p).catch(function () {}).then(next);
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
      [[vSad, PROGRESS_SCENES[s].sad], [vGs, PROGRESS_SCENES[s].gs]].forEach(function (p) {
        var v = p[0];
        v.pause();
        v.addEventListener("loadeddata", seekAll, { once: true });
        attachSrc(v, src(p[1]));
      });
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
        var t = v.currentTime;
        v.addEventListener("loadeddata", function once() {
          v.removeEventListener("loadeddata", once);
          try { v.currentTime = t; } catch (e) { /* keep frame 0 */ }
        });
        attachSrc(v, src(pair[1]));
      });
    });
  }

  /* ---------- boot ---------- */

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
