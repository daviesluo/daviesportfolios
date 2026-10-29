"""REVX-LAG part 2: can LIVE's rules earn more by using Revolut X's predictable book? PR5-OPT's engine, imported unchanged.

THE BAR (written before any run, as FX-SPEED-RX's): a candidate passes on a row when, against today's rule on the same row,
out of sample (2026-05-12 → 10-29) its mean is above zero with P(≤ 0) < 0.10 (3-day circular blocks, 10,000 draws, seed
20261029), in sample (from the listings to 2026-05-12) its mean is above zero, and at least two thirds of the calendar months
are positive. Where a family has a parameter, it is chosen on live600's in-sample mean alone and then judged on every row.

THE FORECAST, fitted on the in-sample half only. At paper minute t the engine decides at t + 85 s and its orders rest from
t + 90 s, so every input is taken as of T = t + 60 s (stamped before it): G, the book's gap to fair (VWAP of its prints in
[T − 15 min, T), or its last print within 2 h, against fair(t)); dX, GBP/USD's move over the 15 minutes to T (Exness); D,
Coinbase's premium over the book (Coinbase's price of the coin as of T against fair(t), less G). The target: the VWAP of the
book's prints in [T + 30 s, T + 30 s + 60 min) against the book level of T. m̂ = a + bG·G + bX·dX + bD·D, capped at ±30 bps.

THE CANDIDATES (each through the engine's own hooks: `fair_adj`, the per-side `gate`, `exit_off`):
  pred_w{0.5,1}   fair moved by w·m̂: every quote and exit leans the way the book is forecast to go (families 1 and 4: a
                  rising forecast lifts the asks away from the flow and the exits toward where the book is going)
  gate_th{3,6}    one-sided: the side the forecast runs into is withdrawn (asks when m̂ > θ bps, bids when m̂ < −θ) (family 2)
  cbD_w{0.5,1}    fair moved by w·bD1·D alone: Coinbase's lead (bD1 the in-sample slope of the target on D by itself)
                  (family 3, variant-7's idea on both books)
  exit1           every exit one tick beyond fair (a static hold for convergence) (family 4's static form)
Outside FX closures only; inside one the fair stays the engine's (the forecast was fitted on open minutes).

ROWS: live600, live1200, take50 (its maker side: PR5's paper rules, fill through, no weekend), n600usdt3.
usage: RX_EX=<file> python3 -I lag_engine.py OUT.json [WORKERS]
"""
import bisect, collections, datetime, json, math, os, random, statistics as st, sys
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lag_data as L  # noqa: E402
import signals as S  # noqa: E402

M, H, DAY = L.M, L.H, L.DAY
SEED, NB, BLOCK = 20261029, 10000, 3
CAPM = 30.0
ROWS = {
    "live600": dict(capital=600.0, fill="at", xhold=True),
    "live1200": dict(capital=1200.0, fill="at", xhold=True),
    "take50": dict(capital=600.0, fill="through", xhold=False),
    "n600usdt3": dict(size={(b, s, k): (75.0 if b == "USDT-GBP" else 25.0) for b in L.BOOKS for s in ("bid", "ask") for k in (0.001, 0.002, 0.003)},
                      fill="at", xhold=True),
}
CANDS = ["base", "pred_w0.5", "pred_w1", "gate_th3", "gate_th6", "cbD_w0.5", "cbD_w1", "exit1"]
FAMILY = {"pred_w0.5": "pred", "pred_w1": "pred", "gate_th3": "gate", "gate_th6": "gate", "cbD_w0.5": "cbD", "cbD_w1": "cbD", "exit1": "exit1"}

HM, HP, FM, FP = L.load_engine_inputs()
PR = L.rx_prints(HP, FP)
FAIR = L.fair_table(HM, FM)
XS, _ = L.exness_x(os.environ["RX_EX"])


