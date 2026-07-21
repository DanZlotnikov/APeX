# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Bridge to the retired on-device analyzer's RiskFactor vocabulary
(mobile/src/utils/exerciseAnalyzer.ts's computeAssessment). The manager/
coach module (per-exercise threshold config in mobile/src/utils/
exerciseMetrics.ts, the athlete-monitoring table, readiness score,
compliance %) reads `sessions.readiness_score` and `session_metrics` rows
keyed `${exerciseKey}_${factorId}` (e.g. "squat_symmetry", "jump_flightTime")
— all produced by that on-device analyzer, which no longer runs now that
processing has moved server-side. This module reproduces the SAME formulas
(asymPct, ramp, the depth/fatigue/landing definitions) against the new
GEM-based 3D joints instead of MediaPipe's 2D landmarks, so the manager
module keeps working against server-processed sessions without a rewrite.

Deliberately NOT sharing computation with balance.py even where the two
measure similar things (e.g. squat knee symmetry): balance.py optimizes for
the new Performance/Processing UI (richer per-joint severity, its own
frame-sampling choices) and is expected to evolve; this module optimizes for
staying byte-faithful to a formula it doesn't own. Coupling them would mean
a future balance.py threshold tweak silently drifts the manager module's
numbers. `session_metrics` gets `{metric_key, value}` only, no precomputed
pass/fail — the athlete-monitoring table applies whatever threshold is
currently configured (default or manager override) at display time, so
baking in a status here using OUR defaults would fight that.

Only squat / vertical_jump / pull_up have a legacy profile — push_up,
deadlift, and ab_crunch never existed in the old analyzer, so there's
nothing to bridge for them yet (see HANDOFF_video_pipeline.md).
"""
from __future__ import annotations

import numpy as np

from exercises.signals import compute_signals, smooth_signals

from .balance import side_values

# exercises/*.py's keys -> the old analyzer's keys (mobile/src/utils/
# exerciseMetrics.ts's ExerciseKey), which mobile's session_metrics rows and
# EXERCISE_METRICS threshold config are keyed on.
_LEGACY_EXERCISE_KEY = {"squat": "squat", "vertical_jump": "jump", "pull_up": "pullup"}

_LANDING_WINDOW_SEC = 0.4  # matches exerciseAnalyzer.ts's segmentJumps landing-softness scan


def _asym_pct(a: float, b: float) -> float:
    mx = max(a, b)
    if mx < 1:
        return 0.0
    return abs(a - b) / mx * 100.0


def _ramp(v: float, good: float, bad: float) -> float:
    t = (v - good) / (bad - good)
    return float(max(15.0, min(100.0, 100.0 - t * 70.0)))


def _status(score: float) -> str:
    return "green" if score >= 80 else ("yellow" if score >= 55 else "red")


def _rep_duration(rep: dict, times: np.ndarray) -> float:
    a, b = times[rep["start"]], times[rep["end"]]
    return float(b - a) if b > a else 0.0


def _fatigue_pct(reps: list[dict], depth_at_bottom: list[float], times: np.ndarray) -> float | None:
    """Mirrors exerciseAnalyzer.ts's fatigueFactor exactly: first-third vs.
    last-third reps, worse of tempo drift (reps slowing down) and depth
    drift (reps getting shallower — every exercise this bridge covers uses
    a flexion angle where deeper = smaller, i.e. deeperIsSmaller=True in the
    original). None means "fewer than 3 reps, can't assess a trend" — the
    caller must exclude this from the readiness average, not treat it as a
    free pass.
    """
    if len(reps) < 3:
        return None
    third = max(1, len(reps) // 3)
    t0 = float(np.mean([_rep_duration(r, times) for r in reps[:third]]))
    tN = float(np.mean([_rep_duration(r, times) for r in reps[-third:]]))
    d0 = float(np.mean(depth_at_bottom[:third]))
    dN = float(np.mean(depth_at_bottom[-third:]))
    tempo_drift = max(0.0, (tN - t0) / t0) * 100.0 if t0 > 0.05 else 0.0
    depth_drift = max(0.0, dN - d0) / max(10.0, abs(d0)) * 100.0
    return round(max(tempo_drift, depth_drift))


class _Readiness:
    """Accumulates (score, weight) pairs the same way computeAssessment's
    `consider()` closure did, to reproduce its weighted-average readiness
    score and "worst factor -> recommendation" logic.
    """
    def __init__(self) -> None:
        self.scores: list[float] = []
        self.weights: list[float] = []
        self.worst: tuple[float, str] | None = None  # (score, recommendation)

    def consider(self, score: float, weight: float, recommendation: str) -> None:
        self.scores.append(score)
        self.weights.append(weight)
        if score < 80 and (self.worst is None or score < self.worst[0]):
            self.worst = (score, recommendation)

    def finalize(self) -> tuple[float, str, str | None]:
        wsum = sum(s * w for s, w in zip(self.scores, self.weights))
        wtot = sum(self.weights)
        readiness = round(wsum / wtot) if wtot else 100
        label = "Ready" if readiness >= 80 else ("Caution" if readiness >= 55 else "High Risk")
        return readiness, label, (self.worst[1] if self.worst else None)


def _squat_metrics(joints_np: np.ndarray, reps: list[dict], signals: dict, times: np.ndarray, r: _Readiness) -> list[dict]:
    out = []

    l_sum = r_sum = 0.0
    for rep in reps:
        l_val, r_val = side_values(joints_np[rep["bottom"]], "knee_angle")
        l_sum += l_val; r_sum += r_val
    l_flex, r_flex = 180.0 - l_sum / len(reps), 180.0 - r_sum / len(reps)
    sym_pct = round(_asym_pct(l_flex, r_flex))
    r.consider(_ramp(sym_pct, 5, 25), 1.0, "symmetry")
    out.append({"metric_key": "squat_symmetry", "value": sym_pct})

    bottoms = [float(signals["knee_angle"][rep["bottom"]]) for rep in reps]
    avg_bottom = float(np.mean(bottoms))
    depth_pct = round(max(0.0, min(120.0, (180.0 - avg_bottom) / (180.0 - 90.0) * 100.0)))
    r.consider(_ramp(avg_bottom, 95, 150), 1.0, "mobility")
    out.append({"metric_key": "squat_depth", "value": depth_pct})

    fatigue_pct = _fatigue_pct(reps, bottoms, times)
    if fatigue_pct is not None:
        r.consider(_ramp(fatigue_pct, 5, 45), 0.6, "fatigue")
        out.append({"metric_key": "squat_fatigue", "value": fatigue_pct})

    return out


def _jump_metrics(joints_np: np.ndarray, reps: list[dict], times: np.ndarray, fps: float, r: _Readiness) -> list[dict]:
    out = []
    window_frames = max(1, int(round(_LANDING_WINDOW_SEC * fps)))
    L = joints_np.shape[0]

    all_flex, l_land_flex, r_land_flex, flight_secs = [], [], [], []
    for rep in reps:
        land = rep["end"]
        hi = min(L, land + window_frames)
        min_l, min_r = 180.0, 180.0
        for k in range(land, hi):
            l_val, r_val = side_values(joints_np[k], "knee_angle")
            min_l, min_r = min(min_l, l_val), min(min_r, r_val)
        l_flex, r_flex = 180.0 - min_l, 180.0 - min_r
        l_land_flex.append(l_flex); r_land_flex.append(r_flex)
        all_flex.append((l_flex + r_flex) / 2.0)
        flight_secs.append(float(times[rep["end"]] - times[rep["start"]]))

    mean_flex = float(np.mean(all_flex))
    soft_pct = round(max(0.0, min(120.0, mean_flex / 60.0 * 100.0)))
    r.consider(_ramp(mean_flex, 60, 15), 1.0, "landing")
    out.append({"metric_key": "jump_landing", "value": soft_pct})

    sym_pct = round(_asym_pct(float(np.mean(l_land_flex)), float(np.mean(r_land_flex))))
    r.consider(_ramp(sym_pct, 5, 25), 1.0, "symmetry")
    out.append({"metric_key": "jump_symmetry", "value": sym_pct})

    flight_time = round(float(np.mean(flight_secs)), 2)
    out.append({"metric_key": "jump_flightTime", "value": flight_time})

    return out


def _pullup_metrics(joints_np: np.ndarray, reps: list[dict], signals: dict, times: np.ndarray, r: _Readiness) -> list[dict]:
    out = []

    gated = signals["elbow_angle"][signals["wrist_above"] > 0.3]
    if gated.size:
        rom_val = float(gated.max() - gated.min())
    else:
        rom_val = 0.0
    rom_pct = round(max(0.0, min(100.0, rom_val / 120.0 * 100.0)))
    r.consider(_ramp(rom_val, 100, 35), 1.0, "mobility")
    out.append({"metric_key": "pullup_depth", "value": rom_pct})

    l_sum = r_sum = 0.0
    for rep in reps:
        l_val, r_val = side_values(joints_np[rep["bottom"]], "elbow_angle")
        l_sum += l_val; r_sum += r_val
    l_flex, r_flex = 180.0 - l_sum / len(reps), 180.0 - r_sum / len(reps)
    sym_pct = round(_asym_pct(l_flex, r_flex))
    r.consider(_ramp(sym_pct, 5, 25), 1.0, "scapular")
    out.append({"metric_key": "pullup_symmetry", "value": sym_pct})

    bottoms = [float(signals["elbow_angle"][rep["bottom"]]) for rep in reps]
    fatigue_pct = _fatigue_pct(reps, bottoms, times)
    if fatigue_pct is not None:
        r.consider(_ramp(fatigue_pct, 5, 45), 0.6, "fatigue")
        out.append({"metric_key": "pullup_fatigue", "value": fatigue_pct})

    return out


def analyze_legacy_metrics(joints_np: np.ndarray, exercise_key: str | None, reps: list[dict], fps: float = 30.0) -> dict | None:
    """Returns None for exercises with no legacy profile (push_up, deadlift,
    ab_crunch) or with no reps — same "omit, don't emit an empty stub"
    convention as balance.analyze_balance.
    """
    legacy_key = _LEGACY_EXERCISE_KEY.get(exercise_key) if exercise_key else None
    if legacy_key is None or not reps:
        return None

    times = np.arange(joints_np.shape[0]) / fps
    signals = smooth_signals(compute_signals(joints_np), times)
    readiness = _Readiness()

    if legacy_key == "squat":
        session_metrics = _squat_metrics(joints_np, reps, signals, times, readiness)
    elif legacy_key == "jump":
        session_metrics = _jump_metrics(joints_np, reps, times, fps, readiness)
    else:  # "pullup"
        session_metrics = _pullup_metrics(joints_np, reps, signals, times, readiness)

    score, label, recommendation = readiness.finalize()
    return {
        "legacy_exercise_key": legacy_key,
        "readiness_score": score,
        "readiness_label": label,
        "recommendation": recommendation,
        "session_metrics": session_metrics,
    }
