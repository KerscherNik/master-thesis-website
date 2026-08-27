#!/usr/bin/env python3
"""Render a training-progress video: one fixed held-out view per checkpoint.

Given a model directory with several point_cloud/iteration_* subdirectories
(train with --save_iterations 500 1000 ... 30000), renders the chosen test
view at every checkpoint, overlays the iteration number and Gaussian count,
holds each checkpoint for --hold seconds, and assembles an H.264 mp4.

The camera comes from cameras.json: test views are recovered the same way
dataset_readers.py builds the eval split (cameras sorted by image name, every
8th held out), so --test_view uses the same indices as the files in
test/ours_30000/renders (e.g. flowers 21, bicycle 12).

GPU usage:
  python render_progress.py -m <model_dir> --test_view 21 --out progress.mp4 \
      --codebase /export/scratch/ra28kuc/worktrees/sad-fixprune

Dry run (CPU, no torch): checks checkpoints, view lookup, and overlay text.
"""
from __future__ import annotations

import argparse
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import campath

DEFAULT_CODEBASE = "/export/home/ra28kuc/projects/gaussian-splatting-sad-v1"

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
]


def list_checkpoints(model_path: Path) -> list[int]:
    pc = model_path / "point_cloud"
    iters = sorted(int(p.name.split("_")[1]) for p in pc.glob("iteration_*")
                   if (p / "point_cloud.ply").exists())
    if not iters:
        raise FileNotFoundError(f"no point_cloud/iteration_*/point_cloud.ply under {model_path}")
    return iters


def pick_view(cams: list[dict], test_view: int) -> dict:
    names = campath.test_view_names(cams)
    if not 0 <= test_view < len(names):
        raise IndexError(f"--test_view {test_view} out of range (0..{len(names) - 1})")
    want = names[test_view]
    for c in cams:
        if Path(c["img_name"]).stem == want:
            return c
    raise KeyError(f"test view {want!r} not found in cameras.json")


def load_font(size: int):
    from PIL import ImageFont
    for cand in FONT_CANDIDATES:
        if Path(cand).exists():
            return ImageFont.truetype(cand, size)
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # older Pillow
        return ImageFont.load_default()


