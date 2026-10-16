"""The ranking: every headline arm of results/search.json in money at IG's minimum stake and at a GBP 10,000 notional,
the capital it needs, its Term 9(12) class, its verdict, and the equal-risk portfolio of the arms that pass the bar.

Run after search.py: python3 -P docs/agents/backtests/ig_search/scripts/report.py   (writes results/ranking.json)
"""
import json
import math
import os
import random
import statistics as st

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = json.load(open(os.path.join(HERE, "params", "frozen.json")))
R = json.load(open(os.path.join(HERE, "results", "search.json")))
MONTHS = json.load(open(os.path.join(HERE, "results", "arm_months.json")))
SP = P["ig_costs"]["spreads_points"]
REALISTIC = 10_000

# arm id, path in search.json, its B-source path (or None), market for stakes, by hand?, one line of rule
ARMS = [
    ("TSMOM_TS12", ["TSMOM", "A_TS12", "portfolio_monthly"], ["TSMOM", "B_TS12", "portfolio_monthly"], None, "by hand (monthly)", "12-month trend, 11 IG markets, risk-weighted, monthly"),
    ("TSMOM_ENS", ["TSMOM", "A_ENS", "portfolio_monthly"], ["TSMOM", "B_ENS", "portfolio_monthly"], None, "by hand (monthly)", "1/3/12-month trend ensemble, same markets"),
    ("PREFOMC", ["PREFOMC", "A"], ["PREFOMC", "B_dukascopy"], "US500", "by hand (8 a year)", "long US 500 into the FOMC statement day"),
    ("TOM_US500", ["TOM", "US500_A"], ["TOM", "US500_B"], "US500", "by hand (monthly)", "long US 500, last 2 to 3rd trading day"),
    ("TOM_UK100", ["TOM", "UK100_A"], ["TOM", "UK100_B"], "UK100", "by hand (monthly)", "the same on UK 100"),
    ("TOM_DE40", ["TOM", "DE40_A"], ["TOM", "DE40_B"], "DE40", "by hand (monthly)", "the same on Germany 40"),
    ("OVERNIGHT_US500", ["OVERNIGHT", "SPY_overnight"], ["OVERNIGHT", "QQQ_overnight"], "US500", "software (two trades a day)", "long US 500 close to open"),
    ("MONTHEND_EURUSD", ["MONTHEND_FIX", "EURUSD_A_dukascopy"], ["MONTHEND_FIX", "EURUSD_B_fxcm"], "EURUSD", "by hand (monthly, 14:00-16:00)", "month-end fix hedge flow, EUR/USD"),
    ("MONTHEND_GBPUSD", ["MONTHEND_FIX", "GBPUSD_A_dukascopy"], ["MONTHEND_FIX", "GBPUSD_B_fxcm"], "GBPUSD", "by hand (monthly)", "the same, GBP/USD"),
    ("MONTHEND_USDJPY", ["MONTHEND_FIX", "USDJPY_A_dukascopy"], ["MONTHEND_FIX", "USDJPY_B_fxcm"], "USDJPY", "by hand (monthly)", "the same, USD/JPY"),
    ("MONTHEND_AUDUSD", ["MONTHEND_FIX", "AUDUSD_A_dukascopy"], ["MONTHEND_FIX", "AUDUSD_B_fxcm"], "AUDUSD", "by hand (monthly)", "the same, AUD/USD"),
    ("GOLD_SEP_NOV", ["SEASONAL", "GOLD_SEP_NOV_A"], ["SEASONAL", "GOLD_SEP_NOV_B"], "GOLD", "by hand (twice a year)", "long gold in September and November"),
    ("WTI_MAR_APR", ["SEASONAL", "WTI_MAR_APR_A"], ["SEASONAL", "WTI_MAR_APR_B"], "WTI", "by hand (once a year)", "long WTI March-April"),
    ("SESSION_EURUSD", ["SESSION", "EURUSD"], None, "EURUSD", "by hand at fixed times, or software", "short EUR/USD 07:00-12:00 UK daily"),
    ("SESSION_GBPUSD", ["SESSION", "GBPUSD"], None, "GBPUSD", "by hand at fixed times, or software", "short GBP/USD 07:00-12:00 UK daily"),
    ("SESSION_USDJPY", ["SESSION", "USDJPY"], None, "USDJPY", "software (00:00-06:00 UK daily)", "long USD/JPY 00:00-06:00 UK daily"),
    ("SESSION_AUDUSD", ["SESSION", "AUDUSD"], None, "AUDUSD", "software (23:00-05:00 UK daily)", "short AUD/USD 23:00-05:00 UK daily"),
    ("MONDAY_ESG", ["MONDAY_GAP", "ESG_0.5pct"], None, "US500", "by hand (Sunday 23:00 UK)", "fade a 0.5 % S&P weekend gap, exit Monday 16:00 ET"),
    ("MONDAY_FILL", ["MONDAY_GAP", "FILL_0.5pct"], None, "US500", "by hand with a limit order", "the same, exit at Friday's close if touched"),
    ("VIX_CARRY", ["VIX_CARRY", "A_cboe"], ["VIX_CARRY", "B_fred"], None, "by hand (monthly)", "short front VIX in contango and VIX < 20, +50 % guaranteed stop, 10 % notional"),
    ("COT_CONTRA", ["COT_CONTRA", "A"], ["COT_CONTRA", "B"], None, "by hand (weekly)", "fade speculators' 3-year positioning extremes, 4 weeks"),
    ("REAL_YIELD_GOLD", ["REAL_YIELD_GOLD", "A"], ["REAL_YIELD_GOLD", "B"], "GOLD", "by hand (monthly)", "gold with the sign of falling 10-year real yields"),
    ("CREDIT_EQUITY", ["CREDIT_EQUITY", "timed_minus_always_monthly"], None, "US500", "by hand (daily close)", "US 500 only while the Baa spread is below its 6-month mean, against always long"),
]


