"""DAT study, step 3: the screen of design.md §3 on MSTR, 2020-08-11 → 2024-12-31 (no return after 2024-12-31).

H1  log mNAV → MSTR minus BTC log return over 20 and 60 trading days: non-overlapping OLS (and the mean over start
    offsets), overlapping OLS with Newey-West at lag 2h, Stambaugh's first-order bias correction, and a null bootstrap
    (beta = 0, AR(1) predictor at the Kendall-corrected rho, residual pairs resampled; 10,000 draws, seed 20261001).
H2  the long-only switch (MSTR when log mNAV ≤ its trailing 252-day median, else BTC), next-open execution, costs.
H3  long BTC / short MSTR CFD when log mNAV ≥ its trailing 252-day 75th percentile, assumed financing, close-outs.
H4  BTC's overnight move → MSTR's open-to-close (exploratory).
Descriptive: persistence (daily AR(1), half-life), and how the premium closes (price vs issuance).

Reads ../results/mnav_screen.csv (build_mnav.py) and the committed French daily RF (cut at 2024-12-31 as parsed).
Writes ../results/screen.json with design.md's sha256. Run: python3 docs/agents/backtests/dat/scripts/screen.py
Options: --csv mnav_screen_presslag.csv (the press-release sensitivity), --from 2021-01-04 (the start sensitivity),
--out NAME.json.
"""
import csv, math, os, sys
import numpy as np
from common import RES, SCREEN_END, design_sha, newey_west_se, ols, r6, read_rf, write_json

SEED, BOOT = 20261001, 10000
TD = 252


def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def load(csv_name, start):
    R = [r for r in csv.DictReader(open(os.path.join(RES, csv_name))) if start <= r["date"] <= SCREEN_END]
    assert R and max(r["date"] for r in R) <= SCREEN_END
    f = lambda k: np.array([float(r[k]) for r in R])
    return {"date": [r["date"] for r in R], "O": f("mstr_open"), "P": f("mstr_close"), "Bo": f("btc_0930et"),
            "B": f("btc_close_et"), "H": f("btc_held"), "N": f("shares_basic"), "x": np.log(f("mnav_simple")),
            "xev": np.log(f("mnav_ev"))}


# ---------------------------------------------------------------- H1
def h1(S, x, h, rng):
    lp, lb = np.log(S["P"]), np.log(S["B"])
    n = len(x)
    d = np.array([(lp[t + h] - lp[t]) - (lb[t + h] - lb[t]) for t in range(n - h)])
    xs = x[:n - h]
    # non-overlapping, offset 0
    idx = np.arange(0, n - h, h)
    y, xk = d[idx], xs[idx]
    X = np.c_[np.ones(len(xk)), xk]
    b, e, XtXi = ols(y, X)
    s2 = e @ e / (len(y) - 2)
    t_cls = b[1] / math.sqrt(s2 * XtXi[1, 1])
    offs = []
    for o in range(h):
        ii = np.arange(o, n - h, h)
        bo, _, _ = ols(d[ii], np.c_[np.ones(len(ii)), xs[ii]])
        offs.append(bo[1])
    # predictor AR(1) on the same grid: x at idx and at idx + h
    x1 = x[idx + h]
    a, v, _ = ols(x1, X)
    rho = a[1]
    u = y - y.mean()                                        # return residual under the null (beta = 0)
    u_alt = e
    suv, svv = np.mean(u_alt * v), np.mean(v * v)
    m = len(y)
    bias = -(suv / svv) * (1 + 3 * rho) / m
    beta_c = b[1] - bias
    rho_c = min(rho + (1 + 3 * rho) / m, 0.999)
    # null bootstrap
    sims = np.empty(BOOT)
    mu_x = float(np.mean(xk))
    for s in range(BOOT):
        j = rng.integers(0, m, m)
        us, vs = u[j], v[j]
        xx = np.empty(m + 1)
        xx[0] = xk[0]
        for k in range(m):
            xx[k + 1] = mu_x * (1 - rho_c) + rho_c * xx[k] + vs[k]       # AR(1) at the Kendall-corrected rho
        yy = y.mean() + us                                              # beta = 0
        bs, _, _ = ols(yy, np.c_[np.ones(m), xx[:m]])
        sims[s] = bs[1]
    p_boot = float((1 + np.sum(sims <= b[1])) / (1 + BOOT))
    # overlapping with Newey-West
    bo, se, nobs = newey_west_se(d, np.c_[np.ones(len(xs)), xs], 2 * h)
    sd_x = float(np.std(x, ddof=1))
    return {"h": h, "n_nonoverlap": int(m), "beta": r6(b[1]), "t_classical": r6(t_cls),
            "beta_mean_over_offsets": r6(np.mean(offs)), "beta_offsets_min": r6(min(offs)), "beta_offsets_max": r6(max(offs)),
            "rho_h": r6(rho), "sigma_uv_over_sigma_v2": r6(suv / svv), "corr_uv": r6(suv / math.sqrt(np.mean(u_alt ** 2) * svv)),
            "stambaugh_bias": r6(bias), "beta_bias_corrected": r6(beta_c), "rho_kendall": r6(rho_c),
            "p_boot_one_sided": r6(p_boot), "boot_null_beta_mean": r6(sims.mean()), "boot_null_beta_sd": r6(sims.std()),
            "overlap_n": int(nobs), "overlap_beta": r6(bo[1]), "overlap_nw_t": r6(bo[1] / se[1]), "nw_lag": 2 * h,
            "sd_x": r6(sd_x), "effect_per_sd_x_pct": r6(100 * b[1] * sd_x),
            "effect_per_sd_x_bias_corrected_pct": r6(100 * beta_c * sd_x),
            "sd_rel_return_h": r6(float(np.std(y, ddof=1))), "u_sd": r6(float(np.std(e, ddof=2))), "v_sd": r6(float(np.sqrt(svv)))}


