# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Biomechanical-analysis package — see analysis.py for the architecture
overview (the flow it completes, and how to add a new analysis method
beyond the current left/right balance).

Public API (what the rest of the pipeline should import):
    from biomechanics import run_biomechanical_analysis
    from biomechanics import BALANCE_PROFILES, ExerciseBalanceProfile, JointBalanceCheck

Sibling package to `exercises` on backend/GENMO/scripts/ — imports from
here reach into `exercises.signals` the same way worker.py reaches into
both, since both packages are added to sys.path the same way (the
directory a script is run from is always on sys.path[0]).
"""
from .analysis import run_biomechanical_analysis
from .thresholds import BALANCE_PROFILES, ExerciseBalanceProfile, JointBalanceCheck

__all__ = [
    "run_biomechanical_analysis",
    "BALANCE_PROFILES",
    "ExerciseBalanceProfile",
    "JointBalanceCheck",
]
