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

import dataclasses
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
    # "both": achieved = mean of left and right (bilateral movements, e.g. knees in a squat).
    # "max": achieved = whichever side moved more — for one-sided movements like a racket arm's
    # swing, where averaging in the idle arm only dilutes the number. Handedness-free.
    # "racket": the arm holding the racket, as the stroke classifier found it (rep["racket_hand"],
    # exercises/stroke_type.py) — right for a two-handed backhand too, where both arms swing; falls
    # back to "max" for a rep without one.
    sides: str = "both"
    # Target for a two-handed stroke (rep["two_handed"], exercises/stroke_type.py) when it differs
    # from target_rom_deg — the racket arm stays bent and close to the body in a two-handed backhand,
    # so it swings about half as far as in a one-handed one. None = same target.
    target_rom_deg_two_handed: float | None = None


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
#
# 42 -> 60 (2026-09-24): measured on the racket arm only (sides="max"), not
# the mean of both arms — averaging in the idle arm diluted every swing (e.g.
# 57deg racket arm + 11deg other arm read as 34deg) and left the per-rep
# breakdown showing a meaningless Left/Right split. Racket-arm swings on the
# same clip are 58.4/43.3/42.7deg; 60 keeps them at 80% (.mp4) / 79% (.mov).
#
# 60 -> 52 (2026-10-18): a good tennis swing from a real test video (job 98d53db2,
# racket arm 46.1/42.2deg) read 74%; the user rated it ~85%. 52 reads it 85%.
# Side effects, from the same measurements: the padel clip's 58.4/43.3/42.7deg
# now read ~93% (was 80%), the coaching video ~82% (was 71%), and the median
# Penn Action forehand (37.7deg) ~73% (was 63%).
register_rom(ExerciseRomProfile(
    exercise_key="stroke",
    checks=(
        JointRomCheck(
            id="swing_rom", label="Swing range", joint="SHOULDER",
            signal="shoulder_angle", start_selector="start", end_selector="bottom",
            target_rom_deg=52.0, watch_threshold_pct=70.0, at_risk_threshold_pct=45.0,
            sides="max",
            research=(
                "Holland Osteopathy — shoulder biomechanics in tennis: wind-up-phase "
                "shoulder horizontal abduction of ~30-40deg generates the torque for the "
                "stroke; target_rom_deg has been revised five times against a real "
                "2026-08-03 test clip (see the target_rom_deg history note above), most "
                "recently (to 52, on a real tennis swing rated ~85%), not "
                "derived from this citation.",
                "Padel-specific shoulder kinematics research (e.g. cross-sectional studies "
                "of padel players' shoulder ROM during strokes) confirms strokes rely on "
                "substantial shoulder rotation/horizontal ab-adduction, without pinning "
                "down one comparable total-excursion figure to cite directly.",
            ),
            description="How far the racket arm swings via shoulder rotation, from the "
                         "ready stance to the peak of the swing — the stroke's actual "
                         "amplitude, independent of how fixed the elbow itself stayed.",
            informational=True,
        ),
    ),
))

