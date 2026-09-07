# TrueClick

A Chrome extension (Manifest V3) that checks whether a button or link actually
does what it visually claims — and flags the gap **before** you click.

Three rule-based checks. **No AI, no external APIs, no server, no network calls.**
Everything runs locally in the browser so it demos reliably with no internet risk.

---

## The three checks

| # | Check | What it catches | Confidence |
|---|---|---|---|
| 1 | **Link text vs. destination** (`check-links.js`) | Link text shows `hdfcbank.com` but `href` goes to `hdfc-verify-account.example-test.com`. Also: trust-wording ("verify your account") that leaves the current site. | high / medium |
| 2 | **Dismiss control vs. real action** (`check-fake-buttons.js`, Layer A) | An "×" / "No thanks" that is actually a form submit, a `checkout`/`pay` link, or an inline `onclick` that submits or navigates. | high |
| 3 | **Countdown timer** (`check-timers.js`) | "Offer ends in 04:59" that never moves. Snapshots the value, waits 3s, re-reads it, checks whether it dropped by roughly 3s. | high |

Flagged elements get a 2px outline + an 18px "!" badge (added, never destructive).
Hover / click / focus the badge for a `claim → reality` popover with a **Show
proof** toggle that reveals the raw evidence string.

The toolbar popup mirrors the current tab: **Scanning → Clean / Flags found**
(plus a "can't inspect this page" state for `chrome://` etc.). The toolbar icon
shows a badge count.

---

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this `trueclick/` folder.
3. Open `test-page.html` (drag it into a tab) to see all three checks fire.

No build step. No `npm install`. Plain JS/HTML/CSS.

---

## Layout

```
trueclick/
├── manifest.json
├── background.js            service worker — badge + per-tab flag cache (in-memory)
├── content/
│   ├── check-links.js       Check 1  → window.__trueclickCheckLinks(root)
│   ├── check-fake-buttons.js Check 2 → window.__trueclickCheckFakeButtons(root)
│   ├── check-timers.js      Check 3  → window.__trueclickCheckTimers(root, cb)
│   ├── overlay.js           draws outline + badge + popover
│   ├── overlay.css
│   └── content.js           orchestrator — loaded LAST, calls the checks
├── popup/
│   ├── popup.html / popup.js / popup.css
│   └── fonts/               drop IBM Plex + Fraunces .woff2 here (see fonts/README.md)
├── icons/                   16/32/48/128 placeholder marks (+ make_icons.py)
├── test-page.html           6 planted elements: honest + deceptive of each type
└── README.md
```

**Content-script load order matters** (`manifest.json`): every `check-*.js` and
`overlay.js` must define its `window.__trueclick*` function before `content.js`
runs and calls them.

---

## State & permissions

- `chrome.storage.local` — reserved for the countdown-timer check's persistence
  (not yet needed; the 3s re-read is in-page). No other persisted state.
- `background.js` keeps an **in-memory** `tabId → flags` map for the popup; it is
  cleared on navigation and tab close.
- Permissions: `activeTab`, `scripting`, `storage`, `host_permissions: <all_urls>`.

---

## Known limits (current build)

- `getRegistrableDomain()` is a simplified last-two-labels approximation, **not**
  a Public Suffix List. Multi-part TLDs (`co.uk`) collapse imperfectly.
- Check 2 is **Layer A only** — static markup (`onclick` attribute, `href`,
  enclosing `<form>`). It does **not** see `addEventListener`-bound handlers.
  That's Layer B (a MAIN-world injected script), a separate follow-up.
- Check 3 requires urgency wording ("offer", "ends", "left", …) near the value,
  to avoid flagging ordinary times/clocks.
- One scan per page load. SPA route changes don't re-trigger a scan.
- Fonts fall back to system UI faces until the `.woff2` files are added.
