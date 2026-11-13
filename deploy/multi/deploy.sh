#!/bin/bash
# Deploys (or updates) the multi-user app on study.ailab.com.vn (PLAN-multi-user-v2.md, 7.6). Run as the owner, from
# anywhere: bash deploy/multi/deploy.sh [git ref, default: multi]
# Needs the one-time root setup (setup-root.sh). Reads the personal app only (/home/trongle/english-app): shared
# content, pictures of the shared word bank, dictionary caches, the STT model. Never writes there.
set -euo pipefail
umask 002
SRC=/home/trongle/english-multi          # the multi-user git checkout (work clone)
PERSONAL=/home/trongle/english-app       # the personal app (read only)
BASE=/srv/english-multi
APP=$BASE/app
DATA=$BASE/data
REF=${1:-multi}

echo "== code ($REF)"
if [ ! -d "$APP/.git" ]; then git clone -q "$SRC" "$APP"; fi
git -C "$APP" fetch -q "$SRC" "$REF"
git -C "$APP" checkout -q --detach FETCH_HEAD
git -C "$APP" log --oneline -1
rm -rf "$APP/node_modules"
cp -al "$SRC/node_modules" "$APP/node_modules"
(cd "$APP" && npx vite build >/dev/null && echo "built dist/")

echo "== shared content (no personal library)"
rsync -a --delete \
  --exclude 'vocabulary/' --exclude 'note/' --exclude 'notepad/' --exclude 'review/*' --include 'review/_example.*' \
  --exclude 'grammar/history.json' --exclude 'docs/' --exclude 'samples/' --exclude 'reference/' \
  "$PERSONAL/content/" "$APP/content/"
mkdir -p "$APP/content/review" && cp "$PERSONAL/content/review/_example."* "$APP/content/review/"
# The shared word bank (and its topic tree: a new learner gets a copy with no words in it).
node "$APP/scripts/mu-extract-reference.ts" "$PERSONAL/content" "$APP/content"
[ -f "$APP/reference-review.md" ] && mv "$APP/reference-review.md" "$BASE/reference-review.md" || true
rm -rf "$APP/content/vocabulary"

echo "== shared pictures, model, caches"
for d in vocab-images blog-images pdf pronunciation; do
  rm -rf "$APP/public/$d"; [ -d "$PERSONAL/public/$d" ] && cp -al "$PERSONAL/public/$d" "$APP/public/$d"
done
if [ ! -d "$BASE/models" ]; then cp -al "$PERSONAL/models" "$BASE/models"; fi
ln -sfn "$BASE/models" "$APP/models"
# The data folder belongs to englishmulti: write into it as that user (it cannot read the owner's home, so the
# files are streamed through tar).
EM="sudo -n -u englishmulti"
$EM mkdir -p "$DATA/cache" "$DATA/logs"
for c in longman ozdic dol tts; do
  [ -d "$PERSONAL/cache/$c" ] && tar -C "$PERSONAL/cache" -cf - "$c" | $EM tar -C "$DATA/cache" --skip-old-files -xf -
done
ln -sfn "$DATA/cache" "$APP/cache"
ln -sfn "$DATA/logs" "$APP/logs"
ln -sfn "$DATA" "$APP/data"
$EM test -f "$DATA/news.json" || tar -C "$PERSONAL/data" -cf - news.json | $EM tar -C "$DATA" -xf -

echo "== .env"
if [ ! -f "$APP/.env" ]; then
  {
    grep -E '^(LLM_ENGINE|SPEAKING_ENGINE|WRITING_REVIEW_ENGINE|[A-Z_]*ANTIGRAVITY_MODEL|ANTIGRAVITY_EFFORT|GEMINI_THINKING|[A-Z_]*_EFFORT|PIXABAY_API_KEY)=' "$PERSONAL/.env" || true
    cat <<ENV
# Multi-user app (PLAN-multi-user-v2.md). Port 5180 behind the Cloudflare tunnel (study.ailab.com.vn).
MULTI_USER=1
PORT=5180
HOST=127.0.0.1
DATA_DIR=$DATA
TRUST_PROXY=1
NEWS_SCHEDULER=off
ANTIGRAVITY_BIN=/usr/local/lib/english-multi/agy
ANTIGRAVITY_WARM=off
AGY_EPHEMERAL_PROFILE=1
ANTIGRAVITY_TIMEOUT_MS=600000
COACH_IDLE_MS=180000
MAX_DEVICES=2
RECORDING_RETENTION_DAYS=15
MIN_FREE_GB=5
ALERT_FREE_GB=10
# Cloudflare Turnstile on the sign-up form: fill both to turn it on.
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET=
ENV
  } >"$APP/.env"
fi
chmod 640 "$APP/.env"

echo "== restart"
sudo -n systemctl restart english-multi
for i in $(seq 1 60); do
  curl -fsS http://127.0.0.1:5180/api/health >/dev/null 2>&1 && { echo "english-multi is up"; exit 0; }
  sleep 1
done
echo "english-multi did not answer on :5180"; sudo -n systemctl status english-multi --no-pager | tail -20; exit 1
