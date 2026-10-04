import json, math, re, datetime
U = json.load(open('data/universe_1.json'))
read = datetime.datetime.fromisoformat(U['readAt'].replace('Z', '+00:00'))
rows = U['rows']
def ts(x):
    try: return datetime.datetime.fromisoformat(x.replace('Z', '+00:00'))
    except Exception: return None
def eligible(r, nmax=20, horizon_h=48, weather=True):
    if not r.get('book') or r.get('perDollarDay') is None: return False
    if r.get('accepting') is False or r.get('closed'): return False
    if r['N'] > nmax: return False
    e = ts(r['end']) if r.get('end') else None
    if e is not None and e < read + datetime.timedelta(hours=horizon_h): return False
    if weather and r.get('cat') == 'weather_fees': return False
    return True
def choose(c, budget, maxm):
    c = sorted(c, key=lambda r: (-r['perDollarDay'], r['cond']))
    out, used = [], 0.0
    for r in c:
        if len(out) >= maxm: break
        if used + r['cap'] <= budget + 1e-9: out.append(r); used += r['cap']
    return out, used
bands = [(1, 3), (3, 6), (6, 10), (10, 20), (20, 50), (50, 100), (100, 200), (200, 500), (500, 1e9), (6, 1e9), (10, 1e9), (20, 1e9), (50, 1e9), (1, 1e9)]
print(f"universe read {U['readAt']}: {len(rows)} markets with rate >= $1; scored {sum(1 for r in rows if r.get('perDollarDay'))}")
print("eligible = book scores, accepting, N <= 20, scheduled end > 48 h, not weather")
print(f"{'band':>12} {'listed':>6} {'elig':>5} {'p50 $/$/d':>9} {'p90':>6} {'max':>6} | choose($160, 8): {'n':>2} {'cap':>6} {'formula/d':>9} {'$/$/d':>6} | ($300, 20): {'n':>2} {'formula/d':>9} | ($320,40): {'n':>2} {'f/d':>7}")
for lo, hi in bands:
    listed = [r for r in rows if lo <= r['rate'] < hi]
    el = [r for r in listed if eligible(r)]
    pd = sorted(r['perDollarDay'] for r in el)
    q = lambda p: pd[min(len(pd) - 1, int(p * (len(pd) - 1)))] if pd else float('nan')
    c8, u8 = choose(el, 160, 8); c20, u20 = choose(el, 300, 20); c40, u40 = choose(el, 320, 40)
    f8 = sum(r['formulaDay'] for r in c8); f20 = sum(r['formulaDay'] for r in c20); f40 = sum(r['formulaDay'] for r in c40)
    name = f"${lo:g}-{'inf' if hi > 1e8 else f'{hi:g}'}"
    print(f"{name:>12} {len(listed):6d} {len(el):5d} {q(0.5):9.3f} {q(0.9):6.2f} {(pd[-1] if pd else float('nan')):6.2f} | {len(c8):17d} {u8:6.1f} {f8:9.2f} {f8 / u8 if u8 else float('nan'):6.3f} | {len(c20):11d} {f20:9.2f} | {len(c40):10d} {f40:7.2f}")
# what the whole-universe choice takes, by band
el = [r for r in rows if eligible(r) and r['rate'] >= 1]
c8, u8 = choose(el, 160, 8)
print("\nchoose($160, 8) over every eligible market (any rate >= $1):")
for r in c8: print(f"   rate {r['rate']:6.0f} v {r['v']:4} N {r['N']:3.0f} mid {r['m']:.3f} cap {r['cap']:5.2f} formula/d {r['formulaDay']:6.2f} $/$/d {r['perDollarDay']:.3f} others {r['others']:8.1f} | {str(r['q'])[:70]}")
c20, u20 = choose(el, 320, 40)
from collections import Counter
print("choose($320, 40) over every eligible market: bands of the picks", Counter(next(f'${lo:g}-{hi:g}' for lo, hi in bands[:9] if lo <= r['rate'] < hi) for r in c20))
