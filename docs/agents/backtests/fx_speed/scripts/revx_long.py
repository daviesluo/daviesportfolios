"""FX-SPEED-RX: the long backtest of a faster GBP/USD on Revolut X, LIVE's rules and four testing rows (Davies, 2026-10-29:
"同样的长期回测在revolut x的live和几个有代表性的testing策略也测一遍，看看有没有优化，有的话也全面改，没有的话解释下为什么").

THE BAR, written before any run (a row passes on the primary candidate `b`):
  out of sample (2026-05-12 → 2026-10-29) the paired gain over (a) has mean > 0 and P(≤ 0) < 0.10 (3-day circular block
  bootstrap, 10,000 draws, seed 20261029); in sample (2025-11-26 → 2026-05-12) its mean > 0; and at least two thirds of the
  calendar months with a trip are positive. Reported per row and per book; the verdict is the row's (both books together).

THE HISTORY there is: Revolut X UK's every public print, USDC-GBP from 2025-11-26 (its listing) and USDT-GBP from 2025-12-16,
to 2026-09-23 (the committed nine-month tape `inputs/pr5_2026-09-23`, read through `pr5_opt/scripts/sim.py`'s `load_hist`), and
the recorded minute record and prints of 2026-09-26 → 10-29 (REVX-FAIR's `fair_price/data`). No candle is used: every fill
is a public print through (or, with LIVE's "at", at) a resting price, by its size, as the PR5-OPT engine does. Before the
listing there is no book. The USD books' hourly closes (fairU, F3) come with each.

THE ENGINE: PR5-OPT's LIVE-realistic replay (`pr5_opt/scripts/sim.py`), imported unchanged: the paper turn of minute t on data
to t − 1, its decision taken 25 s into the next minute (`QUOTES_START_MS`, t + 85 s), LIVE's executor resting the orders at
t + 90 s (production: 1,584 live orders in the 7 days to 2026-10-29, sent a median 32.4 s after `paper_live` = t + 60 s).
One thing changes, X, through `fair_adj`: fair = fairU / X, outside FX closures (a closure keeps the held X, as LIVE's weekend
rule does). X at instant s is Exness's last tick at or before s (`revx_long_ex.py`):
  a        today's X, Yahoo's bar of t − 1, the price of about t − 32 s (§7.2), × (1 + 0.33 bps), Yahoo's GBP/USD level
  b        the switch as it could run: the newest `fx_ticks` read received by the decision at t + 85 s, carrying 1 s of
           TrueFX's age: Exness at t + 84 s, × (1 + 0.33 bps) (aligned). PRIMARY.
  b_raw    the same at Exness's (TrueFX's) level
  b_slow   t + 82 s (3 s of age); b_turn t + 87 s (read at the executor's own turn, t + 88, 1 s of age)
  c        the bound: t + 90 s, the price as the orders go live
  x60      t + 60 s, a minute close read at the paper turn: what the frozen tape's own X (Exness's minute close) gives
On the recorded window (a) is also checked against the real Yahoo bars the engine stored (`a_real`).

ROWS (`agent_quote_twin_specs`): live600 (LIVE's rules, £600, "at", weekend on the held X), live1200 (£1,200), take50 (PR5's
paper rules, £600, fill through only, no weekend; its taker leg, 13 IOCs in 36 days, needs recorded books and is left out),
n600usdt3 (LIVE's rules, USDT-GBP £75 a rung, USDC-GBP £25), u300nudge (LIVE's rules, USDC-GBP alone at £37.555 a rung, its
fair nudged by Coinbase's USDC-GBP mid: EMA half-life 1,440 min of mid / fair − 1, half the deviation, none at 0.5 % or more;
Coinbase's touch is recorded only from 2026-10-10, so 10-14 → 10-29 after 72 h of warm-up, and no bar is applied to it).

usage: RX_EX=<revx_long_ex.py's file> python3 -I revx_long.py OUT.json [WORKERS]
"""
import collections, datetime, json, math, os, random, statistics as st, sys
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(BT, "fair_price", "scripts"))
sys.path.insert(0, os.path.join(BT, "pr5_opt", "scripts"))
import fp_data as D  # noqa: E402
import sim  # noqa: E402
import revx_long_ex as RX  # noqa: E402

