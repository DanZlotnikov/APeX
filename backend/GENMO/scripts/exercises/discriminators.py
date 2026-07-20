# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Tie-breakers for exercises that share a BodyOrientation and can both
register non-zero rep counts on the same clip. Kept separate from
counting.py because these compare *across* exercises rather than count reps
for one.
"""
from __future__ import annotations


def hinge_vs_squat(signals: dict, hip_dominant_ratio: float) -> str:
    """Squat vs. deadlift, both STANDING with a similar knee/hip-flexion
    signature — this is exactly the ambiguity that got deadlift removed
    from the mobile app entirely (see mobile/src/utils/exerciseAnalyzer.ts's
    header comment: "torso-lean/hip-angle signature intersected too much
    with squat"). The literature's actual discriminator for a hip hinge is
    that it minimizes knee flexion while maximizing hip flexion — shins
    stay close to vertical, the hips do almost all the moving. So instead
    of a single absolute torso-lean cutoff (what the old, removed
    implementation used, and which a squat can also cross), compare how
    much each joint actually moved over the whole clip: a hip-ROM that
    substantially exceeds knee-ROM is the hinge signature; comparable or
    knee-dominant ROM is a squat.
    """
    knee_rom = float(signals["knee_angle"].max() - signals["knee_angle"].min())
    hip_rom = float(signals["hip_angle"].max() - signals["hip_angle"].min())
    ratio = hip_rom / max(knee_rom, 1e-6)
    return "deadlift" if ratio >= hip_dominant_ratio else "squat"
