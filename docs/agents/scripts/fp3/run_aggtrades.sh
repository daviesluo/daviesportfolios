#!/bin/sh
HERE=$(cd "$(dirname "$0")" && pwd)
cd "${FP_ROOT:-.}/research_fp3"
for j in "EURIUSDT 2024-08" "EUREURI 2024-08" "XUSDUSDT 2025-03" "BFUSDUSDT 2025-08" "UUSDT 2026-01" "UUSDC 2026-01" "RLUSDUSDT 2026-01" "RLUSDU 2026-01" "USDTUSD 2025-11" "USDCUSD 2025-11"; do
  set -- $j
  python3 "$HERE/fetch_aggtrades.py" $1 $2 2026-09-21
done