def build_forecast():
    """{book: {t: (m̂, D, bD1·D)}} and the fit, from the in-sample half."""
    fc, fit = {}, {}
    for b in L.BOOKS:
        cb = L.coinbase(b)
        ts = [p[0] for p in PR[b]]; px = [p[1] for p in PR[b]]; qty = [p[2] for p in PR[b]]
        feats, train = {}, []
        for t, (f, x, fu) in sorted(FAIR[b].items()):
            if t < L.START[b] or L.D.closure(t) or L.D.closure(t + 5 * H):
                continue
            T = t + M
            bk = S.vwap(ts, px, qty, T - 15 * M, T) or S.last_before(ts, px, T, 2 * H)
            x0, x15 = XS.at(T + 1), XS.at(T - 15 * M + 1)
            c = cb.at(T)
            if not (bk and x0 and x15 and c):
                continue
            G = math.log(bk / f) * 1e4; dX = math.log(x0 / x15) * 1e4; Dv = math.log(c / f) * 1e4 - G
            feats[t] = (G, dX, Dv)
            if t < L.SPLIT:
                fut = S.vwap(ts, px, qty, T + 30_000, T + 30_000 + 60 * M)
                if fut: train.append(((G, dX, Dv), math.log(fut / bk) * 1e4))
        coef = S.ols([x for x, _ in train], [y for _, y in train])
        c1 = S.ols([(x[2],) for x, _ in train], [y for _, y in train])
        fit[b] = {"coef_[a,G,dX,D]": [round(c, 4) for c in coef], "coef_D_alone_[a,D]": [round(c, 4) for c in c1], "n": len(train)}
        out = {}
        for t, (G, dX, Dv) in feats.items():
            m = coef[0] + coef[1] * G + coef[2] * dX + coef[3] * Dv
            out[t] = (max(-CAPM, min(CAPM, m)), max(-CAPM, min(CAPM, c1[1] * Dv)))
        fc[b] = out
    return fc, fit


FC, FIT = build_forecast()


def knobs(cand):
    k = {}
    if cand.startswith("pred_w") or cand.startswith("cbD_w"):
        w = float(cand.split("_w")[1]); j = 0 if cand.startswith("pred") else 1
        def adj(b, t, f, w=w, j=j):
            v = FC[b].get(t)
            return f if (v is None or f is None or L.D.closure(t)) else f * (1 + w * v[j] / 1e4)
        k["fair_adj"] = adj
    elif cand.startswith("gate_th"):
        th = float(cand.split("th")[1])
        def gate(T, b, side, kk, th=th):
            t = (T - 30_000 - M) // M * M          # the paper minute this turn carries out (turn at t + 60 + 30 s)
            v = FC[b].get(t)
            if v is None or L.D.closure(t): return True
            return not ((side == "ask" and v[0] > th) or (side == "bid" and v[0] < -th))
        k["gate"] = gate
    elif cand == "exit1":
        k["exit_off"] = 1
    return k


def job(args):
    row, cand, part = args
    mins, prints, win = (HM, HP, L.HIST) if part == "hist" else (FM, FP, L.FWD)
    tr, _ = L.sim.run(mins, prints, win[0], win[1], **ROWS[row], **knobs(cand))
    return (row, cand, part), [(x["book"], x["tExit"], x["pnl"], x["gbp"], x["how"], x["tEntry"]) for x in tr]


def boot(v):
    n = len(v)
    if n < BLOCK + 1: return None
    rnd = random.Random(SEED); out = []
    for _ in range(NB):
        s = []
        while len(s) < n:
            i = rnd.randrange(n); s.extend(v[(i + j) % n] for j in range(BLOCK))
        out.append(st.fmean(s[:n]))
    out.sort()
    return [round(out[int(0.05 * NB)] * 365, 2), round(out[int(0.95 * NB)] * 365, 2), round(sum(1 for x in out if x <= 0) / NB, 4)]


def days_in(a, b):
    return [L.day(t) for t in range(a, b, DAY)]


def taker_study():
    """Family 5, once: at each open minute, a taker buy (or sell) of the book when the forecast says it rises (falls) by more
    than θ, filled at the last print plus (minus) half the measured spread and the 0.09 % fee, closed 60 minutes after at
    the VWAP of [T + 30 s, T + 60 min], either as a maker (no fee: an upper bound, the exit filling at that VWAP) or as a
    taker (half-spread and fee again). Out of sample only. Mean bps a trade and how many a day."""
    out = {}
    FEE, HALF = 9.0, 0.67
    for b in L.BOOKS:
        ts = [p[0] for p in PR[b]]; px = [p[1] for p in PR[b]]; qty = [p[2] for p in PR[b]]
        r = {}
        for th in (10, 15, 20, 25):
            gm, gt = [], []
            for t, (m, _) in FC[b].items():
                if t < L.SPLIT or abs(m) <= th: continue
                T = t + M
                p0 = S.last_before(ts, px, T, 2 * H); fut = S.vwap(ts, px, qty, T + 30_000, T + 60 * M)
                if not (p0 and fut): continue
                mv = math.log(fut / p0) * 1e4 * (1 if m > 0 else -1)
                gm.append(mv - HALF - FEE); gt.append(mv - 2 * HALF - 2 * FEE)
            days = (L.FWD[1] - L.SPLIT) / DAY
            r[f"th{th}"] = {"signals_per_day": round(len(gm) / days, 1), "maker_exit_bps": round(st.fmean(gm), 2) if gm else None,
                            "taker_exit_bps": round(st.fmean(gt), 2) if gt else None}
        out[b] = r
    return out


