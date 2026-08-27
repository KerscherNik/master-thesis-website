"""Camera-path math shared by render_flythrough.py and render_progress.py.

Pure numpy, no torch: usable on a login node for dry runs. Conventions follow
the Inria 3DGS codebase (utils/camera_utils.py camera_to_JSON):

  cameras.json 'position'  = camera centre in world space (C2W translation)
  cameras.json 'rotation'  = C2W rotation matrix, COLMAP axes
                             (camera +X right, +Y down, +Z viewing direction)
  Camera.R                 = C2W rotation, Camera.T = W2C translation,
                             so T = -R^T @ position.
"""
from __future__ import annotations

import json
import math
from argparse import Namespace
from pathlib import Path

import numpy as np


def load_cameras_json(model_path: str | Path) -> list[dict]:
    with open(Path(model_path) / "cameras.json") as f:
        cams = json.load(f)
    if not cams:
        raise ValueError(f"empty cameras.json in {model_path}")
    return cams


def load_cfg_args(model_path: str | Path) -> Namespace:
    """Parse the Namespace(...) repr the trainer writes. Unknown keys are kept,
    so checkpoints from other 3DGS forks (e.g. 3dgs-mcmc with cap_max) load too."""
    p = Path(model_path) / "cfg_args"
    if not p.exists():
        return Namespace()
    # eval of a trusted file our own trainer wrote (same approach as upstream
    # arguments/get_combined_args); builtins stripped, only Namespace bound.
    return eval(p.read_text(), {"__builtins__": {}}, {"Namespace": Namespace})


def focal2fov(focal: float, pixels: float) -> float:
    return 2 * math.atan(pixels / (2 * focal))


def _normalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    if n < 1e-12:
        raise ValueError("cannot normalise zero vector")
    return v / n


def look_at_rotation(eye: np.ndarray, target: np.ndarray, world_up: np.ndarray) -> np.ndarray:
    """C2W rotation whose +Z looks from eye to target, COLMAP axes (+Y down).

    Columns are [right, down, forward]; orthonormal with det +1.
    """
    f = _normalize(target - eye)
    d0 = _normalize(-world_up)
    r = np.cross(d0, f)
    if np.linalg.norm(r) < 1e-8:  # looking straight up/down: pick any right
        r = np.cross(f, np.array([1.0, 0.0, 0.0]))
    r = _normalize(r)
    d = np.cross(f, r)
    return np.stack([r, d, f], axis=1)


def w2c_from_c2w(rot_c2w: np.ndarray, center: np.ndarray) -> np.ndarray:
    """4x4 world-to-view matrix as used by getWorld2View2 (before transpose)."""
    m = np.eye(4)
    m[:3, :3] = rot_c2w.T
    m[:3, 3] = -rot_c2w.T @ center
    return m.astype(np.float32)


def estimate_focus_point(centers: np.ndarray, forwards: np.ndarray) -> np.ndarray:
    """Least-squares intersection of the cameras' optical axes.

    Solves sum_i (I - f_i f_i^T)(p - c_i) = 0. Falls back to the point one
    median camera-spread ahead of the mean camera when the system is
    ill-conditioned (near-parallel viewing directions).
    """
    A = np.zeros((3, 3))
    b = np.zeros(3)
    for c, f in zip(centers, forwards):
        P = np.eye(3) - np.outer(f, f)
        A += P
        b += P @ c
    if np.linalg.cond(A) > 1e6:
        spread = np.median(np.linalg.norm(centers - centers.mean(axis=0), axis=1))
        return centers.mean(axis=0) + forwards.mean(axis=0) * max(spread, 1.0)
    return np.linalg.solve(A, b)


