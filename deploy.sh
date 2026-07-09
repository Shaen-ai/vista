#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER="${SERVER:-ubuntu@145.239.71.158}"
REMOTE_DIR="${REMOTE_DIR:-/var/www/tunzone/frontend/vista}"
REMOTE_OWNER="${REMOTE_OWNER:-ubuntu:ubuntu}"
PM2_NAME="${PM2_NAME:-tunzone-vista}"
PORT="${PORT:-3003}"
NPM_BUILD_SCRIPT="${NPM_BUILD_SCRIPT:-build}"
SSH="${SSH:-ssh}"

# Merge KEY=VAL into remote .env.local. Values are passed as argv (safe for quotes / shell metacharacters).
remote_merge_dotenv_kv() {
  local key="$1" val="$2"
  $SSH "$SERVER" bash -s "$REMOTE_DIR" "$key" "$val" <<'EOS'
set -euo pipefail
REMOTE_DIR="$1"
KEY="$2"
VAL="$3"
cd "$REMOTE_DIR" || exit 1
touch .env.local
tmp="$(mktemp)"
grep -v "^${KEY}=" .env.local >"$tmp" || true
mv "$tmp" .env.local
printf '%s\n' "${KEY}=${VAL}" >>.env.local
EOS
}

echo "==> Preparing $SERVER:$REMOTE_DIR ..."
$SSH "$SERVER" "sudo mkdir -p '$REMOTE_DIR' && sudo chown -R '$REMOTE_OWNER' '$REMOTE_DIR'"

echo "==> Syncing source to $SERVER:$REMOTE_DIR ..."
rsync -avz --delete \
  --exclude ".git" \
  --exclude ".cursor" \
  --exclude ".next" \
  --exclude "node_modules" \
  --exclude ".env" \
  --exclude ".env.local" \
  --exclude ".env.*.local" \
  --exclude ".DS_Store" \
  --exclude "npm-debug.log*" \
  --rsync-path="sudo rsync" \
  "$APP_DIR/" "$SERVER:$REMOTE_DIR/"

$SSH "$SERVER" "sudo chown -R '$REMOTE_OWNER' '$REMOTE_DIR'"

# --- Server-side secrets & public API URL (from local .env.local + prod defaults) ----------
# Full list of keys synced from local .env.local → remote .env.local.
# See .env.example for descriptions; add new vars there first.
SYNC_KEYS=(
  # AI provider secrets
  ANTHROPIC_API_KEY
  GOOGLE_AI_API_KEY
  GEMINI_API_KEY
  OPENAI_API_KEY
  FAL_KEY
  FAL_AI_KEY
  INTERNAL_API_KEY
  # Metering / identity
  INTERIOR_DESIGN_ADMIN_SLUG
  NEXT_PUBLIC_INTERIOR_ADMIN_SLUG
  NEXT_PUBLIC_VISTA_OPENING_EDITOR
  NEXT_PUBLIC_POSTHOG_KEY
  NEXT_PUBLIC_GA_MEASUREMENT_ID
  # Infrastructure
  REDIS_URL
  LARAVEL_API_ORIGIN
  # Model overrides
  FLOOR_PLAN_ANALYSIS_MODEL
  ANTHROPIC_ROOM_GEOMETRY_MODEL
  # fal render tuning
  VISTA_RENDER_PROVIDER
  VISTA_PROJECT_RENDER_PROVIDER
  VISTA_QUICK_RENDER_MODEL
  VISTA_FAL_STRENGTH
  VISTA_FAL_STEPS
  VISTA_FAL_GUIDANCE
  VISTA_FAL_IP_ADAPTER_SCALE
  VISTA_FAL_VIEWPOINT_IP_ADAPTER_SCALE
  VISTA_FAL_CANNY_STRENGTH
  VISTA_FAL_CANNY_LORA_PATH
  VISTA_FAL_CONTROL_GUIDANCE_END
  VISTA_FAL_STYLE_LORA_PATH
  VISTA_FAL_STYLE_LORA_SCALE
  VISTA_FAL_MASK_INVERT
  VISTA_FAL_VALIDATE
)
echo "==> Syncing server-side keys to remote .env.local ..."
$SSH "$SERVER" "touch '$REMOTE_DIR/.env.local'"
if [ -f "$APP_DIR/.env.local" ]; then
  for KEY in "${SYNC_KEYS[@]}"; do
    VAL="$(grep "^${KEY}=" "$APP_DIR/.env.local" | head -1 | cut -d= -f2-)" || true
    if [ -n "$VAL" ]; then
      remote_merge_dotenv_kv "$KEY" "$VAL"
    fi
  done
fi

# Prod-only defaults (not synced from local — these differ between dev and prod).
LARAVEL_PROD_URL="${LARAVEL_PROD_URL:-https://api.tunzone.com/api}"
remote_merge_dotenv_kv "LARAVEL_API_URL" "$LARAVEL_PROD_URL"

NEXT_PUBLIC_API_PROD="${NEXT_PUBLIC_API_PROD:-https://api.tunzone.com/api}"
remote_merge_dotenv_kv "NEXT_PUBLIC_API_URL" "$NEXT_PUBLIC_API_PROD"

GA_MEASUREMENT_ID="${GA_MEASUREMENT_ID:-G-NEC36L9NYL}"
remote_merge_dotenv_kv "NEXT_PUBLIC_GA_MEASUREMENT_ID" "$GA_MEASUREMENT_ID"

