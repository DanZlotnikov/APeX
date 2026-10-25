"""
Production worker for the mobile app's video-processing flow.

This is the Supabase-backed counterpart to backend/GENMO/scripts/worker.py's
local-folder queue: instead of watching a directory for dropped files, it
polls the `video_jobs` table for status='queued' rows, claims one, downloads
the athlete's raw upload from Supabase Storage, runs the exact same
pipeline.process_video_two_panel() the FastAPI /process endpoint uses
(app.py stays in place as a manual/dev-testing entrypoint — this file is
what the app actually depends on in production), uploads the result video,
and writes the biomechanical analysis JSON back onto the row.

See HANDOFF_video_pipeline.md at the repo root for the full `video_jobs`
schema and storage-bucket layout this assumes, and for what the mobile/
Supabase side is responsible for around it.

── Cancellation ───────────────────────────────────────────────────────────
The app signals cancellation by setting `cancel_requested = true` on the
row (see supabase_client.is_cancel_requested). This worker checks that flag
at three points: right after claiming (before downloading anything), once
more right after preprocessing finishes but before the expensive GEM
inference call (via the cancel_check callback threaded into
pipeline.process_video_two_panel -> worker.run_core_pipeline, which raises
worker.PipelineCancelled if it fires), and right after the pipeline
finishes entirely (before uploading the result). It still can't interrupt
a running GPU inference call mid-flight, so a cancel that arrives during
inference itself isn't caught until that call returns — but the
preprocessing-stage check means a cancel that arrives earlier (the common
case, since inference is a small fraction of total processing time) skips
the costliest part instead of paying for it and discarding the result
anyway.

Usage:
    cd backend/server && source ../GENMO/.venv/bin/activate
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python supabase_worker.py [mode]

Three run modes, models are loaded once at startup either way (~90s), never
per-job or per-cycle:

  (no flag)              Continuous — checks for new jobs every
                          POLL_SECONDS, forever, until you stop it (Ctrl+C).
  --interval-minutes N   Also runs forever, but only checks every N minutes
                          when idle instead of every few seconds — e.g.
                          --interval-minutes 30 for an every-30-min cadence,
                          self-contained in one long-lived process (no OS
                          scheduler needed to get this behavior).
  --drain                Exits once the queue is empty (or after repeated
                          fetch failures) instead of running forever — for
                          an EXTERNAL scheduler that relaunches this script
                          periodically (see run_worker_drain.sh and
                          APP_STORE_SUBMISSION_PLAN.md §2.1), so each
                          relaunch loads the models once, drains, and exits
                          rather than idling/overlapping with the next
                          trigger. --interval-minutes is the alternative to
                          this that doesn't need an external scheduler at
                          all — pick one or the other, not both.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import tempfile
import time
import traceback
from pathlib import Path

import supabase_client
import pipeline

POLL_SECONDS = 3.0
JOBS_PER_POLL = 5

# A CUDA context that has gone bad (seen after a GPU reset or sleep: "CUDA
# error: unknown error" the first time a model touches the GPU) stays bad for
# the life of the process, so every later job would fail too while the models
# in memory look fine. The GPU itself is usually healthy again, so the fix is
# a fresh process: exit, and run_worker_continuous.sh starts a new worker that
# reclaims the job (it is left in 'processing', see reclaim_stale_processing_jobs).
# Each job gets this restart at most GPU_RESTARTS_PER_JOB times, so a video that
# deterministically trips a CUDA error ends up marked failed instead of looping.
GPU_ERROR_MARKERS = ("CUDA error", "cudaError", "CUBLAS_STATUS", "CUDNN_STATUS", "device-side assert", "illegal memory access")
GPU_RESTARTS_PER_JOB = 2
GPU_RESTART_FILE = Path(__file__).with_name(".gpu_restarts.json")
EXIT_GPU_CONTEXT_LOST = 75


class GpuContextLost(Exception):
    pass


def _is_gpu_failure(exc: BaseException) -> bool:
    text = f"{type(exc).__name__}: {exc}"
    return any(marker in text for marker in GPU_ERROR_MARKERS)


def _count_gpu_restart(job_id: str) -> int:
    """Records one more GPU-triggered restart for this job and returns the new count."""
    try:
        counts = json.loads(GPU_RESTART_FILE.read_text())
    except Exception:  # noqa: BLE001 - missing or unreadable file just means no history
        counts = {}
    counts[job_id] = counts.get(job_id, 0) + 1
    try:
        GPU_RESTART_FILE.write_text(json.dumps(counts))
    except Exception:  # noqa: BLE001
        pass
    return counts[job_id]

# A real (even near-instant) mp4 recording still has header/moov data — an
# empty or near-empty download means the upload itself was bad (confirmed on
# real traffic: a 0-byte raw_video_path from the app crashed deep inside
# pyav with an opaque "Invalid argument" seek error instead of a clear
# message). Catching this before handing the file to the pipeline turns that
# into an immediate, readable error_message instead of a stack trace.
MIN_VIDEO_BYTES = 1024

# Defense-in-depth alongside the DB-level CHECK constraint (see migration
# 019_security_hardening.sql): raw_video_path is client-supplied at INSERT
# time and gets interpolated directly into a Storage URL fetched with the
# SERVICE ROLE key (supabase_client.download_object/delete_object). Without
# this check, a crafted path could read/delete another athlete's video (IDOR)
# or, via URL dot-segment normalization, escape the Storage API entirely and
# hit arbitrary REST/Storage/Auth-admin endpoints with an admin credential.
# The DB constraint is the authoritative fix (protects every INSERT path,
# present and future); this is a second, independent check specifically so
# the worker never even attempts the request if the constraint is somehow
# missing (e.g. migration 019 not yet applied) or ever weakened by accident.
def _validate_raw_path(athlete_id: str, raw_path: str) -> bool:
    pattern = rf"^raw/{re.escape(athlete_id)}/[A-Za-z0-9_-]+\.[A-Za-z0-9]{{2,5}}$"
    return re.match(pattern, raw_path) is not None


def _result_storage_path(athlete_id: str, job_id: str) -> str:
    return f"processed/{athlete_id}/{job_id}/two_panel.mp4"


def _delete_raw_object_best_effort(job_id: str, raw_path: str) -> None:
    """Storage cleanup on a cancellation path must never turn into a
    mark_failed — a job the athlete already dismissed shouldn't reappear as
    a visibly failed one just because deleting its raw upload hit a
    transient/unexpected error. Logged and swallowed; delete_job (removing
    the row) always proceeds regardless.
    """
    try:
        supabase_client.delete_object(raw_path)
    except Exception as e:  # noqa: BLE001
        print(f"[supabase-worker] {job_id}: failed to delete raw object during cancel cleanup (non-fatal): {e}")


def handle_job(models: "pipeline.worker.Models", job: dict) -> None:
    job_id = job["id"]
    athlete_id = job["athlete_id"]
    raw_path = job["raw_video_path"]

    if not _validate_raw_path(athlete_id, raw_path):
        # Never touch Storage with this value — see _validate_raw_path's
        # docstring. This should be unreachable once migration 019's CHECK
        # constraint is applied (the INSERT itself would be rejected), but
        # the worker must not trust that alone.
        print(f"[supabase-worker] {job_id}: rejected malformed raw_video_path (not touching Storage): {raw_path!r}")
        supabase_client.mark_failed(job_id, "Upload could not be verified. Please try recording again.")
        return

    if supabase_client.is_cancel_requested(job_id):
        print(f"[supabase-worker] {job_id}: cancelled before starting")
        _delete_raw_object_best_effort(job_id, raw_path)
        supabase_client.delete_job(job_id)
        return

    tmp_dir = Path(tempfile.mkdtemp(prefix=f"job_{job_id}_"))
    try:
        local_video = tmp_dir / "input.mp4"
        try:
            supabase_client.download_object(raw_path, local_video)
        except Exception as e:  # noqa: BLE001
            # Full detail server-side only — str(e) can include internal
            # paths/library internals and must never reach the athlete's
            # screen (video_jobs.error_message is rendered verbatim by
            # ProcessingScreen.tsx).
            print(f"[supabase-worker] {job_id}: download failed: {e}")
            supabase_client.mark_failed(job_id, "Could not download the uploaded video. Please try again.")
            return

        size = local_video.stat().st_size if local_video.exists() else 0
        if size < MIN_VIDEO_BYTES:
            supabase_client.mark_failed(
                job_id, f"downloaded video is empty or too small ({size} bytes) - the upload itself is bad, not the pipeline"
            )
            return

        sport_key = supabase_client.get_effective_sport(athlete_id)
        handedness = supabase_client.get_handedness(athlete_id)
        try:
            result = pipeline.process_video_two_panel(
                models, str(local_video), tmp_dir / "out",
                cancel_check=lambda: supabase_client.is_cancel_requested(job_id),
                sport_key=sport_key, handedness=handedness,
            )
        except pipeline.worker.PipelineCancelled:
            print(f"[supabase-worker] {job_id}: cancelled during preprocessing, skipping inference")
            _delete_raw_object_best_effort(job_id, raw_path)
            supabase_client.delete_job(job_id)
            return
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            if _is_gpu_failure(e) and _count_gpu_restart(job_id) <= GPU_RESTARTS_PER_JOB:
                print(f"[supabase-worker] {job_id}: GPU context unusable, restarting the worker; the job stays queued for the new process")
                raise GpuContextLost() from e
            supabase_client.mark_failed(job_id, "Processing this video failed. Please try recording again.")
            return

        if supabase_client.is_cancel_requested(job_id):
            print(f"[supabase-worker] {job_id}: cancelled after processing, discarding result")
            _delete_raw_object_best_effort(job_id, raw_path)
            supabase_client.delete_job(job_id)
            return

        result_path = _result_storage_path(athlete_id, job_id)
        try:
            supabase_client.upload_object(Path(result["output_path"]), result_path, "video/mp4")
        except Exception as e:  # noqa: BLE001
            print(f"[supabase-worker] {job_id}: result upload failed: {e}")
            supabase_client.mark_failed(job_id, "Could not save the processed video. Please try again.")
            return

        supabase_client.mark_completed(job_id, result_path, result["analysis"], result["active_exercise"])
        if not result["person_detected"]:
            print(f"[supabase-worker] {job_id}: completed (no person detected in video)")
        elif result["active_exercise"] is None:
            print(f"[supabase-worker] {job_id}: completed (person detected, no exercise recognized)")
        else:
            print(f"[supabase-worker] {job_id}: completed (exercise={result['active_exercise']})")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def main(drain_on_idle: bool = False, idle_sleep_seconds: float = POLL_SECONDS) -> None:
    models = pipeline.worker.load_all_models()

    try:
        reclaimed = supabase_client.reclaim_stale_processing_jobs()
        if reclaimed:
            print(f"[supabase-worker] reclaimed {len(reclaimed)} orphaned job(s) stuck in processing: {reclaimed}")
    except Exception as e:  # noqa: BLE001
        # Non-fatal — worst case an orphaned job waits for the next startup
        # to be reclaimed instead of this one, not worth crashing over.
        print(f"[supabase-worker] failed to check for orphaned processing jobs (non-fatal): {e}")

    if drain_on_idle:
        print("[supabase-worker] ready (drain mode — exits once the queue is empty) ...")
    elif idle_sleep_seconds != POLL_SECONDS:
        print(f"[supabase-worker] ready, checking for queued jobs every {idle_sleep_seconds / 60:g} min ...")
    else:
        print("[supabase-worker] ready, polling for queued jobs ...")

    # In drain mode, a fetch that keeps failing (bad/missing credentials, Supabase
    # unreachable) must not retry forever the way the other two modes deliberately
    # do — a scheduled run has to actually exit so the next trigger (and Task
    # Scheduler's restart-on-failure policy) can take over. A few retries first so a
    # single transient blip doesn't waste an entire scheduled run. Always retried at
    # the short POLL_SECONDS interval regardless of mode — an error should be
    # retried quickly, unlike a merely-empty queue in --interval-minutes mode.
    consecutive_fetch_failures = 0

    while True:
        try:
            jobs = supabase_client.fetch_queued_jobs(limit=JOBS_PER_POLL)
            consecutive_fetch_failures = 0
        except Exception as e:  # noqa: BLE001
            print(f"[supabase-worker] failed to fetch queued jobs: {e}")
            if drain_on_idle:
                consecutive_fetch_failures += 1
                if consecutive_fetch_failures >= 3:
                    print("[supabase-worker] repeated fetch failures, exiting (--drain)")
                    sys.exit(1)
            time.sleep(POLL_SECONDS)
            continue

        if not jobs:
            if drain_on_idle:
                print("[supabase-worker] queue empty, exiting (--drain)")
                return
            time.sleep(idle_sleep_seconds)
            continue

        for job in jobs:
            if not supabase_client.claim_job(job["id"]):
                continue  # claimed/removed by something else since fetch_queued_jobs
            try:
                handle_job(models, job)
            except GpuContextLost:
                sys.exit(EXIT_GPU_CONTEXT_LOST)
            except Exception:  # noqa: BLE001
                traceback.print_exc()
                try:
                    supabase_client.mark_failed(job["id"], "Something went wrong processing this video. Please try again.")
                except Exception:  # noqa: BLE001
                    pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="APeX Supabase video_jobs worker")
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument(
        "--drain", action="store_true",
        help="Exit once the queue is empty (or after repeated fetch failures) instead of "
             "running forever. For an external scheduler that relaunches this script "
             "periodically (see run_worker_drain.sh).",
    )
    mode_group.add_argument(
        "--interval-minutes", type=float, default=None,
        help="Run forever, checking for new jobs every N minutes when idle instead of every "
             f"{POLL_SECONDS:g}s — e.g. 30 for an every-30-min cadence in one long-lived "
             "process. Omit both flags for the default: check continuously.",
    )
    args = parser.parse_args()

    if args.drain:
        main(drain_on_idle=True)
    elif args.interval_minutes is not None:
        main(idle_sleep_seconds=args.interval_minutes * 60)
    else:
        main()
