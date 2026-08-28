#!/bin/bash
#SBATCH --partition=a100p
#SBATCH --requeue
#SBATCH --gres=gpu:a100:1
#SBATCH --time=00:30:00
#SBATCH --job-name=web-flythrough-dolly-probe
#SBATCH --output=/export/scratch/ra28kuc/slurm_logs/web-flythrough-dolly-probe-%j.log

# Probe for the fly-in/fly-out camera path (campath.py --dolly/--ease):
# one video, SAD flowers, kept OUT of the webpage repo for visual review.

set -euo pipefail
source /export/home/ra28kuc/miniconda3-new/etc/profile.d/conda.sh
conda activate gs-vanilla

SCRIPTS=/export/home/ra28kuc/projects/thesis-webpage/asset_scripts
WORK=/export/scratch/ra28kuc/webpage_assets/dolly
CODE=/export/scratch/ra28kuc/worktrees/sad-fixprune
O=/export/scratch/ra28kuc/output
mkdir -p "$WORK"

SAD_FLOWERS=$O/newproj-sad_v1.7-flowers-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial

python "$SCRIPTS/render_flythrough.py" \
  -m "$SAD_FLOWERS" --path_from "$SAD_FLOWERS" --width 1256 \
  --codebase "$CODE" --iteration 30000 \
  --frames 240 --fps 30 --ellipse_scale 0.9 --dolly 0.45 --ease 0.5 \
  --frames_dir "$WORK/probe_frames" --keep_frames \
  --out "$WORK/probe_sad_flowers.mp4"

echo DONE
