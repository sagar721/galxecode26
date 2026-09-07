/*
 * TrueClick — Check 3: fake countdown timers
 *
 * A real "offer ends in MM:SS" timer counts down. A fake one is a static string
 * dressed up as urgency. We snapshot each candidate, wait ~3s, re-read it, and
 * check whether it dropped by roughly the elapsed time.
 *
 * Async by nature — exposes:
 *   window.__trueclickCheckTimers(root, onFlags)
 * onFlags(flagsArray) is called once, after the re-read window.
 *
 * Flag shape:
 *   { id, type: "timer", element, label, claim, reality, confidence, evidence }
 */
(function () {
  "use strict";

  var RE_MMSS = /\b(\d{1,2}):(\d{2})\b/;
  var RECHECK_DELAY_MS = 3000;
  var TOLERANCE_S = 1; // ±1s around the expected drop
  var URGENCY_WORDS = /\b(left|ends?|ending|hurry|offer|remaining|expires?|deal|sale|only)\b/i;

  function textOf(el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function parseMMSS(str) {
    var m = String(str).match(RE_MMSS);
    if (!m) return null;
    var mm = parseInt(m[1], 10);
    var ss = parseInt(m[2], 10);
    if (ss > 59) return null;
    return mm * 60 + ss;
  }

  function isVisible(el) {
    if (el.offsetParent !== null) return true;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // True if this element (or a close ancestor) carries urgency wording.
  function hasUrgencyContext(el) {
    var node = el;
    for (var depth = 0; depth < 3 && node; depth++) {
      if (URGENCY_WORDS.test(node.textContent || "")) return true;
      node = node.parentElement;
    }
    return false;
  }

  // Smallest element that actually holds the MM:SS text, to avoid re-reading a
  // whole section whose other digits might change independently.
  function tightestHolder(el) {
    var current = el;
    /* eslint-disable no-constant-condition */
    while (true) {
      var childHolder = null;
      for (var i = 0; i < current.children.length; i++) {
        var c = current.children[i];
        if (RE_MMSS.test(textOf(c))) {
          childHolder = c;
          break;
        }
      }
      if (childHolder) {
        current = childHolder;
      } else {
        return current;
      }
    }
  }

  function checkTimers(root, onFlags) {
    root = root || document;
    onFlags = typeof onFlags === "function" ? onFlags : function () {};

    var candidates = [];
    var seen = new Set();
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    var node = walker.currentNode;
    // TreeWalker starts on root itself; step through every element.
    for (; node; node = walker.nextNode()) {
      if (node.nodeType !== 1) continue;
      var tag = node.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") continue;
      var t = textOf(node);
      if (!RE_MMSS.test(t)) continue;

      var holder = tightestHolder(node);
      if (seen.has(holder)) continue;
      seen.add(holder);
      if (!isVisible(holder)) continue;
      if (!hasUrgencyContext(holder)) continue;

      candidates.push({
        el: holder,
        before: parseMMSS(textOf(holder)),
        beforeText: textOf(holder),
        t0: performance.now()
      });
    }

    if (!candidates.length) {
      onFlags([]);
      return;
    }

    setTimeout(function () {
      var flags = [];
      var counter = 0;

      candidates.forEach(function (cand) {
        if (cand.before == null) return;
        if (!document.contains(cand.el)) return; // removed — can't verify

        var afterText = textOf(cand.el);
        var after = parseMMSS(afterText);
        if (after == null) return; // no longer a MM:SS value — can't verify

        var elapsedS = (performance.now() - cand.t0) / 1000;
        var drop = cand.before - after;
        var expected = elapsedS;
        var ok = Math.abs(drop - expected) <= TOLERANCE_S;

        if (ok) return; // genuine countdown

        var why;
        if (drop === 0) {
          why = "value never changed";
        } else if (drop < 0) {
          why = "value went up, not down";
        } else {
          why = "value moved by " + drop.toFixed(0) + "s over " +
            elapsedS.toFixed(1) + "s";
        }

        flags.push({
          id: "timer-" + (counter++),
          type: "timer",
          element: cand.el,
          label: "Countdown timer is not counting down",
          claim: 'Shows "' + cand.beforeText + '" as a live countdown',
          reality: "Static urgency — " + why,
          confidence: "high",
          evidence:
            "before: \"" + cand.beforeText + "\"  (" + cand.before + "s)\n" +
            "after " + elapsedS.toFixed(1) + "s: \"" + afterText + "\"  (" + after + "s)\n" +
            "expected drop: ~" + expected.toFixed(0) + "s   observed drop: " + drop + "s"
        });
      });

      onFlags(flags);
    }, RECHECK_DELAY_MS);
  }

  window.__trueclickCheckTimers = checkTimers;
})();
