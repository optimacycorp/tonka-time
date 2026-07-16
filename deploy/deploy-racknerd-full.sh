#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/deploy/apps/tonka-time"
APP_COMPOSE_FILE="${APP_DIR}/docker-compose.yml"
OPENSIGN_COMPOSE_FILE="${APP_DIR}/deploy/opensign-compose.yml"
APP_ENV_FILE="${APP_DIR}/.env.production"
OPENSIGN_ENV_FILE="${APP_DIR}/.env.opensign"
APP_NGINX_SOURCE="${APP_DIR}/nginx/tonkatimerentals.conf"
APP_NGINX_AVAILABLE="/etc/nginx/sites-available/tonkatimerentals.conf"
APP_NGINX_ENABLED="/etc/nginx/sites-enabled/tonkatimerentals.conf"
OPENSIGN_NGINX_SOURCE="${APP_DIR}/nginx/opensign.tonkatimerentals.conf"
OPENSIGN_NGINX_AVAILABLE="/etc/nginx/sites-available/opensign.tonkatimerentals.conf"
OPENSIGN_NGINX_ENABLED="/etc/nginx/sites-enabled/opensign.tonkatimerentals.conf"

SKIP_PULL="false"
RUN_SEED="${RUN_SEED:-false}"
RUN_PRUNE="false"
DEPLOY_OPENSIGN="auto"

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

docker_cmd() {
  if docker info >/dev/null 2>&1; then
    docker "$@"
  else
    ${SUDO} docker "$@"
  fi
}

ensure_network() {
  if ! docker_cmd network inspect tonka_internal >/dev/null 2>&1; then
    log "Creating shared Docker network tonka_internal"
    docker_cmd network create tonka_internal >/dev/null
  fi
}

log() {
  echo
  echo "==> $1"
}

require_file() {
  local file_path="$1"
  if [[ ! -f "${file_path}" ]]; then
    echo "Missing required file: ${file_path}"
    exit 1
  fi
}

for arg in "$@"; do
  case "$arg" in
    --skip-pull)
      SKIP_PULL="true"
      ;;
    --seed)
      RUN_SEED="true"
      ;;
    --prune)
      RUN_PRUNE="true"
      ;;
    --with-opensign)
      DEPLOY_OPENSIGN="true"
      ;;
    --without-opensign)
      DEPLOY_OPENSIGN="false"
      ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: bash deploy/deploy-racknerd-full.sh [--skip-pull] [--seed] [--prune] [--with-opensign] [--without-opensign]"
      exit 1
      ;;
  esac
done

require_file "${APP_ENV_FILE}"
require_file "${APP_COMPOSE_FILE}"
require_file "${APP_NGINX_SOURCE}"

cd "${APP_DIR}"

if [[ "${DEPLOY_OPENSIGN}" == "auto" ]]; then
  if [[ -f "${OPENSIGN_ENV_FILE}" ]]; then
    DEPLOY_OPENSIGN="true"
  else
    DEPLOY_OPENSIGN="false"
  fi
fi

if [[ "${DEPLOY_OPENSIGN}" == "true" ]]; then
  require_file "${OPENSIGN_COMPOSE_FILE}"
  require_file "${OPENSIGN_NGINX_SOURCE}"
fi

if [[ "${SKIP_PULL}" != "true" ]]; then
  log "Fetching latest code"
  git fetch --all --prune
  CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  git pull --ff-only origin "${CURRENT_BRANCH}"
fi

log "Checking Docker availability"
docker_cmd version >/dev/null
docker_cmd compose version >/dev/null
ensure_network

log "Installing Nginx site configuration"
${SUDO} cp "${APP_NGINX_SOURCE}" "${APP_NGINX_AVAILABLE}"
${SUDO} ln -sfn "${APP_NGINX_AVAILABLE}" "${APP_NGINX_ENABLED}"

