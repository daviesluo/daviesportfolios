"""How far the fair the engine decided on differs from the same formula on the stored inputs read afterwards.

The engine stores its minute's fair (cb_quote_minutes.fair) as it decided it. The inputs are stored too, but the stored rows
are the latest version: PR5's paper engine re-writes the GBP/USD bars and hourly closes on every fetch, and the Coinbase test
re-writes the EUR/USD bars each minute (`upsert` on kind, t), so a bar Yahoo revised after the decision holds its revised
value. This recomputes fairU / FX at each lit weekday minute from the stored inputs and compares it with the stored fair, and
reports which input moved: the FX bar the minute read (its time is in cb_quote_minutes.x_t / eur_t), or the hourly F3.
usage: python3 -I revisions.py OUT.json
"""
import collections, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fpc as C  # noqa: E402

M = C.M


def main(out_path):
    fx = C.load_fx()
    revx = C.load_hours_revx()
    F = {c: C.F3(revx[c]) for c in ("USDC", "USDT")}
    res = {}
    for b in C.BOOKS:
        mm = C.load_minutes(b)
        k = "GBPUSD" if C.QUOTE[b] == "GBP" else "EURUSD"
        fxd = dict(zip(*fx[k]))
        d, n, big, same_bar = [], 0, 0, 0
        for m, r in sorted(mm.items()):
            if r["fair"] is None:
                continue
            t = m * M
            age = r["xage"] if k == "GBPUSD" else r["eage"]
            if age is None:
                continue
            bar_t = t - int(age) * M                     # the bar the engine read
            x = fxd.get(bar_t)
            u = F[C.COIN[b]](t)
            if x is None or u is None:
                continue
            v = (u / x / r["fair"] - 1) * 1e4
            n += 1
            d.append(v)
            if abs(v) > 0.5:
                big += 1
            # would the newest stored bar at t be the same one?
            if C.bar_at(t, *fx[k]) == x:
                same_bar += 1
        d.sort()
        q = lambda p: round(d[int(p * (len(d) - 1))], 3)
        res[b] = {"minutes": n, "share_abs_gt_0.5bp": round(big / n, 4), "abs_mean_bp": round(sum(abs(x) for x in d) / n, 3),
                  "p01": q(0.01), "p10": q(0.1), "median": q(0.5), "p90": q(0.9), "p99": q(0.99),
                  "share_newest_stored_bar_is_the_bar_read": round(same_bar / n, 4)}
    json.dump(res, open(out_path, "w"), indent=1)
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main(sys.argv[1])
