#!/bin/sh
# Binance's public bulk 1-minute klines (keyless, data.binance.vision), used only as a
# reference rate for Bitget's EUR and BRL books: EURUSDT, EURUSDC, USDTBRL.
cd "$(dirname "$0")/ref/binance"
for s in EURUSDT EURUSDC USDTBRL; do
  for m in 2025-09 2025-10 2025-11 2025-12 2026-01 2026-02 2026-03 2026-04 2026-05 2026-06 2026-07 2026-08; do
    f="$s-1m-$m.zip"; [ -s "$f" ] || curl -sS -m 60 -o "$f" "https://data.binance.vision/data/spot/monthly/klines/$s/1m/$f"
  done
  d=1; while [ $d -le 25 ]; do dd=$(printf "%02d" $d); f="$s-1m-2026-09-$dd.zip"
    [ -s "$f" ] || curl -sS -m 60 -o "$f" "https://data.binance.vision/data/spot/daily/klines/$s/1m/$f"; d=$((d+1)); done
done
ls | wc -l
