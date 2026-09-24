# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Range-of-motion thresholds — sibling to thresholds.py (see this package's
__init__.py / analysis.py's "Adding a new analysis method" note: ROM's
tunables don't fit JointBalanceCheck's shape, so it gets its own dataclasses
here rather than overloading that one).

Where balance.py asks "does the left side match the right side," rom.py
asks "did this joint travel through enough of its expected range" — a
single-limb (bilaterally-averaged, see rom.py) measure of how deep/full a
rep actually was, not an interlimb comparison. Every exercise gets 1-2 main
joint(s), not every joint that moves during the rep — picked for whichever
joint's excursion is THE defining motion of that exercise (e.g. a deadlift
is fundamentally a hip hinge, so hip flexion is its one ROM check; a squat
loads both the knee and, to a lesser and less-standardized extent, the hip,
so it gets two).

`target_rom_deg` is the expected degrees of angle change between a rep's
"start" (standing/hanging/extended reference) and "bottom" (peak flexion)
frames — see counting.py's Rep shape and balance.py's frame_selector
convention, reused directly here via start_selector/end_selector. Every
signal (knee_angle/hip_angle/elbow_angle) is the same interior joint angle
balance.py already uses (angle3d at the joint vertex: 180 deg = fully
extended, smaller = more flexed) — literature ROM figures below are
matched against that same convention wherever the source's own angle
convention could be pinned down; where it's ambiguous or unstandardized,
this file deliberately reuses a figure ALREADY cited elsewhere in this
codebase (exercises.py's rep-counting thresholds, exerciseMetrics.ts's
depth benchmark) over a fresh, differently-conventioned number, so the app
never shows two different "target depth" figures for the same joint in two
different places.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class JointRomCheck:
    id: str
    label: str
    joint: str  # single display name, e.g. "KNEE" — ROM is bilateral-average, not an L/R pair
    signal: str  # key into balance.py's SIGNAL_SPECS (reused as-is)
    start_selector: str  # rep-dict key for the "extended" reference frame: "start" | "end"
    end_selector: str  # rep-dict key for the peak-flexion frame: "bottom"
    target_rom_deg: float  # expected |start - end| angle change, degrees
    watch_threshold_pct: float  # rom_pct below this = "watch"
    at_risk_threshold_pct: float  # rom_pct below this = "at_risk"
    research: tuple[str, ...]
    description: str
    informational: bool = False  # True: target is an engineering estimate, not literature-validated
    # "frames": |value at start_selector - value at end_selector|.
    # "window_range": max - min of the signal over every frame between the two selectors (per side,
    # then averaged) — for a joint whose deepest point isn't one of the rep's own marked frames.
    measure: str = "frames"


@dataclass(frozen=True)
class ExerciseRomProfile:
    exercise_key: str
    checks: tuple[JointRomCheck, ...] = field(default_factory=tuple)


ROM_PROFILES: dict[str, ExerciseRomProfile] = {}


def register_rom(profile: ExerciseRomProfile) -> ExerciseRomProfile:
    ROM_PROFILES[profile.exercise_key] = profile
    return profile


# ═══════════════════════════════════════════════════════════════════════════
# SQUAT
# ═══════════════════════════════════════════════════════════════════════════
register_rom(ExerciseRomProfile(
    exercise_key="squat",
    checks=(
        JointRomCheck(
            id="knee_flexion", label="Knee flexion", joint="KNEE",
            signal="knee_angle", start_selector="start", end_selector="bottom",
            target_rom_deg=90.0, watch_threshold_pct=80.0, at_risk_threshold_pct=60.0,
            research=(
                "IJSPT 2021 / NSCA — parallel (~90deg knee flexion) squat-depth benchmark",
                "PMC7276781 — deep-squat knee ROM studies report 75-135deg across "
                "differing depth definitions; 90deg (parallel) sits centrally in that band",
            ),
            description="Knee-angle change from standing to the deepest point of the squat "
                         "— how close to a full, parallel-or-deeper rep this one reached.",
        ),
        JointRomCheck(
            id="hip_flexion", label="Hip flexion", joint="HIP",
            signal="hip_angle", start_selector="start", end_selector="bottom",
            target_rom_deg=55.0, watch_threshold_pct=75.0, at_risk_threshold_pct=50.0,
            research=(
                "PMC7276781 — full/near-full-ROM squats associated with substantial hip "
                "flexion alongside knee flexion and ankle dorsiflexion",
                "No single peer-reviewed hip-flexion-degrees standard specific to squat "
                "depth was found (unlike knee) — target is an engineering estimate.",
            ),
            description="Hip-angle change from standing to the deepest point of the squat "
                         "— a stiff hip (staying too extended) often shows up here even "
                         "when knee depth looks fine.",
            informational=True,
        ),
    ),
))

