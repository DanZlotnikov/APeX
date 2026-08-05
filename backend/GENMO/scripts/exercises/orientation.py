# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Classifies a clip's dominant body configuration into one BodyOrientation.

See definitions.py's module docstring for why this replaces pairwise
mutual-exclusion rules. Runs once per clip on the smoothed signals; the
result gates which exercises even get evaluated.
"""
from __future__ import annotations

import numpy as np

from .definitions import BodyOrientation

# upright_ratio = vertical spread / horizontal spread of shoulder-hip-ankle.
# A standing (or hanging) body's vertical spread is close to full height
# while its horizontal spread is small -> ratio well above 1. A horizontal
# (lying/plank) body has the opposite -> ratio well below 1.
STANDING_MIN_UPRIGHT_RATIO = 1.5
HORIZONTAL_MAX_UPRIGHT_RATIO = 0.6

# Within "vertical", sustained overhead grip distinguishes hanging from a
# bar from ordinary standing. This is deliberately a *continuous-hold*
# duration, not a cumulative fraction of the clip — a vertical jump's arm
# swing also puts the wrists overhead, repeatedly, and on a real multi-rep
# jump clip the cumulative time across those swings can add up to a large
# fraction of the whole clip despite each individual swing being brief.
# Confirmed on real footage: a jump clip's longest single overhead episode
# was 22 frames (0.73s) from a fast arm swing, while a pull-up's *shortest*
# episode was 33 frames (1.1s) — a real grip is held continuously, an
# athletic arm swing isn't. The threshold below sits with margin on both
# sides of that observed gap.
MIN_SUSTAINED_OVERHEAD_SEC = 0.8

# Within "horizontal", body_line_angle (hip-knee-ankle) separates a straight
# plank (push-up) from bent knees (crunch) — see signals.py.
#
# Lowered from 140 after a real push-up clip (2026-08-05, prone plank
# position, legs genuinely straight) was misclassified as HORIZONTAL_LYING
# and scored as an ab_crunch instead — confirmed indirectly rather than by
# inspecting body_line_angle directly (not persisted anywhere): the
# resulting "crunch" showed a 95deg trunk_flexion achieved_deg against a
# 30deg target (3x over, severity clipped at the 130% cap), wildly outside
# any real crunch's plausible range, consistent with hip_angle (reused as
# ab_crunch's trunk-flexion signal) behaving unpredictably on a body
# configuration it was never designed to read. The likely cause is pose-
# estimation noise on the LEGS specifically in a prone, floor-level
# position — self-occlusion and an unusual camera angle/framing relative to
# the mostly-standing footage this pipeline is otherwise tuned against (the
# same category of issue already confirmed for the foot joint specifically,
# see skeleton_renderer.py's foot-rendering fix). 110 keeps real separation
# from a genuine crunch (knees bent to bring the feet flat on the floor,
# ordinarily well under 100deg) while giving push-up's leg-angle estimate
# more room for that noise. Revisit with real body_line_angle telemetry if
# this keeps misfiring — this is still an estimate, not a measured fix.
PLANK_MIN_BODY_LINE_ANGLE = 110.0

# Second, independent PLANK signal — see signals.py's hand_ground_gap
# docstring. A push-up's hands are planted on the floor with the torso held
# elevated above it (positive gap, roughly a meaningful fraction of torso
# length even at the bottom of a rep); a crunch's hands sit at roughly
# shoulder height since the whole body lies flat on the floor (gap near
# zero). Compared as a fraction of this clip's own torso_scale, same
# normalization convention wrist_above already uses. Combined with
# body_line_angle below via OR, not AND/replacement — the two signals read
# completely different body parts (legs vs. hands), so they're unlikely to
# both be thrown off by the same pose-estimation noise at once; requiring
# only one of two independent signals to agree is more robust than trusting
# either alone, which is exactly what burned body_line_angle on its own.
PLANK_MIN_HAND_GROUND_FRACTION = 0.15


def _longest_true_run(mask: np.ndarray) -> int:
    """Longest run of consecutive True values, in frames."""
    longest = current = 0
    for v in mask:
        current = current + 1 if v else 0
        longest = max(longest, current)
    return longest


def classify_orientation(signals: dict, fps: float = 30.0) -> BodyOrientation | None:
    """Returns None if the clip doesn't clearly match any known orientation
    (e.g. mixed/transitional footage) — callers should treat that as "no
    exercise detected" rather than guessing.

    upright_ratio is checked FIRST, deliberately: it's the one signal that
    unambiguously means the same thing regardless of body configuration.
    wrist_above does not — it was designed to mean "reaching overhead"
    for a vertical body, but for someone lying down (e.g. hands behind the
    head for a crunch) the wrist can end up marginally above shoulder
    height purely from lying-flat geometry, with no relation to an overhead
    grip at all. Nesting the overhead check inside the "body is vertical"
    branch (hanging from a bar is itself a vertical configuration, just
    like standing) means a horizontal clip can never reach that check in
    the first place — confirmed necessary on a real crunch clip that had
    wrist_above=1.0 for the entire clip and was misclassified as
    HANGING_OVERHEAD before this was fixed.
    """
    L = len(signals["wrist_above"])
    if L == 0:
        return None

    upright_ratio = float(np.median(signals["upright_ratio"]))

    if upright_ratio >= STANDING_MIN_UPRIGHT_RATIO:
        longest_overhead_sec = _longest_true_run(signals["wrist_above"] > 0.5) / fps
        if longest_overhead_sec >= MIN_SUSTAINED_OVERHEAD_SEC:
            return BodyOrientation.HANGING_OVERHEAD
        return BodyOrientation.STANDING

    if upright_ratio <= HORIZONTAL_MAX_UPRIGHT_RATIO:
        body_line = float(np.median(signals["body_line_angle"]))
        hand_ground_fraction = float(np.median(signals["hand_ground_gap"])) / float(np.median(signals["torso_scale"]))
        if body_line >= PLANK_MIN_BODY_LINE_ANGLE or hand_ground_fraction >= PLANK_MIN_HAND_GROUND_FRACTION:
            return BodyOrientation.HORIZONTAL_PLANK
        return BodyOrientation.HORIZONTAL_LYING

    return None
