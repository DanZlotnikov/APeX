# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Top-level entrypoint. This is the only file the rest of the pipeline
(worker.py, backend/server/pipeline.py) imports from this package — it
reads EXERCISE_REGISTRY (definitions.py + exercises.py) to know what
exercises exist, so adding/editing an exercise never requires touching this
file.
"""
from __future__ import annotations

import numpy as np

from . import discriminators
from . import exercises as _exercises_data  # noqa: F401  registers every ExerciseDefinition on import
from .counting import count_flight_phase, count_swing_detector, count_threshold_crossing
from .definitions import EXERCISE_REGISTRY, BodyOrientation, CountingStrategy, exercises_for_orientation
from .orientation import classify_orientation
from .signals import compute_signals, flight_height_signals, smooth_signals

MIN_FRAMES = 15


def _corroboration_mask(defn, signals) -> np.ndarray | None:
    if not defn.corroboration:
        return None
    L = len(next(iter(signals.values())))
    mask = np.ones(L, dtype=bool)
    for signal_name, comparator, param_id in defn.corroboration:
        threshold = defn.param(param_id)
        sig = signals[signal_name]
        mask &= (sig < threshold) if comparator == "lt" else (sig > threshold)
    return mask


def _valid_frame_mask(defn, signals) -> np.ndarray:
    if defn.valid_frame_check is None:
        L = len(next(iter(signals.values())))
        return np.ones(L, dtype=bool)
    signal_name, comparator, param_id = defn.valid_frame_check
    threshold = defn.param(param_id)
    sig = signals[signal_name]
    return (sig < threshold) if comparator == "lt" else (sig > threshold)


def _run_exercise(defn, signals: dict, times: np.ndarray, flight_signals: tuple[np.ndarray, np.ndarray] | None = None) -> list[dict]:
    """Dispatches to the counting engine matching defn.counting_strategy."""
    if defn.counting_strategy == CountingStrategy.THRESHOLD_CROSSING:
        return count_threshold_crossing(
            signal=signals[defn.primary_signal],
            corroboration_mask=_corroboration_mask(defn, signals),
            min_rom_deg=defn.param("min_rom_deg"),
            depth_fraction=defn.param("depth_fraction"),
            stand_fraction=defn.param("stand_fraction"),
        )

    if defn.counting_strategy == CountingStrategy.SWING_DETECTOR:
        corro_signal = signals[defn.corroboration_signal] if defn.corroboration_signal else None
        corro_delta = 0.0
        if defn.corroboration_delta_param:
            # body_rise_fraction-style params are expressed as a fraction of
            # torso length, not an absolute distance — scale by this clip's
            # own median torso length so the threshold stays meaningful
            # across different athlete sizes and camera distances.
            corro_delta = defn.param(defn.corroboration_delta_param) * float(np.median(signals["torso_scale"]))
        return count_swing_detector(
            signal=signals[defn.primary_signal],
            frame_valid_mask=_valid_frame_mask(defn, signals),
            min_rom_deg=defn.param("min_rom_deg"),
            min_drop_fraction=defn.param("min_drop_fraction"),
            corroboration_signal=corro_signal,
            corroboration_min_delta=corro_delta,
        )

    if defn.counting_strategy == CountingStrategy.FLIGHT_PHASE:
        # vertical_jump-specific: prefers the in-camera-derived height/scale
        # signal (flight_signals, from worker.py's get_incam_joints) over
        # the world-grounded one when available — see flight_height_signals()
        # in signals.py for why. Falls back to the world-grounded ankle_y if
        # no in-camera joints were supplied (e.g. an older caller), same as
        # the pre-fix behavior. Special-cased here rather than added as a
        # general schema field since it's the only FLIGHT_PHASE exercise
        # currently defined; if a second one shows up, promote this to a
        # named field on ExerciseDefinition the way corroboration_signal is.
        if flight_signals is not None:
            height_signal, scale_signal = flight_signals
        else:
            height_signal = signals[defn.primary_signal]
            scale_signal = signals["shoulder_y"] - signals["ankle_y"]
        return count_flight_phase(
            height_signal=height_signal,
            scale_signal=scale_signal,
            times=times,
            baseline_fraction=defn.param("baseline_fraction"),
            takeoff_fraction=defn.param("takeoff_fraction"),
            landing_fraction=defn.param("landing_fraction"),
            min_flight_sec=defn.param("min_flight_sec"),
        )

    raise ValueError(f"Unknown counting strategy: {defn.counting_strategy}")


def _resolve_standing(signals: dict, reps_by_key: dict[str, list], defs: list) -> dict[str, list]:
    """STANDING holds 3 exercises that can genuinely be confused with one
    another: a jump's countermovement dip can look like a shallow squat,
    and squat/deadlift share the same knee/hip-flexion signature. Real
    flight-phase evidence is stronger and less ambiguous than a threshold-
    crossing guess, so a detected jump wins outright over both. Otherwise,
    if squat and deadlift both register, the hip/knee ROM-ratio
    discriminator breaks the tie (see discriminators.py).
    """
    jump_reps = reps_by_key.get("vertical_jump", [])
    if jump_reps:
        return {"vertical_jump": jump_reps, "squat": [], "deadlift": []}

    squat_reps = reps_by_key.get("squat", [])
    deadlift_reps = reps_by_key.get("deadlift", [])
    if squat_reps and deadlift_reps:
        hip_dominant_ratio = EXERCISE_REGISTRY["deadlift"].param("hip_dominant_ratio")
        winner = discriminators.hinge_vs_squat(signals, hip_dominant_ratio)
        if winner == "squat":
            deadlift_reps = []
        else:
            squat_reps = []
    return {"vertical_jump": [], "squat": squat_reps, "deadlift": deadlift_reps}


def _resolve_by_priority(signals: dict, reps_by_key: dict[str, list], defs: list) -> dict[str, list]:
    """Default resolver for orientations with no special-cased ambiguity
    (currently: HANGING_OVERHEAD, HORIZONTAL_PLANK, HORIZONTAL_LYING each
    hold exactly one exercise, so this never has anything to resolve — but
    it's here so adding a second exercise to one of those buckets degrades
    gracefully to "highest-priority nonzero wins" instead of silently
    double-counting, until/unless it earns its own resolver like
    _resolve_standing above.
    """
    for defn in defs:  # already sorted by descending priority
        if reps_by_key.get(defn.key):
            return {d.key: (reps_by_key.get(d.key, []) if d.key == defn.key else []) for d in defs}
    return {d.key: [] for d in defs}


_RESOLVERS = {
    BodyOrientation.STANDING: _resolve_standing,
}


def _flight_signals(incam_joints: np.ndarray | None, times: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    if incam_joints is None:
        return None
    height, scale = flight_height_signals(incam_joints)
    smoothed = smooth_signals({"height": height, "scale": scale}, times)
    return smoothed["height"], smoothed["scale"]


def analyze_exercises(joints: np.ndarray, fps: float = 30.0, incam_joints: np.ndarray | None = None) -> dict[str, int]:
    """joints: (L, 22, 3) world-space SMPL joints for one clip.
    incam_joints: optional (L, 22, 3) in-camera (non-world-grounded) SMPL
        joints for the same clip — used only by vertical_jump's flight-phase
        detection (see flight_height_signals() in signals.py for why).
        Falls back to the world-grounded ankle height if omitted.

    Returns a rep count per exercise KEY for every registered exercise
    (0 for anything not detected) — a stable, predictable shape regardless
    of which exercise the clip turned out to be, which is what a future
    per-athlete/per-team settings UI needs to render a consistent list.
    """
    zero_counts = {key: 0 for key in EXERCISE_REGISTRY}
    L = joints.shape[0]
    if L < MIN_FRAMES:
        return zero_counts

    times = np.arange(L) / fps
    raw = compute_signals(joints)
    signals = smooth_signals(raw, times)
    flight_signals = _flight_signals(incam_joints, times)

    orientation = classify_orientation(signals, fps=fps)
    if orientation is None:
        return zero_counts

    defs = exercises_for_orientation(orientation)
    if not defs:
        return zero_counts

    reps_by_key = {defn.key: _run_exercise(defn, signals, times, flight_signals) for defn in defs}
    resolver = _RESOLVERS.get(orientation, _resolve_by_priority)
    resolved = resolver(signals, reps_by_key, defs)

    counts = dict(zero_counts)
    for key, reps in resolved.items():
        counts[key] = len(reps)
    return counts


def get_exercise_reps(joints: np.ndarray, exercise_key: str, fps: float = 30.0, incam_joints: np.ndarray | None = None) -> list[dict]:
    """Raw {"start", "bottom", "end"} frame-index windows for every rep of
    the given exercise key, exactly as its counting engine produced them —
    the same reps analyze_exercises()/compute_rep_timeline() already derive
    internally, exposed here so downstream consumers (biomechanics analysis)
    can sample joints at each rep's meaningful frames (e.g. squat's deepest
    point, a jump's takeoff/landing) without re-running counting themselves.
    """
    L = joints.shape[0]
    if L < MIN_FRAMES or exercise_key not in EXERCISE_REGISTRY:
        return []
    times = np.arange(L) / fps
    raw = compute_signals(joints)
    signals = smooth_signals(raw, times)
    flight_signals = _flight_signals(incam_joints, times)
    return _run_exercise(EXERCISE_REGISTRY[exercise_key], signals, times, flight_signals)


def compute_rep_timeline(joints: np.ndarray, counts: dict[str, int], fps: float = 30.0, incam_joints: np.ndarray | None = None) -> dict:
    """Per-frame cumulative rep count for whichever exercise won
    analyze_exercises(), plus which exercise key is active (for the HUD
    label / grip-stabilization hook in worker.py). Re-derives the winning
    exercise's rep list rather than threading it through from
    analyze_exercises() — cheap relative to the rest of the pipeline, and
    keeps analyze_exercises()'s return shape a plain counts dict that's
    easy to serialize as an API response.
    """
    L = joints.shape[0]
    empty = {"key": None, "cumulative": np.zeros(L, dtype=int)}
    if L < MIN_FRAMES:
        return empty

    active_key = next((k for k, v in counts.items() if v > 0), None)
    if active_key is None:
        return empty

    times = np.arange(L) / fps
    raw = compute_signals(joints)
    signals = smooth_signals(raw, times)
    flight_signals = _flight_signals(incam_joints, times)
    reps = _run_exercise(EXERCISE_REGISTRY[active_key], signals, times, flight_signals)

    cumulative = np.zeros(L, dtype=int)
    c, ei = 0, 0
    end_idxs = [r["end"] for r in reps]
    for i in range(L):
        while ei < len(end_idxs) and end_idxs[ei] <= i:
            c += 1
            ei += 1
        cumulative[i] = c
    return {"key": active_key, "cumulative": cumulative}
