#!/bin/bash
#SBATCH --partition=a100p
#SBATCH --requeue
#SBATCH --gres=gpu:a100:1
#SBATCH --time=03:00:00
#SBATCH --job-name=web-flythrough-dolly-main
#SBATCH --output=/export/scratch/ra28kuc/slurm_logs/web-flythrough-dolly-main-%j.log

# Fly-in/fly-out camera path (campath --dolly 0.45 --ease 0.5) for SAD, 3DGS
# and MCMC on all four scenes: one revolution that spirals into the detail
# region at mid-loop and slows there, so method differences are visible.
# Replaces the plain-orbit videos under the same basenames.

set -euo pipefail
source /export/home/ra28kuc/miniconda3-new/etc/profile.d/conda.sh
conda activate gs-vanilla

SCRIPTS=/export/home/ra28kuc/projects/thesis-webpage/asset_scripts
VIDEOS=/export/home/ra28kuc/projects/thesis-webpage/static/videos
WORK=/export/scratch/ra28kuc/webpage_assets/dolly
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
    --frames 240 --fps 30 --ellipse_scale 0.9 --dolly 0.45 --ease 0.5 \
    --frames_dir "$WORK/$4_frames" --out "$WORK/$4.mp4"
  if [ -f "$WORK/$4.mp4" ]; then cp "$WORK/$4.mp4" "$VIDEOS/$4.mp4"; fi
}

render "$SAD_FLOWERS"                                   "$SAD_FLOWERS" 1256 flythrough_sad_flowers
render "$O/3dgs-flowers-s0-rerun"                       "$SAD_FLOWERS" 1256 flythrough_3dgs_flowers
render "$O/mcmc-360_v2-flowers-cap3400000-seed0-j53966" "$SAD_FLOWERS" 1256 flythrough_mcmc_flowers

render "$SAD_BICYCLE"                                   "$SAD_BICYCLE" 1236 flythrough_sad_bicycle
render "$O/3dgs-bicycle-s0"                             "$SAD_BICYCLE" 1236 flythrough_3dgs_bicycle
render "$O/mcmc-360_v2-bicycle-cap5700000-seed0-j54002" "$SAD_BICYCLE" 1236 flythrough_mcmc_bicycle

render "$SAD_GARDEN"                                    "$SAD_GARDEN" 1296 flythrough_sad_garden
render "$O/3dgs-garden-s0"                              "$SAD_GARDEN" 1296 flythrough_3dgs_garden
render "$O/mcmc-360_v2-garden-cap5640000-seed0-j53984"  "$SAD_GARDEN" 1296 flythrough_mcmc_garden

render "$SAD_STUMP"                                     "$SAD_STUMP" 1244 flythrough_sad_stump
render "$O/3dgs-stump-s0"                               "$SAD_STUMP" 1244 flythrough_3dgs_stump
render "$O/mcmc-360_v2-stump-cap4520000-seed0-j54020"   "$SAD_STUMP" 1244 flythrough_mcmc_stump

echo DONE
