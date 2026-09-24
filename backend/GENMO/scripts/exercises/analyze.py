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

from . import exercises as _exercises_data  # noqa: F401  registers every ExerciseDefinition on import
from .counting import count_flight_phase, count_swing_detector, count_threshold_crossing
from .definitions import EXERCISE_REGISTRY, BodyOrientation, CountingStrategy, exercises_for_orientation
from .movement import apply_movement_rule
from .orientation import classify_orientation
from .signals import compute_signals, flight_height_signals, smooth_signals

MIN_FRAMES = 15

# Temporary tennis-only mode: only these keys are ever evaluated. None restores every registered exercise.
ENABLED_EXERCISE_KEYS: frozenset[str] | None = frozenset({"tennis_stroke"})


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


def _apply_exclusion_check(defn, reps: list[dict], signals: dict) -> list[dict]:
    """Whole-rep veto — see ExerciseDefinition.exclusion_check's docstring
    for why this has to be a post-filter over the counting engine's own
    output rather than a frame mask fed into it.
    """
    if defn.exclusion_check is None or not reps:
        return reps
    signal_name, comparator, param_id = defn.exclusion_check
    threshold = defn.param(param_id)
    sig = signals[signal_name]
    bad = (sig < threshold) if comparator == "lt" else (sig > threshold)
    return [r for r in reps if not bad[r["start"]:r["end"] + 1].any()]


def _apply_requirement_check(defn, reps: list[dict], signals: dict) -> list[dict]:
    """Mirror image of _apply_exclusion_check — see
    ExerciseDefinition.requirement_check's docstring for the full reasoning
    (in particular why this isn't just corroboration_signal again).
    """
    if defn.requirement_check is None or not reps:
        return reps
    signal_name, comparator, param_id = defn.requirement_check
    threshold = defn.param(param_id)
    sig = signals[signal_name]

    def window_ok(r: dict) -> bool:
        window = sig[r["start"]:r["end"] + 1]
        rng = float(window.max() - window.min())
        return (rng < threshold) if comparator == "lt" else (rng > threshold)

    return [r for r in reps if window_ok(r)]


def _merge_close_reps(defn, reps: list[dict], times: np.ndarray, signal: np.ndarray) -> list[dict]:
    """See ExerciseDefinition.min_rep_gap_param. A rep joins the previous group only if it's within
    the gap of that group's STRONGEST extreme, not of the group's last rep — comparing to the last
    one chained a run of closely spaced extremes into one rep (two real arm-only strokes 1.7s apart
    merged through their backswing/follow-through extremes in between). The merged rep spans the
    group and keeps the strongest extreme as its bottom.
    """
    if defn.min_rep_gap_param is None or len(reps) < 2:
        return reps
    gap = defn.param(defn.min_rep_gap_param)
    sign = 1.0 if defn.count_peaks else -1.0

    def strength(r: dict) -> float:
        return sign * float(signal[r["bottom"]])

    groups = [[reps[0]]]
    for r in reps[1:]:
        anchor = max(groups[-1], key=strength)
        if times[r["bottom"]] - times[anchor["bottom"]] < gap:
            groups[-1].append(r)
        else:
            groups.append([r])
    return [
        {"start": g[0]["start"], "bottom": max(g, key=strength)["bottom"], "end": g[-1]["end"]}
        for g in groups
    ]


