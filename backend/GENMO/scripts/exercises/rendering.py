# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""Exercise-specific rendering adjustments — visual-only, never affects rep counting."""
from __future__ import annotations

import numpy as np

from .signals import L_HIP, L_SHOULDER, L_WRIST, R_HIP, R_SHOULDER, R_WRIST


def stabilize_grip_point(joints: np.ndarray) -> np.ndarray:
    """Re-anchor a pull-up sequence on a fixed wrist position instead of the
    model's own (unreliable — see signals.py's wrist_hip_dist comment)
    world translation.

    GEM has no foot-contact signal to anchor absolute translation during a
    hanging exercise, so it ends up attributing most of the real motion to
    arm articulation around a roughly-static torso — visually, the hands
    appear to move up and down while the body stays put, which is backwards:
    physically, the hands are fixed on the bar and the *body* rises to meet
    them. This is a pure per-frame rigid shift (every joint in a frame moves
    by the same offset), so it changes nothing about relative joint
    angles/distances — safe to apply without affecting rep counting, which
    already only looks at those.

    Args:
        joints: (L, 22, 3) world-space joints, already the output of a
            pull-up-classified clip (caller's responsibility to check).

    Returns:
        (L, 22, 3) joints shifted per-frame so the wrist midpoint is constant
        across the clip, at the mean grip position observed while the wrists
        were actually overhead.
    """
    wrist_mid = (joints[:, L_WRIST] + joints[:, R_WRIST]) / 2  # (L, 3)
    shoulder_mid = (joints[:, L_SHOULDER] + joints[:, R_SHOULDER]) / 2
    hip_mid = (joints[:, L_HIP] + joints[:, R_HIP]) / 2
    torso_scale = np.maximum(np.abs(shoulder_mid[:, 1] - hip_mid[:, 1]), 0.20)
    wrist_above = (wrist_mid[:, 1] - shoulder_mid[:, 1]) > torso_scale * 0.22

    if not wrist_above.any():
        return joints  # nothing to anchor to; leave as-is

    grip_point = wrist_mid[wrist_above].mean(axis=0)  # (3,) — where the bar actually is
    offset = grip_point[None, :] - wrist_mid  # (L, 3) — per-frame correction
    return joints + offset[:, None, :]
