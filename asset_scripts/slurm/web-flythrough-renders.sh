#!/bin/bash
#SBATCH --partition=a100p
#SBATCH --requeue
#SBATCH --gres=gpu:a100:1
#SBATCH --time=03:00:00
#SBATCH --job-name=web-flythrough-renders
#SBATCH --output=/export/scratch/ra28kuc/slurm_logs/web-flythrough-renders-%j.log

# Webpage asset: elliptical fly-throughs of the existing converged checkpoints
# (iteration 30000): SAD FINAL, 3DGS baseline, and capped MCMC on flowers,
# bicycle, garden. Per scene all three methods share the camera path
# (--path_from the SAD dir) and the render width of the trained resolution,
# so the videos are frame-aligned for the on-page comparison slider.
# mp4s land in the webpage repo under static/videos/. If ffmpeg is missing on
# the node, frames are kept next to the mp4 target with the assemble command
# in README_ffmpeg.txt; run it on the login node (has ffmpeg 8.0).

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

render () {  # render <model_dir> <path_from_dir> <width> <basename>
  python "$SCRIPTS/render_flythrough.py" \
    -m "$1" --path_from "$2" --width "$3" \
    --codebase "$CODE" --iteration 30000 \
    --frames 240 --fps 30 --ellipse_scale 0.9 \
    --frames_dir "$WORK/$4_frames" --out "$WORK/$4.mp4"
  if [ -f "$WORK/$4.mp4" ]; then cp "$WORK/$4.mp4" "$VIDEOS/$4.mp4"; fi
}

# flowers (trained width 1256)
render "$SAD_FLOWERS"                                  "$SAD_FLOWERS" 1256 flythrough_sad_flowers
render "$O/3dgs-flowers-s0-rerun"                      "$SAD_FLOWERS" 1256 flythrough_3dgs_flowers
render "$O/mcmc-360_v2-flowers-cap3400000-seed0-j53966" "$SAD_FLOWERS" 1256 flythrough_mcmc_flowers

# bicycle (trained width 1236)
render "$SAD_BICYCLE"                                   "$SAD_BICYCLE" 1236 flythrough_sad_bicycle
render "$O/3dgs-bicycle-s0"                             "$SAD_BICYCLE" 1236 flythrough_3dgs_bicycle
render "$O/mcmc-360_v2-bicycle-cap5700000-seed0-j54002" "$SAD_BICYCLE" 1236 flythrough_mcmc_bicycle

# garden (trained width 1296)
render "$SAD_GARDEN"                                    "$SAD_GARDEN" 1296 flythrough_sad_garden
render "$O/3dgs-garden-s0"                              "$SAD_GARDEN" 1296 flythrough_3dgs_garden
render "$O/mcmc-360_v2-garden-cap5640000-seed0-j53984"  "$SAD_GARDEN" 1296 flythrough_mcmc_garden

echo DONE
