/**
 * TrueClick — full manual-checklist automation.
 *
 * Launches headed Chromium with the real unpacked extension
 * (--load-extension / --disable-extensions-except), then runs the checklist
 * end to end against a locally-served copy of trueclick/ and one live page.
 *
 * Run:  cd tests && npm install && npx playwright install chromium && npm test
 *
 * Serial, single shared context. Setup (context, service worker, local server,
 * the test-page tab) lives in beforeAll so every numbered test can rely on it.
 */
import { test, expect, chromium } from "@playwright/test";
import type { BrowserContext, Worker, Page, Request } from "@playwright/test";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import type { AddressInfo } from "node:net";

const EXT_DIR = path.resolve(__dirname, "..", "trueclick");
const SHOT_DIR = path.join(__dirname, "test-results", "shots");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const saveShot = (name: string, body: Buffer) => fs.writeFileSync(path.join(SHOT_DIR, name), body);

// ---------------------------------------------------------------------------
// shared state
// ---------------------------------------------------------------------------
let context: BrowserContext;
let sw: Worker;
let extId = "";
let server: { url: string; close: () => Promise<void> };
let testPageUrl = "";
let testPage: Page;
let popupPage: Page | undefined;

const testPageConsoleErrors: string[] = [];
const swConsole: string[] = [];

// requests, tagged by origin, for the network audit (item 6)
type Req = { url: string; method: string; type: string };
const testPageReqs: Req[] = [];
const swReqs: Req[] = [];
const popupReqs: Req[] = [];
const allContextReqs: Array<Req & { fromSW: boolean; frame: string | null }> = [];

const isRemote = (u: string) =>
  /^https?:\/\//i.test(u) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(u);

// ---------------------------------------------------------------------------
// static server for trueclick/ (content scripts don't inject on file://)
// ---------------------------------------------------------------------------
function startServer(root: string) {
  const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".json": "application/json",
    ".woff2": "font/woff2",
  };
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || "/").split("?")[0]);
    if (rel === "/favicon.ico") {
      res.statusCode = 204;
      return res.end();
    }
    const fp = path.join(root, rel === "/" ? "/test-page.html" : rel);
    if (!fp.startsWith(root)) {
      res.statusCode = 403;
      return res.end("forbidden");
    }
    fs.readFile(fp, (err, buf) => {
      if (err) {
        res.statusCode = 404;
        return res.end("not found");
      }
      res.setHeader("content-type", mime[path.extname(fp)] || "application/octet-stream");
      res.end(buf);
    });
  });
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => srv.close(() => r())),
      });
    });
  });
}

// in-page marker probe — mirrors overlay.js geometry
function markerProbe() {
  (window as unknown as Record<string, unknown>).__tcFlagged = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return { found: false };
    const layer = document.getElementById("tc-overlay-layer");
    const outlines = layer ? Array.from(layer.querySelectorAll(".tc-outline")) : [];
    const badges = layer ? Array.from(layer.querySelectorAll(".tc-badge")) : [];
    const er = el.getBoundingClientRect();
    const near = (a: number, b: number, t = 8) => Math.abs(a - b) <= t;
    const byBadge = badges.some((b) => {
      const br = b.getBoundingClientRect();
      return br.width > 0 && near(br.left + 9, er.right, 10) && near(br.top + 9, er.top, 12);
    });
    const byOutline = outlines.some((o) => {
      const or = o.getBoundingClientRect();
      return (
        or.width > 0 &&
        near(or.left + 2, er.left) &&
        near(or.top + 2, er.top) &&
        near(or.width - 4, er.width, 12)
      );
    });
    return { found: true, flagged: byBadge || byOutline, byBadge, byOutline };
  };
}

function tagReqs(page: Page, sink: Req[]) {
  page.on("request", (r: Request) => {
    sink.push({ url: r.url(), method: r.method(), type: r.resourceType() });
  });
}

