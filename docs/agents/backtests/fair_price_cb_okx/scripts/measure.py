"""Part 2 of the fair-price study: how good the Coinbase rows' fair was, measured on what happened (production, 10-10 → 10-29).

Read-only on the committed pulls (../inputs/prod/). Every figure is in bps of price unless it says otherwise.
  basis      the touch mid at the top of minute m (cb_touch) against the fair the engine decided m on (cb_quote_minutes;
             the weekend arm's held fair, cb_hold_minutes, inside a closure), split into the coin's peg gap (the coin's
             dollar price on Coinbase against Revolut X's USD-book F3, which the engine uses) and what is left
  error      |mid(m + N) / fair(m) - 1| for each candidate fair known at m (no look-ahead: every input is a bar or close
             that ended before m), N = 0, 1, 5, 15, 60 minutes
  markouts   every paper fill of the three arms ("with Euros", "- 1", "- 2"): the touch mid N minutes later against the
             fill price, signed so that POSITIVE is against us (adverse), by book, side, rung, hour and weekday/weekend
  stale      the FX bar's age at each lit minute, and fills whose fair, recomputed on the FX bar of the fill's own minute
             (known only a minute later), was already through the fill price
  crossed    post-only refusals per order placed (cb_*_events), and where the 0.1 % rungs sat against the touch
  lag        Yahoo's minute bars against Coinbase's own implied FX (USDT-USD candle ÷ the USDT book's mid), by shift
usage: python3 -I measure.py OUT.json
"""
import bisect, collections, json, os, statistics as st, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fpc as C  # noqa: E402

M, H, DAY = C.M, C.H, C.DAY
T0, T1 = C.iso_ms("2026-10-10T00:00:00Z"), C.iso_ms("2026-10-29T00:00:00Z")


def q(xs, p):
    xs = sorted(xs)
    return None if not xs else xs[min(len(xs) - 1, int(p * (len(xs) - 1) + 0.5))]


def summ(xs):
    if not xs:
        return {"n": 0}
    return {"n": len(xs), "median": round(q(xs, 0.5), 3), "mean": round(sum(xs) / len(xs), 3), "p10": round(q(xs, 0.1), 3), "p90": round(q(xs, 0.9), 3)}