M, DAY = 60_000, 86_400_000
ms = lambda *a: int(datetime.datetime(*a, tzinfo=datetime.timezone.utc).timestamp() * 1000)  # noqa: E731
HIST = (ms(2025, 11, 26), ms(2026, 9, 23))
FWD = (ms(2026, 9, 26), ms(2026, 10, 29))
SPLIT = ms(2026, 5, 12)
NUDGE_FROM, NUDGE_SCORE = ms(2026, 10, 11), ms(2026, 10, 14)
GBP_LEVEL = 0.33e-4
SEED, NB, BLOCK = 20261029, 10000, 3

CANDS = {"a": (-32, True), "b": (84, True), "b_raw": (84, False), "b_slow": (82, True), "b_turn": (87, True), "c": (90, True), "x60": (60, True)}
ROWS = {
    "live600": dict(capital=600.0, fill="at", xhold=True),
    "live1200": dict(capital=1200.0, fill="at", xhold=True),
    "take50": dict(capital=600.0, fill="through", xhold=False),
    "n600usdt3": dict(size={(b, s, k): (75.0 if b == "USDT-GBP" else 25.0) for b in D.BOOKS for s in ("bid", "ask") for k in (0.001, 0.002, 0.003)},
                      fill="at", xhold=True),
}
NUDGE_ROW = dict(size={("USDC-GBP", s, k): 225.33 / 6 for s in ("bid", "ask") for k in (0.001, 0.002, 0.003)}, fill="at", xhold=True)

EX = RX.RxEx(os.environ["RX_EX"])
HM, HP = sim.load_hist(*HIST)
FM_RAW = D.load_minutes()
FP = D.load_prints()
FM = {b: [(t, x, fu) for (t, x, fu, lag) in v if FWD[0] - 2 * DAY <= t < FWD[1]] for b, v in FM_RAW.items()}
REC = {}
for src in (HM, FM):
    for b, v in src.items():
        for t, x, fu in v:
            REC[(b, t)] = (x, fu)
CB = D.CbSeries("USDC-GBP")


def xc(name, t):
    rel, aligned = CANDS[name]
    v = EX.at(t + rel * 1000)
    return None if v is None else v * (1 + GBP_LEVEL) if aligned else v


def adj_for(name):
    def adj(b, t, f):
        x, fu = REC.get((b, t), (None, None))
        if not x or not fu or D.closure(t):
            return f
        if name == "a_real":
            return fu / x
        v = xc(name, t)
        return fu / v if v else f
    return adj


def nudged(inner):
    """The u300nudge fair on top of a candidate's: EMA of Coinbase mid / fair − 1 (half-life 1,440 min, only where Coinbase's
    touch is fresh), the fair moved by half the deviation from it, none when the deviation is 0.5 % or more."""
    st_ = {"e": None, "t": None}

    def adj(b, t, f):
        f = inner(b, t, f)
        if f is None:
            return f
        m = CB.at(t - 1)
        if not m:
            return f
        g = m / f - 1
        if st_["e"] is None:
            st_["e"] = g
        else:
            st_["e"] += (1 - 0.5 ** ((t - st_["t"]) / M / 1440)) * (g - st_["e"])
        st_["t"] = t
        dev = g - st_["e"]
        return f if abs(dev) >= 0.005 else f * (1 + 0.5 * dev)
    return adj


def job(args):
    row, cand, part = args
    if row == "u300nudge":
        mins = {"USDC-GBP": [r for r in FM["USDC-GBP"] if r[0] >= NUDGE_FROM]}
        tr, _ = sim.run(mins, FP, NUDGE_FROM, FWD[1], fair_adj=nudged(adj_for(cand)), **NUDGE_ROW)
    else:
        mins, prints, win = (HM, HP, HIST) if part == "hist" else (FM, FP, FWD)
        tr, _ = sim.run(mins, prints, win[0], win[1], fair_adj=adj_for(cand), **ROWS[row])
    return (row, cand, part), [(x["book"], x["tExit"], x["pnl"], x["gbp"], x["how"]) for x in tr]


def boot(v):
    n = len(v)
    if n < BLOCK + 1:
        return None
    rnd = random.Random(SEED); out = []
    for _ in range(NB):
        s = []
        while len(s) < n:
            i = rnd.randrange(n); s.extend(v[(i + j) % n] for j in range(BLOCK))
        out.append(st.fmean(s[:n]))
    out.sort()
    return [round(out[int(0.05 * NB)] * 365, 2), round(out[int(0.95 * NB)] * 365, 2), round(sum(1 for x in out if x <= 0) / NB, 4)]


def day(t):
    return datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")


def days_in(a, b):
    return [day(t) for t in range(a, b, DAY)]


