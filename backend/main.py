"""
APeX (Athlete Performance Excellence) - backend.

FastAPI service that accepts a video upload, runs MediaPipe Pose Landmarker over
it, and returns a URL to a processed MP4 with the skeleton drawn on the athlete.

Run locally:
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

from __future__ import annotations

import os
import shutil
import uuid

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from pose_processor import process_video

# --- Storage layout ----------------------------------------------------------

BASE_DIR = os.path.dirname(__file__)
STORAGE_DIR = os.path.join(BASE_DIR, "storage")
UPLOAD_DIR = os.path.join(STORAGE_DIR, "uploads")
OUTPUT_DIR = os.path.join(STORAGE_DIR, "processed")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# --- App ---------------------------------------------------------------------

app = FastAPI(title="APeX Backend", version="0.1.0")

# Wide-open CORS for local dev (mobile app + web run from various origins).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Processed videos are served as static files: GET /videos/<name>.mp4
app.mount("/videos", StaticFiles(directory=OUTPUT_DIR), name="videos")


@app.get("/")
def health() -> dict:
    return {"status": "ok", "service": "apex"}


@app.post("/process-video")
async def process_video_endpoint(request: Request, file: UploadFile = File(...)) -> dict:
    """Accept a video, draw pose landmarks on every frame, return the result URL."""
    job_id = uuid.uuid4().hex
    suffix = os.path.splitext(file.filename or "")[1].lower() or ".mp4"
    input_path = os.path.join(UPLOAD_DIR, f"{job_id}{suffix}")
    output_name = f"{job_id}.mp4"
    output_path = os.path.join(OUTPUT_DIR, output_name)

    # Persist the upload.
    try:
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    finally:
        await file.close()

    # Process it.
    try:
        result = process_video(input_path, output_path)
    except ValueError as exc:  # bad/unreadable input
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # processing failure
        raise HTTPException(status_code=500, detail=f"Processing failed: {exc}")
    finally:
        # Keep storage tidy; we only need the processed output.
        if os.path.exists(input_path):
            os.remove(input_path)

    base = str(request.base_url).rstrip("/")
    return {
        "processed_url": f"{base}/videos/{output_name}",
        "total_frames": result.total_frames,
        "frames_with_pose": result.frames_with_pose,
        "fps": round(result.fps, 2),
        "width": result.width,
        "height": result.height,
    }
