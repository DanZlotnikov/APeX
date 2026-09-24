# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Exercise definitions — the single point of truth.

Every exercise the pipeline can detect is declared here as DATA, not code.
`analyze.py` is the only thing that reads this file to know what exercises
exist and how to count them; nothing in the rest of the pipeline hardcodes
an exercise name or threshold. That's deliberate: this is the structure a
future settings UI will read from and write back to (surfacing `params` as
sliders/toggles per exercise, scoped per user/team) without needing any
change to the counting logic itself.

── Why a small set of reusable counting strategies instead of one function
   per exercise ─────────────────────────────────────────────────────────
The previous version (exercise_analysis.py) had one bespoke function per
exercise, each hand-rolling its own state machine. That doesn't scale — this
file adds 4 more exercises on top of the original 3, and a one-off function
per exercise would mean 7 near-duplicate state machines to keep in sync.
Nearly every repetitive exercise actually decomposes into the same shape:
a PRIMARY SIGNAL that cycles through a range of motion once per rep, plus
optional COROBORATION checks that must also hold for a cycle to count. Once
you see it that way, three generic strategies (see counting.py) cover all
6 exercises:

  THRESHOLD_CROSSING — signal descends below an adaptive "depth" threshold
    then climbs back above a "stand" threshold. Used by squat, push-up:
    exercises with a clear top and bottom position.
  SWING_DETECTOR — running local-extremum (zigzag/prominence) detector:
    a rep confirms once the signal has swung by MIN_DROP from a tracked
    peak, then back by MIN_DROP from the resulting trough. Used by pull-up
    and ab crunch: exercises where a fixed absolute crossing band can be
    skipped over entirely at a sparse capture rate (this is why pull-up
    already used this shape before this file existed — see git history).
  FLIGHT_PHASE — a body-position signal rises above a takeoff threshold and
    falls back below a landing threshold, with a minimum flight duration to
    reject noise blips. Used by vertical jump.

── Why body orientation replaces pairwise mutual-exclusion ──────────────
The original 3-exercise version resolved ambiguity with hand-written pairwise
rules ("if sustained overhead grip, zero out jump and squat"; "if jump found,
zero out squat"). That was already showing strain — deadlift was removed
entirely from the mobile app specifically because its torso-lean/hip-angle
signature intersected too much with squat's (see mobile's
exerciseAnalyzer.ts header comment). Pairwise rules also don't scale:
7 exercises means up to 21 pairs to reason about.

Instead, every exercise declares which BodyOrientation it happens in
(standing / hanging from an overhead grip / horizontal plank / horizontal
lying). analyze.py classifies each clip's dominant orientation ONCE, then
only evaluates exercises whose orientation matches — an ab crunch (lying)
and a squat (standing) can never be confused because they're never even
compared. Exercises that legitimately share an orientation (squat vs.
vertical jump, both STANDING) still need a tie-break; each declares a
`priority` for exactly this case (see squat/vertical_jump below and
_resolve_standing in analyze.py). Deadlift used to share STANDING with
these two and needed a real discriminator (ROM-ratio based, see git
history) to avoid being confused with squat — removed from the pipeline
entirely rather than kept as a 3-way ambiguity.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class BodyOrientation(Enum):
    """Which coarse body configuration an exercise happens in. Computed once
    per clip in orientation.py; an exercise is only ever scored against
    clips classified into its own orientation.
    """
    STANDING = "standing"
    HANGING_OVERHEAD = "hanging_overhead"
    HORIZONTAL_PLANK = "horizontal_plank"
    HORIZONTAL_LYING = "horizontal_lying"


class CountingStrategy(Enum):
    THRESHOLD_CROSSING = "threshold_crossing"
    SWING_DETECTOR = "swing_detector"
    FLIGHT_PHASE = "flight_phase"


@dataclass(frozen=True)
class TunableParam:
    """One user-adjustable knob. Shape is chosen to be directly renderable
    as a labeled slider: `default` is what ships out of the box (and what
    the research citation on the owning ExerciseDefinition justifies),
    `min`/`max`/`step` bound what a user is allowed to change it to.

    Units are physical (degrees, seconds, fraction-of-range-of-motion, ...)
    rather than raw code constants, since these are meant to eventually be
    shown to a non-technical user, not just read by counting.py.
    """
    id: str
    label: str
    unit: str
    default: float
    min: float
    max: float
    step: float
    description: str


@dataclass(frozen=True)
class MovementRule:
    """How to find where each rep's actual movement starts and ends (see movement.py).

    activity_signal: the signal whose rate of change means "this exercise is moving" (e.g. knee
        angle for a squat). With activity_is_rate=True it's used as-is (it already is a speed).
    rest_fraction / min_rest_sec: the body is "at rest" while activity stays below this fraction of
        the rep's own peak for at least this long; a rep's movement runs between the rests around it.
    confirm_signals / confirm_min: optional proof the movement is really this exercise — the rep is
        dropped unless the largest in-window range among these signals reaches confirm_min.
    active: False = defined but not applied yet (the exercise's metrics are calibrated to its
        untrimmed windows; turn on together with recalibrating them on real footage).
    """
    activity_signal: str
    activity_is_rate: bool = False
    rest_fraction: float = 0.15
    min_rest_sec: float = 0.2
    confirm_signals: tuple[str, ...] = ()
    confirm_min: float = 0.0
    active: bool = False


