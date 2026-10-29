"""USDT-ONLY (2026-10-29; Davies: "之后下一步你再研究下Revolut X的USDT-GBP近期是不是也完全超过USDC，基本可以肯定效果正面的话，把live全换成只做
USDT-GBP的…"): is Revolut X's USDT-GBP book, under LIVE's rules with the £1 holding line, recently and clearly ahead of USDC-GBP,
and is LIVE's whole capital on USDT-GBP alone better than LIVE as it runs (both books, half each)?

1. The replay (STRATEGY-COMPARE's method: the PR5-OPT engine unchanged, LIVE's "at" fill, the weekend on the held X, the £1
   line; days marked to market; the live haircut of `results/haircut.json`). New here: LIVE as it runs, both books, at £600,
   £1,200 and £2,400 (twelve rungs, capital ÷ 12), against compare.py's one-book rows `live_h1|USDT-GBP|<size>` and
   `live_h1|USDC-GBP|<size>` (`results/daily.json.gz`). Paired by day, for the days since 2026-09-01, out of sample (from
   05-12) and the last 30 days (from 09-29): the mean difference in % a year on capital, a circular 3-day block bootstrap's 80 %
   interval and P(≤ 0) (10,000 resamples, seed 20261029), and the days ahead and behind. By month since May: each comparison's
   % a year.
2. Size on one book: in the replay, the entry pounds USDT-GBP fills a day per pound of rung, at LIVE's £50 rungs (both books,
   £600) and at £100, £200, £400 (USDT alone), since 09-01.
3. The recorded book (REVX-FAIR's `fair_price/data`, 2026-09-26 → 10-29, every ~6 minutes) and prints: per book, the median coin
   at the best bid and ask and within 10 bps of the mid, the pounds traded a day, and the share of the pounds traded in prints of
   £100 or more.
4. LIVE's own record (LIVE_NORM: its trips of £1 or more by close day and book, the query of `sql/trip_buckets.sql` by day; real
   money, never committed): per book in bps of the book's half of capital, the days each book was ahead, and the ratio of their
   totals with and without the best day. Only counts and ratios are written.
usage: [LIVE_NORM=<json>] python3 -I usdt_only.py OUT.json [WORKERS]
"""
import collections, gzip, json, math, os, random, statistics as st, sys
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import compare as C  # noqa: E402  (its inputs, haircut and day method)

L = C.L
DAY = L.DAY
SIZES = (600.0, 1200.0, 2400.0)
POST, SPLIT, LAST30 = "2026-09-01", C.SPLIT, "2026-09-29"
BLOCK, NB, SEED = 3, 10000, 20261029


def job(a):
    cap, part = a
    hm, hp, fm, fp = C.INPUTS
    mins, prints, win = (hm, hp, L.HIST) if part == "hist" else (fm, fp, L.FWD)
    marks = {}
    tr, _ = L.sim.run(mins, prints, win[0], win[1], marks=marks, capital=cap, xhold=True, fill="at", at_share=1.0, hold_min_gbp=1.0)
    return a, ([(x["tEntry"], x["tExit"], x["pnl"], x["gbp"], x["how"], x["book"]) for x in tr], marks)


def boot(v):
    rnd = random.Random(SEED); n = len(v); out = []
    for _ in range(NB):
        s = []
        while len(s) < n:
            i = rnd.randrange(n); s.extend(v[(i + j) % n] for j in range(BLOCK))
        out.append(sum(s[:n]) / n)
    out.sort()
    return out


def paired(a, b, cap, lo):
    """a − b over the days both have from `lo`: % a year, [80 %], P(≤ 0), days ahead / behind."""
    days = sorted(d for d in a if d in b and d >= lo)
    v = [a[d] - b[d] for d in days]
    bs = boot(v); k = 100 * 365 / cap
    return {"days": len(days), "diff_pct_yr": round(k * sum(v) / len(v), 2), "p10": round(k * bs[int(0.1 * (NB - 1))], 2),
            "p90": round(k * bs[int(0.9 * (NB - 1))], 2), "p_le0": round(sum(1 for m in bs if m <= 0) / NB, 4),
            "ahead": sum(1 for x in v if x > 1e-9), "behind": sum(1 for x in v if x < -1e-9)}


def monthly(series, cap):
    mo = collections.defaultdict(list)
    for d, x in series.items():
        if d >= "2026-05-01": mo[d[:7]].append(x)
    return {m: round(100 * 365 * sum(v) / len(v) / cap, 1) for m, v in sorted(mo.items())}


def book_stats():
    D = L.D
    out = {}
    for b in L.BOOKS:
        best_b, best_a, near_b, near_a = [], [], [], []
        for l in D._open(f"book_{b}.txt"):
            l = l.strip()
            if not l: continue
            t, su, bs, as_ = l.split("|")
            bids, asks = D._levels(bs), D._levels(as_)
            if not bids or not asks: continue
            bb, ba = max(z[0] for z in bids), min(z[0] for z in asks)
            mid = (bb + ba) / 2
            best_b.append(sum(z[1] for z in bids if z[0] == bb)); best_a.append(sum(z[1] for z in asks if z[0] == ba))
            near_b.append(sum(z[1] for z in bids if z[0] >= mid * (1 - 0.001))); near_a.append(sum(z[1] for z in asks if z[0] <= mid * (1 + 0.001)))
        out[b] = {"snapshots": len(best_b), "median_coin_best_bid": round(st.median(best_b)), "median_coin_best_ask": round(st.median(best_a)),
                  "median_coin_within_10bps_bid": round(st.median(near_b)), "median_coin_within_10bps_ask": round(st.median(near_a))}
    _, _, _, fp = C.INPUTS
    for b in L.BOOKS:
        P = [p for p in fp.get(b, []) if L.FWD[0] <= p[0] < L.FWD[1]]
        gbp = [p[1] * L.TICK * p[2] for p in P]
        days = (L.FWD[1] - L.FWD[0]) / DAY
        out[b].update({"prints": len(P), "gbp_traded_day": round(sum(gbp) / days), "median_print_gbp": round(st.median(gbp), 2),
                       "share_gbp_in_prints_100_plus": round(sum(g for g in gbp if g >= 100) / sum(gbp), 3)})
    return out


