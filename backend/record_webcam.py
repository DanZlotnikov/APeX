"""
Record a short clip from the PC webcam to an H.264 MP4 (dev helper).

The Expo *web* app's in-app video recording is browser-dependent and unreliable,
so this is the guaranteed way to capture from your computer camera. Record a clip,
then load it in the app with "Choose Test Video" and press "Process Video".

Usage (from the backend folder, with the venv active):
    python record_webcam.py                 # 8s -> ../samples/my_recording.mp4
    python record_webcam.py --seconds 6
    python record_webcam.py --camera 1 --output ../samples/clip.mp4

Press 'q' in the preview window to stop early.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time

import cv2

DEFAULT_OUTPUT = os.path.join(os.path.dirname(__file__), "..", "samples", "my_recording.mp4")


def _transcode_to_h264(raw_path: str, final_path: str, fps: float) -> None:
    """H.264 so the app (and browser preview) can play it; fallback to raw."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        print("[rec] ffmpeg not found - keeping raw mp4v (browser preview may fail).")
        os.replace(raw_path, final_path)
        return
    cmd = [
        ffmpeg, "-y", "-i", raw_path,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        "-r", str(fps), "-an", final_path,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
    finally:
        if os.path.exists(raw_path):
            os.remove(raw_path)


def record(seconds: float, output: str, camera_index: int) -> None:
    # CAP_DSHOW opens Windows webcams much faster/more reliably.
    cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        print(f"[rec] Could not open camera index {camera_index}. Try --camera 1.")
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0 or fps > 60:
        fps = 30.0  # many webcams misreport fps
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 640
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 480

    os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
    raw_path = output + ".raw.mp4"
    writer = cv2.VideoWriter(raw_path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))

    print(f"[rec] Recording {seconds:.0f}s from camera {camera_index} "
          f"({width}x{height} @ {fps:.0f}fps). Press 'q' to stop early.")

    start = time.time()
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            writer.write(frame)

            elapsed = time.time() - start
            remaining = max(0, seconds - elapsed)
            label = f"REC  {remaining:0.1f}s left  (press q to stop)"
            cv2.circle(frame, (24, 28), 8, (0, 0, 255), -1)
            cv2.putText(frame, label, (44, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                        (255, 255, 255), 2, cv2.LINE_AA)
            cv2.imshow("Recording - press q to stop", frame)

            if elapsed >= seconds or (cv2.waitKey(1) & 0xFF) == ord("q"):
                break
    finally:
        cap.release()
        writer.release()
        cv2.destroyAllWindows()

    _transcode_to_h264(raw_path, output, fps)
    print(f"[rec] Saved: {os.path.abspath(output)}")
    print("[rec] Now open the app, tap 'Choose Test Video', pick this file, then 'Process Video'.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Record a clip from the PC webcam.")
    parser.add_argument("--seconds", type=float, default=8.0)
    parser.add_argument("--output", type=str, default=DEFAULT_OUTPUT)
    parser.add_argument("--camera", type=int, default=0)
    args = parser.parse_args()
    record(args.seconds, args.output, args.camera)