def _run_exercise(defn, signals: dict, times: np.ndarray, flight_signals: tuple[np.ndarray, np.ndarray] | None = None) -> list[dict]:
    """Dispatches to the counting engine matching defn.counting_strategy,
    then applies exclusion_check (if any) — see its docstring.
    """
    if defn.counting_strategy == CountingStrategy.THRESHOLD_CROSSING:
        reps = count_threshold_crossing(
            signal=signals[defn.primary_signal],
            corroboration_mask=_corroboration_mask(defn, signals),
            min_rom_deg=defn.param("min_rom_deg"),
            depth_fraction=defn.param("depth_fraction"),
            stand_fraction=defn.param("stand_fraction"),
        )

    elif defn.counting_strategy == CountingStrategy.SWING_DETECTOR:
        corro_signal = signals[defn.corroboration_signal] if defn.corroboration_signal else None
        corro_delta = 0.0
        if defn.corroboration_delta_param:
            # body_rise_fraction-style params are expressed as a fraction of
            # torso length, not an absolute distance — scale by this clip's
            # own median torso length so the threshold stays meaningful
            # across different athlete sizes and camera distances.
            corro_delta = defn.param(defn.corroboration_delta_param) * float(np.median(signals["torso_scale"]))
        signal = signals[defn.primary_signal]
        if defn.count_peaks:
            # Mirrored about its midpoint rather than negated: same range, and values stay positive,
            # which count_swing_detector's `extreme_val > 0` check depends on.
            signal = signal.max() + signal.min() - signal
        reps = count_swing_detector(
            signal=signal,
            frame_valid_mask=_valid_frame_mask(defn, signals),
            min_rom_deg=defn.param("min_rom_deg"),
            min_drop_fraction=defn.param("min_drop_fraction"),
            corroboration_signal=corro_signal,
            corroboration_min_delta=corro_delta,
        )

    elif defn.counting_strategy == CountingStrategy.FLIGHT_PHASE:
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
        reps = count_flight_phase(
            height_signal=height_signal,
            scale_signal=scale_signal,
            times=times,
            baseline_fraction=defn.param("baseline_fraction"),
            takeoff_fraction=defn.param("takeoff_fraction"),
            landing_fraction=defn.param("landing_fraction"),
            min_flight_sec=defn.param("min_flight_sec"),
            max_flight_sec=defn.param("max_flight_sec"),
        )

    else:
        raise ValueError(f"Unknown counting strategy: {defn.counting_strategy}")

    reps = _merge_close_reps(defn, reps, times, signals[defn.primary_signal])
    reps = apply_movement_rule(defn, reps, signals, times)
    reps = _apply_exclusion_check(defn, reps, signals)
    return _apply_requirement_check(defn, reps, signals)


def _resolve_standing(signals: dict, reps_by_key: dict[str, list], defs: list) -> dict[str, list]:
    """STANDING now holds several exercises. squat vs. vertical_jump is a
    special case: a jump's countermovement dip can look like a shallow
    squat, and real flight-phase evidence is stronger and less ambiguous
    than a threshold-crossing guess, so a detected jump wins outright over
    squat. (deadlift used to share STANDING too and needed a real ROM-ratio
    discriminator against squat — removed from the pipeline entirely, see
    exercises.py.) Everything else sharing STANDING (padel's stroke, and any
    future addition) doesn't have that specific ambiguity with squat/jump,
    so it falls back to ordinary highest-priority-wins resolution — see
    _resolve_by_priority — against whatever else fired. This used to
    hardcode just "vertical_jump"/"squat" by name, which silently discarded
    any other STANDING exercise's reps the moment a second one was added;
    generalizing this was required before padel could ever be detected.
    """
    jump_reps = reps_by_key.get("vertical_jump", [])
    if jump_reps:
        return {d.key: (jump_reps if d.key == "vertical_jump" else []) for d in defs}
    return _resolve_by_priority(signals, reps_by_key, [d for d in defs if d.key != "vertical_jump"])


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


def analyze_exercises(
    joints: np.ndarray, fps: float = 30.0, incam_joints: np.ndarray | None = None,
    sport_key: str | None = None,
) -> dict[str, int]:
    """joints: (L, 22, 3) world-space SMPL joints for one clip.
    incam_joints: optional (L, 22, 3) in-camera (non-world-grounded) SMPL
        joints for the same clip — used only by vertical_jump's flight-phase
        detection (see flight_height_signals() in signals.py for why).
        Falls back to the world-grounded ankle height if omitted.
    sport_key: the athlete's effective main sport (Supabase
        profiles.main_sport_key / sport_override_key via effective_sport(),
        see supabase/migrations/028_main_sport.sql), or None/unknown. Two
        different sports can register visually-identical exercises (a padel
        stroke and a tennis stroke — see exercises.py's "TENNIS STROKE"
        comment) that pose data alone can't tell apart; when the athlete's
        sport IS known, this keeps the other sport's exercises from ever
        competing for the same clip. "general_fitness"/None is a no-op —
        every exercise stays eligible, same as before this param existed
        ("whatever comes out during analysis").

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
    if ENABLED_EXERCISE_KEYS is not None:
        # Supersedes the sport filter: its only job is picking padel vs. tennis stroke, which this already decides.
        defs = [d for d in defs if d.key in ENABLED_EXERCISE_KEYS]
    elif sport_key and sport_key != "general_fitness":
        defs = [d for d in defs if d.category in ("general_fitness", sport_key)]
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
