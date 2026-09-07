/*
 * TrueClick — Check 1: link text vs. real destination
 *
 * Exposes window.__trueclickCheckLinks(root) which returns an array of flag
 * objects. content.js calls it after all check files have loaded.
 *
 * Flag shape:
 *   { id, type: "link", element, label, claim, reality, confidence, evidence }
 */
(function () {
  "use strict";

  // Words/phrases that impersonate a trusted destination without naming a domain.
  var IMPERSONATION_PHRASES = [
    "your bank",
    "verify your account",
    "login to your account",
    "confirm your identity",
    "official site",
    "secure checkout",
    "reset your password"
  ];

  // Matches a bare domain-looking token, e.g. "www.hdfcbank.com" or "paypal.co".
  var DOMAIN_IN_TEXT = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/i;

  /*
   * Simplified registrable-domain approximation: strip a leading "www." and
   * return the last two labels ("a.b.hdfcbank.com" -> "hdfcbank.com").
   * NOTE: this is NOT a real Public Suffix List implementation — multi-part
   * TLDs like "co.uk" will collapse to "co.uk". Acceptable for the demo scope.
   */
  function getRegistrableDomain(hostname) {
    if (!hostname) return "";
    hostname = String(hostname).toLowerCase().trim();
    hostname = hostname.replace(/\.$/, "");        // trailing dot
    hostname = hostname.replace(/^www\./, "");     // common www prefix
    var labels = hostname.split(".").filter(Boolean);
    if (labels.length <= 2) return labels.join(".");
    return labels.slice(-2).join(".");
  }

  function visibleText(el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(el) {
    // offsetParent is null for display:none elements and for position:fixed;
    // the fixed case is rare for links, and a bounding-box fallback covers it.
    if (el.offsetParent !== null) return true;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function hostnameFromHref(href, base) {
    try {
      return new URL(href, base || document.baseURI).hostname;
    } catch (e) {
      return "";
    }
  }

  function checkLinks(root) {
    root = root || document;
    var flags = [];
    var anchors = root.querySelectorAll('a[href]');
    var pageDomain = getRegistrableDomain(location.hostname);
    var counter = 0;

    anchors.forEach(function (a) {
      var href = a.getAttribute("href") || "";
      if (!href.trim()) return;
      // Skip in-page and non-navigational schemes.
      if (/^(#|javascript:|mailto:|tel:|sms:)/i.test(href.trim())) return;

      var text = visibleText(a);
      if (!text) return;
      if (!isVisible(a)) return;

      var realHost = hostnameFromHref(a.href || href);
      var realDomain = getRegistrableDomain(realHost);
      if (!realDomain) return;

      var domainMatch = text.match(DOMAIN_IN_TEXT);

      // ---- Primary rule: the text shows a domain ----
      if (domainMatch) {
        var claimedRaw = domainMatch[0];
        var claimedDomain = getRegistrableDomain(claimedRaw);
        if (claimedDomain && claimedDomain !== realDomain) {
          flags.push({
            id: "link-" + (counter++),
            type: "link",
            element: a,
            label: "Link claims one site, points to another",
            claim: "Text shows " + claimedDomain,
            reality: "Link goes to " + realDomain,
            confidence: "high",
            evidence:
              'link text: "' + text + '"\n' +
              "claimed domain: " + claimedDomain + "\n" +
              "actual href: " + (a.href || href) + "\n" +
              "actual domain: " + realDomain
          });
        }
        return;
      }

      // ---- Secondary rule: trust-word text, off-site destination ----
      var lowerText = text.toLowerCase();
      var phrase = IMPERSONATION_PHRASES.find(function (p) {
        return lowerText.indexOf(p) !== -1;
      });
      if (phrase && pageDomain && realDomain !== pageDomain) {
        flags.push({
          id: "link-" + (counter++),
          type: "link",
          element: a,
          label: "Trust-wording link leaves this site",
          claim: 'Text says "' + phrase + '"',
          reality: "Link goes off-site to " + realDomain,
          confidence: "medium",
          evidence:
            'link text: "' + text + '"\n' +
            "matched phrase: " + phrase + "\n" +
            "page domain: " + pageDomain + "\n" +
            "actual href: " + (a.href || href) + "\n" +
            "actual domain: " + realDomain
        });
      }
    });

    return flags;
  }

  window.__trueclickGetRegistrableDomain = getRegistrableDomain;
  window.__trueclickCheckLinks = checkLinks;
})();
