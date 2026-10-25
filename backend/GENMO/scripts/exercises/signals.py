# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Per-frame joint-angle / position signals, computed once per clip and shared
across every exercise definition (each definition just names which ones it
needs — see definitions.py's `primary_signal` / `corroboration` /
`discriminator` fields).

── Coordinate convention ────────────────────────────────────────────────────
SMPL world-space joints: real-world meters, Y-UP (larger y = higher up).
Every "higher/rises/above" comparison below reflects that.
"""
from __future__ import annotations

import numpy as np

# Standard SMPL body kinematic tree, first 22 joints (make_smplx("supermotion") order).
PELVIS, L_HIP, R_HIP, SPINE1, L_KNEE, R_KNEE, SPINE2, L_ANKLE, R_ANKLE, SPINE3, \
    L_FOOT, R_FOOT, NECK, L_COLLAR, R_COLLAR, HEAD, L_SHOULDER, R_SHOULDER, \
    L_ELBOW, R_ELBOW, L_WRIST, R_WRIST = range(22)

SMPL_PARENTS = [-1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19]


def angle3d(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> np.ndarray:
    """Angle at vertex b formed by points a-b-c, in degrees. Inputs: (..., 3)."""
    ab, cb = a - b, c - b
    dot = (ab * cb).sum(-1)
    mag = np.linalg.norm(ab, axis=-1) * np.linalg.norm(cb, axis=-1)
    mag = np.maximum(mag, 1e-6)
    return np.degrees(np.arccos(np.clip(dot / mag, -1.0, 1.0)))


def compute_signals(joints: np.ndarray) -> dict:
    """joints: (L, 22, 3) world-space joints for one clip.

    Returns every raw per-frame signal any exercise definition or the
    orientation classifier might need. Computing everything once up front
    (rather than each exercise recomputing its own subset) is what lets
    analyze.py cheaply evaluate several candidate exercises per clip.
    """
    knee_angle = (
        angle3d(joints[:, L_HIP], joints[:, L_KNEE], joints[:, L_ANKLE])
        + angle3d(joints[:, R_HIP], joints[:, R_KNEE], joints[:, R_ANKLE])
    ) / 2
    hip_angle = (
        angle3d(joints[:, L_SHOULDER], joints[:, L_HIP], joints[:, L_KNEE])
        + angle3d(joints[:, R_SHOULDER], joints[:, R_HIP], joints[:, R_KNEE])
    ) / 2
    elbow_angle = (
        angle3d(joints[:, L_SHOULDER], joints[:, L_ELBOW], joints[:, L_WRIST])
        + angle3d(joints[:, R_SHOULDER], joints[:, R_ELBOW], joints[:, R_WRIST])
    ) / 2
    # Plank straightness: hip-knee-ankle angle near 180 deg = body extended
    # in a straight line (push-up); well below 180 = knees bent / hips
    # dropped (rules push-up out, e.g. for a crunch's bent-knee posture).
    body_line_angle = (
        angle3d(joints[:, L_HIP], joints[:, L_KNEE], joints[:, L_ANKLE])
        + angle3d(joints[:, R_HIP], joints[:, R_KNEE], joints[:, R_ANKLE])
    ) / 2  # note: identical formula to knee_angle, kept as a separate named
    # signal since callers use it for a conceptually different purpose
    # (posture classification, not a rep-counting primary signal) and the
    # two may reasonably diverge later (e.g. if plank straightness starts
    # incorporating shoulder-hip-ankle instead).

    shoulder_mid = (joints[:, L_SHOULDER] + joints[:, R_SHOULDER]) / 2
    hip_mid = (joints[:, L_HIP] + joints[:, R_HIP]) / 2
    knee_mid = (joints[:, L_KNEE] + joints[:, R_KNEE]) / 2
    ankle_mid = (joints[:, L_ANKLE] + joints[:, R_ANKLE]) / 2

    torso_vec = shoulder_mid - hip_mid
    vertical = torso_vec[:, 1]
    horizontal = np.sqrt(torso_vec[:, 0] ** 2 + torso_vec[:, 2] ** 2)
    torso_lean = np.degrees(np.arctan2(horizontal, np.maximum(np.abs(vertical), 1e-3)))

    ankle_y = ankle_mid[:, 1]
    shoulder_y = shoulder_mid[:, 1]
    hip_y = hip_mid[:, 1]
    knee_y = knee_mid[:, 1]
    wrist_y = (joints[:, L_WRIST, 1] + joints[:, R_WRIST, 1]) / 2

    torso_scale = np.maximum(np.abs(vertical), 0.20)  # metric floor, ~min plausible torso length
    wrist_above = ((wrist_y - shoulder_y) > torso_scale * 0.22).astype(np.float64)

    # Positive when the wrists sit well below the shoulders — a push-up's
    # hands are planted on the floor bearing weight while the torso is held
    # elevated above it, so this stays comfortably positive throughout a
    # real rep (even at the bottom, the chest doesn't reach the floor while
    # the hands still do). A crunch's hands (behind the head or on the
    # chest) sit at roughly the same height as the shoulders since the
    # whole body is lying flat on the floor, so this stays near zero. Used
    # in orientation.py as a second, independent PLANK-vs-LYING signal —
    # added specifically because body_line_angle (leg straightness) proved
    # unreliable for a real push-up on its own (see that file's own note),
    # and this reads an entirely different body part, so the two aren't
    # likely to fail together.
    hand_ground_gap = shoulder_y - wrist_y

    # How far the feet have moved, horizontally, from wherever the clip
    # started — a squat's own feet stay planted through the whole rep (they
    # only load/unload, not step), while a padel/tennis stroke often
    # involves real footwork (stepping, pivoting to reach the ball)
    # alongside the arm swing. Deliberately horizontal-plane only (X/Z, not
    # Y) so it isn't confounded by the athlete's hips/ankles simply rising
    # and falling during a squat's own vertical motion — only genuine
    # sideways/forward foot travel counts.
    ankle_xz0 = ankle_mid[0, [0, 2]]
    foot_shift = np.linalg.norm(ankle_mid[:, [0, 2]] - ankle_xz0, axis=-1)

    # Pull-up body-rise corroboration deliberately does NOT use hipY
    # (absolute world-frame height). GEM's world-grounding leans on
    # foot-ground contact to anchor absolute translation, and a pull-up has
    # none for the entire exercise — verified on real output: hipY drifted
    # up once early in the clip and then stayed flat, while the actual
    # rep-by-rep motion was fully legible in wrist-to-hip distance instead,
    # which doesn't depend on absolute world translation at all, only
    # relative body pose.
    wrist_mid = (joints[:, L_WRIST] + joints[:, R_WRIST]) / 2
    wrist_hip_dist = np.linalg.norm(wrist_mid - hip_mid, axis=-1)

    # Ab crunch's body-rise corroboration, same shape as pull-up's above: a
    # distance that shrinks as the athlete actually curls up (shoulder
    # approaches knee), independent of absolute world-frame height — which
    # matters here too, since a supine athlete's hips barely translate in
    # world space during a crunch regardless of grounding quality.
    shoulder_knee_dist = np.linalg.norm(shoulder_mid - knee_mid, axis=-1)

    # Orientation classification signals: how "tall" (standing) vs. "flat"
    # (lying/plank) the body is, independent of absolute position — the
    # vertical spread of shoulder/hip/ankle relative to the horizontal
    # extent of the same three points.
    pts = np.stack([shoulder_mid, hip_mid, ankle_mid], axis=1)  # (L, 3, 3)
    vertical_spread = pts[:, :, 1].max(axis=1) - pts[:, :, 1].min(axis=1)
    horizontal_spread = np.linalg.norm(
        pts[:, :, [0, 2]].max(axis=1) - pts[:, :, [0, 2]].min(axis=1), axis=-1
    )
    upright_ratio = vertical_spread / np.maximum(horizontal_spread, 1e-3)

    # Hand motion relative to the body, in torso lengths (camera-distance independent). Relative to
    # the pelvis so stepping/running, which moves the whole body, cancels out; lateral = along the
    # hip-to-hip axis, so "which side of the body" needs no handedness. Used by movement.py to find
    # a stroke's start (hand_speed) and confirm it's a real swing: a groundstroke carries the racket
    # hand across the body, ball handling and gesturing don't (see tennis_stroke's movement_rule).
    torso_len = max(float(np.median(np.linalg.norm(shoulder_mid - hip_mid, axis=-1))), 1e-3)
    wrist_rel = np.stack([joints[:, L_WRIST] - hip_mid, joints[:, R_WRIST] - hip_mid], axis=1)  # (L, 2, 3)
    lateral = joints[:, R_HIP] - joints[:, L_HIP]
    lateral[:, 1] = 0.0
    lateral /= np.maximum(np.linalg.norm(lateral, axis=-1, keepdims=True), 1e-6)
    wrist_side = (wrist_rel * lateral[:, None, :]).sum(-1) / torso_len  # (L, 2)
    step = np.linalg.norm(np.diff(wrist_rel, axis=0, prepend=wrist_rel[:1]), axis=-1)  # (L, 2), per frame
    hand_speed = step.max(axis=1) / torso_len  # faster hand = the racket hand; torso lengths per frame
    # Per hand, plus how far apart the hands are — what stroke_type.py tells forehand from backhand
    # with: which hand swings, which way it crosses the body, and whether both hands hold the racket.
    hands_gap = np.linalg.norm(joints[:, L_WRIST] - joints[:, R_WRIST], axis=-1) / torso_len

    return dict(
        hand_speed=hand_speed, hand_speed_l=step[:, 0] / torso_len, hand_speed_r=step[:, 1] / torso_len,
        hands_gap=hands_gap, wrist_side_l=wrist_side[:, 0], wrist_side_r=wrist_side[:, 1],
        knee_angle=knee_angle, hip_angle=hip_angle, elbow_angle=elbow_angle,
        body_line_angle=body_line_angle, torso_lean=torso_lean,
        ankle_y=ankle_y, shoulder_y=shoulder_y, hip_y=hip_y, knee_y=knee_y, wrist_y=wrist_y,
        wrist_above=wrist_above, wrist_hip_dist=wrist_hip_dist, shoulder_knee_dist=shoulder_knee_dist,
        torso_scale=torso_scale, upright_ratio=upright_ratio, foot_shift=foot_shift,
        hand_ground_gap=hand_ground_gap,
    )


def flight_height_signals(incam_joints: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Ankle-height + body-scale signals for vertical_jump's flight-phase
    detection, computed from the IN-CAMERA (not world-grounded) SMPL
    reconstruction — see get_incam_joints() in worker.py for why: GEM's
    world-grounding drifts unreliably during a real jump's flight phase
    (confirmed on real footage), while the in-camera reconstruction, which
    never attempts world-frame translation at all, tracks a clean,
    repeatable rise-and-return pattern instead.

    In-camera coordinates follow image/camera convention (Y increases
    downward), the opposite of the world-grounded frame's Y-up used
    everywhere else in this file — negated here so the result is a
    genuine "height" (larger = higher) comparable to how every other
    height-like signal in this module behaves.
    """
    ankle_y_cam = (incam_joints[:, L_ANKLE, 1] + incam_joints[:, R_ANKLE, 1]) / 2
    shoulder_y_cam = (incam_joints[:, L_SHOULDER, 1] + incam_joints[:, R_SHOULDER, 1]) / 2
    height = -ankle_y_cam
    scale = shoulder_y_cam - ankle_y_cam  # already positive: shoulder is numerically smaller (higher) in Y-down
    return height, np.abs(scale)


FEATURE_SMOOTH_WINDOW_SEC = 0.12
# Signals that shouldn't be time-averaged like the continuous ones (already
# a per-frame boolean-ish gate, or a per-clip constant).
_NO_SMOOTH = {"torso_scale"}


def smooth_signals(signals: dict, times: np.ndarray) -> dict:
    """Time-windowed centered moving average (not a fixed frame count): a
    fixed window can silently smooth over far more real time than intended
    at a variable/sparse capture rate, flattening a genuine rep's range of
    motion into noise. See git history on the original squat/pull-up
    thresholds for the incident that motivated this.
    """
    L = len(times)
    keys = [k for k in signals if k not in _NO_SMOOTH]
    out = {k: np.zeros(L) for k in keys}
    for i in range(L):
        t = times[i]
        lo, hi = i, i
        while lo > 0 and t - times[lo - 1] <= FEATURE_SMOOTH_WINDOW_SEC:
            lo -= 1
        while hi < L - 1 and times[hi + 1] - t <= FEATURE_SMOOTH_WINDOW_SEC:
            hi += 1
        for k in keys:
            out[k][i] = signals[k][lo:hi + 1].mean()
    for k in _NO_SMOOTH:
        if k in signals:
            out[k] = signals[k]
    return out
