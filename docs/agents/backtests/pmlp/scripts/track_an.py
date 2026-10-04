import json, glob, datetime
U = json.load(open('data/universe_1.json'))
info = {r['cond']: r for r in U['rows']}
def ts(x):
    try: return datetime.datetime.fromisoformat(x.replace('Z', '+00:00'))
    except Exception: return None
reads = []
for k in range(20):
    try: reads.append(json.load(open(f'data/track_{k}.json')))
    except FileNotFoundError: break
print(f"{len(reads)} reads:", [r['at'][11:16] for r in reads])
def eligible(r, at):
    g = info.get(r['cond'], {})
    if not g.get('q'): return False          # only markets Gamma described at 15:21 (category, end, accepting known)
    if r.get('perDollarDay') is None or g.get('accepting') is False or g.get('closed') or g.get('cat') == 'weather_fees': return False
    if max(r['minSize'], 5) > 20: return False
    e = ts(g['end']) if g.get('end') else None
    day_end = at.replace(hour=0, minute=0, second=0, microsecond=0) + datetime.timedelta(days=1)
    return not (e is not None and e < day_end)
def top(read, n=10, budget=200):
    at = ts(read['at'])
    el = sorted([r for r in read['rows'] if eligible(r, at)], key=lambda r: (-r['perDollarDay'], r['cond']))
    out, used = [], 0.0
    for r in el:
        if len(out) >= n: break
        if used + r['cap'] <= budget + 1e-9: out.append(r); used += r['cap']
    return out
base = reads[0]
t0 = {r['cond']: r for r in top(base)}
print("the 10 picks at read 0, their first-round per-dollar and others' score at each later read:")
for c, r in t0.items():
    line = f"  {c[:10]} rate {r['rate']:5.0f} |"
    for rd in reads:
        x = next((y for y in rd['rows'] if y['cond'] == c), None)
        line += f" {x['perDollarDay']:.2f}/{x['others']:.0f}" if x and x.get('perDollarDay') is not None else "  dead "
    print(line, "|", str(info.get(c, {}).get('q'))[:50])
for i, rd in enumerate(reads):
    tp = top(rd)
    keep = len(set(x['cond'] for x in tp) & set(t0))
    f_now = sum(x['perDollarDay'] * x['cap'] for x in tp)
    # the read-0 picks' formula now (re-scored on this read's books)
    rows = {y['cond']: y for y in rd['rows']}
    f_old = sum((rows[c]['perDollarDay'] or 0) * (rows[c]['cap'] or 0) for c in t0 if c in rows and rows[c].get('perDollarDay') is not None)
    print(f"read {i} {rd['at'][11:16]}: top-10 first-round formula {f_now:7.2f}/day; read-0 picks re-scored {f_old:7.2f}/day ({100 * f_old / f_now if f_now else float('nan'):.0f} % of a fresh pick); {keep} of 10 picks still in the top 10")
