# Vista — B2C AI interior design

Consumer-facing Next.js app for marketplace-backed interior design (Vega / Domus). Deploy at **https://vista.tunzone.com** (or override).

## Local development

```bash
cd vista
cp .env.example .env.local
# Set ANTHROPIC_API_KEY, GOOGLE_AI_API_KEY, NEXT_PUBLIC_API_URL (Laravel /api base)
npm install
npm run dev
```

Default dev server: **http://localhost:3003** (matches `deploy.sh` / production PM2 port).

## Production environment

`deploy.sh` syncs all keys listed in its `SYNC_KEYS` array from your local `.env.local` to the remote before build. Prod-only defaults (marked below) are forced regardless of local values.

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | Laravel API base with `/api` — forced to prod default by deploy |
| `INTERIOR_DESIGN_ADMIN_SLUG` | Storefront slug for interior metering (runtime; synced from `.env.local`) |
| `NEXT_PUBLIC_INTERIOR_ADMIN_SLUG` | Storefront slug baked at build (defaults to `demo`) |
| `ANTHROPIC_API_KEY` | Claude (creative director step) |
| `GOOGLE_AI_API_KEY` | Gemini image generation |
| `OPENAI_API_KEY` | Opening validation, floor-plan + viewpoint analysis |
| `FAL_KEY` | fal.ai render engine + fal storage uploads |
| `INTERNAL_API_KEY` | Optional; Laravel internal usage consume endpoint |
| `REDIS_URL` | Full Project SSE state (defaults to `redis://127.0.0.1:6379`) |
| `LARAVEL_API_URL` | Server-to-Laravel base — forced to prod default by deploy |
| `LARAVEL_API_ORIGIN` | Server-side Laravel origin without `/api` — forced to prod default by deploy |
| `VISTA_FAL_USE_BACKEND_STORAGE` | Forced to `1` on prod (images stored via Laravel, not fal storage) |
| `VISTA_FAL_*` | fal render tuning (strength, steps, guidance, LoRA paths/scales, Canny, IP-Adapter); synced from local `.env.local` |
| `VISTA_RENDER_PROVIDER` | Quick Room render engine (`gemini` default, `openai`, or `fal`) |
| `VISTA_PROJECT_RENDER_PROVIDER` | Full Project render engine (defaults to `fal`; falls back to `VISTA_RENDER_PROVIDER`) |

## Domain

Point **vista.tunzone.com** to this app’s hosting (e.g. Vercel). The marketing site uses `NEXT_PUBLIC_VISTA_URL` or the production default `https://vista.tunzone.com` for CTAs.

## Related

- **B2B** interior AI remains in `metrics_platform_published` (`/planners/interior-design`).
- Submitting `designBoardProductIds` to `metrics_platform_published` `/api/interior-design/generate` returns **400** with a pointer to Vista.
