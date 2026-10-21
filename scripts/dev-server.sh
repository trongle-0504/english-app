#!/usr/bin/env bash
# Runs the fast production server (serves prebuilt dist/ with Gzip + immutable cache + live /data and /api) on port 5173.
set -u
cd "$(dirname "$0")/.."
PORT=5173
LOG=logs/dev-server.log
mkdir -p logs

running() { curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/"; }

if running; then
  echo "Already running at http://localhost:$PORT"
  exit 0
fi

[ -f "$LOG" ] && [ "$(stat -c%s "$LOG")" -gt 2097152 ] && : > "$LOG"

if [ ! -f dist/index.html ]; then
  echo "[$(date '+%F %T')] building dist/..." >> "$LOG"
  npm run build >> "$LOG" 2>&1
fi

while true; do
  echo "[$(date '+%F %T')] starting production server on port $PORT" >> "$LOG"
  PORT="$PORT" NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" node server/index.ts >> "$LOG" 2>&1
  echo "[$(date '+%F %T')] server exited with code $?" >> "$LOG"
  running && exit 0
  sleep 3
done
