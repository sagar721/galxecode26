/*
 * TrueClick — content orchestrator (loaded last)
 *
 * Runs the three rule-based checks, draws the overlay, and reports a serialized
 * flag list to the background service worker (which drives the toolbar badge and
 * answers the popup). Everything here is local — no network, no timers beyond
 * the 3s re-read that Check 3 needs.
 */
(function () {
  "use strict";

  // chrome.* is unavailable on some restricted pages; bail quietly.
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) {
    return;
  }

  var allFlags = [];

  function confidenceRank(c) {
    return c === "high" ? 0 : c === "medium" ? 1 : 2;
  }

  function serialize(flags) {
    return flags
      .slice()
      .sort(function (a, b) {
        return confidenceRank(a.confidence) - confidenceRank(b.confidence);
      })
      .map(function (f) {
        return {
          id: f.id,
          type: f.type,
          label: f.label,
          claim: f.claim,
          reality: f.reality,
          confidence: f.confidence,
          evidence: f.evidence
        };
      });
  }

  function report() {
    var payload = serialize(allFlags);
    try {
      chrome.runtime.sendMessage({
        type: "TC_REPORT",
        count: payload.length,
        flags: payload
      });
    } catch (e) {
      // Service worker asleep or context invalidated — badge will catch up
      // on the next event; nothing user-facing to do here.
    }
  }

  function draw() {
    if (window.__trueclickOverlay) {
      window.__trueclickOverlay.render(allFlags);
    }
  }

  function runSyncChecks() {
    if (typeof window.__trueclickCheckLinks === "function") {
      try {
        allFlags = allFlags.concat(window.__trueclickCheckLinks(document));
      } catch (e) {
        console.error("[TrueClick] link check failed:", e);
      }
    }
    if (typeof window.__trueclickCheckFakeButtons === "function") {
      try {
        allFlags = allFlags.concat(window.__trueclickCheckFakeButtons(document));
      } catch (e) {
        console.error("[TrueClick] fake-button check failed:", e);
      }
    }
  }

  function runTimerCheck() {
    if (typeof window.__trueclickCheckTimers !== "function") return;
    try {
      window.__trueclickCheckTimers(document, function (timerFlags) {
        if (timerFlags && timerFlags.length) {
          allFlags = allFlags.concat(timerFlags);
          draw();
          report();
        }
      });
    } catch (e) {
      console.error("[TrueClick] timer check failed:", e);
    }
  }

  // Answer the popup's request for this tab's current flags.
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg && msg.type === "TC_GET_FLAGS") {
      sendResponse({ flags: serialize(allFlags), count: allFlags.length });
    }
    return false;
  });

  runSyncChecks();
  console.log("[TrueClick] flags after rule checks:", allFlags);
  draw();
  report();
  runTimerCheck();
})();
