# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Downloads and extracts the Penn Action dataset, then builds a manifest
mapping each sequence to an APeX exercise key (or "other") for
extract_features.py to consume.

Usage (from backend/GENMO, WSL venv):
    python scripts/ml/download_pennaction.py

Safe to re-run: skips the download/extract if already done, and manifest
generation is cheap (~2300 small .mat reads) so it always just re-runs.

Citation (required by the dataset's own terms): Weiyu Zhang, Menglong Zhu
and Konstantinos Derpanis, "From Actemes to Action: A Strongly-supervised
Representation for Detailed Action Understanding", ICCV 2013. No explicit
non-commercial restriction is stated on the dataset page, unlike the
GVHMR-processed datasets in docs/DATA.md (explicitly research-only) — this
is used here only to produce a dev-only comparison signal, not resold.
"""
from __future__ import annotations

import json
import random
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.io import loadmat

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / "inputs" / "pennaction"
TARBALL_URL = "https://www.cis.upenn.edu/~kostas/Penn_Action.tar.gz"
TARBALL_PATH = DATA_DIR / "Penn_Action.tar.gz"
# The tarball's own top-level entry is "Penn_Action/", not "frames"/"labels"
# directly -- confirmed by actually extracting it, not from the README's
# structure diagram (which omits that wrapper directory).
FRAMES_DIR = DATA_DIR / "Penn_Action" / "frames"
LABELS_DIR = DATA_DIR / "Penn_Action" / "labels"
MANIFEST_PATH = DATA_DIR / "manifest.json"

# Penn Action action label -> APeX exercise key. Only actions with a real
# pose-level match are included — see the plan's "Class mapping" section for
# why vertical_jump and padel's stroke have no entry here.
#
# Penn Action's own label strings have no underscore for these three (empty
# manifest counts for all three revealed this on the first real run against
# the actually-downloaded .mat files -- not documented anywhere, the
# GitHub README's prose uses "push_up"/"pull_up"/"sit_up" but the data
# itself doesn't match its own docs).
CLASS_MAP = {
    "squat": "squat",
    "pushup": "push_up",
    "pullup": "pull_up",
    "situp": "ab_crunch",
    "tennis_forehand": "tennis_stroke",
    "tennis_serve": "tennis_serve",
}
OTHER_LABEL = "other"
OTHER_CAP_TOTAL = 250  # capped, not exhaustive -- see plan: avoids the negative
# class dwarfing the 6 positive ones and blowing up GPU runtime for no
# accuracy benefit.
RANDOM_SEED = 0
# Below any real complete download (~3.2GB) -- just used to tell "clearly
# partial/corrupt" apart from "looks complete" without hardcoding the exact
# byte count (which could legitimately shift with dataset updates).
MIN_COMPLETE_TARBALL_BYTES = 3_000_000_000


def download() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if FRAMES_DIR.exists() and LABELS_DIR.exists():
        print(f"[download] {FRAMES_DIR} and {LABELS_DIR} already exist, skipping download+extract")
        return

    if not TARBALL_PATH.exists() or TARBALL_PATH.stat().st_size < MIN_COMPLETE_TARBALL_BYTES:
        print(f"[download] fetching {TARBALL_URL} -> {TARBALL_PATH} (~3.2GB, resumable)")
        # -C - resumes a partial download; the server confirmed Accept-Ranges: bytes.
        subprocess.run(
            ["curl", "-L", "-C", "-", "-o", str(TARBALL_PATH), TARBALL_URL],
            check=True,
        )
    else:
        print(f"[download] {TARBALL_PATH} already fully downloaded, skipping fetch")

    print(f"[download] extracting {TARBALL_PATH} -> {DATA_DIR}")
    subprocess.run(["tar", "-xzf", str(TARBALL_PATH), "-C", str(DATA_DIR)], check=True)


def _mat_str(value) -> str:
    return str(np.asarray(value).squeeze())


def build_manifest() -> None:
    mat_files = sorted(LABELS_DIR.glob("*.mat"))
    if not mat_files:
        print(f"[manifest] no .mat files found under {LABELS_DIR} -- did download() run?", file=sys.stderr)
        sys.exit(1)

    by_action: dict[str, list[dict]] = {}
    for mat_path in mat_files:
        seq_id = mat_path.stem
        frame_dir = FRAMES_DIR / seq_id
        if not frame_dir.is_dir():
            continue
        mat = loadmat(str(mat_path))
        action = _mat_str(mat["action"])
        nframes = int(np.asarray(mat["nframes"]).squeeze())
        by_action.setdefault(action, []).append(
            {"sequence_id": seq_id, "action": action, "nframes": nframes}
        )

    rng = random.Random(RANDOM_SEED)
    manifest = []

    for action, mapped_label in CLASS_MAP.items():
        entries = by_action.get(action, [])
        print(f"[manifest] {action} -> {mapped_label}: {len(entries)} clips")
        for e in entries:
            manifest.append({**e, "mapped_label": mapped_label})

    other_actions = [a for a in by_action if a not in CLASS_MAP]
    per_action_cap = max(1, OTHER_CAP_TOTAL // max(1, len(other_actions)))
    other_count = 0
    for action in other_actions:
        entries = by_action[action]
        sample = entries if len(entries) <= per_action_cap else rng.sample(entries, per_action_cap)
        for e in sample:
            manifest.append({**e, "mapped_label": OTHER_LABEL})
        other_count += len(sample)
    print(f"[manifest] other (capped, {len(other_actions)} source actions): {other_count} clips")

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2))
    print(f"[manifest] wrote {len(manifest)} entries -> {MANIFEST_PATH}")


def main() -> None:
    download()
    build_manifest()


if __name__ == "__main__":
    main()
