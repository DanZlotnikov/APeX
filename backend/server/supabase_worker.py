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
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python supabase_worker.py
"""
from __future__ import annotations

import re
import shutil
import tempfile
import time
import traceback
from pathlib import Path

import supabase_client
import pipeline

POLL_SECONDS = 3.0
JOBS_PER_POLL = 5

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

        try:
            result = pipeline.process_video_two_panel(
                models, str(local_video), tmp_dir / "out",
                cancel_check=lambda: supabase_client.is_cancel_requested(job_id),
            )
        except pipeline.worker.PipelineCancelled:
            print(f"[supabase-worker] {job_id}: cancelled during preprocessing, skipping inference")
            _delete_raw_object_best_effort(job_id, raw_path)
            supabase_client.delete_job(job_id)
            return
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
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
        print(f"[supabase-worker] {job_id}: completed (exercise={result['active_exercise']})")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def main() -> None:
    models = pipeline.worker.load_all_models()
    print("[supabase-worker] ready, polling for queued jobs ...")

    while True:
        try:
            jobs = supabase_client.fetch_queued_jobs(limit=JOBS_PER_POLL)
        except Exception as e:  # noqa: BLE001
            print(f"[supabase-worker] failed to fetch queued jobs: {e}")
            time.sleep(POLL_SECONDS)
            continue

        if not jobs:
            time.sleep(POLL_SECONDS)
            continue

        for job in jobs:
            if not supabase_client.claim_job(job["id"]):
                continue  # claimed/removed by something else since fetch_queued_jobs
            try:
                handle_job(models, job)
            except Exception:  # noqa: BLE001
                traceback.print_exc()
                try:
                    supabase_client.mark_failed(job["id"], "Something went wrong processing this video. Please try again.")
                except Exception:  # noqa: BLE001
                    pass


if __name__ == "__main__":
    main()
