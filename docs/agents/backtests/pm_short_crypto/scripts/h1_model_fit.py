"""H1: fit the variance multiplier k on the five training days (windows starting before 2026-10-07 19:00 UTC), then
read the model's calibration on the two test days, by time left. The outcome is the market's own (Chainlink).
Prints results/h1_model_fit.json."""
import json, sys, os, math
sys.path.insert(0, os.path.dirname(__file__)); import model
M = json.load(open(sys.argv[1])); B = model.load_binance(sys.argv[2])
SPLIT = 1791399600
def samples(kind, d, train):
    for r in M:
        if f"-{kind}-" not in r["slug"] or r["up_won"] is None: continue
        s = int(r["slug"].rsplit("-", 1)[1])
        if (s < SPLIT) != train or s - 1900 < B["t0"] or s + d > B["t0"] + len(B["c"]) - 1: continue
        for t in range(s + 5, s + d, 5): yield s, s + d, t, r["up_won"]
def ll(k, rows):
    tot = 0
    for s, e, t, y in rows:
        q = min(max(model.fair_up(B, s, e, t, k), 1e-4), 1 - 1e-4)
        tot += -math.log(q if y else 1 - q)
    return tot / len(rows)
out = {}
for kind, d in (("5m", 300), ("15m", 900)):
    tr = list(samples(kind, d, True)); te = list(samples(kind, d, False))
    grid = {k: ll(k, tr[::3]) for k in (1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0)}
    kbest = min(grid, key=grid.get)
    # calibration on test, by time left and by predicted bucket
    by_tau = {}
    for s, e, t, y in te:
        q = model.fair_up(B, s, e, t, kbest); tau = e - t
        b = "tau>120" if tau > 120 else "60<tau<=120" if tau > 60 else "20<tau<=60" if tau > 20 else "tau<=20"
        a = by_tau.setdefault(b, [0, 0.0, 0.0]); a[0] += 1; a[1] += (q - y) ** 2; a[2] += (0.5 - y) ** 2
    cal = {}
    for s, e, t, y in te:
        q = model.fair_up(B, s, e, t, kbest); bk = min(int(q * 10), 9)
        c = cal.setdefault(bk, [0, 0.0, 0]); c[0] += 1; c[1] += q; c[2] += y
    out[kind] = {"train_samples": len(tr), "test_samples": len(te), "logloss_by_k_train": {str(k): round(v, 5) for k, v in grid.items()},
                 "k": kbest, "test_logloss": round(ll(kbest, te), 5),
                 "test_brier_by_time_left": {b: {"n": a[0], "brier": round(a[1] / a[0], 4), "brier_coinflip": round(a[2] / a[0], 4)} for b, a in sorted(by_tau.items())},
                 "test_calibration": {f"{bk/10:.1f}-{(bk+1)/10:.1f}": {"n": c[0], "mean_q": round(c[1] / c[0], 4), "won": round(c[2] / c[0], 4)} for bk, c in sorted(cal.items())}}
print(json.dumps(out, indent=1, sort_keys=True))
