"""`cb_live` (Coinbase's own coin price: USDC 1, USDT Coinbase USDT-USD's last minute) against today's fair, book by book, from
hist.py's runs (Davies, 2026-10-29: "你测试的Coinbase上USDT换成Coinbase价格就更好，那usdc呢？"): for each book and window, both arms' P&L in
£ a year (£100 a rung, the book's £600), trips, stops, worst day, and the paired day-block bootstrap of the daily difference (£ a
year: mean, 5th and 95th percentile, and P(≤ 0)); the base rule and the weekend arm ("hold:").
usage: python3 -I cb_live_by_book.py HIST_RUNS.json.gz OUT.json
"""
import collections, gzip, json, os, random, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fpc as C  # noqa: E402


def main(runs_path, out_path):
    h = json.load(gzip.open(runs_path, "rt"))
    T0, TS, T1 = h["window"]["T0"], h["window"]["TS"], h["window"]["T1"]
    W = {"IS": (T0, TS), "OOS": (TS, T1)}
    res = {}
    for arm, (base, cand) in {"base": ("engine", "cb_live"), "weekend": ("hold:engine", "hold:cb_live")}.items():
        for key, d in h["books"].items():
            book = key.split(":")[1]
            for w, (a, z) in W.items():
                days = C.days_between(a, z)
                out = {}
                daily = {}
                for name in (base, cand):
                    sel = [x for x in d["runs"][name]["trips"] if a <= x[0] < z]
                    dd = collections.Counter()
                    for x in sel:
                        dd[C.day_of(x[0])] += x[2]
                    daily[name] = dd
                    out[name] = {"gbp_per_year": round(sum(x[2] for x in sel) / len(days) * 365, 2), "trips": len(sel),
                                 "stops": sum(1 for x in sel if x[4] == "t"), "worst_day": round(min(dd.get(q, 0.0) for q in days), 3)}
                v = [daily[cand].get(q, 0.0) - daily[base].get(q, 0.0) for q in days]
                rng = random.Random(20261029)
                s = sorted(sum(rng.choice(v) for _ in range(len(v))) / len(v) for _ in range(2000))
                out["delta_gbp_per_year"] = {"mean": round(sum(v) / len(v) * 365, 2), "p05": round(s[100] * 365, 2), "p95": round(s[1899] * 365, 2),
                                             "p_le_0": round(sum(1 for x in s if x <= 0) / 2000, 3)}
                res[f"{arm}|{book}|{w}"] = out
    json.dump(res, open(out_path, "w"), indent=1, sort_keys=True)
    for k, v in res.items():
        names = [n for n in v if n != "delta_gbp_per_year"]
        print(k, " | ".join(f"{n}: £{v[n]['gbp_per_year']}/y n={v[n]['trips']} st={v[n]['stops']} worst={v[n]['worst_day']}" for n in names), "| Δ", v["delta_gbp_per_year"])


if __name__ == "__main__":
    main(*sys.argv[1:3])
