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
}
GS = {
    "flowers": OUT / "3dgs-flowers-s0-rerun",
    "bicycle": OUT / "3dgs-bicycle-s0",
    "garden": OUT / "3dgs-garden-s0",
    "stump": OUT / "3dgs-stump-s0",
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


def main() -> None:
    # Teaser + result comparison sliders: same test view, SAD vs 3DGS.
    for scene in ("flowers", "bicycle", "garden", "stump"):
        v = VIEW[scene]
        sub = "teaser" if scene == "flowers" else "comparisons"
        jpg(SAD[scene] / f"test/ours_30000/renders/{v}.png", WEB / sub / f"{scene}_sad.jpg")
        jpg(GS[scene] / f"test/ours_30000/renders/{v}.png", WEB / sub / f"{scene}_3dgs.jpg")

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
    for scene in ("flowers", "bicycle", "garden"):
        jpg(SAD[scene] / f"test/ours_30000/renders/{VIEW[scene]}.png",
            WEB / "posters" / f"{scene}.jpg", quality=85)


if __name__ == "__main__":
    main()