def holm(ps):
    order = sorted(range(len(ps)), key=lambda i: ps[i])
    out, ok = [False] * len(ps), True
    for j, i in enumerate(order):
        ok = ok and ps[i] <= 0.05 / (len(ps) - j)
        out[i] = ok
    return out


# ---------------------------------------------------------------- H2 / H3 helpers
def trailing_q(x, q, win, minwin):
    """q-quantile of x over [t-win, t-1] (expanding from minwin days); nan before minwin."""
    out = np.full(len(x), np.nan)
    for t in range(minwin, len(x)):
        out[t] = np.quantile(x[max(0, t - win):t], q)
    return out


def ann(r):
    r = np.asarray(r)
    return 100 * (math.exp(np.log1p(r).sum() * TD / len(r)) - 1)


def switch(S, sig, cost, fee=0.0015, lag_out=0, rf=None):
    """Open-to-open simple returns; position for return j (open j → open j+1) is decided at close j-1."""
    O, Bo = S["O"], S["Bo"]
    RM = O[1:] / O[:-1] - 1
    RB = Bo[1:] / Bo[:-1] - 1
    n = len(RM)
    w = np.full(n, np.nan)
    for j in range(1, n):
        if not math.isnan(sig[j - 1]):
            w[j] = sig[j - 1]
    ok = ~np.isnan(w)
    first = int(np.argmax(ok))
    w, RM, RB = w[first:], RM[first:], RB[first:]
    strat = np.empty(len(w)); sw = 0; transit = 0
    for j in range(len(w)):
        if j > 0 and w[j] != w[j - 1]:
            sw += 1
            c = cost
            if lag_out and w[j - 1] == 1 and w[j] == 0:
                transit = lag_out
        else:
            c = 0.0
        if transit > 0:
            strat[j] = -c
            transit -= 1
        elif w[j] == 1:
            strat[j] = RM[j] - c
        else:
            strat[j] = RB[j] - fee / TD - c
    wbar = float(w.mean())
    bench = {"btc": RB - fee / TD, "mstr": RM, "mix": wbar * RM + (1 - wbar) * (RB - fee / TD)}
    dRel = RM - RB
    Xw = np.c_[np.ones(len(w)), w]
    bt, se, _ = newey_west_se(dRel, Xw, 10)
    out = {"days": int(len(w)), "first_position_index": first + 1, "switches": sw, "mean_w": r6(wbar),
           "ann_pct": r6(ann(strat)), "timing_skill_bps_day": r6(1e4 * bt[1]), "timing_skill_nw_t": r6(bt[1] / se[1])}
    for k, b in bench.items():
        ex = strat - b
        be, sb, _ = newey_west_se(ex, np.ones((len(ex), 1)), 10)
        out[f"bench_{k}_ann_pct"] = r6(ann(b))
        out[f"excess_vs_{k}_ann_pct_arith"] = r6(100 * TD * be[0])
        out[f"excess_vs_{k}_nw_t"] = r6(be[0] / sb[0])
    return out


