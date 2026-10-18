"""FXW-AUD's stake, Kelly fraction and ruin odds at GBP 500, 1,000 and 2,500, as ../params/frozen.json (SIZING) writes it.

The trades are FXW-AUD's 85 FXCM weekends 2016-2026 re-scored on their minute paths by ig_deepdive's fxw_paths.run()
(the frozen rule, an opening spread of 12 bps, 2 bps exit and funding), with no stop and with an IG guaranteed stop at
200 and 150 bps. Each trade carries its adverse excursion to the exit, so a margin close-out inside a trade is applied.
Writes results/sizing.json. Run: python3 -I docs/agents/backtests/ig_search3/scripts/sizing.py
"""
import json, math, os, random, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(BT, "ig_deepdive", "scripts"))
import fxw_paths as FP  # noqa: E402

P = json.load(open(os.path.join(HERE, "params", "frozen.json")))
SEED = 20261018
LEVEL = P["costs"]["fx"]["levels"]["AUDUSD"]
MIN_STAKE = 0.5            # GBP a pip
MARGIN = 0.05
TRADES_A_YEAR, YEARS, PATHS = 8, 5, 10000


def trade_set(stop=None):
    trs, paths = FP.trades(), FP.load_paths()
    out = []
    for t in trs:
        r, kind, worst = FP.run(t, paths[t["sun_utc"]], 12, stop, guaranteed=stop is not None)
        if stop is not None:
            worst = min(worst, stop + 1.5e-4 / t["omid"] * 1e4)
        out.append({"r": r, "worst": worst / 1e4, "kind": kind, "year": t["sun_utc"]})
    return out


def kelly(rs):
    n = len(rs)
    m = sum(rs) / n
    v = sum((x - m) ** 2 for x in rs) / (n - 1)
    rng = random.Random(SEED)
    means = sorted(sum(rs[rng.randrange(n)] for _ in range(n)) / n for _ in range(10000))
    lo = means[250]
    return {"mean_bps": round(1e4 * m, 2), "sd_bps": round(1e4 * math.sqrt(v), 1), "boot95_lo_bps": round(1e4 * lo, 2),
            "kelly_leverage": round(m / v, 1), "half_kelly_leverage": round(m / v / 2, 1),
            "kelly_leverage_at_boot_lo": round(lo / v, 1) if lo > 0 else 0.0}


def simulate(trs, account, notional):
    rng = random.Random(SEED)
    n_tr = TRADES_A_YEAR * YEARS
    finals, dd50, closeouts, ruins, stopped_trading = [], 0, 0, 0, 0
    worst_trade = 0.0
    for _ in range(PATHS):
        e, peak, hit_dd, co, ruined = account, account, False, False, False
        for _ in range(n_tr):
            if e < MARGIN * notional or e <= 0.1 * account:
                ruined = ruined or e <= 0.1 * account
                break
            t = trs[rng.randrange(len(trs))]
            if e - notional * t["worst"] < 0.5 * MARGIN * notional:
                pnl, co = -notional * t["worst"], True
            else:
                pnl = notional * t["r"]
            worst_trade = min(worst_trade, pnl)
            e += pnl
            peak = max(peak, e)
            if e <= 0.5 * peak:
                hit_dd = True
            if e <= 0.1 * account:
                ruined = True
        finals.append(e)
        dd50 += hit_dd
        closeouts += co
        ruins += ruined
    finals.sort()
    yr = [(x - account) / YEARS for x in finals]
    return {"notional_gbp": round(notional), "stake_gbp_per_pip": round(notional * 1e-4 / LEVEL, 2),
            "margin_gbp": round(MARGIN * notional), "leverage": round(notional / account, 2),
            "gbp_a_year_median": round(yr[len(yr) // 2]), "gbp_a_year_p05": round(yr[int(0.05 * len(yr))]),
            "gbp_a_year_p95": round(yr[int(0.95 * len(yr))]),
            "p_drawdown_50pct": round(dd50 / PATHS, 4), "p_margin_closeout": round(closeouts / PATHS, 4),
            "p_ruin_equity_le_10pct": round(ruins / PATHS, 4), "worst_single_trade_gbp_seen": round(worst_trade)}


def main():
    out = {"rule": "frozen SIZING; FXW-AUD's 85 FXCM trades, 8 a year for 5 years, 10,000 paths, fixed stake (no compounding)"}
    sets = {"no_stop": trade_set(None), "gsl_200": trade_set(200), "gsl_150": trade_set(150)}
    for name, trs in sets.items():
        rs = [t["r"] for t in trs]
        k = kelly(rs)
        k["worst_trade_bps"] = round(1e4 * min(rs), 1)
        k["worst_excursion_bps"] = round(1e4 * max(t["worst"] for t in trs), 1)
        res = {"kelly": k, "accounts": {}}
        for acct in P["families"]["SIZING"]["accounts_gbp"]:
            stakes = {"ig_minimum": MIN_STAKE * LEVEL / 1e-4, "margin_half_of_account": acct * 0.5 / MARGIN}
            hk = k["half_kelly_leverage"] * acct
            if hk < stakes["margin_half_of_account"]:
                stakes["half_kelly"] = hk
            stakes["ig_max_20x (deviation 1)"] = acct / MARGIN
            res["accounts"][str(acct)] = {s: simulate(trs, acct, n) for s, n in stakes.items()}
            for s, n in stakes.items():
                res["accounts"][str(acct)][s]["worst_excursion_mtm_gbp (deviation 1)"] = round(-n * max(t["worst"] for t in trs))
        out[name] = res
    # the IG check: S1a's ten trades at IG's own quotes
    s1a = json.load(open(os.path.join(BT, "ig_deepdive", "results", "s1a_sb.json")))
    out["s1a_ig_check"] = s1a["summary"]["scoring_hourly_approximation"]
    os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
    json.dump(out, open(os.path.join(HERE, "results", "sizing.json"), "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
