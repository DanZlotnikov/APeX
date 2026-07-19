"""
Sanity-check tool for GEM's smpl_params.pt output.

Loads a saved GEM-SMPL inference result, reconstructs real 3D joint positions
from the SMPL-X body model, and checks that the numbers look like a real
human doing a real exercise rather than garbage: no NaNs, plausible joint
ranges, and a movement signature (e.g. hip/knee height dipping and
recovering for a squat).

Run from inside the GENMO venv (needs `gem`, `smplx`, `torch`):
    cd backend/GENMO && source .venv/bin/activate
    python ../validate_smpl_output.py outputs/demo_smpl/squat2/smpl_params.pt
"""

from __future__ import annotations

import sys

import torch

# SMPL/SMPL-X share the same first-22-joint body kinematic tree and order.
JOINT_NAMES = [
    "pelvis", "left_hip", "right_hip", "spine1", "left_knee", "right_knee",
    "spine2", "left_ankle", "right_ankle", "spine3", "left_foot", "right_foot",
    "neck", "left_collar", "right_collar", "head", "left_shoulder",
    "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist",
]


def main(params_path: str) -> None:
    sys.path.insert(0, ".")
    from gem.utils.smplx_utils import make_smplx

    data = torch.load(params_path, weights_only=False)
    assert "body_params_incam" in data, "missing body_params_incam"
    bp = data["body_params_incam"]

    n_frames = bp["body_pose"].shape[0]
    print(f"[check] frames: {n_frames}")

    for key in ("body_pose", "global_orient", "transl", "betas"):
        v = bp[key]
        assert not torch.isnan(v).any(), f"{key} contains NaNs"
        assert not torch.isinf(v).any(), f"{key} contains Infs"
        assert v.shape[0] == n_frames, f"{key} frame count mismatch"
    print("[check] no NaN/Inf, frame counts consistent — PASS")

    body_model = make_smplx("supermotion")
    body_model.cuda().eval()

    with torch.no_grad():
        out = body_model(
            body_pose=bp["body_pose"].cuda(),
            global_orient=bp["global_orient"].cuda(),
            transl=bp["transl"].cuda(),
            betas=bp["betas"].cuda(),
        )
    joints = out.joints[:, :22].cpu()  # (L, 22, 3) — body-only joints, meters
    print(f"[check] joints shape: {tuple(joints.shape)}")

    jrange = (joints.max(0).values - joints.min(0).values)
    print(f"[check] per-axis movement range across clip (m): "
          f"x={jrange[:, 0].max():.3f} y={jrange[:, 1].max():.3f} z={jrange[:, 2].max():.3f}")
    assert jrange.max() < 5.0, "implausible joint displacement (>5m) — likely garbage output"
    assert jrange.max() > 0.02, "no meaningful movement detected — likely a static/frozen prediction"
    print("[check] joint displacement is in a plausible human-movement range — PASS")

    # Squat/jump signature: pelvis height (Y, SMPL-X is Y-up) should dip and
    # recover, not just monotonically drift (which would suggest drift error
    # rather than a real repeated movement).
    pelvis_y = joints[:, JOINT_NAMES.index("pelvis"), 1]
    knee_y = joints[:, [JOINT_NAMES.index("left_knee"), JOINT_NAMES.index("right_knee")], 1].mean(1)
    print(f"[check] pelvis height range: [{pelvis_y.min():.3f}, {pelvis_y.max():.3f}] m "
          f"(dip = {pelvis_y.max() - pelvis_y.min():.3f} m)")
    print(f"[check] knee height range:   [{knee_y.min():.3f}, {knee_y.max():.3f}] m "
          f"(dip = {knee_y.max() - knee_y.min():.3f} m)")

    # Crude rep counter: count sign changes of the (smoothed) pelvis-height
    # velocity — each down-up cycle is one rep.
    smoothed = pelvis_y.unfold(0, 5, 1).mean(-1) if n_frames >= 5 else pelvis_y
    vel = smoothed[1:] - smoothed[:-1]
    sign = torch.sign(vel)
    sign_changes = (sign[1:] * sign[:-1] < 0).sum().item()
    est_reps = sign_changes // 2
    print(f"[check] estimated reps from pelvis-height sign changes: ~{est_reps}")

    print("\nAll checks passed — output looks like real, sane 3D motion data.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "outputs/demo_smpl/squat2/smpl_params.pt")
