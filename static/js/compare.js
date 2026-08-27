/* Self-contained page behaviour: before/after comparison sliders (images or
   synced videos, Nerfies-style: no native controls, autoplay muted loop) and
   video slots that stay in "pending" state until their mp4 exists. No
   dependencies; works from file:// and GitHub Pages. */

(function () {
  "use strict";

  var ARROWS =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 6.6 3.2 12l5.4 5.4 1.4-1.4-4-4 4-4zm6.8 0-1.4 1.4 4 4-4 4 1.4 1.4L20.8 12z"/></svg>';

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  /* ---------- comparison slider ---------- */

  function initCompare(root) {
    var media = Array.prototype.filter.call(root.children, function (el) {
      return el.tagName === "IMG" || el.tagName === "VIDEO";
    });
    if (media.length !== 2) return;
    var a = media[0]; /* left side */
    var b = media[1]; /* right side, stays in flow and sets the height */

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
      root.setAttribute("aria-valuenow", Math.round(pos));
    }

    root.setAttribute("tabindex", "0");
    root.setAttribute("role", "slider");
    root.setAttribute("aria-valuemin", "0");
    root.setAttribute("aria-valuemax", "100");
    root.setAttribute("aria-label", "Comparison slider: " +
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
    root.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowLeft") { pos = clamp(pos - 2, 0, 100); apply(); ev.preventDefault(); }
      if (ev.key === "ArrowRight") { pos = clamp(pos + 2, 0, 100); apply(); ev.preventDefault(); }
    });

    /* video pair: keep both in lockstep, no native controls */
    if (a.tagName === "VIDEO" && b.tagName === "VIDEO") {
      [a, b].forEach(function (v) {
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.removeAttribute("controls");
      });
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
          '<div class="pending-badge"><span class="tag">placeholder</span>' +
          "<span>Fly-through pair not rendered yet &mdash; see asset_scripts/</span></div>";
        root.innerHTML = "";
        root.appendChild(slot);
        root.removeAttribute("role");
        root.removeAttribute("tabindex");
        root.style.cursor = "default";
      }
      [a, b].forEach(function (v) {
        v.addEventListener("error", onFail);
        if (v.error) onFail();
      });
      var ready = 0;
      function tryStart() {
        ready += 1;
        if (ready < 2 || failed) return;
        a.play().catch(function () {});
        b.play().catch(function () {});
      }
      [a, b].forEach(function (v) {
        if (v.readyState >= 3) tryStart();
        else v.addEventListener("canplay", tryStart, { once: true });
      });
      b.addEventListener("timeupdate", function () {
        if (!failed && Math.abs(a.currentTime - b.currentTime) > 0.08) {
          a.currentTime = b.currentTime;
        }
      });
    }
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
      video.play().catch(function () {});
    }
    if (video.readyState >= 3) loaded();
    else video.addEventListener("canplay", loaded, { once: true });
    /* on error the slot simply stays pending (poster + badge) */
  }

  /* ---------- pause offscreen videos ---------- */

  function initVisibility() {
    if (!("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var vids = e.target.querySelectorAll("video");
        vids.forEach(function (v) {
          if (!v.src || v.error) return;
          if (e.isIntersecting) v.play().catch(function () {});
          else v.pause();
        });
      });
    }, { threshold: 0.15 });
    document.querySelectorAll(".ba-compare, .video-slot").forEach(function (el) {
      io.observe(el);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".ba-compare").forEach(initCompare);
    document.querySelectorAll(".video-slot").forEach(initSlot);
    initVisibility();
  });
})();
