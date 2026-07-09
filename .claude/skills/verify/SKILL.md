---
name: verify
description: Build/launch/drive recipe for verifying vista changes at the running app (Quick Room UI + generate API), learned 2026-07-08.
---

# Verifying vista changes end-to-end

## Launch
- `npm run dev` from `vista/` (port 3003). Ready when `curl -s -o /dev/null -w "%{http_code}" http://localhost:3003/quick` returns 200.
- `.env.local` points `NEXT_PUBLIC_API_URL` at prod `https://api.tunzone.com/api` — page and API routes work locally without the Laravel backend running.

## Drive the UI (headless)
- No playwright in vista's deps, but the browser cache exists. In a scratch dir: `npm i playwright-core`, then launch with
  `executablePath: ~/Library/Caches/ms-playwright/chromium_headless_shell-<rev>/chrome-headless-shell-mac-arm64/chrome-headless-shell` (check `ls ~/Library/Caches/ms-playwright`).
- Default locale is **hy**. To test a locale, set cookie `vista_locale=<en|ru|hy>` AND `addInitScript` `localStorage.setItem("vista-locale", l)` before `goto`.
- Quick Room panels (Products to use / Design inspiration) are on `/quick`, below the style chips — client-rendered, absent from SSR curl HTML; use the browser.

## Drive the generate API directly
- Anonymous auth: `POST https://api.tunzone.com/api/tokens/anonymous/grant` with header `X-Vista-Device-Id: <fresh UUID>` (non-UUID ids return `granted:false`). Then send the same header to local routes.
- Brief-only probe (one Claude call, no image render, no token consume):
  `curl -X POST http://localhost:3003/api/interior-design/generate -H "X-Vista-Device-Id: $DEVICE" -F phase=brief -F "textPrompt=..." -F style=modern -F countryCode=AM -F searchMode=local -F quickRoomMode=true -F designMode=made -F tokenAction=generate [-F "inspirationImages=@photo.jpg;type=image/jpeg" -F "inspirationLabels=..."]`
- Evidence lives in the JSON `debug.steps` and the dev-server log's `[catalog-trace] 1_backend_slots` line (shows the attempted slot list).

## Gotchas
- **Known env failure:** from local dev, backend `resolve-slots` returns 0 Qdrant candidates for every slot → brief 422 "Could not match catalog products". Environmental, not a regression — always run a control request and compare traces, don't judge by status code.
- Full `tsc` has ~70 pre-existing errors; don't use as a signal.
- `npm test` runs the node:test specs via tsx (~350 tests, fast).
