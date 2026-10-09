# Writes MANIFEST.json: what this folder is, how it was read and run, and every file's bytes and sha256.
# python3 -I scripts/manifest.py
import hashlib, json, os
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
files = []
for root, _, names in os.walk(here):
    for n in sorted(names):
        p = os.path.join(root, n); rel = os.path.relpath(p, here)
        if rel == 'MANIFEST.json': continue
        b = open(p, 'rb').read()
        files.append({'path': rel, 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()})
m = {
    'study': "F3 of the 2026-10-09 stablecoin quotes review, validated (Davies, 2026-10-09: '\"F3 卖出价可以再挂远一个 tick\"完整验证一下'): PR5's rule carried out by its realistic twin (the production code: quotes_twin.ts, quotes_live.ts, revx_sim.ts) over the whole recorded history, 2026-09-23 15:09 -> 2026-10-09 16:00 UTC, at £100, £50 and £10 a rung, with the exit at fair, one and two ticks beyond it, and one tick falling back to fair after 60 minutes, under two fill assumptions. A measurement, not a test with a verdict; not blind (no no-peek rule since 2026-10-04).",
    'read': 'production, SELECT only, through the Supabase connector, 2026-10-09 16:26-16:30 UTC (sql/pull.sql), and the Revolut X public trade tape, keyless (scripts/fetch_tape.py)',
    'run': [
        'python3 -I scripts/grab.py <saved connector reply> data/raw   # each payload of sql/pull.sql, md5-checked; then gzip -n -9 data/raw/*.txt',
        'python3 -I scripts/build_inputs.py   # -> data/inputs.json.gz (the committed twins inputs + the delta + beats + gaps)',
        'SSL_CERT_FILE=<proxy CA, if any> python3 -I scripts/fetch_tape.py   # -> data/tape.txt.gz, results/tape_check.json',
        'sh scripts/run_all.sh <gen dir>   # scripts/patch.py writes the patched copies there; every arm through scripts/replay.ts -> results/runs/',
        'python3 -I scripts/compare.py pr5_o0_through pr5; python3 -I scripts/compare.py p50_o0_through p50   # -> results/baseline_check_*.json',
        'python3 -I scripts/analyze.py   # -> results/summary.json',
        'python3 -I scripts/manifest.py',
    ],
    'findings': [
        'Baseline (exit at fair, the twins own fill rule) reproduces production: pr5 76 trips, 66 won, 3 stops, +£8.6076 and p50 87, 75, 3, +£5.2830, the page figures to the penny; 167 of 168 (pr5) and 188 of 189 (p50) fills identical, the other the same 24-hour stop booked one turn earlier (10-08 02:57 against 02:58); the unfilled orders differ only on 10-07 and early 10-08, the dead-man storm, where production beats are partly gone (results/baseline_check_*.json).',
        'The stored prints equal the public tape: 3,849 UK prints from 2026-09-23 15:00, none missing or different (results/tape_check.json).',
        'Through-only fills (the twins): one tick beyond fair pr5 +£0.652 (+7.6 %, both halves up, bootstrap 5th pct +£0.0108 a day), p50 +£0.244 (+4.6 %, second half +£0.007, 5th pct -£0.014), s10 -£0.014. At-price fills too: pr5 -£0.702, p50 -£0.198, s10 -£0.047. LIVE filled 22 of its 44 maker exits with no print through them (results/live_fills.json), and LIVE trips median 24 min against 29 (at) and 50 (through) for its size replayed: the at-price assumption is the nearer one for exits at fair.',
        'One tick costs inventory and time: hold p90 pr5 429 -> 609 min, p50 386 -> 891 min (through); time-weighted positions pr5 £45.7 -> £57.4, p50 £26.0 -> £33.7; GBP/USD sigma 0.32 % a day. Two ticks and the 60-minute fallback are no better on both assumptions.',
        'Not recommended for LIVE. The p50x1 twin, run on the through-only simulator, can only see the side of the trade that favours it: its bar should not be read as evidence for LIVE without an at-price reading (results/summary.json).',
    ],
    'files': files,
}
json.dump(m, open(os.path.join(here, 'MANIFEST.json'), 'w'), indent=1, ensure_ascii=False)
print(len(files), 'files')