test.beforeAll(async () => {
  server = await startServer(EXT_DIR);
  testPageUrl = `${server.url}/test-page.html`;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-e2e-"));
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  });

  context.on("request", (r: Request) => {
    let frame: string | null = null;
    try {
      frame = r.frame() ? r.frame().url() : null;
    } catch {
      frame = null;
    }
    const rec = {
      url: r.url(),
      method: r.method(),
      type: r.resourceType(),
      fromSW: !!r.serviceWorker(),
      frame,
    };
    allContextReqs.push(rec);
    if (rec.fromSW) swReqs.push(rec);
  });

  sw =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker", { timeout: 20_000 }));
  sw.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") swConsole.push(`[${m.type()}] ${m.text()}`);
  });
  extId = new URL(sw.url()).host;

  // open + settle the test page
  testPage = await context.newPage();
  testPage.on("console", (m) => {
    if (m.type() === "error") testPageConsoleErrors.push(m.text());
  });
  testPage.on("pageerror", (e) => testPageConsoleErrors.push(`pageerror: ${e.message}`));
  tagReqs(testPage, testPageReqs);

  await testPage.goto(testPageUrl, { waitUntil: "load" });
  // content scripts (document_idle) + Check 3's 3s re-read + overlay render
  await testPage.waitForTimeout(5000);
});

test.afterAll(async () => {
  await context?.close();
  await server?.close();
});

// ---------------------------------------------------------------------------
test("1. test-page loads, zero console errors", async () => {
  console.log("extension id:", extId);
  console.log("service-worker console (errors/warnings):", swConsole);
  console.log("test-page console errors:", testPageConsoleErrors);
  expect(extId, "extension id looks like a Chrome id").toMatch(/^[a-p]{32}$/);
  expect(
    testPageConsoleErrors,
    `console errors on test page:\n${testPageConsoleErrors.join("\n")}`
  ).toEqual([]);
  expect(
    swConsole.filter((l) => l.startsWith("[error]")),
    `service-worker console errors:\n${swConsole.join("\n")}`
  ).toEqual([]);
});

// ---------------------------------------------------------------------------
test("2. planted elements flagged correctly", async () => {
  const EXPECT: Record<string, { want: boolean; desc: string }> = {
    "t-link-fake": { want: true, desc: "Check1 fake link (hdfcbank text -> example-test.com)" },
    "t-link-honest": { want: false, desc: "Check1 honest link (example.com == example.com)" },
    "t-nested-honest": { want: false, desc: "Check1 nested title+breadcrumb same domain (regression)" },
    "t-nested-fake": { want: true, desc: "Check1 nested pieces, href elsewhere" },
    "t-close-fake": { want: true, desc: "Check2 fake close (onclick -> 'payment submitted')" },
    "t-close-honest": { want: false, desc: "Check2 honest close (hides a box)" },
    "t-form-fake": { want: true, desc: "Check2 bare <button> in <form> (implicit submit)" },
    "t-form-honest": { want: false, desc: "Check2 bare <button type=button> in <form>" },
    "fake-timer": { want: true, desc: "Check3 fake timer (static 04:59)" },
    "real-timer": { want: false, desc: "Check3 honest timer (real countdown)" },
  };

  await testPage.evaluate(markerProbe);
  const results: Record<string, { found: boolean; flagged?: boolean; byBadge?: boolean; byOutline?: boolean }> = {};
  for (const id of Object.keys(EXPECT)) {
    // The overlay only renders markers for on-screen elements, so bring each
    // one into view and let the rAF reposition loop catch up before probing.
    await testPage.locator(`#${id}`).scrollIntoViewIfNeeded().catch(() => {});
    await testPage.waitForTimeout(150);
    results[id] = (await testPage.evaluate(
      (i) => (window as unknown as Record<string, (id: string) => unknown>).__tcFlagged(i),
      id
    )) as { found: boolean; flagged?: boolean };
  }

  const shot = await testPage.screenshot({ fullPage: true });
  saveShot("test-page-with-overlays.png", shot);
  await test.info().attach("test-page-with-overlays.png", { body: shot, contentType: "image/png" });

  // The overlay tracks the viewport, so a full-page stitch can miss markers for
  // rows that were off-screen at capture time. Grab per-section viewport shots
  // (scroll, let the rAF loop settle) for clean visual evidence.
  for (const [name, anchorId] of [
    ["markers-check1.png", "t-link-fake"],
    ["markers-check2.png", "t-close-fake"],
    ["markers-check3.png", "fake-timer"],
  ] as const) {
    await testPage.locator(`#${anchorId}`).scrollIntoViewIfNeeded();
    await testPage.evaluate(() => window.scrollBy(0, -120));
    await testPage.waitForTimeout(400);
    const s = await testPage.screenshot();
    saveShot(name, s);
    await test.info().attach(name, { body: s, contentType: "image/png" });
  }

  const table = Object.entries(EXPECT).map(([id, { want, desc }]) => {
    const r = results[id];
    return {
      id,
      desc,
      expected: want ? "FLAGGED" : "clean",
      got: !r.found
        ? "ELEMENT NOT FOUND"
        : r.flagged
        ? `FLAGGED (badge:${r.byBadge} outline:${r.byOutline})`
        : "clean",
      ok: r.found && r.flagged === want,
    };
  });
  console.table(table);
  const failures = table.filter((r) => !r.ok).map((r) => `${r.id} (${r.desc}): expected ${r.expected}, got ${r.got}`);
  expect(failures, `\n${failures.join("\n")}`).toEqual([]);

  console.log("NOTE: Check 2 Layer B (addEventListener detection) is not implemented — N/A this run.");
});