def overlay(img, text: str):
    """Burn the counter into the frame, bottom left, dark backing box."""
    from PIL import ImageDraw
    draw = ImageDraw.Draw(img, "RGBA")
    size = max(16, img.height // 24)
    font = load_font(size)
    pad = size // 2
    x, y = pad, img.height - size - 2 * pad
    box = draw.textbbox((x + pad, y + pad // 2), text, font=font)
    draw.rectangle((box[0] - pad, box[1] - pad // 2, box[2] + pad, box[3] + pad // 2),
                   fill=(12, 14, 18, 190))
    draw.text((x + pad, y + pad // 2), text, font=font, fill=(255, 255, 255, 255))
    return img


def ffmpeg_assemble(frames_dir: Path, out: Path, fps: int) -> None:
    ffmpeg_bin = os.environ.get(
        "FFMPEG_BIN", "/export/home/ra28kuc/miniconda3-new/envs/fdsgs/bin/ffmpeg")
    if not Path(ffmpeg_bin).exists():
        ffmpeg_bin = shutil.which("ffmpeg") or ffmpeg_bin
    cmd = [ffmpeg_bin, "-y", "-framerate", str(fps), "-i", str(frames_dir / "%05d.png"),
           "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
           "-movflags", "+faststart", str(out)]
    if not Path(ffmpeg_bin).exists() and shutil.which(ffmpeg_bin) is None:
        readme = frames_dir / "README_ffmpeg.txt"
        readme.write_text("ffmpeg was not on PATH. Assemble the video with:\n\n"
                          + " ".join(cmd) + "\n")
        print(f"[warn] ffmpeg not found; frames kept, command written to {readme}")
        return
    subprocess.run(cmd, check=True)
    print(f"[ok] wrote {out}")


def dry_run(args) -> None:
    model_path = Path(args.model_path)
    iters = list_checkpoints(model_path)
    cams = campath.load_cameras_json(model_path)
    cfg = campath.load_cfg_args(model_path)
    cam = pick_view(cams, args.test_view)
    W, H = campath.render_size(cams, cfg, args.width)
    fovx, fovy = campath.fov_from_cams(cams, W, H)
    print(f"[dry] checkpoints: {iters}")
    print(f"[dry] view {args.test_view} -> {cam['img_name']}, render {W}x{H}, "
          f"fovx {math.degrees(fovx):.2f} deg")
    rot = np.array(cam["rotation"])
    print(f"[dry] rotation orthonormality err {np.abs(rot.T @ rot - np.eye(3)).max():.2e}")
    from PIL import Image
    im = Image.new("RGB", (W, H), (40, 40, 40))
    overlay(im, "iteration 30,000   -   3,399,957 Gaussians")
    print("[dry] overlay ok")


def render(args) -> None:
    sys.path.insert(0, args.codebase)
    import torch
    from PIL import Image
    from gaussian_renderer import render as gs_render
    from scene.cameras import MiniCam
    from scene.gaussian_model import GaussianModel
    from utils.graphics_utils import getProjectionMatrix

    model_path = Path(args.model_path)
    cfg = campath.load_cfg_args(model_path)
    iters = list_checkpoints(model_path)
    cams = campath.load_cameras_json(model_path)
    cam_json = pick_view(cams, args.test_view)
    W, H = campath.render_size(cams, cfg, args.width)
    fovx, fovy = campath.fov_from_cams(cams, W, H)
    print(f"[info] {len(iters)} checkpoints {iters[0]}..{iters[-1]}, "
          f"view {cam_json['img_name']}, {W}x{H}")

    rot = np.array(cam_json["rotation"], dtype=np.float64)  # C2W
    eye = np.array(cam_json["position"], dtype=np.float64)
    znear, zfar = 0.01, 100.0
    w2c = campath.w2c_from_c2w(rot, eye)
    world_view = torch.tensor(w2c, device="cuda").transpose(0, 1)
    proj = getProjectionMatrix(znear=znear, zfar=zfar, fovX=fovx, fovY=fovy).transpose(0, 1).cuda()
    full_proj = (world_view.unsqueeze(0).bmm(proj.unsqueeze(0))).squeeze(0)
    cam = MiniCam(W, H, fovy, fovx, znear, zfar, world_view, full_proj)

    pipe = argparse.Namespace(convert_SHs_python=False, compute_cov3D_python=False,
                              debug=False, antialiasing=getattr(cfg, "antialiasing", False))
    white = bool(getattr(cfg, "white_background", False))
    background = torch.tensor([1.0, 1.0, 1.0] if white else [0.0, 0.0, 0.0], device="cuda")

    out = Path(args.out) if args.out else model_path / "progress.mp4"
    frames_dir = Path(args.frames_dir) if args.frames_dir else out.parent / (out.stem + "_frames")
    frames_dir.mkdir(parents=True, exist_ok=True)

    hold = max(1, round(args.hold * args.fps))
    frame_idx = 0
    for it in iters:
        ply = model_path / "point_cloud" / f"iteration_{it}" / "point_cloud.ply"
        gaussians = GaussianModel(getattr(cfg, "sh_degree", 3))
        gaussians.load_ply(str(ply))
        gaussians.active_sh_degree = gaussians.max_sh_degree
        n = gaussians.get_xyz.shape[0]
        with torch.no_grad():
            img = gs_render(cam, gaussians, pipe, background)["render"].clamp(0.0, 1.0)
        arr = np.rint(img.permute(1, 2, 0).cpu().numpy() * 255).astype(np.uint8)
        frame = overlay(Image.fromarray(arr), f"iteration {it:>6,}   -   {n:,} Gaussians")
        # hold each checkpoint; hold the final one three times as long
        reps = hold * (3 if it == iters[-1] else 1)
        for _ in range(reps):
            frame.save(frames_dir / f"{frame_idx:05d}.png")
            frame_idx += 1
        del gaussians
        torch.cuda.empty_cache()
        print(f"[info] iteration {it}: {n:,} Gaussians")

    ffmpeg_assemble(frames_dir, out, args.fps)
    if not args.keep_frames and shutil.which("ffmpeg") is not None and out.exists():
        shutil.rmtree(frames_dir)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("-m", "--model_path", required=True)
    p.add_argument("--test_view", type=int, default=0, help="index into the eval split (matches test/ours_*/renders numbering)")
    p.add_argument("--codebase", default=DEFAULT_CODEBASE)
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--hold", type=float, default=0.7, help="seconds each checkpoint is held")
    p.add_argument("--width", type=int, default=None)
    p.add_argument("--out", default=None)
    p.add_argument("--frames_dir", default=None)
    p.add_argument("--keep_frames", action="store_true")
    p.add_argument("--dry_run", action="store_true")
    args = p.parse_args()

    if args.dry_run:
        dry_run(args)
    else:
        render(args)


if __name__ == "__main__":
    main()
