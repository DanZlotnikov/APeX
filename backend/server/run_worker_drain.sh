#!/usr/bin/env bash
# Invoked by the Windows Task Scheduler task every 30 min (see
# APP_STORE_SUBMISSION_PLAN.md §2.1) — drains whatever's queued in
# video_jobs, then exits. Runs inside WSL (Ubuntu-22.04), since that's
# where backend/GENMO/.venv and CUDA/GPU access actually live on this
# machine, not in a native Windows Python.
#
# flock prevents two overlapping runs (e.g. a manual run colliding with a
# scheduled one) from both loading models and hitting the GPU at once; the
# Task Scheduler task itself is also set to IgnoreNew for the same reason.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOCK_FILE="$SCRIPT_DIR/.worker.lock"
LOG_FILE="$SCRIPT_DIR/worker_run.log"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$(date -Iseconds) [run_worker_drain] previous run still in progress, skipping" >> "$LOG_FILE"
  exit 0
fi

{
  echo "=== $(date -Iseconds) run start ==="
  source ../GENMO/.venv/bin/activate
  if [ -f .env ]; then
    # tr -d '\r', not a plain `source .env` — a CRLF-saved .env (easy to end
    # up with on Windows, e.g. opening it in Notepad) leaves a trailing \r
    # baked into each value, which silently corrupts SUPABASE_URL and makes
    # every request fail with "Invalid non-printable ASCII character in
    # URL, '\r' at position N" — confirmed the hard way, not hypothetical.
    set -a
    source <(tr -d '\r' < .env)
    set +a
  fi
  python -u supabase_worker.py --drain
  echo "=== $(date -Iseconds) run end ==="
} >> "$LOG_FILE" 2>&1