def main(out_path):
    touch = C.load_touch()
    fx = C.load_fx()
    revx = C.load_hours_revx()
    ut, uv = C.load_cb_usdt_1m()
    cbh = C.hourly_from_minutes(ut, uv)
    F3R = {c: C.F3(revx[c]) for c in ("USDC", "USDT")}
    F3CB = C.F3(cbh)
    trips = C.load_trips()
    res = {"window": ["2026-10-10T00:00Z", "2026-10-29T00:00Z"]}

    def mid(b, m):
        r = touch[b].get(m)
        return None if r is None else (r[1] + r[2]) / 2

    def fxv(b, t):
        k = "GBPUSD" if C.QUOTE[b] == "GBP" else "EURUSD"
        return C.bar_at(t, *fx[k])

    def cb_usdt_live(t):
        return C.bar_at(t, ut, uv, lookback=10 * M)

    minutes = {b: C.load_minutes(b) for b in C.BOOKS}

    # ---------------------------------------------------------------- basis and its parts
    basis = {}
    for b in C.BOOKS:
        mm = minutes[b]
        rows = collections.defaultdict(list)
        for m, r in mm.items():
            t = m * M
            md = mid(b, m)
            f = r["fair"] if r["fair"] is not None else (r["hfair"] if C.is_closure(t) else None)
            if md is None or f is None:
                continue
            arm = "weekday (base fair)" if r["fair"] is not None else "closure (held fair)"
            bps = (md / f - 1) * 1e4
            rows[arm].append(bps)
            rows["day " + C.day_of(t)].append(bps)
            hh = (t // H) % 24
            rows["hour %02d-%02d" % (hh // 4 * 4, hh // 4 * 4 + 4)].append(bps)
            # the peg gap: the coin's dollar price on Coinbase (USDC 1:1; USDT its USD book's last minute) against the engine's F3
            fu = F3R[C.COIN[b]](t)
            own = 1.0 if C.COIN[b] == "USDC" else cb_usdt_live(t)
            if fu and own and r["fair"] is not None:
                gap = (own / fu - 1) * 1e4
                rows["peg gap (coin on Coinbase vs Revolut X F3)"].append(gap)
                rows["residual (basis less peg gap)"].append(bps - gap)
        basis[b] = {k: summ(v) for k, v in sorted(rows.items())}
    res["basis"] = basis

    # ---------------------------------------------------------------- candidate fairs known at m, and their error later
    def cand(b, m, name, L=None):
        t = m * M
        X = fxv(b, t)
        if X is None:
            return None
        c = C.COIN[b]
        if name == "engine":
            u = F3R[c](t)
        elif name == "par":
            u = 1.0
        elif name == "cb_f3":
            u = 1.0 if c == "USDC" else F3CB(t)
        elif name == "cb_live":
            u = 1.0 if c == "USDC" else cb_usdt_live(t)
        else:
            raise ValueError(name)
        return None if not u else u / X

    names = ["engine", "par", "cb_f3", "cb_live"]
    err = {}
    for b in C.BOOKS:
        mm = minutes[b]
        # the engine fair's trailing basis (median over L of the touch mid read at the top of each earlier minute)
        ms = sorted(m for m in mm if T0 // M <= m < T1 // M)
        e = {n: {N: [] for N in (0, 1, 5, 15, 60)} for n in names + ["engine+basis6h", "engine+basis24h", "cb_live+basis24h"]}
        sgn = {n: [] for n in e}
        hist = collections.deque()          # (m, engine-fair basis, cb_live basis) for minutes before m
        for m in ms:
            t = m * M
            if mm[m]["fair"] is None or C.is_closure(t):
                continue
            fs = {n: cand(b, m, n) for n in names}
            # trailing basis from minutes strictly before m
            while hist and hist[0][0] < m - 24 * 60:
                hist.popleft()
            b6 = [h[1] for h in hist if h[0] >= m - 360 and h[1] is not None]
            b24 = [h[1] for h in hist if h[1] is not None]
            b24c = [h[2] for h in hist if h[2] is not None]
            fs["engine+basis6h"] = fs["engine"] * (1 + st.median(b6)) if fs["engine"] and len(b6) >= 30 else None
            fs["engine+basis24h"] = fs["engine"] * (1 + st.median(b24)) if fs["engine"] and len(b24) >= 120 else None
            fs["cb_live+basis24h"] = fs["cb_live"] * (1 + st.median(b24c)) if fs["cb_live"] and len(b24c) >= 120 else None
            for n, f in fs.items():
                if f is None:
                    continue
                for N in (0, 1, 5, 15, 60):
                    md = mid(b, m + N)
                    if md is not None:
                        e[n][N].append(abs(md / f - 1) * 1e4)
                        if N == 0:
                            sgn[n].append((md / f - 1) * 1e4)
            md0 = mid(b, m)
            hist.append((m, (md0 / fs["engine"] - 1) if (md0 and fs["engine"]) else None,
                         (md0 / fs["cb_live"] - 1) if (md0 and fs["cb_live"]) else None))
        err[b] = {n: {"mae_bps_by_N": {str(N): round(sum(v) / len(v), 3) if v else None for N, v in d.items()},
                      "signed_now": summ(sgn[n])} for n, d in e.items()}
    res["error"] = err

    # ---------------------------------------------------------------- fills' markouts
    mk = collections.defaultdict(lambda: collections.defaultdict(list))
    edge = collections.defaultdict(list)
    for x in trips:
        b, side, px, ft = x["book"], x["side"], float(x["entry"]), x["fill_ts_ms"]
        m0 = ft // M
        md_before = mid(b, m0)                   # read at the top of the fill's minute, before the fill
        keys = ["all", "arm " + x["arm"], "book " + b, "side " + side, "rung %.1f%%" % (100 * float(x["k"])),
                "weekend" if C.is_closure(ft) else "weekday", "hour %02d-%02d" % ((ft // H) % 24 // 4 * 4, (ft // H) % 24 // 4 * 4 + 4),
                "book×side " + b + " " + side]
        if md_before:
            ed = ((md_before - px) / px if side == "bid" else (px - md_before) / px) * 1e4      # what we earned against the mid at fill
            for k in keys:
                edge[k].append(ed)
        for N in (1, 5, 15, 60, 240):
            md = mid(b, m0 + N)
            if md is None:
                continue
            adv = ((px - md) / px if side == "bid" else (md - px) / px) * 1e4                  # positive = against us
            for k in keys:
                mk[k][N].append(adv)
    res["markouts"] = {k: {"edge_at_fill_vs_mid_bps": summ(edge[k]), "adverse_bps_by_N": {str(N): summ(v) for N, v in d.items()}}
                       for k, d in sorted(mk.items())}
    # trips' own result by arm and book
    tb = collections.defaultdict(lambda: {"trips": 0, "pnl_gbp": 0.0, "notional_gbp": 0.0, "stops": 0, "stop_pnl_gbp": 0.0})
    for x in trips:
        for k in ("arm " + x["arm"], "arm×book " + x["arm"] + " " + x["book"], "arm×book×side " + x["arm"] + " " + x["book"] + " " + x["side"]):
            d = tb[k]
            d["trips"] += 1; d["pnl_gbp"] += float(x["pnl_gbp"]); d["notional_gbp"] += float(x["notional_gbp"])
            if x["how"] == "taker":
                d["stops"] += 1; d["stop_pnl_gbp"] += float(x["pnl_gbp"])
    res["trips"] = {k: {**v, "pnl_gbp": round(v["pnl_gbp"], 4), "stop_pnl_gbp": round(v["stop_pnl_gbp"], 4),
                        "bps_per_trip": round(1e4 * v["pnl_gbp"] / v["notional_gbp"], 2) if v["notional_gbp"] else None,
                        "notional_gbp": round(v["notional_gbp"], 2)} for k, v in sorted(tb.items())}

    # ---------------------------------------------------------------- stale FX
    stale = {}
    for b in C.BOOKS:
        ages = [r["xage"] if C.QUOTE[b] == "GBP" else max(r["xage"] or 0, r["eage"] or 0) for m, r in minutes[b].items() if r["fair"] is not None and r["xage"] is not None]
        stale[b] = {"lit_minutes": len(ages), "age_minutes": {str(a): sum(1 for x in ages if x == a) for a in sorted(set(ages))[:12]},
                    "share_age_ge_2": round(sum(1 for x in ages if x >= 2) / len(ages), 4) if ages else None,
                    "share_age_ge_3": round(sum(1 for x in ages if x >= 3) / len(ages), 4) if ages else None}
    sf = collections.Counter(); sp = collections.Counter()
    for x in trips:
        b, side, px, ft = x["book"], x["side"], float(x["entry"]), x["fill_ts_ms"]
        m0 = ft // M * M
        k = "GBPUSD" if C.QUOTE[b] == "GBP" else "EURUSD"
        ts, vs = fx[k]
        j = bisect.bisect_left(ts, m0)
        if j >= len(ts) or ts[j] != m0:
            continue
        u = F3R[C.COIN[b]](m0)
        if not u:
            continue
        fnew = u / vs[j]                   # the fair on the bar of the fill's own minute (known a minute later)
        through = (side == "bid" and px > fnew) or (side == "ask" and px < fnew)
        key = x["arm"]
        sf[key + " fills"] += 1
        if through:
            sf[key + " stale"] += 1; sp[key + " stale pnl_gbp"] += float(x["pnl_gbp"])
    stale["fills_through_next_bar_fair"] = dict(sf) | {k: round(v, 4) for k, v in sp.items()}
    res["stale"] = stale

    # ---------------------------------------------------------------- crossed: refusals and where the 0.1 % rungs sat
    ev = collections.defaultdict(lambda: collections.Counter())
    for l in C.lines("events_daily"):
        arm, b, d, eo, xo, rf, fl, sp_ = l.split("\t")
        c = ev[arm + " " + b]
        c["entry_orders"] += int(eo); c["exit_orders"] += int(xo); c["refused"] += int(rf); c["fills"] += int(fl); c["stops"] += int(sp_)
    res["refusals"] = {k: dict(v) | {"refused_per_order": round(v["refused"] / max(1, v["entry_orders"] + v["exit_orders"]), 4)} for k, v in sorted(ev.items())}
    pos = {}
    for b in C.BOOKS:
        tk = C.TICK[b]
        dist = {"bid": [], "ask": []}
        inside = collections.Counter()
        for m, r in minutes[b].items():
            f = r["fair"]
            tr = touch[b].get(m)
            if f is None or tr is None:
                continue
            bid_q = int(f * (1 - 0.001) / tk + 1e-9) * tk
            ask_q = -int(-f * (1 + 0.001) / tk + 1e-9) * tk
            dist["bid"].append((tr[1] - bid_q) / f * 1e4)        # how far below the best bid our 0.1 % bid sat
            dist["ask"].append((ask_q - tr[2]) / f * 1e4)        # how far above the best ask our 0.1 % ask sat
            inside["n"] += 1
            if bid_q >= tr[2] - 1e-12: inside["bid would cross"] += 1
            if ask_q <= tr[1] + 1e-12: inside["ask would cross"] += 1
            if bid_q >= tr[1] - 1e-12: inside["bid at or above best bid"] += 1
            if ask_q <= tr[2] + 1e-12: inside["ask at or below best ask"] += 1
        pos[b] = {"rung_0.1%_behind_touch_bps": {s: summ(v) for s, v in dist.items()}, "counts": dict(inside)}
    res["rungs_vs_touch"] = pos

    # ---------------------------------------------------------------- Yahoo's lag against Coinbase's own implied rate
    lag = {}
    for b in ("USDT-GBP", "USDT-EUR"):
        k = "GBPUSD" if C.QUOTE[b] == "GBP" else "EURUSD"
        yts, yvs = fx[k]
        ymap = dict(zip(yts, yvs))
        umap = dict(zip(ut, uv))
        # implied at the end of minute m: USDT-USD candle close of m over the touch mid read at the top of m + 1
        imp = {}
        for m in range(T0 // M, T1 // M):
            md = mid(b, m + 1)
            u = umap.get(m * M)
            if md and u:
                imp[m] = u / md
        out = {}
        for s in range(-3, 4):          # compare Yahoo's bar labelled m + s with the implied rate at the end of m
            xs, ys = [], []
            for m in imp:
                if (m - 1) in imp and (m + s) * M in ymap and (m + s - 1) * M in ymap and not C.is_closure(m * M):
                    xs.append(imp[m] / imp[m - 1] - 1); ys.append(ymap[(m + s) * M] / ymap[(m + s - 1) * M] - 1)
            if len(xs) > 100:
                mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
                cov = sum((a - mx) * (c - my) for a, c in zip(xs, ys))
                vx, vy = sum((a - mx) ** 2 for a in xs), sum((c - my) ** 2 for c in ys)
                out[str(s)] = {"n": len(xs), "corr_of_minute_changes": round(cov / (vx * vy) ** 0.5, 4)}
        lag[b] = out
    res["yahoo_lag"] = lag
    json.dump(res, open(out_path, "w"), indent=1, sort_keys=True)
    print(json.dumps({"basis": {b: {k: v for k, v in basis[b].items() if not k.startswith("day")} for b in basis}}, indent=1)[:6000])


if __name__ == "__main__":
    main(sys.argv[1])
