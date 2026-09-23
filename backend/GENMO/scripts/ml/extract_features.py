# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
The resumable GPU pass: runs every Penn Action clip in manifest.json through
the exact same production pipeline (worker.run_core_pipeline) used on real
athlete uploads, and caches the resulting (L, 22, 3) SMPL joint sequence.
This is what makes the classifier's training features live in the same
space as its inference-time input -- see the plan's "Key design decision".

Usage (from backend/GENMO, WSL venv):
    python scripts/ml/extract_features.py

Resumability is the whole point (this is a multi-hour run expected to be
interrupted and restarted): every already-cached or already-skipped
sequence_id is looked up on startup and excluded from the work list before
any model loads or GPU work happens, so re-running this command after a
Ctrl-C (or a killed terminal) picks up exactly where it left off and never
redoes finished work. Progress is written to disk after every single clip,
not batched, so at most one in-flight clip is ever lost.
"""
from __future__ import annotations

import csv
import json
import shutil
import sys
import time
from pathlib import Path

import numpy as np

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

import worker  # noqa: E402  -- side effect: chdir's into backend/GENMO, see worker.py docstring

from gem.utils.video_io_utils import read_images_np, save_video  # noqa: E402

REPO_ROOT = SCRIPTS_DIR.parent
DATA_DIR = REPO_ROOT / "inputs" / "pennaction"
# See download_pennaction.py's FRAMES_DIR comment -- the tarball's own
# top-level entry is "Penn_Action/", not "frames" directly.
FRAMES_DIR = DATA_DIR / "Penn_Action" / "frames"
MANIFEST_PATH = DATA_DIR / "manifest.json"

CACHE_DIR = REPO_ROOT / "inputs" / "ml_cache"
JOINTS_DIR = CACHE_DIR / "joints"
LABELS_CSV = CACHE_DIR / "labels.csv"
SKIPPED_CSV = CACHE_DIR / "skipped.csv"
SCRATCH_DIR = CACHE_DIR / "scratch"


def _append_csv_row(path: Path, header: list[str], row: list[str]) -> None:
    is_new = not path.exists()
    with open(path, "a", newline="") as f:
        writer = csv.writer(f)
        if is_new:
            writer.writerow(header)
        writer.writerow(row)


def _append_label(sequence_id: str, mapped_label: str) -> None:
    _append_csv_row(LABELS_CSV, ["sequence_id", "mapped_label"], [sequence_id, mapped_label])


def _append_skip(sequence_id: str, reason: str) -> None:
    _append_csv_row(SKIPPED_CSV, ["sequence_id", "reason"], [sequence_id, reason])


def _already_skipped_ids() -> set[str]:
    if not SKIPPED_CSV.exists():
        return set()
    with open(SKIPPED_CSV, newline="") as f:
        return {row["sequence_id"] for row in csv.DictReader(f)}


def _process_one(models: "worker.Models", entry: dict) -> None:
    seq_id = entry["sequence_id"]
    frame_paths = sorted((FRAMES_DIR / seq_id).glob("*.jpg"))
    if not frame_paths:
        _append_skip(seq_id, "no frame images found")
        return

    scratch = SCRATCH_DIR / seq_id
    scratch.mkdir(parents=True, exist_ok=True)
    try:
        images = read_images_np(frame_paths)
        tmp_video = scratch / "clip.mp4"
        save_video(images, str(tmp_video), fps=30)
        del images

        r = worker.run_core_pipeline(
            models, tmp_video, scratch / "preprocess", log_prefix=f"[extract:{seq_id}]",
        )
        if not r["person_detected"]:
            _append_skip(seq_id, "no person detected")
            return

        np.save(JOINTS_DIR / f"{seq_id}.npy", r["joints_np"])
        _append_label(seq_id, entry["mapped_label"])
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def main() -> None:
    if not MANIFEST_PATH.exists():
        print(f"[extract] {MANIFEST_PATH} not found -- run download_pennaction.py first", file=sys.stderr)
        sys.exit(1)

    manifest = json.loads(MANIFEST_PATH.read_text())
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    JOINTS_DIR.mkdir(parents=True, exist_ok=True)
    SCRATCH_DIR.mkdir(parents=True, exist_ok=True)

    cached_ids = {p.stem for p in JOINTS_DIR.glob("*.npy")}
    skipped_ids = _already_skipped_ids()
    todo = [e for e in manifest if e["sequence_id"] not in cached_ids and e["sequence_id"] not in skipped_ids]
    print(f"[extract] {len(cached_ids)} cached, {len(skipped_ids)} previously skipped, "
          f"{len(todo)} remaining of {len(manifest)} total")
    if not todo:
        print("[extract] nothing left to do")
        return

    models = worker.load_all_models()
    t_start = time.time()
    for i, entry in enumerate(todo):
        try:
            _process_one(models, entry)
        except Exception as e:  # noqa: BLE001 -- one bad clip must never kill a multi-hour run
            print(f"[extract] FAILED on {entry['sequence_id']}: {e}")
            _append_skip(entry["sequence_id"], f"error: {e}")

        elapsed = time.time() - t_start
        rate = elapsed / (i + 1)
        eta_min = rate * (len(todo) - i - 1) / 60
        print(f"[extract] {i + 1}/{len(todo)} done -- {elapsed / 60:.1f}m elapsed, ETA {eta_min:.1f}m")

    shutil.rmtree(SCRATCH_DIR, ignore_errors=True)


if __name__ == "__main__":
    main()
