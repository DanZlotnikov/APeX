# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Arm fixation — third biomechanical-analysis method, alongside balance.py and
rom.py (see fixation_thresholds.py for the per-exercise joint checks and
their research citations, and analysis.py for how this plugs into the
orchestrator).

This is a hybrid of the other two analyzers, not a clone of either:
  - PLUMBING borrowed from rom.py: a check names a window (start/end
    rep-dict selectors) and reads joint values via balance.py's
    side_values()/SIGNAL_SPECS — but unlike rom.py's _evaluate_check, which
    only samples the two endpoint frames, this one samples EVERY frame in
    the window. A joint that swings wildly mid-rep and happens to return
    close to its start value would score a perfect (tiny) delta under a
    2-frame comparison, but that's exactly the kind of instability
    "fixation" is meant to catch — so deviation here is each side's
    (max - min) across the whole per-frame series, not |end - start|.
  - SCORING borrowed from balance.py, not rom.py: rom_pct is a ratio against
    a target that can be exceeded (clipped to 130%) — that doesn't fit
    "less deviation is better" (there's no sense in which fixation can
    "over-achieve" past 100%, unlike reaching further than a ROM target).
    balance_pct's shape (100 - deviation-as-a-percentage, floored at 0) is
    the right one, just measured against max_deviation instead of an
    interlimb comparison.

Severity direction matches rom.py's (not balance.py's): HIGHER fixation_pct
is better, so severity worsens as it drops — same as ROM's "less of the
expected range achieved is worse", not balance's "more asymmetry is worse".
"""
from __future__ import annotations

import numpy as np

from .balance import side_values
from .fixation_thresholds import FIXATION_PROFILES, JointFixationCheck

_SEVERITY_RANK = {"ok": 0, "watch": 1, "at_risk": 2}


def _severity(fixation_pct: float, watch: float, at_risk: float) -> str:
    # Inverted vs. balance.py's _severity, same direction as rom.py's: here
    # HIGHER is better, so severity worsens as fixation_pct drops.
    if fixation_pct <= at_risk:
        return "at_risk"
    if fixation_pct <= watch:
        return "watch"
    return "ok"


def _evaluate_check(joints_np: np.ndarray, reps: list[dict], check: JointFixationCheck) -> dict | None:
    rep_results = []
    for i, rep in enumerate(reps):
        start_idx = rep.get(check.window_start_selector)
        end_idx = rep.get(check.window_end_selector)
        if start_idx is None or end_idx is None or end_idx <= start_idx:
            continue
        if not (0 <= start_idx < joints_np.shape[0]) or not (0 <= end_idx < joints_np.shape[0]):
            continue

        l_series = []
        r_series = []
        for frame_idx in range(start_idx, end_idx + 1):
            l_val, r_val = side_values(joints_np[frame_idx], check.signal)
            l_series.append(l_val)
            r_series.append(r_val)

        l_dev = max(l_series) - min(l_series)
        r_dev = max(r_series) - min(r_series)
        achieved_deviation = (l_dev + r_dev) / 2.0

        fixation_pct = max(0.0, min(100.0, 100.0 - achieved_deviation / max(check.max_deviation, 1e-6) * 100.0))
        severity = _severity(fixation_pct, check.watch_threshold_pct, check.at_risk_threshold_pct)
        rep_results.append({
            "rep": i, "start_frame": int(start_idx), "end_frame": int(end_idx),
            "l_deviation": round(l_dev, 2), "r_deviation": round(r_dev, 2),
            "achieved_deviation": round(achieved_deviation, 2),
            "fixation_pct": round(fixation_pct, 2),
            "severity": severity,
        })

    if not rep_results:
        return None

    mean_fixation_pct = float(np.mean([r["fixation_pct"] for r in rep_results]))
    worst_severity = min(rep_results, key=lambda r: _SEVERITY_RANK[r["severity"]])["severity"]

    return {
        "id": check.id, "label": check.label, "joint": check.joint,
        "informational": check.informational,
        "max_deviation": check.max_deviation,
        "fixation_pct": round(mean_fixation_pct, 2),
        "severity": worst_severity,
        "watch_threshold_pct": check.watch_threshold_pct,
        "at_risk_threshold_pct": check.at_risk_threshold_pct,
        "description": check.description,
        "research": list(check.research),
        "reps": rep_results,
    }


def analyze_fixation(joints_np: np.ndarray, exercise_key: str | None, reps: list[dict], fps: float = 30.0) -> dict | None:
    """joints_np: (L, 22, 3) world-space SMPL joints for the clip.
    reps: this exercise's rep windows, from exercises.get_exercise_reps().
    fps: unused here, accepted only so every analyzer in analysis.py's
        _ANALYZERS registry shares one call signature.

    Returns None if there's no fixation profile for this exercise or no reps
    to evaluate — analysis.py treats that as "this method doesn't apply
    here" and omits it from the report rather than emitting an empty stub.
    """
    profile = FIXATION_PROFILES.get(exercise_key) if exercise_key else None
    if profile is None or not reps:
        return None

    checks = [c for c in (_evaluate_check(joints_np, reps, chk) for chk in profile.checks) if c is not None]
    if not checks:
        return None

    overall_fixation_pct = float(np.mean([c["fixation_pct"] for c in checks]))

    unstable_joints = [
        {
            "id": c["id"], "label": c["label"], "joint": c["joint"],
            "rep": r["rep"], "achieved_deviation": r["achieved_deviation"], "fixation_pct": r["fixation_pct"],
        }
        for c in checks for r in c["reps"] if r["severity"] == "at_risk"
    ]

    return {
        "method": "arm_fixation",
        "overall_fixation_pct": round(overall_fixation_pct, 2),
        "rep_count": len(reps),
        "joint_checks": checks,
        "unstable_joints": unstable_joints,
    }
