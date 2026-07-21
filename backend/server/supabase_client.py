"""
Thin Supabase REST/Storage client for the async video-processing worker
(supabase_worker.py). Deliberately raw httpx calls against PostgREST
(/rest/v1) and Storage (/storage/v1) rather than the supabase-py SDK — httpx
is already a transitive dependency of this venv (FastAPI pulls it in) and
the worker only needs ~8 narrow operations, not a full SDK.

Always authenticates with the SERVICE ROLE key, never the anon key: the
worker must read/update/delete any athlete's job row and storage object,
which RLS (correctly) forbids for the anon key. This module must never be
imported into anything reachable from the public internet with that key
exposed — it's worker-process-only.

Required environment variables (see HANDOFF_video_pipeline.md at the repo
root for the full schema this assumes):
    SUPABASE_URL               e.g. https://xxxx.supabase.co
    SUPABASE_SERVICE_ROLE_KEY  service_role key (Project Settings -> API)
Optional:
    SUPABASE_JOBS_TABLE        default "video_jobs"
    SUPABASE_STORAGE_BUCKET    default "exercise-videos"
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

import httpx

JOBS_TABLE = os.environ.get("SUPABASE_JOBS_TABLE", "video_jobs")
BUCKET = os.environ.get("SUPABASE_STORAGE_BUCKET", "exercise-videos")


def _config() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set — see "
            "HANDOFF_video_pipeline.md for what the worker needs."
        )
    return url.rstrip("/"), key


def _rest_headers(key: str, *, prefer: str | None = None) -> dict:
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    return headers


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def fetch_queued_jobs(limit: int = 5) -> list[dict]:
    """Oldest-first queued jobs. Returned rows may already have been claimed
    by the time claim_job() runs on them (single worker in practice, but
    claim_job's conditional PATCH makes this safe even if that changes).
    """
    url, key = _config()
    resp = httpx.get(
        f"{url}/rest/v1/{JOBS_TABLE}",
        headers=_rest_headers(key),
        params={"select": "*", "status": "eq.queued", "order": "created_at.asc", "limit": str(limit)},
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.json()


def claim_job(job_id: str) -> bool:
    """Atomically flips status queued -> processing. The `status=eq.queued`
    filter is what makes this a real compare-and-swap: PostgREST only
    updates (and returns) rows matching the full filter, so a job already
    claimed (or removed) by something else yields an empty response here.
    """
    url, key = _config()
    resp = httpx.patch(
        f"{url}/rest/v1/{JOBS_TABLE}",
        headers=_rest_headers(key, prefer="return=representation"),
        params={"id": f"eq.{job_id}", "status": "eq.queued"},
        json={"status": "processing", "started_at": _now_iso()},
        timeout=30.0,
    )
    resp.raise_for_status()
    return len(resp.json()) > 0


def get_job(job_id: str) -> dict | None:
    url, key = _config()
    resp = httpx.get(
        f"{url}/rest/v1/{JOBS_TABLE}",
        headers=_rest_headers(key),
        params={"select": "*", "id": f"eq.{job_id}"},
        timeout=30.0,
    )
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else None


def is_cancel_requested(job_id: str) -> bool:
    """Best-effort cancellation check — see supabase_worker.py's module
    docstring for exactly which points in the pipeline this gets checked at
    and why a mid-GPU-inference cancel can't be interrupted immediately.
    """
    job = get_job(job_id)
    return bool(job and job.get("cancel_requested"))


def mark_completed(job_id: str, result_video_path: str, analysis_json: dict, exercise_type: str | None) -> None:
    url, key = _config()
    resp = httpx.patch(
        f"{url}/rest/v1/{JOBS_TABLE}",
        headers=_rest_headers(key),
        params={"id": f"eq.{job_id}"},
        json={
            "status": "completed",
            "result_video_path": result_video_path,
            "analysis_json": analysis_json,
            "exercise_type": exercise_type,
            "completed_at": _now_iso(),
        },
        timeout=30.0,
    )
    resp.raise_for_status()


def mark_failed(job_id: str, error_message: str) -> None:
    url, key = _config()
    resp = httpx.patch(
        f"{url}/rest/v1/{JOBS_TABLE}",
        headers=_rest_headers(key),
        params={"id": f"eq.{job_id}"},
        json={"status": "failed", "error_message": error_message[:2000], "completed_at": _now_iso()},
        timeout=30.0,
    )
    resp.raise_for_status()


def delete_job(job_id: str) -> None:
    """Used when a job is cancelled mid-processing (see is_cancel_requested)
    — the row is deleted outright rather than parked in some 'cancelled'
    status, matching the app's "removed from everywhere" contract (nothing
    downstream needs to distinguish a cancelled job from one that never
    existed).
    """
    url, key = _config()
    resp = httpx.delete(
        f"{url}/rest/v1/{JOBS_TABLE}",
        headers=_rest_headers(key),
        params={"id": f"eq.{job_id}"},
        timeout=30.0,
    )
    resp.raise_for_status()


def download_object(storage_path: str, dest_path: Path, bucket: str = BUCKET) -> None:
    url, key = _config()
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    with httpx.stream(
        "GET", f"{url}/storage/v1/object/{bucket}/{storage_path}",
        headers=_rest_headers(key), timeout=120.0,
    ) as resp:
        resp.raise_for_status()
        with open(dest_path, "wb") as f:
            for chunk in resp.iter_bytes():
                f.write(chunk)


def upload_object(local_path: Path, storage_path: str, content_type: str, bucket: str = BUCKET) -> None:
    url, key = _config()
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": content_type, "x-upsert": "true"}
    with open(local_path, "rb") as f:
        resp = httpx.post(
            f"{url}/storage/v1/object/{bucket}/{storage_path}",
            headers=headers, content=f.read(), timeout=180.0,
        )
    resp.raise_for_status()


def delete_object(storage_path: str, bucket: str = BUCKET) -> None:
    """Best-effort — a raw upload the app never actually created (e.g. a
    race with a client-side cancel), or one already removed by the app
    itself, is not an error here.

    Uses DELETE /object/{bucket} with a {"prefixes": [...]} body — the same
    request the JS client's storage.from(bucket).remove([path]) sends
    (used successfully elsewhere in this codebase, on the mobile side).
    The single-object DELETE /object/{bucket}/{path} form previously used
    here looks superficially correct but is wrong: confirmed live against
    the real API, it returns HTTP 400 for a missing object (with a
    misleading `{"statusCode":"404",...}` *body* that doesn't match the
    actual response status), so this function's old `!= 404` status check
    never matched and always re-raised. The prefixes form doesn't have that
    problem — confirmed live, it returns 200 with an empty list for a
    missing path instead of erroring at all, so no special-case status
    handling is needed here anymore.
    """
    url, key = _config()
    resp = httpx.request(
        "DELETE", f"{url}/storage/v1/object/{bucket}",
        headers=_rest_headers(key), json={"prefixes": [storage_path]}, timeout=30.0,
    )
    resp.raise_for_status()
