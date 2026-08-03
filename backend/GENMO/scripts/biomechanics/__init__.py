# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Biomechanical-analysis package — see analysis.py for the architecture
overview (the flow it completes, and how to add a new analysis method
beyond the current left/right balance + range of motion).

Public API (what the rest of the pipeline should import):
    from biomechanics import run_biomechanical_analysis
    from biomechanics import BALANCE_PROFILES, ExerciseBalanceProfile, JointBalanceCheck
    from biomechanics import ROM_PROFILES, ExerciseRomProfile, JointRomCheck
    from biomechanics import FIXATION_PROFILES, ExerciseFixationProfile, JointFixationCheck

Sibling package to `exercises` on backend/GENMO/scripts/ — imports from
here reach into `exercises.signals` the same way worker.py reaches into
both, since both packages are added to sys.path the same way (the
directory a script is run from is always on sys.path[0]).
"""
from .analysis import run_biomechanical_analysis
from .thresholds import BALANCE_PROFILES, ExerciseBalanceProfile, JointBalanceCheck
from .rom_thresholds import ROM_PROFILES, ExerciseRomProfile, JointRomCheck
from .fixation_thresholds import FIXATION_PROFILES, ExerciseFixationProfile, JointFixationCheck

__all__ = [
    "run_biomechanical_analysis",
    "BALANCE_PROFILES",
    "ExerciseBalanceProfile",
    "JointBalanceCheck",
    "ROM_PROFILES",
    "ExerciseRomProfile",
    "JointRomCheck",
    "FIXATION_PROFILES",
    "ExerciseFixationProfile",
    "JointFixationCheck",
]
