/*
 * TrueClick — in-page overlay
 *
 * Turns flag objects into non-destructive on-page markers: a 2px outline over
 * the flagged element plus an 18px "!" badge at its top-right corner. Clicking,
 * hovering, or focusing the badge opens a popover (claim -> reality + proof).
 *
 * The original element is never hidden, moved, or altered — markers live in a
 * separate fixed-position layer and track the element on scroll/resize.
 *
 * Exposes:
 *   window.__trueclickOverlay.render(flags)
 *   window.__trueclickOverlay.clear()
 */
(function () {
  "use strict";

  var LAYER_ID = "tc-overlay-layer";
  var state = {
    layer: null,
    markers: [],   // { flag, outline, badge, popover, proof }
    rafId: null,
    openPopover: null
  };

  function ensureLayer() {
    if (state.layer && document.documentElement.contains(state.layer)) {
      return state.layer;
    }
    var layer = document.getElementById(LAYER_ID);
    if (!layer) {
      layer = document.createElement("div");
      layer.id = LAYER_ID;
      layer.className = "tc-layer";
      (document.body || document.documentElement).appendChild(layer);
    }
    state.layer = layer;
    return layer;
  }

  function clear() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    state.markers = [];
    state.openPopover = null;
    if (state.layer) state.layer.textContent = "";
  }

  function makeMarker(flag) {
    var el = flag.element;
    if (!el || !(el instanceof Element)) return null;

    var outline = document.createElement("div");
    outline.className = "tc-outline";
    try {
      outline.style.borderRadius = getComputedStyle(el).borderRadius || "0px";
    } catch (e) {
      outline.style.borderRadius = "0px";
    }

    var badge = document.createElement("button");
    badge.type = "button";
    badge.className = "tc-badge";
    badge.textContent = "!";
    badge.setAttribute("aria-label", "TrueClick: " + flag.label);
    badge.setAttribute("aria-expanded", "false");

    var popover = document.createElement("div");
    popover.className = "tc-popover";
    popover.hidden = true;

    var labelEl = document.createElement("p");
    labelEl.className = "tc-popover-label";
    labelEl.textContent = flag.label;

    var sentence = document.createElement("p");
    sentence.className = "tc-popover-sentence";
    var claimSpan = document.createElement("span");
    claimSpan.textContent = flag.claim;
    var arrow = document.createElement("span");
    arrow.className = "tc-arrow";
    arrow.textContent = "→"; // →
    var realitySpan = document.createElement("span");
    realitySpan.textContent = flag.reality;
    sentence.appendChild(claimSpan);
    sentence.appendChild(arrow);
    sentence.appendChild(realitySpan);

    var proofToggle = document.createElement("button");
    proofToggle.type = "button";
    proofToggle.className = "tc-proof-toggle";
    proofToggle.textContent = "Show proof";
    proofToggle.setAttribute("aria-expanded", "false");

    var proof = document.createElement("pre");
    proof.className = "tc-proof";
    proof.hidden = true;
    proof.textContent = flag.evidence || "(no evidence captured)";

    proofToggle.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var show = proof.hidden;
      proof.hidden = !show;
      proofToggle.textContent = show ? "Hide proof" : "Show proof";
      proofToggle.setAttribute("aria-expanded", String(show));
    });

    popover.appendChild(labelEl);
    popover.appendChild(sentence);
    popover.appendChild(proofToggle);
    popover.appendChild(proof);

    function openPopover() {
      if (state.openPopover && state.openPopover !== popover) {
        state.openPopover.hidden = true;
      }
      popover.hidden = false;
      state.openPopover = popover;
      badge.setAttribute("aria-expanded", "true");
    }
    function closePopover() {
      popover.hidden = true;
      badge.setAttribute("aria-expanded", "false");
      if (state.openPopover === popover) state.openPopover = null;
    }

    badge.addEventListener("mouseenter", openPopover);
    badge.addEventListener("focus", openPopover);
    badge.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (popover.hidden) openPopover();
      else closePopover();
    });
    popover.addEventListener("mouseenter", openPopover);
    // Hovering away from both badge and popover closes it.
    function scheduleClose() {
      setTimeout(function () {
        if (!badge.matches(":hover") && !popover.matches(":hover") &&
            document.activeElement !== badge) {
          closePopover();
        }
      }, 120);
    }
    badge.addEventListener("mouseleave", scheduleClose);
    popover.addEventListener("mouseleave", scheduleClose);
    badge.addEventListener("blur", scheduleClose);

    var layer = ensureLayer();
    layer.appendChild(outline);
    layer.appendChild(badge);
    layer.appendChild(popover);

    return { flag: flag, el: el, outline: outline, badge: badge, popover: popover };
  }

  function positionMarker(m) {
    var el = m.el;
    if (!document.contains(el)) {
      m.outline.style.display = "none";
      m.badge.style.display = "none";
      m.popover.hidden = true;
      return;
    }
    var r = el.getBoundingClientRect();
    var visible = r.width > 0 && r.height > 0 &&
      r.bottom > 0 && r.right > 0 &&
      r.top < window.innerHeight && r.left < window.innerWidth;

    m.outline.style.display = visible ? "block" : "none";
    m.badge.style.display = visible ? "flex" : "none";
    if (!visible) {
      m.popover.hidden = true;
      return;
    }

    m.outline.style.left = (r.left - 2) + "px";
    m.outline.style.top = (r.top - 2) + "px";
    m.outline.style.width = (r.width + 4) + "px";
    m.outline.style.height = (r.height + 4) + "px";

    var bx = r.right - 9;
    var by = r.top - 9;
    // Keep the badge on screen even if the element hugs an edge.
    bx = Math.max(2, Math.min(bx, window.innerWidth - 20));
    by = Math.max(2, Math.min(by, window.innerHeight - 20));
    m.badge.style.left = bx + "px";
    m.badge.style.top = by + "px";

    if (!m.popover.hidden) {
      var pw = m.popover.offsetWidth || 288;
      var px = Math.min(bx, window.innerWidth - pw - 8);
      px = Math.max(8, px);
      var py = by + 24;
      var ph = m.popover.offsetHeight || 0;
      if (py + ph > window.innerHeight - 8) {
        py = Math.max(8, by - ph - 8);
      }
      m.popover.style.left = px + "px";
      m.popover.style.top = py + "px";
    }
  }

  function tick() {
    for (var i = 0; i < state.markers.length; i++) {
      positionMarker(state.markers[i]);
    }
    state.rafId = requestAnimationFrame(tick);
  }

  function render(flags) {
    clear();
    ensureLayer();
    (flags || []).forEach(function (flag) {
      var m = makeMarker(flag);
      if (m) state.markers.push(m);
    });
    if (state.markers.length) {
      tick();
    }
  }

  // Close an open popover when clicking elsewhere on the page.
  document.addEventListener("click", function (ev) {
    if (!state.openPopover) return;
    var t = ev.target;
    if (!(t instanceof Element)) { t = t && t.parentElement; }
    if (t && (t.closest(".tc-popover") || t.closest(".tc-badge"))) return;
    state.openPopover.hidden = true;
    state.openPopover = null;
  }, true);

  window.__trueclickOverlay = { render: render, clear: clear };
})();
