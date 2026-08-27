#!/usr/bin/env python3
"""CPU dry test for the fly-through camera-path maths. No torch, no GPU.

Part 1 builds a synthetic ring of inward-looking cameras with the 3DGS C2W
convention and checks that fit_orbit recovers plane, target, and radii, and
that orbit_poses returns valid look-at rotations. Part 2 (optional, pass a
model dir) validates the conventions against a real cameras.json: every
stored camera forward axis must point close to the estimated focus point.

Usage: python test_campath_dry.py [model_dir]
"""
from __future__ import annotations

import math
import sys

import numpy as np

import campath


def synthetic_ring(n: int = 24, radius: float = 4.0, height: float = 1.5) -> list[dict]:
    """Cameras on a tilted ring, all looking at a common target."""
    rng = np.random.default_rng(0)
    # a mildly tilted orbit plane
    tilt = 0.25
    e1 = np.array([1.0, 0.0, 0.0])
    e2 = np.array([0.0, math.cos(tilt), math.sin(tilt)])
    e3 = np.cross(e1, e2)
    target = np.array([0.3, -0.2, 0.5])
    up = e3
    cams = []
    for i in range(n):
        th = 2 * math.pi * i / n
        r = radius * (1.0 + 0.05 * rng.standard_normal())
        eye = target + r * math.cos(th) * e1 + 0.7 * r * math.sin(th) * e2 + height * e3
        rot = campath.look_at_rotation(eye, target, up)
        cams.append({
            "position": eye.tolist(),
            "rotation": rot.tolist(),
            "fx": 1000.0, "fy": 1000.0, "width": 1600, "height": 1000,
            "img_name": f"IMG_{i:04d}.JPG", "id": i,
        })
    return cams, target, e3


def check(name: str, ok: bool, detail: str = "") -> bool:
    print(f"  [{'ok' if ok else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))
    return ok


def part1() -> bool:
    print("part 1: synthetic ring")
    cams, target, normal = synthetic_ring()
    orbit = campath.fit_orbit(cams)
    good = True

    err_t = np.linalg.norm(orbit["target"] - target)
    good &= check("focus point recovered", err_t < 0.15, f"err {err_t:.3f}")

    align = abs(orbit["e3"] @ normal)
    good &= check("orbit plane recovered", align > 0.99, f"|cos| {align:.4f}")

    poses = campath.orbit_poses(orbit, 240, scale=0.9)
    rot_err = max(np.abs(r.T @ r - np.eye(3)).max() for r, _ in poses)
    det_err = max(abs(np.linalg.det(r) - 1) for r, _ in poses)
    good &= check("rotations orthonormal", rot_err < 1e-9 and det_err < 1e-9,
                  f"orth {rot_err:.1e}, det {det_err:.1e}")

    # every pose must look at the target: forward axis vs eye->target direction
    ang = []
    for r, eye in poses:
        f = r[:, 2]
        d = orbit["target"] - eye
        d /= np.linalg.norm(d)
        ang.append(math.degrees(math.acos(np.clip(f @ d, -1, 1))))
    good &= check("poses look at target", max(ang) < 0.01, f"max {max(ang):.2e} deg")

    # loop seamlessness: last pose close to first, one step apart
    step = np.linalg.norm(poses[1][1] - poses[0][1])
    wrap = np.linalg.norm(poses[0][1] - poses[-1][1])
    good &= check("seamless loop", abs(wrap - step) < 0.3 * step,
                  f"step {step:.3f}, wrap {wrap:.3f}")

    # w2c inverts c2w
    r, eye = poses[7]
    m = campath.w2c_from_c2w(r, eye)
    back = np.linalg.inv(m)
    good &= check("w2c consistent", np.abs(back[:3, 3] - eye).max() < 1e-5
                  and np.abs(back[:3, :3] - r).max() < 1e-6)

    # test-view split: 24 names, every 8th -> 3
    names = campath.test_view_names(cams)
    good &= check("eval split", names == ["IMG_0000", "IMG_0008", "IMG_0016"], str(names))
    return good


def part2(model_dir: str) -> bool:
    print(f"part 2: real checkpoint {model_dir}")
    cams = campath.load_cameras_json(model_dir)
    cfg = campath.load_cfg_args(model_dir)
    orbit = campath.fit_orbit(cams)
    good = True

    # stored forward axes should point near the estimated focus point;
    # loose bound: 360 captures orbit a region, not a point
    angs = []
    for c in cams:
        rot = np.array(c["rotation"])
        eye = np.array(c["position"])
        f = rot[:, 2]
        d = orbit["target"] - eye
        d /= np.linalg.norm(d)
        angs.append(math.degrees(math.acos(np.clip(f @ d, -1, 1))))
    med = float(np.median(angs))
    good &= check("cameras face the focus point", med < 25.0,
                  f"median angle {med:.1f} deg, max {max(angs):.1f} deg")

    W, H = campath.render_size(cams, cfg)
    fovx, fovy = campath.fov_from_cams(cams, W, H)
    good &= check("render size sane", 480 <= W <= 4096 and 320 <= H <= 4096, f"{W}x{H}")
    good &= check("fov sane", 20 < math.degrees(fovx) < 120, f"{math.degrees(fovx):.1f} deg")

    poses = campath.orbit_poses(orbit, 240, scale=0.9)
    # path should stay in the neighbourhood of the training cameras
    centers = np.array([c["position"] for c in cams])
    spread = np.linalg.norm(centers - centers.mean(0), axis=1).max()
    d = max(np.linalg.norm(eye - centers.mean(0)) for _, eye in poses)
    good &= check("path within camera neighbourhood", d < 1.5 * spread,
                  f"max dist {d:.2f} vs spread {spread:.2f}")
    return good


def main() -> None:
    ok = part1()
    if len(sys.argv) > 1:
        ok &= part2(sys.argv[1])
    print("PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
