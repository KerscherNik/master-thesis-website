#!/bin/bash
#SBATCH --partition=a100p
#SBATCH --requeue
#SBATCH --gres=gpu:a100:1
#SBATCH --time=01:00:00
#SBATCH --job-name=web-flythrough-probe2
#SBATCH --output=/export/scratch/ra28kuc/slurm_logs/web-flythrough-probe2-%j.log

# Probes, kept out of the webpage repo:
#  - bicycle/stump with a deeper dolly (0.60): close enough to the bike
#    handles / bark to see method differences
#  - truck (T&T) with the standard params
#  - drjohnson (DB, indoor!) conservative: smaller orbit, shallower dolly
set -euo pipefail
source /export/home/ra28kuc/miniconda3-new/etc/profile.d/conda.sh
conda activate gs-vanilla
SCRIPTS=/export/home/ra28kuc/projects/thesis-webpage/asset_scripts
WORK=/export/scratch/ra28kuc/webpage_assets/probe2
CODE=/export/scratch/ra28kuc/worktrees/sad-fixprune
O=/export/scratch/ra28kuc/output
mkdir -p "$WORK"

probe () { # probe <model> <width_or_0> <dolly> <ease> <scale> <name>
  WARG=""; [ "$2" != "0" ] && WARG="--width $2"
  python "$SCRIPTS/render_flythrough.py" \
    -m "$1" --path_from "$1" $WARG \
    --codebase "$CODE" --iteration 30000 \
    --frames 240 --fps 30 --ellipse_scale "$5" --dolly "$3" --ease "$4" \
    --frames_dir "$WORK/$6_frames" --keep_frames --out "$WORK/$6.mp4"
}

probe "$O/newproj-sad_v1.7-bicycle-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial" 1236 0.60 0.5 0.9 probe_bicycle_d60
probe "$O/newproj-sad_v1.7-stump-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial"   1244 0.60 0.5 0.9 probe_stump_d60
probe "$O/sad_v1.7-truck-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial"           0    0.45 0.5 0.9 probe_truck
probe "$O/sad_v1.7-drjohnson-s0-FINAL-a1-ff0-pa32-p128-NOLPIPS-NOaxial"       0    0.35 0.5 0.75 probe_drjohnson
echo DONE
