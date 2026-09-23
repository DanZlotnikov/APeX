# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
A second, independent "what exercise was that?" signal, computed by a small
neural net trained on public labeled footage (Penn Action -- see
scripts/ml/) instead of hand-tuned thresholds. Purely additive: nothing in
analyze.py or the rest of the rule-based pipeline reads this module, and
this module never touches signals it doesn't own. See worker.py's
run_core_pipeline for where its output gets attached to the analysis dict
as the sibling key "ml_prediction", alongside the untouched legacy
"exercise" key.

compute_feature_vector() and ExerciseMLP are imported by
scripts/ml/train_classifier.py too -- training and inference MUST build the
feature vector the same way, so this file is the single source of truth for
both, not two independently-maintained copies.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

from .analyze import MIN_FRAMES
from .signals import compute_signals, smooth_signals

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_CHECKPOINT_PATH = REPO_ROOT / "inputs" / "checkpoints" / "ml_exercise_classifier" / "model.pt"

# Every signal compute_signals() returns, in a fixed order -- this order is
# baked into every saved checkpoint's feature_mean/feature_std, so it must
# never be reordered without also retraining (adding a new signal is fine
# appended at the end; reordering existing ones silently corrupts every
# checkpoint trained before the change).
SIGNAL_NAMES = [
    "knee_angle", "hip_angle", "elbow_angle", "body_line_angle", "torso_lean",
    "ankle_y", "shoulder_y", "hip_y", "knee_y", "wrist_y",
    "wrist_above", "wrist_hip_dist", "shoulder_knee_dist", "torso_scale",
    "upright_ratio", "foot_shift", "hand_ground_gap",
]
STATS_PER_SIGNAL = 5  # mean, std, min, max, range
FEATURE_DIM = len(SIGNAL_NAMES) * STATS_PER_SIGNAL + 1  # + frame count


def compute_feature_vector(joints_np: np.ndarray, fps: float = 30.0) -> np.ndarray | None:
    """(L, 22, 3) joints -> FEATURE_DIM-length per-clip summary-stat vector,
    or None if the clip is too short to trust (same MIN_FRAMES cutoff
    analyze_exercises() itself uses, for the same reason: too few frames for
    smooth_signals()'s time-windowed averaging to mean anything).
    """
    L = joints_np.shape[0]
    if L < MIN_FRAMES:
        return None
    times = np.arange(L) / fps
    raw = compute_signals(joints_np)
    signals = smooth_signals(raw, times)

    stats = []
    for name in SIGNAL_NAMES:
        sig = signals[name]
        lo, hi = float(np.min(sig)), float(np.max(sig))
        stats.extend([float(np.mean(sig)), float(np.std(sig)), lo, hi, hi - lo])
    stats.append(float(L))
    return np.asarray(stats, dtype=np.float32)


class ExerciseMLP(nn.Module):
    """Small MLP over hand-crafted per-clip signal statistics -- not a
    skeleton-sequence model. At the data scale this trains on (hundreds to
    low thousands of clips), a few hundred summary-stat features carries
    almost all the signal a raw per-frame sequence would, at a fraction of
    the params/overfitting risk. See scripts/ml/train_classifier.py.
    """
    def __init__(self, in_dim: int, hidden_sizes: tuple[int, ...], num_classes: int):
        super().__init__()
        layers: list[nn.Module] = []
        prev = in_dim
        for h in hidden_sizes:
            layers += [nn.Linear(prev, h), nn.ReLU(), nn.Dropout(0.2)]
            prev = h
        layers.append(nn.Linear(prev, num_classes))
        self.net = nn.Sequential(*layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class MLExerciseClassifier:
    def __init__(self, checkpoint_path: Path, device: str = "cuda"):
        ckpt = torch.load(checkpoint_path, map_location=device, weights_only=False)
        self.device = device
        self.labels: list[str] = ckpt["labels"]
        self.feature_mean = torch.tensor(ckpt["feature_mean"], dtype=torch.float32, device=device)
        self.feature_std = torch.tensor(ckpt["feature_std"], dtype=torch.float32, device=device)
        self.model = ExerciseMLP(len(ckpt["feature_mean"]), tuple(ckpt["hidden_sizes"]), len(self.labels))
        self.model.load_state_dict(ckpt["state_dict"])
        self.model.to(device).eval()

    def predict(self, joints_np: np.ndarray, fps: float = 30.0) -> dict | None:
        """Returns {"exercise": <label>, "confidence": float, "probs": {label: float, ...}}
        or None for a too-short clip (see compute_feature_vector). "exercise"
        may be "other" -- the model's honest abstain class, not folded into
        None, since "the ML model doesn't recognize this as one of its known
        exercises" is itself useful information to see in the saved JSON.
        """
        vec = compute_feature_vector(joints_np, fps=fps)
        if vec is None:
            return None
        x = torch.tensor(vec, dtype=torch.float32, device=self.device).unsqueeze(0)
        x = (x - self.feature_mean) / self.feature_std
        with torch.no_grad():
            probs = torch.softmax(self.model(x), dim=-1)[0].cpu().numpy()
        best_idx = int(np.argmax(probs))
        return {
            "exercise": self.labels[best_idx],
            "confidence": round(float(probs[best_idx]), 4),
            "probs": {label: round(float(p), 4) for label, p in zip(self.labels, probs)},
        }


def load_ml_classifier(device: str = "cuda", checkpoint_path: Path = DEFAULT_CHECKPOINT_PATH) -> MLExerciseClassifier | None:
    """Loaded once in worker.load_all_models(), alongside the rest of the
    pipeline's models. Returns None (with a printed warning, not a crash) if
    training hasn't produced a checkpoint yet -- lets this integration land
    and run safely before/independent of scripts/ml/train_classifier.py.
    """
    checkpoint_path = Path(checkpoint_path)
    if not checkpoint_path.exists():
        print(f"[ml_classifier] no checkpoint at {checkpoint_path} -- "
              f"analysis['ml_prediction'] will be None until scripts/ml/train_classifier.py has been run")
        return None
    try:
        return MLExerciseClassifier(checkpoint_path, device=device)
    except Exception as e:  # noqa: BLE001 -- a broken/stale checkpoint must not take down the whole pipeline
        print(f"[ml_classifier] failed to load checkpoint at {checkpoint_path}: {e} -- analysis['ml_prediction'] will be None")
        return None
