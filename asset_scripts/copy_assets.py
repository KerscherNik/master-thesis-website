#!/usr/bin/env python3
"""Populate static/images/ from thesis figure assets and trained-model renders.

Sources (read-only):
  - thesis figures: /export/home/ra28kuc/projects/thesis/thesis/figures/
  - test-split renders at iteration 30000 under /export/scratch/ra28kuc/output/

Comparison views are the hand-picked representative test views from the thesis
figure scripts: flowers 00021, bicycle 00012, stump 00015 (fig_exp_quality_crops.py
and fig_exp_crop_assets.py); garden 00003 picked here (table + vase view).

Photographic content is re-encoded as JPEG q92; plots stay PNG.
Run from anywhere: paths are absolute. Idempotent.
"""
from pathlib import Path

from PIL import Image

FIG = Path("/export/home/ra28kuc/projects/thesis/thesis/figures")
OUT = Path("/export/scratch/ra28kuc/output")
WEB = Path(__file__).resolve().parent.parent / "static" / "images"

SAD = {
    "flowers": OUT / "newproj-sad_v1.7-flowers-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial",
    "bicycle": OUT / "newproj-sad_v1.7-bicycle-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial",
    "garden": OUT / "newproj-sad_v1.7-garden-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial",
    "stump": OUT / "newproj-sad_v1.7-stump-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial",
    "truck": OUT / "sad_v1.7-truck-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial",
    "drjohnson": OUT / "sad_v1.7-drjohnson-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial",
}
GS = {
    "flowers": OUT / "3dgs-flowers-s0-rerun",
    "bicycle": OUT / "3dgs-bicycle-s0",
    "garden": OUT / "3dgs-garden-s0",
    "stump": OUT / "3dgs-stump-s0",
    "truck": OUT / "3dgs-truck-s0",
    "drjohnson": OUT / "3dgs-drjohnson-s0",
}
VIEW = {"flowers": "00021", "bicycle": "00012", "garden": "00003", "stump": "00015"}


def jpg(src: Path, dst: Path, quality: int = 92) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    im = Image.open(src)
    if im.mode != "RGB":
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1] if im.mode in ("RGBA", "LA") else None)
        im = bg
    im.save(dst, "JPEG", quality=quality)
    print(f"{dst.relative_to(WEB.parent.parent)}  <- {src}")


