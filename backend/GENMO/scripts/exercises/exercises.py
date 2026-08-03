# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
The 6 supported exercises, as data. This is the file to open to see or
change what the pipeline detects and how — see definitions.py for the
dataclass shapes and the reasoning behind them.

Every numeric threshold below is either a direct research citation or an
explicit note on why it's adapted/estimated where the literature doesn't
give a precise pose-estimation-ready number. squat and vertical_jump keep
their existing, previously-validated citations; pull_up's citations are new
(the prior version had none); push_up and ab_crunch are new exercises
entirely. (deadlift was briefly reintroduced here and has since been
removed for good — see git history and analyze.py's _resolve_standing.)
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
    },
    # No corroboration gate: this used to require torso_lean to stay under a
    # fixed 40deg at the depth-crossing frame specifically to rule out a hip
    # hinge (deadlift) — but that absolute cutoff could itself get crossed by
    # ordinary pose-estimation noise or a slightly deeper forward lean,
    # silently zeroing out a real squat rep with no partial credit (confirmed
    # against real clips: squat scored 0 while a sibling STANDING exercise
    # won by default — see backend_run.log evidence for job f92db09b...).
    # Now that deadlift is gone, squat has nothing left to be confused with
    # besides vertical_jump (already handled by real flight-phase evidence,
    # see count_flight_phase's max_flight_sec) — so this gate no longer
    # serves any purpose and only cost real detections. min_rom_deg/
    # depth_fraction/stand_fraction on knee_angle alone is squat's signal now.
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
        # No human standing vertical jump gets anywhere near 1s of true
        # airtime (t = 2*sqrt(2h/g); even an elite ~1.2m jump is ~0.99s) —
        # this catches the opposite failure from min_flight_sec: a sustained
        # height-signal drift across a multi-second squat rep (not a single
        # noisy frame) staying above the takeoff threshold long enough to
        # clear min_flight_sec too. Confirmed against a real misclassified
        # clip where a squat's ~3.8s bottom phase registered as one "flight".
        "max_flight_sec": TunableParam(
            "max_flight_sec", "Maximum flight duration", "sec", 1.0, 0.5, 1.5, 0.05,
            "Rejects candidate flight phases no real jump could produce — "
            "almost always a sustained pose-tracking drift during a "
            "different, longer-duration exercise (e.g. a squat).",
        ),
    },
    priority=100,  # real flight evidence beats squat's threshold-crossing guess
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

# ═══════════════════════════════════════════════════════════════════════════
# PADEL STROKE
# ═══════════════════════════════════════════════════════════════════════════
# First exercise in the "padel" category (see supabase/migrations/
# 026_exercise_categories.sql) — a basic v1 detector, not a polished one.
# Forehand and backhand were considered as two separate exercises but
# rejected for now: nothing in this pipeline's signals (all bilaterally
# averaged, see signals.py) distinguishes a rightward swing from a leftward
# one without knowing the athlete's handedness, which isn't tracked anywhere
# — a discriminator built on raw left/right wrist position would be
# systematically backwards for roughly half of all users, not just
# occasionally wrong. So this registers ONE stroke exercise rather than
# guessing at a left/right split. No padel-specific pose-estimation
# literature exists yet to validate these thresholds against — same
# "engineering estimate, not literature-validated" honesty
# biomechanics/fixation_thresholds.py's checks carry for this same exercise,
# see that file.
#
# primary_signal="wrist_hip_dist", NOT elbow_angle — this was the actual
# root cause of a real clip (a low reaching shot near the net) being
# misclassified as a squat with 0 detected stroke reps. Diagnosed from a
# real misclassified processed video: a padel shot is frequently played
# with the racket held close to the chest/body except during the reach and
# swing itself (confirmed visually — both elbows stay noticeably bent
# through most of the clip, only extending briefly for the low reach), so
# elbow_angle's range of motion across the whole rep can be small and
# unreliable as the PRIMARY counting signal — doubly so since good padel
# technique is specifically about keeping the arm/elbow relatively FIXED
# while the shoulder leads the motion (see biomechanics/
# fixation_thresholds.py's whole premise for this exercise) — counting reps
# off elbow flexion would systematically under-detect exactly the well-
# executed strokes this app is trying to encourage. wrist_hip_dist (how far
# the wrist is from the hip) swings through a much larger, more reliable
# range across a real shot regardless of elbow technique: reaching for a low
# ball takes the wrist well away from the hip, then it's drawn back in for
# the recovery/ready position. No corroboration_signal here (unlike
# pull-up/ab-crunch): wrist_hip_dist was previously used as a corroboration
# signal for an elbow_angle-based swing, which is redundant now that it's
# the primary signal — and per squat's own precedent below, a corroboration
# gate that only rejects real reps with no compensating benefit should be
# removed, not kept out of habit.
#
# priority=60 (above squat's 50): both share BodyOrientation.STANDING, and
# _resolve_standing/_resolve_by_priority in analyze.py pick whichever
# same-orientation exercise's detector fired with the higher priority when
# more than one produces reps on the same clip. A padel shot's own knee
# bend (getting down to a low ball) can independently satisfy squat's
# threshold-crossing detector on knee_angle — squat has no gating of its
# own to rule this out (see squat's comment above) — so without a higher
# priority, squat (registered earlier in this file) would silently win
# every one of those clips even once stroke is reliably detecting real
# swings, discarding the actual stroke reps entirely.
register(ExerciseDefinition(
    key="stroke",
    label="Padel Stroke",
    short_label="STROKE",
    description="A padel groundstroke swing — the arm cycles back and "
                 "through a hitting motion once per rep.",
    research=(
        "No padel-specific pose-estimation literature exists yet — the "
        "thresholds below are engineering estimates, not literature-"
        "validated citations, unlike every other exercise registered in "
        "this file. Revisit once real footage/research is available.",
    ),
    orientation=BodyOrientation.STANDING,
    primary_signal="wrist_hip_dist",
    counting_strategy=CountingStrategy.SWING_DETECTOR,
    params={
        "min_rom_deg": TunableParam(
            # Key is "min_rom_deg" (not renamed) only because analyze.py's
            # SWING_DETECTOR dispatch looks params up by this fixed name
            # regardless of exercise — the value below is a distance in
            # meters, not degrees, since the underlying signal changed.
            "min_rom_deg", "Minimum swing range", "m", 0.15, 0.05, 0.6, 0.01,
            "Wrist-to-hip distance change required for a swing to count — "
            "reaching for a shot and recovering to a ready position moves "
            "the wrist a substantial fraction of arm's length; this floor "
            "is kept modest since no padel-specific data exists yet to "
            "tune it against.",
        ),
        "min_drop_fraction": TunableParam(
            "min_drop_fraction", "Swing confirmation", "fraction of ROM", 0.30, 0.1, 0.6, 0.05,
            "How far wrist-to-hip distance must swing back from a tracked "
            "peak/trough to confirm that extreme was real, not noise — "
            "same value pull-up/ab-crunch already use for this engine.",
        ),
    },
    priority=60,
))
