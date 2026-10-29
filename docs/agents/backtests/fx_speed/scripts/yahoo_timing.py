"""FX-SPEED part 1: when in time Yahoo's stored one-minute bar sits, measured against Exness's ticks over 2026-10-08 → 10-28.

For every weekday bar Yahoo stored (`fair_price_cb_okx/inputs/prod/fx.txt.gz`, the engines' own GBP/USD and EUR/USD), the
bar labelled t is compared with Exness's mid at instants t + s (s from −60 s to +118 s, at the offsets `exness.py` keeps):
the mean |difference| in bps after removing the median offset, and the signed median offset. The s with the smallest is when
the bar's value was the market's. Then the "a bar late" split of the Coinbase study (§2.6), against Exness rather than
Coinbase: the correlation of Yahoo's minute change (bar t − bar t−1) with Exness's change over [t + s0, t + 60 + s0] for
whole-minute shifts. Only minutes outside the FX closure, with both bars and every Exness value present.

usage: python3 -I yahoo_timing.py OUT.json
"""
import json, math, os, statistics as st, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "..", "fair_price_cb_okx", "scripts"))
import exness as E  # noqa: E402
import fpc as C  # noqa: E402

M = 60_000


def main(out):
    X = E.Offsets(os.path.join(HERE, "..", "data", "exness_offsets.txt.gz"))
    fx = C.load_fx()
    res = {}
    for pair in ("GBPUSD", "EURUSD"):
        ts, vs = fx[pair]
        y = dict(zip(ts, vs))
        inst = [(k, s) for k in (-1, 0, 1) for s in E.OFFSETS]     # t + k min + s s
        rows = []
        for t in ts:
            if C.is_closure(t) or C.is_closure(t + 2 * M):
                continue
            ex = [X.mid(pair, t + k * M, s) for k, s in inst]
            if any(v is None for v in ex):
                continue
            rows.append((t, y[t], ex))
        by = {}
        for j, (k, s) in enumerate(inst):
            d = [(v - ex[j]) / ex[j] * 1e4 for _, v, ex in rows]
            off = st.median(d)
            by[k * 60 + s] = {"mean_abs_bps": round(st.fmean(abs(x - off) for x in d), 4), "median_offset_bps": round(off, 3)}
        best = min(by, key=lambda s: by[s]["mean_abs_bps"])
        # changes: Yahoo's bar-to-bar change against Exness's minute change ending at t + 60 + 60 * shift (close to close)
        chg = {}
        for shift in (-1, 0, 1, 2):
            a, b = [], []
            for t, v, _ in rows:
                v0 = y.get(t - M)
                e1, e0 = X.mid(pair, t + M + shift * M, 0), X.mid(pair, t + shift * M, 0)
                if v0 is None or e1 is None or e0 is None:
                    continue
                a.append(v - v0); b.append(e1 - e0)
            ma, mb = st.fmean(a), st.fmean(b)
            cov = sum((x - ma) * (z - mb) for x, z in zip(a, b))
            chg[shift] = round(cov / math.sqrt(sum((x - ma) ** 2 for x in a) * sum((z - mb) ** 2 for z in b)), 3)
        res[pair] = {"bars": len(rows), "by_seconds_after_label": by, "best_seconds_after_label": best,
                     "change_corr_by_exness_minute_shift": chg}
        print(pair, len(rows), "best", best, by[best], "at end (60 s)", by[60], "chg", chg)
    json.dump(res, open(out, "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1])