@dataclass(frozen=True)
class ExerciseDefinition:
    key: str
    label: str
    short_label: str
    description: str
    research: tuple[str, ...]
    orientation: BodyOrientation
    primary_signal: str
    counting_strategy: CountingStrategy
    params: dict[str, TunableParam]
    # Each entry: (signal_name, comparator, param_id) — e.g.
    # ("torso_lean", "lt", "torso_lean_max_deg") means the corroboration
    # holds at frame i iff signals["torso_lean"][i] < defn.param("torso_lean_max_deg").
    # comparator is "lt" or "gt". Used by THRESHOLD_CROSSING exercises.
    corroboration: tuple[tuple[str, str, str], ...] = ()
    # SWING_DETECTOR only, below. `valid_frame_check` (same 3-tuple shape as
    # corroboration): which frames the detector considers at all — e.g.
    # pull-up only looks at frames with the wrist actually overhead. None
    # means every frame is valid (e.g. ab crunch, which has no analogous
    # gating state). `corroboration_signal` + `corroboration_delta_param`:
    # a secondary distance signal that must shrink by at least the named
    # param's value between a tracked reference peak and the confirmed
    # trough for a swing to count as a real rep (see counting.py).
    valid_frame_check: tuple[str, str, str] | None = None
    corroboration_signal: str | None = None
    corroboration_delta_param: str | None = None
    # SWING_DETECTOR only: a rep is rise -> peak -> fall of primary_signal (e.g. a stroke's
    # follow-through) instead of the default fall -> trough -> rise. See stroke in exercises.py.
    count_peaks: bool = False
    # Names a param (seconds): consecutive reps whose "bottom" frames are closer than this are merged
    # into one — for movements that produce two extremes per real rep (a forehand's backswing and
    # follow-through). None = no merging.
    min_rep_gap_param: str | None = None
    # Trims each rep to the movement itself (setup, stepping, waiting and gesturing before/after it
    # are discarded) and optionally confirms the movement is really this exercise. See MovementRule.
    movement_rule: MovementRule | None = None
    # Whole-REP veto, evaluated after counting (any counting_strategy) —
    # different from valid_frame_check, which only hides frames from the
    # counting engine's own running state (it still sees the remaining
    # frames as contiguous, so a signal that swings together with the
    # primary one can still produce a "swing" using only the frames left
    # after masking — confirmed on a synthetic squat-with-arm-swing clip
    # where valid_frame_check alone did NOT prevent a false stroke rep).
    # (signal_name, comparator, param_id): a candidate rep is discarded if
    # ANY frame in its [start, end] window satisfies signal <cmp> threshold
    # — e.g. ("knee_angle", "lt", "stance_gate") rejects any rep where the
    # knee dropped into squat depth at any point during it, regardless of
    # where in the swing that happened.
    exclusion_check: tuple[str, str, str] | None = None
    # Mirror image of exclusion_check: a candidate rep is discarded UNLESS
    # its own [start, end] window's signal range (max - min within the
    # window) satisfies comparator against the named param — e.g.
    # ("foot_shift", "gt", "foot_movement_gate") keeps only reps where the
    # feet moved at least that much at some point during the rep (stroke's
    # former use of it; no exercise currently sets this, see exercises.py). Not the
    # same as corroboration_signal/corroboration_delta_param: those compare
    # a signal's value AT two specific tracked indices (a peak and a
    # trough) and need the signal to move in a consistent direction tied to
    # the primary swing's own phase (e.g. wrist_hip_dist shrinking as a
    # pull-up's body rises) — a signal like foot movement isn't tied to the
    # swing's phase that way (the feet can shift at any point, not
    # specifically between those two tracked frames), so forcing it through
    # that mechanism was tried and confirmed unreliable (would have made
    # the peak-to-trough delta go the wrong way as often as not). This
    # checks the window's own range instead, which doesn't care when within
    # the rep the movement happened.
    requirement_check: tuple[str, str, str] | None = None
    priority: int = 0
    # Mirrors Supabase's exercise_categories.key (see
    # supabase/migrations/026_exercise_categories.sql /
    # 028_main_sport.sql) — defaults to "general_fitness" so every
    # exercise registered before this field existed keeps working
    # unchanged. Used by analyze.py's sport_key filter to keep two
    # visually-similar sports (padel/tennis strokes) from ever competing
    # on the same clip once the athlete's sport is known.
    category: str = "general_fitness"

    def param(self, param_id: str) -> float:
        """Current value of a tunable param — `.default` for now. Once a
        settings UI exists, this is the one place a per-user/team override
        would be looked up instead, with every call site elsewhere in the
        pipeline unaffected.
        """
        return self.params[param_id].default


# ── registry — the actual single point of truth ─────────────────────────────
#
# Populated by register_all() in exercises.py to keep this file purely about
# the dataclass shapes; the concrete exercise data lives in exercises.py so
# each exercise's research citations and thresholds are easy to find and
# review independently of the plumbing above.
EXERCISE_REGISTRY: dict[str, ExerciseDefinition] = {}


def register(definition: ExerciseDefinition) -> ExerciseDefinition:
    EXERCISE_REGISTRY[definition.key] = definition
    return definition


def exercises_for_orientation(orientation: BodyOrientation) -> list[ExerciseDefinition]:
    return sorted(
        (d for d in EXERCISE_REGISTRY.values() if d.orientation == orientation),
        key=lambda d: -d.priority,
    )
