#!/bin/bash
#SBATCH --partition=a100p
#SBATCH --requeue
#SBATCH --gres=gpu:a100:1
#SBATCH --time=03:00:00
#SBATCH --job-name=web-flythrough-dolly2-main
#SBATCH --output=/export/scratch/ra28kuc/slurm_logs/web-flythrough-dolly2-main-%j.log

# Second dolly batch (probed in web-flythrough-probe2):
#  - bicycle + stump re-rendered deeper (dolly 0.60: bike handles, bark)
#  - truck (T&T, dolly 0.45) and drjohnson (DB indoor: smaller orbit 0.75,
#    shallower dolly 0.35) for SAD/3DGS/MCMC; width auto (res -1 rule).
set -euo pipefail
source /export/home/ra28kuc/miniconda3-new/etc/profile.d/conda.sh
conda activate gs-vanilla
SCRIPTS=/export/home/ra28kuc/projects/thesis-webpage/asset_scripts
VIDEOS=/export/home/ra28kuc/projects/thesis-webpage/static/videos
WORK=/export/scratch/ra28kuc/webpage_assets/dolly2
CODE=/export/scratch/ra28kuc/worktrees/sad-fixprune
O=/export/scratch/ra28kuc/output
mkdir -p "$VIDEOS" "$WORK"

SAD_BICYCLE=$O/newproj-sad_v1.7-bicycle-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial
SAD_STUMP=$O/newproj-sad_v1.7-stump-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial
SAD_TRUCK=$O/sad_v1.7-truck-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial
SAD_DRJ=$O/sad_v1.7-drjohnson-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial

render () {  # render <model> <path_from> <widthArg or -> <dolly> <scale> <basename>
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

render "$SAD_BICYCLE"                                   "$SAD_BICYCLE" 1236 0.60 0.9 flythrough_sad_bicycle
render "$O/3dgs-bicycle-s0"                             "$SAD_BICYCLE" 1236 0.60 0.9 flythrough_3dgs_bicycle
render "$O/mcmc-360_v2-bicycle-cap5700000-seed0-j54002" "$SAD_BICYCLE" 1236 0.60 0.9 flythrough_mcmc_bicycle

render "$SAD_STUMP"                                     "$SAD_STUMP" 1244 0.60 0.9 flythrough_sad_stump
render "$O/3dgs-stump-s0"                               "$SAD_STUMP" 1244 0.60 0.9 flythrough_3dgs_stump
render "$O/mcmc-360_v2-stump-cap4520000-seed0-j54020"   "$SAD_STUMP" 1244 0.60 0.9 flythrough_mcmc_stump

render "$SAD_TRUCK"                        "$SAD_TRUCK" - 0.45 0.9 flythrough_sad_truck
render "$O/3dgs-truck-s0"                  "$SAD_TRUCK" - 0.45 0.9 flythrough_3dgs_truck
render "$O/mcmc-truck-s0-cap2.06M-initsfm" "$SAD_TRUCK" - 0.45 0.9 flythrough_mcmc_truck

render "$SAD_DRJ"                              "$SAD_DRJ" - 0.35 0.75 flythrough_sad_drjohnson
render "$O/3dgs-drjohnson-s0"                  "$SAD_DRJ" - 0.35 0.75 flythrough_3dgs_drjohnson
render "$O/mcmc-drjohnson-s0-cap3.12M-initsfm" "$SAD_DRJ" - 0.35 0.75 flythrough_mcmc_drjohnson
echo DONE
