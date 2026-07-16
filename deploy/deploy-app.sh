#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/deploy/apps/tonka-time"
COMPOSE_FILE="${APP_DIR}/docker-compose.yml"
ENV_FILE="${APP_DIR}/.env.production"
APP_SERVICE="app"
APP_HEALTH_URL="http://127.0.0.1:3001/api/health"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-90}"
SKIP_PULL="false"
RUN_SEED="${RUN_SEED:-false}"
RUN_BUILD="true"

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

log() {
  echo
  echo "==> $1"
}

fail() {
  echo
  echo "Deployment failed: $1" >&2
  print_diagnostics || true
  exit 1
}

require_file() {
  local file_path="$1"
  [[ -f "${file_path}" ]] || fail "missing required file ${file_path}"
}

ensure_network() {
  if ! docker_cmd network inspect tonka_internal >/dev/null 2>&1; then
    log "Creating shared Docker network tonka_internal"
    docker_cmd network create tonka_internal >/dev/null
  fi
}

wait_for_health() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    if curl -fsS "${APP_HEALTH_URL}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  return 1
}

verify_container_runtime() {
  log "Verifying app runtime inside container"
  docker_cmd compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T "${APP_SERVICE}" node -e "import('./dist/index.js').then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); })"
  docker_cmd compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T "${APP_SERVICE}" test -f /app/docs/Tonka_Time_Weekend_Rental_Agreement_Template.docx
  docker_cmd compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T "${APP_SERVICE}" test -f /app/server/scripts/render_agreement_docx.py
  docker_cmd compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T "${APP_SERVICE}" python3 - <<'PY'
import pypdf
import reportlab
print("python pdf deps ok")
PY
}

print_diagnostics() {
  log "Container status"
  docker_cmd compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" ps || true

  log "Recent app logs"
  docker_cmd compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" logs "${APP_SERVICE}" --tail=200 || true
}

for arg in "$@"; do
  case "$arg" in
    --skip-pull)
      SKIP_PULL="true"
      ;;
    --seed)
      RUN_SEED="true"
      ;;
    --skip-build)
      RUN_BUILD="false"
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: bash deploy/deploy-app.sh [--skip-pull] [--seed] [--skip-build]" >&2
      exit 1
      ;;
  esac
done

cd "${APP_DIR}"

require_file "${ENV_FILE}"
require_file "${COMPOSE_FILE}"

if [[ "${SKIP_PULL}" != "true" ]]; then
  log "Fetching latest code"
  git fetch --all --prune
  CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  git pull --ff-only origin "${CURRENT_BRANCH}"
fi

log "Checking Docker and Compose"
docker_cmd version >/dev/null
docker_cmd compose version >/dev/null
ensure_network

log "Validating compose configuration"
docker_cmd compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" config >/dev/null

if [[ "${RUN_BUILD}" == "true" ]]; then
  log "Building images"
  docker_cmd compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" build
fi

log "Starting containers"
docker_cmd compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d

log "Running Prisma generate"
docker_cmd compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T "${APP_SERVICE}" npm run prisma:generate

log "Running Prisma migrations"
docker_cmd compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T "${APP_SERVICE}" npx prisma migrate deploy --schema server/prisma/schema.prisma

if [[ "${RUN_SEED}" == "true" ]]; then
  log "Running seed data"
  docker_cmd compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T "${APP_SERVICE}" npx prisma db seed --schema server/prisma/schema.prisma
fi

verify_container_runtime || fail "container runtime verification failed"

log "Waiting for app health endpoint"
wait_for_health || fail "health check did not pass at ${APP_HEALTH_URL} within ${HEALTH_TIMEOUT_SECONDS}s"

log "Verifying Nginx configuration"
${SUDO} nginx -t

log "Reloading Nginx"
${SUDO} systemctl reload nginx

log "Final health confirmation"
curl -fsS "${APP_HEALTH_URL}" >/dev/null || fail "final health check failed after nginx reload"

log "Deployment verified"
docker_cmd compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" ps
