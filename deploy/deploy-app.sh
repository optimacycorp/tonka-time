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

docker_cmd() {
  if docker info >/dev/null 2>&1; then
    docker "$@"
  else
    ${SUDO} docker "$@"
  fi
}

ensure_network() {
  if ! docker_cmd network inspect tonka_internal >/dev/null 2>&1; then
    echo "Creating shared Docker network tonka_internal..."
    docker_cmd network create tonka_internal >/dev/null
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

ensure_network

echo "Building and starting containers..."
docker_cmd compose -f "${COMPOSE_FILE}" --env-file .env.production up -d --build

echo "Running Prisma generate..."
docker_cmd compose -f "${COMPOSE_FILE}" exec -T app npm run prisma:generate

echo "Running Prisma migrations..."
docker_cmd compose -f "${COMPOSE_FILE}" exec -T app npx prisma migrate deploy --schema server/prisma/schema.prisma

if [[ "${RUN_SEED}" == "true" ]]; then
  echo "Running seed data..."
  docker_cmd compose -f "${COMPOSE_FILE}" exec -T app npx prisma db seed --schema server/prisma/schema.prisma
fi

echo "Reloading Nginx..."
${SUDO} nginx -t
${SUDO} systemctl reload nginx

echo "Deployment complete."
docker_cmd compose -f "${COMPOSE_FILE}" ps
