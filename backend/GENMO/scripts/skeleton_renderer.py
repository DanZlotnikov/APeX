# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Lightweight skeleton-only 3D-space renderer with a rep-counter HUD.

Deliberately doesn't use Open3D/Filament (the mesh renderer used for
1_incam.mp4 / 2_global.mp4) — that renderer is fragile under WSL's GPU
passthrough (needed a software-rendering workaround earlier), and a
skeleton (22 points + ~21 line segments per frame) doesn't need a full mesh
rasterizer anyway. This does its own simple pinhole-camera projection with
numpy and draws with OpenCV: joints as dots, bones as lines, a ground-plane
grid for spatial reference, and the rep counter as text in the top-left.
"""
from __future__ import annotations

import cv2
import numpy as np

from exercises.signals import SMPL_PARENTS

# APeX's own design language (see mobile/src/theme.ts): dark navy background,
# teal accent — keeps this renderer visually consistent with the app.
BG_COLOR = (28, 16, 7)        # BGR for #07101C
BONE_COLOR = (188, 212, 0)    # BGR for a teal similar to #00D4BC
JOINT_COLOR = (255, 255, 255)
GRID_COLOR = (70, 55, 40)
TEXT_COLOR = (188, 212, 0)

LABELS = {
    "squat": "SQUATS", "deadlift": "DEADLIFTS", "vertical_jump": "JUMPS",
    "pull_up": "PULL-UPS", "push_up": "PUSH-UPS", "ab_crunch": "CRUNCHES",
    None: "REPS",
}


def _look_at(eye: np.ndarray, target: np.ndarray, up: np.ndarray) -> np.ndarray:
    """3x3 camera rotation matrix (world -> camera axes as rows)."""
    z = eye - target
    z = z / np.linalg.norm(z)
    x = np.cross(up, z)
    x = x / np.linalg.norm(x)
    y = np.cross(z, x)
    return np.stack([x, y, z], axis=0)  # (3, 3)


class SkeletonCamera:
    """Fixed 3/4-view virtual camera, auto-framed to fit the whole clip's motion."""

    def __init__(self, joints: np.ndarray, canvas_w: int, canvas_h: int):
        # joints: (L, 22, 3) — used only to auto-frame the camera once.
        self.w, self.h = canvas_w, canvas_h
        flat = joints.reshape(-1, 3)
        center = (flat.min(0) + flat.max(0)) / 2
        extent = np.linalg.norm(flat.max(0) - flat.min(0))
        extent = max(extent, 0.5)

        azimuth, elevation = np.radians(35), np.radians(18)
        # 0.9x the joints' own extent, not a looser 1.6x — tightened to read
        # visually closer to the real-video panel's crop padding (25% around
        # the athlete's 2D bbox, see pipeline.py's CROP_PAD_FRAC) instead of
        # an independently-tuned, uncoordinated "zoom out" heuristic that
        # left noticeably more empty grid space around the skeleton than the
        # tight athlete crop on the other panel. Tuned empirically against
        # real footage (a 2D crop's padding and a 3D perspective camera's
        # framing aren't analytically equivalent) — re-check visually if
        # this ever needs adjusting again.
        dist = extent * 0.9
        offset = dist * np.array([
            np.cos(elevation) * np.sin(azimuth),
            np.sin(elevation),
            np.cos(elevation) * np.cos(azimuth),
        ])
        self.eye = center + offset
        self.target = center
        self.up = np.array([0.0, 1.0, 0.0])
        self.R = _look_at(self.eye, self.target, self.up)

        focal = 0.9 * min(canvas_w, canvas_h)
        self.focal = focal
        self.floor_y = float(flat[:, 1].min())

    def project(self, pts: np.ndarray) -> np.ndarray:
        """pts: (..., 3) world -> (..., 2) pixel coords."""
        cam = (pts - self.eye) @ self.R.T  # camera space, +z is behind the camera
        depth = np.maximum(-cam[..., 2], 1e-3)
        x = cam[..., 0] * self.focal / depth + self.w / 2
        y = -cam[..., 1] * self.focal / depth + self.h / 2
        return np.stack([x, y], axis=-1)


def _draw_ground_grid(canvas: np.ndarray, cam: SkeletonCamera, half_extent: float = 2.0, step: float = 0.5) -> None:
    n = int(half_extent / step)
    for i in range(-n, n + 1):
        a = cam.project(np.array([i * step, cam.floor_y, -half_extent]))
        b = cam.project(np.array([i * step, cam.floor_y, half_extent]))
        cv2.line(canvas, tuple(a.astype(int)), tuple(b.astype(int)), GRID_COLOR, 1, cv2.LINE_AA)
        a = cam.project(np.array([-half_extent, cam.floor_y, i * step]))
        b = cam.project(np.array([half_extent, cam.floor_y, i * step]))
        cv2.line(canvas, tuple(a.astype(int)), tuple(b.astype(int)), GRID_COLOR, 1, cv2.LINE_AA)


def render_skeleton_frames(
    joints: np.ndarray,
    rep_key: str | None,
    cumulative_counts: np.ndarray,
    canvas_w: int = 960,
    canvas_h: int = 720,
) -> np.ndarray:
    """joints: (L, 22, 3) world-space. Returns (L, canvas_h, canvas_w, 3) RGB uint8."""
    L = joints.shape[0]
    cam = SkeletonCamera(joints, canvas_w, canvas_h)
    label = LABELS.get(rep_key, "REPS")

    out = np.empty((L, canvas_h, canvas_w, 3), dtype=np.uint8)
    for i in range(L):
        canvas = np.full((canvas_h, canvas_w, 3), BG_COLOR, dtype=np.uint8)
        _draw_ground_grid(canvas, cam)

        pts2d = cam.project(joints[i]).astype(int)  # (22, 2)

        for j, parent in enumerate(SMPL_PARENTS):
            if parent < 0:
                continue
            cv2.line(canvas, tuple(pts2d[j]), tuple(pts2d[parent]), BONE_COLOR, 3, cv2.LINE_AA)
        for j in range(22):
            cv2.circle(canvas, tuple(pts2d[j]), 5, JOINT_COLOR, -1, cv2.LINE_AA)

        count = int(cumulative_counts[i]) if rep_key is not None else 0
        cv2.putText(canvas, label, (24, 44), cv2.FONT_HERSHEY_SIMPLEX, 0.9, TEXT_COLOR, 2, cv2.LINE_AA)
        cv2.putText(canvas, str(count), (24, 100), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (255, 255, 255), 4, cv2.LINE_AA)

        out[i] = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)
    return out
