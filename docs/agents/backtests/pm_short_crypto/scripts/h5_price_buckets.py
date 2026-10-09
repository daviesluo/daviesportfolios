"""H5: a slow, model-free rule — buy at a price band in a time-left band — read from the prints of the two test days:
the realised P&L a share after the taker fee, by the bought side's price and the time left. A taker print is an
informed sample (someone chose to take it), so this flatters a rule that buys at a fixed time; a band that loses here
loses at a fixed time too. Usage: h5_price_buckets.py markets.json prints.json.gz out.json"""
import json, sys, gzip, os
sys.path.insert(0, os.path.dirname(__file__)); import model
M = {r["slug"]: r for r in json.load(open(sys.argv[1]))}; P = json.load(gzip.open(sys.argv[2], "rt"))
out = {}
for kind, d in (("5m", 300), ("15m", 900)):
    acc = {}; wins = {}
    for slug, rows in P.items():
        if f"-{kind}-" not in slug: continue
        m = M[slug]; s = int(slug.rsplit("-", 1)[1]); e = s + d
        for ts, oi, side, p, sz in rows:
            if not (s <= ts < e) or not (0 < p < 1): continue
            x = oi if side == "BUY" else 1 - oi; P_ = p if side == "BUY" else 1 - p
            y = m["up_won"] if x == 0 else not m["up_won"]; pnl = (1 if y else 0) - P_ - model.fee(P_)
            pb = min(int(P_ * 10), 9); tau = e - ts
            tb = "0-30s" if tau <= 30 else "30-120s" if tau <= 120 else ">120s"
            k = f"{tb}|{pb/10:.1f}-{(pb+1)/10:.1f}"
            a = acc.setdefault(k, [0, 0.0, 0.0, set()]); a[0] += 1; a[1] += sz; a[2] += sz * pnl; a[3].add(slug)
    out[kind] = {k: {"prints": a[0], "windows": len(a[3]), "shares": round(a[1]), "pnl_per_share": round(a[2] / a[1], 4)} for k, a in sorted(acc.items())}
json.dump(out, open(sys.argv[3], "w"), indent=1, sort_keys=True)
for k, v in out.items():
    for kk, vv in v.items(): print(k, kk, vv)
