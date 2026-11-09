#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ROOT_DIR
readonly REDIS_CONTAINER="iol-rate-limiter-redis-dev"
readonly REDIS_IMAGE="redis:7.4-alpine"
readonly REDIS_PORT="${REDIS_PORT:-6380}"
readonly API_PORT="${API_PORT:-3000}"
readonly API_URL="http://localhost:${API_PORT}"
readonly YQ_IMAGE="mikefarah/yq:4.54.3"
readonly CASES_FILE="load-tests/cases.yaml"
readonly CASE_SCRIPT="/scripts/run-case.js"
readonly CASE_MOUNT="/case"
readonly CASE_JSON="case.json"
readonly CASE_NAME_PATTERN='^[a-z0-9][a-z0-9-]*$'
readonly VERIFY_CASE="verify"
readonly DEMO_CASE="showcase"
readonly REQUIRED_NODE_MAJOR=22
readonly READY_RETRIES=50
readonly READY_INTERVAL_S=0.2

if [ -t 1 ]; then
  readonly BOLD=$'\033[1m' DIM=$'\033[2m' RED=$'\033[31m'
  readonly YELLOW=$'\033[33m' CYAN=$'\033[36m' RESET=$'\033[0m' COLOR_OUTPUT=true
else
  readonly BOLD="" DIM="" RED="" YELLOW="" CYAN="" RESET="" COLOR_OUTPUT=false
fi

api_pid=""
case_dir=""
stack_started=false

info() { printf '%s▸%s %s\n' "$CYAN" "$RESET" "$1"; }
warn() { printf '%s⚠%s %s\n' "$YELLOW" "$RESET" "$1"; }
fail() {
  printf '%s✗%s %s\n' "$RED" "$RESET" "$1" >&2
  exit 1
}

usage() {
  cat <<EOF
Usage: ./run.sh <command>

Commands:
  cases          List the load test cases defined in ${CASES_FILE}
  case <name>    Run a case against 3 API replicas behind nginx and print the results;
                 exits non-zero if the case expectations are not met
  verify         Shortcut for: case ${VERIFY_CASE}   (used by CI)
  demo           Shortcut for: case ${DEMO_CASE}
  start          Run the API locally with Node on ${API_URL}, backed by Redis in Docker (Ctrl+C to stop)
EOF
}

compose() { docker compose --project-directory "$ROOT_DIR" --progress quiet "$@"; }

yq_cases() { docker run --rm -i "$YQ_IMAGE" "$@" <"$ROOT_DIR/$CASES_FILE"; }

cleanup() {
  if [ -n "$api_pid" ] && kill -0 "$api_pid" 2>/dev/null; then
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
  docker rm -f "$REDIS_CONTAINER" >/dev/null 2>&1 || true
  if [ "$stack_started" = true ]; then
    info "Stopping the stack"
    compose --profile load down --remove-orphans --timeout 3 >/dev/null 2>&1 || true
  fi
  if [ -n "$case_dir" ]; then rm -rf "$case_dir"; fi
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

interruptible_sleep() {
  sleep "$1" &
  wait $!
}

duration_seconds() {
  case "$1" in
    *m) printf '%s' "$((${1%m} * 60))" ;;
    *s) printf '%s' "${1%s}" ;;
    *) fail "Unsupported duration \"$1\" in ${CASES_FILE}: use seconds (30s) or minutes (1m)" ;;
  esac
}

countdown() {
  local seconds="$1" message="$2" left
  if [ "$seconds" -le 0 ]; then return 0; fi
  if [ "$COLOR_OUTPUT" = false ]; then
    printf '  %s… %ss\n' "$message" "$seconds"
    interruptible_sleep "$seconds"
    return 0
  fi
  for left in $(seq "$seconds" -1 1); do
    printf '\r  %s%s… %ss %s' "$DIM" "$message" "$left" "$RESET"
    interruptible_sleep 1
  done
  printf '\r\033[K'
}

start_stack() {
  info "Building the API image and starting: $*"
  stack_started=true
  compose up -d --build --wait "$@" >/dev/null
}

list_cases() {
  require_docker
  printf '%sCases in %s%s\n\n' "$BOLD" "$CASES_FILE" "$RESET"
  yq_cases -r '.cases | to_entries | .[] | .key + "\t" + .value.description' |
    while IFS=$'\t' read -r name description; do
      printf '  %s%-16s%s %s\n' "$BOLD" "$name" "$RESET" "$description"
    done
  printf '\nRun one with: ./run.sh case <name>\n'
}

run_case() {
  local name="$1" case_json duration outage_at outage_for k6_pid
  require_docker
  [[ "$name" =~ $CASE_NAME_PATTERN ]] || fail "Invalid case name \"${name}\""

  case_json="$(yq_cases -o=json ".cases[\"${name}\"] | select(. != null) | .name = \"${name}\"")"
  if [ -z "$case_json" ]; then
    printf '%s✗%s Unknown case "%s". Available cases:\n' "$RED" "$RESET" "$name" >&2
    yq_cases -r '.cases | keys | .[]' | sed 's/^/  /' >&2
    exit 1
  fi
  case_dir="$(mktemp -d)"
  printf '%s\n' "$case_json" >"$case_dir/$CASE_JSON"
  chmod -R a+rX "$case_dir"

  duration="$(duration_seconds "$(yq_cases -r ".cases[\"${name}\"].duration")")"
  outage_at="$(yq_cases -r ".cases[\"${name}\"].redis_outage.at // \"\"")"
  outage_for="$(yq_cases -r ".cases[\"${name}\"].redis_outage.for // \"\"")"

  start_stack redis api nginx
  printf '\n%s▸ Case %s%s · %s\n' "$BOLD" "$name" "$RESET" \
    "$(yq_cases -r ".cases[\"${name}\"].description")"

  compose --profile load run --rm -v "${case_dir}:${CASE_MOUNT}:ro" -e COLOR="$COLOR_OUTPUT" \
    k6 run --quiet "$CASE_SCRIPT" &
  k6_pid=$!

  if [ -n "$outage_at" ]; then
    outage_at="$(duration_seconds "$outage_at")"
    outage_for="$(duration_seconds "$outage_for")"
    countdown "$outage_at" "running, Redis goes down in"
    warn "$(printf '%02d:%02d  Redis stopped: the API fails open and the circuit breaker opens' \
      $((outage_at / 60)) $((outage_at % 60)))"
    compose stop redis >/dev/null
    countdown "$outage_for" "Redis comes back in"
    info "$(printf '%02d:%02d  Redis started: the circuit closes after its half-open trial' \
      $(((outage_at + outage_for) / 60)) $(((outage_at + outage_for) % 60)))"
    compose start redis >/dev/null
    countdown $((duration - outage_at - outage_for)) "running"
  else
    countdown "$duration" "running"
  fi

  if wait "$k6_pid"; then return 0; else return 1; fi
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

main() {
  local command="${1:-}"
  trap cleanup EXIT
  trap 'exit 130' INT TERM

  case "$command" in
    cases) list_cases ;;
    case)
      [ -n "${2:-}" ] || fail "Usage: ./run.sh case <name>   (see ./run.sh cases)"
      run_case "$2"
      ;;
    verify) run_case "$VERIFY_CASE" ;;
    demo) run_case "$DEMO_CASE" ;;
    start) run_start ;;
    *)
      usage
      [ -z "$command" ] || exit 1
      ;;
  esac
}

main "$@"
