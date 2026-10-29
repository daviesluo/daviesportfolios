"""The OKX part of the fair-price study: how the OKX rows' fair (EUR/USD with every coin at exactly 1 EUR or 1 USD) sits
against what the books printed, and candidate fairs on OKX's history.

1. basis (production, okx_trades 10-19 → 10-29 and okx_books 10-28 19:53 → 10-29): every print, and each minute's book mid,
   against the rows' fair at that minute (Yahoo's stored EUR/USD bar, the engine's `fxBarAt`; a closure holds the last), and
   against a cross-venue fair from Coinbase's USDC-EUR touch read at the top of the print's minute (USDG-EUR: Coinbase's
   USDC-EUR mid, USDG taken as USDC; EURC-USDC: one over it, EURC taken as EUR).
2. history (OTHERVENUES' committed bars, ../../othervenues/inputs/: USDG-EUR 2026-02-23 → 10-27, EURC-USDC 09-21 → 10-27)
   through PR5's frozen simulator as OTHERVENUES ran it (`ov_sim.build_new`, £50 a rung, through the quote, and the
   at-price arm), the fair replaced: par (the OKX rows' rule), par × (1 + a × the trailing median of last print / par − 1)
   over L, OTHERVENUES' own (EURC-USDC: EUR/USD over Bitstamp USDC's F3), and Coinbase USDC-EUR's last print of the previous
   minute (USDG-EUR only, where SCQ-VENUES' bars reach: to 2026-10-09). This is NOT the OKX rows' fill model (a print at our
   price from the other side, by its size): that is okx_replay.ts's, on the short production tape.
usage: python3 -I okx.py OUT.json
"""
import bisect, collections, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(BT, "othervenues", "scripts"))
import fpc as C  # noqa: E402
import hist as HI  # noqa: E402
import ov_sim as OV  # noqa: E402
import sv_inputs as SI  # noqa: E402
P = OV.P
M, DAY = C.M, C.DAY


def q(xs, p):
    xs = sorted(xs)
    return None if not xs else round(xs[min(len(xs) - 1, int(p * (len(xs) - 1) + 0.5))], 3)


def summ(xs):
    return {"n": len(xs), "p10": q(xs, 0.1), "median": q(xs, 0.5), "p90": q(xs, 0.9), "mean": round(sum(xs) / len(xs), 3) if xs else None}