def main(out, workers):
    jobs = [(r, c, p) for r in ROWS for c in CANDS for p in ("hist", "fwd")]
    with Pool(workers) as pool:
        runs = dict(pool.map(job, jobs))
    alld = [d for d in days_in(L.START["USDC-GBP"], L.HIST[1]) + days_in(L.FWD[0], L.FWD[1])]
    split = L.day(L.SPLIT)
    res = {"fit": FIT, "bar": "OOS mean > 0, P(<=0) < 0.10; IS mean > 0; >= 2/3 months positive", "rows": {}}

    def daily(row, cand, book=None):
        d = collections.defaultdict(float)
        for part in ("hist", "fwd"):
            for bk, te, pnl, gbp, how, tE in runs[(row, cand, part)]:
                if book is None or bk == book: d[L.day(te)] += pnl
        return d

    def pair(row, cand, book=None):
        db, dc = daily(row, "base", book), daily(row, cand, book)
        v = [dc.get(x, 0.0) - db.get(x, 0.0) for x in alld]
        ins = [x for d, x in zip(alld, v) if d < split]; oos = [x for d, x in zip(alld, v) if d >= split]
        mo = collections.defaultdict(float)
        for d, x in zip(alld, v): mo[d[:7]] += x
        return {"is_gbp_year": round(365 * st.fmean(ins), 2), "oos_gbp_year": round(365 * st.fmean(oos), 2), "oos_boot90_pLe0": boot(oos),
                "months_pos": sum(1 for x in mo.values() if x > 1e-9), "months_n": sum(1 for x in mo.values() if abs(x) > 1e-9),
                "months": {k: round(x, 2) for k, x in sorted(mo.items())}}

    def own(row, cand):
        o = {}
        for lab, lo, hi in (("is", 0, L.SPLIT), ("oos", L.SPLIT, L.FWD[1])):
            tr = [x for p in ("hist", "fwd") for x in runs[(row, cand, p)] if lo <= x[1] < hi]
            o[lab] = {"pnl_gbp": round(sum(x[2] for x in tr), 2), "trips": len(tr), "stops": sum(1 for x in tr if x[4] == "taker"),
                      "bps_trip": round(1e4 * sum(x[2] for x in tr) / max(1e-9, sum(x[3] for x in tr)), 2),
                      "hold_h_median": round(st.median([(x[1] - x[5]) / H for x in tr if x[5]]), 2) if tr else None}
        return o
    # the parameter of each family: the best in-sample mean on live600
    chosen = {}
    for fam in set(FAMILY.values()):
        cs = [c for c in CANDS if FAMILY.get(c) == fam]
        chosen[fam] = max(cs, key=lambda c: pair("live600", c)["is_gbp_year"])
    res["chosen_on_live600_is"] = chosen
    for row in ROWS:
        R = {"own": {c: own(row, c) for c in CANDS}}
        for c in CANDS[1:]:
            R[c] = {"all": pair(row, c)}
            for b in L.BOOKS: R[c][b] = pair(row, c, b)
            a = R[c]["all"]
            R[c]["passes"] = bool(a["oos_gbp_year"] > 0 and a["oos_boot90_pLe0"] and a["oos_boot90_pLe0"][2] < 0.10 and a["is_gbp_year"] > 0
                                  and 3 * a["months_pos"] >= 2 * a["months_n"])
        res["rows"][row] = R
        print(row, {c: (R[c]["all"]["is_gbp_year"], R[c]["all"]["oos_gbp_year"], R[c]["all"]["oos_boot90_pLe0"], f'{R[c]["all"]["months_pos"]}/{R[c]["all"]["months_n"]}', R[c]["passes"]) for c in CANDS[1:]}, flush=True)
    res["taker"] = taker_study()
    print("taker", json.dumps(res["taker"]), flush=True)
    print("fit", json.dumps(FIT), flush=True)
    json.dump(res, open(out, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 4)
