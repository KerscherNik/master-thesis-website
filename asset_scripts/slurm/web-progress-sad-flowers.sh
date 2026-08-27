#!/bin/bash
#SBATCH --partition=a100p
#SBATCH --requeue
#SBATCH --gres=gpu:a100:1
#SBATCH --time=08:00:00
#SBATCH --job-name=web-progress-sad-flowers
#SBATCH --output=/export/scratch/ra28kuc/slurm_logs/web-progress-sad-flowers-%j.log

# Webpage asset: SAD FINAL config (a1/ff0/pa32/p128, fft, no LPIPS, no axial)
# on flowers, with dense --save_iterations for the training-progress video.
# Code: sad-fixprune worktree (fix/deficit-prune-alignment @ 695aad9), the
# verified final-config state. Flags match slurm_verify_fixprune_flowers.sh.
# Reference run: newproj-sad_v1.7-flowers-s0-FINAL (PSNR 22.198, N 3.40M).

set -euo pipefail
source /export/home/ra28kuc/miniconda3-new/etc/profile.d/conda.sh
conda activate gs-vanilla
export WANDB_DIR=/export/scratch/ra28kuc/wandb-runs; mkdir -p $WANDB_DIR

cd /export/scratch/ra28kuc/worktrees/sad-fixprune
PORT=$((10000 + SLURM_JOB_ID % 40000))
M=/export/scratch/ra28kuc/output/web-progress-sad-flowers

python train.py \
  -s /export/home/ra28kuc/seganygaussians/data/360_v2/flowers \
  -m $M \
  --eval --resolution 4 --seed 0 --iterations 30000 --port $PORT \
  --sad_enable --sad_transform fft --sad_fft_patch 128 --sad_fft_stride 64 \
  --sad_depth_weight_lambda 1 --sad_densify_k_views 1 \
  --sad_prune_alpha 32 --sad_adaptive_alpha 1.0 --sad_floor_frac 0 \
  --sad_entropy_threshold 0.5 --sad_aniso_k 0.6 --sad_deficit_ema_beta 0 \
  --lambda_dssim 0.2 --test_iterations 7000 30000 \
  --save_iterations 500 1000 2000 3000 5000 7000 10000 15000 20000 25000 30000 \
  --wandb --wandb_project "gaussian-splatting-new" \
  --wandb_entity kerscher-nik-ludwig-maximilianuniversity-of-munich \
  --wandb_run_name "web-progress-sad-flowers" \
  --wandb_tags note:webpage_progress variant:SAD_FINAL_pure
echo DONE
