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
| `3. live search page has no false positives` | Opens a real results page (Google → DuckDuckGo → Bing fallback). Resolves each result link through its tracking redirect and asserts **no** link whose visible domain matches its real destination is flagged — incl. the DuckDuckGo `/l/?uddg=` `hdhub4u` links that used to false-flag |
| `4. popup shows the right count + list` | Opens `chrome-extension://<id>/popup/popup.html?tabId=<test tab>`, checks `5 mismatches flagged`, row types, high-confidence-first order |
| `5. popup dark mode re-renders legibly` | `emulateMedia({colorScheme:'dark'})` + reload; asserts dark tokens applied and bg/fg contrast ≥ 4.5 |
| `6. extension makes zero network calls` | Records every request; asserts none originate from the service worker, the popup, or the content scripts |
| `7. resolveRealDestination unwraps redirector links` | Pure unit test (`require()`'d from `check-links.js`): DuckDuckGo/Google wrappers decode to the real domain; a redirector wrapping a phish still disagrees with the text; Bing base64 / real search URLs fall back correctly |

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