// ---------------------------------------------------------------------------
test("3. live search page has no false positives", async () => {
  test.setTimeout(180_000);
  const page = await context.newPage();
  const consErr: string[] = [];
  page.on("console", (m) => m.type() === "error" && consErr.push(m.text()));

  const candidates = [
    "https://www.google.com/search?q=hdhub4u&num=20&hl=en&gl=us",
    "https://duckduckgo.com/html/?q=hdhub4u",
    "https://www.bing.com/search?q=hdhub4u&setlang=en",
  ];
  let loaded = "";
  for (const url of candidates) {
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
      await page.waitForTimeout(2000);
      const anchors = await page.locator("a[href]").count();
      const html = await page.content();
      const walled = /unusual traffic|detected unusual|not a robot|why did this happen|recaptcha|consent\.google/i.test(html);
      console.log(`try ${url}: status=${resp?.status()} anchors=${anchors} walled=${walled}`);
      if (resp && resp.status() < 400 && anchors > 8 && !walled) {
        loaded = url;
        break;
      }
    } catch (e) {
      console.log(`try ${url}: ${(e as Error).message}`);
    }
  }
  test.skip(!loaded, "no search engine reachable without a bot wall from this environment");
  console.log("LIVE PAGE USED:", loaded);

  await page.waitForTimeout(4500); // content scripts + overlay + 3s timer window
  await page.evaluate(markerProbe);

  const analysis = await page.evaluate(() => {
    function reg(host: string) {
      host = (host || "").toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
      const l = host.split(".").filter(Boolean);
      return l.length <= 2 ? l.join(".") : l.slice(-2).join(".");
    }
    // compact mirror of resolveRealDestination() from check-links.js
    const REDIRECTORS = ["google.com", "bing.com", "duckduckgo.com", "facebook.com", "t.co", "linkedin.com"];
    const PARAMS = ["url", "uddg", "u", "q", "imgrefurl"];
    function resolveDest(absHref: string) {
      let u: URL;
      try { u = new URL(absHref); } catch { return { registrable: "", via: false }; }
      let dom = reg(u.hostname);
      if (!REDIRECTORS.includes(dom)) return { registrable: dom, via: false };
      for (const p of PARAMS) {
        const raw = u.searchParams.get(p);
        if (!raw) continue;
        for (const v of [raw, (() => { try { return decodeURIComponent(raw); } catch { return raw; } })()]) {
          let s = String(v).trim();
          if (s.startsWith("//")) s = "https:" + s;
          try {
            const inner = new URL(s);
            if (/^https?:$/.test(inner.protocol)) return { registrable: reg(inner.hostname), via: true };
          } catch { /* not a url */ }
        }
      }
      return { registrable: dom, via: false };
    }
    const DOMAIN = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi;
    const layer = document.getElementById("tc-overlay-layer");
    const badges = layer ? Array.from(layer.querySelectorAll(".tc-badge")) : [];
    const near = (a: number, b: number, t = 12) => Math.abs(a - b) <= t;
    const rows: Array<{
      text: string; hrefHost: string; resolvedDomain: string; viaRedirector: boolean;
      textDomains: string[]; textAgrees: boolean; resolvedAgrees: boolean;
      flagged: boolean; hdhub: boolean;
    }> = [];
    for (const a of Array.from(document.querySelectorAll("a[href]"))) {
      const el = a as HTMLAnchorElement;
      let proto = "";
      try { proto = new URL(el.href).protocol; } catch { continue; }
      if (!/^https?:$/.test(proto)) continue;
      const er = el.getBoundingClientRect();
      if (er.width === 0 || er.height === 0) continue;
      const text = ((el as HTMLElement).innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const hrefHost = reg(new URL(el.href).hostname);
      const dest = resolveDest(el.href);
      const textDomains = Array.from(new Set(Array.from(text.matchAll(DOMAIN), (m) => reg(m[0])).filter(Boolean)));
      const flagged = badges.some((b) => {
        const br = b.getBoundingClientRect();
        return br.width > 0 && near(br.left + 9, er.right) && near(br.top + 9, er.top);
      });
      rows.push({
        text: text.slice(0, 90),
        hrefHost,
        resolvedDomain: dest.registrable,
        viaRedirector: dest.via,
        textDomains,
        textAgrees: textDomains.length > 0 && textDomains.includes(hrefHost),
        resolvedAgrees: textDomains.length > 0 && textDomains.includes(dest.registrable),
        flagged,
        hdhub: /hdhub4u/i.test(text) || /hdhub4u/i.test(el.href),
      });
    }
    return {
      totalScanned: rows.length,
      flaggedCount: rows.filter((r) => r.flagged).length,
      redirectorRows: rows.filter((r) => r.viaRedirector),
      // flagged despite the visible domain matching the real destination (direct
      // OR decoded through a redirector) => a genuine false positive
      falsePositives: rows.filter((r) => r.flagged && (r.textAgrees || r.resolvedAgrees)),
      flaggedRows: rows.filter((r) => r.flagged),
      hdhubRows: rows.filter((r) => r.hdhub),
    };
  });

  console.log("live-page analysis:", JSON.stringify(analysis, null, 2));
  const shot = await page.screenshot({ fullPage: false });
  saveShot("live-page.png", shot);
  await test.info().attach("live-page.png", { body: shot, contentType: "image/png" });

  // extension-originated console errors only (third-party page noise ignored)
  const ours = consErr.filter((e) => /trueclick|tc-overlay|check-/i.test(e));
  expect(ours, `TrueClick console errors on live page:\n${ours.join("\n")}`).toEqual([]);

  // No link whose visible domain matches its real destination — resolving
  // through the search engine's tracking redirect — may be flagged.
  expect(
    analysis.falsePositives,
    "links whose visible domain matches their real (redirect-resolved) destination were still flagged:\n" +
      JSON.stringify(analysis.falsePositives, null, 2)
  ).toEqual([]);

  // The specific regression: redirector-wrapped results (e.g. DuckDuckGo
  // /l/?uddg=) whose decoded destination matches the visible text must be clean.
  const brokenRedirects = analysis.redirectorRows.filter((r) => r.resolvedAgrees && r.flagged);
  expect(
    brokenRedirects,
    "redirect-wrapped links resolving to the domain shown in their text were flagged:\n" +
      JSON.stringify(brokenRedirects, null, 2)
  ).toEqual([]);

  // And no hdhub4u result whose text domain matches its real destination.
  expect(
    analysis.hdhubRows.filter((r) => r.flagged && (r.textAgrees || r.resolvedAgrees)),
    "hdhub4u result flagged despite matching its real destination"
  ).toEqual([]);

  await page.close();
});

