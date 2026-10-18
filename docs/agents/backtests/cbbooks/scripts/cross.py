# Q3 and Q4 of params.json: Coinbase against Revolut X on USDC-GBP and USDT-GBP. Lead-lag (which venue's mid closes a gap),
# the best fair for Revolut X an hour ahead (PR5's, Coinbase's mid, Coinbase's mid plus the trailing gap), and arbitrage
# (taker-taker crossings; a Revolut X maker hedged as a Coinbase taker).
# python3 -I scripts/cross.py <raw dir>  ->  results/cross.json
import sys, os, json, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import load_cb, load_rx, WIN_END_S, SPLIT_S

raw = sys.argv[1]
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = json.load(open(os.path.join(HERE, "params.json")))
CBF, RXF = P["costs"]["coinbase_taker"], P["costs"]["revolutx_taker"]
rng = np.random.default_rng(P["bootstrap"]["seed"])
NB = P["bootstrap"]["resamples"]
books, _ = load_cb(raw)
rx = load_rx(raw)
RXT = 1e-4
out = {"q3": {}, "q4": {}, "bars": {}}


def ols_slope(x, y):
    x = x - x.mean(); return float(np.sum(x * (y - y.mean())) / np.sum(x * x))


def boot_slope(hrs, x, y):
    uh, inv = np.unique(hrs, return_inverse=True)
    groups = [np.nonzero(inv == j)[0] for j in range(len(uh))]
    sl = []
    for _ in range(NB):
        pick = rng.integers(0, len(uh), len(uh))
        idx = np.concatenate([groups[j] for j in pick])
        sl.append(ols_slope(x[idx], y[idx]))
    return [round(float(np.percentile(sl, 5)), 4), round(float(np.percentile(sl, 95)), 4)]


