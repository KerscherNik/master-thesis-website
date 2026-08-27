#!/usr/bin/env python3
"""Render a smooth elliptical fly-through of a trained 3DGS model.

Loads point_cloud/iteration_N/point_cloud.ply from a model directory, fits an
elliptical camera path through the training cameras (from cameras.json, no
dataset needed), renders N frames looking at the scene's focus point, and
assembles an H.264 mp4 with ffmpeg. Reuses the gaussian-splatting codebase
(GaussianModel, MiniCam, render) via --codebase.

Works for checkpoints from the SAD fork, vanilla 3DGS, and 3dgs-mcmc: all
save the same PLY layout, and cfg_args parsing tolerates extra keys.

GPU usage:
  python render_flythrough.py -m <model_dir> --out flythrough.mp4 \
      --codebase /export/scratch/ra28kuc/worktrees/sad-fixprune

Dry run (CPU, no torch, path math only):
  python render_flythrough.py -m <model_dir> --dry_run

Pass --path_from <other_model_dir> to reuse another checkpoint's cameras.json
for the path, so different methods on the same scene get identical frames.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import campath

DEFAULT_CODEBASE = "/export/home/ra28kuc/projects/gaussian-splatting-sad-v1"


def find_iteration(model_path: Path, iteration: int) -> int:
    pc = model_path / "point_cloud"
    iters = sorted(int(p.name.split("_")[1]) for p in pc.glob("iteration_*"))
    if not iters:
        raise FileNotFoundError(f"no point_cloud/iteration_* under {model_path}")
    if iteration == -1:
        return iters[-1]
    if iteration not in iters:
        raise FileNotFoundError(f"iteration_{iteration} not in {iters} under {model_path}")
    return iteration


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


def build_path(args) -> tuple[list, tuple[int, int], tuple[float, float]]:
    path_src = Path(args.path_from or args.model_path)
    cams = campath.load_cameras_json(path_src)
    cfg = campath.load_cfg_args(Path(args.model_path))
    orbit = campath.fit_orbit(cams)
    poses = campath.orbit_poses(orbit, args.frames, scale=args.ellipse_scale,
                                height_offset=args.height_offset, bob=args.bob)
    W, H = campath.render_size(cams, cfg, args.width)
    fovx, fovy = campath.fov_from_cams(cams, W, H)
    return poses, (W, H), (fovx, fovy)


def dry_run(args) -> None:
    poses, (W, H), (fovx, fovy) = build_path(args)
    errs = []
    for rot, eye in poses:
        errs.append(abs(np.linalg.det(rot) - 1.0))
        errs.append(np.abs(rot.T @ rot - np.eye(3)).max())
    m = campath.w2c_from_c2w(*poses[0])
    print(f"[dry] {len(poses)} poses, render {W}x{H}, "
          f"fovx {np.degrees(fovx):.2f} deg, fovy {np.degrees(fovy):.2f} deg")
    print(f"[dry] max rotation error {max(errs):.2e}; first W2C:\n{m}")
    if args.out:
        payload = [{"rotation_c2w": r.tolist(), "position": e.tolist()} for r, e in poses]
        Path(args.out).write_text(json.dumps(payload))
        print(f"[dry] path written to {args.out}")


def render(args) -> None:
    sys.path.insert(0, args.codebase)
    import torch
    from gaussian_renderer import render as gs_render
    from scene.cameras import MiniCam
    from scene.gaussian_model import GaussianModel
    from utils.graphics_utils import getProjectionMatrix

    model_path = Path(args.model_path)
    cfg = campath.load_cfg_args(model_path)
    it = find_iteration(model_path, args.iteration)
    ply = model_path / "point_cloud" / f"iteration_{it}" / "point_cloud.ply"

    poses, (W, H), (fovx, fovy) = build_path(args)
    print(f"[info] {ply}")
    print(f"[info] {len(poses)} frames at {W}x{H}, iteration {it}")

    gaussians = GaussianModel(getattr(cfg, "sh_degree", 3))
    gaussians.load_ply(str(ply))
    gaussians.active_sh_degree = gaussians.max_sh_degree
    print(f"[info] {gaussians.get_xyz.shape[0]:,} Gaussians")

    pipe = argparse.Namespace(convert_SHs_python=False, compute_cov3D_python=False,
                              debug=False, antialiasing=getattr(cfg, "antialiasing", False))
    white = bool(getattr(cfg, "white_background", False))
    background = torch.tensor([1.0, 1.0, 1.0] if white else [0.0, 0.0, 0.0], device="cuda")

    znear, zfar = 0.01, 100.0
    proj = getProjectionMatrix(znear=znear, zfar=zfar, fovX=fovx, fovY=fovy).transpose(0, 1).cuda()

    out = Path(args.out) if args.out else model_path / f"flythrough_{it}.mp4"
    frames_dir = Path(args.frames_dir) if args.frames_dir else out.parent / (out.stem + "_frames")
    frames_dir.mkdir(parents=True, exist_ok=True)

    import torchvision
    with torch.no_grad():
        for i, (rot, eye) in enumerate(poses):
            w2c = campath.w2c_from_c2w(rot, eye)
            world_view = torch.tensor(w2c, device="cuda").transpose(0, 1)
            full_proj = (world_view.unsqueeze(0).bmm(proj.unsqueeze(0))).squeeze(0)
            cam = MiniCam(W, H, fovy, fovx, znear, zfar, world_view, full_proj)
            img = gs_render(cam, gaussians, pipe, background)["render"].clamp(0.0, 1.0)
            torchvision.utils.save_image(img, frames_dir / f"{i:05d}.png")
            if (i + 1) % 40 == 0 or i + 1 == len(poses):
                print(f"[info] {i + 1}/{len(poses)} frames")

    ffmpeg_assemble(frames_dir, out, args.fps)
    if not args.keep_frames and shutil.which("ffmpeg") is not None and out.exists():
        shutil.rmtree(frames_dir)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("-m", "--model_path", required=True, help="trained model dir (contains point_cloud/, cameras.json)")
    p.add_argument("--iteration", type=int, default=-1, help="checkpoint iteration; -1 = latest")
    p.add_argument("--codebase", default=DEFAULT_CODEBASE, help="gaussian-splatting repo to import from")
    p.add_argument("--path_from", default=None, help="model dir whose cameras.json defines the path (for cross-method consistency)")
    p.add_argument("--frames", type=int, default=240)
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--width", type=int, default=None, help="render width; default follows the trained resolution")
    p.add_argument("--ellipse_scale", type=float, default=0.9, help="orbit radius as a multiple of the fitted camera ellipse")
    p.add_argument("--height_offset", type=float, default=0.0, help="shift along the orbit-plane normal, world units")
    p.add_argument("--bob", type=float, default=0.0, help="vertical oscillation amplitude, fraction of mean radius (e.g. 0.05)")
    p.add_argument("--out", default=None, help="output mp4 (dry run: optional path JSON)")
    p.add_argument("--frames_dir", default=None, help="where to write frames (default: <out>_frames)")
    p.add_argument("--keep_frames", action="store_true")
    p.add_argument("--dry_run", action="store_true", help="CPU only: fit the path, check the maths, no rendering")
    args = p.parse_args()

    if args.dry_run:
        dry_run(args)
    else:
        render(args)


if __name__ == "__main__":
    main()
