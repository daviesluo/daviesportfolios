"""H7: who forecasts better, the print or the model? For each in-window taker print of the test days, the Brier score
of the print's price (as the bought side's probability) against the model's fair price read LAG s before the stamp, by
time left. A market that beats the model at lag 0 knows more than Binance's last second.
Usage: h7_brier.py markets.json binance_1s.json.gz prints.json.gz out.json"""
import json, sys, os, gzip
sys.path.insert(0, os.path.dirname(__file__)); import model
M = {r["slug"]: r for r in json.load(open(sys.argv[1]))}; B = model.load_binance(sys.argv[2])
P = json.load(gzip.open(sys.argv[3], "rt")); K = {"5m": 1.75, "15m": 2.5}
out = {}
for kind, d in (("5m", 300), ("15m", 900)):
    acc = {}
    for slug, rows in P.items():
        if f"-{kind}-" not in slug: continue
        m = M[slug]; s = int(slug.rsplit("-", 1)[1]); e = s + d
        for ts, oi, side, p, sz in rows[::5]:  # every fifth print
            if not (s + 3 < ts < e) or not (0 < p < 1): continue
            x = oi if side == "BUY" else 1 - oi; P_ = p if side == "BUY" else 1 - p
            y = 1 if (m["up_won"] if x == 0 else not m["up_won"]) else 0
            tau = e - ts; tb = "0-20s" if tau <= 20 else "20-60s" if tau <= 60 else "60-120s" if tau <= 120 else ">120s"
            for lag in (0, 3):
                q = model.fair_up(B, s, e, ts - lag, K[kind]); q = q if x == 0 else 1 - q
                a = acc.setdefault(f"lag{lag}|{tb}", [0, 0.0, 0.0]); a[0] += 1; a[1] += (P_ - y) ** 2; a[2] += (q - y) ** 2
    out[kind] = {k: {"n": a[0], "brier_print": round(a[1] / a[0], 4), "brier_model": round(a[2] / a[0], 4)} for k, a in sorted(acc.items())}
json.dump(out, open(sys.argv[4], "w"), indent=1, sort_keys=True)
for k, v in out.items():
    for kk, vv in v.items(): print(k, kk, vv)
