# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
import os
import shutil
from pathlib import Path

import cv2
import ffmpeg
import imageio.v3 as iio
import numpy as np
import torch
from tqdm import tqdm


def get_rotation_degrees(video_path) -> int:
    """Rotation baked into the container's display matrix — what a phone
    writes for a portrait recording. The pixel data itself stays encoded in
    landscape; this is a flag telling a compliant player to rotate it for
    display. PyAV parses it, but neither PyAV nor imageio's pyav plugin
    apply it automatically when decoding a frame — confirmed directly: a
    clip tagged with a 90-degree display matrix decodes via
    iio.imread()/iio.improps() at its raw *encoded* 1920x1080, not the
    intended 1080x1920, reproducing a real production bug (an iPhone
    portrait squat/deadlift recording came out sideways, and the
    orientation classifier in exercises/orientation.py read the now
    90-degrees-off body as horizontal instead of standing, misclassifying
    it as a push-up). Every frame this pipeline reads has to be corrected
    for this explicitly — see rotate_frames() below, and its two callers.

    Returns one of 0/90/180/270 (PyAV's angle, rounded to the nearest
    multiple of 90 and normalized into that range) — 0 if there's no
    rotation signaled at all, the overwhelmingly common case for
    non-phone-recorded footage (all of this pipeline's original GENMO
    sample clips, for instance).

    The value PyAV returns from DISPLAYMATRIX side data is, per ffmpeg's
    own av_display_rotation_get documentation, "the angle by which the
    transformation rotates the frame counterclockwise" — i.e. it *is* the
    counterclockwise correction to apply directly, not something to negate
    first. rotate_frames() converts that into the equivalent clockwise
    cv2.rotate() call.

    Verified against a real iPhone recording (the DISPLAYMATRIX mechanism —
    part of the MP4/MOV container standard, not an Apple-specific one;
    Android's MediaRecorder.setOrientationHint() writes the same kind of
    matrix). NOT verified against a real Android recording — there's a
    reported (if disputed/possibly-outdated) expo-camera-on-Android issue
    where no rotation metadata gets written into the file at all, which
    would make this function correctly return 0 (nothing to read) while
    the video is genuinely sideways — that's a client-side upload gap this
    function can't detect or fix, not a bug in the detection logic itself.
    The plain `rotate` stream tag below is a secondary, older mechanism
    some non-Apple encoders use instead of a real display matrix — checked
    as a fallback so this isn't narrowly tuned to only what iPhone does.
    """
    import av

    container = av.open(str(video_path))
    try:
        stream = container.streams.video[0]
        angle = stream.side_data.get("DISPLAYMATRIX") if stream.side_data else None
        if angle is None:
            rotate_tag = stream.metadata.get("rotate") if stream.metadata else None
            # The plain `rotate` tag follows the opposite sign convention
            # from DISPLAYMATRIX: its value is the CLOCKWISE correction
            # needed (rotate=90 means "rotate 90 deg clockwise to view
            # correctly"), not counterclockwise — negated here so it's
            # consistent with `angle`'s counterclockwise convention used
            # everywhere below.
            angle = -float(rotate_tag) if rotate_tag is not None else None
    finally:
        container.close()
    if angle is None:
        return 0
    return int(round(angle / 90.0)) * 90 % 360


_CW_ROTATION = {
    90: cv2.ROTATE_90_COUNTERCLOCKWISE,  # 90 deg CCW correction == 270 deg CW == cv2's CCW constant
    180: cv2.ROTATE_180,
    270: cv2.ROTATE_90_CLOCKWISE,  # 270 deg CCW correction == 90 deg CW
}


def rotate_frames(frames: np.ndarray, rotation_degrees: int) -> np.ndarray:
    """Applies the correction for get_rotation_degrees()'s value to a
    (L, H, W, C) frame stack (or a single (H, W, C) frame) — see that
    function's docstring for the sign convention. No-op (returns frames
    unchanged) for the overwhelmingly common rotation_degrees == 0 case.
    """
    if rotation_degrees == 0:
        return frames
    cv2_code = _CW_ROTATION[rotation_degrees]
    if frames.ndim == 3:
        return cv2.rotate(frames, cv2_code)
    return np.stack([cv2.rotate(f, cv2_code) for f in frames], axis=0)


def get_video_lwh(video_path):
    L, H, W, _ = iio.improps(video_path, plugin="pyav").shape
    if L == 0:
        # Some containers don't declare an exact frame count in their stream
        # metadata (improps then reports 0) even though the video decodes
        # fine — confirmed on a real clip where this silently propagated a
        # wrong L=0 downstream while every other stage kept working off the
        # real (343) decoded frame count, causing a shape-mismatch crash
        # much later in model inference with no clue at that point what
        # actually went wrong. Recover the true count by actually decoding.
        L = len(iio.imread(video_path, plugin="pyav"))
    if get_rotation_degrees(video_path) in (90, 270):
        # A 90/270-degree rotation swaps which encoded axis ends up as the
        # displayed width vs. height (see get_rotation_degrees) — W/H here
        # must match the corrected frames read_video_np() actually returns,
        # not the raw encoded dimensions, since every downstream consumer
        # (camera intrinsics, crop boxes, ...) works in the corrected frame.
        W, H = H, W
    return L, W, H


def read_video_np(video_path, start_frame=0, end_frame=-1, scale=1.0):
    """
    Args:
        video_path: str
    Returns:
        frames: np.array, (N, H, W, 3) RGB, uint8
    """
    # If video path not exists, an error will be raised by ffmpegs
    filter_args = []
    should_check_length = False

    # 1. Trim
    if not (start_frame == 0 and end_frame == -1):
        if end_frame == -1:
            filter_args.append(("trim", f"start_frame={start_frame}"))
        else:
            should_check_length = True
            filter_args.append(("trim", f"start_frame={start_frame}:end_frame={end_frame}"))

    # 2. Scale
    if scale != 1.0:
        filter_args.append(("scale", f"iw*{scale}:ih*{scale}"))

    # Excute then check
    frames = iio.imread(video_path, plugin="pyav", filter_sequence=filter_args)
    if should_check_length:
        assert len(frames) == end_frame - start_frame

    return rotate_frames(frames, get_rotation_degrees(video_path))


