#!/bin/bash
#SBATCH --partition=a100p
#SBATCH --requeue
#SBATCH --gres=gpu:a100:1
#SBATCH --time=02:00:00
#SBATCH --job-name=web-flythrough-dolly2-fds
#SBATCH --output=/export/scratch/ra28kuc/slurm_logs/web-flythrough-dolly2-fds-%j.log

# FDS-GS half of the second dolly batch (their codebase + env, see
# web-flythrough-fds-retry.sh for why).
set -euo pipefail
source /export/home/ra28kuc/miniconda3-new/etc/profile.d/conda.sh
conda activate fdsgs
SCRIPTS=/export/home/ra28kuc/projects/thesis-webpage/asset_scripts
VIDEOS=/export/home/ra28kuc/projects/thesis-webpage/static/videos
WORK=/export/scratch/ra28kuc/webpage_assets/dolly2
CODE=/export/home/ra28kuc/projects/FDS-GS
O=/export/scratch/ra28kuc/output
mkdir -p "$VIDEOS" "$WORK"

SAD_BICYCLE=$O/newproj-sad_v1.7-bicycle-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial
SAD_STUMP=$O/newproj-sad_v1.7-stump-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial
SAD_TRUCK=$O/sad_v1.7-truck-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial
SAD_DRJ=$O/sad_v1.7-drjohnson-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial

render () {
  if [ -f "$WORK/$6.mp4" ]; then
    echo "[skip] $6.mp4 exists"; cp "$WORK/$6.mp4" "$VIDEOS/$6.mp4"; return
  fi
  WARG=""; [ "$3" != "-" ] && WARG="--width $3"
  python "$SCRIPTS/render_flythrough.py" \
    -m "$1" --path_from "$2" $WARG \
    --codebase "$CODE" --iteration 30000 \
    --frames 240 --fps 30 --ellipse_scale "$5" --dolly "$4" --ease 0.5 \
    --frames_dir "$WORK/$6_frames" --out "$WORK/$6.mp4"
  if [ -f "$WORK/$6.mp4" ]; then cp "$WORK/$6.mp4" "$VIDEOS/$6.mp4"; fi
}

render "$O/fds_gs-bicycle-s0"   "$SAD_BICYCLE" 1236 0.60 0.9 flythrough_fdsgs_bicycle
render "$O/fds_gs-stump-s0"     "$SAD_STUMP"   1244 0.60 0.9 flythrough_fdsgs_stump
render "$O/fds_gs-truck-s0"     "$SAD_TRUCK"   -    0.45 0.9 flythrough_fdsgs_truck
render "$O/fds_gs-drjohnson-s0" "$SAD_DRJ"     -    0.35 0.75 flythrough_fdsgs_drjohnson
echo DONE