# ═══════════════════════════════════════════════════════════════════════════
# DEADLIFT
# ═══════════════════════════════════════════════════════════════════════════
register_rom(ExerciseRomProfile(
    exercise_key="deadlift",
    checks=(
        JointRomCheck(
            id="hip_hinge", label="Hip hinge", joint="HIP",
            signal="hip_angle", start_selector="start", end_selector="bottom",
            target_rom_deg=85.0, watch_threshold_pct=75.0, at_risk_threshold_pct=50.0,
            research=(
                "ExRx.net deadlift analysis / sciencewatch.blog hip-hinge biomechanics — "
                "hips flex to roughly 90deg at setup and reach full extension (~0deg) at "
                "lockout, ~90deg of hip-flexion excursion across the lift",
            ),
            description="Hip-angle change from the standing lockout reference to the bottom "
                         "of the hinge — the single defining motion of a deadlift; "
                         "deliberately the only ROM check here, since a good deadlift keeps "
                         "knee flexion deliberately small (see exercises.py's "
                         "hip_dominant_ratio discriminator) so a knee-ROM check would reward "
                         "the wrong thing.",
        ),
    ),
))

# ═══════════════════════════════════════════════════════════════════════════
# VERTICAL JUMP
# ═══════════════════════════════════════════════════════════════════════════
register_rom(ExerciseRomProfile(
    exercise_key="vertical_jump",
    checks=(
        # NOTE on frame choice: a FLIGHT_PHASE rep's "bottom" field is the
        # peak of the tracked HEIGHT signal during flight (see counting.py's
        # count_flight_phase — it reuses the same {start,bottom,end} Rep
        # shape as every other strategy, but here "bottom" means apex-of-
        # flight, not deepest-crouch). The countermovement dip itself
        # happens before "start" (takeoff), outside this rep's window
        # entirely, so it isn't available to read here without changing
        # rep-counting itself. "start" (takeoff, legs extending through the
        # drive) to "end" (landing, legs re-flexing to absorb) is what's
        # actually available — and is itself a real, separately literature-
        # backed metric: landing knee flexion / stiffness.
        JointRomCheck(
            id="landing_flexion", label="Landing knee flexion", joint="KNEE",
            signal="knee_angle", start_selector="start", end_selector="end",
            target_rom_deg=90.0, watch_threshold_pct=70.0, at_risk_threshold_pct=45.0,
            research=(
                "PMC9428587 / Frontiers fphys.2022.877394 — CMJ landing knee-flexion "
                "studies report ~85-100deg of flexion from extension at peak landing "
                "absorption (same citations already used for this exercise's "
                "landing_symmetry balance check)",
            ),
            description="Knee-angle change from takeoff (legs extending through the drive) "
                         "to landing (legs re-flexing to absorb impact) — too little knee "
                         "flexion on landing (a stiff landing) is an established ACL-risk "
                         "marker, not just a performance metric.",
        ),
    ),
))