for b in ("USDC-GBP", "USDT-GBP"):
    B = books[b]; R = rx[b]["bk"]
    g = np.arange(0, WIN_END_S, 60) + 40                       # one point a minute, at :40 (Revolut X reads ~:40, Coinbase ~:30)
    def rx_mid(tsec):
        i = np.searchsorted(R["ts"], tsec * 1000, side="right") - 1
        return np.where(i >= 0, (R["bid"][np.maximum(i, 0)] + R["ask"][np.maximum(i, 0)]) / 2, np.nan), i
    def cb_mid(tsec):
        i = np.searchsorted(B.ts, tsec * 1000, side="right") - 1
        return np.where(i >= 0, B.mid[np.maximum(i, 0)] * 1e-4, np.nan), i
    rm, ri = rx_mid(g); cm, ci = cb_mid(g)
    # staleness: a Revolut X row older than 3 min at g (the recorder reads once a minute) is a gap
    rstale = (g * 1000 - R["seen"][np.maximum(ri, 0)]) > 180_000
    cstale = (g * 1000 - B.seen[np.maximum(ci, 0)]) > 180_000
    ok0 = ~np.isnan(rm) & ~np.isnan(cm) & ~rstale & ~cstale
    gap = (rm - cm) / cm * 1e4
    hrs = g // 3600
    q3 = {"points": int(ok0.sum()), "gap_bp": {"median": round(float(np.nanmedian(gap[ok0])), 3),
                                               "p10_p90": [round(float(np.nanpercentile(gap[ok0], 10)), 3), round(float(np.nanpercentile(gap[ok0], 90)), 3)]},
          "rx_spread_bp_median": round(float(np.median((R["ask"] - R["bid"]) / ((R["ask"] + R["bid"]) / 2) * 1e4)), 2),
          "slopes": {}}
    for k in (1, 5, 15, 60):
        rm2, ri2 = rx_mid(g + 60 * k); cm2, ci2 = cb_mid(g + 60 * k)
        ok = ok0 & ~np.isnan(rm2) & ~np.isnan(cm2) & ((g + 60 * k) < WIN_END_S + 3600)
        drx = (rm2 - rm) / cm * 1e4; dcb = (cm2 - cm) / cm * 1e4
        d = {}
        for h, hm in (("train", g < SPLIT_S), ("test", g >= SPLIT_S)):
            m = ok & hm
            d[h] = {"rx_slope": round(ols_slope(gap[m], drx[m]), 4), "rx_ci90": boot_slope(hrs[m], gap[m], drx[m]),
                    "cb_slope": round(ols_slope(gap[m], dcb[m]), 4), "cb_ci90": boot_slope(hrs[m], gap[m], dcb[m]), "n": int(m.sum())}
        q3["slopes"][f"{k}m"] = d
    # forecasts of the Revolut X mid 60 min ahead, on minutes where PR5's fair is lit
    mins = {mi: (x, fu) for (mi, x, fu, pn) in rx[b]["minutes"]}
    fair = np.array([(mins.get(int(t // 60), (None, None))[1] / mins[int(t // 60)][0]) if (int(t // 60) in mins and mins[int(t // 60)][0] and mins[int(t // 60)][1]) else np.nan for t in g])
    rm60, _ = rx_mid(g + 3600)
    # (iv) Coinbase's mid plus the median gap of the previous 24 h (from the points available, at least 60)
    adj = np.full(len(g), np.nan)
    okidx = np.nonzero(ok0)[0]
    gv = gap.copy(); gv[~ok0] = np.nan
    for j in range(len(g)):
        lo = max(0, j - 1440)
        w = gv[lo:j]; w = w[~np.isnan(w)]
        if len(w) >= 60: adj[j] = cm[j] * (1 + np.median(w) / 1e4)
    preds = {"i_rx_mid_now": rm, "ii_pr5_fair": fair, "iii_cb_mid": cm, "iv_cb_mid_plus_gap": adj}
    fc = {}
    base = ok0 & ~np.isnan(fair) & ~np.isnan(rm60) & ~np.isnan(adj) & ((g + 3600) < WIN_END_S + 3600)
    for h, hm in (("train", g < SPLIT_S), ("test", g >= SPLIT_S)):
        m = base & hm
        fc[h] = {"n": int(m.sum())}
        for name, pr in preds.items():
            e = (rm60[m] - pr[m]) / rm60[m] * 1e4
            fc[h][name] = round(float(np.sqrt(np.mean(e ** 2))), 3)
        fc[h]["iii_vs_ii"] = round(1 - fc[h]["iii_cb_mid"] / fc[h]["ii_pr5_fair"], 3)
        fc[h]["iv_vs_ii"] = round(1 - fc[h]["iv_cb_mid_plus_gap"] / fc[h]["ii_pr5_fair"], 3)
    q3["forecast_rmse_bp_60m"] = fc
    out["q3"][b] = q3
    # Q4 (i): taker-taker crossings at the grid points
    i_r = np.maximum(ri, 0); i_c = np.maximum(ci, 0)
    rb, ra, rbs, ras = R["bid"][i_r], R["ask"][i_r], R["bsz"][i_r], R["asz"][i_r]
    cb_b, cb_a = B.b1[i_c] * 1e-4, B.a1[i_c] * 1e-4
    cbs_b, cbs_a = B.bsz[i_c, 0] / 100, B.asz[i_c, 0] / 100
    c1 = ok0 & (rb > cb_a * (1 + RXF + CBF)); c2 = ok0 & (cb_b > ra * (1 + RXF + CBF))
    q4i = {"points": int(ok0.sum()), "rx_bid_over_cb_ask_after_fees": int(c1.sum()), "cb_bid_over_rx_ask_after_fees": int(c2.sum()),
           "edge_bp_when_crossed": [round(float(x), 2) for x in np.concatenate([(rb[c1] / cb_a[c1] - 1 - RXF - CBF), (cb_b[c2] / ra[c2] - 1 - RXF - CBF)]) * 1e4][:20],
           "coins_min_of_touches_when_crossed": [round(float(x), 0) for x in np.concatenate([np.minimum(rbs[c1], cbs_a[c1]), np.minimum(ras[c2], cbs_b[c2])])][:20]}
    # crossings in more detail: episodes (runs of consecutive crossed minutes), weekend share, edge and size, and the pounds
    # one pass would take at the smaller touch (capped at 1,000 coins) if nobody else took it
    from load import is_weekend
    for lab, c, edge, sz in (("rx_bid_over_cb_ask", c1, rb / cb_a - 1 - RXF - CBF, np.minimum(rbs, cbs_a)),
                             ("cb_bid_over_rx_ask", c2, cb_b / ra - 1 - RXF - CBF, np.minimum(ras, cbs_b))):
        idx = np.nonzero(c)[0]
        runs = int(np.sum(np.diff(np.concatenate([[False], c, [False]]).astype(int)) == 1))
        lens = []
        k = 0
        for v in c:
            if v: k += 1
            elif k: lens.append(k); k = 0
        if k: lens.append(k)
        q4i[lab] = {"points": int(len(idx)), "episodes": runs, "episode_minutes_median": float(np.median(lens)) if lens else None,
                    "episode_minutes_max": int(max(lens)) if lens else None,
                    "weekend_share": round(float(np.mean(is_weekend(g[idx]))), 3) if len(idx) else None,
                    "train_points": int(np.sum(g[idx] < SPLIT_S)), "test_points": int(np.sum(g[idx] >= SPLIT_S)),
                    "edge_bp_median": round(float(np.median(edge[idx]) * 1e4), 2) if len(idx) else None,
                    "smaller_touch_coins_median": round(float(np.median(sz[idx])), 0) if len(idx) else None,
                    "gbp_per_episode_first_minute_median": round(float(np.median([edge[j] * min(sz[j], 1000) * cm[j] for j in idx if j == 0 or not c[j - 1]])), 3) if len(idx) else None}
    q4i.pop("edge_bp_when_crossed"); q4i.pop("coins_min_of_touches_when_crossed")
    # Q4 (ii): a Revolut X maker hedged as a Coinbase taker
    pr = rx[b]["prints"]
    pts = np.array([p[0] for p in pr]); ppx = np.array([p[1] for p in pr]); pq = np.array([p[2] for p in pr]); psd = np.array([p[3] for p in pr])
    inw = (pts >= 0) & (pts < WIN_END_S * 1000)
    minute = pts // 60000
    gbp = ppx * pq
    mvol = {}
    for mi, v in zip(minute[inw], gbp[inw]): mvol[mi] = mvol.get(mi, 0) + v
    q4ii = {}
    for mbp in (1, 2, 5, 10):
        mm = mbp / 1e4
        used = set(); pnl = []
        for t, px_, sd, mi in zip(pts[inw], ppx[inw], psd[inw], minute[inw]):
            j = np.searchsorted(B.ts, t, side="right") - 1
            jn = np.searchsorted(B.ts, t, side="right")                   # the first Coinbase read after the print
            if j < 0 or jn >= len(B.ts) or (t - B.seen[j]) > 180_000: continue
            if sd == "sell":
                bid = math.floor(B.b1[j] * 1e-4 * (1 - CBF - mm) / RXT + 1e-9) * RXT
                if not px_ < bid - 1e-12 or (mi, "b") in used: continue
                usd = min(100.0, 0.10 * mvol[mi]); coins = usd / bid
                hedge = B.b1[jn] * 1e-4 * (1 - CBF)
                pnl.append((t, coins * (hedge - bid), coins)); used.add((mi, "b"))
            else:
                ask = math.ceil(B.a1[j] * 1e-4 * (1 + CBF + mm) / RXT - 1e-9) * RXT
                if not px_ > ask + 1e-12 or (mi, "s") in used: continue
                usd = min(100.0, 0.10 * mvol[mi]); coins = usd / ask
                hedge = B.a1[jn] * 1e-4 * (1 + CBF)
                pnl.append((t, coins * (ask - hedge), -coins)); used.add((mi, "s"))
        d = {}
        for h, lo_, hi_ in (("train", 0, SPLIT_S), ("test", SPLIT_S, WIN_END_S)):
            pp = [(t, v) for t, v, _ in pnl if lo_ * 1000 <= t < hi_ * 1000]
            flow = [c for t, _, c in pnl if lo_ * 1000 <= t < hi_ * 1000]
            days = (hi_ - lo_) / 86400
            hours = np.arange(lo_ // 3600, hi_ // 3600)
            per_h = np.zeros(len(hours))
            for t, v in pp: per_h[int(t // 3600000) - lo_ // 3600] += v
            idx = rng.integers(0, len(hours), (NB, len(hours)))
            per_day = per_h[idx].mean(1) * 24
            d[h] = {"fills": len(pp), "fills_a_day": round(len(pp) / days, 2), "gbp_a_day": round(sum(v for _, v in pp) / days, 4),
                    "gbp_a_day_ci90": [round(float(np.percentile(per_day, 5)), 4), round(float(np.percentile(per_day, 95)), 4)],
                    "won_share": round(float(np.mean([v > 0 for _, v in pp])), 3) if pp else None,
                    "bought_on_rx_share": round(float(np.mean([c > 0 for c in flow])), 3) if flow else None,
                    "net_coins_moved_rx_to_cb_a_day": round(float(sum(flow) / days), 1),
                    "gbp_traded_a_day": round(float(sum(abs(c) for c in flow) / days * 0.75), 1),
                    "fills_under_1_gbp": int(sum(1 for c in flow if abs(c) * 0.75 < 1))}
        q4ii[f"{mbp}bp"] = d
    best = max(q4ii, key=lambda k: q4ii[k]["train"]["gbp_a_day"])
    te = q4ii[best]["test"]
    q4ii["chosen_on_train"] = best
    out["q4"][b] = {"taker_taker": q4i, "rx_maker_cb_hedge": q4ii}
    s5 = q3["slopes"]["5m"]
    lead = all(s5[h]["rx_slope"] < 0 and s5[h]["rx_ci90"][1] < 0 and abs(s5[h]["rx_slope"]) > abs(s5[h]["cb_slope"]) for h in ("train", "test"))
    better = any(fc["test"][k] >= 0.10 and fc["train"][k] >= 0.10 for k in ("iii_vs_ii", "iv_vs_ii"))
    out["bars"][b] = {"q3_coinbase_leads": lead, "q3_better_fair_this_book": better,
                      "q4_viable": bool(te["gbp_a_day"] > 0 and te["gbp_a_day_ci90"][0] > 0 and te["fills_a_day"] >= 1)}
    print(b, json.dumps(q3["gap_bp"]), json.dumps(s5), json.dumps(fc), json.dumps(q4i), json.dumps(q4ii), json.dumps(out["bars"][b]), sep="\n", flush=True)

json.dump(out, open(os.path.join(HERE, "results", "cross.json"), "w"), indent=1)