def pair(S, sig, rf_by_date, buffer=0.2, margin=0.2, cfd_rt=0.0010, etn_switch=0.0030, fee=0.0015,
         fin_spread=0.035, closeout=True):
    """Long the BTC ETN, short MSTR (CFD), equal notional, when sig == 1. Per unit notional, open to open."""
    O, Bo, dates = S["O"], S["Bo"], S["date"]
    RM = O[1:] / O[:-1] - 1
    RB = Bo[1:] / Bo[:-1] - 1
    n = len(RM)
    pnl = np.zeros(n); inpos = np.zeros(n, bool)
    state, entry_px, eq, entries, closeouts, blocked = 0, None, 0.0, 0, 0, False
    worst = 0.0
    for j in range(1, n):
        s = sig[j - 1]
        if math.isnan(s):
            continue
        want = s == 1 and not blocked
        if s == 0:
            blocked = False
        if want and state == 0:
            state, entries, eq, rel = 1, entries + 1, margin + buffer, 1.0
            pnl[j] -= (cfd_rt / 2 + etn_switch)
        elif not want and state == 1:
            state = 0
            pnl[j] -= (cfd_rt / 2 + etn_switch)
        if state == 1:
            rf = rf_by_date.get(dates[j], 0.0)
            fin = (fin_spread - rf * TD) / TD
            short = -RM[j] - fin
            pnl[j] += RB[j] - fee / TD + short
            inpos[j] = True
            eq += short * rel
            rel *= (1 + RM[j])
            worst = min(worst, eq - (margin + buffer))
            if closeout and eq < 0.5 * margin * rel:
                state, blocked, closeouts = 0, True, closeouts + 1
                pnl[j] -= (cfd_rt / 2 + etn_switch)
    valid = ~np.isnan(sig[:-1])
    first = int(np.argmax(valid)) + 1
    p = pnl[first:]
    be, sb, _ = newey_west_se(p, np.ones((len(p), 1)), 10)
    return {"days": int(len(p)), "days_in": int(inpos[first:].sum()), "entries": entries, "closeouts": closeouts,
            "ann_pct_per_notional_arith": r6(100 * TD * be[0]), "nw_t": r6(be[0] / sb[0]),
            "ann_pct_on_capital_arith": r6(100 * TD * be[0] / (1 + margin + buffer)),
            "worst_cfd_equity_drawdown_per_notional": r6(worst)}


