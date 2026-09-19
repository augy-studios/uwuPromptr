#!/usr/bin/env bash
#
# Installs coturn on Debian for uwuPromptr's remote control.
#
#   sudo bash setup.sh
#
# Idempotent: safe to run again after editing the config. It installs the
# package, puts turnserver.conf in place if there is not one already, opens the
# firewall if ufw is running, and enables the service. It does not overwrite an
# existing /etc/turnserver.conf, because that is where the secret lives.

set -euo pipefail

CONF=/etc/turnserver.conf
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Run this with sudo: sudo bash setup.sh" >&2
  exit 1
fi

echo "==> Installing coturn"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y coturn

echo "==> Configuration"
if [[ -f "$CONF" ]] && ! grep -q "CHANGE_ME_TO_A_LONG_RANDOM_STRING" "$CONF"; then
  echo "    $CONF exists and looks edited already. Leaving it alone."
else
  cp "$HERE/turnserver.conf" "$CONF"
  chmod 640 "$CONF"
  chown root:turnserver "$CONF" 2>/dev/null || true
  echo "    Copied the template to $CONF."
  echo
  echo "    Now edit it. Four lines are marked EDIT:"
  echo "      external-ip         this machine's public IP"
  echo "      static-auth-secret  openssl rand -hex 32"
  echo "      realm               the hostname clients connect to"
  echo "      cert / pkey         a certificate for that hostname"
fi

# Debian ships coturn disabled behind this flag.
if [[ -f /etc/default/coturn ]]; then
  sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
  grep -q '^TURNSERVER_ENABLED=1' /etc/default/coturn || echo 'TURNSERVER_ENABLED=1' >> /etc/default/coturn
fi

echo "==> Firewall"
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 3478/udp   >/dev/null
  ufw allow 3478/tcp   >/dev/null
  ufw allow 5349/tcp   >/dev/null
  ufw allow 49160:49200/udp >/dev/null
  echo "    Opened 3478 (udp, tcp), 5349 (tcp), 49160-49200 (udp)."
else
  echo "    ufw is not active. Open these yourself if something else is filtering:"
  echo "      3478/udp 3478/tcp 5349/tcp 49160-49200/udp"
fi

echo "==> Service"
systemctl enable coturn >/dev/null
if grep -q "CHANGE_ME_TO_A_LONG_RANDOM_STRING" "$CONF"; then
  echo "    Not starting yet: $CONF still has the placeholder secret in it."
  echo "    Edit it, then: sudo systemctl restart coturn"
else
  systemctl restart coturn
  sleep 1
  systemctl --no-pager --lines=0 status coturn || true
fi

echo
echo "Done. Next:"
echo "  1. Put the same static-auth-secret in Vercel as TURN_SECRET,"
echo "     and the realm hostname as TURN_HOST."
echo "  2. Redeploy the site so the function picks them up."
echo "  3. Check it with the Trickle ICE page, see README.md."
