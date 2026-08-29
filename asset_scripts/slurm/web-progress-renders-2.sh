#!/bin/bash
#SBATCH --partition=a100p
#SBATCH --requeue
#SBATCH --gres=gpu:a100:1
#SBATCH --time=02:00:00
#SBATCH --job-name=web-progress-renders-2
#SBATCH --output=/export/scratch/ra28kuc/slurm_logs/web-progress-renders-2-%j.log

# Training-progress videos for truck and drjohnson; submit with
#   sbatch --dependency=afterok:<sad-truck>:<3dgs-truck>:<sad-drjohnson>:<3dgs-drjohnson> \
#       web-progress-renders-2.sh
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

render "$O/web-progress-sad-truck"       10 progress_sad_truck
render "$O/web-progress-3dgs-truck"      10 progress_3dgs_truck
render "$O/web-progress-sad-drjohnson"   10 progress_sad_drjohnson
render "$O/web-progress-3dgs-drjohnson"  10 progress_3dgs_drjohnson
echo DONE
