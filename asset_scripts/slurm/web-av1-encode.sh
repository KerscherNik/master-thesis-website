#!/bin/bash
#SBATCH --partition=a100p
#SBATCH --requeue
#SBATCH --time=02:00:00
#SBATCH --job-name=web-av1-encode
#SBATCH --output=/export/scratch/ra28kuc/slurm_logs/web-av1-encode-%j.log

# AV1 twins for every page video (svt-av1 preset 6, crf 30): ~50% smaller at
# SSIM ~0.99 vs the H.264 files. The page picks AV1 when the browser supports
# it and falls back to the H.264 originals otherwise. Idempotent.
set -euo pipefail
VIDEOS=/export/home/ra28kuc/projects/thesis-webpage/static/videos
mkdir -p "$VIDEOS/av1"
FF=$(command -v ffmpeg)
for f in "$VIDEOS"/*.mp4; do
  base=$(basename "$f")
  out="$VIDEOS/av1/$base"
  if [ -f "$out" ] && [ "$out" -nt "$f" ]; then echo "[skip] $base"; continue; fi
  echo "[encode] $base"
  "$FF" -y -v error -i "$f" -c:v libsvtav1 -preset 6 -crf 30 -g 240 \
    -pix_fmt yuv420p -movflags +faststart "$out"
  # quality gate: refuse silently degraded encodes
  ssim=$("$FF" -v info -i "$out" -i "$f" -lavfi ssim -f null - 2>&1 | grep -oP 'All:\K[0-9.]+' | tail -1)
  echo "  ssim $ssim"
  python3 -c "import sys; sys.exit(0 if float('$ssim') >= 0.97 else 1)" || { echo "SSIM TOO LOW: $base"; exit 1; }
done
echo DONE
