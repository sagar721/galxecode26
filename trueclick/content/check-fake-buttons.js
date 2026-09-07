/*
 * TrueClick — Check 2 (Layer A): dismiss controls that do something else
 *
 * Layer A only inspects static markup: element type, inline onclick attribute
 * text, href, and enclosing <form>. It does NOT observe addEventListener-bound
 * handlers — that's Layer B (a MAIN-world injected script), a later task.
 *
 * Exposes window.__trueclickCheckFakeButtons(root).
 *
 * Flag shape:
 *   { id, type: "button", element, label, claim, reality, confidence, evidence }
 */
(function () {
  "use strict";

  // Visible text that reads as "close / dismiss this".
  var DISMISS_TEXT = ["×", "x", "✕", "cancel", "no thanks", "not now", "dismiss", "skip"];
  // Attribute hints that an element is a close control.
  var DISMISS_ATTR_HINTS = ["close", "dismiss", "modal-close"];

  // href substrings that mean "this actually starts a transaction".
  var COMMIT_HREF = ["checkout", "payment", "subscribe", "billing", "pay"];
  // onclick-text substrings that mean "this actually submits / navigates / pays".
  var COMMIT_ONCLICK = ["submit", "checkout", "location.href", ".pay("];

  function visibleText(el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function attr(el, name) {
    var v = el.getAttribute(name);
    return v == null ? "" : v;
  }

  function looksLikeDismiss(el) {
    var t = visibleText(el).toLowerCase();
    if (DISMISS_TEXT.indexOf(t) !== -1) return true;

    var hay = (
      attr(el, "class") + " " +
      attr(el, "id") + " " +
      attr(el, "aria-label")
    ).toLowerCase();
    return DISMISS_ATTR_HINTS.some(function (h) {
      return hay.indexOf(h) !== -1;
    });
  }

  function containsAny(haystack, needles) {
    var low = String(haystack).toLowerCase();
    for (var i = 0; i < needles.length; i++) {
      if (low.indexOf(needles[i]) !== -1) return needles[i];
    }
    return null;
  }

  function checkFakeButtons(root) {
    root = root || document;
    var flags = [];
    var counter = 0;

    // Candidate set: buttons, links, inputs, and role/aria close controls.
    var candidates = root.querySelectorAll(
      'button, a, input, [role="button"], [aria-label], [class*="close" i], [id*="close" i], [class*="dismiss" i], [id*="dismiss" i]'
    );

    var seen = new Set();
    candidates.forEach(function (el) {
      if (seen.has(el)) return;
      seen.add(el);
      if (!looksLikeDismiss(el)) return;

      var tag = el.tagName.toLowerCase();
      var onclick = attr(el, "onclick");
      var typeAttr = (attr(el, "type") || "").toLowerCase();
      var href = attr(el, "href");
      var inForm = !!el.closest("form");
      var reasons = [];
      var evidenceBits = [];

      // Rule a: submit control, or inside a form with an onclick that submits.
      // A bare <button> with no explicit "type" defaults to type="submit" per
      // the HTML spec, so inside a <form> it submits even with no handler.
      var explicitSubmit =
        (tag === "button" || tag === "input") && typeAttr === "submit";
      var implicitSubmit =
        tag === "button" && !el.hasAttribute("type") && inForm;
      var onclickSubmit = inForm && onclick.indexOf(".submit(") !== -1;

      if (explicitSubmit || implicitSubmit || onclickSubmit) {
        reasons.push("acts as a form submit");
        if (explicitSubmit) {
          evidenceBits.push('type="submit"');
        } else if (implicitSubmit) {
          evidenceBits.push(
            '<button> inside <form> with no explicit type — defaults to type="submit"'
          );
        } else if (inForm) {
          evidenceBits.push("inside <form>");
        }
        if (onclick.indexOf(".submit(") !== -1) {
          evidenceBits.push("onclick: " + onclick);
        }
      }

      // Rule b: link/click-target whose href commits a transaction.
      var hrefHit = href ? containsAny(href, COMMIT_HREF) : null;
      if (hrefHit) {
        reasons.push('navigates to a "' + hrefHit + '" URL');
        evidenceBits.push("href: " + href);
      }

      // Rule c: inline onclick that submits / navigates / pays.
      var onclickHit = onclick ? containsAny(onclick, COMMIT_ONCLICK) : null;
      if (onclickHit) {
        reasons.push('inline onclick runs "' + onclickHit + '"');
        evidenceBits.push("onclick: " + onclick);
      }

      if (!reasons.length) return;

      var text = visibleText(el) || attr(el, "aria-label") || "(no text)";
      flags.push({
        id: "button-" + (counter++),
        type: "button",
        element: el,
        label: "Dismiss control does more than dismiss",
        claim: 'Looks like a close / "' + text + '" control',
        reality: "Actually " + reasons.join(" and "),
        confidence: "high",
        evidence: evidenceBits.join("\n")
      });
    });

    return flags;
  }

  window.__trueclickCheckFakeButtons = checkFakeButtons;
})();