# ---------------------------------------------------------------- main
def main():
    csv_name = arg("--csv", "mnav_screen.csv")
    start = arg("--from", "2020-08-11")
    out_name = arg("--out", "screen.json")
    S = load(csv_name, start)
    rng = np.random.default_rng(SEED)
    res = {"design_sha256": design_sha(), "input": csv_name, "first": S["date"][0], "last": S["date"][-1],
           "days": len(S["date"])}
    # persistence (descriptive)
    for key in ("x", "xev"):
        x = S[key]
        a, v, _ = ols(x[1:], np.c_[np.ones(len(x) - 1), x[:-1]])
        rho = a[1]
        T = len(x)
        res[f"persistence_{key}"] = {"rho_daily": r6(rho), "half_life_days": r6(math.log(0.5) / math.log(rho)),
                                     "n_eff_mean": r6(T * (1 - rho) / (1 + rho)),
                                     "episodes_T_over_half_life": r6(T / (math.log(0.5) / math.log(rho))),
                                     "mean": r6(x.mean()), "sd": r6(x.std(ddof=1)), "min": r6(x.min()), "max": r6(x.max())}
    # H1
    res["H1"] = {}
    for key in ("x", "xev"):
        res["H1"][key] = [h1(S, S[key], h, rng) for h in (20, 60)]
    ps = [r["p_boot_one_sided"] for r in res["H1"]["x"]]
    res["H1"]["holm_x_20_60"] = holm(ps)
    # decomposition: how the premium closes (descriptive)
    dec = []
    for h in (20, 60):
        lp, lb, lN, lH, x = np.log(S["P"]), np.log(S["B"]), np.log(S["N"]), np.log(S["H"]), S["x"]
        n = len(x)
        idx = np.arange(0, n - h, h)
        dx = x[idx + h] - x[idx]
        dr = (lp[idx + h] - lp[idx]) - (lb[idx + h] - lb[idx])
        di = (lN[idx + h] - lN[idx]) - (lH[idx + h] - lH[idx])
        X = np.c_[np.ones(len(idx)), x[idx]]
        bx, _, _ = ols(dx, X); br, _, _ = ols(dr, X); bi, _, _ = ols(di, X)
        dec.append({"h": h, "beta_dx": r6(bx[1]), "beta_price_part": r6(br[1]), "beta_issuance_part": r6(bi[1]),
                    "mean_issuance_term": r6(di.mean()), "mean_issuance_term_when_x_above_median": r6(
                        di[x[idx] > np.median(x[idx])].mean()), "mean_issuance_term_when_x_below_median": r6(
                        di[x[idx] <= np.median(x[idx])].mean())})
    res["decomposition_x"] = dec
    # H2
    x, xev = S["x"], S["xev"]
    med252 = trailing_q(x, 0.5, 252, 126)
    rules = {"primary_252d_median": (x, med252, "le"),
             "robust_126d_median": (x, trailing_q(x, 0.5, 126, 126), "le"),
             "robust_252d_p25": (x, trailing_q(x, 0.25, 252, 126), "le"),
             "robust_ev_252d_median": (xev, trailing_q(xev, 0.5, 252, 126), "le")}
    res["H2"] = {}
    for name, (xx, thr, _) in rules.items():
        sig = np.where(np.isnan(thr), np.nan, (xx <= thr).astype(float))
        res["H2"][name] = {f"cost_{int(c * 1e4)}bps": switch(S, sig, c) for c in (0.0, 0.0030, 0.0060)}
        if name == "primary_252d_median":
            res["H2"][name]["cross_venue_100bps_lag3"] = switch(S, sig, 0.0100, lag_out=3)
    # H3
    rf = read_rf()
    p75 = trailing_q(x, 0.75, 252, 126)
    sig3 = np.where(np.isnan(p75), np.nan, (x >= p75).astype(float))
    res["H3"] = {"with_closeout": pair(S, sig3, rf), "without_closeout": pair(S, sig3, rf, closeout=False),
                 "financing_note": "short pays (3.5 % - RF) a year: IG's 3 % admin over the benchmark plus a 0.5 % borrow charge; Trading 212's MSTR CFD rate unverified"}
    # H4
    lp, lo, lb, lbo = np.log(S["P"]), np.log(S["O"]), np.log(S["B"]), np.log(S["Bo"])
    nt = lbo[1:] - lb[:-1]
    it = lp[1:] - lo[1:]
    jt = it - (lb[1:] - lbo[1:])
    gt = lo[1:] - lp[:-1]
    h4 = {}
    for nm, y in (("mstr_open_to_close", it), ("mstr_minus_btc_open_to_close", jt), ("gap_descriptive", gt)):
        b, se, nobs = newey_west_se(y, np.c_[np.ones(len(nt)), nt], 5)
        h4[nm] = {"beta": r6(b[1]), "nw_t": r6(b[1] / se[1]), "n": int(nobs)}
    res["H4"] = h4
    write_json(out_name, res)
    # print the headline
    for key in ("x", "xev"):
        for r in res["H1"][key]:
            print(f"H1 {key} h={r['h']}: beta {r['beta']:+.4f} (t {r['t_classical']:+.2f}, n {r['n_nonoverlap']}), "
                  f"bias-corrected {r['beta_bias_corrected']:+.4f}, p_boot {r['p_boot_one_sided']:.4f}; overlap NW t "
                  f"{r['overlap_nw_t']:+.2f}; per SD x {r['effect_per_sd_x_pct']:+.1f}% (corrected {r['effect_per_sd_x_bias_corrected_pct']:+.1f}%)")
    print("Holm x:", res["H1"]["holm_x_20_60"])
    for nm, d in res["H2"].items():
        for c, r in d.items():
            print(f"H2 {nm} {c}: ann {r['ann_pct']:+.1f}% | BTC {r['bench_btc_ann_pct']:+.1f}% MSTR {r['bench_mstr_ann_pct']:+.1f}% "
                  f"mix {r['bench_mix_ann_pct']:+.1f}% | vs mix {r['excess_vs_mix_ann_pct_arith']:+.1f}% (t {r['excess_vs_mix_nw_t']:+.2f}) "
                  f"| timing {r['timing_skill_bps_day']:+.1f} bp/day t {r['timing_skill_nw_t']:+.2f} | switches {r['switches']} w {r['mean_w']:.2f}")
    print("H3:", res["H3"]["with_closeout"], res["H3"]["without_closeout"])
    print("H4:", h4)
    print("persistence:", res["persistence_x"], res["persistence_xev"])
    print("decomposition:", dec)


if __name__ == "__main__":
    main()
