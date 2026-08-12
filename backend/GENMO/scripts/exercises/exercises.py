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
        "foot_stability_gate": TunableParam(
            "foot_stability_gate", "Max foot travel", "m", 0.18, 0.08, 0.4, 0.02,
            "A candidate squat rep is rejected if the feet moved (stepped/"
            "pivoted) more than this during it — a real squat's feet stay "
            "planted, only loading/unloading in place. Deliberately generous "
            "(a squat has natural sway/heel-lift noise) — this is here to "
            "catch a clearly different motion (e.g. a padel/tennis stroke's "
            "footwork independently triggering squat's knee_angle threshold), "
            "not to nitpick real squat form.",
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
    # see count_flight_phase's max_flight_sec) — so a per-frame corroboration
    # gate still serves no purpose. foot_stability_gate above is a narrower,
    # whole-rep EXCLUSION instead (see exclusion_check's own docstring in
    # definitions.py for why that's a different, safer mechanism than the
    # corroboration gate removed here) — added specifically for the
    # squat-vs-stroke confusion, generous enough not to repeat that same
    # "silently zeroing out a real rep" mistake.
    exclusion_check=("foot_shift", "gt", "foot_stability_gate"),
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
#
# No corroboration gate (used to require body_line_angle > 120deg AT the
# depth-crossing frame specifically, to catch hips sagging/piking out of a
# straight plank) — removed after real clips showed push-ups going
# completely undetected (0 reps) even after fixing orientation.py's own use
# of this exact signal for the same reason: body_line_angle (hip-knee-ankle)
# pose estimation is unreliable for a prone push-up specifically (see
# orientation.py's PLANK_MIN_BODY_LINE_ANGLE comment for the full evidence —
# lowered 140->110 there for legs that were genuinely straight but read as
# bent). A per-frame corroboration check at one specific frame is even more
# exposed to that same noise than orientation's whole-clip median was, so
# keeping ANY value here risked silently zeroing out real reps again. Same
# conclusion, same reasoning, and the same fix squat's own now-removed
# torso_lean corroboration reached earlier (see squat's comment above) —
# a corroboration gate that only rejects real reps with no reliable signal
# behind it should be removed, not re-guessed at a new threshold.
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
    },
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
# the recovery/ready position.
#
# corroboration_signal="foot_shift" (added later, alongside stance_gate
# below) is NOT the same wrist_hip_dist-as-its-own-corroboration setup
# removed early on (that really was redundant — a signal corroborating
# itself as primary signal added nothing). This is a genuinely independent
# signal: how far the feet moved. Added specifically because a real padel/
# tennis stroke typically involves some footwork (stepping/pivoting to reach
# the ball) alongside the arm swing, which a squat's own arm-swing-for-
# balance never has (see squat's new foot_stability_gate for the mirror-
# image fix). Kept deliberately small (foot_movement_fraction below) so a
# genuinely stationary/compact stroke — not every real shot involves
# stepping — doesn't get rejected for lacking footwork it never had.
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
#
# exclusion_check=("knee_angle", "lt", "stance_gate") — added after a real
# clip confirmed the opposite failure mode from the one above: a genuine
# SQUAT (arms swinging forward for balance while descending, a common squat
# technique) independently satisfies stroke's wrist_hip_dist swing detector
# too, and priority=60 then made stroke steal the win outright, mislabeling
# the whole clip. Squat has no arm-swing gating of its own to prevent this
# from the other side either, so the fix has to live here: reject any
# candidate stroke rep whose window ever dipped into squat-depth knee
# flexion, which a real squat's working depth always does. Tried as a
# per-frame valid_frame_check first (only count frames with the knee
# extended toward the running swing state) and confirmed on a synthetic
# squat-with-arm-swing clip that this was NOT enough — masking out the
# low-knee frames still left a complete wrist swing arc inside the
# remaining "legs extended" frames alone, since both signals move together
# through the squat cycle. exclusion_check (see definitions.py) instead
# vetoes the WHOLE candidate rep if the knee ever dropped below the gate
# anywhere in its window, which a masked-frame approach can't express.
# 130deg is a deliberate middle ground, not squat's own "fully standing"
# baseline — it still allows the moderate knee-soften of a real padel low
# reach (see wrist_hip_dist's own history above: that reach is dynamic and
# brief, not a held squat position) while excluding genuine squat depth,
# which drops well below this even for a shallow rep. Engineering estimate
# pending real low-reach footage to confirm the boundary is in the right
# place.
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
        "stance_gate": TunableParam(
            "stance_gate", "Minimum knee extension", "deg", 130, 90, 170, 5,
            "A candidate swing is rejected outright if the knee ever drops "
            "below this at any point during it — rules out a squat's own "
            "arm-swing-for-balance being mistaken for a stroke, while still "
            "allowing the moderate knee-soften of a real low reach.",
        ),
        "foot_movement_gate": TunableParam(
            "foot_movement_gate", "Minimum footwork", "m", 0.05, 0.0, 0.3, 0.01,
            "The feet must travel at least this far (peak-to-trough range "
            "within the swing's own window) for it to count as a real "
            "stroke — kept small so a compact, stationary shot still "
            "passes; only meant to catch a swing with literally zero foot "
            "movement, which a real shot practically never has.",
        ),
    },
    exclusion_check=("knee_angle", "lt", "stance_gate"),
    requirement_check=("foot_shift", "gt", "foot_movement_gate"),
    priority=60,
    category="padel",
))