def get_video_reader(video_path):
    return iio.imiter(video_path, plugin="pyav")


def read_images_np(image_paths, verbose=False):
    """
    Args:
        image_paths: list of str
    Returns:
        images: np.array, (N, H, W, 3) RGB, uint8
    """
    if verbose:
        images = [cv2.imread(str(img_path))[..., ::-1] for img_path in tqdm(image_paths)]
    else:
        images = [cv2.imread(str(img_path))[..., ::-1] for img_path in image_paths]
    images = np.stack(images, axis=0)
    return images


def save_video(images, video_path, fps=30, crf=17):
    """
    Args:
        images: (N, H, W, 3) RGB, uint8
        crf: 17 is visually lossless, 23 is default, +6 results in half the bitrate
    0 is lossless, https://trac.ffmpeg.org/wiki/Encode/H.264#crf
    """
    if isinstance(images, torch.Tensor):
        images = images.cpu().numpy().astype(np.uint8)
    elif isinstance(images, list):
        images = np.array(images).astype(np.uint8)

    with iio.imopen(video_path, "w", plugin="pyav") as writer:
        writer.init_video_stream("libx264", fps=fps)
        writer._video_stream.options = {"crf": str(crf)}
        writer.write(images)


def get_writer(video_path, fps=30, crf=17):
    """remember to .close()"""
    writer = iio.imopen(video_path, "w", plugin="pyav")
    writer.init_video_stream("libx264", fps=fps)
    writer._video_stream.options = {"crf": str(crf)}
    return writer


def copy_file(video_path, out_video_path, overwrite=True):
    if not overwrite and Path(out_video_path).exists():
        return
    shutil.copy(video_path, out_video_path)


def concat_videos(cfg, out_video_path: str, in_video_paths=None):
    # if len(in_video_paths) < 2:
    #     raise ValueError("At least two video paths are required for merging.")
    # in_video_paths = [cfg.video1_path, cfg.text1_video_path, cfg.video2_path]
    if in_video_paths is None:
        in_video_paths = [
            cfg.paths.incam_video1,
            cfg.text1_video_path,
            cfg.paths.incam_video2,
        ]

    # Get the size of the first video to use as target size
    probe = ffmpeg.probe(in_video_paths[0])
    video_stream = next(
        (stream for stream in probe["streams"] if stream["codec_type"] == "video"), None
    )
    target_size = (int(video_stream["width"]), int(video_stream["height"]))

    # Resize and pad all videos to match the target size
    temp_paths = [resize_and_pad_video(path, target_size) for path in in_video_paths]

    try:
        # Create inputs from the resized videos
        inputs = [ffmpeg.input(path) for path in temp_paths]
        merged_video = ffmpeg.concat(*inputs)
        output = ffmpeg.output(merged_video, out_video_path)
        ffmpeg.run(output, overwrite_output=True, quiet=True)
    finally:
        # Clean up temporary files
        for path in temp_paths:
            if os.path.exists(path):
                os.unlink(path)


def resize_and_pad_video(video_path, target_size):
    """
    Resize and pad a video to match the target size.

    Args:
        video_path: Path to the input video
        target_size: Tuple of (width, height) for the target size

    Returns:
        Path to the resized and padded temporary video
    """
    import tempfile

    target_width, target_height = target_size

    # Create a temporary file for the resized video
    temp_file = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    temp_path = temp_file.name
    temp_file.close()

    # Get video info
    probe = ffmpeg.probe(video_path)
    video_stream = next(
        (stream for stream in probe["streams"] if stream["codec_type"] == "video"), None
    )
    width = int(video_stream["width"])
    height = int(video_stream["height"])

    # Calculate scaling to maintain aspect ratio
    if width / height > target_width / target_height:
        # Width is the limiting factor
        scale_w = target_width
        scale_h = -1  # Maintain aspect ratio
    else:
        # Height is the limiting factor
        scale_w = -1  # Maintain aspect ratio
        scale_h = target_height

    # Resize and pad
    stream = ffmpeg.input(video_path)
    stream = ffmpeg.filter(stream, "scale", scale_w, scale_h)
    stream = ffmpeg.filter(stream, "pad", target_width, target_height, "(ow-iw)/2", "(oh-ih)/2")
    stream = ffmpeg.output(stream, temp_path)
    ffmpeg.run(stream, quiet=True, overwrite_output=True)

    return temp_path


def merge_videos_horizontal(in_video_paths: list, out_video_path: str):
    if len(in_video_paths) < 2:
        raise ValueError("At least two video paths are required for merging.")
    inputs = [ffmpeg.input(path) for path in in_video_paths]
    merged_video = ffmpeg.filter(inputs, "hstack", inputs=len(inputs))
    output = ffmpeg.output(merged_video, out_video_path)
    ffmpeg.run(output, overwrite_output=True, quiet=True)


def merge_videos_vertical(in_video_paths: list, out_video_path: str):
    if len(in_video_paths) < 2:
        raise ValueError("At least two video paths are required for merging.")
    inputs = [ffmpeg.input(path) for path in in_video_paths]
    merged_video = ffmpeg.filter(inputs, "vstack", inputs=len(inputs))
    output = ffmpeg.output(merged_video, out_video_path)
    ffmpeg.run(output, overwrite_output=True, quiet=True)