if [[ "${DEPLOY_OPENSIGN}" == "true" ]]; then
  ${SUDO} cp "${OPENSIGN_NGINX_SOURCE}" "${OPENSIGN_NGINX_AVAILABLE}"
  ${SUDO} ln -sfn "${OPENSIGN_NGINX_AVAILABLE}" "${OPENSIGN_NGINX_ENABLED}"
fi

log "Building and starting Tonka Time"
docker_cmd compose -f "${APP_COMPOSE_FILE}" --env-file "${APP_ENV_FILE}" up -d --build

log "Running Prisma generate"
docker_cmd compose -f "${APP_COMPOSE_FILE}" exec -T app npm run prisma:generate

log "Running Prisma migrations"
docker_cmd compose -f "${APP_COMPOSE_FILE}" exec -T app npx prisma migrate deploy --schema server/prisma/schema.prisma

if [[ "${RUN_SEED}" == "true" ]]; then
  log "Running seed data"
  docker_cmd compose -f "${APP_COMPOSE_FILE}" exec -T app npx prisma db seed --schema server/prisma/schema.prisma
fi

if [[ "${DEPLOY_OPENSIGN}" == "true" ]]; then
  log "Starting OpenSign stack"
  docker_cmd compose -f "${OPENSIGN_COMPOSE_FILE}" --env-file "${OPENSIGN_ENV_FILE}" up -d
fi

log "Reloading Nginx"
${SUDO} nginx -t
${SUDO} systemctl reload nginx

log "Running health checks"
curl -fsS http://127.0.0.1:3001/api/health >/dev/null
echo "Tonka API health check passed on http://127.0.0.1:3001/api/health"

if [[ "${DEPLOY_OPENSIGN}" == "true" ]]; then
  curl -fsS http://127.0.0.1:8081/app/health >/dev/null 2>&1 || true
  curl -fsS http://127.0.0.1:3100 >/dev/null
  curl -fsS http://127.0.0.1:3100/locales/en/translation.json >/dev/null
  echo "OpenSign client check passed on http://127.0.0.1:3100"
fi

if grep -q '^OPENSIGN_INTERNAL_API_URL=' "${APP_ENV_FILE}"; then
  CURRENT_INTERNAL_URL="$(grep '^OPENSIGN_INTERNAL_API_URL=' "${APP_ENV_FILE}" | tail -n 1 | cut -d'=' -f2- | tr -d '"')"
  if [[ -z "${CURRENT_INTERNAL_URL}" ]]; then
    echo "Warning: OPENSIGN_INTERNAL_API_URL is blank in ${APP_ENV_FILE}"
  fi
else
  echo "Warning: OPENSIGN_INTERNAL_API_URL is missing from ${APP_ENV_FILE}"
fi

if [[ "${RUN_PRUNE}" == "true" ]]; then
  log "Pruning unused Docker data"
  docker_cmd builder prune -f
  docker_cmd image prune -a -f
  docker_cmd container prune -f
  docker_cmd network prune -f
fi

log "Container status"
docker_cmd compose -f "${APP_COMPOSE_FILE}" ps

if [[ "${DEPLOY_OPENSIGN}" == "true" ]]; then
  docker_cmd compose -f "${OPENSIGN_COMPOSE_FILE}" ps
fi

log "Disk usage summary"
docker_cmd system df

if [[ "${DEPLOY_OPENSIGN}" == "true" ]]; then
  log "Verifying OpenSign locale alias through Nginx"
  LOCALE_RESPONSE="$(curl -ksS -H 'Host: sign.tonkatimerentals.com' https://127.0.0.1/locales/en-US/translation.json || true)"
  if [[ -z "${LOCALE_RESPONSE}" || "${LOCALE_RESPONSE}" == \<\!DOCTYPE\ html* || "${LOCALE_RESPONSE}" == \<html* ]]; then
    echo "OpenSign locale alias check failed: /locales/en-US/translation.json did not return JSON"
    exit 1
  fi
  echo "OpenSign locale alias check passed"
fi

echo
echo "Deployment complete."
