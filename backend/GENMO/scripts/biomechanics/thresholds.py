# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Biomechanical-analysis thresholds — the single point of truth, mirroring
exercises/definitions.py + exercises/exercises.py's pattern: shapes here are
plain data (JointBalanceCheck / ExerciseBalanceProfile), sized so a future
settings UI can render `watch_threshold_pct` / `at_risk_threshold_pct` as
sliders per joint check, per exercise, exactly like exercises' TunableParam.

Every threshold below carries a `research` citation. Where the literature
gives a direct, exercise-specific number, it's cited as such. Where it
doesn't (marked `informational=True`), the check still runs and reports a
percentage, but the threshold is an engineering estimate, not a validated
clinical/sports-science cutoff — the same honesty `exercises.py` already
applies to deadlift's un-standardized ROM thresholds.

── The two metrics ───────────────────────────────────────────────────────
"lsi"  — Limb Symmetry Index: asymmetry% = |L-R| / max(|L|,|R|) * 100,
    applied to a joint ANGLE (knee/hip/elbow flexion) at a specific rep
    frame. This is the standard sports-science interlimb-comparison metric
    (PMID 22801421; Bishop et al. interlimb-asymmetry framework — ~10% is
    the threshold most consistently treated as "practically significant"
    across strength/power/jump asymmetry research; ACL return-to-sport
    criteria specifically flag >10-15% LSI deficits as elevated re-injury
    risk). Reused directly from the existing mobile app precedent
    (exerciseMetrics.ts's `symmetry` metric), now computed per-exercise
    and per-joint instead of one generic value.
"tilt" — a lateral-tilt proxy: asymmetry% = |L_y-R_y| / torso_scale * 100,
    applied to a joint HEIGHT pair (hip/shoulder) at a specific rep frame.
    Used for hip-hike / shoulder-hike checks where no joint-angle LSI
    applies. No peer-reviewed degrees-or-percent standard exists for these
    specifically (confirmed via literature search) — every "tilt" check in
    this file is marked `informational=True`.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class JointBalanceCheck:
    id: str
    label: str
    joints: tuple[str, str]  # display names, e.g. ("L_KNEE", "R_KNEE")
    signal: str  # key into balance.py's SIGNAL_SPECS
    frame_selector: str  # which frame of each rep dict to sample: "start" | "bottom" | "end"
    metric: str  # "lsi" | "tilt"
    watch_threshold_pct: float
    at_risk_threshold_pct: float
    research: tuple[str, ...]
    description: str
    informational: bool = False  # True: threshold is an engineering estimate, not literature-validated


@dataclass(frozen=True)
class ExerciseBalanceProfile:
    exercise_key: str
    checks: tuple[JointBalanceCheck, ...] = field(default_factory=tuple)


BALANCE_PROFILES: dict[str, ExerciseBalanceProfile] = {}


def register_balance(profile: ExerciseBalanceProfile) -> ExerciseBalanceProfile:
    BALANCE_PROFILES[profile.exercise_key] = profile
    return profile


_LSI_CORE_RESEARCH = (
    "PMID 22801421 — ACL return-to-sport LSI framework (>10-15% deficit = elevated re-injury risk)",
    "Bishop et al. interlimb-asymmetry framework — ~10% practical-significance threshold, "
    "widely adopted across strength/power/jump asymmetry research",
)

# ═══════════════════════════════════════════════════════════════════════════
# SQUAT
# ═══════════════════════════════════════════════════════════════════════════
register_balance(ExerciseBalanceProfile(
    exercise_key="squat",
    checks=(
        JointBalanceCheck(
            id="knee_flexion", label="Knee flexion",
            joints=("L_KNEE", "R_KNEE"), signal="knee_angle",
            frame_selector="bottom", metric="lsi",
            watch_threshold_pct=10.0, at_risk_threshold_pct=20.0,
            research=_LSI_CORE_RESEARCH + (
                "Bilateral squat-symmetry categorization (0-10% / 10-20% / >20% asymmetry "
                "bands), e.g. PMC7382835 heel-height squat-symmetry study",
            ),
            description="Knee-angle symmetry at the deepest point of the squat — flags one "
                         "knee flexing (loading) more than the other.",
        ),
        JointBalanceCheck(
            id="hip_flexion", label="Hip flexion",
            joints=("L_HIP", "R_HIP"), signal="hip_angle",
            frame_selector="bottom", metric="lsi",
            watch_threshold_pct=10.0, at_risk_threshold_pct=20.0,
            research=_LSI_CORE_RESEARCH,
            description="Hip-angle symmetry at the deepest point of the squat.",
        ),
    ),
))

# ═══════════════════════════════════════════════════════════════════════════
# DEADLIFT
# ═══════════════════════════════════════════════════════════════════════════
register_balance(ExerciseBalanceProfile(
    exercise_key="deadlift",
    checks=(
        JointBalanceCheck(
            id="hip_hinge", label="Hip hinge",
            joints=("L_HIP", "R_HIP"), signal="hip_angle",
            frame_selector="bottom", metric="lsi",
            watch_threshold_pct=10.0, at_risk_threshold_pct=20.0,
            research=_LSI_CORE_RESEARCH,
            description="Hip-angle symmetry at the bottom of the hinge (same joint pair as "
                         "squat's hip check, read in the hinge context).",
        ),
        JointBalanceCheck(
            id="hip_hike", label="Hip hike (pelvic obliquity)",
            joints=("L_HIP", "R_HIP"), signal="hip_y",
            frame_selector="bottom", metric="tilt",
            watch_threshold_pct=4.0, at_risk_threshold_pct=8.0,
            research=(
                "resilientedu.com — lateral pelvic tilt / hip hike under a loaded hinge",
                "No peer-reviewed degree-or-percent pelvic-obliquity standard was found for "
                "the deadlift specifically — thresholds below are an engineering estimate "
                "(informational only), mirroring how exercises.py already discloses "
                "deadlift's ROM thresholds as adapted rather than literature-sourced.",
            ),
            description="One hip riding higher than the other at the bottom of the lift — a "
                         "classic sign of asymmetric loading or a mobility restriction on one side.",
            informational=True,
        ),
    ),
))

# ═══════════════════════════════════════════════════════════════════════════
# VERTICAL JUMP
# ═══════════════════════════════════════════════════════════════════════════
register_balance(ExerciseBalanceProfile(
    exercise_key="vertical_jump",
    checks=(
        JointBalanceCheck(
            id="takeoff_symmetry", label="Takeoff knee symmetry",
            joints=("L_KNEE", "R_KNEE"), signal="knee_angle",
            frame_selector="start", metric="lsi",
            watch_threshold_pct=10.0, at_risk_threshold_pct=15.0,
            research=(
                "PMC10142123 — CMJ interlimb hip/knee asymmetry detection in elite youth athletes",
            ) + _LSI_CORE_RESEARCH,
            description="Knee-angle symmetry at the instant of takeoff — an asymmetric "
                         "push-off is a common compensation for a weaker/stiffer leg.",
        ),
        JointBalanceCheck(
            id="landing_symmetry", label="Landing knee symmetry",
            joints=("L_KNEE", "R_KNEE"), signal="knee_angle",
            frame_selector="end", metric="lsi",
            watch_threshold_pct=10.0, at_risk_threshold_pct=15.0,
            research=(
                "PMC9428587 / Frontiers fphys.2022.877394 — CMJ landing knee-angle asymmetry "
                "and its link to knee-joint injury risk",
            ) + _LSI_CORE_RESEARCH,
            description="Knee-angle symmetry at landing — asymmetric landing mechanics are "
                         "the more injury-relevant moment of the two (higher joint loading "
                         "than takeoff).",
        ),
    ),
))

# ═══════════════════════════════════════════════════════════════════════════
# PULL-UP
# ═══════════════════════════════════════════════════════════════════════════
register_balance(ExerciseBalanceProfile(
    exercise_key="pull_up",
    checks=(
        JointBalanceCheck(
            id="elbow_flexion", label="Elbow flexion",
            joints=("L_ELBOW", "R_ELBOW"), signal="elbow_angle",
            frame_selector="bottom", metric="lsi",
            watch_threshold_pct=10.0, at_risk_threshold_pct=20.0,
            research=_LSI_CORE_RESEARCH + (
                "No peer-reviewed pull-up-specific interlimb-asymmetry study was found "
                "(only coaching/anecdotal sources, e.g. bullbarfit.com, on arm-dominance "
                "imbalance) — thresholds adapted from the general LSI framework above.",
            ),
            description="Elbow-flexion symmetry at the top of the pull — one arm doing "
                         "disproportionately more of the work.",
        ),
        JointBalanceCheck(
            id="shoulder_hike", label="Shoulder hike",
            joints=("L_SHOULDER", "R_SHOULDER"), signal="shoulder_y",
            frame_selector="bottom", metric="tilt",
            watch_threshold_pct=4.0, at_risk_threshold_pct=8.0,
            research=(
                "No literature standard found — engineering-estimate proxy for compensatory "
                "torso rotation/shoulder hike when one arm dominates the pull (informational only).",
            ),
            description="One shoulder riding higher than the other at the top of the pull.",
            informational=True,
        ),
    ),
))

# ═══════════════════════════════════════════════════════════════════════════
# PUSH-UP
# ═══════════════════════════════════════════════════════════════════════════
register_balance(ExerciseBalanceProfile(
    exercise_key="push_up",
    checks=(
        JointBalanceCheck(
            id="elbow_flexion", label="Elbow flexion",
            joints=("L_ELBOW", "R_ELBOW"), signal="elbow_angle",
            frame_selector="bottom", metric="lsi",
            watch_threshold_pct=10.0, at_risk_threshold_pct=20.0,
            research=(
                "Quantitative Analysis of Kinematic Asymmetry in Push-Ups and Its Correlation "
                "with Muscular Fatigue (academia.edu) — push-up-specific kinematic asymmetry",
            ) + _LSI_CORE_RESEARCH,
            description="Elbow-flexion symmetry at the bottom of the rep.",
        ),
        JointBalanceCheck(
            id="shoulder_tilt", label="Shoulder tilt",
            joints=("L_SHOULDER", "R_SHOULDER"), signal="shoulder_y",
            frame_selector="bottom", metric="tilt",
            watch_threshold_pct=4.0, at_risk_threshold_pct=8.0,
            research=(
                "No literature standard found — engineering-estimate proxy for body "
                "rotation/uneven load at the bottom of the rep (informational only).",
            ),
            description="Body rotating/tilting to one side at the bottom of the push-up.",
            informational=True,
        ),
    ),
))

# ═══════════════════════════════════════════════════════════════════════════
# AB CRUNCH
# ═══════════════════════════════════════════════════════════════════════════
register_balance(ExerciseBalanceProfile(
    exercise_key="ab_crunch",
    checks=(
        JointBalanceCheck(
            id="trunk_lift_tilt", label="Trunk lift tilt",
            joints=("L_SHOULDER", "R_SHOULDER"), signal="shoulder_y",
            frame_selector="bottom", metric="tilt",
            watch_threshold_pct=5.0, at_risk_threshold_pct=10.0,
            research=(
                "Physiopedia — curl-ups are a sagittal-plane, midline (trunk-flexion) "
                "movement; no L/R asymmetry standard exists for the crunch in the "
                "literature. This check is a low-confidence oblique-bias proxy only "
                "(informational) — included for architectural completeness across all 6 "
                "exercises rather than a validated claim.",
            ),
            description="One shoulder lifting higher than the other at the top of the curl "
                         "— a possible sign of oblique/rotational compensation.",
            informational=True,
        ),
    ),
))
