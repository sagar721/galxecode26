# TrueClick E2E tests

Automates the full manual test checklist for the extension: loads the real
unpacked `trueclick/` build into headed Chromium and verifies flagging, the
popup (light + dark), and — the claim we make to judges — that **nothing in the
extension makes a network call**.

Isolated from the extension: `trueclick/` still has no npm, no build. This
folder has its own `package.json` only so Playwright can run.

## Run

```bash
cd tests
npm install
npx playwright install chromium      # one-time: downloads the browser
npm test                             # runs e2e.spec.ts headed
npm run report                       # opens the HTML report (screenshots, traces)
```

## What each test covers

| Test | Checklist item |
|---|---|
| `1. test-page loads, zero console errors` | Page + content scripts + service worker load clean |
| `2. planted elements flagged correctly` | Each planted element in `test-page.html` — outline/badge present or absent as expected. Screenshot attached to the report. |
| `3. live search page has no false positives` | Opens a real results page (DuckDuckGo → Bing → Google fallback), confirms the `hdhub4u` nested-link case and every "visible domain == href domain" link is **not** flagged |
| `4. popup shows the right count + list` | Opens `chrome-extension://<id>/popup/popup.html?tabId=<test tab>`, checks `5 mismatches flagged`, row types, high-confidence-first order |
| `5. popup dark mode re-renders legibly` | `emulateMedia({colorScheme:'dark'})` + reload; asserts dark tokens applied and bg/fg contrast ≥ 4.5 |
| `6. extension makes zero network calls` | Records every request; asserts none originate from the service worker, the popup, or the content scripts |

## Notes

- **Headed only.** MV3 service workers are unreliable headless.
- The extension can't inject into `file://` without a per-extension toggle, so
  the suite serves `trueclick/` over `http://127.0.0.1:<random port>`.
- `popup.js` accepts `?tabId=<n>` so the popup can be driven as a normal tab
  (as an action popup it reads the active tab; opened directly it can't).
- Test-only `id="t-*"` attributes on the planted elements in `test-page.html`
  give the spec stable selectors.
- Check 2 "Layer B" (addEventListener-based detection) is not implemented yet;
  test 2 logs it as N/A.