def png(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    im = Image.open(src)
    if im.mode == "RGBA":  # flatten plot transparency onto white
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        im = bg
    im.save(dst, "PNG", optimize=True)
    print(f"{dst.relative_to(WEB.parent.parent)}  <- {src}")


# Detail-crop boxes (x, y, w, h) at render resolution. Bicycle is the thesis
# box (fig_exp_crop_assets.py: front wheel, bench leg, grass, view 00012).
# None = choose by the thesis criterion: the sliding window maximising
# mean|3DGS - GT| - mean|SAD - GT| on luma, i.e. where the baseline's error
# most exceeds SAD's.
CROP_BOX: dict[str, tuple[int, int, int, int] | None] = {
    "bicycle": (633, 471, 440, 350),
    "garden": (160, 120, 440, 350),  # view 00010: bark, scuttle, foliage, wood grain
    "stump": None,
    "flowers": None,
    "truck": None,      # view auto-picked by best_view (thesis criterion)
    "drjohnson": None,  # view auto-picked by best_view
}
# crop view can differ from the poster/full view above
CROP_VIEW = {"garden": "00010"}
CROP_ZOOM = 2  # upscale factor for crisp full-width rendering


def luma(path: Path) -> "np.ndarray":
    import numpy as np
    return np.asarray(Image.open(path).convert("L"), dtype=np.float32)


def best_view(scene: str) -> str:
    """Pick the held-out view where the baseline's full-image error most
    exceeds SAD's (same criterion as best_box, but across views)."""
    import numpy as np
    views = sorted(p.stem for p in (SAD[scene] / "test/ours_30000/renders").glob("*.png"))
    best, best_v = -1e9, views[0]
    for v in views:
        gt = luma(SAD[scene] / f"test/ours_30000/gt/{v}.png")
        sad = luma(SAD[scene] / f"test/ours_30000/renders/{v}.png")
        gs = luma(GS[scene] / f"test/ours_30000/renders/{v}.png")
        s = float((np.abs(gs - gt) - np.abs(sad - gt)).mean())
        if s > best:
            best, best_v = s, v
    print(f"  {scene}: view {best_v} (baseline error exceeds SAD's by {best:.3f} grey levels)")
    return best_v


def best_visible(scene: str, w: int = 440, h: int = 350, stride: int = 40):
    """Pick view AND box maximising the *visible* difference between the two
    renders (mean |SAD - 3DGS| on luma), constrained to windows where SAD is
    also better against GT (mean err-gap > 0). The plain err-gap criterion
    favours flat blurry regions where nothing is visibly different."""
    import numpy as np
    views = sorted(q.stem for q in (SAD[scene] / "test/ours_30000/renders").glob("*.png"))
    best, best_pick = -1e9, None
    for v in views:
        gt = luma(SAD[scene] / f"test/ours_30000/gt/{v}.png")
        sad = luma(SAD[scene] / f"test/ours_30000/renders/{v}.png")
        gs = luma(GS[scene] / f"test/ours_30000/renders/{v}.png")
        vis = np.abs(gs - sad)
        gap = np.abs(gs - gt) - np.abs(sad - gt)
        H, W = vis.shape
        for y in range(0, H - h + 1, stride):
            for x in range(0, W - w + 1, stride):
                if gap[y:y + h, x:x + w].mean() <= 0:
                    continue  # only show SAD-favourable regions
                sc = float(vis[y:y + h, x:x + w].mean())
                if sc > best:
                    best, best_pick = sc, (v, (x, y, w, h))
    v, box = best_pick
    print(f"  {scene}: view {v} box {box} (visible |SAD-3DGS| {best:.2f} grey levels, SAD-favourable)")
    return v, box


def best_box(scene: str, w: int = 440, h: int = 350, stride: int = 40) -> tuple[int, int, int, int]:
    import numpy as np
    v = CROP_VIEW.get(scene, VIEW[scene])
    gt = luma(SAD[scene] / f"test/ours_30000/gt/{v}.png")
    sad = luma(SAD[scene] / f"test/ours_30000/renders/{v}.png")
    gs = luma(GS[scene] / f"test/ours_30000/renders/{v}.png")
    err = np.abs(gs - gt) - np.abs(sad - gt)  # >0 where baseline is worse
    best, best_xy = -1e9, (0, 0)
    H, W = err.shape
    for y in range(0, H - h + 1, stride):
        for x in range(0, W - w + 1, stride):
            s = float(err[y:y + h, x:x + w].mean())
            if s > best:
                best, best_xy = s, (x, y)
    print(f"  {scene}: box {best_xy[0]},{best_xy[1]} +{w}x{h} "
          f"(baseline error exceeds SAD's by {best:.2f} grey levels)")
    return (*best_xy, w, h)


def crop_pair(scene: str) -> None:
    box = CROP_BOX.get(scene) or best_box(scene)
    x, y, w, h = box
    v = CROP_VIEW.get(scene, VIEW[scene])
    for method, src_dir in (("sad", SAD[scene]), ("3dgs", GS[scene])):
        im = Image.open(src_dir / f"test/ours_30000/renders/{v}.png")
        crop = im.crop((x, y, x + w, y + h))
        crop = crop.resize((w * CROP_ZOOM, h * CROP_ZOOM), Image.LANCZOS)
        dst = WEB / "comparisons" / f"{scene}_{method}.jpg"
        dst.parent.mkdir(parents=True, exist_ok=True)
        crop.save(dst, "JPEG", quality=92)
        print(f"{dst.relative_to(WEB.parent.parent)}  <- {src_dir.name} view {v} box {box} x{CROP_ZOOM}")


def main() -> None:
    # Teaser: full frame, same test view, SAD vs 3DGS.
    for scene in ("flowers",):
        v = VIEW[scene]
        jpg(SAD[scene] / f"test/ours_30000/renders/{v}.png", WEB / "teaser" / f"{scene}_sad.jpg")
        jpg(GS[scene] / f"test/ours_30000/renders/{v}.png", WEB / "teaser" / f"{scene}_3dgs.jpg")

    # Result sliders: 2x-upscaled detail crops where the methods differ.
    # T&T/DB scenes: pick view+box by maximum *visible* SAD-vs-3DGS difference
    # (the err-gap criterion landed on flat, blurry regions there).
    # drjohnson is a dark indoor scene: a tight window shows floating specks,
    # so use a much larger window (more zoomed out) there
    for scene, (w, h) in (("truck", (440, 350)), ("drjohnson", (760, 600))):
        v, box = best_visible(scene, w=w, h=h)
        VIEW[scene] = v
        CROP_VIEW[scene] = v
        CROP_BOX[scene] = box
    for scene in ("flowers", "bicycle", "garden", "stump", "truck", "drjohnson"):
        crop_pair(scene)

    # Method strip: the SAD hero panels (400 DPI handoff exports, flowers scene).
    hero = FIG / "_drawio_handoff" / "sad_hero"
    for name, out in [
        ("01_full_scene.png", "full_scene.jpg"),
        ("02_ground_truth_crop.png", "gt_crop.jpg"),
        ("03_baseline_render_crop.png", "render_crop.jpg"),
        ("04_residual_heatmap.png", "residual.jpg"),
        ("05_wht_deficit_heatmap.png", "deficit.jpg"),
        ("06_postsad_clean_crop.png", "postsad_crop.jpg"),
    ]:
        jpg(hero / name, WEB / "method" / out)

    # Results plots.
    png(FIG / "generated" / "fig_exp_pareto.png", WEB / "results" / "pareto.png")
    png(FIG / "generated" / "fig_exp_density_map.png", WEB / "results" / "density_map.png")

    # Posters for pending video slots (plain renders; the page badges them).
    for scene in ("flowers", "bicycle", "garden", "stump", "truck", "drjohnson"):
        jpg(SAD[scene] / f"test/ours_30000/renders/{VIEW[scene]}.png",
            WEB / "posters" / f"{scene}.jpg", quality=85)


if __name__ == "__main__":
    main()
