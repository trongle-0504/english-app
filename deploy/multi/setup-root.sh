#!/bin/bash
# One-time root setup for the multi-user English app (PLAN-multi-user-v2.md, Phase 0 + 8). Run once:
#   sudo bash /home/trongle/english-multi/deploy/multi/setup-root.sh
# Safe to run again. Restarts english-app once at the end (~3 s).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
OWNER=trongle

# 1. Users and groups
getent group agyslots >/dev/null || groupadd --system agyslots
id englishmulti >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/englishmulti --shell /usr/sbin/nologin englishmulti
usermod -aG agyslots "$OWNER"
usermod -aG agyslots englishmulti
usermod -aG englishmulti "$OWNER"   # the owner deploys code that englishmulti reads

# 2. Folders: code (owner writes, englishmulti reads), data (englishmulti only)
install -d -o "$OWNER" -g englishmulti -m 2750 /srv/english-multi /srv/english-multi/app
install -d -o englishmulti -g englishmulti -m 2770 /srv/english-multi/data
install -d -o "$OWNER" -g "$OWNER" -m 0750 /srv/english-multi/backups

# 3. agy for englishmulti: a copy of the binary and the owner's login files (same Google account, same quota; the
#    sandboxed profiles refresh their own copies, as the personal app's two profiles already do)
# (/usr/local/bin/agy is a link into the owner's home, which englishmulti cannot enter: a real copy instead.)
install -d -m 0755 /usr/local/lib/english-multi
install -m 0755 "$(readlink -f "/home/$OWNER/.local/bin/agy")" /usr/local/lib/english-multi/agy
install -d -o englishmulti -g englishmulti -m 0700 /home/englishmulti/.gemini /home/englishmulti/.gemini/antigravity-cli
for f in antigravity-cli/antigravity-oauth-token antigravity-cli/installation_id jetski-standalone-oauth-token; do
  [ -f "/home/$OWNER/.gemini/$f" ] && install -o englishmulti -g englishmulti -m 0600 "/home/$OWNER/.gemini/$f" "/home/englishmulti/.gemini/$f"
done

# 4. The machine-wide agy gate: at most 4 agy processes, both apps wait for each other
install -d -m 0755 /usr/local/lib/agy-gate
install -m 0755 "$HERE/agy-gate-bwrap" /usr/local/lib/agy-gate/bwrap
cat >/etc/tmpfiles.d/agy-slots.conf <<'TMP'
d /run/agy-slots 2770 root agyslots -
f /run/agy-slots/slot1 0660 root agyslots -
f /run/agy-slots/slot2 0660 root agyslots -
f /run/agy-slots/slot3 0660 root agyslots -
f /run/agy-slots/slot4 0660 root agyslots -
f /run/agy-slots/slot1.owner 0660 root agyslots -
f /run/agy-slots/slot2.owner 0660 root agyslots -
f /run/agy-slots/slot3.owner 0660 root agyslots -
f /run/agy-slots/slot4.owner 0660 root agyslots -
TMP
systemd-tmpfiles --create /etc/tmpfiles.d/agy-slots.conf

# 5. Services
install -m 0644 "$HERE/english-multi.service" /etc/systemd/system/english-multi.service
install -d /etc/systemd/system/english-app.service.d
install -m 0644 "$HERE/english-app-override.conf" /etc/systemd/system/english-app.service.d/override.conf
systemctl daemon-reload
systemctl enable english-multi >/dev/null 2>&1 || true

# 6. Let the owner (and the agent working for them) deploy without a password: only these commands
cat >/etc/sudoers.d/english-multi <<'SUDO'
trongle ALL=(root) NOPASSWD: /usr/bin/systemctl start english-multi, /usr/bin/systemctl stop english-multi, /usr/bin/systemctl restart english-multi, /usr/bin/systemctl restart english-app, /usr/bin/systemctl restart english-tunnel
trongle ALL=(englishmulti) NOPASSWD: ALL
SUDO
chmod 0440 /etc/sudoers.d/english-multi
visudo -cf /etc/sudoers.d/english-multi

# 7. Apply the gate and memory limits to the personal app now
systemctl restart english-app
sleep 3
systemctl is-active english-app
echo "Done. english-multi is installed but not started; it starts after the code is deployed."
