"""The review's ranked table: each candidate's chosen arm, sized to an account, from the other scorers' results.

Sizing rule, fixed before it was applied: notional = L x account, L = min(IG's retail leverage cap for the market,
0.20 / the arm's worst historical drawdown as a fraction of notional), so the worst drawdown seen costs 20 % of the
account. GBP a year = the arm's annual return on notional x L x account (spread bets: no tax for a UK resident).
Minimum bet: IG's smallest stake sets a smallest notional; an account too small to carry it at L is flagged.
Output: results/summary.json.
"""
import json, os
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from common import RES, LEVEL, dump


def load(n):
    return json.load(open(os.path.join(RES, n)))


def main():
    idx, vrp, es, fx = load("idx_calendar.json"), load("vrp.json"), load("es_sunday.json"), load("fxw_ig.json")
    aud_usd = 0.66  # AUD/USD near 2026-10 for the pip-to-notional conversion only (an assumption, not a measured rate)
    cands = []

    def add(name, arm, annual_frac, dd_frac, per_year, mean_bps, t, maxlev, min_notional_gbp, note):
        L = min(maxlev, 0.20 / abs(dd_frac)) if dd_frac else maxlev
        row = {"candidate": name, "arm": arm, "trades_a_year": per_year, "mean_bps_a_trade": mean_bps, "t": t,
               "annual_pct_of_notional": round(100 * annual_frac, 2), "worst_dd_pct_of_notional": round(100 * dd_frac, 1),
               "L": round(L, 2), "min_notional_gbp": None if min_notional_gbp is None else round(min_notional_gbp), "note": note}
        for acct in (1000, 5000, 20000):
            row[f"gbp_a_year_at_{acct}"] = round(annual_frac * L * acct)
            row[f"min_bet_fits_at_{acct}"] = None if min_notional_gbp is None else min_notional_gbp <= L * acct
        cands.append(row)

    a = fx["E0_spread_12"]
    add("FXW-AUD at IG", "E0, G 20 bps, IG open spread 12 bps assumed", a["annual_bps"] / 1e4, a["max_dd_bps"] / 1e4,
        a["per_year"], a["mean_bps"], a["t"], 20, 0.5 * 1e4 * aud_usd, "AUD/USD margin 5 %; £0.50 a pip")
    for mkt, arm in (("US500", "FOMC"), ("US500", "PREHOL"), ("UK100", "PREHOL"), ("USTECH", "ON"), ("US500", "ON")):
        r = idx[mkt]["arms"][arm]["eras_net"]["2011on"]
        mb = {"US500": 1.0 * LEVEL["US500"], "UK100": 0.5 * LEVEL["UK100"],
              "USTECH": 1.0 * LEVEL["USTECH"]}[mkt]
        add(f"{arm} {mkt} DFB", f"{arm}, 2011-2026 net of IG spread and funding", r["annual_bps"] / 1e4,
            r["max_dd_bps"] / 1e4, r["per_year"], r["mean_bps"], r["t"], 20, mb,
            "minimum stake £1 a point (US 500, US Tech 100) or £0.50 (FTSE 100): the notional floor is in points x £")
    e = es["ESG_0.5_x2"]
    add("ESG US500 Sunday-gap fade", "G 0.5 %, exit Monday 16:00 ET, 730 days", e["annual_bps"] / 1e4,
        e["max_dd_bps"] / 1e4, e["per_year"], e["mean_bps"], e["t"], 20, LEVEL["US500"], "18 trades: descriptive")
    b = vrp["BENCH"]["2011on"]["PUT"]
    ov = vrp["IG_overlay"]["PUT"]["pct_of_spx_a_year"][1] / 100
    add("PUT-write US 500 monthly", "CBOE PUT 2011-2026 less IG's widest option spread", b["ann_return_pct"] / 100 - ov,
        b["max_dd_pct"] / 100, 12, None, None, 1, 10 * LEVEL["US500"],
        f"S&P 500 with dividends made {vrp['BENCH']['2011on']['SPX_TR(SPY)']['ann_return_pct']} % a year, worst "
        f"{vrp['BENCH']['2011on']['SPX_TR(SPY)']['max_dd_pct']} %; monthly US 500 options: minimum £10 a point")
    v = vrp["VXS"]["VXS_stop30"]["daily_pct_of_notional"]
    add("VXS short VIX future, guaranteed stop +30 %", "2013-05 -> 2026-10", v["annual_bps"] / 1e4,
        v["max_dd_bps"] / 1e4, 12, None, None, 5, None,
        f"daily Sharpe {v['annual_sharpe']} a year; VIX margin 20 %; the minimum stake was not resolved")
    dump("summary.json", {"rule": __doc__.strip().splitlines()[2:5], "rows": cands})
    for r in cands:
        print(r)


if __name__ == "__main__":
    main()
