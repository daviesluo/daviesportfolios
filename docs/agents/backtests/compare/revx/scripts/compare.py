"""STRATEGY-COMPARE, the Revolut X half (2026-10-29; Davies: "测一下目前最新的revolut x的live以及variant7和8以及7和8的结合，与最新的
coinbase的 with euros和with euros-2的这几个的表现对比，每个策略都按单币种分开测，分别按600磅和1200磅 2400磅测三轮看对比（按年化收益率，需真实
反映未来12个月的期待）").

Four rule sets, each on ONE book with all its capital, at £600, £1,200 and £2,400:
  live  LIVE's rules as the LIVE twin (`live600`) runs them: PR5's rungs 0.1 / 0.2 / 0.3 % a side, exits at fair, the 0.05 %
        re-price, the 24-hour stop, the de-peg guard, LIVE's "at" fill, the weekend on the held X.
  v7    live + variant-7's fair nudge exactly as `agents/quotes_nudge.ts` (w 0.5, a 24-hour half-life, a Coinbase price at most
        5 minutes old before the minute, none at |dev| >= 50 bps, the book's first 72 hours warm-up only), on the book run, with
        Coinbase's own price of that coin in pounds: its last print each minute to 2026-10-08 (SCQ-VENUES' bars, stamped at the
        minute's end), the recorder's touch from 10-10 (REVX-FAIR's `cb_*.txt`); USDT-GBP has both too.
  v8    live + every exit one tick beyond fair (`exitOffset` 1).
  v78   both.
  *_h1  each of the four with PR5-OPT's £1 holding line (variant-4's rule `holdMin {gbp: 1}`, `holdLineBase`; the engine's
        `hold_min_gbp`): a fill makes the rung held only above £1 of coin, so a minimum-size print no longer makes a dust trip.
Six rungs on the one book (3 a side), each capital ÷ 6: £100, £200, £400. The engine fills a resting order by the size of the
prints that reach it, so a bigger rung does not fill proportionally more: that is what the three sizes measure.
The engine is the PR5-OPT simulator unchanged (`pr5_opt/scripts/sim.py`) on Revolut X UK's every public print: the committed
tape from each book's listing (USDC-GBP 2025-11-26, USDT-GBP 2025-12-16) to 2026-09-23 and the recorded prints of 09-26 → 10-29.
LIVE's exits meeting the book (`exitTicksOnBook`, 2026-10-29) are not modelled: the tape has no book, and the engine refuses an
exit that the last print shows crossing and tries again the next minute.

The shared method (identical in the Coinbase half):
  windows  in sample to 2026-05-12, out of sample from it; "recent" the last three months (07-29 → 10-28).
  blend    the shared formula: %/yr on capital = 365 × (½ the out-of-sample mean day + ½ the recent mean day) ÷ capital, after
           the live haircut.
  headline on Revolut X, the same after the haircut over the days since 2026-09-01 alone: the books tightened in the week of
           2026-08-24 (PR5's spec, the reference §3.27) and every row's month fell by two thirds to three quarters on USDT-GBP
           and by a third on USDC-GBP from September, flat since; the blend averages in the months before the break, which
           the next twelve will not see. Both are reported.
  haircut  from `results/haircut.json` (haircut.py, LIVE's record against the replay on the same days): every trip of £1 or
           more of entry × e (LIVE's ÷ the replay's over those trips, both books pooled, capped at 1), and every "dust" trip
           (under £1: a partial fill of a few pence) plus the penny cost a dust trip pays on the venue, which the replay
           cannot book (measured on the £120 LIVE twin).
  costs    maker fills 0 %, the stop as a taker (0.09 % + half the measured spread), conversions at the maker fee (0 %), no
           interest on idle cash; the asks' coin inventory's GBP/USD exposure is not in P&L (reported apart).
  days     every figure is on days marked to market: the trips closed that day (after the haircut) plus the change in what the
           held rungs were worth at the last print, midnight to midnight; a day of realised trips alone would hide a holding's
           loss until it closes.
  interval an 80 % interval of the expected year: a circular 3-day block bootstrap, 10,000 times, seed 20261029, of the days
           since 09-01 (the headline) and of the out-of-sample and recent days each (the blend); P(year < 0): each draw's
           expected year plus a year of the same days (demeaned, block-resampled) as its noise.
  also     trips a day, dust trips a day, bps a trip, stops a year and the capital held in positions (mean %), out of sample and
           since 09-01 (the replay before the haircut); worst day and the deepest drawdown (whole history, after the haircut,
           % of capital); the minutes the book had a fair (out of sample); for v7 how often the nudge acted.
usage: python3 -I compare.py OUT_DIR [WORKERS]
"""
import collections, gzip, json, math, os, random, statistics as st, sys
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "revx_lag", "scripts"))
import lag_data as L  # noqa: E402