# ═══════════════════════════════════════════════════════════════════════════
# TENNIS STROKE
# ═══════════════════════════════════════════════════════════════════════════
# A tennis groundstroke and a padel stroke are, per this pipeline's signals,
# essentially the same motion — same reach-and-recover wrist-to-hip swing,
# same reason elbow_angle is unreliable as a primary signal (see padel
# "stroke" above; the "keep the arm fixed, let the shoulder lead" technique
# cue applies just as much to tennis). So this is a near-verbatim clone of
# padel's detector, not an independently-tuned one — there's no real reason
# to expect the two to need different thresholds, and no separate footage
# yet to justify guessing different numbers.
#
# What actually tells these two exercises apart is NOT pose data — see
# analyze.py's sport_key filter, which excludes whichever of padel/tennis
# doesn't match the athlete's own main sport (Supabase profiles.main_sport_key
# / sport_override_key, supabase/migrations/028_main_sport.sql) before
# resolution ever runs. When the athlete's sport is unknown/general_fitness,
# both stay eligible and this always wins the tie over tennis_stroke (see its
# priority note below) — resolved app-side instead: the mobile app asks the
# athlete which sport that was and updates main_sport_key once they answer
# (ProcessingScreen.tsx), so the ambiguity only ever has to be broken once.
register(ExerciseDefinition(
    key="tennis_stroke",
    label="Tennis Stroke",
    short_label="STROKE",
    description="A tennis groundstroke swing — the arm cycles back and "
                 "through a hitting motion once per rep.",
    research=(
        "No tennis-specific pose-estimation literature exists yet — the "
        "thresholds below are inherited unchanged from padel stroke's own "
        "engineering estimates (this pipeline's signals don't distinguish "
        "the two motions), not independently validated citations.",
    ),
    orientation=BodyOrientation.STANDING,
    primary_signal="wrist_hip_dist",
    counting_strategy=CountingStrategy.SWING_DETECTOR,
    params={
        "min_rom_deg": TunableParam(
            "min_rom_deg", "Minimum swing range", "m", 0.15, 0.05, 0.6, 0.01,
            "Wrist-to-hip distance change required for a swing to count — "
            "same value as padel stroke (see that exercise's own comment).",
        ),
        "min_drop_fraction": TunableParam(
            "min_drop_fraction", "Swing confirmation", "fraction of ROM", 0.30, 0.1, 0.6, 0.05,
            "How far wrist-to-hip distance must swing back from a tracked "
            "peak/trough to confirm that extreme was real, not noise.",
        ),
        "stance_gate": TunableParam(
            "stance_gate", "Minimum knee extension", "deg", 130, 90, 170, 5,
            "Same squat-exclusion gate as padel stroke (see that exercise's "
            "own comment) — a candidate swing is rejected outright if the "
            "knee ever drops below this at any point during it.",
        ),
        "foot_movement_gate": TunableParam(
            "foot_movement_gate", "Minimum footwork", "m", 0.05, 0.0, 0.3, 0.01,
            "Same footwork-corroboration gate as padel stroke (see that "
            "exercise's own comment).",
        ),
    },
    exclusion_check=("knee_angle", "lt", "stance_gate"),
    requirement_check=("foot_shift", "gt", "foot_movement_gate"),
    # Registered after padel "stroke" and at the same priority: when both are
    # eligible (sport unknown), exercises_for_orientation's stable sort keeps
    # registration order for equal priorities, so "stroke" deterministically
    # wins that ambiguous case — harmless, since that's exactly the case the
    # app's own "which sport was that?" prompt exists to resolve.
    priority=60,
    category="tennis",
))

