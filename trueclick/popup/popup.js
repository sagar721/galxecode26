/*
 * TrueClick — popup
 *
 * Reads the current tab's flags (from the background cache, with a direct
 * content-script query as a fresher fallback) and renders one of four states:
 * scanning -> clean | flags | blocked. No network, no storage.
 */
(function () {
  "use strict";

  var MIN_SCAN_MS = 260; // keep the "Scanning…" state visible briefly

  var els = {
    scope: document.getElementById("scope"),
    progressFill: document.getElementById("progress-fill"),
    stateScanning: document.getElementById("state-scanning"),
    stateClean: document.getElementById("state-clean"),
    stateFlags: document.getElementById("state-flags"),
    stateBlocked: document.getElementById("state-blocked"),
    summary: document.getElementById("flags-summary"),
    list: document.getElementById("flags-list")
  };

  function show(state) {
    els.stateScanning.hidden = state !== "scanning";
    els.stateClean.hidden = state !== "clean";
    els.stateFlags.hidden = state !== "flags";
    els.stateBlocked.hidden = state !== "blocked";
  }

  function startProgress() {
    // Two-step fill so it reads as motion, not a spinner.
    requestAnimationFrame(function () {
      els.progressFill.style.width = "62%";
      setTimeout(function () { els.progressFill.style.width = "100%"; }, 180);
    });
  }

  function confidenceRank(c) {
    return c === "high" ? 0 : c === "medium" ? 1 : 2;
  }

  function makeRow(flag) {
    var li = document.createElement("li");
    li.className = "tc-row";

    var top = document.createElement("div");
    top.className = "tc-row-top";

    var dot = document.createElement("span");
    dot.className = "tc-dot";
    dot.setAttribute("data-confidence", flag.confidence || "high");
    dot.setAttribute("aria-hidden", "true");

    var body = document.createElement("div");
    body.className = "tc-row-body";

    var label = document.createElement("p");
    label.className = "tc-row-label";
    label.textContent = flag.label;

    var meta = document.createElement("p");
    meta.className = "tc-row-meta";
    meta.textContent = (flag.type || "check") + " · " + (flag.confidence || "high") + " confidence";

    var sentence = document.createElement("p");
    sentence.className = "tc-row-sentence";
    var claim = document.createElement("span");
    claim.textContent = flag.claim;
    var arrow = document.createElement("span");
    arrow.className = "tc-arrow";
    arrow.textContent = "→"; // ->
    var reality = document.createElement("span");
    reality.textContent = flag.reality;
    sentence.appendChild(claim);
    sentence.appendChild(arrow);
    sentence.appendChild(reality);

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "tc-proof-toggle";
    toggle.textContent = "Show proof";
    toggle.setAttribute("aria-expanded", "false");

    var proof = document.createElement("pre");
    proof.className = "tc-proof";
    proof.hidden = true;
    proof.textContent = flag.evidence || "(no evidence captured)";

    toggle.addEventListener("click", function () {
      var showIt = proof.hidden;
      proof.hidden = !showIt;
      toggle.textContent = showIt ? "Hide proof" : "Show proof";
      toggle.setAttribute("aria-expanded", String(showIt));
    });

    body.appendChild(label);
    body.appendChild(meta);
    body.appendChild(sentence);
    body.appendChild(toggle);
    body.appendChild(proof);

    top.appendChild(dot);
    top.appendChild(body);
    li.appendChild(top);
    return li;
  }

  function renderFlags(flags) {
    flags = flags.slice().sort(function (a, b) {
      return confidenceRank(a.confidence) - confidenceRank(b.confidence);
    });
    els.list.textContent = "";
    flags.forEach(function (f) { els.list.appendChild(makeRow(f)); });
    els.summary.textContent =
      flags.length + (flags.length === 1 ? " mismatch flagged" : " mismatches flagged");
    show("flags");
  }

  function render(entry) {
    var flags = (entry && entry.flags) || [];
    if (!flags.length) {
      show("clean");
    } else {
      renderFlags(flags);
    }
  }

  function isRestrictedUrl(url) {
    return !url ||
      /^(chrome|edge|about|chrome-extension|devtools|view-source):/i.test(url) ||
      /^https:\/\/chrome\.google\.com\/webstore/i.test(url) ||
      /^https:\/\/chromewebstore\.google\.com/i.test(url);
  }

  function queryContent(tabId) {
    return new Promise(function (resolve) {
      try {
        chrome.tabs.sendMessage(tabId, { type: "TC_GET_FLAGS" }, function (resp) {
          if (chrome.runtime.lastError || !resp) { resolve(null); return; }
          resolve(resp);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function queryBackground(tabId) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: "TC_GET_TAB_FLAGS", tabId: tabId }, function (resp) {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(resp || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  // When the popup is opened as a normal tab (automated testing), the active
  // tab is the popup itself; ?tabId=<n> names the page to inspect instead.
  function resolveTab(cb) {
    var forced = parseInt(new URLSearchParams(location.search).get("tabId"), 10);
    if (!isNaN(forced)) {
      chrome.tabs.get(forced, function (t) {
        cb(chrome.runtime.lastError ? null : t);
      });
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      cb(tabs && tabs[0]);
    });
  }

  function init() {
    show("scanning");
    startProgress();
    var started = Date.now();

    resolveTab(function (tab) {
      var settle = function (fn) {
        var wait = Math.max(0, MIN_SCAN_MS - (Date.now() - started));
        setTimeout(fn, wait);
      };

      if (!tab || isRestrictedUrl(tab.url)) {
        settle(function () { show("blocked"); });
        return;
      }

      try {
        els.scope.textContent = new URL(tab.url).hostname || "this page";
      } catch (e) {
        els.scope.textContent = "this page";
      }

      Promise.all([queryContent(tab.id), queryBackground(tab.id)]).then(function (res) {
        var fromContent = res[0];
        var fromBg = res[1];
        var entry = fromContent || fromBg;

        if (!entry) {
          // Content script never loaded (e.g. page loaded before install).
          settle(function () { show("blocked"); });
          return;
        }
        settle(function () { render(entry); });
      });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
