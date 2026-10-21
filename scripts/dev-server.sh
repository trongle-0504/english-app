#!/usr/bin/env bash
# Keeps the dev server (live reload on content/ edits) running on http://localhost:5173.
# Launched hidden at Windows logon by "LinearThinking.vbs" in the Windows Startup folder; safe to run by hand.
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

# Keep the log small: start fresh when it grows past 2 MB.
[ -f "$LOG" ] && [ "$(stat -c%s "$LOG")" -gt 2097152 ] && : > "$LOG"

while true; do
  echo "[$(date '+%F %T')] starting dev server on port $PORT" >> "$LOG"
  # Same heap as `npm run dev`: with Node's default (~2 GB) the server ran out of memory after a few hours of
  # restarts (every edit under server/ restarts it) and crashed with Speaking / Writing jobs still running.
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" ./node_modules/.bin/vite --port "$PORT" --strictPort >> "$LOG" 2>&1
  echo "[$(date '+%F %T')] dev server exited with code $?" >> "$LOG"
  # Another process took the port (e.g. started by hand): nothing to do.
  running && exit 0
  sleep 5
done