def fit_orbit(cams: list[dict]) -> dict:
    """Fit an elliptical orbit through the training-camera centres.

    Returns the orbit frame: centre of mass, in-plane axes e1/e2 with their
    std-based radii, plane normal e3, world up, look-at target, and the phase
    of the first camera (so paths can start near a training view).
    """
    centers = np.array([c["position"] for c in cams], dtype=np.float64)
    rots = np.array([c["rotation"] for c in cams], dtype=np.float64)  # C2W
    forwards = rots[:, :, 2]
    downs = rots[:, :, 1]
    world_up = _normalize(-downs.mean(axis=0))

    mean = centers.mean(axis=0)
    X = centers - mean
    cov = X.T @ X / len(X)
    evals, evecs = np.linalg.eigh(cov)  # ascending
    e3 = evecs[:, 0]  # smallest variance: orbit-plane normal
    if e3 @ world_up < 0:
        e3 = -e3
    e1, e2 = evecs[:, 2], evecs[:, 1]
    # right-handed in-plane frame: e1 x e2 == e3
    if np.dot(np.cross(e1, e2), e3) < 0:
        e2 = -e2
    s1 = math.sqrt(max(evals[2], 1e-12))
    s2 = math.sqrt(max(evals[1], 1e-12))

    target = estimate_focus_point(centers, forwards)
    phase0 = math.atan2((X[0] @ e2) / s2, (X[0] @ e1) / s1)
    return {
        "mean": mean, "e1": e1, "e2": e2, "e3": e3,
        "s1": s1, "s2": s2, "world_up": world_up,
        "target": target, "phase0": phase0,
    }


def orbit_poses(orbit: dict, n_frames: int, scale: float = 1.0,
                height_offset: float = 0.0, bob: float = 0.0) -> list[tuple[np.ndarray, np.ndarray]]:
    """n_frames (C2W rotation, centre) pairs on the ellipse; seamless loop.

    scale multiplies the fitted radii; height_offset shifts along the plane
    normal in world units; bob adds a gentle two-period vertical oscillation
    (fraction of the mean radius).
    """
    # std of cos over a full period is 1/sqrt(2): ring of cameras with std s
    # sits at radius ~ s * sqrt(2)
    a = scale * math.sqrt(2.0) * orbit["s1"]
    b = scale * math.sqrt(2.0) * orbit["s2"]
    base = orbit["mean"] + height_offset * orbit["e3"]
    poses = []
    for k in range(n_frames):
        th = orbit["phase0"] + 2 * math.pi * k / n_frames
        eye = base + a * math.cos(th) * orbit["e1"] + b * math.sin(th) * orbit["e2"]
        if bob:
            eye = eye + bob * 0.5 * (a + b) * math.sin(2 * th) * orbit["e3"]
        rot = look_at_rotation(eye, orbit["target"], orbit["world_up"])
        poses.append((rot, eye))
    return poses


def fov_from_cams(cams: list[dict], width: int, height: int) -> tuple[float, float]:
    """FoV for a target render size, from the median stored intrinsics.

    cameras.json stores full-resolution fx/width, so the FoV is resolution
    independent; fovy follows from fovx through the target aspect ratio.
    """
    fx = float(np.median([c["fx"] for c in cams]))
    w = float(np.median([c["width"] for c in cams]))
    fovx = focal2fov(fx, w)
    fovy = 2 * math.atan(math.tan(fovx / 2) * height / width)
    return fovx, fovy


def render_size(cams: list[dict], cfg: Namespace, width_override: int | None = None) -> tuple[int, int]:
    """Target render size following the 3DGS resolution rules, forced even
    (H.264 yuv420p needs even dimensions)."""
    w0 = int(np.median([c["width"] for c in cams]))
    h0 = int(np.median([c["height"] for c in cams]))
    if width_override:
        w = width_override
    else:
        r = getattr(cfg, "resolution", -1)
        if r in (1, 2, 4, 8):
            w = round(w0 / r)
        else:  # 3DGS -1 rule: cap width at 1600
            w = min(w0, 1600)
    h = round(h0 * w / w0)
    return w - w % 2, h - h % 2


def test_view_names(cams: list[dict], llffhold: int = 8) -> list[str]:
    """Held-out view names under the standard eval split: cameras sorted by
    image name, every llffhold-th is a test view (matches dataset_readers.py).
    Extensions are stripped (some forks store names without them)."""
    names = sorted({Path(c["img_name"]).stem for c in cams})
    return [n for i, n in enumerate(names) if i % llffhold == 0]
