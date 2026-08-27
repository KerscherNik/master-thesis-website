#!/bin/bash
#SBATCH --partition=a100p
#SBATCH --requeue
#SBATCH --gres=gpu:a100:1
#SBATCH --time=02:00:00
#SBATCH --job-name=web-progress-renders
#SBATCH --output=/export/scratch/ra28kuc/slurm_logs/web-progress-renders-%j.log

# Webpage asset: training-progress videos from the web-progress-* runs (one
# fixed held-out view per saved checkpoint, iteration counter and Gaussian
# count overlaid). Requires the four web-progress training jobs to have
# finished; submit with
#   sbatch --dependency=afterok:<sad-flowers>:<3dgs-flowers>:<sad-bicycle>:<3dgs-bicycle> \
#       web-progress-renders.sh
# Views match the thesis figures: flowers test view 21, bicycle test view 12.

set -euo pipefail
source /export/home/ra28kuc/miniconda3-new/etc/profile.d/conda.sh
conda activate gs-vanilla

SCRIPTS=/export/home/ra28kuc/projects/thesis-webpage/asset_scripts
VIDEOS=/export/home/ra28kuc/projects/thesis-webpage/static/videos
WORK=/export/scratch/ra28kuc/webpage_assets
CODE=/export/scratch/ra28kuc/worktrees/sad-fixprune
O=/export/scratch/ra28kuc/output
mkdir -p "$VIDEOS" "$WORK"

render () {  # render <model_dir> <test_view> <basename>
  python "$SCRIPTS/render_progress.py" \
    -m "$1" --test_view "$2" --codebase "$CODE" \
    --fps 30 --hold 0.7 \
    --frames_dir "$WORK/$3_frames" --out "$WORK/$3.mp4"
  if [ -f "$WORK/$3.mp4" ]; then cp "$WORK/$3.mp4" "$VIDEOS/$3.mp4"; fi
}

render "$O/web-progress-sad-flowers"  21 progress_sad_flowers
render "$O/web-progress-3dgs-flowers" 21 progress_3dgs_flowers
render "$O/web-progress-sad-bicycle"  12 progress_sad_bicycle
render "$O/web-progress-3dgs-bicycle" 12 progress_3dgs_bicycle

echo DONE
