"""CB screen: symbol-days of the top-10 universe on which a 5 % two-minute drop is possible
(some hour h with low_h < max(high_h, high_{h-1}) * 0.95), from hourly klines. Writes
data/cb_screen.json {symbol: [days]} and data/jobs_cb_1m.json {symbol: [day-1, day, day+1 ...]}."""
import json, os, datetime
S = os.environ.get("FP_ROOT", ".") + "/research_fp3"
U = json.load(open(os.path.join(S, 'data', 'universe_top10.json')))
days_in = {}
for d, syms in U.items():
    if d < '2020-01-01' or d > '2026-09-21': continue
    for s in syms: days_in.setdefault(s, set()).add(d)
screen = {}; jobs = {}; nhours = 0
for s, dset in sorted(days_in.items()):
    fn = os.path.join(S, 'data', 'bn_1h', f'{s}.json')
    if not os.path.exists(fn): print('MISSING hourly', s); continue
    rows = json.load(open(fn)); prev_high = None; flagged = set()
    for r in rows:
        t, o, h, l, c = r[0], r[1], r[2], r[3], r[4]
        d = datetime.datetime.utcfromtimestamp(t/1000).date().isoformat()
        ref = h if prev_high is None else max(h, prev_high)
        if d in dset and l < ref * 0.95: flagged.add(d)
        prev_high = h; nhours += 1
    if flagged:
        screen[s] = sorted(flagged)
        need = set()
        for d in flagged:
            dd = datetime.date.fromisoformat(d)
            for k in (-1, 0, 1):
                x = dd + datetime.timedelta(days=k)
                if x <= datetime.date(2026, 9, 22): need.add(x.isoformat())
        jobs[s] = sorted(need)
json.dump(screen, open(os.path.join(S, 'data', 'cb_screen.json'), 'w'), indent=0)
json.dump(jobs, open(os.path.join(S, 'data', 'jobs_cb_1m.json'), 'w'), indent=0)
print('symbols', len(days_in), 'screened symbols', len(screen), 'screened days', sum(len(v) for v in screen.values()), 'daily files', sum(len(v) for v in jobs.values()))