M, H, DAY = L.M, L.H, L.DAY
BOOKS, SIZES = L.BOOKS, (600.0, 1200.0, 2400.0)
ARMS = {"live": {}, "v7": {"nudge": True}, "v8": {"exit_off": 1}, "v78": {"nudge": True, "exit_off": 1},
        # each with PR5-OPT's £1 holding line (variant-4's rule, `rules.holdMin {gbp: 1}`, `holdLineBase` in quotes_live.ts: a
        # rung is held only above £1 of coin), which LIVE does not run: the dust trips' fix (added at the main session's ask)
        "live_h1": {"hold_min": 1.0}, "v7_h1": {"nudge": True, "hold_min": 1.0}, "v8_h1": {"exit_off": 1, "hold_min": 1.0},
        "v78_h1": {"nudge": True, "exit_off": 1, "hold_min": 1.0}}
RUNGS = (0.001, 0.002, 0.003)
NUDGE = {"w": 0.5, "hl": 1440, "stale": 5 * M, "cap": 0.005, "warm": 72 * H}
SPLIT = L.day(L.SPLIT)
RECENT = L.day(L.FWD[1] - 92 * DAY)          # 2026-07-29: the last three months to 10-28
POST = "2026-09-01"                           # the two months since Revolut X's GBP books tightened (week of 2026-08-24)
BLOCK, NB, SEED, DUST_GBP = 3, 10000, 20261029, 1.0

INPUTS = L.load_engine_inputs()
CB = {}
for _b in BOOKS:
    _s = L.coinbase(_b)
    CB[_b] = L.Series(list(zip(_s.t, _s.v)), NUDGE["stale"] + 1)   # the newest stamped before t, at most 5 min (+1 ms) old


def nudge_adj(book, stats):
    s = {"e": None, "t": None}
    ser = CB[book]

    def adj(b, t, f):
        if f is None: return f
        stats["lit"] += 1
        m = ser.at(t)
        if not m:
            stats["stale"] += 1; return f
        g = m / f - 1
        s["e"] = g if s["e"] is None else s["e"] + (1 - 0.5 ** ((t - s["t"]) / M / NUDGE["hl"])) * (g - s["e"])
        s["t"] = t
        if t < L.START[b] + NUDGE["warm"]:
            stats["warm"] += 1; return f
        dev = g - s["e"]
        if abs(dev) >= NUDGE["cap"]:
            stats["cap"] += 1; return f
        stats["nudged"] += 1
        return f * (1 + NUDGE["w"] * dev)
    return adj


def job(a):
    arm, book, cap, part = a
    hm, hp, fm, fp = INPUTS
    mins, prints, win = (hm, hp, L.HIST) if part == "hist" else (fm, fp, L.FWD)
    kw = dict(capital=cap, xhold=True, fill="at", at_share=1.0, size={(book, s, k): cap / 6 for s in ("bid", "ask") for k in RUNGS})
    stats = collections.Counter()
    if ARMS[arm].get("nudge"): kw["fair_adj"] = nudge_adj(book, stats)
    if ARMS[arm].get("exit_off"): kw["exit_off"] = ARMS[arm]["exit_off"]
    if ARMS[arm].get("hold_min"): kw["hold_min_gbp"] = ARMS[arm]["hold_min"]
    marks = {}
    tr, _ = L.sim.run({book: mins[book]}, prints, win[0], win[1], marks=marks, **kw)
    return a, ([(x["tEntry"], x["tExit"], x["pnl"], x["gbp"], x["how"]) for x in tr], marks), dict(stats)


