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
7 exercises:

  THRESHOLD_CROSSING — signal descends below an adaptive "depth" threshold
    then climbs back above a "stand" threshold. Used by squat, deadlift,
    push-up: exercises with a clear top and bottom position.
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
deadlift vs. vertical jump, all STANDING) still need a real discriminator;
each declares a `priority` and an optional `discriminator` for exactly this
case (see squat/deadlift/vertical_jump below and DISCRIMINATORS in
counting.py).
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
    discriminator: str | None = None
    priority: int = 0

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
