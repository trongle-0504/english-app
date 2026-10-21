#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/.."
LOG=logs/tunnel.log
mkdir -p logs

if pgrep -f "cloudflared tunnel run english-app" > /dev/null; then
  echo "Tunnel already running"
  exit 0
fi

[ -f "$LOG" ] && [ "$(stat -c%s "$LOG")" -gt 2097152 ] && : > "$LOG"

while true; do
  echo "[$(date '+%F %T')] starting cloudflared tunnel english-app" >> "$LOG"
  /usr/local/bin/cloudflared tunnel run english-app >> "$LOG" 2>&1
  echo "[$(date '+%F %T')] cloudflared exited with code $?" >> "$LOG"
  pgrep -f "cloudflared tunnel run english-app" > /dev/null && exit 0
  sleep 5
done
