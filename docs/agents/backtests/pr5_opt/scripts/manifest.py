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
 'study': "PR5-OPT, 2026-10-27 (docs/agents/reviews/2026-10-27-pr5-rules-optimisation.md): LIVE's rules (PR5's paper engine carried out by the live executor, LIVE's 'at' fill rule, weekends on the held X) replayed at £600 with one change at a time: sizes per rung and per book, rung distances, exits, re-price, stops, gates, guards, skew, fair, holding. Not blind; no pre-registered reading run; nothing in production changed.",
 'read': "production, SELECT only, through the Supabase connector, 2026-10-27 03:07-03:45 UTC (sql/pulls.sql); LIVE's filled orders from ../scq_review/2026-10-26/data/live_orders.json.gz; the committed tape docs/agents/backtests/inputs/pr5_2026-09-23 through docs/agents/scripts/pr5/pr5_sim.py; the release list ../cbreview/inputs/events.json; the 2026-10-18 replay ../scq_review/2026-10-18/scripts/replay.py.",
 'run': [
  'python3 -I scripts/grab_text.py <saved connector reply of each statement of sql/pulls.sql> data && gzip -n -9 data/*.txt',
  'python3 -I scripts/check_paper.py   # results/check_paper.json: the paper layer against PR5\'s engine (273 of 273 trips)',
  'python3 -I scripts/calibrate.py     # results/calibration.json: the replay against LIVE at £10 a rung, 10-02 -> 10-26 (bps only)',
  'python3 -I scripts/experiments.py   # results/experiments.json: 55 candidates x FWD (at, at50, through), HIST (at, through), LONG (at); about nine minutes',
  'python3 -I scripts/robust.py        # results/robust.json: the shortlist by week, weekdays and closures, combinations, the engine/executor equivalence',
  'python3 -I scripts/dust_fills.py    # results/dust_fills.json: LIVE\'s entry fills under £1 since the £0.10 bot (counts and minutes)',
  'python3 -I scripts/power.py         # results/power.json: the proposed bar\'s power over 28 days',
  'python3 -I scripts/table.py         # results/table.md: the review\'s candidate table',
  'python3 -I scripts/usdt_weights.py  # results/usdt_weights.json: USDT-GBP 1:1, 3:2, 2:1, 3:1 and alone on every record, by week (variant-6 to -8, 0149); about four minutes',
  'python3 -I scripts/power_usdt.py    # results/power_usdt.json: the bar\'s power for 3:1 and USDT-GBP alone',
  'python3 -I scripts/grab_text.py <saved reply of each of sql/cb_pulls.sql C1-C5> data_cb && gzip -n -9 data_cb/*.txt',
  'python3 -I scripts/per_book.py      # results/per_book.json: each book alone on Revolut X and Coinbase, and the two-venue portfolios (PER-BOOK, 2026-10-27); about five minutes',
  'python3 -I scripts/manifest.py'
 ],
 'findings': [
  "The replay's paper layer reproduces all 273 of PR5's paper trips entered 2026-09-26 -> 10-26 (+$18.8879, 4 stops); against LIVE at £10 a rung it makes 1.20x LIVE's realised on clean days under LIVE's 'at' fill rule and 0.91x under 'through' (daily correlation 0.94 / 0.92).",
  "LIVE's rules at £600 on FWD (09-26 -> 10-27): 12.98 bps of capital a day ('at'), 10.27 ('through'); HIST 6.64 / 5.33; LONG 33.70.",
  "USDT-GBP at twice USDC-GBP's pounds: +1.24 bps/day (90 % +0.35 to +2.24), +1.22 under 'through', +0.51 HIST, +5.03 LONG, 39 of 39 long-tape weeks ahead.",
  "The 0.3 % rungs' money on the 0.1 / 0.2 % rungs (£75/£75/£0): +1.15 (90 % -0.17 to +2.32), +0.99 HIST, +1.26 LONG; behind in 8 of 39 long-tape weeks.",
  "A rung counted as held only above £1: +0.48 under 'at', +0.05 under 'through', 0 before the £0.10 bot of 10-08; 142 of LIVE's 232 USDT-GBP entry fills since 10-08 were under £1.",
  "USDT-GBP 3:1 (£75 / £25 rungs): +1.64 bps/day FWD at (+12.6 %), +1.77 through, +0.73 HIST, +7.21 LONG (38 of 39 weeks); USDT-GBP alone (£100 rungs): +2.38 (+18.3 %), +3.02, +1.10, +12.43 (38 of 39), worst HIST week -16.83 and worst marked LONG day -24.8 bps against LIVE's rules' -7.8.",
  "PER-BOOK (2026-10-27-per-book-returns.md): each book alone at £600 (£100 rungs), LIVE's 'at' fill, 10-17 -> 10-27: Revolut X USDT-GBP 16.26 bps/day, USDC-GBP 8.61; Coinbase USDC-GBP 9.39, USDC-EUR 6.75, USDT-GBP 0.43, USDT-EUR -0.50. At £600 in all, Revolut X USDT-GBP alone 16.26 beats £300 of it beside £300 of Coinbase USDC-GBP (13.97); at £1,200 the split (12.82) sits between Revolut X USDT-GBP alone (13.49) and LIVE's 1:1 (12.44).",
  "Weekend off: -5.41 bps/day. Wider ladders, a 0.4 % rung, other re-price steps, exit offsets, shorter stops, time gates, release blackouts, skew, a basis-adjusted fair and a tighter de-peg guard: no better or worse."
 ],
 'files': files,
}
json.dump(m, open(os.path.join(HERE, 'MANIFEST.json'), 'w'), indent=1, ensure_ascii=False)
print(len(files), 'files')