# ═══════════════════════════════════════════════════════════════════════════
# PULL-UP
# ═══════════════════════════════════════════════════════════════════════════
register_rom(ExerciseRomProfile(
    exercise_key="pull_up",
    checks=(
        JointRomCheck(
            id="elbow_flexion", label="Elbow flexion", joint="ELBOW",
            signal="elbow_angle", start_selector="start", end_selector="bottom",
            target_rom_deg=120.0, watch_threshold_pct=75.0, at_risk_threshold_pct=50.0,
            research=(
                "resistancetraining.ai perfect-pull-up guide — elbow flexion ROM from a "
                "full dead hang to the top of the pull is approximately 145deg",
                "ExRx.net pull-up/chin-up muscular analysis",
                "Recalibrated down from the literature's 140deg after production feedback: "
                "genuinely good, full-range reps were landing at 70-80%, not the near-100% "
                "a full rep should read as — this pipeline's own elbow_angle measurement "
                "(pose-estimation-derived, not goniometer-measured) runs somewhat short of "
                "the literature figure in practice, likely from a mix of estimation noise "
                "and how 'start'/'bottom' frame selection lands relative to true full "
                "extension/full contraction. 120deg is a deliberately moderate correction, "
                "not a full retarget to whatever the mean observed value was.",
            ),
            description="Elbow-angle change from dead hang to the top of the pull — a "
                         "partial-ROM pull-up (not reaching full extension at the bottom, "
                         "or not pulling high enough at the top) shows up as a lower score "
                         "here even if the rep still counted.",
        ),
    ),
))

# ═══════════════════════════════════════════════════════════════════════════
# PUSH-UP
# ═══════════════════════════════════════════════════════════════════════════
register_rom(ExerciseRomProfile(
    exercise_key="push_up",
    checks=(
        JointRomCheck(
            id="elbow_flexion", label="Elbow flexion", joint="ELBOW",
            signal="elbow_angle", start_selector="start", end_selector="bottom",
            target_rom_deg=70.0, watch_threshold_pct=75.0, at_risk_threshold_pct=50.0,
            research=(
                "labellerr.com AI push-up counter / FITNESSGRAM — UP stage >160deg, DOWN "
                "stage <90deg elbow angle (same convention already used for rep-counting "
                "in exercises.py's push_up definition; 160-90 = ~70deg of ROM)",
            ),
            description="Elbow-angle change from a straight-arm plank to the bottom of the "
                         "rep — a shallow push-up (not reaching the ~90deg down position) "
                         "scores lower here.",
        ),
    ),
))

# ═══════════════════════════════════════════════════════════════════════════
# AB CRUNCH
# ═══════════════════════════════════════════════════════════════════════════
register_rom(ExerciseRomProfile(
    exercise_key="ab_crunch",
    checks=(
        JointRomCheck(
            id="trunk_flexion", label="Trunk flexion", joint="TRUNK",
            signal="hip_angle", start_selector="start", end_selector="bottom",
            target_rom_deg=30.0, watch_threshold_pct=70.0, at_risk_threshold_pct=45.0,
            research=(
                "Physiopedia — curl-ups isolate trunk flexion, distinct from a sit-up's "
                "hip flexion",
                "EMG research — peak abdominal activation near 30deg curl-up angle; a "
                "curl-up's real ROM is only ~30-45deg to begin with (same figure already "
                "cited in exercises.py's ab_crunch definition)",
            ),
            description="Trunk-angle change (reusing squat's hip_angle signal read in a "
                         "lying-down context, per exercises.py's own note) from lying flat "
                         "to the top of the curl — a crunch's ROM is naturally small, so "
                         "this is scored against that small target rather than a squat-"
                         "sized one.",
        ),
    ),
))