def lit_share(book, lo, hi):
    """Out-of-sample minutes with a fair (X live, or held through a closure) over all minutes, per book."""
    hm, _, fm, _ = INPUTS
    n = lit = 0
    last = None
    for src in (hm, fm):
        for t, x, fu in src[book]:
            if x: last = x
            if not (lo <= L.day(t) < hi): continue
            n += 1
            if fu and (x or (L.D.closure(t) and last)): lit += 1
    return lit / n if n else None


def gbpusd_vol():
    """Annualised volatility of GBP/USD from the tape's daily closes (X at 21:00 UTC), for the asks' inventory."""
    hm, _, _, _ = INPUTS
    c = {}
    for t, x, fu in hm["USDC-GBP"]:
        if x and (t // M) % 1440 == 21 * 60: c[L.day(t)] = x
    v = [c[d] for d in sorted(c)]
    r = [math.log(v[i] / v[i - 1]) for i in range(1, len(v))]
    return st.pstdev(r) * math.sqrt(260)


def block_mean(v, rnd):
    n = len(v); s = []
    while len(s) < n:
        i = rnd.randrange(n); s.extend(v[(i + j) % n] for j in range(BLOCK))
    return sum(s[:n]) / n


def block_year_noise(v, rnd):
    mu = sum(v) / len(v); n = len(v); tot = 0.0; k = 0
    while k < 365:
        i = rnd.randrange(n)
        for j in range(BLOCK):
            if k >= 365: break
            tot += v[(i + j) % n] - mu; k += 1
    return tot


def metrics(trips, marks, book, cap, hc):
    """Each day's P&L marked to market: the trips closed that day (after the haircut) plus the change in what the held rungs
    were worth at the last print between that day's midnight and the next (`sim.run`'s marks); a segment's last day, whose
    next midnight the run does not mark, takes its trips alone."""
    starts = list(range(L.START[book], L.HIST[1], DAY)) + list(range(L.FWD[0], L.FWD[1], DAY))
    days = [L.day(t) for t in starts]
    dset = set(days)
    raw, adj = collections.defaultdict(float), collections.defaultdict(float)
    e, c = hc["e"], hc["penny_gbp_per_dust_trip"]
    for tE, tX, pnl, gbp, how in trips:
        d = L.day(tX)
        if d not in dset: continue
        raw[d] += pnl
        adj[d] += (pnl + c) if gbp < DUST_GBP else pnl * e
    for t, d in zip(starts, days):
        if t in marks and t + DAY in marks:
            dm = marks[t + DAY] - marks[t]
            raw[d] += dm; adj[d] += dm
    A = [adj.get(d, 0.0) for d in days]
    per = lambda keep: [x for d, x in zip(days, A) if keep(d)]
    ins, oos, rec, post = per(lambda d: d < SPLIT), per(lambda d: d >= SPLIT), per(lambda d: d >= RECENT), per(lambda d: d >= POST)
    pct = lambda v: 100 * 365 * st.fmean(v) / cap
    rawpct = lambda keep: 100 * 365 * st.fmean([raw.get(d, 0.0) for d in days if keep(d)]) / cap
    rnd = random.Random(SEED)
    blend_exp, blend_years, post_exp, post_years = [], [], [], []
    for _ in range(NB):
        mu = 0.5 * block_mean(oos, rnd) + 0.5 * block_mean(rec, rnd)
        blend_exp.append(100 * 365 * mu / cap)
        blend_years.append(100 * (365 * mu + block_year_noise(oos, rnd)) / cap)
        mu = block_mean(post, rnd)
        post_exp.append(100 * 365 * mu / cap)
        post_years.append(100 * (365 * mu + block_year_noise(post, rnd)) / cap)
    blend_exp.sort(); post_exp.sort()
    q = lambda v, p: round(v[int(p * (NB - 1))], 2)

    def activity(lo):
        tr = [x for x in trips if L.day(x[1]) in dset and L.day(x[1]) >= lo]
        n = sum(1 for d in days if d >= lo)
        g = sum(x[3] for x in tr)
        return {"trips_day": round(len(tr) / n, 2), "dust_trips_day": round(sum(1 for x in tr if x[3] < DUST_GBP) / n, 2),
                "bps_trip": round(1e4 * sum(x[2] for x in tr) / g, 2) if g else None,
                "stops_yr": round(365 * sum(1 for x in tr if x[4] == "taker") / n, 1),
                "held_pct": round(100 * sum(x[3] * (x[1] - x[0]) for x in tr if x[0] is not None) / (cap * n * DAY), 1)}
    cum = peak = dd = 0.0
    for x in A:
        cum += x; peak = max(peak, cum); dd = min(dd, cum - peak)
    worst = min(zip(A, days))
    return {
        "headline_pct_yr": round(pct(post), 2), "headline_p10": q(post_exp, 0.10), "headline_p90": q(post_exp, 0.90),
        "p_year_below_0": round(sum(1 for y in post_years if y < 0) / NB, 3),
        "blend_pct_yr": round(0.5 * pct(oos) + 0.5 * pct(rec), 2), "blend_p10": q(blend_exp, 0.10), "blend_p90": q(blend_exp, 0.90),
        "blend_p_year_below_0": round(sum(1 for y in blend_years if y < 0) / NB, 3),
        "oos_pct_yr": round(pct(oos), 2), "recent_pct_yr": round(pct(rec), 2), "post_pct_yr": round(pct(post), 2), "is_pct_yr": round(pct(ins), 2),
        "before_haircut": {"oos": round(rawpct(lambda d: d >= SPLIT), 2), "recent": round(rawpct(lambda d: d >= RECENT), 2),
                           "post": round(rawpct(lambda d: d >= POST), 2)},
        "days": {"is": len(ins), "oos": len(oos), "recent": len(rec), "post": len(post)},
        "oos": activity(SPLIT), "post": activity(POST),
        "worst_day_pct": round(100 * worst[0] / cap, 2), "worst_day": worst[1], "max_drawdown_pct": round(100 * dd / cap, 2),
    }, {"days": days, "adj": [round(x, 5) for x in A], "raw": [round(raw.get(d, 0.0), 5) for d in days]}


def main(out_dir, workers):
    hc = json.load(open(os.path.join(HERE, "..", "results", "haircut.json")))["applied"]
    jobs = [(a, b, s, p) for a in ARMS for b in BOOKS for s in SIZES for p in ("hist", "fwd")]
    with Pool(workers) as pool:
        got = pool.map(job, jobs)
    runs = {k: v for k, v, _ in got}
    nst = {k: s for k, _, s in got}
    res = {"haircut_applied": hc, "recent_from": RECENT, "split": SPLIT, "gbpusd_vol_yr": round(gbpusd_vol(), 4),
           "lit_oos": {b: round(lit_share(b, SPLIT, "2026-10-29"), 4) for b in BOOKS}, "rows": {}}
    daily = {}
    for a in ARMS:
        for b in BOOKS:
            for s in SIZES:
                (th, mh), (tf, mf) = runs[(a, b, s, "hist")], runs[(a, b, s, "fwd")]
                m, dl = metrics(th + tf, {**mh, **mf}, b, s, hc)
                if ARMS[a].get("nudge"):
                    t = collections.Counter(nst[(a, b, s, "hist")]) + collections.Counter(nst[(a, b, s, "fwd")])
                    m["nudge"] = {k: round(t[k] / t["lit"], 4) for k in ("nudged", "stale", "cap", "warm")}
                key = f"{a}|{b}|{int(s)}"
                res["rows"][key] = m; daily[key] = dl
                print(key, json.dumps(m), flush=True)
    json.dump(res, open(os.path.join(out_dir, "compare.json"), "w"), indent=1, sort_keys=True)
    with gzip.open(os.path.join(out_dir, "daily.json.gz"), "wt") as f:
        json.dump(daily, f, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 4)
