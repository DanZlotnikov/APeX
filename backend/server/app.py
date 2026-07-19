"""
APeX pose-processing server.

For now, accepts a *local* filesystem path to a video (the `video_path`
field is deliberately named generically — it will later accept a cloud
storage URL too, once videos are actually uploaded from the app instead of
being dropped in a local folder). Runs the full GEM pose pipeline plus
exercise counting, and writes a two-panel video (original | skeleton with
rep counter) to backend/server/outputs/<video_stem>/two_panel.mp4.

Usage:
    cd backend/server && source ../GENMO/.venv/bin/activate
    python -m uvicorn app:app --host 0.0.0.0 --port 8000

Model loading (~90s) happens once at server startup, not per-request — see
pipeline.py / worker.load_all_models() for why that matters.
"""
from __future__ import annotations

import traceback
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import pipeline

OUTPUT_ROOT = Path(__file__).resolve().parent / "outputs"

app = FastAPI(title="APeX Pose Server")
_models = None


@app.on_event("startup")
def _load_models() -> None:
    global _models
    _models = pipeline.worker.load_all_models()
    print("[server] ready.")


class ProcessRequest(BaseModel):
    video_path: str  # local filesystem path for now


class ProcessResponse(BaseModel):
    output_path: str
    counts: dict
    active_exercise: str | None
    frames: int
    timing_s: dict


@app.get("/health")
def health():
    return {"status": "ok", "models_loaded": _models is not None}


@app.post("/process", response_model=ProcessResponse)
def process(req: ProcessRequest):
    if _models is None:
        raise HTTPException(status_code=503, detail="models still loading, try again shortly")

    video_path = Path(req.video_path)
    if not video_path.is_absolute():
        raise HTTPException(status_code=400, detail="video_path must be an absolute path")
    if not video_path.exists():
        raise HTTPException(status_code=404, detail=f"video not found: {req.video_path}")

    output_dir = OUTPUT_ROOT / video_path.stem
    try:
        result = pipeline.process_video_two_panel(_models, str(video_path), output_dir)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()  # full traceback to server.log — the HTTP detail alone is often too terse to debug
        raise HTTPException(status_code=500, detail=f"processing failed: {e}") from e
    return result