def dig(d, path):
    for k in path or []:
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


def min_notional(m):
    s = SP[m]
    if "min_stake_gbp_per_pip" in s:
        return s["min_stake_gbp_per_pip"] * s["level"] / s.get("pip", 0.0001)
    return s["min_stake_gbp_per_point"] * s["level"] / s.get("point", 1)


def passes(r):
    tr, te = (r or {}).get("train", {}), (r or {}).get("test", {})
    return (te.get("n", 0) >= 10 and te.get("mean_bps", -1) > 0 and (te.get("t") or 0) >= 2.5 and (te.get("boot95_bps") or [-1])[0] > 0
            and tr.get("mean_bps", -1) > 0 and (tr.get("t") or 0) >= 2.0)


def money(te, notional):
    if not te or te.get("n", 0) < 3:
        return None
    per_year = te.get("per_year") or 0
    m = te["mean_bps"] / 1e4
    lo, hi = (te.get("boot95_bps") or [None, None])
    return {"notional_gbp": round(notional), "per_trade_gbp": round(m * notional, 2), "per_year_gbp": round(m * per_year * notional),
            "per_year_gbp_range": [round(lo / 1e4 * per_year * notional), round(hi / 1e4 * per_year * notional)] if lo is not None else None,
            "worst_single_gbp": round(te["worst_bps"] / 1e4 * notional), "worst_drawdown_gbp": round(te["max_drawdown_pct"] / 100 * notional)}


