#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/deploy/apps/tonka-time"
COMPOSE_FILE="${APP_DIR}/docker-compose.yml"
SKIP_PULL="false"
RUN_SEED="${RUN_SEED:-false}"

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

for arg in "$@"; do
  case "$arg" in
    --skip-pull)
      SKIP_PULL="true"
      ;;
    --seed)
      RUN_SEED="true"
      ;;
  esac
done

cd "${APP_DIR}"

if [[ ! -f ".env.production" ]]; then
  echo "Missing .env.production in ${APP_DIR}"
  exit 1
fi

if [[ "${SKIP_PULL}" != "true" ]]; then
  echo "Fetching latest code..."
  git fetch --all --prune
  CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  git pull --ff-only origin "${CURRENT_BRANCH}"
fi

echo "Building and starting containers..."
docker compose -f "${COMPOSE_FILE}" --env-file .env.production up -d --build

echo "Running Prisma generate..."
docker compose -f "${COMPOSE_FILE}" exec -T app npm run prisma:generate

echo "Running Prisma migrations..."
docker compose -f "${COMPOSE_FILE}" exec -T app npx prisma migrate deploy --schema server/prisma/schema.prisma

if [[ "${RUN_SEED}" == "true" ]]; then
  echo "Running seed data..."
  docker compose -f "${COMPOSE_FILE}" exec -T app npx prisma db seed --schema server/prisma/schema.prisma
fi

echo "Reloading Nginx..."
${SUDO} nginx -t
${SUDO} systemctl reload nginx

echo "Deployment complete."
docker compose -f "${COMPOSE_FILE}" ps
