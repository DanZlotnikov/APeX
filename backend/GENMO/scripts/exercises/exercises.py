# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
The 7 supported exercises, as data. This is the file to open to see or
change what the pipeline detects and how — see definitions.py for the
dataclass shapes and the reasoning behind them.

Every numeric threshold below is either a direct research citation or an
explicit note on why it's adapted/estimated where the literature doesn't
give a precise pose-estimation-ready number. squat and vertical_jump keep
their existing, previously-validated citations; pull_up's citations are new
(the prior version had none); deadlift, push_up, and ab_crunch are new
exercises entirely.
"""
from __future__ import annotations

from .definitions import (
    BodyOrientation,
    CountingStrategy,
    ExerciseDefinition,
    TunableParam,
    register,
)

# ═══════════════════════════════════════════════════════════════════════════
# SQUAT
# ═══════════════════════════════════════════════════════════════════════════
# Depth: parallel is conventionally 70-90 deg of knee flexion, "deep" is
# >90-100 deg (Advanced Human Performance; muscleevo.net squat-depth
# summaries); quadriceps activation is comparably high across parallel-to-
# deep, so there's no single "correct" depth to gate on — hence a per-
# athlete adaptive depth (fraction of *their own* observed ROM) rather than
# a fixed angle. A shallow quarter-squat alone still carries ~30-45 deg of
# knee-angle change (PMID 22801421; IJSPT 2021 depth benchmarks), which sets
# the minimum-ROM noise floor below.
register(ExerciseDefinition(
    key="squat",
    label="Squat",
    short_label="SQUAT",
    description="Bilateral knee flexion with the torso staying upright, "
                 "descending to at least the athlete's own comfortable depth.",
    research=(
        "PMID 22801421 — ACL return-to-sport squat-depth benchmarks",
        "IJSPT 2021 — squat depth classification (partial/parallel/deep)",
        "Advanced Human Performance — 90-degree & parallel vs. ATG squats",
    ),
    orientation=BodyOrientation.STANDING,
    primary_signal="knee_angle",
    counting_strategy=CountingStrategy.THRESHOLD_CROSSING,
    params={
        "min_rom_deg": TunableParam(
            "min_rom_deg", "Minimum range of motion", "deg", 35, 15, 60, 1,
            "Knee-angle change required before a dip counts as a squat at all "
            "— filters incidental knee movement from other exercises.",
        ),
        "depth_fraction": TunableParam(
            "depth_fraction", "Depth threshold", "fraction of ROM", 0.25, 0.05, 0.5, 0.05,
            "How close to this clip's deepest observed knee angle counts as "
            "'at depth' — lower is stricter (demands going deeper).",
        ),
        "stand_fraction": TunableParam(
            "stand_fraction", "Stand-up threshold", "fraction of ROM", 0.55, 0.3, 0.9, 0.05,
            "How close to standing (knee extended) counts as 'back up', "
            "confirming the rep.",
        ),
        "torso_lean_max_deg": TunableParam(
            "torso_lean_max_deg", "Max torso lean", "deg", 40, 15, 70, 5,
            "Torso lean from vertical must stay under this at depth — an "
            "upright torso is what makes it a squat rather than a hip hinge.",
        ),
    },
    corroboration=(("torso_lean", "lt", "torso_lean_max_deg"),),
    discriminator="hinge_vs_squat",
    priority=50,
))

# ═══════════════════════════════════════════════════════════════════════════
# DEADLIFT
# ═══════════════════════════════════════════════════════════════════════════
# A hip hinge is defined by the hips shifting back and the torso rotating
# forward from the hip, while the knees stay close to vertical (5-20 deg of
# soft bend) — hip flexion dominates, knee flexion is minimal (FitnessRec;
# sciencewatch.blog hip-hinge biomechanics guide). That ratio — not a single
# absolute torso-lean cutoff — is what actually distinguishes a hinge from a
# squat; a fixed cutoff is exactly what caused deadlift to be pulled from
# the mobile app entirely (see mobile/src/utils/exerciseAnalyzer.ts's header
# comment). No peer-reviewed source was found giving a precise degrees-based
# hip-angle ROM standard for the deadlift specifically (unlike squat's
# well-quantified depth literature) — min_rom_deg/depth_fraction/
# stand_fraction below mirror squat's adaptive-ROM pattern rather than a
# literature-specified number, since the qualitative hinge criteria above
# don't translate to one.
register(ExerciseDefinition(
    key="deadlift",
    label="Deadlift",
    short_label="DEADLIFT",
    description="Hip hinge: hips travel back and the torso rotates forward "
                 "from the hip while the knees stay close to vertical, then "
                 "return to a fully upright lockout.",
    research=(
        "FitnessRec — hip hinge technique for athletes",
        "sciencewatch.blog — deadlift hip-hinge biomechanics guide",
        "PowerliftingTechnique.com — hip position for deadlifts",
    ),
    orientation=BodyOrientation.STANDING,
    primary_signal="hip_angle",
    counting_strategy=CountingStrategy.THRESHOLD_CROSSING,
    params={
        "min_rom_deg": TunableParam(
            "min_rom_deg", "Minimum range of motion", "deg", 30, 15, 60, 1,
            "Hip-angle change required before a rep counts — filters "
            "incidental hip movement (e.g. adjusting stance) from a real hinge.",
        ),
        "depth_fraction": TunableParam(
            "depth_fraction", "Depth threshold", "fraction of ROM", 0.25, 0.05, 0.5, 0.05,
            "How close to this clip's deepest observed hip flexion counts "
            "as 'at the bottom'.",
        ),
        "stand_fraction": TunableParam(
            "stand_fraction", "Lockout threshold", "fraction of ROM", 0.55, 0.3, 0.9, 0.05,
            "How close to fully upright counts as lockout, confirming the rep.",
        ),
        "hip_dominant_ratio": TunableParam(
            "hip_dominant_ratio", "Hip/knee dominance ratio", "ratio", 1.3, 1.0, 3.0, 0.1,
            "How much more the hip must move than the knee (by range of "
            "motion) to be classified as a hinge rather than a squat.",
        ),
    },
    discriminator="hinge_vs_squat",
    priority=50,
))

# ═══════════════════════════════════════════════════════════════════════════
# VERTICAL JUMP
# ═══════════════════════════════════════════════════════════════════════════
# Flight phase = time between takeoff and landing (Kinvent CMJ guide;
# Hawkin Dynamics CMJ phase guide). Thresholds are fractions of the
# athlete's own standing shoulder-to-ankle span, not a fixed frame-height
# fraction, so they track how large the athlete appears in frame rather
# than breaking whenever camera distance/zoom changes (PMC 11208864;
# PMC 11368081). Ankle-position changes between takeoff/landing are a known
# error source specifically for *jump-height* estimation from flight time
# (PeerJ 17704) — not addressed here since this only counts reps, but worth
# keeping in mind if per-rep height ever needs tightening.
register(ExerciseDefinition(
    key="vertical_jump",
    label="Vertical Jump",
    short_label="JUMP",
    description="A genuine airborne phase: both feet leave the ground and "
                 "return, distinct from a squat's countermovement dip.",
    research=(
        "PMC 11208864 / PMC 11368081 — CMJ flight-phase pose estimation",
        "Kinvent — mastering the countermovement jump",
        "PeerJ 17704 — ankle-position error in flight-time jump-height estimation",
    ),
    orientation=BodyOrientation.STANDING,
    primary_signal="ankle_y",
    counting_strategy=CountingStrategy.FLIGHT_PHASE,
    params={
        "baseline_fraction": TunableParam(
            "baseline_fraction", "Baseline window", "fraction of clip", 0.12, 0.05, 0.3, 0.01,
            "Leading fraction of the clip averaged to establish the "
            "athlete's standing ankle height and body-scale reference.",
        ),
        "takeoff_fraction": TunableParam(
            "takeoff_fraction", "Takeoff threshold", "fraction of body scale", 0.10, 0.02, 0.3, 0.01,
            "Ankle rise above baseline (as a fraction of standing "
            "shoulder-to-ankle span) required to register takeoff.",
        ),
        "landing_fraction": TunableParam(
            "landing_fraction", "Landing threshold", "fraction of body scale", 0.04, 0.01, 0.15, 0.01,
            "Ankle rise must fall back below this to confirm landing.",
        ),
        "min_flight_sec": TunableParam(
            "min_flight_sec", "Minimum flight duration", "sec", 0.15, 0.05, 0.5, 0.01,
            "Rejects landmark-noise blips (e.g. a heel rise mid-squat) — a "
            "real airborne phase lasts much longer than one noisy frame.",
        ),
    },
    priority=100,  # real flight evidence beats the squat/deadlift threshold-crossing guess
))

# ═══════════════════════════════════════════════════════════════════════════
# PULL-UP
# ═══════════════════════════════════════════════════════════════════════════
# Valid rep = full extension at the dead hang (elbow angle > ~160 deg) with
# the chin clearing the bar at the top (Springer "Biomechanical
# characterisation of the pull-up exercise"; common automated-counter
# convention of registering on >160 deg extension + chin-over-bar). This
# pipeline doesn't track a chin keypoint, so wrist-above-shoulder (overhead
# grip) plus elbow-angle ROM is used as the closest available proxy — the
# same approach the original MediaPipe-based analyzer used.
register(ExerciseDefinition(
    key="pull_up",
    label="Pull-Up",
    short_label="PULL-UP",
    description="Overhead grip with the elbow cycling from full extension "
                 "(dead hang) to contracted (chin near the bar) and back.",
    research=(
        "Springer Sport Sciences for Health — biomechanical characterisation of the pull-up",
        "labellerr.com — AI pull-up counter with pose estimation (>160deg extension + chin-over-bar convention)",
    ),
    orientation=BodyOrientation.HANGING_OVERHEAD,
    primary_signal="elbow_angle",
    counting_strategy=CountingStrategy.SWING_DETECTOR,
    params={
        "min_rom_deg": TunableParam(
            "min_rom_deg", "Minimum range of motion", "deg", 18, 10, 60, 1,
            "Elbow-angle change required for a swing to count — softened "
            "from a stricter value so partial/band-assisted reps still "
            "qualify; the body-rise corroboration below is what actually "
            "guards against noise.",
        ),
        "min_drop_fraction": TunableParam(
            "min_drop_fraction", "Swing confirmation", "fraction of ROM", 0.30, 0.1, 0.6, 0.05,
            "How far the elbow angle must swing back from a tracked "
            "peak/trough to confirm that extreme was real, not noise.",
        ),
        "body_rise_fraction": TunableParam(
            "body_rise_fraction", "Body-rise corroboration", "fraction of torso length", 0.15, 0.05, 0.4, 0.01,
            "Wrist-to-hip distance must shrink by at least this much "
            "(scaled to the athlete's own torso length) for a confirmed "
            "elbow swing to count as a real rep — rules out elbow-tracking "
            "noise with no actual body movement behind it.",
        ),
        "overhead_gate": TunableParam(
            "overhead_gate", "Per-frame overhead gate", "0-1", 0.3, 0.1, 0.9, 0.05,
            "Only frames with the wrist-above-shoulder signal past this "
            "value are considered part of the movement at all.",
        ),
    },
    # Note: the CLIP-level gate lives in orientation.py (it's what classifies
    # a clip as HANGING_OVERHEAD at all — a *continuous* overhead hold of
    # some minimum duration, not a cumulative fraction; see its module
    # docstring for why a fraction alone isn't enough to rule out a vertical
    # jump's arm swing); valid_frame_check below is the separate PER-FRAME
    # gate within an already-classified clip.
    valid_frame_check=("wrist_above", "gt", "overhead_gate"),
    corroboration_signal="wrist_hip_dist",
    corroboration_delta_param="body_rise_fraction",
    priority=50,
))

# ═══════════════════════════════════════════════════════════════════════════
# PUSH-UP
# ═══════════════════════════════════════════════════════════════════════════
# FITNESSGRAM and comparable automated counters register a rep on an UP
# stage (elbow angle >160 deg) to DOWN stage (<90 deg) transition
# (labellerr.com AI push-up counter; Republic of Korea Army push-up
# standard: elbows above shoulder height at the bottom). Kept on the same
# adaptive-fraction engine as every other threshold-crossing exercise here
# for architectural consistency rather than switching to literal absolute
# angles — depth_fraction/stand_fraction below are tuned so the adaptive
# thresholds land close to that 90/160 convention for a typical rep.
register(ExerciseDefinition(
    key="push_up",
    label="Push-Up",
    short_label="PUSH-UP",
    description="Elbow flexion from a straight-arm plank down toward the "
                 "ground and back, with the body staying in a straight line.",
    research=(
        "labellerr.com — AI-powered push-up counter (UP >160deg / DOWN <90deg)",
        "FITNESSGRAM — 90-degree elbow reference standard",
        "ResearchGate — The Biomechanics of the Push-up",
    ),
    orientation=BodyOrientation.HORIZONTAL_PLANK,
    primary_signal="elbow_angle",
    counting_strategy=CountingStrategy.THRESHOLD_CROSSING,
    params={
        "min_rom_deg": TunableParam(
            "min_rom_deg", "Minimum range of motion", "deg", 40, 15, 90, 1,
            "Elbow-angle change required before a dip counts as a push-up "
            "— a real rep commonly spans 70-100+ deg, so this floor still "
            "admits a shallow/partial rep while filtering noise.",
        ),
        "depth_fraction": TunableParam(
            "depth_fraction", "Depth threshold", "fraction of ROM", 0.25, 0.05, 0.5, 0.05,
            "How close to this clip's most-bent elbow angle counts as "
            "'at the bottom'.",
        ),
        "stand_fraction": TunableParam(
            "stand_fraction", "Lockout threshold", "fraction of ROM", 0.55, 0.3, 0.9, 0.05,
            "How close to fully extended arms counts as 'back up', "
            "confirming the rep.",
        ),
        "body_line_min_deg": TunableParam(
            "body_line_min_deg", "Min plank straightness", "deg", 120, 90, 170, 5,
            "Hip-knee-ankle angle must stay above this at the bottom of "
            "the rep — guards against hips sagging/piking so far that it's "
            "no longer a straight-body plank.",
        ),
    },
    corroboration=(("body_line_angle", "gt", "body_line_min_deg"),),
    priority=50,
))

# ═══════════════════════════════════════════════════════════════════════════
# AB CRUNCH
# ═══════════════════════════════════════════════════════════════════════════
# A crunch/curl-up isolates spinal (trunk) flexion through roughly 30-45 deg
# of upper-trunk movement while the lumbar spine stays on the floor —
# distinct from a sit-up, which is hip flexion (Physiopedia curl-ups;
# rectus-abdominis EMG research on curl-up angle). Reuses the same
# shoulder-hip-knee angle as squat's hip_angle signal — it's the same joint
# triple, just read in a lying-down context instead of standing — on the
# swing-detector engine (mirroring pull-up) rather than threshold-crossing,
# since a crunch's small ROM is exactly the shallow/partial-rep scenario
# the swing detector was built to handle correctly at a sparse capture rate.
register(ExerciseDefinition(
    key="ab_crunch",
    label="Ab Crunch",
    short_label="CRUNCH",
    description="Trunk (spinal) flexion lifting the shoulders off the "
                 "ground toward the knees, with the hips staying down.",
    research=(
        "Physiopedia — Curl-ups (trunk flexion vs. sit-up's hip flexion)",
        "EMG research — peak abdominal activation near 30 deg curl-up angle",
    ),
    orientation=BodyOrientation.HORIZONTAL_LYING,
    primary_signal="hip_angle",
    counting_strategy=CountingStrategy.SWING_DETECTOR,
    params={
        "min_rom_deg": TunableParam(
            "min_rom_deg", "Minimum range of motion", "deg", 15, 5, 45, 1,
            "Trunk-angle change required for a swing to count — a full "
            "crunch's real ROM is only ~30-45 deg to begin with, so this "
            "floor is deliberately permissive.",
        ),
        "min_drop_fraction": TunableParam(
            "min_drop_fraction", "Swing confirmation", "fraction of ROM", 0.30, 0.1, 0.6, 0.05,
            "How far the trunk angle must swing back from a tracked "
            "peak/trough to confirm that extreme was real, not noise.",
        ),
        "body_rise_fraction": TunableParam(
            "body_rise_fraction", "Body-rise corroboration", "fraction of torso length", 0.10, 0.02, 0.3, 0.01,
            "Shoulder-to-knee distance must shrink by at least this much "
            "(scaled to torso length) for a confirmed trunk-angle swing to "
            "count as a real rep, ruling out tracking noise with no actual "
            "movement behind it.",
        ),
    },
    corroboration_signal="shoulder_knee_dist",
    corroboration_delta_param="body_rise_fraction",
    priority=50,
))
