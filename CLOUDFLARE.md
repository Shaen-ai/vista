# Cloudflare: Vista API POST 403 (challenge)

## Symptom

`POST https://vista.tunzone.com/api/*` returns **403 Forbidden** with response header `cf-mitigated: challenge`. Browser `fetch()` cannot complete an interactive challenge, so Quick Room generate and project persistence fail.

Verify:

```bash
curl -s -o /dev/null -D - -X POST https://vista.tunzone.com/api/vista/projects \
  -H 'Content-Type: application/json' -d '{}'
```

If you see `cf-mitigated: challenge`, Cloudflare is blocking API POSTs before they reach Next.js.

## Fix (Cloudflare dashboard)

1. **Security → Events** — filter host `vista.tunzone.com`, action `managed_challenge` / `403`, path `/api/`. Note which product triggered it (Bot Fight Mode, Security Level, custom WAF rule).
2. **Add a WAF custom rule** (Security → WAF → Custom rules):

   - **Expression:** `(http.host eq "vista.tunzone.com" and starts_with(http.request.uri.path, "/api/"))`
   - **Action:** Skip
   - **Skip:** Managed rules (and Bot Fight / Super Bot Fight if available on your plan)

3. **If on free plan with Bot Fight Mode only:** Bot Fight cannot be skipped per-path. Either disable Bot Fight Mode for the zone or upgrade to Super Bot Fight Mode and add an allow/skip rule for `/api/*`.

4. Re-run the curl probe — expect JSON from the app (e.g. 401/422), not HTML challenge.

## Client fallback

The Vista app detects challenge responses and shows a localized “reload the page” message (`page.cloudflareSecurityCheck`). Reloading lets the browser solve the challenge on navigation; API POSTs still need the WAF rule above.
