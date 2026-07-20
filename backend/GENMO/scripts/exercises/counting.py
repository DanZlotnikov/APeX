# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Generic rep-counting engines. See definitions.py's module docstring for why
these three shapes (threshold-crossing, swing-detector, flight-phase) cover
every exercise instead of one bespoke function per exercise.

Every primary signal used across all current exercise definitions
(knee_angle, hip_angle, elbow_angle) shares the same convention: SMALLER
angle = more flexed ("bottom" of the rep), LARGER angle = more extended
("top"/standing/lockout). All three engines below assume that convention.
"""
from __future__ import annotations

import numpy as np

Rep = dict  # {"start": int, "bottom": int, "end": int} frame indices


def count_threshold_crossing(
    signal: np.ndarray,
    corroboration_mask: np.ndarray | None,
    min_rom_deg: float,
    depth_fraction: float,
    stand_fraction: float,
) -> list[Rep]:
    """Adaptive depth/stand threshold crossing.

    DEPTH/STAND are computed as fractions of *this clip's own* observed
    range of motion rather than fixed absolute angles — deliberately, so a
    shorter or partial-range rep by a less flexible athlete still counts,
    rather than requiring everyone to hit the same textbook angle. See each
    exercise's `research` citations in exercises.py for why depth_fraction/
    stand_fraction/min_rom_deg were set where they were.
    """
    L = len(signal)
    if L == 0:
        return []
    min_v, max_v = float(signal.min()), float(signal.max())
    rng = max_v - min_v
    if rng < min_rom_deg:
        return []

    depth_t = min_v + rng * depth_fraction
    stand_t = min_v + rng * stand_fraction
    if corroboration_mask is None:
        corroboration_mask = np.ones(L, dtype=bool)

    reps: list[Rep] = []
    was_standing, at_depth = True, False
    start, bottom_idx, bottom_val = 0, 0, float("inf")
    for i in range(L):
        v = signal[i]
        if not at_depth and v > stand_t:
            was_standing, start = True, i
        if was_standing and not at_depth and v < depth_t and corroboration_mask[i]:
            at_depth, was_standing, bottom_val, bottom_idx = True, False, float("inf"), i
        if at_depth and v < bottom_val:
            bottom_val, bottom_idx = v, i
        if at_depth and v > stand_t:
            reps.append({"start": start, "bottom": bottom_idx, "end": i})
            at_depth, was_standing, start = False, True, i
    return reps


def count_swing_detector(
    signal: np.ndarray,
    frame_valid_mask: np.ndarray,
    min_rom_deg: float,
    min_drop_fraction: float,
    corroboration_signal: np.ndarray | None,
    corroboration_min_delta: float,
) -> list[Rep]:
    """Running local-extremum (zigzag) detector: a rep confirms once the
    signal has swung down by min_drop from a tracked peak, then back up by
    min_drop from the resulting trough. Only considers frames where
    `frame_valid_mask` holds (e.g. pull-up: wrist actually overhead).

    Chosen over a fixed absolute crossing band (what threshold_crossing
    does) for exercises where that band can be skipped over entirely at a
    sparse/irregular capture rate — this only needs SOME sample to land
    near each true local extreme, not inside a narrow band. See pull-up's
    git history for the measured failure mode this fixed (a real 5-rep set
    dropped to 0 detected reps under a fixed crossing check at a sparser
    capture rate; the swing detector recovered 4-5).

    `corroboration_signal` + `corroboration_min_delta`: an independent
    signal that must also have moved by at least this much between the
    reference peak and the confirmed trough — guards against the primary
    signal alone swinging from tracking noise with no real movement behind
    it (e.g. pull-up requires the wrist-to-hip distance to actually shrink,
    not just the elbow angle reading).
    """
    L = len(signal)
    mask = frame_valid_mask
    valid_signal = signal[mask]
    if valid_signal.size == 0:
        return []
    rng = float(valid_signal.max() - valid_signal.min())
    if rng < min_rom_deg:
        return []
    min_drop = rng * min_drop_fraction

    def corro_at(i: int) -> float:
        return float(corroboration_signal[i]) if corroboration_signal is not None else 0.0

    reps: list[Rep] = []
    started = False
    direction = "down"
    extreme_val = extreme_corro = 0.0
    extreme_idx = 0
    ref_peak_val = ref_peak_corro = 0.0
    ref_peak_idx = 0

    for i in range(L):
        if not mask[i]:
            continue
        v, c = float(signal[i]), corro_at(i)
        if not started:
            started = True
            extreme_val = ref_peak_val = v
            extreme_corro = ref_peak_corro = c
            extreme_idx = ref_peak_idx = i
            continue
        if direction == "down":
            if v < extreme_val:
                extreme_val, extreme_corro, extreme_idx = v, c, i
            elif extreme_val > 0 and v - extreme_val >= min_drop:
                if corroboration_signal is None or (ref_peak_corro - extreme_corro) >= corroboration_min_delta:
                    reps.append({"start": ref_peak_idx, "bottom": extreme_idx, "end": i})
                direction, extreme_val, extreme_corro, extreme_idx = "up", v, c, i
        else:
            if v > extreme_val:
                extreme_val, extreme_corro, extreme_idx = v, c, i
            elif extreme_val - v >= min_drop:
                ref_peak_val, ref_peak_corro, ref_peak_idx = extreme_val, extreme_corro, extreme_idx
                direction, extreme_val, extreme_corro, extreme_idx = "down", v, c, i

    # Clip may end mid-rep near the bottom — count an in-progress final rep.
    if direction == "down" and ref_peak_val - extreme_val >= min_drop and (
        corroboration_signal is None or (ref_peak_corro - extreme_corro) >= corroboration_min_delta
    ):
        reps.append({"start": ref_peak_idx, "bottom": extreme_idx, "end": extreme_idx})
    return reps


def count_flight_phase(
    height_signal: np.ndarray,
    scale_signal: np.ndarray,
    times: np.ndarray,
    baseline_fraction: float,
    takeoff_fraction: float,
    landing_fraction: float,
    min_flight_sec: float,
) -> list[Rep]:
    """Takeoff/landing detection for airborne exercises (vertical jump).

    `height_signal` (e.g. ankle height) must rise above
    `takeoff_fraction * scale` above its own baseline (the athlete's
    standing value, averaged over the first `baseline_fraction` of frames)
    to register a takeoff, then fall back below `landing_fraction * scale`
    to confirm landing. `scale_signal` (e.g. shoulder-to-ankle span) is a
    per-clip body-size reference so the thresholds track how large the
    athlete appears rather than a fixed fraction of frame height, which
    breaks whenever camera distance changes.

    `min_flight_sec` rejects landmark-noise blips (e.g. a heel rise at the
    bottom of a squat can momentarily nudge the height signal) — a genuine
    airborne phase lasts much longer than one noisy frame.
    """
    L = len(height_signal)
    if L < 10:
        return []
    base_n = max(5, int(L * baseline_fraction))
    baseline = float(height_signal[:base_n].mean())
    scale = max(0.15, float(scale_signal[:base_n].mean()))
    takeoff_t = scale * takeoff_fraction
    landing_t = scale * landing_fraction

    reps: list[Rep] = []
    in_flight = False
    takeoff_idx = 0
    peak_idx = 0
    peak_val = baseline
    for i in range(L):
        rise = float(height_signal[i]) - baseline
        if not in_flight and rise > takeoff_t:
            in_flight, takeoff_idx, peak_idx, peak_val = True, i, i, rise
        elif in_flight:
            if rise > peak_val:
                peak_val, peak_idx = rise, i
            if rise < landing_t:
                if times[i] - times[takeoff_idx] >= min_flight_sec:
                    reps.append({"start": takeoff_idx, "bottom": peak_idx, "end": i})
                in_flight = False
    return reps
