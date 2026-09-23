# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Trains the ML exercise classifier on whatever's currently cached by
extract_features.py -- safe to run on a partial cache (extraction is
resumable and may be interrupted for hours/days at a time) and safe to
re-run later as more data accumulates; it always retrains from scratch on
everything cached so far rather than incrementally updating.

Usage (from backend/GENMO, WSL venv):
    python scripts/ml/train_classifier.py
"""
from __future__ import annotations

import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from sklearn.model_selection import train_test_split
from sklearn.metrics import confusion_matrix

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

from exercises.ml_classifier import (  # noqa: E402
    DEFAULT_CHECKPOINT_PATH, FEATURE_DIM, ExerciseMLP, compute_feature_vector,
)

REPO_ROOT = SCRIPTS_DIR.parent
CACHE_DIR = REPO_ROOT / "inputs" / "ml_cache"
JOINTS_DIR = CACHE_DIR / "joints"
LABELS_CSV = CACHE_DIR / "labels.csv"

HIDDEN_SIZES = (64, 32)
VAL_FRACTION = 0.15
MAX_EPOCHS = 300
PATIENCE = 30
LR = 1e-3
WEIGHT_DECAY = 1e-4
BATCH_SIZE = 32
RANDOM_SEED = 0
MIN_STD = 1e-6  # floor so a near-constant feature (e.g. wrist_above on a
# clip that never goes overhead) can't produce a division-by-near-zero at
# inference time.


def load_dataset() -> tuple[np.ndarray, list[str]]:
    import csv

    if not LABELS_CSV.exists():
        print(f"[train] {LABELS_CSV} not found -- run extract_features.py first", file=sys.stderr)
        sys.exit(1)

    with open(LABELS_CSV, newline="") as f:
        rows = list(csv.DictReader(f))

    features, labels = [], []
    skipped_short = 0
    for row in rows:
        joints_path = JOINTS_DIR / f"{row['sequence_id']}.npy"
        if not joints_path.exists():
            continue
        joints_np = np.load(joints_path)
        vec = compute_feature_vector(joints_np)
        if vec is None:
            skipped_short += 1
            continue
        features.append(vec)
        labels.append(row["mapped_label"])

    if skipped_short:
        print(f"[train] skipped {skipped_short} cached clips (too short for a feature vector)")
    return np.stack(features), labels


def main() -> None:
    X, y_str = load_dataset()
    counts = Counter(y_str)
    print(f"[train] {len(X)} clips across {len(counts)} classes: {dict(sorted(counts.items()))}")

    labels = sorted(counts)  # fixed, alphabetical class order -> stable label indices across retrains
    label_to_idx = {label: i for i, label in enumerate(labels)}
    y = np.array([label_to_idx[label] for label in y_str])

    try:
        X_train, X_val, y_train, y_val = train_test_split(
            X, y, test_size=VAL_FRACTION, random_state=RANDOM_SEED, stratify=y,
        )
    except ValueError as e:
        print(f"[train] stratified split failed ({e}) -- falling back to a plain random split "
              f"(expect this if some class has very few cached clips so far)")
        X_train, X_val, y_train, y_val = train_test_split(
            X, y, test_size=VAL_FRACTION, random_state=RANDOM_SEED,
        )

    feature_mean = X_train.mean(axis=0)
    feature_std = np.maximum(X_train.std(axis=0), MIN_STD)

    device = "cuda" if torch.cuda.is_available() else "cpu"

    def to_tensor(X_arr, y_arr):
        Xn = (X_arr - feature_mean) / feature_std
        return torch.tensor(Xn, dtype=torch.float32, device=device), torch.tensor(y_arr, dtype=torch.long, device=device)

    Xt_train, yt_train = to_tensor(X_train, y_train)
    Xt_val, yt_val = to_tensor(X_val, y_val)

    model = ExerciseMLP(FEATURE_DIM, HIDDEN_SIZES, len(labels)).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=LR, weight_decay=WEIGHT_DECAY)
    criterion = nn.CrossEntropyLoss()

    n = Xt_train.shape[0]
    best_val_acc = -1.0
    best_state = None
    epochs_without_improvement = 0
    rng = np.random.default_rng(RANDOM_SEED)

    t0 = time.time()
    for epoch in range(MAX_EPOCHS):
        model.train()
        perm = rng.permutation(n)
        for start in range(0, n, BATCH_SIZE):
            idx = perm[start:start + BATCH_SIZE]
            batch_x, batch_y = Xt_train[idx], yt_train[idx]
            optimizer.zero_grad()
            loss = criterion(model(batch_x), batch_y)
            loss.backward()
            optimizer.step()

        model.eval()
        with torch.no_grad():
            val_acc = (model(Xt_val).argmax(dim=-1) == yt_val).float().mean().item()

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
            epochs_without_improvement = 0
        else:
            epochs_without_improvement += 1
            if epochs_without_improvement >= PATIENCE:
                print(f"[train] early stop at epoch {epoch} (no val improvement for {PATIENCE} epochs)")
                break

    print(f"[train] training done in {time.time() - t0:.1f}s, best val acc = {best_val_acc:.3f} "
          f"(random-guess baseline = {1 / len(labels):.3f})")

    model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        val_preds = model(Xt_val).argmax(dim=-1).cpu().numpy()
    cm = confusion_matrix(y_val, val_preds, labels=list(range(len(labels))))
    print(f"[train] confusion matrix (rows=true, cols=predicted), labels={labels}:")
    print(cm)

    checkpoint = {
        "state_dict": best_state,
        "feature_mean": feature_mean.astype(np.float32),
        "feature_std": feature_std.astype(np.float32),
        "labels": labels,
        "hidden_sizes": list(HIDDEN_SIZES),
    }
    DEFAULT_CHECKPOINT_PATH.parent.mkdir(parents=True, exist_ok=True)
    torch.save(checkpoint, DEFAULT_CHECKPOINT_PATH)
    print(f"[train] saved checkpoint -> {DEFAULT_CHECKPOINT_PATH}")


if __name__ == "__main__":
    main()
