# D and Q7 of params.json: what the Coinbase book recorder holds, its gaps, the books' spread/depth by hour and weekday
# against weekend, how often the touch moves between reads and whether prints came between; and the one release in the
# window (US CPI 2026-10-14 12:30 UTC). python3 -I scripts/describe.py <raw dir>  ->  results/describe.json
import sys, os, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import load_cb, PRODUCTS, TICK, WIN_END_S, is_weekend

raw = sys.argv[1]
books, prints = load_cb(raw)
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = {"products": {}}


def q(a, ps=(10, 50, 90)):
    return [round(float(x), 3) for x in np.percentile(a, ps)] if len(a) else None


for p in PRODUCTS:
    B, T = books[p], prints[p]
    inwin = B.ts < WIN_END_S * 1000
    ts, seen, reads = B.ts[inwin], B.seen[inwin], B.reads[inwin]
    # coverage: reads expected one a minute from the first read; a gap is a step between one row's last read and the next
    # row's first read over 90 s
    steps = (ts[1:] - seen[:-1]) / 1000.0
    gaps = steps[steps > 90]
    missing = int(np.sum(np.round(gaps / 60.0) - 1))
    minutes = (ts[-1] - ts[0]) / 60000.0 + 1
    w = reads.astype(float)                                      # each row weighs the reads it stood for
    b1, a1 = B.b1[inwin], B.a1[inwin]
    spread_t = (a1 - b1).astype(float)
    mid = (a1 + b1) / 2.0
    spread_bp = spread_t / mid * 1e4
    l1b = B.bsz[inwin, 0] / 100.0; l1a = B.asz[inwin, 0] / 100.0
    d5 = (B.bsz[inwin, :5].sum(1) + B.asz[inwin, :5].sum(1)) / 200.0
    d10 = (B.bsz[inwin].sum(1) + B.asz[inwin].sum(1)) / 200.0
    span10_b = ((B.bpx[inwin, 0] - np.where(B.bpx[inwin, 9] >= 0, B.bpx[inwin, 9], B.bpx[inwin, 0])) / mid * 1e4)
    hour = ((ts // 1000 + 3 * 3600) // 3600) % 24                # UTC hour of day (T0 is 03:00)
    wk = is_weekend(ts / 1000.0)

    def wmean(a, m):
        return round(float(np.sum(a[m] * w[m]) / np.sum(w[m])), 4) if np.any(m) else None

    by = {}
    for lab, m in (("weekday", ~wk), ("weekend", wk)):
        by[lab] = {"reads": int(w[m].sum()), "spread_ticks_mean": wmean(spread_t, m), "spread_bp_mean": wmean(spread_bp, m),
                   "spread_one_tick_share": wmean((spread_t == 1).astype(float), m),
                   "l1_bid_coins_median": q(l1b[m])[1], "l1_ask_coins_median": q(l1a[m])[1],
                   "l1_orders_mean": wmean((B.bn[inwin] + B.an[inwin]) / 2.0, m),
                   "depth5_coins_median": q(d5[m])[1], "depth10_coins_median": q(d10[m])[1],
                   "bid_ten_levels_span_bp_median": q(span10_b[m])[1]}
    hours = {}
    for h in range(24):
        hm = {}
        for lab, m0 in (("weekday", ~wk), ("weekend", wk)):
            m = m0 & (hour == h)
            hm[lab] = {"spread_bp": wmean(spread_bp, m), "l1_coins_median": (q((l1b + l1a)[m] / 2)[1] if np.any(m) else None),
                       "depth5_median": (q(d5[m])[1] if np.any(m) else None)}
        hours[h] = hm
    # touch dynamics between consecutive READS: a row's repeated reads are reads where nothing in the ten levels changed
    n_reads = int(reads.sum()); n_rows = int(len(ts))
    mid_ch = np.diff(mid) != 0
    b_ch = np.diff(b1) != 0; a_ch = np.diff(a1) != 0
    l1sz_ch = (np.diff(B.bsz[inwin, 0]) != 0) | (np.diff(B.asz[inwin, 0]) != 0)
    # prints between consecutive rows
    ps = T.s
    cnt_between = np.searchsorted(ps, ts[1:] / 1000.0, side="left") - np.searchsorted(ps, seen[:-1] / 1000.0, side="left")
    with_pr = cnt_between > 0
    dyn = {"reads": n_reads, "rows": n_rows, "reads_unchanged_share": round(1 - (n_rows - 1) / max(n_reads - 1, 1), 4),
           "row_to_row_mid_moved_share": round(float(mid_ch.mean()), 4),
           "row_to_row_best_bid_moved": round(float(b_ch.mean()), 4), "row_to_row_best_ask_moved": round(float(a_ch.mean()), 4),
           "row_to_row_l1_size_changed": round(float(l1sz_ch.mean()), 4),
           "mid_moved_given_prints_between": round(float(mid_ch[with_pr].mean()), 4) if with_pr.any() else None,
           "mid_moved_given_no_prints_between": round(float(mid_ch[~with_pr].mean()), 4) if (~with_pr).any() else None,
           "share_of_steps_with_prints": round(float(with_pr.mean()), 4)}
    # prints: by weekday/weekend, per minute
    tin = T.s < WIN_END_S
    pw = is_weekend(T.s[tin])
    nprint = T.n[tin]; vol = T.sz[tin] / 100.0
    mins_wk = float(np.sum(is_weekend(np.arange(0, WIN_END_S, 60)))); mins_wd = WIN_END_S / 60 - mins_wk
    pr = {"prints": int(nprint.sum()), "coins": round(float(vol.sum()), 0),
          "weekday_prints_per_min": round(float(nprint[~pw].sum() / mins_wd), 3), "weekend_prints_per_min": round(float(nprint[pw].sum() / mins_wk), 3),
          "weekday_coins_per_hour": round(float(vol[~pw].sum() / mins_wd * 60), 0), "weekend_coins_per_hour": round(float(vol[pw].sum() / mins_wk * 60), 0),
          "maker_bid_share_of_coins": round(float(vol[T.mb[tin]].sum() / vol.sum()), 4),
          "median_print_coins": None}
    # through-ness: share of print coins at a price beyond the touch of the row standing before them
    i = B.at(T.s[tin] * 1000)
    ok = i >= 0
    pxs = T.px[tin][ok]; ii = i[ok]; mb = T.mb[tin][ok]; vv = vol[ok]
    beyond = np.where(mb, pxs < B.b1[ii], pxs > B.a1[ii])
    inside = np.where(mb, pxs > B.b1[ii], pxs < B.a1[ii])
    pr["coins_beyond_standing_touch_share"] = round(float(vv[beyond].sum() / vv.sum()), 4)
    pr["coins_inside_standing_spread_share"] = round(float(vv[inside].sum() / vv.sum()), 4)
    out["products"][p] = {"window_rows": n_rows, "window_reads": n_reads, "minutes_spanned": round(minutes, 0),
                          "gaps_over_90s": int(len(gaps)), "reads_missing_in_gaps": missing,
                          "longest_gap_s": round(float(gaps.max()), 0) if len(gaps) else 0,
                          "tick_bp_at_mid": round(float(TICK[p] / (np.median(mid) * TICK[p]) * 1e4), 3),
                          "by_daytype": by, "by_hour": hours, "touch_dynamics": dyn, "prints": pr}

# Q7: US CPI 2026-10-14 12:30 UTC = T0 + 4 d 9 h 30 min. 5-minute buckets from -30 to +30 min, against the same clock on
# the other weekdays of the window (10-12, 10-13, 10-15, 10-16).
cpi = 4 * 86400 + 9 * 3600 + 1800
others = [cpi + d * 86400 for d in (-2, -1, 1, 2)]
q7 = {}
for p in PRODUCTS:
    B, T = books[p], prints[p]
    rows = []
    for k in range(-6, 6):
        def stats(c):
            a, b = c + k * 300, c + (k + 1) * 300
            m = (B.ts >= a * 1000) & (B.ts < b * 1000)
            mid = (B.b1[m] + B.a1[m]) / 2.0
            sp = ((B.a1[m] - B.b1[m]) / mid * 1e4) if m.any() else np.array([np.nan])
            l1 = (B.bsz[m, 0] + B.asz[m, 0]) / 200.0 if m.any() else np.array([np.nan])
            d5 = (B.bsz[m, :5].sum(1) + B.asz[m, :5].sum(1)) / 200.0 if m.any() else np.array([np.nan])
            tm = (T.s >= a) & (T.s < b)
            return float(np.nanmean(sp)), float(np.nanmedian(l1)), float(np.nanmedian(d5)), int(T.n[tm].sum()), float(T.sz[tm].sum() / 100)
        e = stats(cpi); o = [stats(c) for c in others]
        rows.append({"from_min": k * 5, "cpi": [round(x, 3) for x in e],
                     "others_mean": [round(float(np.nanmean([x[j] for x in o])), 3) for j in range(5)]})
    q7[p] = {"columns": ["spread_bp_mean", "l1_coins_median", "depth5_coins_median", "prints", "coins"], "buckets": rows}
out["q7_cpi_2026_10_14"] = q7
os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
json.dump(out, open(os.path.join(HERE, "results", "describe.json"), "w"), indent=1)
print(json.dumps({p: {k: v for k, v in out["products"][p].items() if k != "by_hour"} for p in PRODUCTS}, indent=1))
