#!/bin/bash
#SBATCH --partition=a100p
#SBATCH --requeue
#SBATCH --gres=gpu:a100:1
#SBATCH --time=03:00:00
#SBATCH --job-name=web-flythrough-fds-stump
#SBATCH --output=/export/scratch/ra28kuc/slurm_logs/web-flythrough-fds-stump-%j.log

# Webpage asset, second batch: FDS-GS fly-throughs on flowers/bicycle/garden
# (same camera path as the existing videos, so they drop into the arena
# frame-aligned) and a fourth scene, stump, for all four methods.
# Same conventions as web-flythrough-renders.sh; stump uses the SAD stump
# checkpoint's path/width (4978/4 -> 1244, render_size forces even height).
# FDS-GS renders are best-effort: if its ply layout does not load in our
# codebase, the job logs a warning and continues with the rest.

set -euo pipefail
source /export/home/ra28kuc/miniconda3-new/etc/profile.d/conda.sh
conda activate gs-vanilla

SCRIPTS=/export/home/ra28kuc/projects/thesis-webpage/asset_scripts
VIDEOS=/export/home/ra28kuc/projects/thesis-webpage/static/videos
WORK=/export/scratch/ra28kuc/webpage_assets
CODE=/export/scratch/ra28kuc/worktrees/sad-fixprune
O=/export/scratch/ra28kuc/output
mkdir -p "$VIDEOS" "$WORK"

SAD_FLOWERS=$O/newproj-sad_v1.7-flowers-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial
SAD_BICYCLE=$O/newproj-sad_v1.7-bicycle-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial
SAD_GARDEN=$O/newproj-sad_v1.7-garden-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial
SAD_STUMP=$O/newproj-sad_v1.7-stump-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial

render () {  # render <model_dir> <path_from_dir> <width> <basename>
  if [ -f "$WORK/$4.mp4" ]; then
    echo "[skip] $4.mp4 exists"; cp "$WORK/$4.mp4" "$VIDEOS/$4.mp4"; return
  fi
  python "$SCRIPTS/render_flythrough.py" \
    -m "$1" --path_from "$2" --width "$3" \
    --codebase "$CODE" --iteration 30000 \
    --frames 240 --fps 30 --ellipse_scale 0.9 \
    --frames_dir "$WORK/$4_frames" --out "$WORK/$4.mp4"
  if [ -f "$WORK/$4.mp4" ]; then cp "$WORK/$4.mp4" "$VIDEOS/$4.mp4"; fi
}

# stump, the known-good loaders first (trained width 4978/4 -> 1244)
render "$SAD_STUMP"                                    "$SAD_STUMP" 1244 flythrough_sad_stump
render "$O/3dgs-stump-s0"                              "$SAD_STUMP" 1244 flythrough_3dgs_stump
render "$O/mcmc-360_v2-stump-cap4520000-seed0-j54020"  "$SAD_STUMP" 1244 flythrough_mcmc_stump

# FDS-GS, best effort (ply layout should match; warn-and-continue if not)
render "$O/fds_gs-stump-s0"   "$SAD_STUMP"   1244 flythrough_fdsgs_stump   || echo "[warn] fdsgs stump failed"
render "$O/fds_gs-flowers-s0" "$SAD_FLOWERS" 1256 flythrough_fdsgs_flowers || echo "[warn] fdsgs flowers failed"
render "$O/fds_gs-bicycle-s0" "$SAD_BICYCLE" 1236 flythrough_fdsgs_bicycle || echo "[warn] fdsgs bicycle failed"
render "$O/fds_gs-garden-s0"  "$SAD_GARDEN"  1296 flythrough_fdsgs_garden  || echo "[warn] fdsgs garden failed"

echo DONE
