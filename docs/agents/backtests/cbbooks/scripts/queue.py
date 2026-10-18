# Q1, Q5 and Q6 of params.json: the touch queue model (fill probability and markout of q = 100 coins joining the back of
# the best bid or ask at each book read, pessimistic and optimistic), touch imbalance as a signal and as a join filter, and
# weekend against weekday (the queue model split, and every print's maker markout).
# python3 -I scripts/queue.py <raw dir>  ->  results/queue.json
import sys, os, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import load_cb, PRODUCTS, WIN_END_S, SPLIT_S, is_weekend

raw = sys.argv[1]
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = json.load(open(os.path.join(HERE, "params.json")))
books, prints = load_cb(raw)
Q = 100 * 100                       # q = 100 coins, in hundredths
HZ = [60, 300, 900, 3600]           # horizons, s
rng = np.random.default_rng(P["bootstrap"]["seed"])
NB = P["bootstrap"]["resamples"]


def mid_at(B, t_ms):
    i = B.at(t_ms)
    return np.where(i >= 0, B.mid[np.maximum(i, 0)], np.nan), i


def boot_mean(hours, vals, wts=None, nb=NB):
    """Hour-block bootstrap of a (weighted) mean: resample the hours, 90 % interval."""
    vals = np.asarray(vals, float); wts = np.ones_like(vals) if wts is None else np.asarray(wts, float)
    uh, inv = np.unique(hours, return_inverse=True)
    sv = np.bincount(inv, vals * wts, len(uh)); sw = np.bincount(inv, wts, len(uh))
    if len(uh) < 2 or sw.sum() == 0: return None
    idx = rng.integers(0, len(uh), (nb, len(uh)))
    m = sv[idx].sum(1) / np.maximum(sw[idx].sum(1), 1e-12)
    return [round(float(np.percentile(m, 5)), 3), round(float(np.percentile(m, 95)), 3)]


def simulate(p):
    """Every read x side: fill times (pessimistic, optimistic) within 60 min, and markouts at fill + 5 / + 60 min."""
    B, T = books[p], prints[p]
    data_end_ms = B.seen[-1]
    rows = []
    sel = np.nonzero(B.ts < WIN_END_S * 1000)[0]
    for i in sel:
        t = B.ts[i]
        lo = np.searchsorted(T.s, int(np.ceil(t / 1000.0)), side="left")
        hi = np.searchsorted(T.s, int(t / 1000) + 3600, side="right")
        s, px, mb, sz = T.s[lo:hi], T.px[lo:hi], T.mb[lo:hi], T.sz[lo:hi]
        # later book rows inside the hour (for the optimistic bound)
        rlo, rhi = i + 1, np.searchsorted(B.ts, t + 3600_000, side="right")
        for side in ("b", "s"):
            Pp = B.b1[i] if side == "b" else B.a1[i]
            Q0 = B.bsz[i, 0] if side == "b" else B.asz[i, 0]
            if Pp < 0: continue
            mine = mb if side == "b" else ~mb             # prints against our side: a seller hitting bids, a buyer lifting asks
            at = mine & (px == Pp)
            beyond = (px < Pp) if side == "b" else (px > Pp)
            cum = np.cumsum(np.where(at, sz, 0))
            # pessimistic
            k1 = np.nonzero(cum >= Q0 + Q)[0]; k2 = np.nonzero(beyond)[0]
            f_p = min(s[k1[0]] if k1.size else 10**12, s[k2[0]] if k2.size else 10**12)
            # optimistic: ahead = min(Q0, smallest size later displayed at P up to that time) (0 if the level has gone on
            # the near side), less the size printed at P since the read
            f_o = 10**12
            if rhi > rlo:
                lv = []
                for r in range(rlo, rhi):
                    v = B.size_at(r, side, Pp)
                    lv.append(np.nan if v is None else v)
                lv = np.array(lv, float)
                run = np.minimum.accumulate(np.where(np.isnan(lv), np.inf, lv))
                rts = B.ts[rlo:rhi] / 1000.0
                j = np.searchsorted(rts, s, side="right") - 1          # the latest later row at or before each print
                ahead = np.where(j >= 0, np.minimum(Q0, run[np.maximum(j, 0)]), Q0)
                k3 = np.nonzero(cum >= ahead + Q)[0]
                # a row where the level is gone on the near side, with nothing printed beyond: ahead is 0 from that row on,
                # and the first print against our side at P after it fills; counted through k3 above
                f_o = s[k3[0]] if k3.size else 10**12
            else:
                k3 = np.nonzero(cum >= Q0 + Q)[0]
                f_o = s[k3[0]] if k3.size else 10**12
            f_o = min(f_o, f_p)
            rec = {"t": t / 1000.0, "side": side, "P": int(Pp), "Q0": int(Q0)}
            for lab, f in (("p", f_p), ("o", f_o)):
                if f < 10**12:
                    dt = f - t / 1000.0
                    m5, _ = mid_at(B, np.array([f * 1000 + 300_000])); m60, _ = mid_at(B, np.array([f * 1000 + 3600_000]))
                    sgn = 1 if side == "b" else -1
                    ok5 = f * 1000 + 300_000 <= data_end_ms; ok60 = f * 1000 + 3600_000 <= data_end_ms
                    rec[lab] = (dt, sgn * (m5[0] - Pp) / Pp * 1e4 if ok5 else np.nan, sgn * (m60[0] - Pp) / Pp * 1e4 if ok60 else np.nan)
                else:
                    rec[lab] = None
            # imbalance at the read
            bq1, aq1 = B.bsz[i, 0], B.asz[i, 0]
            bq5, aq5 = B.bsz[i, :5].sum(), B.asz[i, :5].sum()
            rec["I1"] = (bq1 - aq1) / max(bq1 + aq1, 1); rec["I5"] = (bq5 - aq5) / max(bq5 + aq5, 1)
            rows.append(rec)
    return rows


