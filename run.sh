#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ROOT_DIR
readonly REDIS_CONTAINER="iol-rate-limiter-redis-dev"
readonly REDIS_IMAGE="redis:7.4-alpine"
readonly REDIS_PORT="${REDIS_PORT:-6380}"
readonly API_PORT="${API_PORT:-3000}"
readonly API_URL="http://localhost:${API_PORT}"
readonly STACK_URL="http://localhost:8080"
readonly GRAFANA_URL="http://localhost:3001/d/rate-limiter"
readonly PROMETHEUS_URL="http://localhost:9090"
readonly PROMETHEUS_QUERY_URL="http://127.0.0.1:9090/api/v1/query"
readonly LOCUST_URL="http://localhost:8089"
readonly VERIFY_SCRIPT="/scripts/verify.js"
readonly SHOWCASE_SCRIPT="/scripts/showcase.js"
readonly PROMETHEUS_OUTPUT="experimental-prometheus-rw"
readonly REQUIRED_NODE_MAJOR=22
readonly READY_RETRIES=50
readonly READY_INTERVAL_S=0.2
readonly OUTAGE_STARTS_AFTER_S=20
readonly OUTAGE_DURATION_S=20
readonly SMOKE_USERS=4
readonly SMOKE_RUN_TIME_S=15
readonly SMOKE_FLAG="--smoke"
readonly LOCUST_PROFILES=4
readonly PROMETHEUS_NON_EMPTY_RESULT='"result":[{'

if [ -t 1 ]; then
  readonly BOLD=$'\033[1m' DIM=$'\033[2m' RED=$'\033[31m' GREEN=$'\033[32m'
  readonly YELLOW=$'\033[33m' CYAN=$'\033[36m' RESET=$'\033[0m'
else
  readonly BOLD="" DIM="" RED="" GREEN="" YELLOW="" CYAN="" RESET=""
fi

api_pid=""
stack_started=false

