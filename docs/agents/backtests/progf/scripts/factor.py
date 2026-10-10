# PROGF: the programme factor of each TESTING Reward quotes row, per market-day, and its rewards before and after.
# python3 -I scripts/factor.py <pmrec dir> <saved minute pulls (sql/minutes.sql)>... > results/factor.txt
# For every rewarded minute of a row (its own minutes table, reward > 0) with the rate it priced the minute at (RW-C: its
# selection's; a paper layer: its path's minute row), the rate the CLOB's reward listing showed then, as pm-rec's universe
# frames read it (each market every 15 minutes, in the frame whose phase is its pm-rec id modulo 15; absent there = no
# programme, rate 0): the last reading at or before the minute, else the first within 30 minutes after it (a market not
# yet read that day). A minute with neither is UNCOVERED and keeps its formula (factor 1), counted apart.
#   factor(market-day) = sum(formula x rate then / rate used) / sum(formula)
# The same definition as lpcfg/scripts/rtrue.py (the rate's ratio only; the formula is linear in the rate), and as the
# migration 0115's `pm_prog_refresh`, which the Edge job `agents?action=pmprog` feeds; pm_prog.test.ts pins both on a
# closed-form case.
import gzip, json, glob, os, sys, bisect, datetime
from collections import defaultdict
pmrec, pulls = sys.argv[1], sys.argv[2:]
rows = {}
for p in pulls:
    o = json.load(open(p))
    rows[o['src']] = [r.split(',') for r in o['rows'].split(';')]
conds = sorted({r[0] for rs in rows.values() for r in rs})
ids = {}
for f in sorted(glob.glob(os.path.join(pmrec, 'markets_*.gz'))):
    for line in gzip.open(f, 'rt'):
        x = json.loads(line)
        if 'cond' in x and x['cond'] in set(conds): ids[x['id']] = x['cond']
reads = defaultdict(list)          # cond -> [(minute s, rate or None)]
hours = []
for f in sorted(glob.glob(os.path.join(pmrec, 'universe_*.gz'))):
    hours.append(os.path.basename(f)[9:22])
    hdr, got = None, {}
    def flush():
        if hdr is None: return
        t = int(datetime.datetime.fromisoformat(hdr['minute'].replace('Z', '+00:00')).timestamp())
        for i, c in ids.items():
            if i % hdr['phases'] == hdr['phase']:
                r = got.get(i); reads[c].append((t, r[2] if r else None))
    for line in gzip.open(f, 'rt'):
        x = json.loads(line)
        if isinstance(x, dict): flush(); hdr, got = x, {}
        elif x[0] in ids: got[x[0]] = x
    flush()
for c in reads: reads[c].sort()
if os.environ.get('DUMP_READS'):   # for scripts/pglite_check.mjs: every reading, as pm_prog_reads would hold it
    json.dump([[c, t, r] for c, xs in reads.items() for t, r in xs], open(os.environ['DUMP_READS'], 'w'))
first_read = min((v[0][0] for v in reads.values() if v), default=None)
last_read = max((v[-1][0] for v in reads.values() if v), default=None)
def rate_then(c, t):
    xs = reads.get(c)
    if not xs: return 'none'
    ts = [x[0] for x in xs]; i = bisect.bisect_right(ts, t) - 1
    if i >= 0: return xs[i][1] or 0.0
    j = i + 1
    if j < len(xs) and xs[j][0] - t <= 1800: return xs[j][1] or 0.0
    return 'none'
NAMES = {'rwc': "RW-C (\"Reward quotes\"; variant-1 and RW-X arms replay its minutes)", 'prep': 'mini-pool paper', 'midprep': 'mid-pool paper', 'lpprep': 'live-prep paper'}
out = {}
print(f"The programme factor by row and day. Listing reads {datetime.datetime.utcfromtimestamp(first_read):%Y-%m-%d %H:%M} -> {datetime.datetime.utcfromtimestamp(last_read):%Y-%m-%d %H:%M} UTC ({len(hours)} archive hours).")
print("formula = the row's rewards at R = 1 as it priced them; true = the same at the rate then; unc = rewarded minutes no reading covers (kept at factor 1).")
for src in ['rwc', 'prep', 'midprep', 'lpprep']:
    if src not in rows: continue
    agg = defaultdict(lambda: [0.0, 0.0, 0, 0])
    for c, t, rew, rate in rows[src]:
        t = int(t); rew = float(rew); rate = float(rate)
        day = datetime.datetime.utcfromtimestamp(t).strftime('%Y-%m-%d')
        a = agg[(day, c)]
        a[0] += rew; a[2] += 1
        rt = rate_then(c, t)
        if rt == 'none' or not rate > 0: a[1] += rew; a[3] += 1
        else: a[1] += rew * rt / rate
    out[src] = {f"{d}|{c}": [round(v[0], 6), round(v[1], 6), v[2], v[3]] for (d, c), v in agg.items()}
    print(f"\n== {NAMES[src]}")
    print(f"{'day':<12}{'markets':>8}{'formula':>10}{'true':>10}{'factor':>8}{'unc min':>9}{'of':>7}   before / after at the live R 0.81 (stress 0.65)")
    byday = defaultdict(lambda: [0.0, 0.0, 0, 0, 0])
    for (d, c), v in agg.items():
        b = byday[d]; b[0] += v[0]; b[1] += v[1]; b[2] += v[3]; b[3] += v[2]; b[4] += 1
    T = [0.0, 0.0, 0, 0]
    for d in sorted(byday):
        f, tr, unc, n, mk = byday[d]
        T[0] += f; T[1] += tr; T[2] += unc; T[3] += n
        print(f"{d:<12}{mk:>8}{f:>10.2f}{tr:>10.2f}{(tr / f if f else 1):>8.3f}{unc:>9}{n:>7}   {0.81 * f:>8.2f} -> {0.81 * tr:>7.2f}  ({0.65 * f:.2f} -> {0.65 * tr:.2f})")
    print(f"{'all':<12}{'':>8}{T[0]:>10.2f}{T[1]:>10.2f}{(T[1] / T[0] if T[0] else 1):>8.3f}{T[2]:>9}{T[3]:>7}   {0.81 * T[0]:>8.2f} -> {0.81 * T[1]:>7.2f}  ({0.65 * T[0]:.2f} -> {0.65 * T[1]:.2f})")
json.dump(out, open('results/factor_by_market_day.json', 'w'), separators=(',', ':'), sort_keys=True)