def summarize(rows, mask_fn):
    rs = [r for r in rows if mask_fn(r)]
    n = len(rs)
    out = {"attempts": n}
    if not n: return out
    for lab in ("p", "o"):
        fill = {f"{h // 60}m": round(sum(1 for r in rs if r[lab] and r[lab][0] <= h) / n, 4) for h in HZ}
        f60 = [r for r in rs if r[lab] and r[lab][0] <= 3600]
        mk5 = np.array([r[lab][1] for r in f60]); mk60 = np.array([r[lab][2] for r in f60])
        hrs = np.array([int(r["t"] // 3600) for r in f60])
        ok = ~np.isnan(mk60)
        out[lab] = {"fill_rate": fill, "fills_60m": len(f60),
                    "markout5_bp_mean": round(float(np.nanmean(mk5)), 3) if len(mk5) else None,
                    "markout60_bp_mean": round(float(np.nanmean(mk60)), 3) if ok.any() else None,
                    "markout60_bp_ci90": boot_mean(hrs[ok], mk60[ok]) if ok.sum() > 2 else None,
                    "markout60_positive_share": round(float(np.mean(mk60[ok] > 0)), 3) if ok.any() else None,
                    "expected_bp_per_attempt_60m": round(float(np.nansum(mk60) / n), 4) if ok.any() else None,
                    "median_minutes_to_fill": round(float(np.median([r[lab][0] for r in f60]) / 60), 2) if f60 else None}
    out["Q0_median_coins"] = round(float(np.median([r["Q0"] for r in rs])) / 100, 1)
    return out


res = {"q1": {}, "q5": {}, "q6_queue": {}, "q6_prints": {}, "bars": {}}
for p in PRODUCTS:
    rows = simulate(p)
    tr = lambda r: r["t"] < SPLIT_S
    te = lambda r: r["t"] >= SPLIT_S
    res["q1"][p] = {"train": summarize(rows, tr), "test": summarize(rows, te),
                    "test_bid": summarize(rows, lambda r: te(r) and r["side"] == "b"), "test_ask": summarize(rows, lambda r: te(r) and r["side"] == "s")}
    # Q1 bar
    tp, trn = res["q1"][p]["test"]["p"], res["q1"][p]["train"]["p"]
    ci = tp["markout60_bp_ci90"]
    res["bars"][p] = {"q1_touch_maker": bool(tp["fill_rate"]["60m"] >= 0.10 and tp["markout60_bp_mean"] is not None and tp["markout60_bp_mean"] > 0
                                             and ci is not None and ci[0] > 0 and trn["markout60_bp_mean"] is not None and trn["markout60_bp_mean"] > 0),
                      "q1_detail": {"test_fill60": tp["fill_rate"]["60m"], "test_mk60": tp["markout60_bp_mean"], "test_ci": ci, "train_mk60": trn["markout60_bp_mean"]}}
    # Q6 (queue model by day type)
    res["q6_queue"][p] = {h: {lab: summarize(rows, lambda r, h=h, lab=lab: ((r["t"] < SPLIT_S) == (h == "train")) and (bool(is_weekend(r["t"])) == (lab == "weekend")))
                              for lab in ("weekday", "weekend")} for h in ("train", "test")}
    # Q5: IC of imbalance against the mid change to + 1 and + 5 min, on bid rows (one per read)
    B = books[p]
    reads = [r for r in rows if r["side"] == "b"]
    tt = np.array([r["t"] for r in reads]) * 1000
    m0, _ = mid_at(B, tt); m1, _ = mid_at(B, tt + 60_000); m5, _ = mid_at(B, tt + 300_000)
    I1 = np.array([r["I1"] for r in reads]); I5 = np.array([r["I5"] for r in reads])
    q5 = {}
    for hname, hm in (("train", tt / 1000 < SPLIT_S), ("test", tt / 1000 >= SPLIT_S)):
        d = {}
        for lab, fut in (("next_1m", m1), ("next_5m", m5)):
            ch = fut - m0
            ok = hm & ~np.isnan(ch)
            for iname, I in (("I1", I1), ("I5", I5)):
                d[f"{iname}_{lab}"] = round(float(np.corrcoef(I[ok], ch[ok])[0, 1]), 4)
        q5[hname] = d
    # the join filter: theta chosen on train by expected bp per attempt at 60 min (pessimistic)
    def filt(theta):
        return lambda r: not ((r["side"] == "b" and r["I1"] < -theta) or (r["side"] == "s" and r["I1"] > theta))
    best = None
    for th in (0.25, 0.5, 0.75):
        s_ = summarize(rows, lambda r, th=th: tr(r) and filt(th)(r))
        v = s_["p"]["expected_bp_per_attempt_60m"]
        if best is None or (v is not None and v > best[1]): best = (th, v)
    th = best[0]
    te_all = res["q1"][p]["test"]["p"]
    te_f = summarize(rows, lambda r: te(r) and filt(th)(r))["p"]
    imp = (te_f["markout60_bp_mean"] - te_all["markout60_bp_mean"]) if te_f["markout60_bp_mean"] is not None else None
    keep = te_f["fills_60m"] / max(te_all["fills_60m"], 1)
    q5["filter"] = {"theta_from_train": th, "train_expected_bp_per_attempt": best[1], "test_unfiltered_mk60": te_all["markout60_bp_mean"],
                    "test_filtered_mk60": te_f["markout60_bp_mean"], "improvement_bp": round(imp, 3) if imp is not None else None,
                    "fills_kept_share": round(keep, 3), "test_filtered_expected_bp_per_attempt": te_f["expected_bp_per_attempt_60m"],
                    "test_unfiltered_expected_bp_per_attempt": te_all["expected_bp_per_attempt_60m"]}
    res["q5"][p] = q5
    res["bars"][p]["q5_signal"] = bool(np.sign(q5["test"]["I1_next_1m"]) == np.sign(q5["train"]["I1_next_1m"]) and abs(q5["test"]["I1_next_1m"]) >= 0.05)
    res["bars"][p]["q5_filter"] = bool(imp is not None and imp >= 0.2 and keep >= 0.5)
    # Q6, prints: every print's maker markout at + 5 and + 60 min, size-weighted, by day type and half
    T = prints[p]
    inw = T.s < WIN_END_S
    s, px, mbk, sz = T.s[inw], T.px[inw], T.mb[inw], T.sz[inw] / 100.0
    mk = {}
    for lab, dt in (("5m", 300), ("60m", 3600)):
        mm, _ = mid_at(B, (s + dt) * 1000)
        ok = (s + dt) * 1000 <= B.seen[-1]
        v = np.where(mbk, mm - px, px - mm) / px * 1e4
        mk[lab] = (v, ok)
    q6p = {}
    wk = is_weekend(s)
    for h in ("train", "test", "all"):
        hm = (s < SPLIT_S) if h == "train" else (s >= SPLIT_S) if h == "test" else np.ones_like(s, bool)
        q6p[h] = {}
        for lab, dm in (("weekday", ~wk), ("weekend", wk)):
            m = hm & dm
            d = {"coins": round(float(sz[m].sum()), 0)}
            for k, (v, ok) in mk.items():
                mm_ = m & ok
                d[f"maker_markout_{k}_bp"] = round(float(np.sum(v[mm_] * sz[mm_]) / np.sum(sz[mm_])), 3) if mm_.any() else None
                d[f"maker_markout_{k}_ci90"] = boot_mean((s[mm_] // 3600), v[mm_], sz[mm_]) if mm_.sum() > 10 else None
            q6p[h][lab] = d
        # weekend - weekday, hour-block bootstrap within each group
        v, ok = mk["60m"]
        a = hm & wk & ok; b = hm & ~wk & ok
        if a.sum() > 10 and b.sum() > 10:
            def hb(m):
                uh, inv = np.unique(s[m] // 3600, return_inverse=True)
                return np.bincount(inv, v[m] * sz[m]), np.bincount(inv, sz[m])
            av, aw = hb(a); bv, bw = hb(b)
            ia = rng.integers(0, len(av), (NB, len(av))); ib = rng.integers(0, len(bv), (NB, len(bv)))
            dd = av[ia].sum(1) / aw[ia].sum(1) - bv[ib].sum(1) / bw[ib].sum(1)
            q6p[h]["weekend_minus_weekday_60m"] = [round(float(av.sum() / aw.sum() - bv.sum() / bw.sum()), 3),
                                                  round(float(np.percentile(dd, 5)), 3), round(float(np.percentile(dd, 95)), 3)]
    # by UTC hour, all days, 60 min maker markout
    hour = ((s + 3 * 3600) // 3600) % 24
    v, ok = mk["60m"]
    q6p["by_hour_60m"] = {int(h): [round(float(np.sum(v[(hour == h) & ok] * sz[(hour == h) & ok]) / max(np.sum(sz[(hour == h) & ok]), 1e-9)), 2),
                                   round(float(sz[hour == h].sum()), 0)] for h in range(24)}
    res["q6_prints"][p] = q6p
    print(p, json.dumps(res["q1"][p]["test"]), json.dumps(res["bars"][p]), flush=True)

json.dump(res, open(os.path.join(HERE, "results", "queue.json"), "w"), indent=1)