# ═══════════════════════════════════════════════════════════════════════════
# PADEL STROKE
# ═══════════════════════════════════════════════════════════════════════════
# Uses shoulder_angle (elbow-shoulder-hip, see balance.py's SIGNAL_SPECS),
# NOT elbow_angle — this exercise's fixation check (see
# fixation_thresholds.py) already scores elbow_angle on "less change is
# better" (a fixed elbow, shoulder-led swing is good technique); scoring a
# ROM check "more change is better" on that SAME signal would give directly
# contradictory feedback for the identical measurement. shoulder_angle
# instead captures the swing's actual amplitude — how far the upper arm
# swings via shoulder rotation — independent of how quiet the elbow itself
# stayed, so a technically good rep can score well on both checks at once
# instead of only one.
#
# target_rom_deg history: 80 originally (a "double the wind-up figure"
# guess) -> 45 after checking against a real 2026-08-03 reference clip (4
# reps; shoulder_angle achieved 0/33.4/26.1/33.7deg, that first rep a
# spurious near-zero-length detection at the very start of the clip, not a
# real stroke) showed 80 was roughly 2-3x too high — that clip's own
# fullest reps only reached ~34deg. 45 gave that clip ~52% overall ROM.
# Per explicit instruction to make this specific clip read as a ~80%
# readiness score (a deliberate calibration anchor, not a literature
# figure), lowered again to 29 -> ~80% rom_avg on that same clip (the
# spurious rep still scores 0%, the three real reps land at 115/90/116%,
# clipped nowhere near the 130% ceiling). 29 happens to sit right at the
# bottom of the wind-up-phase citation below (~30-40deg) rather than
# "wind-up plus forward swing", which is at least directionally consistent
# with that source, but the specific value was picked to hit the target
# score, not derived from it. Tighten again once more real clips (ideally
# including known-poor technique for contrast) are available.
#
# 29 -> 42 (2026-09-24): that ~80% was propped up by the spurious 0% rep —
# once the swing detector stopped producing it (commit a91dee5), the three
# real reps averaged ~107%. Then strokes switched to peak-based counting
# (exercises.py's count_peaks), so each rep now runs ready -> follow-through
# instead of follow-through -> recovery, measuring 41.9/26.4/32.3deg on the
# same clip. The user confirmed these are normal swings that should read in
# the 70-90% band; 42 gives 80% (.mp4) / 78% (.mov encode of the same clip).
# Still 82% / 80% after stroke windows were trimmed to the movement itself
# (exercises/movement.py), so the target didn't need to move again.
register_rom(ExerciseRomProfile(
    exercise_key="stroke",
    checks=(
        JointRomCheck(
            id="swing_rom", label="Swing range", joint="SHOULDER",
            signal="shoulder_angle", start_selector="start", end_selector="bottom",
            target_rom_deg=42.0, watch_threshold_pct=70.0, at_risk_threshold_pct=45.0,
            research=(
                "Holland Osteopathy — shoulder biomechanics in tennis: wind-up-phase "
                "shoulder horizontal abduction of ~30-40deg generates the torque for the "
                "stroke; target_rom_deg has been revised three times against a real "
                "2026-08-03 test clip (see the target_rom_deg history note above), most "
                "recently to read that clip's normal swings at ~80%, not derived from "
                "this citation.",
                "Padel-specific shoulder kinematics research (e.g. cross-sectional studies "
                "of padel players' shoulder ROM during strokes) confirms strokes rely on "
                "substantial shoulder rotation/horizontal ab-adduction, without pinning "
                "down one comparable total-excursion figure to cite directly.",
            ),
            description="How far the upper arm swings via shoulder rotation, from the "
                         "ready stance to the peak of the swing — the stroke's actual "
                         "amplitude, independent of how fixed the elbow itself stayed.",
            informational=True,
        ),
    ),
))

