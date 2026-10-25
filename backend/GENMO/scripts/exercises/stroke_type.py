# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Forehand or backhand, for each detected tennis stroke — from the motion alone, the athlete is never
asked which one they hit.

A groundstroke's forward swing carries the racket hand across the body, and the direction tells the
two apart: a forehand swings from the racket-hand side toward the other side, a backhand from the
other side toward the racket-hand side. Measured in the body's own frame (along the hip-to-hip axis,
in torso lengths; signals.py's wrist_side_*), so it doesn't depend on where the camera stands, and
relative to the racket hand's own side, so it reads the same for left- and right-handed players.

Which hand holds the racket:
- One hand on the racket at the swing (forehand, one-handed backhand): the hand that swings fastest.
  When the athlete has set their hand (profiles.handedness) and the OTHER hand swung faster, the
  stroke is left unclassified and the disagreement reported: an off hand whipping across in an open-
  stance forehand would otherwise read as a backhand, and so would every stroke of an athlete whose
  setting is wrong, since the off hand moves the opposite way across the body to the racket hand.
- Both hands on the racket (two-handed backhand): both swing equally fast, so the athlete's hand
  (profiles.handedness) decides. Without one, the swing direction does, since two-handed strokes are
  backhands.

A stroke the signals can't call clearly (a small crossing, or the backswing on the wrong side for the
direction of the swing) is left unclassified and counts as neither — never guessed.

Taking the racket back before a stroke, and returning to the ready position after one, also carry
the racket across the body, the opposite way to the stroke, and the stroke detector can count them as
swings: a forehand's takeback looks like a backhand, a backhand's return to ready like a forehand.
Both are slower than the stroke next to them, so a swing much slower than an opposite-way swing just
before it (a return to ready) or just after it (a takeback) counts as neither (classify_strokes).
"""
from __future__ import annotations

import numpy as np

FOREHAND = "forehand"
BACKHAND = "backhand"

# Thresholds, in torso lengths (calibrated on real footage; see the notes in exercises.py).
SWING_WINDOW_SEC = 0.15       # half-width of the forward swing measured around the peak hand speed
BACKSWING_SEC = (0.40, 0.05)  # the backswing: this far before the peak hand speed (from, to)
MIN_CROSSING = 0.25           # the racket hand must cross at least this far, one way or the other
TWO_HANDED_GAP = 0.35         # hands closer than this through the swing = both on the racket
ONE_HANDED_GAP = 0.60         # hands further apart than this = one hand; between the two = unclear
MAX_WRONG_BACKSWING = 0.10    # backswing this far on the "wrong" side for the swing direction = unclear
RECOVERY_WITHIN_SEC = 3.5     # a return to ready follows its stroke within this long (peak to peak),
TAKEBACK_WITHIN_SEC = 1.8     # a takeback comes this long before its stroke at most,
SLOWER_RATIO = 1.2            # and the stroke's peak hand speed is at least this many times faster


def _side_sign(hand: str) -> float:
    """+1 for the right hand: wrist_side is positive toward the body's right."""
    return 1.0 if hand == "right" else -1.0


