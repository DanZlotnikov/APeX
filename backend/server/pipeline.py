"""
Two-panel video processing pipeline for the APeX pose server.

Reuses GENMO's existing pipeline building blocks (model loading,
preprocessing, GEM inference, exercise counting, biomechanical analysis,
skeleton rendering) via backend/GENMO/scripts/worker.py — this file only
adds the server-specific final rendering step: a side-by-side video with
the original clip (cropped to the athlete's full range of motion, no
overlay, bounded to a sane on-screen aspect ratio — see MAX_PANEL_ASPECT)
on the left, and the skeleton+counter render on the right.

Importing `worker` (below) has a side effect worth knowing about: it chdir's
the process into backend/GENMO/ and adds backend/GENMO/scripts/demo/ to
sys.path, because that's what worker.py itself needs to run and every path
downstream (checkpoints, inputs/, outputs/) is relative to that. This module
inherits that same working directory, which is why OUTPUT_ROOT below is
computed from `__file__` rather than a relative path.
"""
from __future__ import annotations

import sys
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parent
GENMO_SCRIPTS = SERVER_ROOT.parent / "GENMO" / "scripts"
sys.path.insert(0, str(GENMO_SCRIPTS))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import worker  # noqa: E402
from exercises import stabilize_grip_point  # noqa: E402
from skeleton_renderer import render_message_frames, render_skeleton_frames  # noqa: E402

PERSON_NOT_DETECTED_MSG = "PERSON NOT DETECTED"
NO_EXERCISE_DETECTED_MSG = "NO EXERCISE DETECTED"

PANEL_HEIGHT = 720
CROP_PAD_FRAC = 0.18  # padding around the athlete's full range-of-motion bbox
# Each panel's own width:height is capped at this ratio (e.g. 0.6 = a panel
# is never wider than 60% of its own height). Two panels side by side means
# the combined video's width is naturally double a single panel's — for a
# person recorded portrait (phone-camera default, the app's primary case),
# an unconstrained crop can come out close to the *source* clip's own
# aspect, which for a full-ROM exercise (arms swinging, a wide stance, ...)
# can end up nearly square or even landscape per panel. Doubled side by
# side, that becomes a noticeably wide, short composite that reads poorly
# in a portrait phone card (see mobile's VideoPlayer.fitContainer, which
# sizes the card to whatever aspect ratio the video itself has — it can't
# fix an awkwardly-shaped source video, it just faithfully reproduces it).
# This caps how far a natural crop's own shape is allowed to push the
# output — see clamp_box_aspect below, applied by tightening the crop
# HORIZONTALLY (never vertically, since vertical range is usually the
# athlete's actual rep motion, e.g. squat depth — cropping that would cut
# off the movement itself). 0.6 keeps the combined two-panel composite at
# or below ~1.2:1 (near-square, leaning landscape) — a bounded, predictable
# shape regardless of the source clip, prioritizing "fits the screen"
# (a hard guarantee) over a maximally tight per-panel crop (best-effort,
# only overridden when the natural crop would otherwise exceed this).
MAX_PANEL_ASPECT = 0.6


def compute_union_crop_box(bbx_xys, W: int, H: int, pad_frac: float = CROP_PAD_FRAC) -> tuple[int, int, int, int]:
    """Fixed crop rectangle covering the athlete's bounding box across every
    frame of the clip, padded, clamped to the frame bounds.

    Deliberately a single FIXED box, not a per-frame crop — the point is to
    show the athlete's complete range of motion without the crop panning or
    jittering as they move, which would be distracting and would make the
    left panel harder to visually compare against the skeleton panel (which
    is also framed once for the whole clip, not per-frame).
    """
    xys = bbx_xys.numpy() if hasattr(bbx_xys, "numpy") else np.asarray(bbx_xys)
    cx, cy, s = xys[:, 0], xys[:, 1], xys[:, 2]
    x0 = float((cx - s / 2).min())
    x1 = float((cx + s / 2).max())
    y0 = float((cy - s / 2).min())
    y1 = float((cy + s / 2).max())
    w, h = x1 - x0, y1 - y0
    x0 -= w * pad_frac
    x1 += w * pad_frac
    y0 -= h * pad_frac
    y1 += h * pad_frac
    x0 = max(0, int(x0))
    y0 = max(0, int(y0))
    x1 = min(W, int(x1))
    y1 = min(H, int(y1))
    return x0, y0, x1, y1


def clamp_box_aspect(box: tuple[int, int, int, int], max_aspect: float = MAX_PANEL_ASPECT) -> tuple[int, int, int, int]:
    """If `box` is wider (relative to its height) than max_aspect allows,
    tighten it horizontally around its own center until it isn't. Only ever
    NARROWS the box — never widens it and never touches its height — so
    this can only crop away more background, never include less of the
    athlete's actual (vertical) range of motion than compute_union_crop_box
    already decided was needed.
    """
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    if h <= 0 or w / h <= max_aspect:
        return box
    target_w = h * max_aspect
    cx = (x0 + x1) / 2.0
    return int(round(cx - target_w / 2)), y0, int(round(cx + target_w / 2)), y1


def crop_and_resize_original(frames: np.ndarray, box: tuple[int, int, int, int], target_h: int = PANEL_HEIGHT) -> np.ndarray:
    x0, y0, x1, y1 = box
    cropped = frames[:, y0:y1, x0:x1]
    crop_h, crop_w = cropped.shape[1], cropped.shape[2]
    target_w = max(2, round(crop_w * target_h / crop_h))
    if target_w % 2:
        target_w += 1  # save_video's libx264/yuv420p encoder requires even width & height
    out = np.empty((cropped.shape[0], target_h, target_w, 3), dtype=np.uint8)
    for i in range(cropped.shape[0]):
        out[i] = cv2.resize(cropped[i], (target_w, target_h), interpolation=cv2.INTER_AREA)
    return out


