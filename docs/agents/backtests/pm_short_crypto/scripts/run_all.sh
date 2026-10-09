#!/bin/sh
# Re-runs every analysis from the committed inputs (no network): H0-H3 and H5-H7 on the 7-day history, L1-L4 on the
# live recording. The pulls (pull_*.py, recorder.py, recorder2.py) and H4 (which re-reads prints with their wallets)
# read live public feeds and are not re-run here.
set -e
cd "$(dirname "$0")/.."
D=data; R=results; T=$(mktemp -d)
python3 scripts/h0_resolution.py $D/markets_7d.json $D/binance_btcusdt_1s.json.gz > $R/h0_resolution.json
python3 scripts/h1_model_fit.py $D/markets_7d.json $D/binance_btcusdt_1s.json.gz > $R/h1_model_fit.json
python3 scripts/h2_prints.py $D/markets_7d.json $D/binance_btcusdt_1s.json.gz $D/prints_2d.json.gz > $R/h2_prints.json
python3 scripts/h3_edge_lag.py $D/markets_7d.json $D/binance_btcusdt_1s.json.gz $D/prints_2d.json.gz > $R/h3_edge_lag.json
python3 scripts/h5_price_buckets.py $D/markets_7d.json $D/prints_2d.json.gz $R/h5_price_buckets.json > /dev/null
python3 scripts/h6_hedge_and_pool.py $D/binance_btcusdt_1s.json.gz $R/h2_prints.json $R/h6_hedge_and_pool.json > /dev/null
python3 scripts/h7_brier.py $D/markets_7d.json $D/binance_btcusdt_1s.json.gz $D/prints_2d.json.gz $R/h7_brier.json > /dev/null
gunzip -c $D/live/ref.jsonl.gz > $T/ref.jsonl; gunzip -c $D/live/clob.jsonl.gz > $T/clob.jsonl; gunzip -c $D/live/ref2.jsonl.gz > $T/ref2.jsonl
python3 scripts/l1_leadlag.py $T/ref.jsonl $T/clob.jsonl $R/l1_leadlag.json $T/ref2.jsonl > /dev/null
for DRV in cb bf; do  # the fast feed: Coinbase, or Binance's USD-M perp
  DRIVER=$DRV REF2=$T/ref2.jsonl python3 scripts/l2_opportunities.py $T/ref.jsonl $T/clob.jsonl $D/live/binance_1s.json.gz $D/live/outcomes.json $R/l2_opportunities_$DRV.json > /dev/null
  DRIVER=$DRV REF2=$T/ref2.jsonl python3 scripts/l3_maker.py $T/ref.jsonl $T/clob.jsonl $D/live/binance_1s.json.gz $D/live/outcomes.json $R/l3_maker_$DRV.json > /dev/null
done
python3 scripts/l4_response.py $T/ref.jsonl $T/clob.jsonl $R/l4_response.json > /dev/null
rm -rf "$T"
echo done
