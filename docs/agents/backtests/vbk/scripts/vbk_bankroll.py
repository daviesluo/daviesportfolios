"""VB-K, money leg: staking replayed on the out-of-sample bets, then a year of pounds at three bankrolls under limits.

Reads results/oos_bets_1x2_close_exc_th2_cap5.csv.gz (1X2 at kick-off, exchange anchor, additive de-vig, edge >= 2 %,
odds < 5: the rule that fires steadily in every season), results/oos_bets_1x2_close_exc.csv.gz (the pre-registered
procedure's pick, edge >= 6 %, odds < 4) and results/wf_bets_1x2_close.csv.gz (walk-forward), all written by
vbk_backtest.py. Writes results/vbk_bankroll.json. Deterministic (seeded).

A. Replay (scale-free, so it holds at any bankroll): flat 1 % / 2 % of the starting bankroll, quarter-Kelly capped at
   2 %, half-Kelly capped at 5 % of the bankroll at the start of the bet's day (Kelly from the anchor's fair p).
B. Planning Monte Carlo, 4,000 runs per cell on a bankroll of 1 (pounds scale linearly: the cell is reported at 500 /
   1,000 / 5,000 GBP by multiplying), flat 2 % of the bankroll a bet (and quarter-Kelly capped at 2 %):
   - each bet's odds and fair p drawn from the th2 pool; its true win probability q = p_fair x (1 + r) / (1 + mean edge),
     so the pool's expected ROI is r while a bigger edge still wins more often;
   - (a) no limits: N slips a year, every one placed;
   - (b) limits: K = 12 accounts, the pool's 9 books plus 3 it does not carry; 65 % of slips fall on a book drawn by the
     pool's shares, 35 % on one of the 3 others;
     each account lasts L placed bets, L lognormal with median Lmed and sigma 0.7, after which its slips are lost;
   - (c) delay: a slip is still at or above its minimum odds when clicked with probability S; the survivors' ROI is
     haircut by h (the stale prices the book corrects first are the best ones).
   Scenario values are the write-up's, each with its source; none is a measurement of Davies' accounts.
"""
import csv, gzip, io, json, math, os, random, datetime

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(HERE, "results")


def load(name):
    txt = gzip.open(os.path.join(RES, name)).read().decode()
    return list(csv.DictReader(io.StringIO(txt)))


def replay(bets, scheme):
    bk, peak, mdd = 1.0, 1.0, 0.0
    day, day_bk = None, 1.0
    streak = longest = 0
    staked = 0.0
    for b in bets:
        d = b["dt"][:10]
        if d != day:
            day, day_bk = d, bk
        o, p, prof = float(b["odds"]), float(b["fair_p"]), float(b["profit"])
        f = max(0.0, (p * o - 1) / (o - 1))
        if scheme == "flat1":
            st = 0.01
        elif scheme == "flat2":
            st = 0.02
        elif scheme == "kelly_q_cap2":
            st = min(0.25 * f, 0.02) * day_bk
        elif scheme == "kelly_h_cap5":
            st = min(0.5 * f, 0.05) * day_bk
        bk += st * prof
        staked += st
        peak = max(peak, bk)
        mdd = max(mdd, (peak - bk) / peak)
        streak = streak + 1 if prof < 0 else 0
        longest = max(longest, streak)
    t0 = datetime.datetime.fromisoformat(bets[0]["dt"])
    t1 = datetime.datetime.fromisoformat(bets[-1]["dt"])
    yrs = max((t1 - t0).days / 365.25, 0.25)
    return {"bets": len(bets), "years": round(yrs, 2), "bets_per_year": round(len(bets) / yrs), "final_multiple": round(bk, 4),
            "growth_per_year": round(bk ** (1 / yrs) - 1, 4), "max_drawdown": round(mdd, 4), "longest_losing_streak": longest,
            "turnover_per_year_x_start": round(staked / yrs, 2), "roi_on_turnover": round((bk - 1) / staked, 4) if staked else None}