def main(out, workers):
    jobs = [(r, c, p) for r in ROWS for c in list(CANDS) + ["a_real"] for p in ("hist", "fwd") if not (c == "a_real" and p == "hist")]
    jobs += [("u300nudge", c, "fwd") for c in list(CANDS) + ["a_real"]]
    with Pool(workers) as pool:
        runs = dict(pool.map(job, jobs))
    res = {"bar": "OOS mean > 0 and P(<=0) < 0.10; IS mean > 0; >= 2/3 of months positive (primary b)", "windows": {
        "hist": ["2025-11-26", "2026-09-23"], "fwd": ["2026-09-26", "2026-10-29"], "split": "2026-05-12", "nudge": ["2026-10-14", "2026-10-29"]},
        "rows": {}}
    alldays = days_in(HIST[0], HIST[1]) + days_in(FWD[0], FWD[1])
    for row in list(ROWS) + ["u300nudge"]:
        R = {}
        def daily(cand, book=None):
            d = collections.defaultdict(float)
            for part in ("hist", "fwd"):
                for b, te, pnl, gbp, how in runs.get((row, cand, part), []):
                    if book is None or b == book:
                        d[day(te)] += pnl
            return d
        def stats(cand, book=None):
            # a_real exists on the recorded window alone: it is compared with (a) there, as the reconstruction's check
            dd = days_in(NUDGE_SCORE, FWD[1]) if row == "u300nudge" else days_in(FWD[0], FWD[1]) if cand == "a_real" else alldays
            da = daily("a", book); dc = daily(cand, book)
            v = [dc.get(x, 0.0) - da.get(x, 0.0) for x in dd]
            split = day(SPLIT)
            ins = [x for d_, x in zip(dd, v) if d_ < split]; oos = [x for d_, x in zip(dd, v) if d_ >= split]
            months = collections.defaultdict(float)
            for d_, x in zip(dd, v):
                months[d_[:7]] += x
            r = {"oos_gbp_year": round(365 * st.fmean(oos), 2) if oos else None, "oos_boot90_pLe0": boot(oos),
                 "is_gbp_year": round(365 * st.fmean(ins), 2) if ins else None, "all_gbp_year": round(365 * st.fmean(v), 2),
                 "all_boot90_pLe0": boot(v), "months": {k: round(x, 3) for k, x in sorted(months.items())},
                 "months_pos": sum(1 for x in months.values() if x > 1e-9), "months_n": sum(1 for x in months.values() if abs(x) > 1e-9),
                 "days": len(v)}
            return r
        for cand in list(CANDS) + ["a_real"]:
            if cand == "a":
                continue
            R[cand] = {"all": stats(cand)}
            for b in (D.BOOKS if row != "u300nudge" else ["USDC-GBP"]):
                R[cand][b] = stats(cand, b)
        # each candidate's own record, out of sample and in sample
        own = {}
        for cand in list(CANDS) + ["a_real"]:
            for lab, lo, hi in (("is", HIST[0], SPLIT), ("oos", SPLIT, FWD[1])) if row != "u300nudge" else (("fwd", NUDGE_SCORE, FWD[1]),):
                tr = [x for p in ("hist", "fwd") for x in runs.get((row, cand, p), []) if lo <= x[1] < hi]
                if cand == "a_real" and lab == "is":
                    continue
                own[f"{cand}|{lab}"] = {"pnl_gbp": round(sum(x[2] for x in tr), 3), "trips": len(tr), "stops": sum(1 for x in tr if x[4] == "taker"),
                                        "bps_trip": round(1e4 * sum(x[2] for x in tr) / max(1e-9, sum(x[3] for x in tr)), 2)}
        R["own"] = own
        b_ = R["b"]["all"]
        if row != "u300nudge":
            R["verdict"] = bool(b_["oos_gbp_year"] and b_["oos_gbp_year"] > 0 and b_["oos_boot90_pLe0"] and b_["oos_boot90_pLe0"][2] < 0.10
                                and b_["is_gbp_year"] and b_["is_gbp_year"] > 0 and b_["months_pos"] * 3 >= 2 * b_["months_n"])
        res["rows"][row] = R
        print(row, {c: (R[c]["all"]["is_gbp_year"], R[c]["all"]["oos_gbp_year"], R[c]["all"]["oos_boot90_pLe0"], f'{R[c]["all"]["months_pos"]}/{R[c]["all"]["months_n"]}') for c in R if c not in ("own", "verdict")}, R.get("verdict"), flush=True)
    json.dump(res, open(out, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 4)