// ---------------------------------------------------------------------------
test("4. popup shows the right count + list", async () => {
  const tabs = (await sw.evaluate(async () => {
    const list = await chrome.tabs.query({});
    return list.map((t) => ({ id: t.id, url: t.url || "", active: t.active }));
  })) as Array<{ id: number; url: string; active: boolean }>;
  console.log("tabs seen by service worker:", JSON.stringify(tabs, null, 2));

  const match =
    tabs.find((t) => t.url.includes("test-page.html")) ||
    tabs.find((t) => /^https?:\/\/(127\.0\.0\.1|localhost)/.test(t.url));
  expect(match, "found the test-page tab via the service worker").toBeTruthy();
  const tabId = match!.id;

  popupPage = await context.newPage();
  tagReqs(popupPage, popupReqs);
  await popupPage.goto(`chrome-extension://${extId}/popup/popup.html?tabId=${tabId}`);
  await popupPage.waitForSelector("#state-flags:not([hidden])", { timeout: 8000 });

  const summary = (await popupPage.textContent("#flags-summary"))?.trim();
  const rows = await popupPage.$$eval("#flags-list .tc-row", (els) =>
    els.map((el) => ({
      label: el.querySelector(".tc-row-label")?.textContent?.trim() || "",
      meta: el.querySelector(".tc-row-meta")?.textContent?.trim() || "",
      sentence: el.querySelector(".tc-row-sentence")?.textContent?.replace(/\s+/g, " ").trim() || "",
    }))
  );
  console.log("popup summary:", summary);
  console.table(rows);
  const shot = await popupPage.screenshot();
  saveShot("popup-light.png", shot);
  await test.info().attach("popup-light.png", { body: shot, contentType: "image/png" });

  expect(summary).toBe("5 mismatches flagged");
  expect(rows.length).toBe(5);
  expect(rows.map((r) => r.meta.split("·")[0].trim()).sort()).toEqual([
    "button",
    "button",
    "link",
    "link",
    "timer",
  ]);
  expect(rows[0].meta, "high-confidence rows first").toContain("high");
});

