"""The books themselves, by year: how often they print, how much, and how far from fair, and the gap between adjacent
BUY and SELL prints (PR5's weekly regime measure). Descriptive; no rule is run here.

For each book and calendar year: prints and GBP volume a day; the median |print - fair| in bps over prints in minutes
with a fair; the share of GBP volume at least 10 / 20 / 30 bps from fair; the median gap between adjacent BUY and SELL
prints within 60 s (bps); the share of prints whose taker side is `auction`.
usage: python3 -I regime.py   -> ../results/regime.json
"""
import collections, datetime, json, os, statistics as st, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cj5_sim as C  # noqa: E402
import inputs as I  # noqa: E402

M, DAY = 60000, 86400000


def main():
    books, _, _ = C.build_books()
    R = {}
    for b, B in books.items():
        per = collections.defaultdict(lambda: {"n": 0, "gbp": 0.0, "dev": [], "far": [0.0, 0.0, 0.0], "gbp_fair": 0.0, "gap": [], "auction": 0})
        pr = B.all_prints
        for k, (ts, tk, q, s) in enumerate(pr):
            if not (B.t0 <= ts < B.t1):
                continue
            y = datetime.datetime.fromtimestamp(ts / 1000, datetime.timezone.utc).strftime("%Y")
            d = per[y]
            g = q * tk * 1e-4
            d["n"] += 1; d["gbp"] += g; d["auction"] += s == "auction"
            f = B.F[(ts - B.t0) // M]
            if f:
                dv = abs(tk * 1e-4 / f - 1) * 1e4
                d["dev"].append(dv); d["gbp_fair"] += g
                for j, thr in enumerate((10, 20, 30)):
                    if dv >= thr:
                        d["far"][j] += g
            if k and pr[k - 1][0] >= ts - 60000 and {pr[k - 1][3], s} == {"buy", "sell"}:
                d["gap"].append(abs(tk - pr[k - 1][1]) / tk * 1e4)
        out = {}
        for y, d in sorted(per.items()):
            a = max(I.ms(f"{y}-01-01T00:00"), B.t0); z = min(I.ms(f"{int(y) + 1}-01-01T00:00"), B.t1)
            days = (z - a) / DAY
            out[y] = {"days": round(days, 1), "prints_per_day": round(d["n"] / days, 1), "gbp_per_day": round(d["gbp"] / days, 0),
                      "median_abs_dev_from_fair_bps": round(st.median(d["dev"]), 2) if d["dev"] else None,
                      "share_gbp_ge_10_20_30bps": [round(x / d["gbp_fair"], 3) if d["gbp_fair"] else None for x in d["far"]],
                      "median_buy_sell_gap_bps": round(st.median(d["gap"]), 2) if d["gap"] else None, "auction_prints": d["auction"]}
        R[b] = out
        for y, v in out.items():
            print(b, y, v)
    json.dump(R, open(os.path.join(C.HERE, "results", "regime.json"), "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