# ═══════════════════════════════════════════════════════════════════════════
# TENNIS STROKE
# ═══════════════════════════════════════════════════════════════════════════
# Same signal as padel stroke's swing_rom check above, with its own target
# from 2026-10-20: swing_rom 52 -> 66.5 and knee_bend 50 -> 76.5, set on the
# latest coach video (job d9280feb: racket arm 53.5/58.2/58.1deg, knee
# 29.5/32.8/29.5deg) which read 109% / 61% and, per the user, should read
# ~85% swing range and ~40% knee bend. Padel stroke keeps its own target.
register_rom(ExerciseRomProfile(
    exercise_key="tennis_stroke",
    checks=(
        JointRomCheck(
            id="swing_rom", label="Swing range", joint="SHOULDER",
            signal="shoulder_angle", start_selector="start", end_selector="bottom",
            target_rom_deg=66.5, watch_threshold_pct=70.0, at_risk_threshold_pct=45.0,
            sides="max",
            research=(
                "Started from the padel stroke calibration (see that exercise's "
                "registration above and its target_rom_deg history); tennis has its own "
                "target since 2026-10-20 (52 -> 66.5, see the comment above this "
                "registration). On 40 Penn Action forehands the median racket-arm swing "
                "(37.7deg) reads ~57% at this target; those are ~1s broadcast clips from "
                "varied angles, so they spread widely (quartiles 26-64deg).",
            ),
            description="How far the racket arm swings via shoulder rotation, from the "
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
            target_rom_deg=76.5, watch_threshold_pct=70.0, at_risk_threshold_pct=45.0,
            research=(
                "Target raised 50 -> 76.5 on 2026-10-20 as a deliberate strictness choice, "
                "not from the citation below: the user wants a knee bend of ~30deg to read "
                "~40% (at risk), since the latest coach video's strokes measured "
                "29.5/32.8/29.5deg and read 61%. Martin et al.'s figures are maximal-effort, "
                "3D motion-capture ranges, so a stricter monocular target is defensible. "
                "Original source: "
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
# TENNIS FOREHAND / BACKHAND
# ═══════════════════════════════════════════════════════════════════════════
# Same two checks as tennis_stroke, scored separately per stroke type (exercises/stroke_type.py
# decides which is which). Swing range is measured on the arm that holds the racket (sides="racket")
# so it's right for left-handers and for two-handed backhands.
#
# Swing range here is the arm's FULL TRAVEL over the stroke (window_range: max - min of the shoulder
# angle between the stroke's start and end), not tennis_stroke's start -> follow-through difference
# (2026-10-25). A stroke's "start" is where the hand speeds up, which for a big looping forehand is
# already partway through the takeback: Mia's saved video (job 9694967a) lifts the racket arm from
# ~36deg at rest to ~120deg behind her head and swings through, yet the two-point measure read only
# 35deg (53%) because the stroke "started" at 82deg. Full travel reads 84deg / 76deg. On ordinary
# swings the two agree within ~10-30% (real clips: median 42.8 -> 53.1deg).
#
# Targets, re-anchored on the full-travel measure to keep the two clips the user rated "~85%" at 85%:
# the 2026-10-20 coach video (job d9280feb, strokes 60.8/70.8/74.6deg, mean 68.7) -> 80deg reads it 86%,
# and the 2026-10-18 clip (job 98d53db2, 68.5/66.7deg) reads 84%. Mia's looping forehand (84/76deg) reads
# 100%. Knee bend is unchanged from tennis_stroke (50 -> 76.5, 2026-10-20).
#
# Backhand targets (2026-10-25) are set relative to the forehand on the same players, so a backhand swung
# as fully as the player's forehand scores about the same. Measured with this pipeline on the THETIS
# dataset (Gourgari et al. 2013; 55 players, beginners and experienced, filmed from the front
# shadow-swinging without a ball), flat/topspin strokes, median racket-arm travel: forehand 57.3deg
# (n=80), one-handed backhand 70.6deg (n=41, x1.23), two-handed backhand 43.3deg (n=39, x0.75) ->
# 80 x 1.23 = 98.5 and 80 x 0.75 = 60.4. Knee bend was about the same in all three (forehand 29.1deg,
# one-handed 26.4, two-handed 27.7), so backhands keep the forehand's knee target.
FOREHAND_SWING_TARGET_DEG = 80.0
BACKHAND_SWING_TARGET_DEG = 98.5             # one-handed
BACKHAND_SWING_TARGET_TWO_HANDED_DEG = 60.4  # two-handed
_TENNIS_STROKE_CHECKS = {c.id: c for c in ROM_PROFILES["tennis_stroke"].checks}
_FULL_TRAVEL_SWING = dataclasses.replace(
    _TENNIS_STROKE_CHECKS["swing_rom"], sides="racket", measure="window_range", end_selector="end",
    description="How far the racket arm travels via shoulder rotation over the whole stroke, from the "
                "lowest to the highest point of its swing, takeback included.",
)

register_rom(ExerciseRomProfile(
    exercise_key="tennis_forehand",
    checks=(
        dataclasses.replace(
            _FULL_TRAVEL_SWING, target_rom_deg=FOREHAND_SWING_TARGET_DEG,
            research=("Full-travel measure, anchored on the stroke the user rated ~85%: see the note above "
                      "this registration (target 80deg). Shoulder angle (elbow-shoulder-hip) of the "
                      "racket arm, from the pipeline's SMPL pose.",),
        ),
        _TENNIS_STROKE_CHECKS["knee_bend"],
    ),
))

register_rom(ExerciseRomProfile(
    exercise_key="tennis_backhand",
    checks=(
        dataclasses.replace(
            _FULL_TRAVEL_SWING, target_rom_deg=BACKHAND_SWING_TARGET_DEG,
            target_rom_deg_two_handed=BACKHAND_SWING_TARGET_TWO_HANDED_DEG,
            research=("Calibrated relative to the forehand target on the same players (THETIS dataset, "
                      "Gourgari et al. 2013): one-handed backhands travel the racket arm about 1.23x as far "
                      "as forehands, two-handed about 0.75x, so the targets are 98.5deg and 60.4deg — a "
                      "backhand swung as fully as the player's forehand reads about the same.",),
        ),
        _TENNIS_STROKE_CHECKS["knee_bend"],
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
