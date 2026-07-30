# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Persistent GEM worker.

The one-shot demo scripts (demo_smpl_hpe.py) rebuild the entire model
architecture from scratch on every invocation, which alone costs ~130s
(see profiling notes) before any actual video processing happens. This
worker pays that cost exactly once at startup, then processes an
arbitrary number of videos from a folder-based queue, each one paying
only its own preprocessing (YOLO/ViTPose/HMR2, ~0.5s/frame) + inference
(~10s) cost.

Usage (from backend/GENMO, with the venv active):
    python scripts/worker.py

Drop video files into inputs/queue/. Each is picked up, processed with
a static camera assumption (correct for phone-recorded exercise clips),
and the result (0_kp2d_overlay.mp4 + smpl_params.pt + 1_skeleton_counter.mp4)
is written to outputs/demo_smpl/<video_stem>/. Processed videos are moved to
inputs/queue/done/ so they aren't reprocessed.

`load_all_models()` and `run_core_pipeline()` are also imported directly by
backend/server/pipeline.py, which needs the same model loading and
preprocessing/inference/exercise-analysis steps but does its own final
rendering (a cropped two-panel video instead of this file's separate
kp2d-overlay + skeleton-counter outputs).
"""
from __future__ import annotations

import os
import shutil
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts" / "demo"))
os.chdir(REPO_ROOT)  # every relative "inputs/..." / "outputs/..." path assumes this cwd

import numpy as np  # noqa: E402
import torch  # noqa: E402

from demo_smpl_hpe import assemble_data, render_2d_keypoints  # noqa: E402
from demo_utils import (  # noqa: E402
    CocoPoseExtractor,
    detect_and_track,
    get_camera_static,
    get_image_features,
    load_model,
    run_inference,
)
from biomechanics import run_biomechanical_analysis  # noqa: E402
from exercises import EXERCISE_REGISTRY, analyze_exercises, compute_rep_timeline, stabilize_grip_point  # noqa: E402
from skeleton_renderer import render_skeleton_frames  # noqa: E402
from smoothing import smooth_keypoints_zero_phase  # noqa: E402

QUEUE_DIR = REPO_ROOT / "inputs" / "queue"
DONE_DIR = QUEUE_DIR / "done"
OUTPUT_ROOT = REPO_ROOT / "outputs" / "demo_smpl"
HMR2_CKPT = str(REPO_ROOT / "inputs" / "checkpoints" / "hmr2" / "epoch=10-step=25000.ckpt")
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".m4v"}
POLL_SECONDS = 2.0


class PipelineCancelled(Exception):
    """Raised by run_core_pipeline when the caller-supplied `cancel_check`
    callback returns True partway through — lets a caller (e.g.
    supabase_worker.py) distinguish "asked to stop" from a real processing
    failure, without this file needing to know anything about what
    "cancelled" means to whoever's calling it (this module is shared by
    both the Supabase-backed worker and the local-queue/HTTP-server paths,
    neither of which this file should be coupled to).
    """


@dataclass
class Models:
    gem: object
    yolo: object
    vitpose: object
    hmr2: object
    body_model: object


def load_all_models() -> Models:
    """Load every model this pipeline needs, once. ~90s cold, mostly Python
    import overhead (see profiling notes) rather than actual weight loading.
    """
    from gem.utils.hf_utils import download_checkpoint
    from gem.utils.hmr2_extractor import HMR2FeatureExtractor
    from gem.utils.smplx_utils import make_smplx
    from ultralytics import YOLO

    ckpt_path = download_checkpoint()  # no-op network call, returns instantly if cached

    print("[pipeline] loading all models (one-time cost) ...")
    t0 = time.time()
    gem_model = load_model(ckpt_path)
    print(f"[pipeline]   GEM model ready in {time.time() - t0:.1f}s")

    t1 = time.time()
    yolo_model = YOLO("yolov8x.pt")
    print(f"[pipeline]   YOLO ready in {time.time() - t1:.1f}s")

    t1 = time.time()
    vitpose_extractor = CocoPoseExtractor(device="cuda")
    print(f"[pipeline]   ViTPose-H ready in {time.time() - t1:.1f}s")

    t1 = time.time()
    hmr2_extractor = HMR2FeatureExtractor(HMR2_CKPT, device="cuda")
    print(f"[pipeline]   HMR2 ready in {time.time() - t1:.1f}s")

    t1 = time.time()
    body_model = make_smplx("supermotion")
    body_model.cuda().eval()
    print(f"[pipeline]   SMPL-X body model ready in {time.time() - t1:.1f}s")

    print(f"[pipeline] all models ready in {time.time() - t0:.1f}s total.")
    return Models(gem=gem_model, yolo=yolo_model, vitpose=vitpose_extractor,
                  hmr2=hmr2_extractor, body_model=body_model)


def get_normalized_global_joints(body_model, bp_global):
    """SMPL forward pass on global params -> (L, 22, 3) body joints, feet on
    ground and centered at the origin. Same normalization demo_utils.py's
    normalize_global_verts() applies to mesh vertices for 2_global.mp4,
    applied here to joints instead so the skeleton renderer and the exercise
    angle math both work in the same sane, gravity-referenced frame.
    """
    from gem.utils.geo_transform import apply_T_on_points, compute_T_ayfz2ay

    with torch.no_grad():
        out = body_model(
            body_pose=bp_global["body_pose"].cuda(),
            global_orient=bp_global["global_orient"].cuda(),
            transl=bp_global["transl"].cuda(),
            betas=bp_global.get("betas", torch.zeros(bp_global["body_pose"].shape[0], 10)).cuda(),
        )
    verts = out.vertices.cpu()
    joints = out.joints.cpu()[:, :22]  # body-only joints, standard SMPL order

    offset = joints[0, 0].clone()
    offset[1] = verts[:, :, 1].min()
    joints = joints - offset
    T_ay2ayfz = compute_T_ayfz2ay(joints[[0]], inverse=True)
    joints = apply_T_on_points(joints, T_ay2ayfz)
    return joints


def get_incam_joints(body_model, bp_incam):
    """SMPL forward pass on in-camera (not world-grounded) params ->
    (L, 22, 3) joints, no floor/rotation normalization applied (unlike
    get_normalized_global_joints above) since these aren't used for
    rendering — only as an alternate signal source for exercises where the
    world-grounded reconstruction proves unreliable. See
    exercises/signals.py's flight_height_signals() for why vertical_jump
    specifically needs this: GEM's world-grounding leans on foot-ground
    contact to correct drift in its absolute translation estimate, and a
    jump has much less continuous contact for it to anchor to than a
    grounded exercise — confirmed on real footage where the world-grounded
    ankle height never returned near its own baseline even between the
    first and second rep, while the in-camera reconstruction (which never
    attempts world-frame translation at all) returned reliably to baseline
    after every single rep. This is only safe to substitute because the
    pipeline already assumes a static camera (static_cam=True) throughout.
    """
    with torch.no_grad():
        out = body_model(
            body_pose=bp_incam["body_pose"].cuda(),
            global_orient=bp_incam["global_orient"].cuda(),
            transl=bp_incam["transl"].cuda(),
            betas=bp_incam.get("betas", torch.zeros(bp_incam["body_pose"].shape[0], 10)).cuda(),
        )
    return out.joints.cpu()[:, :22]


def run_core_pipeline(
    models: Models, video_path: Path, preprocess_dir: Path,
    log_prefix: str = "[pipeline]",
    cancel_check: Callable[[], bool] | None = None,
) -> dict:
    """Stages 1-3 (preprocess, assemble, GEM inference) + exercise detection
    + biomechanical analysis — the full video -> pose -> exercise ->
    biomechanics -> reporting flow, minus the final video-creation step.
    Shared by every consumer (this file's queue worker, the HTTP server) —
    only the final rendering step differs between them.

    cancel_check: optional, called once right after preprocessing finishes
        (the natural boundary between the cheap stages — YOLO detection,
        HMR2 features — and the expensive one, GEM inference). If it
        returns True, raises PipelineCancelled instead of proceeding, so a
        caller that wants to abort mid-pipeline actually skips the costly
        part rather than paying for it and discarding the result anyway.
        This module has no idea what "cancelled" means to whoever's
        calling it (a Supabase row's cancel_requested flag, or anything
        else) — that's entirely the callback's business.

    Returns a dict: kp2d, bbx_xys, pred, joints_np, counts, timeline,
    analysis (see biomechanics.run_biomechanical_analysis), L, W, H,
    person_detected, and timing breakdown (t_preproc, t_inference, t_exercise).

    person_detected=False means YOLO never found a real person in any frame
    of this clip (see demo_utils.detect_and_track) — in that case this
    function stops right after the YOLO stage and returns early with
    placeholder values for everything downstream (kp2d, joints_np all-zero;
    counts all-zero; timeline/analysis in their normal "nothing detected"
    shape — see compute_rep_timeline/run_biomechanical_analysis's own
    empty-input behavior, mirrored here) rather than running ViTPose/HMR2/
    GEM/SMPL-X on a crop that provably has no person in it. Callers that
    care about the distinction (e.g. to render a "person not detected"
    panel instead of the usual skeleton) should check this flag; callers
    that don't will still get a well-typed, correctly-shaped result instead
    of a crash.

    Raises PipelineCancelled (see cancel_check above) if the pipeline was
    aborted after preprocessing but before inference.
    """
    from gem.utils.video_io_utils import get_rotation_degrees, get_video_lwh, read_video_np

    t0 = time.time()
    preprocess_dir.mkdir(parents=True, exist_ok=True)

    L, W, H = get_video_lwh(str(video_path))
    rotation = get_rotation_degrees(str(video_path))
    # Always logged, not just when non-zero -- the interesting failure mode
    # here isn't "rotation applied wrong", it's "device/app never wrote
    # rotation metadata at all" (confirmed happening for at least one real
    # camera library on Android), which looks IDENTICAL to "genuinely no
    # rotation needed" from inside this function. Seeing "rotation: 0" next
    # to a suspiciously sideways-looking result for a portrait recording is
    # the fastest way to tell those two cases apart later without re-deriving
    # this from scratch.
    print(f"{log_prefix} {video_path.name}: {L} frames, {W}x{H} (rotation: {rotation} deg)")

    bbx_xys, person_detected = detect_and_track(str(video_path), str(preprocess_dir), yolo_model=models.yolo)

    # get_video_lwh's frame count comes from container metadata, which can
    # disagree with how many frames pyav actually decodes for a given file
    # -- confirmed on real mobile-recorded footage: metadata said 145,
    # detect_and_track's own decode only produced 144 boxes, and blindly
    # using the metadata L for get_camera_static() below crashed model
    # inference with a tensor-size mismatch (144 vs 145) far from the real
    # cause. bbx_xys's actual length is what kp2d/data below are built
    # against, so it — not the metadata L — is the frame count used from
    # here on (same category of issue as get_video_lwh's own L==0 fallback,
    # just off-by-a-few instead of entirely missing).
    if bbx_xys.shape[0] != L:
        print(f"{log_prefix} {video_path.name}: frame count mismatch -- metadata said {L} frames, "
              f"actually decoded {bbx_xys.shape[0]}; using the decoded count")
        L = bbx_xys.shape[0]

    if not person_detected:
        # Stop here -- ViTPose/HMR2/GEM/SMPL-X would otherwise run on a
        # fabricated center-of-frame crop that provably has no person in
        # it, producing a hallucinated skeleton and phantom rep counts
        # (confirmed on real footage: a static empty-floor clip was scored
        # as "1 push-up"). Every downstream field is filled with the same
        # "nothing found" shape analyze_exercises/compute_rep_timeline/
        # run_biomechanical_analysis already use for a real clip with zero
        # detected reps, so callers that don't check person_detected still
        # get a consistent, well-typed result.
        t_preproc = time.time() - t0
        print(f"{log_prefix} {video_path.name}: no person detected, skipping pose/exercise stages ({t_preproc:.1f}s)")
        zero_counts = {key: 0 for key in EXERCISE_REGISTRY}
        return dict(
            kp2d=torch.zeros(L, 17, 3), bbx_xys=bbx_xys, pred={}, joints_np=np.zeros((L, 22, 3), dtype=np.float32),
            counts=zero_counts, timeline={"key": None, "cumulative": np.zeros(L, dtype=int)},
            analysis={"exercise": None, "rep_count": 0, "analyses": {}}, L=L, W=W, H=H,
            person_detected=False,
            t_preproc=t_preproc, t_inference=0.0, t_exercise=0.0, t0=t0,
        )

    frames = read_video_np(str(video_path))
    kp2d = models.vitpose.extract(frames, bbx_xys, batch_size=32)
    del frames

    # ViTPose runs independently per frame, so small detector noise shows up
    # as jitter even when the underlying motion is smooth. Zero-phase
    # filtering removes that without lagging behind real movement (see
    # smoothing.py for why this matters vs. a causal filter). fps=30 matches
    # the assumption baked in elsewhere in this pipeline (save_video, etc).
    kp2d = smooth_keypoints_zero_phase(kp2d, fps=30.0)

    f_imgseq, has_img_mask = get_image_features(
        str(video_path), bbx_xys, HMR2_CKPT, str(preprocess_dir), hmr2_extractor=models.hmr2
    )
    R_w2c, cam_angvel, cam_tvel, K_fullimg = get_camera_static(L, W, H)
    t_preproc = time.time() - t0
    print(f"{log_prefix} {video_path.name}: preprocessing done ({t_preproc:.1f}s)")

    if cancel_check is not None and cancel_check():
        print(f"{log_prefix} {video_path.name}: cancelled after preprocessing, skipping inference")
        raise PipelineCancelled()

    data = assemble_data(
        kp2d=kp2d, bbx_xys=bbx_xys, K_fullimg=K_fullimg, cam_angvel=cam_angvel,
        cam_tvel=cam_tvel, R_w2c=R_w2c, f_imgseq=f_imgseq, has_img_mask=has_img_mask,
        static_cam=True,
    )

    t_inf0 = time.time()
    with torch.no_grad():
        pred = run_inference(models.gem, data, static_cam=True)
    t_inference = time.time() - t_inf0
    print(f"{log_prefix} {video_path.name}: inference done ({t_inference:.1f}s)")

    t_ex0 = time.time()
    joints = get_normalized_global_joints(models.body_model, pred["body_params_global"])
    joints_np = joints.numpy()
    incam_joints_np = get_incam_joints(models.body_model, pred["body_params_incam"]).numpy()
    counts = analyze_exercises(joints_np, fps=30.0, incam_joints=incam_joints_np)
    timeline = compute_rep_timeline(joints_np, counts, fps=30.0, incam_joints=incam_joints_np)
    analysis = run_biomechanical_analysis(joints_np, timeline["key"], fps=30.0, incam_joints=incam_joints_np)
    t_exercise = time.time() - t_ex0
    print(f"{log_prefix} {video_path.name}: exercise counts = {counts}")
    if analysis["analyses"]:
        print(f"{log_prefix} {video_path.name}: biomechanics = {analysis['analyses']}")

    return dict(
        kp2d=kp2d, bbx_xys=bbx_xys, pred=pred, joints_np=joints_np,
        counts=counts, timeline=timeline, analysis=analysis, L=L, W=W, H=H,
        person_detected=True,
        t_preproc=t_preproc, t_inference=t_inference, t_exercise=t_exercise, t0=t0,
    )


def process_video(models: Models, video_path: Path) -> None:
    output_dir = OUTPUT_ROOT / video_path.stem
    preprocess_dir = output_dir / "preprocess"

    r = run_core_pipeline(models, video_path, preprocess_dir)

    save_dict = {}
    for key_group in ("body_params_incam", "body_params_global"):
        if key_group in r["pred"]:
            save_dict[key_group] = {k: v.cpu() for k, v in r["pred"][key_group].items()}
    if "K_fullimg" in r["pred"]:
        save_dict["K_fullimg"] = r["pred"]["K_fullimg"].cpu()
    torch.save(save_dict, output_dir / "smpl_params.pt")

    render_2d_keypoints(str(video_path), r["kp2d"], r["bbx_xys"], str(output_dir))

    from gem.utils.video_io_utils import save_video

    # Render off a grip-stabilized copy for pull-ups so the body visibly
    # rises to a fixed pair of hands instead of the hands appearing to move
    # while the body stays put (see stabilize_grip_point's docstring). Purely
    # a rendering choice — counts were already computed on the unmodified
    # joints and are unaffected either way.
    render_joints = r["joints_np"]
    if r["timeline"]["key"] == "pull_up":
        render_joints = stabilize_grip_point(r["joints_np"])

    skeleton_frames = render_skeleton_frames(render_joints, r["timeline"]["key"], r["timeline"]["cumulative"])
    save_video(skeleton_frames, str(output_dir / "1_skeleton_counter.mp4"), fps=30)

    t_total = time.time() - r["t0"]
    t_overhead = t_total - r["t_preproc"] - r["t_inference"] - r["t_exercise"]
    print(f"[worker] {video_path.name}: TOTAL {t_total:.1f}s "
          f"(preproc {r['t_preproc']:.1f}s + inference {r['t_inference']:.1f}s + "
          f"exercise/render {r['t_exercise']:.1f}s + overhead {t_overhead:.1f}s) -> {output_dir}")


def main() -> None:
    QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    DONE_DIR.mkdir(parents=True, exist_ok=True)

    models = load_all_models()
    print(f"[worker] Watching {QUEUE_DIR} ...")

    while True:
        videos = sorted(p for p in QUEUE_DIR.iterdir() if p.suffix.lower() in VIDEO_EXTS)
        if not videos:
            time.sleep(POLL_SECONDS)
            continue

        for video_path in videos:
            try:
                process_video(models, video_path)
            except Exception as e:  # noqa: BLE001
                print(f"[worker] FAILED on {video_path.name}: {e}")
            finally:
                shutil.move(str(video_path), str(DONE_DIR / video_path.name))


if __name__ == "__main__":
    main()
