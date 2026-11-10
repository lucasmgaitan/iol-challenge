#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ROOT_DIR
readonly REDIS_CONTAINER="iol-rate-limiter-redis-dev"
readonly REDIS_IMAGE="redis:7.4-alpine"
readonly REDIS_PORT="${REDIS_PORT:-6380}"
readonly API_PORT="${API_PORT:-3000}"
readonly API_URL="http://localhost:${API_PORT}"
readonly REQUIRED_NODE_MAJOR=22
readonly READY_RETRIES=50
readonly READY_INTERVAL_S=0.2

if [ -t 1 ]; then
  readonly BOLD=$'\033[1m' RED=$'\033[31m' CYAN=$'\033[36m' RESET=$'\033[0m'
else
  readonly BOLD="" RED="" CYAN="" RESET=""
fi

api_pid=""

info() { printf '%s▸%s %s\n' "$CYAN" "$RESET" "$1"; }
fail() {
  printf '%s✗%s %s\n' "$RED" "$RESET" "$1" >&2
  exit 1
}

usage() {
  cat <<EOF
Usage: ./run.sh start

Builds the project, starts Redis in Docker on localhost:${REDIS_PORT} and the API on ${API_URL}.
Ctrl+C stops both.
EOF
}

cleanup() {
  if [ -n "$api_pid" ] && kill -0 "$api_pid" 2>/dev/null; then
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
  docker rm -f "$REDIS_CONTAINER" >/dev/null 2>&1 || true
}

require_tools() {
  command -v node >/dev/null 2>&1 || fail "Node.js ${REQUIRED_NODE_MAJOR}+ is required"
  command -v npm >/dev/null 2>&1 || fail "npm is required"
  command -v docker >/dev/null 2>&1 || fail "Docker is required to run Redis"
  docker info >/dev/null 2>&1 || fail "Docker is installed but not running"
  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$node_major" -ge "$REQUIRED_NODE_MAJOR" ] ||
    fail "Node.js ${REQUIRED_NODE_MAJOR}+ is required (found $(node -v))"
}

wait_until() {
  for _ in $(seq 1 "$READY_RETRIES"); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep "$READY_INTERVAL_S"
  done
  return 1
}

run_start() {
  require_tools
  cd "$ROOT_DIR"
  if [ ! -d node_modules ]; then
    info "Installing dependencies"
    npm ci --silent
  fi
  info "Building the library and the API"
  npm run build --silent >/dev/null

  info "Starting Redis on localhost:${REDIS_PORT}"
  docker rm -f "$REDIS_CONTAINER" >/dev/null 2>&1 || true
  docker run -d --rm --name "$REDIS_CONTAINER" -p "${REDIS_PORT}:6379" "$REDIS_IMAGE" >/dev/null
  wait_until docker exec "$REDIS_CONTAINER" redis-cli ping || fail "Redis did not start"

  printf '\n%sAPI%s  %s/hello  %s/hello-window\n\n' "$BOLD" "$RESET" "$API_URL" "$API_URL"
  info "Starting the API (Ctrl+C to stop)"
  export REDIS_URL="redis://localhost:${REDIS_PORT}" PORT="$API_PORT"
  node "$ROOT_DIR/dist/server.js" &
  api_pid=$!
  wait "$api_pid"
}

main() {
  trap cleanup EXIT
  trap 'exit 130' INT TERM

  case "${1:-}" in
    start) run_start ;;
    *)
      usage
      [ -z "${1:-}" ] || exit 1
      ;;
  esac
}

main "$@"
