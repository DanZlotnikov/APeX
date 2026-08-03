# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Top-level entrypoint for biomechanical analysis — the only file the rest of
the pipeline (worker.py, backend/server/pipeline.py) imports from this
package, same relationship exercises/analyze.py has to the exercises
package. Completes the pipeline's natural flow:

    video -> pose estimation -> exercise detection -> biomechanic analysis
          -> reporting -> video creation

run_biomechanical_analysis() is the "biomechanic analysis" + "reporting"
steps: it's called once exercise detection has already produced a joints
array, an active exercise key, and (via exercises.get_exercise_reps) the
rep windows for that exercise; it returns the JSON-serializable report.

── Adding a new analysis method (fatigue, ...) ────────────────────────────
1. Add its thresholds to thresholds.py (or a sibling thresholds module,
   if the new method's tunables don't fit JointBalanceCheck's shape — see
   rom_thresholds.py for a worked example of the sibling-module path).
2. Write a new module (e.g. fatigue.py) with a function
   `analyze_x(joints_np, exercise_key, reps, fps) -> dict | None`.
3. Add one line to _ANALYZERS below.
No other file in this package or the rest of the pipeline needs to change —
this function's signature and the report's top-level shape stay fixed.

`rom` (see rom.py) and `fixation` (see fixation.py) are further analyzers of
this kind, not "future" ones — rom scores how much of each exercise's
expected joint range of motion a rep actually achieved, alongside balance's
left/right symmetry; fixation scores how STEADY a joint stayed across the
whole motion (less deviation = better), for exercises where controlled
stillness matters more than range or symmetry (e.g. padel's stroke — the
arm should stay close to fixed while the shoulder leads). Both are normal
citizens of _ANALYZERS like `balance`, just aimed at different questions.
"""
from __future__ import annotations

import numpy as np

from exercises import get_exercise_reps

from . import balance, fixation, rom

_ANALYZERS = {
    "balance": balance.analyze_balance,
    "rom": rom.analyze_rom,
    "fixation": fixation.analyze_fixation,
}


def run_biomechanical_analysis(
    joints_np: np.ndarray,
    exercise_key: str | None,
    fps: float = 30.0,
    incam_joints: np.ndarray | None = None,
) -> dict:
    """joints_np: (L, 22, 3) world-space SMPL joints for the clip.
    exercise_key: the winning exercise from analyze_exercises() (timeline["key"]),
        or None if no exercise was confidently detected.

    Returns a stable-shape report:
        {"exercise": <key or None>, "rep_count": int, "analyses": {<method>: {...}, ...},
         "reps": [{"rep": int, "start_sec": float, "end_sec": float, "duration_sec": float}, ...]}
    `analyses` only contains methods that actually produced a result for this
    clip (e.g. no balance profile registered for an exercise, or 0 reps) —
    a method being absent means "not applicable here", not "failed".

    `reps` is the canonical {start,end} timing for every detected rep,
    independent of which analysis method(s) ran — a balance check only ever
    samples one frame per rep (no start/end pair of its own), so this is the
    only place a per-rep duration or the rest between consecutive reps can
    come from. Used by the mobile app's per-rep breakdown modal.
    """
    if exercise_key is None:
        return {"exercise": None, "rep_count": 0, "analyses": {}, "reps": []}

    reps = get_exercise_reps(joints_np, exercise_key, fps=fps, incam_joints=incam_joints)
    rep_windows = [
        {
            "rep": i,
            "start_sec": round(r["start"] / fps, 2),
            "end_sec": round(r["end"] / fps, 2),
            "duration_sec": round((r["end"] - r["start"]) / fps, 2),
        }
        for i, r in enumerate(reps)
    ]
    report = {"exercise": exercise_key, "rep_count": len(reps), "analyses": {}, "reps": rep_windows}
    for name, analyzer in _ANALYZERS.items():
        result = analyzer(joints_np, exercise_key, reps, fps)
        if result is not None:
            report["analyses"][name] = result
    return report
