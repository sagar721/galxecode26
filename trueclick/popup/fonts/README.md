# Bundled fonts

These `.woff2` files are committed and referenced by `popup/popup.css`
(`@font-face` `src`). All are SIL Open Font License — redistributable with the
extension. They are the `latin` subset only (the popup UI is English).

| File | Family / weight | Upstream |
|---|---|---|
| `IBMPlexSans-Regular.woff2`  | IBM Plex Sans 400 | https://github.com/IBM/plex (OFL) |
| `IBMPlexSans-Medium.woff2`   | IBM Plex Sans 500 | same |
| `IBMPlexSans-SemiBold.woff2` | IBM Plex Sans 600 | same |
| `IBMPlexMono-Regular.woff2`  | IBM Plex Mono 400 | same |
| `IBMPlexMono-Medium.woff2`   | IBM Plex Mono 500 | same |
| `Fraunces-SemiBold.woff2`    | Fraunces 600 (wordmark only) | https://github.com/undercasetype/Fraunces (OFL) |

Fetched from the Bunny Fonts static mirror (`https://fonts.bunny.net/<family>/files/<family>-latin-<weight>-normal.woff2`),
which repackages the upstream OFL fonts. Re-download from there or from the
upstream repos if you need to regenerate.

Do **not** switch to a `<link>` to Google Fonts: MV3's content-security-policy
can block the remote fetch, and the whole product is meant to work with no
network. Keep the files local.