def basis():
    fx = C.load_fx()
    et, ev = list(fx["EURUSD"][0]), list(fx["EURUSD"][1])
    for l in C.lines("fx_1029"):
        k, m, v = l.split("\t")
        if k == "EURUSD":
            et.append(int(m) * M); ev.append(float(v))
    touch = C.load_touch()["USDC-EUR"]
    for l in C.lines("touch_1029"):
        b, m, s, bid, ask, bs, az = l.split("\t")
        touch[int(m)] = (float(s), float(bid), float(ask), float(bs), float(az))

    def eur(t):
        v = C.bar_at(t, et, ev)
        if v is None and C.is_closure(t):
            v = C.bar_at(t, et, ev, lookback=HI.HOLD_MS)
        return v

    def fair(book, t):
        x = eur(t)
        return None if x is None else (1 / x if book == "USDG-EUR" else x)

    def xv(book, m):
        r = touch.get(m)
        if not r:
            return None
        mid = (r[1] + r[2]) / 2
        return mid if book == "USDG-EUR" else 1 / mid

    res = collections.defaultdict(dict)
    rows = collections.defaultdict(lambda: collections.defaultdict(list))
    for l in C.lines("okx_trades"):
        book, tid, ts, px, sz, side = l.split("\t")
        t, px = int(ts), float(px)
        f = fair(book, t // M * M)
        if f:
            v = (px / f - 1) * 1e4
            rows[book]["prints vs par fair, all"].append(v)
            rows[book]["prints vs par fair, " + ("closure" if C.is_closure(t) else "weekday")].append(v)
            rows[book]["prints vs par fair, aggressor " + side].append(v)
            rows[book]["prints vs par fair, day " + C.day_of(t)].append(v)
        g = xv(book, t // M)
        if g:
            rows[book]["prints vs Coinbase USDC-EUR fair"].append((px / g - 1) * 1e4)
    for l in C.lines("okx_books"):
        book, ts, bid, ask, bs, az = l.split("\t")
        t = int(ts)
        mid = (float(bid) + float(ask)) / 2
        f = fair(book, t // M * M)
        if f:
            rows[book]["book mid vs par fair"].append((mid / f - 1) * 1e4)
            rows[book]["book spread, bps"].append((float(ask) / float(bid) - 1) * 1e4)
        g = xv(book, t // M)
        if g:
            rows[book]["book mid vs Coinbase USDC-EUR fair"].append((mid / g - 1) * 1e4)
    for b, d in rows.items():
        res[b] = {k: summ(v) for k, v in sorted(d.items())}
    return res


def cb_usdceur_last():
    """Coinbase USDC-EUR's last print by minute (SCQ-VENUES' bars, to 2026-10-09)."""
    bars, _ = SI.load_bars("coinbase:USDC-EUR")
    return {int(k) * M: b[5] / 1e8 for k, b in bars.items()}


def history():
    out = {}
    cbl = cb_usdceur_last()
    windows = {"okx:USDG-EUR": {"IS": (C.iso_ms("2026-02-23T00:00:00Z"), C.iso_ms("2026-07-01T00:00:00Z")),
                                "OOS": (C.iso_ms("2026-07-01T00:00:00Z"), OV.END)},
               "okx:EURC-USDC": {"all": (C.iso_ms("2026-09-21T00:00:00Z"), OV.END)}}
    for key in ("okx:USDG-EUR", "okx:EURC-USDC"):
        B = OV.build_new(key)
        n, t0 = B.n, B.t0
        quote = OV.OI.BOOKS[key][2]
        last = [None] * n
        for i, ps in B.by_min.items():
            last[i] = ps[-1][1] * B.meta["tick"]
        F_ov, X = list(B.F), list(B.X)
        par = [((1 / B.Xreal[i]) if quote == "EUR" else B.Xreal[i]) if (B.Xreal[i] and F_ov[i]) else None for i in range(n)]
        cands = {"par (the OKX rows')": par}
        if quote == "USDC":
            cands["OTHERVENUES' (EUR/USD over USDC's F3)"] = F_ov
        for L in ("6h", "24h", "72h"):
            adj = HI.rolling_basis(n, last, par, HI.LS[L])
            for a in (0.5, 1.0):
                cands[f"par+b{L}_{a}"] = [(par[i] * (1 + a * adj[i])) if (par[i] and adj[i] is not None) else par[i] for i in range(n)]
        if quote == "EUR":
            xvn, lv = [None] * n, None
            for i in range(n):
                t = t0 + i * M
                v = cbl.get(t - M)
                if v is not None:
                    lv = (v, t - M)
                xvn[i] = lv[0] if (par[i] and lv and lv[1] >= t - 10 * M and t < C.iso_ms("2026-10-09T00:00:00Z")) else None
            cands["Coinbase USDC-EUR last print"] = xvn
        res = {}
        for name, F in cands.items():
            for arm in ("through", "at_price"):
                B.F = F
                trips, orders = OV.run(B, key, 50.0, arm)
                r = {}
                for w, (a, z) in windows[key].items():
                    if name == "Coinbase USDC-EUR last print":
                        z = min(z, C.iso_ms("2026-10-09T00:00:00Z"))
                    sel = [x for x in trips if a <= x["t_entry"] < z]
                    pnl = sum(x["pnl"] for x in sel); nt = sum(x["notional"] for x in sel)
                    byday = collections.Counter()
                    for x in sel:
                        byday[C.day_of(x["t_entry"])] += x["pnl"]
                    r[w] = {"trips": len(sel), "pnl_gbp": round(pnl, 3), "gbp_per_day": round(pnl / ((z - a) / DAY), 4),
                            "bps_per_trip": round(1e4 * pnl / nt, 2) if nt else None, "stops": sum(1 for x in sel if x["how"] == "taker"),
                            "bids": sum(1 for x in sel if x["side"] == "bid"), "asks": sum(1 for x in sel if x["side"] == "ask"),
                            "daily": dict(byday), "days": C.days_between(a, z)}
                res[f"{name}|{arm}"] = r
        B.F = F_ov
        # paired bootstrap of each candidate against par, same arm, same window
        for k, r in res.items():
            name, arm = k.split("|")
            base = res[f"par (the OKX rows')|{arm}"]
            for w in r:
                d = r[w]["days"]
                bs = C.bootstrap_paired(r[w]["daily"], base[w]["daily"], d)
                r[w]["vs_par_gbp_per_day"] = {kk: round(v, 4) for kk, v in bs.items()}
        for k, r in res.items():
            for w in r:
                r[w].pop("daily"); r[w].pop("days")
        out[key] = res
    return out


def main(out_path):
    res = {"basis": basis(), "history": history()}
    json.dump(res, open(out_path, "w"), indent=1, sort_keys=True)
    for b, d in res["basis"].items():
        print(b)
        for k, v in d.items():
            if "day " not in k:
                print("  ", k, v)
    for key, r in res["history"].items():
        print(key)
        for k, v in r.items():
            print("  ", k, {w: (x["pnl_gbp"], x["gbp_per_day"], x["trips"], x["bps_per_trip"], x["stops"], f"b/a {x['bids']}/{x['asks']}", x["vs_par_gbp_per_day"]) for w, x in v.items()})


if __name__ == "__main__":
    main(sys.argv[1])
