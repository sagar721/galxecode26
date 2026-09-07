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
  // Global: a single anchor's text can legitimately contain the domain more than
  // once (title + URL breadcrumb), so we collect every match, not just the first.
  var DOMAIN_IN_TEXT = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi;

  // Search engines / social sites route every outbound link through their own
  // tracking redirect: the visible text names the real site but the href points
  // at the redirector, with the real URL sitting in a query parameter. Resolve
  // that before comparing, or every result on a search page reads as a mismatch.
  var REDIRECTOR_DOMAINS = [
    "google.com", "bing.com", "duckduckgo.com",
    "facebook.com", "t.co", "linkedin.com"
  ];
  // Parameter names these redirectors use to carry the destination URL.
  var REDIRECT_PARAMS = ["url", "uddg", "u", "q", "imgrefurl"];

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
    // Prefer innerText: it honours rendering/visibility and inserts whitespace
    // between block-level descendants, so a link that nests a title and a URL
    // breadcrumb doesn't collapse into "hdhub4u.bihdhub4u.bihttps...".
    // textContent is only a fallback for detached / non-rendering contexts.
    var raw = (typeof el.innerText === "string" && el.innerText) ||
      el.textContent || "";
    return raw.replace(/\s+/g, " ").trim();
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

  /*
   * Resolve a link's true destination, seeing through known tracking redirectors.
   *
   * Pure. Returns { registrable, target, viaRedirector }:
   *   - registrable   registrable domain to compare against (the decoded
   *                   destination when the href is a known redirector carrying
   *                   one, otherwise the href's own registrable domain)
   *   - target        the URL string that `registrable` came from
   *   - viaRedirector  true when a redirector was seen through
   *
   * Redirectors are only trusted to *relocate* the comparison target, never to
   * suppress it: a redirector wrapping a link whose decoded destination still
   * disagrees with the visible text is reported exactly like a direct mismatch
   * (redirectors are also used to launder phishing links).
   */
  function resolveRealDestination(href, base) {
    var out = { registrable: "", target: "", viaRedirector: false };
    var url;
    try {
      url = new URL(
        href,
        base || (typeof document !== "undefined" ? document.baseURI : undefined)
      );
    } catch (e) {
      return out;
    }
    out.target = url.href;
    out.registrable = getRegistrableDomain(url.hostname);

    if (REDIRECTOR_DOMAINS.indexOf(out.registrable) === -1) return out;

    for (var i = 0; i < REDIRECT_PARAMS.length; i++) {
      var raw = null;
      try {
        raw = url.searchParams.get(REDIRECT_PARAMS[i]);
      } catch (e) { /* malformed query */ }
      if (!raw) continue;

      // The value is usually already decoded by URLSearchParams; also try one
      // extra decode, and repair a protocol-relative "//host/…".
      var candidates = [raw];
      try {
        var once = decodeURIComponent(raw);
        if (once !== raw) candidates.push(once);
      } catch (e) { /* not %-encoded */ }

      for (var c = 0; c < candidates.length; c++) {
        var v = String(candidates[c]).trim();
        if (!v) continue;
        if (v.indexOf("//") === 0) v = "https:" + v;
        var inner;
        try {
          inner = new URL(v);
        } catch (e) {
          continue; // e.g. Google's ?q=<search terms>, or Bing's base64 ?u=
        }
        if (!/^https?:$/.test(inner.protocol)) continue;
        var innerDomain = getRegistrableDomain(inner.hostname);
        if (innerDomain) {
          out.registrable = innerDomain;
          out.target = inner.href;
          out.viaRedirector = true;
          return out;
        }
      }
    }
    // Known redirector but no decodable destination — fall back to flagging
    // against the redirector's own domain.
    return out;
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

      var dest = resolveRealDestination(a.href || href);
      var realDomain = dest.registrable;
      if (!realDomain) return;

      // Every domain-looking token in the text, reduced to its registrable
      // domain (deduped, order preserved). matchAll needs the /g flag and,
      // unlike a shared .exec() loop, keeps no lastIndex state on the regex.
      var claimedDomains = [];
      Array.from(text.matchAll(DOMAIN_IN_TEXT), function (m) {
        return getRegistrableDomain(m[0]);
      }).forEach(function (d) {
        if (d && claimedDomains.indexOf(d) === -1) claimedDomains.push(d);
      });

      // ---- Primary rule: the text shows one or more domains ----
      if (claimedDomains.length) {
        // Consistent if ANY candidate agrees with the real destination — other
        // unrelated or garbled tokens nearby must not override a genuine match.
        var anyAgree = claimedDomains.indexOf(realDomain) !== -1;
        if (!anyAgree) {
          var shown = claimedDomains.slice(0, 3).join(", ");
          flags.push({
            id: "link-" + (counter++),
            type: "link",
            element: a,
            label: "Link claims one site, points to another",
            claim: "Text shows " + shown,
            reality: "Link goes to " + realDomain,
            confidence: "high",
            evidence:
              'link text: "' + text + '"\n' +
              "domain(s) in text: " + claimedDomains.join(", ") + "\n" +
              "actual href: " + (a.href || href) + "\n" +
              (dest.viaRedirector
                ? "redirector resolves to: " + dest.target + "\n"
                : "") +
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
            (dest.viaRedirector
              ? "redirector resolves to: " + dest.target + "\n"
              : "") +
            "actual domain: " + realDomain
        });
      }
    });

    return flags;
  }

  if (typeof window !== "undefined") {
    window.__trueclickGetRegistrableDomain = getRegistrableDomain;
    window.__trueclickResolveRealDestination = resolveRealDestination;
    window.__trueclickCheckLinks = checkLinks;
  }

  // Node (tests only): expose the pure helpers. Harmless in the browser.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      getRegistrableDomain: getRegistrableDomain,
      resolveRealDestination: resolveRealDestination,
      checkLinks: checkLinks
    };
  }
})();