// ---------------------------------------------------------------------------
test("5. popup dark mode re-renders legibly", async () => {
  if (!popupPage) {
    const tabs = (await sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => ({ id: t.id, url: t.url || "" })))) as Array<{ id: number; url: string }>;
    const m = tabs.find((t) => t.url.includes("test-page.html")) || tabs.find((t) => /127\.0\.0\.1|localhost/.test(t.url));
    popupPage = await context.newPage();
    tagReqs(popupPage, popupReqs);
    await popupPage.goto(`chrome-extension://${extId}/popup/popup.html?tabId=${m!.id}`);
  }
  await popupPage.emulateMedia({ colorScheme: "dark" });
  await popupPage.reload();
  await popupPage.waitForSelector(
    "#state-flags:not([hidden]), #state-clean:not([hidden]), #state-blocked:not([hidden])"
  );

  const c = await popupPage.evaluate(() => {
    const body = getComputedStyle(document.body);
    const wm = document.querySelector(".tc-wordmark");
    const row = document.querySelector(".tc-row-label");
    return {
      bg: body.backgroundColor,
      fg: body.color,
      wordmark: wm ? getComputedStyle(wm).color : null,
      rowText: row ? getComputedStyle(row).color : null,
    };
  });
  const rgb = (s: string) => (s.match(/[\d.]+/g) || []).map(Number);
  const relLum = (s: string) => {
    const lin = rgb(s)
      .slice(0, 3)
      .map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [relLum(a) + 0.05, relLum(b) + 0.05].sort((x, y) => y - x);
    return hi / lo;
  };
  console.log("dark-mode computed colors:", c);
  console.log("body bg/fg contrast:", ratio(c.bg, c.fg).toFixed(2));

  const shot = await popupPage.screenshot();
  saveShot("popup-dark.png", shot);
  await test.info().attach("popup-dark.png", { body: shot, contentType: "image/png" });

  expect(c.bg, "dark --tc-paper token applied to body").toBe("rgb(20, 24, 31)");
  expect(c.fg).not.toBe(c.bg);
  expect(relLum(c.bg), "background is dark").toBeLessThan(0.05);
  expect(relLum(c.fg), "text is light").toBeGreaterThan(0.6);
  expect(ratio(c.bg, c.fg), "body text contrast >= WCAG AA 4.5:1").toBeGreaterThan(4.5);
});

