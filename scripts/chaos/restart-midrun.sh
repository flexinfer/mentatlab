#!/usr/bin/env bash
# Robustness kill-test: does an in-flight run survive an orchestrator restart?
#
# Runs the orchestrator natively (go run/build) against a Redis DB so we can
# kill -TERM the process mid-run and restart it pointed at the same store.
# A long-running `sleep` agent node holds the run in `running` state while we
# inject the fault.
#
# Usage:
#   scripts/chaos/restart-midrun.sh [redis|memory]
#
# Env:
#   REDIS_URL   default redis://localhost:6379/15  (DB 15 to stay isolated)
#   PORT        default 7071 (avoid colliding with a running stack on 7070)
#   SLEEP_SECONDS default 60
set -uo pipefail

MODE="${1:-redis}"
PORT="${PORT:-7071}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379/15}"
SLEEP_SECONDS="${SLEEP_SECONDS:-60}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ORCH_DIR="$REPO_ROOT/services/orchestrator-go"
AGENT="$REPO_ROOT/agents/sleep/main.py"
BIN="${TMPDIR:-/tmp}/mentatlab-orch-chaos"
BASE="http://localhost:$PORT"

log() { printf '\033[1;36m[chaos]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[chaos]\033[0m %s\n' "$*" >&2; }

ORCH_PID=""
start_orch() {
  ORCH_RUNSTORE="$MODE" REDIS_URL="$REDIS_URL" ORCH_DRIVER=subprocess \
    PORT="$PORT" ORCH_ALLOW_MEMORY_FALLBACK=true \
    "$BIN" >"${TMPDIR:-/tmp}/orch-chaos.log" 2>&1 &
  ORCH_PID=$!
}
wait_ready() {
  for _ in $(seq 1 50); do
    curl -fsS -m 2 "$BASE/healthz" >/dev/null 2>&1 && return 0
    sleep 0.3
  done
  return 1
}
cleanup() {
  [ -n "$ORCH_PID" ] && kill "$ORCH_PID" 2>/dev/null
  wait "$ORCH_PID" 2>/dev/null
}
trap cleanup EXIT

log "building orchestrator -> $BIN"
( cd "$ORCH_DIR" && go build -o "$BIN" ./cmd/orchestrator/ ) || { err "build failed"; exit 1; }

log "mode=$MODE redis_url=$REDIS_URL port=$PORT"
start_orch
wait_ready || { err "orchestrator did not become ready"; cat "${TMPDIR:-/tmp}/orch-chaos.log"; exit 1; }
log "orchestrator up (pid=$ORCH_PID)"

PLAN=$(cat <<JSON
{
  "name": "chaos-restart-midrun",
  "auto_start": true,
  "plan": {
    "nodes": [
      {
        "id": "sleeper",
        "type": "agent",
        "command": ["python3", "$AGENT"],
        "env": {"SLEEP_SECONDS": "$SLEEP_SECONDS", "EMIT_INTERVAL": "1.0"}
      }
    ]
  }
}
JSON
)

log "creating run (sleeper holds running for ${SLEEP_SECONDS}s)"
CREATE=$(curl -fsS -m 10 -X POST "$BASE/api/v1/runs" \
  -H 'Content-Type: application/json' -d "$PLAN")
echo "  create response: $CREATE"
RUN_ID=$(printf '%s' "$CREATE" | sed -n 's/.*"run_id"[: ]*"\([^"]*\)".*/\1/p')
[ -z "$RUN_ID" ] && RUN_ID=$(printf '%s' "$CREATE" | sed -n 's/.*"runId"[: ]*"\([^"]*\)".*/\1/p')
[ -z "$RUN_ID" ] && { err "could not parse run_id"; exit 1; }
log "run_id=$RUN_ID"

# Wait until the run + node are actually running.
for _ in $(seq 1 30); do
  STATUS=$(curl -fsS -m 5 "$BASE/api/v1/runs/$RUN_ID" 2>/dev/null)
  echo "  pre-restart: $STATUS" | head -c 400; echo
  printf '%s' "$STATUS" | grep -q '"running"' && break
  sleep 0.5
done

log ">>> INJECTING FAULT: kill -TERM orchestrator (pid=$ORCH_PID) mid-run"
kill -TERM "$ORCH_PID" 2>/dev/null
wait "$ORCH_PID" 2>/dev/null
OLD_PID="$ORCH_PID"; ORCH_PID=""
sleep 1

log "restarting orchestrator against same store"
start_orch
wait_ready || { err "orchestrator did not come back"; cat "${TMPDIR:-/tmp}/orch-chaos.log"; exit 1; }
log "orchestrator back up (pid=$ORCH_PID, was $OLD_PID)"

log "querying run AFTER restart"
HTTP_AND_BODY=$(curl -sS -m 5 -w '\n__HTTP__%{http_code}' "$BASE/api/v1/runs/$RUN_ID")
HTTP_CODE=$(printf '%s' "$HTTP_AND_BODY" | sed -n 's/.*__HTTP__//p')
POST_BODY=$(printf '%s' "$HTTP_AND_BODY" | sed 's/__HTTP__[0-9]*$//')
echo "  http_code=$HTTP_CODE"
echo "  post-restart run: $POST_BODY" | head -c 600; echo

echo
log "===== VERDICT INPUTS ====="
echo "mode=$MODE"
echo "post_restart_http=$HTTP_CODE  (404 => run VANISHED; 200 => state persisted)"
echo "post_restart_status=$(printf '%s' "$POST_BODY" | sed -n 's/.*"status"[: ]*"\([^"]*\)".*/\1/p')"
echo "(watch for: still 'running' with no progress => no resume-on-restart)"

# Observe for a few seconds whether anything resumes the run.
sleep 5
AFTER=$(curl -fsS -m 5 "$BASE/api/v1/runs/$RUN_ID" 2>/dev/null)
echo "post_restart_status_after_5s=$(printf '%s' "$AFTER" | sed -n 's/.*"status"[: ]*"\([^"]*\)".*/\1/p')"
