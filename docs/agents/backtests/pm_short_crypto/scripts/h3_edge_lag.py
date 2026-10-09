"""H3: the prints the model calls cheap (edge after fee >= 5 c, >= 10 c), by how stale the model's read is (LAG seconds
before the print's stamp) and by time left. If the edge were open to a slow taker, the realised P&L would survive a
longer lag. Prints results/h3_edge_lag.json."""
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
        for ts, oi, side, p, sz in rows:
            if not (s <= ts < e) or not (0 < p < 1): continue
            x = oi if side == "BUY" else 1 - oi; P_ = p if side == "BUY" else 1 - p
            y = (m["up_won"] if x == 0 else not m["up_won"]); f = model.fee(P_); pnl = (1 if y else 0) - P_ - f
            tau = e - ts; tb = "0-20s" if tau <= 20 else "20-60s" if tau <= 60 else "60-120s" if tau <= 120 else ">120s"
            for lag in (0, 3, 10, 30):
                t = ts - lag
                if t <= s: continue
                q = model.fair_up(B, s, e, t, K[kind]); q = q if x == 0 else 1 - q
                ed = q - P_ - f
                for thr in (0.05, 0.10):
                    if ed >= thr:
                        for key in (f"lag{lag}|edge>={thr:.2f}|all", f"lag{lag}|edge>={thr:.2f}|{tb}"):
                            a = acc.setdefault(key, [0, 0.0, 0.0, 0.0, 0.0]); a[0] += 1; a[1] += sz; a[2] += sz * pnl; a[3] += sz * ed; a[4] += sz * P_
    out[kind] = {k: {"prints": a[0], "shares": round(a[1]), "usd": round(a[4]), "realised_pnl_usd": round(a[2]), "realised_per_share": round(a[2] / a[1], 4), "model_edge_per_share": round(a[3] / a[1], 4)} for k, a in sorted(acc.items())}
print(json.dumps(out, indent=1, sort_keys=True))