info() { printf '%s▸%s %s\n' "$CYAN" "$RESET" "$1"; }
warn() { printf '%s⚠%s %s\n' "$YELLOW" "$RESET" "$1"; }
success() { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
fail() {
  printf '%s✗%s %s\n' "$RED" "$RESET" "$1" >&2
  exit 1
}

usage() {
  cat <<EOF
Usage: ./run.sh <command>

Commands:
  start    Run the API locally with Node on ${API_URL}, backed by Redis in Docker (Ctrl+C to stop)
  verify   Run the k6 verification against 3 API replicas behind nginx; exits non-zero if any check fails
  demo     Start the full stack with Grafana, generate 60 s of mixed traffic and take Redis down
           in the middle; the stack stays up for exploring the dashboard until Ctrl+C
  explore  Start the full stack with Grafana and Locust: configure and run your own tests from
           ${LOCUST_URL} and watch them on the dashboard (Ctrl+C to stop)
  explore ${SMOKE_FLAG}
           Run Locust headless for ${SMOKE_RUN_TIME_S} s and check that its metrics reach Prometheus
EOF
}

compose() { docker compose --project-directory "$ROOT_DIR" --progress quiet "$@"; }

cleanup() {
  if [ -n "$api_pid" ] && kill -0 "$api_pid" 2>/dev/null; then
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
  docker rm -f "$REDIS_CONTAINER" >/dev/null 2>&1 || true
  if [ "$stack_started" = true ]; then
    info "Stopping the stack"
    compose --profile load --profile explore down --remove-orphans >/dev/null 2>&1 || true
  fi
}

require_docker() {
  command -v docker >/dev/null 2>&1 || fail "Docker is required"
  docker info >/dev/null 2>&1 || fail "Docker is installed but not running"
  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"
}

require_node() {
  command -v node >/dev/null 2>&1 || fail "Node.js ${REQUIRED_NODE_MAJOR}+ is required"
  command -v npm >/dev/null 2>&1 || fail "npm is required"
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

start_stack() {
  info "Building the API image and starting: $*"
  stack_started=true
  compose up -d --build --wait "$@" >/dev/null
}

wait_forever() {
  while true; do
    sleep 3600 &
    wait $!
  done
}

prometheus_has() {
  curl -fsG "$PROMETHEUS_QUERY_URL" --data-urlencode "query=$1" | grep -qF "$PROMETHEUS_NON_EMPTY_RESULT"
}

countdown() {
  local seconds="$1" message="$2" left
  if [ ! -t 1 ]; then
    printf '  %s… %ss\n' "$message" "$seconds"
    sleep "$seconds"
    return 0
  fi
  for left in $(seq "$seconds" -1 1); do
    printf '\r  %s%s… %ss %s' "$DIM" "$message" "$left" "$RESET"
    sleep 1
  done
  printf '\r\033[K'
}

run_start() {
  require_node
  require_docker
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

  printf '\n%sAPI%s     %s/hello  %s/hello-window\n%sMetrics%s %s/metrics\n\n' \
    "$BOLD" "$RESET" "$API_URL" "$API_URL" "$BOLD" "$RESET" "$API_URL"
  info "Starting the API (Ctrl+C to stop)"
  export REDIS_URL="redis://localhost:${REDIS_PORT}" PORT="$API_PORT"
  node "$ROOT_DIR/dist/server.js" &
  api_pid=$!
  wait "$api_pid"
}

run_verify() {
  require_docker
  start_stack redis api nginx
  info "Running the k6 verification (about 30 s)"
  if compose --profile load run --rm k6 run "$VERIFY_SCRIPT"; then
    success "All rate limiting checks passed"
  else
    fail "Some rate limiting checks failed (see the k6 summary above)"
  fi
}

run_demo() {
  require_docker
  start_stack redis api nginx prometheus grafana
  printf '\n%sDashboard%s  %s\n%sAPI%s        %s/hello  %s/hello-window\n%sPrometheus%s %s\n\n' \
    "$BOLD" "$RESET" "$GRAFANA_URL" "$BOLD" "$RESET" "$STACK_URL" "$STACK_URL" \
    "$BOLD" "$RESET" "$PROMETHEUS_URL"

  info "Generating 60 s of mixed traffic (steady, bursts, a spike and an algorithm comparison)"
  compose --profile load run --rm k6 run --quiet -o "$PROMETHEUS_OUTPUT" "$SHOWCASE_SCRIPT" &
  local k6_pid=$!

  countdown "$OUTAGE_STARTS_AFTER_S" "Redis goes down in"
  warn "Stopping Redis: the API fails open and the circuit breaker opens"
  compose stop redis >/dev/null
  countdown "$OUTAGE_DURATION_S" "Redis comes back in"
  info "Starting Redis again: the circuit closes after its half-open trial"
  compose start redis >/dev/null

  wait "$k6_pid" || true
  success "Traffic finished. The stack stays up: explore ${GRAFANA_URL} (Ctrl+C to stop)"
  wait_forever
}

run_explore() {
  require_docker
  if [ "${1:-}" = "$SMOKE_FLAG" ]; then
    run_explore_smoke
    return 0
  fi
  start_stack redis api nginx prometheus grafana locust
  printf '\n%sLocust%s     %s   (configure and start your tests here)\n%sDashboard%s  %s\n\n' \
    "$BOLD" "$RESET" "$LOCUST_URL" "$BOLD" "$RESET" "$GRAFANA_URL"
  info "Stack ready (Ctrl+C to stop)"
  wait_forever
}

run_explore_smoke() {
  start_stack redis api nginx prometheus
  info "Running Locust headless with every profile for ${SMOKE_RUN_TIME_S} s"
  export LOCUST_AUTOSTART=true LOCUST_AUTOQUIT=0 LOCUST_USERS="$SMOKE_USERS"
  export LOCUST_SPAWN_RATE="$SMOKE_USERS" LOCUST_RUN_TIME="${SMOKE_RUN_TIME_S}s"
  compose --profile explore up -d --build locust >/dev/null
  countdown "$SMOKE_RUN_TIME_S" "Locust is sending traffic"

  wait_until prometheus_has "count(count by (profile) (locust_requests_total)) == ${LOCUST_PROFILES}" ||
    fail "Not every Locust profile reached Prometheus"
  wait_until prometheus_has 'sum(locust_requests_total{status="429"}) > 0' ||
    fail "Locust traffic was never rate limited"
  success "Locust sent traffic from every profile, got rate limited, and its metrics reached Prometheus"
}

main() {
  local command="${1:-}"
  trap cleanup EXIT
  trap 'exit 130' INT TERM

  case "$command" in
    start) run_start ;;
    verify) run_verify ;;
    demo) run_demo ;;
    explore) run_explore "${2:-}" ;;
    *)
      usage
      [ -z "$command" ] || exit 1
      ;;
  esac
}

main "$@"