# ═══════════════════════════════════════════════════════════════════════════
# TENNIS STROKE
# ═══════════════════════════════════════════════════════════════════════════
# Same signal/target as padel stroke's swing_rom check above, unchanged —
# per the user's own reasoning ("tennis and padel strokes are very similar"),
# this pipeline has no basis to guess a different number for a motion its
# signals treat identically. Revisit only once real tennis footage suggests
# otherwise (see padel stroke's own real-footage recalibration history above
# for what that process looks like).
register_rom(ExerciseRomProfile(
    exercise_key="tennis_stroke",
    checks=(
        JointRomCheck(
            id="swing_rom", label="Swing range", joint="SHOULDER",
            signal="shoulder_angle", start_selector="start", end_selector="bottom",
            target_rom_deg=42.0, watch_threshold_pct=70.0, at_risk_threshold_pct=45.0,
            research=(
                "Same real-footage calibration as padel stroke (see that exercise's "
                "registration above and its target_rom_deg history) — this pipeline's "
                "shoulder_angle signal doesn't distinguish the two motions. On 40 Penn "
                "Action forehands the median swing reads ~85% at this target.",
            ),
            description="How far the upper arm swings via shoulder rotation, from the "
                         "ready stance to the peak of the swing — the stroke's actual "
                         "amplitude, independent of how fixed the elbow itself stayed.",
            informational=True,
        ),
        # Knee flexion-extension range over the whole stroke (window_range: the
        # deepest knee bend isn't one of the rep's own marked frames). Target is
        # the mean of Martin et al.'s three forehand-stance means (53/42/56deg).
        # Differences worth knowing: that study measured the dominant knee with
        # 3D motion capture on maximal-effort strokes after a run-in; this
        # averages both knees' own ranges from monocular video on ordinary
        # strokes. Checked against a real 3-stroke low-ball clip (job 23b090a7),
        # with windows trimmed to the movement itself (exercises/movement.py):
        # 47/27/51deg per stroke, ~84% (was 93% while windows still included
        # stepping before each backswing). Coaching clip (job b00feafd): arm-only
        # strokes 39%, full-body strokes 85%/65% — the technique difference its
        # own captions describe.
        JointRomCheck(
            id="knee_bend", label="Knee bend", joint="KNEE",
            signal="knee_angle", start_selector="start", end_selector="end",
            measure="window_range",
            target_rom_deg=50.0, watch_threshold_pct=70.0, at_risk_threshold_pct=45.0,
            research=(
                "Martin C. et al. (2020), 'Influence of the forehand stance on knee "
                "biomechanics: Implications for potential injury risks in tennis "
                "players', J Sports Sci, doi:10.1080/02640414.2020.1853335 — 8 advanced "
                "(ITN 4-5) players, dominant-knee flexion-extension range during the "
                "forehand: 53+/-7deg attacking neutral, 42+/-8deg attacking open, "
                "56+/-7deg defensive open stance (Table 2).",
            ),
            description="How much the knees bend and straighten through the stroke — "
                         "loading the legs and driving up into the shot.",
        ),
    ),
))

# ═══════════════════════════════════════════════════════════════════════════
# TENNIS SERVE
# ═══════════════════════════════════════════════════════════════════════════
# A basic first-pass estimate, not calibrated against any real serve footage
# (unlike the strokes above) — target_rom_deg is a rough guess at how far the
# shoulder swings from a ready stance to the peak overhead reach ("bottom"
# here is the SWING_DETECTOR's tracked extreme on wrist_y, i.e. the highest
# reach point, not a literal low point). Flagged informational=True for
# exactly this reason; revisit once real serve clips are available, the same
# way padel stroke's own thresholds were revised against real footage.
register_rom(ExerciseRomProfile(
    exercise_key="tennis_serve",
    checks=(
        JointRomCheck(
            id="swing_rom", label="Swing range", joint="SHOULDER",
            signal="shoulder_angle", start_selector="start", end_selector="bottom",
            target_rom_deg=45.0, watch_threshold_pct=70.0, at_risk_threshold_pct=45.0,
            research=(
                "No tennis-specific literature exists yet — target_rom_deg is a rough, "
                "un-calibrated first estimate (a serve's overhead reach should swing the "
                "shoulder further than a groundstroke's ~29deg, but no real footage exists "
                "to pin down by how much). Revisit once real serve clips are available.",
            ),
            description="How far the upper arm swings via shoulder rotation, from the "
                         "ready stance to the peak of the overhead reach.",
            informational=True,
        ),
    ),
))
