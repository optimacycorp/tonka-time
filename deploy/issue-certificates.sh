#!/usr/bin/env bash
set -euo pipefail

DOMAINS=(
  tonkatimerentals.com
  www.tonkatimerentals.com
  tonka-time-rentals.com
  www.tonka-time-rentals.com
)

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

echo "Checking DNS resolution before issuing certificates..."
for domain in "${DOMAINS[@]}"; do
  echo " - ${domain}: $(getent hosts "${domain}" | awk '{print $1}' | paste -sd ',' -)"
done

${SUDO} nginx -t
${SUDO} systemctl reload nginx

${SUDO} certbot --nginx \
  --redirect \
  --agree-tos \
  --keep-until-expiring \
  --register-unsafely-without-email \
  -d tonkatimerentals.com \
  -d www.tonkatimerentals.com \
  -d tonka-time-rentals.com \
  -d www.tonka-time-rentals.com

${SUDO} systemctl reload nginx
echo "Certificates issued or renewed."
