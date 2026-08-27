# Webpage asset pipeline

Everything the page's video slots need, from existing checkpoints and two new
progress-logging training runs. Nothing here is submitted automatically.

## Scripts

- `copy_assets.py` — populates `static/images/` from thesis figures and the
  test renders of the final checkpoints. Already run; rerun after figure
  updates.
- `campath.py` — shared camera-path maths (numpy only, importable on the
  login node).
- `render_flythrough.py` — elliptical fly-through of one checkpoint;
  `--path_from` reuses another model's cameras.json so methods stay
  frame-aligned; `--dry_run` needs no GPU.
- `render_progress.py` — one fixed held-out view per saved checkpoint,
  iteration counter and Gaussian count burned in; `--dry_run` needs no GPU.
- `test_campath_dry.py` — CPU test of the path maths
  (`python test_campath_dry.py [model_dir]`), last run: PASS on synthetic
  ring + flowers FINAL checkpoint.

## Video file contract with index.html

`static/videos/` names the page watches for (slots stay in placeholder state
until the file exists, no HTML edit needed):

```
flythrough_sad_flowers.mp4    flythrough_3dgs_flowers.mp4   flythrough_mcmc_flowers.mp4
flythrough_sad_bicycle.mp4    flythrough_sad_garden.mp4
progress_sad_flowers.mp4      progress_3dgs_flowers.mp4
progress_sad_bicycle.mp4      progress_3dgs_bicycle.mp4
```

(The jobs also render `flythrough_3dgs_{bicycle,garden}` and
`flythrough_mcmc_{bicycle,garden}` into `/export/scratch/ra28kuc/webpage_assets/`
for possible extra sliders.)

## Submission order

```bash
cd /export/home/ra28kuc/projects/thesis-webpage/asset_scripts/slurm

# 1. fly-throughs of existing checkpoints (independent, ~1-2 h)
sbatch web-flythrough-renders.sh

# 2. progress-logging training runs (~3-6 h each)
sbatch web-progress-sad-flowers.sh      # -> job id A
sbatch web-progress-3dgs-flowers.sh     # -> job id B
sbatch web-progress-sad-bicycle.sh      # -> job id C
sbatch web-progress-3dgs-bicycle.sh     # -> job id D

# 3. progress videos, after 2. finishes
sbatch --dependency=afterok:A:B:C:D web-progress-renders.sh
```

## Checkpoints the fly-through job uses (verified present, iteration_30000)

| scene   | SAD FINAL | 3DGS | MCMC |
|---|---|---|---|
| flowers | `newproj-sad_v1.7-flowers-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial` | `3dgs-flowers-s0-rerun` | `mcmc-360_v2-flowers-cap3400000-seed0-j53966` |
| bicycle | `newproj-sad_v1.7-bicycle-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial` | `3dgs-bicycle-s0` | `mcmc-360_v2-bicycle-cap5700000-seed0-j54002` |
| garden  | `newproj-sad_v1.7-garden-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial` | `3dgs-garden-s0` | `mcmc-360_v2-garden-cap5640000-seed0-j53984` |

All under `/export/scratch/ra28kuc/output/`. Per scene, all methods render
with the SAD run's camera path and width (flowers 1256, bicycle 1236,
garden 1296), so slider pairs line up frame for frame. The MCMC plys load
fine in our codebase (same layout; `cfg_args` extras are tolerated).

## Notes

- Training jobs run in the `sad-fixprune` worktree
  (`fix/deficit-prune-alignment` @ 695aad9), the verified final-config
  state — the main sad-v1 checkout currently sits on the experimental
  `idea/sad-v1.8-generalization` branch and must not be used for these.
- SAD flags are the FINAL configuration copied from
  `slurm_verify_fixprune_flowers.sh`.
- Eleven checkpoints per progress run cost roughly 4-9 GB each on scratch
  (ply size scales with the count; ~36 GB for all four runs).
- If ffmpeg is missing on the compute node, frames are kept and the exact
  assemble command is written next to them (`README_ffmpeg.txt`); run it on
  the login node (ffmpeg 8.0 at /usr/bin/ffmpeg).
- Progress views match the thesis figures: flowers test view 21
  (`_DSC9208`), bicycle test view 12.
