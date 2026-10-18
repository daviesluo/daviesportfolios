# Writes MANIFEST.json: what this folder is, how to re-run it, and every file's size and sha256.
#   python3 -I scripts/manifest.py   (from this folder)
import os, json, hashlib
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
files = []
for root, _, names in os.walk(HERE):
    for n in sorted(names):
        p = os.path.join(root, n); rel = os.path.relpath(p, HERE)
        if rel == 'MANIFEST.json' or '__pycache__' in rel: continue
        b = open(p, 'rb').read()
        files.append({'path': rel, 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()})
files.sort(key=lambda f: f['path'])
m = {
 'study': 'Stablecoin quotes review, 2026-10-18 (docs/agents/reviews/2026-10-18-stablecoin-quotes-review.md): every live and testing row on one basis, the Revolut X testing rows ranked, PR5 rule changes replayed one at a time, and the weekend (Revolut X and Coinbase). Not blind; no pre-registered reading run.',
 'read': 'production, SELECT only, through the Supabase connector, 2026-10-18 03:27-03:50 UTC (sql/); the committed tape docs/agents/backtests/inputs/pr5_2026-09-23 through docs/agents/scripts/pr5/pr5_sim.py (Book, fair_usd_minutes).',
 'run': [
  'python3 -I ../scripts/grab.py <saved connector reply of sql/pull_orders.sql> data   # the orders; data/meta.json copied in as it came',
  'python3 -I scripts/grab_text.py <saved connector reply of sql/pull_replay.sql> data && gzip -n -9 data/minutes.txt data/prints.txt data/paper_trips.txt',
  'npx --yes deno@1.46.3 run --allow-read --allow-write --allow-env --no-check scripts/page_pnl.ts   # results/page_pnl.json, by the page\'s own functions',
  'python3 -I scripts/replay.py check   # results/replay_check.json: the replay against PR5\'s 180 paper trips',
  'python3 -I scripts/compare.py   # results/compare.json',
  'python3 -I scripts/experiments.py   # results/experiments.json (about three minutes)',
  'python3 -I scripts/weekends.py; python3 -I scripts/weekend_books.py',
  'python3 -I scripts/manifest.py'
 ],
 'findings': [
  'The replay (scripts/replay.py, stepMinute line for line) reproduces all 180 of PR5\'s paper trips entered 2026-09-26 -> 10-17, +$12.2776, and the paper engine\'s 714 orders of 2026-10-01.',
  'Revolut X testing rows per pound a weekday, 09-28 -> 10-16: variant-2 (take50) 6.59 bps (90 % 3.54-10.51), variant-1 5.56, variant-3 4.84, Stablecoin quotes 4.61; variant-2 - variant-1 +1.03 (+0.23 to +2.02).',
  'LIVE: realised +£0.5793, unrealised -£0.5941, fees £0.0840; markouts +2.0 / +5.9 bps (no adverse selection).',
  'Rule changes replayed (FWD 09-26 -> 10-18, HIST 08-26 -> 09-23, both fill rules): only the weekend hold (PR5-W\'s rule) is better on every record (+£0.30 a day FWD at $100 a rung; +£0.056 at £10); an inner 0.05 % rung adds pounds at the same rate per pound; size, books, stop, re-price, exit offset, inventory caps and time gates are no better.',
  'Coinbase\'s Saturday 10-17 (+£0.80 in each row) is Friday entries closed by the 24-hour stop; no weekend-entered trip has closed yet.',
  'Weekend hold by weekend: 37 of 38 positive on the tape from 01-01, 4 of 4 from 08-26, 4 of 4 on PR5\'s own record.'
 ],
 'files': files,
}
json.dump(m, open(os.path.join(HERE, 'MANIFEST.json'), 'w'), indent=1, ensure_ascii=False)
print(len(files), 'files')
