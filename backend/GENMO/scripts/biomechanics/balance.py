# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Left/right balance — the first biomechanical-analysis method. See
thresholds.py for the per-exercise joint checks and their research
citations, and analysis.py for how this plugs into the orchestrator.

Every check is evaluated at one frame per rep (its `frame_selector`:
"start"/"bottom"/"end", same frame-index vocabulary counting.py's Rep dicts
already use) rather than continuously across the whole clip — the
biomechanically meaningful moment for a symmetry check is the point of
peak loading/flexion (or takeoff/landing for the jump), not an average
over transition frames where L/R naturally differ for reasons unrelated to
balance (e.g. mid-descent limb-swing timing).
"""
from __future__ import annotations

import numpy as np

from exercises.signals import (
    L_ANKLE, L_ELBOW, L_HIP, L_KNEE, L_SHOULDER, L_WRIST,
    R_ANKLE, R_ELBOW, R_HIP, R_KNEE, R_SHOULDER, R_WRIST,
    angle3d,
)

from .thresholds import BALANCE_PROFILES, JointBalanceCheck

# Where each named signal's left/right joints live, and how to read them.
# "angle": 3-joint (a, vertex b, c) triple per side, degrees via angle3d.
# "y": single joint index per side, world-space height.
SIGNAL_SPECS: dict[str, tuple[str, tuple, tuple]] = {
    "knee_angle": ("angle", (L_HIP, L_KNEE, L_ANKLE), (R_HIP, R_KNEE, R_ANKLE)),
    "hip_angle": ("angle", (L_SHOULDER, L_HIP, L_KNEE), (R_SHOULDER, R_HIP, R_KNEE)),
    "elbow_angle": ("angle", (L_SHOULDER, L_ELBOW, L_WRIST), (R_SHOULDER, R_ELBOW, R_WRIST)),
    "shoulder_y": ("y", L_SHOULDER, R_SHOULDER),
    "hip_y": ("y", L_HIP, R_HIP),
    # Angle AT the shoulder (elbow-shoulder-hip) — how far the upper arm has
    # swung away from the torso, i.e. shoulder horizontal ab/adduction. Used
    # by rom.py for Padel Stroke's swing-ROM check: unlike elbow_angle (the
    # RELATIVE bend at the elbow, which good technique keeps close to fixed
    # — see fixation_thresholds.py), this is driven by shoulder rotation,
    # which is what actually generates a real swing's amplitude.
    "shoulder_angle": ("angle", (L_ELBOW, L_SHOULDER, L_HIP), (R_ELBOW, R_SHOULDER, R_HIP)),
}

_SEVERITY_RANK = {"ok": 0, "watch": 1, "at_risk": 2}


def side_values(frame_joints: np.ndarray, signal_id: str) -> tuple[float, float]:
    """(left, right) value of a named SIGNAL_SPECS signal at one frame."""
    kind, l_spec, r_spec = SIGNAL_SPECS[signal_id]
    if kind == "angle":
        la, lb, lc = l_spec
        ra, rb, rc = r_spec
        l_val = float(angle3d(frame_joints[la], frame_joints[lb], frame_joints[lc]))
        r_val = float(angle3d(frame_joints[ra], frame_joints[rb], frame_joints[rc]))
    else:  # "y"
        l_val = float(frame_joints[l_spec, 1])
        r_val = float(frame_joints[r_spec, 1])
    return l_val, r_val


def _torso_scale(frame_joints: np.ndarray) -> float:
    """Same metric floor (0.20) as exercises/signals.py's torso_scale, kept
    consistent so a "tilt" percentage means the same thing here as it would
    if this were computed alongside the counting signals.
    """
    shoulder_mid_y = (frame_joints[L_SHOULDER, 1] + frame_joints[R_SHOULDER, 1]) / 2
    hip_mid_y = (frame_joints[L_HIP, 1] + frame_joints[R_HIP, 1]) / 2
    return max(abs(float(shoulder_mid_y - hip_mid_y)), 0.20)


def _severity(asymmetry_pct: float, watch: float, at_risk: float) -> str:
    if asymmetry_pct >= at_risk:
        return "at_risk"
    if asymmetry_pct >= watch:
        return "watch"
    return "ok"


def _evaluate_check(joints_np: np.ndarray, reps: list[dict], check: JointBalanceCheck) -> dict | None:
    rep_results = []
    for i, rep in enumerate(reps):
        frame_idx = rep.get(check.frame_selector)
        if frame_idx is None or not (0 <= frame_idx < joints_np.shape[0]):
            continue
        frame_joints = joints_np[frame_idx]
        l_val, r_val = side_values(frame_joints, check.signal)

        if check.metric == "lsi":
            denom = max(abs(l_val), abs(r_val), 1e-6)
            asymmetry_pct = abs(l_val - r_val) / denom * 100.0
        else:  # "tilt"
            asymmetry_pct = abs(l_val - r_val) / _torso_scale(frame_joints) * 100.0

        balance_pct = max(0.0, 100.0 - asymmetry_pct)
        severity = _severity(asymmetry_pct, check.watch_threshold_pct, check.at_risk_threshold_pct)
        rep_results.append({
            "rep": i, "frame": int(frame_idx),
            "l_value": round(l_val, 2), "r_value": round(r_val, 2),
            "asymmetry_pct": round(asymmetry_pct, 2),
            "balance_pct": round(balance_pct, 2),
            "severity": severity,
        })

    if not rep_results:
        return None

    mean_asym = float(np.mean([r["asymmetry_pct"] for r in rep_results]))
    worst_severity = max(rep_results, key=lambda r: _SEVERITY_RANK[r["severity"]])["severity"]

    return {
        "id": check.id, "label": check.label, "joints": list(check.joints),
        "metric": check.metric, "informational": check.informational,
        "balance_pct": round(max(0.0, 100.0 - mean_asym), 2),
        "mean_asymmetry_pct": round(mean_asym, 2),
        "severity": worst_severity,
        "watch_threshold_pct": check.watch_threshold_pct,
        "at_risk_threshold_pct": check.at_risk_threshold_pct,
        "description": check.description,
        "research": list(check.research),
        "reps": rep_results,
    }


def analyze_balance(joints_np: np.ndarray, exercise_key: str | None, reps: list[dict], fps: float = 30.0) -> dict | None:
    """joints_np: (L, 22, 3) world-space SMPL joints for the clip.
    reps: this exercise's rep windows, from exercises.get_exercise_reps().
    fps: unused here, accepted only so every analyzer in analysis.py's
        _ANALYZERS registry shares one call signature.

    Returns None if there's no balance profile for this exercise or no reps
    to evaluate — analysis.py treats that as "this method doesn't apply
    here" and omits it from the report rather than emitting an empty stub.
    """
    profile = BALANCE_PROFILES.get(exercise_key) if exercise_key else None
    if profile is None or not reps:
        return None

    checks = [c for c in (_evaluate_check(joints_np, reps, chk) for chk in profile.checks) if c is not None]
    if not checks:
        return None

    overall_balance_pct = float(np.mean([c["balance_pct"] for c in checks]))

    at_risk_joints = [
        {
            "id": c["id"], "label": c["label"], "joints": c["joints"],
            "rep": r["rep"], "frame": r["frame"], "asymmetry_pct": r["asymmetry_pct"],
        }
        for c in checks for r in c["reps"] if r["severity"] == "at_risk"
    ]

    return {
        "method": "left_right_balance",
        "overall_balance_pct": round(overall_balance_pct, 2),
        "rep_count": len(reps),
        "joint_checks": checks,
        "at_risk_joints": at_risk_joints,
    }
