# LP-BEST: what merging YES with NO (the CTF's merge: one YES and one NO give back $1) would have freed on the live
# record. Live-prep held tokens, not a net position: a market could hold YES and NO at once (a BUY of NO while YES was
# held under N, and the reverse). The pairs held are capital a merge returns at once; the rest is real inventory.
#   LPBEST_WORK=<scratch> LPADV_WORK=<LP-ADVERSE scratch> python3 -I docs/agents/backtests/lpbest/scripts/merge.py > results/merge.txt
import os, sys, json, gzip, collections, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib

fills = json.load(open(os.path.join(os.environ['LPADV_WORK'], 'live_fills.json')))['rows']
ep = lambda s: datetime.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
ev = sorted(((ep(f['match_time']), f) for f in fills), key=lambda x: x[0])
held = collections.defaultdict(lambda: {'yes': 0.0, 'no': 0.0})
cost = collections.defaultdict(lambda: {'yes': 0.0, 'no': 0.0})
peak_pairs = 0.0; peak_t = None; peak_cost = 0.0; samples = []
for ts, f in ev:
    h = held[f['cond']]; c = cost[f['cond']]; o = f['o_outcome']; s = float(f['size']); p = float(f['price'])
    if f['side'] == 'BUY':
        h[o] += s; c[o] += s * p
    else:
        if h[o] > 0: c[o] -= c[o] * min(1.0, s / h[o])
        h[o] -= s
    pairs = sum(min(max(x['yes'], 0), max(x['no'], 0)) for x in held.values())
    held_cost = sum(v['yes'] + v['no'] for v in cost.values())
    samples.append((ts, pairs, held_cost))
    if pairs > peak_pairs: peak_pairs, peak_t = pairs, ts
    peak_cost = max(peak_cost, held_cost)
avg_pairs = sum(s[1] for s in samples) / len(samples)
print("LP-BEST: merge on the live record (live fills in time order; a pair is one YES and one NO of the same market)")
print(f"fills {len(ev)}; markets {len(held)}")
print(f"pairs held at their peak: {peak_pairs:.1f} (= ${peak_pairs:.2f} a merge returns at once), at {datetime.datetime.utcfromtimestamp(peak_t):%Y-%m-%d %H:%M} UTC")
print(f"pairs held on average over the fills: {avg_pairs:.1f}; held at cost at its peak: ${peak_cost:.2f}")
print(f"so merging would have freed at most {100 * peak_pairs / max(1e-9, peak_cost):.0f} % of the held cost at the pairs' peak; the rest is one-sided inventory")