def combine_two_panel(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    """Horizontal side-by-side composite. Both panels are built at the same
    height (PANEL_HEIGHT) and, since process_video_two_panel sizes the
    skeleton panel's canvas to match the real-video panel's own width, the
    same width too — this just asserts that rather than assuming it.
    """
    assert left.shape[1] == right.shape[1], f"panel height mismatch: {left.shape[1]} vs {right.shape[1]}"
    L = min(left.shape[0], right.shape[0])
    h, lw, rw = left.shape[1], left.shape[2], right.shape[2]
    out = np.empty((L, h, lw + rw, 3), dtype=np.uint8)
    out[:, :, :lw] = left[:L]
    out[:, :, lw:] = right[:L]
    return out


def process_video_two_panel(
    models: "worker.Models", video_path: str, output_dir: Path,
    cancel_check: "worker.Callable[[], bool] | None" = None,
    sport_key: str | None = None,
) -> dict:
    """Runs the full pipeline on a local video path and writes a two-panel
    (original-cropped | skeleton+counter) video to output_dir/two_panel.mp4,
    plus the biomechanical analysis report to output_dir/analysis.json —
    the JSON is also returned inline in the response dict below, but is
    persisted to disk too so it's discoverable the same way the video is
    (e.g. for later inspection without re-running the pipeline).

    cancel_check: passed straight through to worker.run_core_pipeline — see
    its docstring. May raise worker.PipelineCancelled; not caught here,
    it's the caller's decision how to handle an aborted run.

    sport_key: passed straight through to worker.run_core_pipeline /
    analyze_exercises — the athlete's effective main sport, or None. See
    supabase_client.get_effective_sport().
    """
    import json

    from gem.utils.video_io_utils import read_video_np, save_video

    video_path = Path(video_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    preprocess_dir = output_dir / "preprocess"

    r = worker.run_core_pipeline(
        models, video_path, preprocess_dir, log_prefix="[server]", cancel_check=cancel_check, sport_key=sport_key,
    )

    # Left panel: original frames, no overlay. Normally cropped to the
    # athlete's full range of motion across the whole clip (see
    # compute_union_crop_box) — but when no person was ever detected
    # (r["person_detected"] is False), bbx_xys is a fabricated placeholder
    # box (see detect_and_track), not a real crop region, so this falls back
    # to the full, uncropped frame instead. Either way the box is bounded to
    # a sane on-screen shape (see clamp_box_aspect / MAX_PANEL_ASPECT).
    if r["person_detected"]:
        box = clamp_box_aspect(compute_union_crop_box(r["bbx_xys"], r["W"], r["H"]))
    else:
        box = clamp_box_aspect((0, 0, r["W"], r["H"]))
    orig_frames = read_video_np(str(video_path))
    left_panel = crop_and_resize_original(orig_frames, box, target_h=PANEL_HEIGHT)
    del orig_frames

    # Right panel: joints + bones + 3D grid + rep-counter HUD — UNLESS
    # there's nothing real to show it for: no person was ever detected
    # (run_core_pipeline already skipped the whole pose pipeline in that
    # case) or a person was found but no exercise was recognized
    # (timeline["key"] is None, the same "nothing counted" shape
    # run_biomechanical_analysis already uses). Rendering the animated
    # skeleton in either case would imply a real reconstruction happened
    # when it didn't — confirmed on real footage: a static, empty-floor
    # clip with no person in it produced a hallucinated skeleton and a
    # phantom rep count. A static message panel instead makes that failure
    # mode visible in the video itself rather than silently producing a
    # misleading result. Sized to match the left panel's own width exactly,
    # same as the skeleton render (see its own comment for why that
    # matters) — a hardcoded canvas_w here previously produced mismatched
    # panel sizes for any video whose crop aspect wasn't coincidentally
    # close to 960:720 (confirmed on a portrait mobile clip: the real crop
    # came out much narrower than 960, so the two panels never matched).
    panel_w = left_panel.shape[2]
    if not r["person_detected"]:
        right_panel = render_message_frames(PERSON_NOT_DETECTED_MSG, left_panel.shape[0], canvas_w=panel_w, canvas_h=PANEL_HEIGHT)
    elif r["timeline"]["key"] is None:
        right_panel = render_message_frames(NO_EXERCISE_DETECTED_MSG, left_panel.shape[0], canvas_w=panel_w, canvas_h=PANEL_HEIGHT)
    else:
        # Grip-stabilize pull-ups so the body visibly rises to fixed hands
        # instead of the hands appearing to move — see stabilize_grip_point's
        # docstring for why.
        render_joints = r["joints_np"]
        if r["timeline"]["key"] == "pull_up":
            render_joints = stabilize_grip_point(r["joints_np"])
        right_panel = render_skeleton_frames(
            render_joints, r["timeline"]["key"], r["timeline"]["cumulative"],
            canvas_w=panel_w, canvas_h=PANEL_HEIGHT,
        )

    combined = combine_two_panel(left_panel, right_panel)
    output_path = output_dir / "two_panel.mp4"
    save_video(combined, str(output_path), fps=30)

    analysis_path = output_dir / "analysis.json"
    analysis_path.write_text(json.dumps(r["analysis"], indent=2))

    return {
        "output_path": str(output_path),
        "analysis_path": str(analysis_path),
        "counts": r["counts"],
        "active_exercise": r["timeline"]["key"],
        "analysis": r["analysis"],
        "frames": r["L"],
        "person_detected": r["person_detected"],
        "timing_s": {
            "preproc": round(r["t_preproc"], 1),
            "inference": round(r["t_inference"], 1),
            "exercise_analysis": round(r["t_exercise"], 1),
        },
    }