def main(out, workers):
    hc = json.load(open(os.path.join(HERE, "..", "results", "haircut.json")))["applied"]
    with Pool(workers) as pool:
        got = dict(pool.map(job, [(s, p) for s in SIZES for p in ("hist", "fwd")]))
    daily = json.load(gzip.open(os.path.join(HERE, "..", "results", "daily.json.gz"), "rt"))
    res = {"haircut": hc, "windows": {"post": POST, "oos": SPLIT, "last30": LAST30}, "sizes": {}}
    for s in SIZES:
        (th, mh), (tf, mf) = got[(s, "hist")], got[(s, "fwd")]
        trips = [x[:5] for x in th + tf]
        m, dl = C.metrics(trips, {**mh, **mf}, "USDT-GBP", s, hc)       # both books, on USDT-GBP's days (from its listing)
        both = dict(zip(dl["days"], dl["adj"]))
        usdt = dict(zip(daily[f"live_h1|USDT-GBP|{int(s)}"]["days"], daily[f"live_h1|USDT-GBP|{int(s)}"]["adj"]))
        usdc = dict(zip(daily[f"live_h1|USDC-GBP|{int(s)}"]["days"], daily[f"live_h1|USDC-GBP|{int(s)}"]["adj"]))
        r = {"both_books": {k: m[k] for k in ("headline_pct_yr", "headline_p10", "headline_p90", "p_year_below_0", "oos_pct_yr", "recent_pct_yr", "blend_pct_yr")},
             "usdt_only_vs_both": {w: paired(usdt, both, s, lo) for w, lo in (("post", POST), ("oos", SPLIT), ("last30", LAST30))},
             "usdt_vs_usdc_one_book": {w: paired(usdt, usdc, s, lo) for w, lo in (("post", POST), ("oos", SPLIT), ("last30", LAST30))},
             "monthly_pct_yr": {"usdt_only": monthly(usdt, s), "both_books": monthly(both, s), "usdc_only": monthly(usdc, s)}}
        # fill per pound of rung on USDT-GBP since 09-01: both books (capital ÷ 12 a rung) and USDT alone (compare.py's runs are not
        # kept here, so the one-book figure is its compare.json activity: trips a day and bps a trip, with the rung's pounds)
        ut = [x for x in th + tf if x[5] == "USDT-GBP" and L.day(x[1]) >= POST]
        ndays = sum(1 for d in dl["days"] if d >= POST)
        r["usdt_book_in_both"] = {"rung_gbp": round(s / 12, 2), "entry_gbp_day": round(sum(x[3] for x in ut) / ndays, 1),
                                  "per_gbp_of_rung": round(sum(x[3] for x in ut) / ndays / (s / 12), 2), "trips_day": round(len(ut) / ndays, 2)}
        res["sizes"][str(int(s))] = r
        print(int(s), json.dumps(r["usdt_only_vs_both"]), json.dumps(r["usdt_vs_usdc_one_book"]), json.dumps(r["usdt_book_in_both"]), flush=True)
    comp = json.load(open(os.path.join(HERE, "..", "results", "compare.json")))["rows"]
    res["usdt_one_book_activity_post"] = {str(int(s)): {**comp[f"live_h1|USDT-GBP|{int(s)}"]["post"], "rung_gbp": s / 6} for s in SIZES}
    res["book"] = book_stats()
    print("book", json.dumps(res["book"]), flush=True)
    if os.environ.get("LIVE_NORM"):
        live = json.load(open(os.environ["LIVE_NORM"]))
        cap = lambda d: (600.0 if d >= "2026-10-27" else 120.0) / 2     # each book's half
        days = sorted(set(live["USDC-GBP"]) | set(live["USDT-GBP"]))
        t = {d: live["USDT-GBP"].get(d, 0.0) / cap(d) for d in days}; c = {d: live["USDC-GBP"].get(d, 0.0) / cap(d) for d in days}
        best = max(days, key=lambda d: t[d] - c[d])
        res["live_own"] = {"days_with_a_trip": len(days), "usdt_ahead": sum(1 for d in days if t[d] > c[d] + 1e-12),
                           "usdc_ahead": sum(1 for d in days if c[d] > t[d] + 1e-12),
                           "usdt_over_usdc_total": round(sum(t.values()) / sum(c.values()), 2),
                           "usdt_over_usdc_total_without_best_usdt_day": round((sum(t.values()) - t[best]) / (sum(c.values()) - c[best]), 2),
                           "since_10_15": {"usdt_ahead": sum(1 for d in days if d >= "2026-10-15" and t[d] > c[d] + 1e-12),
                                           "usdc_ahead": sum(1 for d in days if d >= "2026-10-15" and c[d] > t[d] + 1e-12)}}
        print("live", json.dumps(res["live_own"]), flush=True)
    json.dump(res, open(out, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 4)