LARAVEL_PROD_ORIGIN="${LARAVEL_PROD_ORIGIN:-https://api.tunzone.com}"
remote_merge_dotenv_kv "LARAVEL_API_ORIGIN" "$LARAVEL_PROD_ORIGIN"

# Backend storage is prod-only: fal cannot fetch localhost URLs, but api.tunzone.com is public.
remote_merge_dotenv_kv "VISTA_FAL_USE_LOCAL_STORAGE" "1"
remote_merge_dotenv_kv "VISTA_UPLOADS_DIR" "/var/www/tunzone/vista/uploads"
remote_merge_dotenv_kv "VISTA_PUBLIC_ORIGIN" "https://vista.tunzone.com"

# --- Ensure nginx allows large request bodies and long AI timeouts ----------
NGINX_BODY_SIZE="${NGINX_BODY_SIZE:-50m}"
NGINX_SITE_CONF="/etc/nginx/sites-available/vista.tunzone.com"
echo "==> Ensuring nginx client_max_body_size and proxy timeouts ..."
$SSH "$SERVER" "
  NEED_RELOAD=0

  SNIPPET=/etc/nginx/conf.d/body-size.conf
  if [ ! -f \"\$SNIPPET\" ]; then
    echo 'client_max_body_size ${NGINX_BODY_SIZE};' | sudo tee \"\$SNIPPET\" >/dev/null
    NEED_RELOAD=1
    echo '   -> Created \$SNIPPET'
  fi

  if ! grep -q 'proxy_read_timeout' '${NGINX_SITE_CONF}' 2>/dev/null; then
    sudo sed -i '/proxy_cache_bypass/a\\n        proxy_read_timeout 180s;\n        proxy_send_timeout 180s;\n        proxy_connect_timeout 10s;' '${NGINX_SITE_CONF}'
    NEED_RELOAD=1
    echo '   -> Added proxy timeouts to ${NGINX_SITE_CONF}'
  fi
  if ! grep -q 'client_max_body_size' '${NGINX_SITE_CONF}' 2>/dev/null; then
    sudo sed -i '/error_log/a\\n    client_max_body_size ${NGINX_BODY_SIZE};' '${NGINX_SITE_CONF}'
    NEED_RELOAD=1
    echo '   -> Added client_max_body_size to ${NGINX_SITE_CONF}'
  fi

  if [ \"\$NEED_RELOAD\" -eq 1 ]; then
    sudo nginx -t && sudo systemctl reload nginx
    echo '   -> Nginx reloaded'
  else
    echo '   -> Nginx config already up to date'
  fi
"

echo "==> Ensuring Vista upload storage directory ..."
$SSH "$SERVER" "sudo mkdir -p /var/www/tunzone/vista/uploads && sudo chown -R '$REMOTE_OWNER' /var/www/tunzone/vista"

echo "==> Installing, building, and restarting PM2 on server..."
# ssh bash -s: pass REMOTE_DIR / PM2_NAME / PORT / NPM_BUILD_SCRIPT as argv (no brittle local heredoc expansion).
$SSH "$SERVER" bash -s "$REMOTE_DIR" "$PM2_NAME" "$PORT" "$NPM_BUILD_SCRIPT" <<'EOS'
set -euo pipefail
REMOTE_DIR="$1"
PM2_NAME="$2"
PORT="$3"
NPM_BUILD_SCRIPT="$4"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

command -v pm2 >/dev/null 2>&1 || {
  echo "pm2 not found on PATH after sourcing nvm. Install: npm i -g pm2" >&2
  exit 1
}

cd "$REMOTE_DIR"
echo "==> $(pwd): npm ci (include dev deps for Tailwind/PostCSS build)"
# Server shells often export NODE_ENV=production; that skips devDependencies and breaks CSS.
npm ci --include=dev
echo "==> npm run $NPM_BUILD_SCRIPT"
npm run "$NPM_BUILD_SCRIPT"

CSS_COUNT="$(find .next/static -name '*.css' 2>/dev/null | wc -l | tr -d ' ')"
if [ "${CSS_COUNT:-0}" -eq 0 ]; then
  echo "ERROR: build produced no .next/static/*.css (Tailwind/PostCSS likely missing)." >&2
  exit 1
fi
echo "==> Build OK ($CSS_COUNT CSS asset(s) in .next/static)"

# Older deploys started `node_modules/next/dist/bin/next` directly; migrate to npm start.
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  if pm2 describe "$PM2_NAME" 2>/dev/null | grep -q 'next/dist/bin/next'; then
    echo "==> pm2 delete $PM2_NAME (migrate off direct next binary)"
    pm2 delete "$PM2_NAME"
  fi
fi

if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  echo "==> pm2 reload $PM2_NAME"
  HOSTNAME=0.0.0.0 NODE_ENV=production PORT="$PORT" pm2 reload "$PM2_NAME" --update-env
else
  echo "==> pm2 start $PM2_NAME"
  HOSTNAME=0.0.0.0 NODE_ENV=production PORT="$PORT" pm2 start npm --name "$PM2_NAME" -- start
fi

pm2 save

echo "==> PM2 describe $PM2_NAME:"
pm2 describe "$PM2_NAME" || true
echo "==> Recent logs:"
pm2 logs "$PM2_NAME" --lines 40 --nostream || true
EOS

echo "==> Done! Deployed successfully."