def main():
    rows = []
    for arm, pa, pb, mkt, hand, rule in ARMS:
        a, b = dig(R, pa), dig(R, pb)
        te = (a or {}).get("test", {})
        row = {"arm": arm, "rule": rule, "term_9_12": hand,
               "train_A": {k: (a or {}).get("train", {}).get(k) for k in ("n", "mean_bps", "t", "boot95_bps")},
               "test_A": {k: te.get(k) for k in ("n", "per_year", "mean_bps", "t", "boot95_bps", "worst_bps", "max_drawdown_pct", "annual_pct", "sharpe")},
               "test_B": {k: (b or {}).get("test", {}).get(k) for k in ("n", "mean_bps", "t", "boot95_bps")} if b else None,
               "passes_A": passes(a), "passes_B": passes(b) if b else None}
        if mkt:
            mn = min_notional(mkt)
            row["min_stake"] = {"market": mkt, **(money(te, mn) or {}), "margin_gbp": round(SP[mkt]["margin"] * mn)}
            row["at_10k"] = {**(money(te, REALISTIC) or {}), "margin_gbp": round(SP[mkt]["margin"] * REALISTIC)}
            dd = abs(te.get("max_drawdown_pct") or 0) / 100
            worst = abs(te.get("worst_bps") or 0) / 1e4
            row["capital_for_min_stake_gbp"] = round(max(SP[mkt]["margin"] * mn, max(dd, worst) * mn / 0.2))
        nr = dig(R, pa[:1] + ["verdict"])
        if isinstance(nr, str) and nr.startswith("not run"):
            row["verdict"] = nr
            row["test_A"] = {"n": (a or {}).get("n"), "mean_bps": (a or {}).get("mean_bps"), "t": (a or {}).get("t"), "boot95_bps": (a or {}).get("boot95_bps"),
                             "worst_bps": (a or {}).get("worst_bps"), "max_drawdown_pct": (a or {}).get("max_drawdown_pct"), "per_year": None}
        elif passes(a) and (b is None or passes(b)):
            row["verdict"] = "worth small real money after demo" if b is not None else "worth a demo forward test"
        elif passes(a) or passes(b):
            row["verdict"] = "worth a demo forward test"
        else:
            row["verdict"] = "dead"
        rows.append(row)
    # Equal-risk portfolio of the arms that pass on source A: weights 1/sigma of each arm's monthly series in the train era.
    survivors = [r["arm"] for r in rows if r["passes_A"]]
    key = {arm: ("TSMOM_A_" + arm.split("_")[1] if arm.startswith("TSMOM") else None) for arm, *_ in ARMS}
    port = None
    if survivors:
        series = {}
        names = {"PREFOMC": "PREFOMC_A", "OVERNIGHT_US500": "OVERNIGHT_SPY", "MONDAY_ESG": "MONDAY_ESG_0.5", "MONDAY_FILL": "MONDAY_FILL_0.5",
                 "VIX_CARRY": "VIX_CARRY_A_cboe", "COT_CONTRA": "COT_CONTRA_A", "REAL_YIELD_GOLD": "REAL_YIELD_GOLD_A", "CREDIT_EQUITY": "CREDIT_EQUITY_timed",
                 "GOLD_SEP_NOV": "GOLD_SEP_NOV_A", "WTI_MAR_APR": "WTI_MAR_APR_A"}
        for s in survivors:
            k = key.get(s) or names.get(s) or (s.replace("TOM_", "TOM_") + "_A" if s.startswith("TOM_") else
                                               "MONTHEND_" + s.split("_")[1] + "_A" if s.startswith("MONTHEND") else s)
            if k in MONTHS:
                series[s] = dict(MONTHS[k])
        tr0, tr1 = P["eras"]["default"]["train"]
        months = sorted(set().union(*[set(v) for v in series.values()]))
        w = {}
        for s, v in series.items():
            tr = [v.get(m, 0.0) for m in months if tr0[:7] <= m <= tr1[:7]]
            sd = st.pstdev(tr) if len(tr) > 2 else 0
            w[s] = 1 / sd if sd else 0
        tot = sum(w.values()) or 1
        w = {s: x / tot for s, x in w.items()}
        def pstats(a, b):
            x = [sum(w[s] * series[s].get(m, 0.0) for s in series) for m in months if a[:7] <= m <= b[:7]]
            if len(x) < 3:
                return {"n": len(x)}
            mu, sd = sum(x) / len(x), st.stdev(x)
            rng = random.Random(20261016)
            bs = sorted(sum(x[rng.randrange(len(x))] for _ in x) / len(x) for _ in range(10000))
            return {"months": len(x), "annual_pct": round(1200 * mu, 2), "annual_vol_pct": round(100 * sd * math.sqrt(12), 2),
                    "sharpe": round(mu / sd * math.sqrt(12), 2) if sd else None, "t": round(mu / (sd / math.sqrt(len(x))), 2) if sd else None,
                    "boot95_annual_pct": [round(1200 * bs[250], 2), round(1200 * bs[9749], 2)]}
        port = {"arms": survivors, "weights": {s: round(x, 3) for s, x in w.items()},
                "train": pstats(*P["eras"]["default"]["train"]), "test": pstats(*P["eras"]["default"]["test"]),
                "note": "monthly sums of each arm at one unit of notional, weighted 1/sigma on the train era"}
    out = {"rows": rows, "portfolio": port}
    with open(os.path.join(HERE, "results", "ranking.json"), "w") as fh:
        json.dump(out, fh, indent=1, sort_keys=True)
        fh.write("\n")
    for r in rows:
        te = r["test_A"]
        print(f'{r["arm"]:17s} {r["verdict"]:34s} A test n={te["n"]} mean={te["mean_bps"]} t={te["t"]} boot={te["boot95_bps"]} | train t={r["train_A"]["t"]} | B={r["test_B"] and (r["test_B"]["n"], r["test_B"]["mean_bps"], r["test_B"]["t"])}')
    print("portfolio", json.dumps(port))


if __name__ == "__main__":
    main()
