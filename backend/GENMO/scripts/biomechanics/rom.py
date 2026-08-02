# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Range of motion — second biomechanical-analysis method, alongside balance.py
(see rom_thresholds.py for the per-exercise joint checks and their research
citations, and analysis.py for how this plugs into the orchestrator).

Where balance.py compares LEFT against RIGHT at one frame, this compares
ACHIEVED angle change against an EXPECTED (literature-derived) angle change,
between a rep's "start" (extended/standing/hanging reference) and "bottom"
(peak-flexion) frames — bilaterally averaged (mean of left+right), since ROM
here is "how far did the joint travel," not an interlimb comparison. See
rom_thresholds.py's module docstring for why vertical_jump's check reads
start->end rather than start->bottom (a FLIGHT_PHASE rep's "bottom" field
means something different from every other counting strategy's).
"""
from __future__ import annotations

import numpy as np

from .balance import SIGNAL_SPECS, side_values
from .rom_thresholds import ROM_PROFILES, JointRomCheck

_SEVERITY_RANK = {"ok": 0, "watch": 1, "at_risk": 2}


def _severity(rom_pct: float, watch: float, at_risk: float) -> str:
    # Inverted vs. balance.py's _severity: here HIGHER is better (more of
    # the expected range achieved), so severity worsens as rom_pct drops.
    if rom_pct <= at_risk:
        return "at_risk"
    if rom_pct <= watch:
        return "watch"
    return "ok"


def _evaluate_check(joints_np: np.ndarray, reps: list[dict], check: JointRomCheck) -> dict | None:
    rep_results = []
    for i, rep in enumerate(reps):
        start_idx = rep.get(check.start_selector)
        end_idx = rep.get(check.end_selector)
        if start_idx is None or end_idx is None:
            continue
        if not (0 <= start_idx < joints_np.shape[0]) or not (0 <= end_idx < joints_np.shape[0]):
            continue

        l_start, r_start = side_values(joints_np[start_idx], check.signal)
        l_end, r_end = side_values(joints_np[end_idx], check.signal)
        l_deg = abs(l_start - l_end)
        r_deg = abs(r_start - r_end)
        achieved_deg = (l_deg + r_deg) / 2.0

        rom_pct = max(0.0, min(130.0, achieved_deg / max(check.target_rom_deg, 1e-6) * 100.0))
        severity = _severity(rom_pct, check.watch_threshold_pct, check.at_risk_threshold_pct)
        rep_results.append({
            "rep": i, "start_frame": int(start_idx), "end_frame": int(end_idx),
            "l_deg": round(l_deg, 2), "r_deg": round(r_deg, 2),
            "achieved_deg": round(achieved_deg, 2),
            "rom_pct": round(rom_pct, 2),
            "severity": severity,
        })

    if not rep_results:
        return None

    mean_rom_pct = float(np.mean([r["rom_pct"] for r in rep_results]))
    worst_severity = min(rep_results, key=lambda r: _SEVERITY_RANK[r["severity"]])["severity"]

    return {
        "id": check.id, "label": check.label, "joint": check.joint,
        "informational": check.informational,
        "target_rom_deg": check.target_rom_deg,
        "rom_pct": round(mean_rom_pct, 2),
        "severity": worst_severity,
        "watch_threshold_pct": check.watch_threshold_pct,
        "at_risk_threshold_pct": check.at_risk_threshold_pct,
        "description": check.description,
        "research": list(check.research),
        "reps": rep_results,
    }


def analyze_rom(joints_np: np.ndarray, exercise_key: str | None, reps: list[dict], fps: float = 30.0) -> dict | None:
    """joints_np: (L, 22, 3) world-space SMPL joints for the clip.
    reps: this exercise's rep windows, from exercises.get_exercise_reps().
    fps: unused here, accepted only so every analyzer in analysis.py's
        _ANALYZERS registry shares one call signature.

    Returns None if there's no ROM profile for this exercise or no reps to
    evaluate — analysis.py treats that as "this method doesn't apply here"
    and omits it from the report rather than emitting an empty stub.
    """
    profile = ROM_PROFILES.get(exercise_key) if exercise_key else None
    if profile is None or not reps:
        return None

    checks = [c for c in (_evaluate_check(joints_np, reps, chk) for chk in profile.checks) if c is not None]
    if not checks:
        return None

    overall_rom_pct = float(np.mean([c["rom_pct"] for c in checks]))

    limited_joints = [
        {
            "id": c["id"], "label": c["label"], "joint": c["joint"],
            "rep": r["rep"], "achieved_deg": r["achieved_deg"], "rom_pct": r["rom_pct"],
        }
        for c in checks for r in c["reps"] if r["severity"] == "at_risk"
    ]

    return {
        "method": "range_of_motion",
        "overall_rom_pct": round(overall_rom_pct, 2),
        "rep_count": len(reps),
        "joint_checks": checks,
        "limited_joints": limited_joints,
    }
