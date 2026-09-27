"""VIEWS: is the view market calibrated as the deadline nears? (question 2's efficiency, and the pre-T question 4)

For every market of every exploration event with a high-confidence T, the book midpoint (CLOB minute history) at
T − 6 h, − 3 h, − 1 h, − 15 min and − 5 min, against whether the market's YES paid. Per price bin: markets, mean
midpoint, the share that paid, the difference and its binomial standard error; the Brier score against the one a
market priced at its bin's base rate would score. A bias a rule could use shows as a bin whose share paid sits
several standard errors away from its mean midpoint, the same way in more than one horizon. Clustered by event:
the markets of one event are one outcome, so the event count is the sample size that matters, and it is reported.

usage: calibration.py <universe json> <split json> <posting json> <out json>
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402

HORIZONS = [("T-6h", -21600), ("T-3h", -10800), ("T-1h", -3600), ("T-15m", -900), ("T-5m", -300)]
BINS = [0.0, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.95, 0.98, 1.0001]


def main():
    uni = {e["event"]: e for e in V.jfile(sys.argv[1])["events"]}
    held = set(V.jfile(sys.argv[2])["held_out_events"])
    post = [r for r in V.jfile(sys.argv[3])["events"] if r["event"] not in held and r.get("p_confidence") == "high"]
    out = {"events": len(post), "horizons": {}}
    for name, dt in HORIZONS:
        bins = [{"lo": BINS[i], "hi": BINS[i + 1], "n": 0, "events": set(), "sum_p": 0.0, "wins": 0} for i in range(len(BINS) - 1)]
        brier = base = 0.0
        n = 0
        for r in post:
            e = uni[r["event"]]
            hist = V.mids(r["event"])
            t = r["T"] + dt
            for m in e["markets"]:
                if m["payout_yes"] not in (0.0, 1.0) or not hist.get(m["yes"]):
                    continue
                p = None
                for tt, pp in hist[m["yes"]]:
                    if tt <= t:
                        p = pp
                    else:
                        break
                if p is None:
                    continue
                y = m["payout_yes"]
                b = next(x for x in bins if x["lo"] <= p < x["hi"])
                b["n"] += 1; b["sum_p"] += p; b["wins"] += int(y == 1.0); b["events"].add(r["event"])
                brier += (p - y) ** 2
                n += 1
        rows = []
        for b in bins:
            if not b["n"]:
                continue
            mp, wr = b["sum_p"] / b["n"], b["wins"] / b["n"]
            se = math.sqrt(max(mp * (1 - mp), 1e-9) / b["n"])
            rows.append({"bin": f"[{b['lo']:.2f},{min(b['hi'], 1):.2f})", "markets": b["n"], "events": len(b["events"]),
                         "mean_mid": round(mp, 4), "share_paid": round(wr, 4), "paid_minus_mid": round(wr - mp, 4),
                         "se": round(se, 4), "z": round((wr - mp) / se, 2)})
            base += b["n"] * wr * (1 - wr)
        out["horizons"][name] = {"markets": n, "brier": round(brier / n, 5) if n else None,
                                 "brier_if_each_bin_priced_at_its_rate": round(base / n, 5) if n else None, "bins": rows}
    with open(sys.argv[4], "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    for name, _ in HORIZONS:
        h = out["horizons"][name]
        print(name, "markets", h["markets"], "brier", h["brier"], "binned-rate brier", h["brier_if_each_bin_priced_at_its_rate"])
        for b in h["bins"]:
            print("   ", b)


if __name__ == "__main__":
    main()