# ═══════════════════════════════════════════════════════════════════════════
# TENNIS SERVE
# ═══════════════════════════════════════════════════════════════════════════
# A genuinely different motion from a groundstroke — the arm reaches
# overhead rather than staying near the body — so unlike tennis_stroke this
# isn't a clone of anything. Basic v1 detector only, per plan: primary_signal
# is wrist_y (raw wrist height, already computed in signals.py but unused by
# any detector until now), which rises through the toss/reach and falls
# after contact/follow-through — a genuine swing shape. valid_frame_check
# reuses pull-up's exact existing overhead-gate mechanism (wrist_above +
# overhead_gate) so only frames where the wrist is actually raised above the
# shoulder count toward detection at all, cutting out a ready-stance/idle
# segment before or after the serve motion. No corroboration_signal, same
# "basic, not over-built" reasoning as padel stroke.
register(ExerciseDefinition(
    key="tennis_serve",
    label="Tennis Serve",
    short_label="SERVE",
    description="An overhead tennis serve — the arm reaches up and strikes "
                 "down through the ball once per rep.",
    research=(
        "No tennis-specific pose-estimation literature exists yet — this is "
        "a basic first-pass detector, not literature-validated.",
    ),
    orientation=BodyOrientation.STANDING,
    primary_signal="wrist_y",
    counting_strategy=CountingStrategy.SWING_DETECTOR,
    params={
        "min_rom_deg": TunableParam(
            "min_rom_deg", "Minimum swing range", "m", 0.12, 0.05, 0.5, 0.01,
            "Wrist-height change required for a swing to count — the "
            "toss/reach-up-then-strike arc of a serve.",
        ),
        "min_drop_fraction": TunableParam(
            "min_drop_fraction", "Swing confirmation", "fraction of ROM", 0.30, 0.1, 0.6, 0.05,
            "How far wrist height must swing back from a tracked peak/trough "
            "to confirm that extreme was real, not noise.",
        ),
        "overhead_gate": TunableParam(
            "overhead_gate", "Per-frame overhead gate", "0-1", 0.3, 0.1, 0.9, 0.05,
            "Only frames with the wrist-above-shoulder signal past this "
            "value are considered part of the movement at all — same value "
            "pull-up uses for the same signal.",
        ),
    },
    valid_frame_check=("wrist_above", "gt", "overhead_gate"),
    # Above both padel and tennis strokes: a serve is a visually distinct,
    # more strongly-gated motion (the overhead check above already rules out
    # most non-serve frames), so if it produces any candidate reps on a
    # shared-orientation clip, that's stronger evidence than a groundstroke
    # swing sharing the same clip.
    priority=65,
    category="tennis",
))