def classify_stroke(rep: dict, signals: dict, times: np.ndarray, handedness: str | None = None) -> dict:
    """rep: {"start", "end", ...} frame window of one stroke. handedness: "left", "right" or None.

    Returns {"stroke": "forehand" | "backhand" | None, "racket_hand": "left" | "right",
    "two_handed": bool, "crossing", "backswing", "speed", "hands_gap", "peak_sec", "direction",
    "handedness_mismatch": bool, "confidence": float, "reason": str (why it's unclassified)}.
    crossing > 0: the racket hand swung toward its own side (backhand-like); backswing > 0: it started
    on its own side (forehand-like). Both in torso lengths.
    """
    s, e = int(rep["start"]), int(rep["end"])
    fps = 1.0 / float(np.median(np.diff(times))) if len(times) > 1 else 30.0
    speed_l = np.asarray(signals["hand_speed_l"], dtype=float)
    speed_r = np.asarray(signals["hand_speed_r"], dtype=float)
    peak = s + int(np.argmax(np.maximum(speed_l, speed_r)[s:e + 1]))

    k = max(1, int(round(SWING_WINDOW_SEC * fps)))
    # Centred on the peak, but kept 2k long when the stroke's window (or the clip) cuts one side
    # short — e.g. a recording stopped just after contact still shows the swing leading into it.
    a, b = max(s, peak - k), min(e, peak + k)
    a, b = max(s, min(a, b - 2 * k)), min(e, max(b, a + 2 * k))
    near = slice(max(s, peak - 3), min(e, peak + 3) + 1)

    gap = float(np.median(np.asarray(signals["hands_gap"])[a:b + 1]))
    two_handed = gap < TWO_HANDED_GAP
    one_handed = gap > ONE_HANDED_GAP

    side = {"left": np.asarray(signals["wrist_side_l"], dtype=float),
            "right": np.asarray(signals["wrist_side_r"], dtype=float)}

    def crossing(hand: str) -> float:
        return _side_sign(hand) * float(side[hand][b] - side[hand][a])

    if two_handed and handedness in ("left", "right"):
        racket = handedness
    elif two_handed:
        # Two-handed strokes are backhands, so the hand whose own side the swing moves toward holds it.
        racket = "right" if crossing("right") > 0 else "left"
    else:
        racket = "right" if speed_r[near].sum() >= speed_l[near].sum() else "left"

    cross = crossing(racket)
    pre = slice(max(s, peak - int(round(BACKSWING_SEC[0] * fps))), max(s + 1, peak - int(round(BACKSWING_SEC[1] * fps))))
    backswing = _side_sign(racket) * float(side[racket][pre].mean())  # > 0: racket hand on its own side
    speed_peak = float(max(speed_l[peak], speed_r[peak]) * fps)  # torso lengths per second

    off_hand_faster = bool(one_handed and handedness in ("left", "right") and racket != handedness)
    result = {
        "stroke": None, "racket_hand": racket, "peak_sec": round(float(times[peak]), 3),
        # Which way the racket hand moved across the body, + = toward the body's right (handedness-free).
        "direction": 1 if side[racket][b] > side[racket][a] else -1, "two_handed": bool(two_handed),
        "crossing": round(cross, 3), "backswing": round(backswing, 3), "speed": round(speed_peak, 2),
        "hands_gap": round(gap, 3),
        "handedness_mismatch": off_hand_faster,
        "confidence": 0.0, "reason": "",
    }
    if not (two_handed or one_handed):
        result["reason"] = "unclear whether one or both hands held the racket"
    elif off_hand_faster:
        result["reason"] = "the other hand swung faster than the athlete's playing hand"
    elif abs(cross) < MIN_CROSSING:
        result["reason"] = "racket hand didn't cross the body far enough"
    elif two_handed and cross < 0:
        result["reason"] = "two-handed swing toward the off side (two-handed forehand or wrong hand setting)"
    elif cross < 0 and backswing < -MAX_WRONG_BACKSWING:
        result["reason"] = "forehand-like swing from a backhand-side backswing"
    elif cross > 0 and backswing > MAX_WRONG_BACKSWING:
        result["reason"] = "backhand-like swing from a forehand-side backswing"
    else:
        result["stroke"] = BACKHAND if cross > 0 else FOREHAND
        # How clearly it passed: the smaller of its margins over the two rules it had to pass. Breaks
        # a forehand/backhand tie in a clip (analyze.py), so a borderline swing can't outvote a clear one.
        back_margin = MAX_WRONG_BACKSWING + (backswing if cross < 0 else -backswing)
        result["confidence"] = round(min(abs(cross) - MIN_CROSSING, back_margin), 3)
    return result


def classify_strokes(reps: list[dict], signals: dict, times: np.ndarray, handedness: str | None = None) -> list[dict]:
    """classify_stroke for every stroke the detector found in a clip (in time order), then the
    takeback / return-to-ready check, which needs the swings on either side (see the module docstring).
    Both checks compare the original calls, so dropping one swing never changes the verdict on another."""
    calls = [classify_stroke(r, signals, times, handedness) for r in reps]

    def much_faster_opposite(call: dict, other: dict, within: float) -> bool:
        return (other["direction"] != call["direction"]
                and abs(other["peak_sec"] - call["peak_sec"]) <= within
                and other["speed"] >= SLOWER_RATIO * call["speed"])

    reasons = []
    for i, call in enumerate(calls):
        if i > 0 and much_faster_opposite(call, calls[i - 1], RECOVERY_WITHIN_SEC):
            reasons.append("return to the ready position after the previous stroke")
        elif i + 1 < len(calls) and much_faster_opposite(call, calls[i + 1], TAKEBACK_WITHIN_SEC):
            reasons.append("takeback before the next stroke")
        else:
            reasons.append(None)
    for call, reason in zip(calls, reasons):
        if reason:
            call.update(stroke=None, confidence=0.0, reason=reason)
    return calls
