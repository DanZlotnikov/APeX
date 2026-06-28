"""
Pose processing with MediaPipe Pose Landmarker (Tasks API) + OpenCV.

Reads a video frame-by-frame, detects a single human pose per frame, draws the
landmarks and skeleton connections, and writes a new MP4 with the overlay baked in.

Kept deliberately small and robust for the MVP.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import urllib.request
from dataclasses import dataclass

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

# --- Model management --------------------------------------------------------

MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
MODEL_PATH = os.path.join(MODEL_DIR, "pose_landmarker_lite.task")
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
)

# Reuse MediaPipe's official 33-point connection map for drawing the skeleton.
POSE_CONNECTIONS = mp.solutions.pose.POSE_CONNECTIONS


def ensure_model() -> str:
    """Download the Pose Landmarker model on first run if it isn't present."""
    if not os.path.exists(MODEL_PATH):
        os.makedirs(MODEL_DIR, exist_ok=True)
        print(f"[pose] Downloading model -> {MODEL_PATH}")
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
        print("[pose] Model downloaded.")
    return MODEL_PATH


# --- Result type -------------------------------------------------------------


@dataclass
class ProcessResult:
    output_path: str
    total_frames: int
    frames_with_pose: int
    fps: float
    width: int
    height: int


# --- Drawing helpers ---------------------------------------------------------

_POINT_COLOR = (0, 255, 0)      # BGR green
_LINE_COLOR = (0, 200, 255)     # BGR amber
_VISIBILITY_THRESHOLD = 0.5


def _draw_pose(frame, landmarks, width: int, height: int) -> None:
    """Draw connections then landmark points for one detected pose, in place."""
    # Skeleton lines.
    for start_idx, end_idx in POSE_CONNECTIONS:
        start = landmarks[start_idx]
        end = landmarks[end_idx]
        if start.visibility < _VISIBILITY_THRESHOLD or end.visibility < _VISIBILITY_THRESHOLD:
            continue
        x1, y1 = int(start.x * width), int(start.y * height)
        x2, y2 = int(end.x * width), int(end.y * height)
        cv2.line(frame, (x1, y1), (x2, y2), _LINE_COLOR, 2)

    # Joints.
    for lm in landmarks:
        if lm.visibility < _VISIBILITY_THRESHOLD:
            continue
        cx, cy = int(lm.x * width), int(lm.y * height)
        cv2.circle(frame, (cx, cy), 4, _POINT_COLOR, -1)


# --- Output finalization (browser-friendly H.264) ----------------------------


def _finalize(raw_path: str, output_path: str, fps: float) -> None:
    """Transcode the mp4v overlay to H.264 so it plays in browsers + mobile.

    Falls back to the raw mp4v file if ffmpeg isn't on PATH.
    """
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        print("[pose] ffmpeg not found - keeping mp4v output (may not play in browsers).")
        os.replace(raw_path, output_path)
        return

    cmd = [
        ffmpeg, "-y", "-i", raw_path,
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",  # lets playback start before full download
        "-r", str(fps), "-an",
        output_path,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except (subprocess.CalledProcessError, OSError) as exc:
        print(f"[pose] ffmpeg transcode failed ({exc}); keeping mp4v output.")
        os.replace(raw_path, output_path)
        return
    finally:
        if os.path.exists(raw_path):
            os.remove(raw_path)


# --- Main entry point --------------------------------------------------------


def process_video(input_path: str, output_path: str) -> ProcessResult:
    """Process `input_path`, write an overlaid MP4 to `output_path`, return stats."""
    ensure_model()

    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise ValueError("Could not open the uploaded video. Is it a valid file?")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if fps <= 0:
        fps = 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 640
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 480

    # OpenCV reliably writes mp4v (MPEG-4 Part 2). But browsers (Chrome <video>,
    # hence the Expo web app) only play H.264. So we write mp4v to a temp file and
    # transcode to H.264 with ffmpeg afterwards (see _finalize). If ffmpeg isn't
    # installed we keep the mp4v file and warn.
    raw_path = output_path + ".raw.mp4"
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(raw_path, fourcc, fps, (width, height))
    if not writer.isOpened():
        cap.release()
        raise RuntimeError("Could not open the video writer (codec issue).")

    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=MODEL_PATH),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
    )

    total_frames = 0
    frames_with_pose = 0

    try:
        with vision.PoseLandmarker.create_from_options(options) as landmarker:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                total_frames += 1

                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                timestamp_ms = int((total_frames / fps) * 1000)

                result = landmarker.detect_for_video(mp_image, timestamp_ms)
                if result.pose_landmarks:
                    frames_with_pose += 1
                    _draw_pose(frame, result.pose_landmarks[0], width, height)

                writer.write(frame)
    finally:
        cap.release()
        writer.release()

    if total_frames == 0:
        if os.path.exists(raw_path):
            os.remove(raw_path)
        raise ValueError("The video contained no readable frames.")

    _finalize(raw_path, output_path, fps)

    return ProcessResult(
        output_path=output_path,
        total_frames=total_frames,
        frames_with_pose=frames_with_pose,
        fps=fps,
        width=width,
        height=height,
    )
