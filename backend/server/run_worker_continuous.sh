#!/usr/bin/env bash
# Invoked by the Windows Task Scheduler task "APeX Worker" (at logon, and
# every 5 min as a watchdog) — runs supabase_worker.py in continuous mode so
# uploads are picked up within seconds instead of on run_worker_drain.sh's
# 30-min cadence. Runs inside WSL for the same reasons as that script.
#
# Shares run_worker_drain.sh's lock file: a watchdog relaunch while the worker
# is already running (or a drain run) exits immediately instead of loading a
# second copy of the models onto the GPU.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOCK_FILE="$SCRIPT_DIR/.worker.lock"
LOG_FILE="$SCRIPT_DIR/worker_continuous.log"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

{
  echo "=== $(date -Iseconds) continuous worker start ==="
  source ../GENMO/.venv/bin/activate
  if [ -f .env ]; then
    # tr -d '\r': see run_worker_drain.sh — a CRLF-saved .env corrupts every value.
    set -a
    source <(tr -d '\r' < .env)
    set +a
  fi
  python -u supabase_worker.py
  echo "=== $(date -Iseconds) continuous worker exited ($?) ==="
} >> "$LOG_FILE" 2>&1