def mc(pool, n_slips, r, staking, limits=None, survive=1.0, haircut=1.0, years=1, sims=4000, seed=1):
    rnd = random.Random(seed)
    mean_edge = sum(float(b["edge"]) for b in pool) / len(pool)
    books = sorted({b["book"] for b in pool})
    share = {bk: sum(1 for b in pool if b["book"] == bk) / len(pool) for bk in books}
    outs, placed_tot = [], []
    for _ in range(sims):
        alive = None
        if limits:
            K, lmed = limits
            names = books + [f"other{i}" for i in range(max(0, K - len(books)))]
            alive = {nm: max(1, int(round(lmed * math.exp(0.7 * rnd.gauss(0, 1))))) for nm in names}
            others = names[len(books):]
        pnl, placed = 0.0, 0
        for _y in range(years):
            for _i in range(n_slips):
                b = pool[rnd.randrange(len(pool))]
                bk = b["book"]
                if limits and others and rnd.random() < 0.35:
                    bk = others[rnd.randrange(len(others))]  # a slip at a book outside the data's few
                if rnd.random() > survive:
                    continue
                if alive is not None:
                    if alive.get(bk, 0) <= 0:
                        continue
                    alive[bk] -= 1
                o, p = float(b["odds"]), float(b["fair_p"])
                rr = r * haircut
                q = min(0.99, p * (1 + rr) / (1 + mean_edge))
                if staking == "flat2":
                    st = 0.02
                else:
                    f = max(0.0, (p * o - 1) / (o - 1))
                    st = min(0.25 * f, 0.02)
                pnl += st * ((o - 1) if rnd.random() < q else -1.0)
                placed += 1
        outs.append(pnl)
        placed_tot.append(placed)
    outs.sort()
    n = len(outs)
    return {"mean": sum(outs) / n, "p5": outs[int(0.05 * n)], "p50": outs[n // 2], "p95": outs[int(0.95 * n)],
            "p_loss": round(sum(1 for x in outs if x < 0) / n, 3), "bets_placed_mean": round(sum(placed_tot) / n)}


def gbp(cell, B):
    return {k: (round(v * B) if k in ("mean", "p5", "p50", "p95") else v) for k, v in cell.items()}


def main():
    out = {"replay": {}, "plan": {}}
    for name in ("oos_bets_1x2_close_exc_th2_cap5.csv.gz", "oos_bets_1x2_close_exc.csv.gz", "wf_bets_1x2_close.csv.gz"):
        bets = load(name)
        out["replay"][name] = {s: replay(bets, s) for s in ("flat1", "flat2", "kelly_q_cap2", "kelly_h_cap5")}
    pool = load("oos_bets_1x2_close_exc_th2_cap5.csv.gz")
    out["pool"] = {"bets": len(pool), "mean_edge": round(sum(float(b["edge"]) for b in pool) / len(pool), 4),
                   "mean_odds": round(sum(float(b["odds"]) for b in pool) / len(pool), 3)}
    # Scenario sets (sources in the write-up): slips a year, ROI, limits (accounts, median bets before a limit), delay.
    N = {"low": 250, "central": 400, "high": 550}
    R = {"zero": 0.0, "low": 0.03, "central": 0.05, "high": 0.08}
    LIM = {"fast": (12, 15), "central": (12, 40), "slow": (12, 120)}
    DELAY = {"2min": (0.85, 0.9), "5min": (0.7, 0.8), "10min": (0.55, 0.7)}
    unit = {}
    for rk, r in R.items():
        unit[f"a_no_limits.r_{rk}"] = mc(pool, N["central"], r, "flat2", seed=11)
    unit["a_no_limits.r_central.kelly_q_cap2"] = mc(pool, N["central"], R["central"], "kelly_q_cap2", seed=12)
    for nk, n in N.items():
        unit[f"a_no_limits.n_{nk}"] = mc(pool, n, R["central"], "flat2", seed=13)
    for lk, lim in LIM.items():
        unit[f"b_limits_{lk}.year1"] = mc(pool, N["central"], R["central"], "flat2", limits=lim, seed=14)
        unit[f"b_limits_{lk}.two_years"] = mc(pool, N["central"], R["central"], "flat2", limits=lim, years=2, seed=15)
    for dk, (sv, h) in DELAY.items():
        unit[f"c_limits_central_delay_{dk}.year1"] = mc(pool, N["central"], R["central"], "flat2", limits=LIM["central"], survive=sv, haircut=h, seed=16)
        unit[f"c_no_limits_delay_{dk}.year1"] = mc(pool, N["central"], R["central"], "flat2", survive=sv, haircut=h, seed=17)
    unit["c_limits_central_delay_5min.year1.kelly_q_cap2"] = mc(pool, N["central"], R["central"], "kelly_q_cap2", limits=LIM["central"], survive=DELAY["5min"][0], haircut=DELAY["5min"][1], seed=18)
    unit["c_limits_central_delay_5min.two_years"] = mc(pool, N["central"], R["central"], "flat2", limits=LIM["central"], survive=DELAY["5min"][0], haircut=DELAY["5min"][1], years=2, seed=19)
    for B in (500, 1000, 5000):
        out["plan"][str(B)] = {k: gbp(v, B) for k, v in unit.items()}
    out["scenarios"] = {"slips_per_year": N, "roi": R, "limits_accounts_median_bets": LIM, "delay_survive_haircut": DELAY}
    json.dump(out, open(os.path.join(RES, "vbk_bankroll.json"), "w"), indent=1, sort_keys=True)
    print(json.dumps(out["replay"], indent=1))
    for B, c in out["plan"].items():
        print(B)
        for k, v in c.items():
            print(f"  {k:45s} {v}")


if __name__ == "__main__":
    main()
