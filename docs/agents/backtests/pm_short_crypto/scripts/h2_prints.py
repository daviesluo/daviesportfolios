"""H2: every taker print of the two test days against the model and the outcome.

Each print becomes "a taker bought outcome X at price P" (a SELL of X at p is a buy of the other side at 1 - p, the
book being one book). Its realised P&L a share is win(X) - P - 0.07 P(1 - P). The model's fair price of X is read
LAG seconds before the print's stamp (the data API stamps a print ~2 s after its match, reference §3.39, so lag 0
can see past the match; lag 3 cannot). Prints results/h2_prints.json."""
import json, sys, os, gzip, math, statistics as st
sys.path.insert(0, os.path.dirname(__file__)); import model
M = {r["slug"]: r for r in json.load(open(sys.argv[1]))}; B = model.load_binance(sys.argv[2])
P = json.load(gzip.open(sys.argv[3], "rt")); K = {"5m": 1.75, "15m": 2.5}
out = {}
for kind, d in (("5m", 300), ("15m", 900)):
    res = {"prints": 0, "shares": 0.0, "usd": 0.0, "pnl": 0.0, "fees": 0.0}
    edge_b = {}; tau_b = {}; mis = {}
    for slug, rows in P.items():
        if f"-{kind}-" not in slug: continue
        m = M[slug]; s = int(slug.rsplit("-", 1)[1]); e = s + d
        for ts, oi, side, p, sz in rows:
            if not (s <= ts < e) or not (0 < p < 1): continue  # in-window prints only
            x = oi if side == "BUY" else 1 - oi; P_ = p if side == "BUY" else 1 - p
            y = (m["up_won"] if x == 0 else not m["up_won"])
            f = model.fee(P_); pnl = (1 if y else 0) - P_ - f
            res["prints"] += 1; res["shares"] += sz; res["usd"] += sz * P_; res["pnl"] += sz * pnl; res["fees"] += sz * f
            for lag in (0, 3):
                t = ts - lag
                if t <= s: continue
                q = model.fair_up(B, s, e, t, K[kind]); q = q if x == 0 else 1 - q
                ed = q - P_ - f
                bk = "<-5c" if ed < -0.05 else "-5..-2c" if ed < -0.02 else "-2..0c" if ed < 0 else "0..2c" if ed < 0.02 else "2..5c" if ed < 0.05 else "5..10c" if ed < 0.10 else ">=10c"
                a = edge_b.setdefault(f"lag{lag}", {}).setdefault(bk, [0, 0.0, 0.0, 0.0]); a[0] += 1; a[1] += sz; a[2] += sz * pnl; a[3] += sz * ed
                if lag == 3:
                    tau = e - ts; tb = "0-20s" if tau <= 20 else "20-60s" if tau <= 60 else "60-120s" if tau <= 120 else ">120s"
                    b = tau_b.setdefault(tb, [0, 0.0, 0.0, []]); b[0] += 1; b[1] += sz; b[2] += sz * pnl; b[3].append(abs(q - P_))
    out[kind] = {"in_window_taker_prints": res["prints"], "shares": round(res["shares"]), "usd_paid": round(res["usd"]),
                 "taker_pnl_usd": round(res["pnl"]), "taker_pnl_per_usd": round(res["pnl"] / res["usd"], 4), "taker_fees_usd": round(res["fees"]),
                 "by_model_edge_after_fee": {lag: {bk: {"prints": a[0], "shares": round(a[1]), "realised_pnl_per_share": round(a[2] / a[1], 4), "model_edge_per_share": round(a[3] / a[1], 4)} for bk, a in sorted(v.items())} for lag, v in edge_b.items()},
                 "by_time_left_lag3": {tb: {"prints": b[0], "realised_pnl_per_share": round(b[2] / b[1], 4), "median_abs_price_minus_model": round(st.median(b[3]), 4), "p90_abs": round(sorted(b[3])[int(0.9 * len(b[3]))], 4)} for tb, b in sorted(tau_b.items())}}
print(json.dumps(out, indent=1, sort_keys=True))
