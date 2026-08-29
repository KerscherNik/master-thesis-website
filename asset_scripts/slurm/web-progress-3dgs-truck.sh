#!/bin/bash
#SBATCH --partition=a100p
#SBATCH --requeue
#SBATCH --gres=gpu:a100:1
#SBATCH --time=08:00:00
#SBATCH --job-name=web-progress-3dgs-truck
#SBATCH --output=/export/scratch/ra28kuc/slurm_logs/web-progress-3dgs-truck-%j.log

# Webpage asset: 3DGS baseline on truck with dense --save_iterations.
set -euo pipefail
source /export/home/ra28kuc/miniconda3-new/etc/profile.d/conda.sh
conda activate gs-vanilla
export WANDB_DIR=/export/scratch/ra28kuc/wandb-runs; mkdir -p $WANDB_DIR
cd /export/scratch/ra28kuc/worktrees/sad-fixprune
PORT=$((10000 + SLURM_JOB_ID % 40000))
M=/export/scratch/ra28kuc/output/web-progress-3dgs-truck

python train.py \
  -s /export/home/ra28kuc/seganygaussians/data/tandt/truck \
  -m $M \
  --eval --resolution -1 --seed 0 --iterations 30000 --port $PORT \
  --lambda_dssim 0.2 --test_iterations 7000 30000 \
  --save_iterations 500 1000 2000 3000 5000 7000 10000 15000 20000 25000 30000 \
  --wandb --wandb_project "gaussian-splatting" \
  --wandb_entity niklas-cambridge-lmu-master-thesis-frepolad \
  --wandb_run_name "web-progress-3dgs-truck" \
  --wandb_tags note:webpage_progress variant:3DGS_baseline
echo DONE
