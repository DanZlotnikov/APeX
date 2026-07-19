# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Zero-phase jitter smoothing for per-frame keypoint detections.

ViTPose-H runs independently on every frame — there's no temporal model
enforcing consistency between adjacent frames, so small detector noise
shows up as visible jitter even though the underlying motion is smooth.

A causal filter (moving average, exponential smoothing, One-Euro) would fix
that but introduces lag: it only ever sees past frames, so it reacts to a
fast real movement a few frames late. Since this runs offline on an already
-recorded clip (not live), we don't need causality — a zero-phase Butterworth
low-pass filter (via `scipy.signal.filtfilt`) processes the sequence forward
*and* backward and averages the result, which cancels phase delay entirely.
No lag, by construction, on any movement speed.

The cutoff frequency is the only real tuning knob: anything faster than
`cutoff_hz` is treated as noise and attenuated; anything slower passes
through close to unchanged. 6 Hz is the standard default in biomechanics
literature for human movement (Winter, "Biomechanics and Motor Control of
Human Movement") — squats/jumps/pull-ups all sit well under that, while
frame-to-frame detector noise tends to be higher frequency.
"""
from __future__ import annotations

import numpy as np
import torch
from scipy.signal import butter, filtfilt

DEFAULT_CUTOFF_HZ = 6.0
DEFAULT_ORDER = 4


def smooth_keypoints_zero_phase(
    kp2d: torch.Tensor,
    fps: float = 30.0,
    cutoff_hz: float = DEFAULT_CUTOFF_HZ,
    order: int = DEFAULT_ORDER,
) -> torch.Tensor:
    """Zero-phase low-pass smoothing of (x, y) keypoint trajectories.

    Args:
        kp2d: (L, J, 3) tensor — [x, y, confidence] per joint per frame.
        fps: video frame rate (sets the Nyquist frequency for the filter).
        cutoff_hz: frequencies above this are attenuated as jitter.
        order: Butterworth filter order (steepness of the cutoff rolloff).

    Returns:
        (L, J, 3) tensor — x, y smoothed; confidence passed through unchanged.
    """
    L = kp2d.shape[0]
    # filtfilt needs a minimum sequence length relative to filter order
    # (roughly 3x the padding it applies); short clips just pass through.
    min_len = 3 * (order + 1)
    if L < min_len:
        return kp2d

    nyquist = fps / 2.0
    normal_cutoff = min(cutoff_hz / nyquist, 0.99)
    b, a = butter(order, normal_cutoff, btype="low", analog=False)

    kp2d_np = kp2d.numpy().copy()
    for j in range(kp2d_np.shape[1]):
        for c in range(2):  # x, y only — leave confidence untouched
            kp2d_np[:, j, c] = filtfilt(b, a, kp2d_np[:, j, c])

    return torch.from_numpy(kp2d_np).to(kp2d.dtype)
