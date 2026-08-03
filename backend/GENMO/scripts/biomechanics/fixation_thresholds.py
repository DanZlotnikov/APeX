# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Arm-fixation thresholds — sibling to thresholds.py/rom_thresholds.py (see
this package's __init__.py / analysis.py's "Adding a new analysis method"
note: fixation's tunables don't fit either existing shape, so it gets its
own dataclasses here, the same reasoning rom_thresholds.py already gives for
not overloading JointBalanceCheck).

Where rom.py asks "did this joint travel through enough of its expected
range" (a 2-frame delta between a rep's start and end), fixation.py asks
"how STEADY did this joint stay across the whole motion" — the opposite
concern: for an exercise like a padel stroke, the arm/wrist should stay
close to fixed (shoulder leads the movement, not the elbow/wrist), so LESS
change is better, and it has to be measured across every frame of the
window (a joint that swings wildly mid-rep and happens to return close to
its start value would score perfectly under a 2-frame delta, but should
score poorly on fixation) — see fixation.py's own docstring for the full
plumbing/scoring relationship to rom.py/balance.py.

`window_start_selector`/`window_end_selector` are rep-dict keys (see
counting.py's Rep shape), same vocabulary rom_thresholds.py's start/end
selectors already use — "start"/"end" (the whole stroke), not "bottom",
since fixation is about the entire motion, not just half of it.

`max_deviation` deliberately has no "_deg" suffix, unlike ROM's
target_rom_deg — nothing currently registered here uses a non-angle signal,
but the field stays unit-agnostic in case a future check needs one.

Deliberately elbow-only, not elbow+wrist: a true wrist joint angle isn't
computable with this pipeline's skeleton (SMPL, 22 joints, terminates at the
wrist — no hand/fingertip joint to form a wrist-flexion angle3d triple from).
A "wrist fixation" check was tried using wrist height as a position-based
proxy and removed — it measured displacement, not angle, which wasn't what
the metric was meant to capture, and no angle-based substitute is
measurable from this joint set (the only other angle reachable via the
wrist point, the forearm segment's orientation in space, is dominated by
shoulder rotation during any real swing — not a wrist-specific signal, and
not usable as a "less change is better" fixation score since forearm
movement through space is inherent to swinging at all, not a technique
flaw). Revisit if a future pose model adds hand/finger keypoints.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class JointFixationCheck:
    id: str
    label: str
    joint: str  # single display name, e.g. "ELBOW" — bilateral avg, like ROM
    signal: str  # key into balance.py's SIGNAL_SPECS (reused as-is)
    window_start_selector: str  # rep-dict key for the window's first frame: "start"
    window_end_selector: str  # rep-dict key for the window's last frame: "end"
    max_deviation: float  # deviation (in the signal's own unit) at/above which fixation_pct hits 0
    watch_threshold_pct: float  # fixation_pct below this = "watch"
    at_risk_threshold_pct: float  # fixation_pct below this = "at_risk"
    research: tuple[str, ...]
    description: str
    informational: bool = False  # True: threshold is an engineering estimate, not literature-validated


@dataclass(frozen=True)
class ExerciseFixationProfile:
    exercise_key: str
    checks: tuple[JointFixationCheck, ...] = field(default_factory=tuple)


FIXATION_PROFILES: dict[str, ExerciseFixationProfile] = {}


def register_fixation(profile: ExerciseFixationProfile) -> ExerciseFixationProfile:
    FIXATION_PROFILES[profile.exercise_key] = profile
    return profile


# ═══════════════════════════════════════════════════════════════════════════
# PADEL STROKE
# ═══════════════════════════════════════════════════════════════════════════
# No padel-specific pose-estimation or biomechanics literature exists yet to
# validate this threshold against (see exercises.py's "stroke" definition
# for the same honesty note on the detection side) — marked
# informational=True for exactly that reason, the same convention
# thresholds.py/rom_thresholds.py already use for engineering-estimate
# (as opposed to literature-validated) checks.
#
# max_deviation history: 35 originally (blind guess, no footage) -> 65 after
# checking against a real 2026-08-03 reference clip (4 reps, elbow_angle
# deviation 13.6/46.9/49.6/18.1deg) showed 35 flattened half that clip's
# reps to 0%. 65 gave that clip ~51% overall fixation — still read as
# mediocre. Per explicit instruction to make this specific clip read as a
# ~80% readiness score (a deliberate calibration anchor, not a literature
# figure), raised again to 150 -> ~80% fixation_avg on that same clip
# (91/71/69/89% per rep). 150 is close to the elbow's own full physiological
# flexion-extension range (~150deg), i.e. this check is now lenient enough
# that only a genuinely extreme, near-full-range elbow swing scores near 0 —
# intentional per the "more forgiving" request, but means this check barely
# discriminates within the normal range anymore. Tighten again if real
# comparison footage (a known-poor-technique clip) shows it's too loose.
register_fixation(ExerciseFixationProfile(
    exercise_key="stroke",
    checks=(
        JointFixationCheck(
            id="elbow_fixation", label="Elbow fixation", joint="ELBOW",
            signal="elbow_angle",
            window_start_selector="start", window_end_selector="end",
            max_deviation=150.0, watch_threshold_pct=70.0, at_risk_threshold_pct=50.0,
            research=(
                "No padel-specific literature exists yet — max_deviation has been "
                "revised twice against a real 2026-08-03 test clip (see this file's "
                "module-level note above), most recently to deliberately read that "
                "clip's own reps at ~80%, not from any external citation.",
            ),
            description="How little the elbow angle wanders across the whole stroke — "
                         "a padel groundstroke is meant to be shoulder-led, with the arm "
                         "staying close to fixed rather than the elbow doing the swinging.",
            informational=True,
        ),
    ),
))
