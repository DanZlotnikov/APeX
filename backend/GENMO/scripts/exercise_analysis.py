# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Exercise rep counting from GEM/SMPL 3D joints.

This is a direct port of the MediaPipe-based rep counter in
mobile/src/utils/exerciseAnalyzer.ts (EXERCISE_ANALYZER_JS) — same feature
definitions, same adaptive thresholds, same state machines, same mutual-
exclusion rules between squat/jump/pullup. The counting logic itself is not
redesigned here; only the joint source changes.

── Why the thresholds port over unchanged ──────────────────────────────────
The original analyzer's thresholds are almost all expressed as *fractions of
a per-clip body-scale reference* (percent of each rep's own knee-angle ROM,
percent of the athlete's own standing shoulder-to-ankle span, etc.), not
absolute pixel/frame constants. That was deliberate — it's what makes the
thresholds work across different camera distances and body sizes. Since
those formulas are scale-invariant by construction, they carry over directly
to real-world meters: `bodyScale * 0.10` means the same thing whether
`bodyScale` is a normalized-image-space distance or a metric one, as long as
everything else derives from the same reference. Only two absolute constants
needed rethinking for the switch to real 3D:
  - `BODY_RISE_MIN` (pull-up hip-rise gate) was a raw 0.05 in normalized
    image units; here it's expressed as a fraction of torso length instead,
    which is the more scale-invariant version of the same idea.
  - Angle thresholds (35°, 18° ROM gates) are unit-independent — a knee
    angle is a knee angle whether measured from a 2D projection or true 3D.
    If anything, the true 3D angles from GEM should track the biomechanics
    literature's intended thresholds *more* faithfully than MediaPipe's
    2D-projected approximation did, which is distorted by viewing angle.

── Coordinate convention ────────────────────────────────────────────────────
MediaPipe landmarks are normalized image space, Y-DOWN (smaller y = higher
up). SMPL world-space joints are real-world meters, Y-UP (larger y = higher
up). Every "higher/rises/above" comparison below is flipped accordingly from
the original JS — this is the one place a literal line-for-line port would
have silently inverted every state machine.
"""
from __future__ import annotations

import numpy as np

# Standard SMPL body kinematic tree, first 22 joints (make_smplx("supermotion") order).
PELVIS, L_HIP, R_HIP, SPINE1, L_KNEE, R_KNEE, SPINE2, L_ANKLE, R_ANKLE, SPINE3, \
    L_FOOT, R_FOOT, NECK, L_COLLAR, R_COLLAR, HEAD, L_SHOULDER, R_SHOULDER, \
    L_ELBOW, R_ELBOW, L_WRIST, R_WRIST = range(22)

# Parent index per joint (root = -1). Matches body_model.parents[:22].
SMPL_PARENTS = [-1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19]

MIN_FLIGHT_SEC = 0.15
FEATURE_SMOOTH_WINDOW_SEC = 0.12


def angle3d(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> np.ndarray:
    """Angle at vertex b formed by points a-b-c, in degrees. Inputs: (..., 3)."""
    ab, cb = a - b, c - b
    dot = (ab * cb).sum(-1)
    mag = np.linalg.norm(ab, axis=-1) * np.linalg.norm(cb, axis=-1)
    mag = np.maximum(mag, 1e-6)
    return np.degrees(np.arccos(np.clip(dot / mag, -1.0, 1.0)))


def extract_features(joints: np.ndarray) -> dict:
    """joints: (L, 22, 3) world-space (Y-up, meters) joint positions per frame."""
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

    shoulder_mid = (joints[:, L_SHOULDER] + joints[:, R_SHOULDER]) / 2
    hip_mid = (joints[:, L_HIP] + joints[:, R_HIP]) / 2
    torso_vec = shoulder_mid - hip_mid
    vertical = torso_vec[:, 1]
    horizontal = np.sqrt(torso_vec[:, 0] ** 2 + torso_vec[:, 2] ** 2)
    torso_lean = np.degrees(np.arctan2(horizontal, np.maximum(np.abs(vertical), 1e-3)))

    ankle_y = (joints[:, L_ANKLE, 1] + joints[:, R_ANKLE, 1]) / 2
    shoulder_y = shoulder_mid[:, 1]
    hip_y = hip_mid[:, 1]
    wrist_y = (joints[:, L_WRIST, 1] + joints[:, R_WRIST, 1]) / 2

    torso_scale = np.maximum(np.abs(vertical), 0.20)  # metric floor, ~min plausible torso length
    wrist_above = ((wrist_y - shoulder_y) > torso_scale * 0.22).astype(np.float64)

    # Pull-up body-rise corroboration deliberately does NOT use hipY (absolute
    # world-frame height). GEM's world-grounding leans on foot-ground contact
    # to anchor absolute translation, and a pull-up has none for the entire
    # exercise — verified on real output: hipY drifted up once early in the
    # clip and then stayed flat, while the actual rep-by-rep motion was fully
    # legible in wrist-to-hip distance instead, which doesn't depend on
    # absolute world translation at all, only relative body pose (confirmed:
    # it oscillates in lockstep with elbow angle across every rep). Shrinks as
    # the body is pulled up toward the hands, grows on the way back down.
    wrist_mid = (joints[:, L_WRIST] + joints[:, R_WRIST]) / 2
    wrist_hip_dist = np.linalg.norm(wrist_mid - hip_mid, axis=-1)

    return dict(
        kneeAngle=knee_angle, hipAngle=hip_angle, torsoLean=torso_lean,
        ankleY=ankle_y, shoulderY=shoulder_y, hipY=hip_y,
        elbowAngle=elbow_angle, wristAbove=wrist_above, torsoScale=torso_scale,
        wristHipDist=wrist_hip_dist,
    )


def smooth_features(f: dict, times: np.ndarray) -> dict:
    """Time-windowed centered moving average, matching smoothFeatures() in the JS."""
    L = len(times)
    out = {k: np.zeros(L) for k in f if k != "torsoScale"}
    for i in range(L):
        t = times[i]
        lo, hi = i, i
        while lo > 0 and t - times[lo - 1] <= FEATURE_SMOOTH_WINDOW_SEC:
            lo -= 1
        while hi < L - 1 and times[hi + 1] - t <= FEATURE_SMOOTH_WINDOW_SEC:
            hi += 1
        for k in out:
            out[k][i] = f[k][lo:hi + 1].mean()
    out["torsoScale"] = f["torsoScale"]
    return out


# ── rep counters ─────────────────────────────────────────────────────────────

def count_squats(f: dict) -> int:
    L = len(f["kneeAngle"])
    if L == 0:
        return 0
    LEAN_MAX = 40
    min_knee, max_knee = f["kneeAngle"].min(), f["kneeAngle"].max()
    rng = max_knee - min_knee
    if rng < 35:
        return 0
    depth_t = min_knee + rng * 0.25
    stand_t = min_knee + rng * 0.55

    count, was_standing, at_depth = 0, True, False
    for i in range(L):
        k, lean = f["kneeAngle"][i], f["torsoLean"][i]
        if not at_depth and k > stand_t:
            was_standing = True
        if was_standing and not at_depth and k < depth_t and lean < LEAN_MAX:
            at_depth, was_standing = True, False
        if at_depth and k > stand_t:
            count += 1
            at_depth, was_standing = False, True
    return count


def jump_baseline(f: dict, base_n: int) -> tuple[float, float]:
    ankle_baseline = f["ankleY"][:base_n].mean()
    # Y-up: standing shoulder is ABOVE ankle, so shoulderY - ankleY > 0 — the
    # flip of MediaPipe's y-down version, which used ankleY - shoulderY.
    body_scale = max(0.15, float((f["shoulderY"][:base_n] - f["ankleY"][:base_n]).mean()))
    return ankle_baseline, body_scale


def count_jumps(f: dict, times: np.ndarray) -> int:
    L = len(f["ankleY"])
    if L < 10:
        return 0
    base_n = max(5, int(L * 0.12))
    ankle_baseline, body_scale = jump_baseline(f, base_n)
    jump_thresh, land_thresh = body_scale * 0.10, body_scale * 0.04

    count, in_flight, takeoff_idx = 0, False, 0
    for j in range(L):
        rise = f["ankleY"][j] - ankle_baseline  # Y-up: rising = ankleY increases
        if not in_flight and rise > jump_thresh:
            in_flight, takeoff_idx = True, j
        elif in_flight and rise < land_thresh:
            if times[j] - times[takeoff_idx] >= MIN_FLIGHT_SEC:
                count += 1
            in_flight = False
    return count


def count_pullups(f: dict) -> int:
    L = len(f["elbowAngle"])
    if L == 0:
        return 0
    overhead_count = (f["wristAbove"] > 0.5).sum()
    if overhead_count < L * 0.3:
        return 0

    mask = f["wristAbove"] > 0.3
    if not mask.any():
        return 0
    min_e = f["elbowAngle"][mask].min()
    max_e = f["elbowAngle"][mask].max()
    rng = max_e - min_e
    if rng < 18:
        return 0

    body_rise_min = float(np.median(f["torsoScale"])) * 0.15
    min_drop = rng * 0.30

    count = 0
    started = False
    direction = "down"
    extreme_val = extreme_dist = 0.0
    ref_peak_val = ref_peak_dist = 0.0
    for i in range(L):
        if f["wristAbove"][i] < 0.3:
            continue
        e, d = f["elbowAngle"][i], f["wristHipDist"][i]
        if not started:
            started = True
            extreme_val = ref_peak_val = e
            extreme_dist = ref_peak_dist = d
            continue
        if direction == "down":
            if e < extreme_val:
                extreme_val, extreme_dist = e, d
            elif e - extreme_val >= min_drop:
                # A genuine pull-up rep shrinks wrist-to-hip distance as the
                # body is pulled up toward the hands (see extract_features for
                # why this replaces a world-frame hip-height check).
                if ref_peak_dist - extreme_dist >= body_rise_min:
                    count += 1
                direction, extreme_val, extreme_dist = "up", e, d
        else:
            if e > extreme_val:
                extreme_val, extreme_dist = e, d
            elif extreme_val - e >= min_drop:
                ref_peak_val, ref_peak_dist = extreme_val, extreme_dist
                direction, extreme_val, extreme_dist = "down", e, d

    # Clip may end mid-rep near the top — count an in-progress final rep.
    if direction == "down" and ref_peak_val - extreme_val >= min_drop \
            and ref_peak_dist - extreme_dist >= body_rise_min:
        count += 1
    return count


def analyze_exercises(joints: np.ndarray, fps: float = 30.0) -> dict:
    """joints: (L, 22, 3) world-space joint positions. Returns rep counts,
    mirroring analyzeExercises()'s mutual-exclusion rules exactly:
    sustained overhead grip rules out both jump and squat; a detected jump
    rules out squat (its countermovement dip can look like a shallow rep).
    """
    L = joints.shape[0]
    if L < 15:
        return {"squat": 0, "jump": 0, "pullup": 0}

    times = np.arange(L) / fps
    raw = extract_features(joints)
    f = smooth_features(raw, times)

    sq_count = count_squats(f)
    j_count = count_jumps(f, times)
    pu_count = count_pullups(f)

    overhead_frames = (f["wristAbove"] > 0.5).sum()
    sustained_overhead = overhead_frames >= L * 0.3
    if sustained_overhead:
        j_count = 0
        sq_count = 0
    if j_count > 0 and sq_count > 0:
        sq_count = 0

    return {"squat": int(sq_count), "jump": int(j_count), "pullup": int(pu_count)}


# ── rep segmentation (for the on-screen live counter) ────────────────────────

def segment_squat(f: dict) -> list[dict]:
    min_k, max_k = f["kneeAngle"].min(), f["kneeAngle"].max()
    rng = max_k - min_k
    if rng < 35:
        return []
    depth_t, stand_t = min_k + rng * 0.25, min_k + rng * 0.55
    reps, was_standing, at_depth, start, bot_idx, bot_val = [], True, False, 0, 0, float("inf")
    for i in range(len(f["kneeAngle"])):
        k = f["kneeAngle"][i]
        if not at_depth and k > stand_t:
            was_standing, start = True, i
        if was_standing and not at_depth and k < depth_t and f["torsoLean"][i] < 40:
            at_depth, was_standing, bot_val, bot_idx = True, False, float("inf"), i
        if at_depth and k < bot_val:
            bot_val, bot_idx = k, i
        if at_depth and k > stand_t:
            reps.append({"start": start, "bottom": bot_idx, "end": i})
            at_depth, was_standing, start = False, True, i
    return reps


def segment_jumps(f: dict, times: np.ndarray) -> list[dict]:
    L = len(f["ankleY"])
    if L < 10:
        return []
    base_n = max(5, int(L * 0.12))
    ankle_baseline, body_scale = jump_baseline(f, base_n)
    jump_thresh, land_thresh = body_scale * 0.10, body_scale * 0.04
    flights, in_flight, takeoff = [], False, 0
    for j in range(L):
        rise = f["ankleY"][j] - ankle_baseline
        if not in_flight and rise > jump_thresh:
            in_flight, takeoff = True, j
        elif in_flight and rise < land_thresh:
            if times[j] - times[takeoff] >= MIN_FLIGHT_SEC:
                flights.append({"takeoff": takeoff, "land": j})
            in_flight = False
    return flights


def segment_pullups(f: dict) -> list[dict]:
    L = len(f["elbowAngle"])
    mask = f["wristAbove"] > 0.3
    if not mask.any():
        return []
    min_e, max_e = f["elbowAngle"][mask].min(), f["elbowAngle"][mask].max()
    rng = max_e - min_e
    if rng < 18:
        return []
    body_rise_min = float(np.median(f["torsoScale"])) * 0.15
    min_drop = rng * 0.30

    reps, started, direction = [], False, "down"
    extreme_val = extreme_dist = 0.0
    extreme_idx = 0
    ref_peak_val = ref_peak_dist = 0.0
    ref_peak_idx = 0
    for i in range(L):
        if f["wristAbove"][i] < 0.3:
            continue
        e, d = f["elbowAngle"][i], f["wristHipDist"][i]
        if not started:
            started = True
            extreme_val = ref_peak_val = e
            extreme_dist = ref_peak_dist = d
            extreme_idx = ref_peak_idx = i
            continue
        if direction == "down":
            if e < extreme_val:
                extreme_val, extreme_dist, extreme_idx = e, d, i
            elif e - extreme_val >= min_drop:
                if ref_peak_dist - extreme_dist >= body_rise_min:
                    reps.append({"start": ref_peak_idx, "bottom": extreme_idx, "end": i})
                direction, extreme_val, extreme_dist, extreme_idx = "up", e, d, i
        else:
            if e > extreme_val:
                extreme_val, extreme_dist, extreme_idx = e, d, i
            elif extreme_val - e >= min_drop:
                ref_peak_val, ref_peak_dist, ref_peak_idx = extreme_val, extreme_dist, extreme_idx
                direction, extreme_val, extreme_dist, extreme_idx = "down", e, d, i

    if direction == "down" and ref_peak_val - extreme_val >= min_drop \
            and ref_peak_dist - extreme_dist >= body_rise_min:
        reps.append({"start": ref_peak_idx, "bottom": extreme_idx, "end": extreme_idx})
    return reps


def stabilize_grip_point(joints: np.ndarray) -> np.ndarray:
    """Re-anchor a pull-up sequence on a fixed wrist position instead of the
    model's own (unreliable — see extract_features) world translation.

    GEM has no foot-contact signal to anchor absolute translation during a
    hanging exercise, so it ends up attributing most of the real motion to
    arm articulation around a roughly-static torso — visually, the hands
    appear to move up and down while the body stays put, which is backwards:
    physically, the hands are fixed on the bar and the *body* rises to meet
    them. This is a pure per-frame rigid shift (every joint in a frame moves
    by the same offset), so it changes nothing about relative joint
    angles/distances — safe to apply without affecting rep counting, which
    already only looks at those.

    Args:
        joints: (L, 22, 3) world-space joints, already the output of a
            pull-up-classified clip (caller's responsibility to check).

    Returns:
        (L, 22, 3) joints shifted per-frame so the wrist midpoint is constant
        across the clip, at the mean grip position observed while the wrists
        were actually overhead.
    """
    wrist_mid = (joints[:, L_WRIST] + joints[:, R_WRIST]) / 2  # (L, 3)
    shoulder_mid = (joints[:, L_SHOULDER] + joints[:, R_SHOULDER]) / 2
    hip_mid = (joints[:, L_HIP] + joints[:, R_HIP]) / 2
    torso_scale = np.maximum(np.abs(shoulder_mid[:, 1] - hip_mid[:, 1]), 0.20)
    wrist_above = (wrist_mid[:, 1] - shoulder_mid[:, 1]) > torso_scale * 0.22

    if not wrist_above.any():
        return joints  # nothing to anchor to; leave as-is

    grip_point = wrist_mid[wrist_above].mean(axis=0)  # (3,) — where the bar actually is
    offset = grip_point[None, :] - wrist_mid  # (L, 3) — per-frame correction
    return joints + offset[:, None, :]


def compute_rep_timeline(joints: np.ndarray, counts: dict, fps: float = 30.0) -> dict:
    """Per-frame cumulative rep count for whichever exercise was detected,
    plus which exercise key is active (for the HUD label). One of the three
    counts is guaranteed <= what analyze_exercises returned after mutual
    exclusion, so this only segments the exercise(s) that actually won.
    """
    L = joints.shape[0]
    empty = {"key": None, "cumulative": np.zeros(L, dtype=int)}
    if L < 15:
        return empty

    times = np.arange(L) / fps
    raw = extract_features(joints)
    f = smooth_features(raw, times)

    # Priority mirrors computeRepWindow()'s ordering: squat, then jump, then pullup.
    if counts["squat"] > 0:
        reps = segment_squat(f)
        end_idxs = [r["end"] for r in reps]
        key = "squat"
    elif counts["jump"] > 0:
        flights = segment_jumps(f, times)
        end_idxs = [fl["land"] for fl in flights]
        key = "jump"
    elif counts["pullup"] > 0:
        reps = segment_pullups(f)
        end_idxs = [r["end"] for r in reps]
        key = "pullup"
    else:
        return empty

    cumulative = np.zeros(L, dtype=int)
    c = 0
    ei = 0
    for i in range(L):
        while ei < len(end_idxs) and end_idxs[ei] <= i:
            c += 1
            ei += 1
        cumulative[i] = c
    return {"key": key, "cumulative": cumulative}
