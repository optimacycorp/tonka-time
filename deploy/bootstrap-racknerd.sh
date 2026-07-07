#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/deploy/apps/tonka-time"
SITE_NAME="tonkatimerentals.conf"
NGINX_AVAILABLE="/etc/nginx/sites-available/${SITE_NAME}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${SITE_NAME}"

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

TARGET_USER="${SUDO_USER:-${USER}}"

if [[ ! -d "${APP_DIR}" ]]; then
  echo "Expected app directory ${APP_DIR} to exist."
  exit 1
fi

if [[ ! -f "${APP_DIR}/.env.production" ]]; then
  echo "Missing ${APP_DIR}/.env.production. Copy .env.production.example first."
  exit 1
fi

echo "Installing server dependencies..."
${SUDO} apt-get update
${SUDO} apt-get install -y ca-certificates curl gnupg lsb-release nginx certbot python3-certbot-nginx git

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  ${SUDO} install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | ${SUDO} gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  ${SUDO} chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    ${SUDO} tee /etc/apt/sources.list.d/docker.list >/dev/null
  ${SUDO} apt-get update
  ${SUDO} apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

echo "Ensuring deploy user can run Docker..."
${SUDO} usermod -aG docker "${TARGET_USER}" || true

echo "Installing Nginx site config..."
${SUDO} cp "${APP_DIR}/nginx/tonkatimerentals.conf" "${NGINX_AVAILABLE}"
${SUDO} ln -sfn "${NGINX_AVAILABLE}" "${NGINX_ENABLED}"
${SUDO} rm -f /etc/nginx/sites-enabled/default
${SUDO} nginx -t
${SUDO} systemctl reload nginx

echo "Running initial app deployment..."
bash "${APP_DIR}/deploy/deploy-app.sh" --skip-pull

echo "Issuing Let's Encrypt certificates..."
bash "${APP_DIR}/deploy/issue-certificates.sh"

echo "Bootstrap complete."
echo "If docker commands still require logout/login for group membership, reconnect your SSH session."