// ---------------------------------------------------------------------------
test("6. extension makes zero network calls", async () => {
  const remoteFrom = (arr: Req[]) => arr.filter((r) => isRemote(r.url));
  const allRemoteHosts = Array.from(
    new Set(allContextReqs.filter((r) => isRemote(r.url)).map((r) => new URL(r.url).host))
  );

  console.log("=== network audit ===");
  console.log(`total context requests recorded: ${allContextReqs.length}`);
  console.log(`test-page tab requests: ${testPageReqs.length}`, JSON.stringify(testPageReqs, null, 2));
  console.log(`service-worker requests: ${swReqs.length}`, JSON.stringify(swReqs, null, 2));
  console.log(`popup requests: ${popupReqs.length}`, JSON.stringify(popupReqs, null, 2));
  console.log("all remote hosts seen anywhere in the context:", allRemoteHosts);

  // test-page.html has zero external resources, so ANY remote request from that
  // tab could only come from an injected content script.
  expect(
    remoteFrom(testPageReqs),
    "the content scripts made remote request(s) from the test page"
  ).toEqual([]);
  expect(remoteFrom(swReqs), "the background service worker made remote request(s)").toEqual([]);
  expect(remoteFrom(popupReqs), "the popup made remote request(s)").toEqual([]);

  // belt-and-suspenders: nothing SW-originated hit the network at all
  expect(
    allContextReqs.filter((r) => r.fromSW && isRemote(r.url)),
    "SW-originated remote requests (context-wide)"
  ).toEqual([]);
});

// ---------------------------------------------------------------------------
// 7. unit: resolveRealDestination() sees through tracking redirectors
//    (pure function, no browser — require()'d straight from the extension)
// ---------------------------------------------------------------------------
test("7. resolveRealDestination unwraps redirector links", async () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { resolveRealDestination } = require("../trueclick/content/check-links.js") as {
    resolveRealDestination: (href: string, base?: string) => { registrable: string; target: string; viaRedirector: boolean };
  };
  const PAGE_BASE = "https://html.duckduckgo.com/html/?q=hdhub4u";

  const cases: Array<[string, string, string | undefined, string, boolean]> = [
    ["direct link is untouched", "https://example.com/pricing", undefined, "example.com", false],
    [
      "DuckDuckGo /l/?uddg= decodes to the real destination (agrees -> no flag)",
      "https://duckduckgo.com/l/?uddg=" + encodeURIComponent("https://hdhub4u.gd/movies") + "&rut=x",
      undefined,
      "hdhub4u.gd",
      true,
    ],
    [
      "protocol-relative //duckduckgo.com/l/ resolves against the page base",
      "//duckduckgo.com/l/?uddg=" + encodeURIComponent("https://hdhub4u.town/"),
      PAGE_BASE,
      "hdhub4u.town",
      true,
    ],
    [
      "Google /url?q= wrapper",
      "https://www.google.com/url?q=https://nytimes.com/x&sa=U",
      undefined,
      "nytimes.com",
      true,
    ],
    [
      "redirector wrapping a genuine phish still disagrees with the text (SHOULD flag)",
      "https://duckduckgo.com/l/?uddg=" + encodeURIComponent("https://paypa1-secure.example-test.com/login"),
      undefined,
      "example-test.com",
      true,
    ],
    [
      "redirector with no decodable destination falls back to the redirector domain",
      "https://www.bing.com/ck/a?!&&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbQ&ntb=1",
      undefined,
      "bing.com",
      false,
    ],
    [
      "a real Google search URL (?q=<terms>) is not treated as a redirect",
      "https://www.google.com/search?q=hdhub4u",
      undefined,
      "google.com",
      false,
    ],
  ];

  const failures: string[] = [];
  for (const [name, href, base, wantDomain, wantVia] of cases) {
    const r = resolveRealDestination(href, base);
    if (r.registrable !== wantDomain || r.viaRedirector !== wantVia) {
      failures.push(
        `${name}\n   got ${JSON.stringify({ registrable: r.registrable, viaRedirector: r.viaRedirector })}` +
          ` want { registrable: '${wantDomain}', viaRedirector: ${wantVia} }`
      );
    }
  }
  expect(failures, `\n${failures.join("\n")}`).toEqual([]);

  // the redirector-wrapped phish, run through the visible-text comparison,
  // must still be a mismatch
  const phish = resolveRealDestination(
    "https://duckduckgo.com/l/?uddg=" + encodeURIComponent("https://paypa1-secure.example-test.com/x")
  );
  expect(["paypal.com"].includes(phish.registrable), "phish must NOT read as paypal.com").toBe(false);
});
