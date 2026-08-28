#!/bin/bash
#SBATCH --partition=a100p
#SBATCH --requeue
#SBATCH --gres=gpu:a100:1
#SBATCH --time=02:00:00
#SBATCH --job-name=web-flythrough-fds-retry
#SBATCH --output=/export/scratch/ra28kuc/slurm_logs/web-flythrough-fds-retry-%j.log

# FDS-GS fly-throughs, rendered with the FDS-GS codebase and env.
# The first attempt (job 95448) crashed in our vanilla rasterizer: FDS-GS
# plys carry a per-Gaussian filter radius `R` and log-scales up to ~11
# (exp -> ~60k world units) that only their R-aware rasterizer clamps.
# Their repo exposes the same render/MiniCam/GaussianModel API, so
# render_flythrough.py just gets --codebase pointed at it.

set -euo pipefail
source /export/home/ra28kuc/miniconda3-new/etc/profile.d/conda.sh
conda activate fdsgs

SCRIPTS=/export/home/ra28kuc/projects/thesis-webpage/asset_scripts
VIDEOS=/export/home/ra28kuc/projects/thesis-webpage/static/videos
WORK=/export/scratch/ra28kuc/webpage_assets
CODE=/export/home/ra28kuc/projects/FDS-GS
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

render "$O/fds_gs-flowers-s0" "$SAD_FLOWERS" 1256 flythrough_fdsgs_flowers
render "$O/fds_gs-bicycle-s0" "$SAD_BICYCLE" 1236 flythrough_fdsgs_bicycle
render "$O/fds_gs-garden-s0"  "$SAD_GARDEN"  1296 flythrough_fdsgs_garden
render "$O/fds_gs-stump-s0"   "$SAD_STUMP"   1244 flythrough_fdsgs_stump

echo DONE
