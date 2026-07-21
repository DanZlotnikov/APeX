# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Exercise definition & rep-counting package — see definitions.py for the
architecture overview.

Public API (what the rest of the pipeline should import):
    from exercises import analyze_exercises, compute_rep_timeline, stabilize_grip_point
    from exercises import EXERCISE_REGISTRY, ExerciseDefinition, TunableParam

This is a real package (internal modules use relative imports) — callers
just need backend/GENMO/scripts/ on sys.path, same as every other import in
this codebase (worker.py already does this).
"""
from .analyze import analyze_exercises, compute_rep_timeline, get_exercise_reps
from .definitions import EXERCISE_REGISTRY, BodyOrientation, CountingStrategy, ExerciseDefinition, TunableParam
from .rendering import stabilize_grip_point

__all__ = [
    "analyze_exercises",
    "compute_rep_timeline",
    "get_exercise_reps",
    "stabilize_grip_point",
    "EXERCISE_REGISTRY",
    "ExerciseDefinition",
    "TunableParam",
    "BodyOrientation",
    "CountingStrategy",
]
