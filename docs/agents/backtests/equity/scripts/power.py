"""Power checks for the five candidates.

Inputs: screen_french.json (screening window 1926-07 -> 2015-12, never later),
plus the Trading 212 fee schedule (its help-centre articles, read 2026-10-01; the API spec is inputs/t212_openapi.json)
and stated assumptions, each labelled. Output: power.json.

Conventions: one-sided alpha 5 % (z 1.645) and 80 % power (z 0.842) unless stated;
"t=2" columns are the number of periods for the expected t-statistic to reach 2.
Holm over k hypotheses: the first test runs at alpha/k, so the strictest z is used
for the 'holm5' columns (k = 5, alpha/k = 1 %, one-sided z 2.326).
"""
import json, math, os
import numpy as np
from scipy.stats import norm

HERE = os.path.dirname(os.path.abspath(__file__))
S = json.load(open(os.path.join(HERE, "..", "results", "screen_french.json")))
Z_A, Z_B, Z_HOLM5 = norm.ppf(0.95), norm.ppf(0.80), norm.ppf(0.99)
OUT = {"conventions": "one-sided alpha 5% unless 'holm5' (alpha 1%), power 80%",
       "screen_window": S["screen_end"]}

FX_RT = 0.0030          # 0.15 % each way, T212 help 360018909758 (USD instruments, GBP account, any API order)
# Spread assumptions (UNVERIFIED estimates, to be measured by the paper test):
SPREAD_RT_CORE_GBP_ETF = 0.0008     # 8 bps round trip, LSE GBP line of a core S&P 500 / All-World UCITS ETF
SPREAD_RT_SECTOR_ETF = 0.0020       # 20 bps round trip, LSE sector UCITS ETF line
SPREAD_RT_US_LARGECAP = 0.0004      # 4 bps round trip at the touch, S&P 500 stock, regular hours


def power_one_sided(expected_t, z=Z_A):
    return float(norm.cdf(expected_t - z))


def years_needed(ir, z_total):
    return None if ir <= 0 else (z_total / ir) ** 2


# ------------------------------------------------------------ C2 TOM (per-event test)
tom = {}
HELD_OUT_EVENTS = 128   # month turns 2016-01 .. 2026-08 inclusive of the files' last month (count, not data)
for per, v in S["tom"].items():
    mu = v["diff_per_event_pct"] / 100
    sd = v["tom4_sd_pct"] / 100          # the event-level sd (TOM window); the diff adds a near-constant
    cost = SPREAD_RT_CORE_GBP_ETF        # one round trip per event on a GBP line, no FX
    net = mu - cost
    t_ho = net / sd * math.sqrt(HELD_OUT_EVENTS)
    tom[per] = {
        "effect_per_event_pct": round(100 * mu, 3), "event_sd_pct": round(100 * sd, 3),
        "effect_net_of_8bps_rt_pct": round(100 * net, 3),
        "events_for_80pct_power_net": round(((Z_A + Z_B) * sd / net) ** 2) if net > 0 else None,
        "years_for_80pct_power_net": round(((Z_A + Z_B) * sd / net) ** 2 / 12, 1) if net > 0 else None,
        "heldout_2016_2026_expected_t_net": round(t_ho, 2),
        "heldout_power_net": round(power_one_sided(t_ho), 3),
        "heldout_power_net_holm5": round(power_one_sided(t_ho, Z_HOLM5), 3),
        "forward_1yr_power_net": round(power_one_sided(net / sd * math.sqrt(12)), 3),
    }
OUT["C2_TOM"] = {"mde_per_event_pct_heldout_80pct": round(100 * (Z_A + Z_B) * 0.021 / math.sqrt(HELD_OUT_EVENTS), 3),
                 "by_screen_period": tom,
                 "independent_bets_per_year": 12}

# ------------------------------------------------------------ C1 trend (Sharpe difference, Memmel 2003)
def memmel_years(sr1_a, sr2_a, rho, per_year=12, z_total=Z_A + Z_B):
    s1, s2 = sr1_a / math.sqrt(per_year), sr2_a / math.sqrt(per_year)
    d = s1 - s2
    if d <= 0:
        return None
    v1 = 2 * (1 - rho) + 0.5 * (s1 ** 2 + s2 ** 2 - 2 * s1 * s2 * rho ** 2)   # var of sqrt(T)*(SR1-SR2)
    T = v1 * (z_total / d) ** 2
    return T / per_year

tr = S["trend_10m_sma_us_market"]
trend = {}
for per, v in tr.items():
    sr_t, sr_b = v["timing_excess"]["sharpe_or_ir"], v["buyhold_excess"]["sharpe_or_ir"]
    # correlation of the two monthly excess series is implied by their vols and the active vol:
    st, sb, sa = v["timing_excess"]["sd_ann_pct"], v["buyhold_excess"]["sd_ann_pct"], v["active_vs_buyhold"]["sd_ann_pct"]
    rho = (st ** 2 + sb ** 2 - sa ** 2) / (2 * st * sb)
    switches = v["switches_per_year"]
    cost_drag = switches * SPREAD_RT_CORE_GBP_ETF / 2 * 100   # a switch is one side; a round trip is two switches
    trend[per] = {"sharpe_timing": sr_t, "sharpe_buyhold": sr_b, "rho": round(rho, 3),
                  "active_return_ann_pct": v["active_vs_buyhold"]["mean_ann_pct"],
                  "active_ir": v["active_vs_buyhold"]["sharpe_or_ir"],
                  "years_for_80pct_power_on_sharpe_difference": None if memmel_years(sr_t, sr_b, rho) is None
                  else round(memmel_years(sr_t, sr_b, rho), 1),
                  "maxdd_timing_pct": v["maxdd_timing_pct"], "maxdd_buyhold_pct": v["maxdd_buyhold_pct"],
                  "switches_per_year_one_asset": switches,
                  "cost_drag_ann_pct_at_8bps_rt": round(cost_drag, 3)}
OUT["C1_TREND"] = {"by_screen_period": trend,
                   "note": "a switch is one trade; independent bets ~ switches per year x assets (about 1.3 x 5 = 6.5)"}

# ------------------------------------------------------------ C3 sector momentum (IR test)
im = S["industry_momentum_top3_of_12"]
sec = {}
for per, v in im.items():
    ir = v["active_vs_equal_weight_12"]["sharpe_or_ir"]
    mean = v["active_vs_equal_weight_12"]["mean_ann_pct"] / 100
    sd = v["active_vs_equal_weight_12"]["sd_ann_pct"] / 100
    repl = v["mean_share_of_book_replaced_per_month"]          # share of the book replaced each month
    for label, rt in [("gbp_lines_no_fx", SPREAD_RT_SECTOR_ETF), ("usd_lines_fx", SPREAD_RT_SECTOR_ETF + FX_RT)]:
        drag = repl * 12 * rt                                   # replaced share x months x round-trip cost
        net_ir = (mean - drag) / sd
        sec.setdefault(per, {})[label] = {
            "gross_ir": ir, "cost_drag_ann_pct": round(100 * drag, 2), "net_ir": round(net_ir, 3),
            "years_for_t2": round((2 / net_ir) ** 2, 1) if net_ir > 0 else None,
            "years_for_80pct_power": round(years_needed(net_ir, Z_A + Z_B), 1) if net_ir > 0 else None,
            "heldout_10_7yr_power": round(power_one_sided(net_ir * math.sqrt(10.67)), 3),
            "forward_1yr_power": round(power_one_sided(net_ir * 1.0), 3)}
OUT["C3_SECTOR_MOMENTUM"] = {"by_screen_period": sec, "independent_bets_per_year": 12}

# ------------------------------------------------------------ C4 PEAD on announcement reaction (assumptions, labelled)
# ~500 S&P 500 firms x 4 announcements = ~2,000 a year (structural); top quintile = ~400 a year.
# Per-event 60-trading-day abnormal return sd: 25 % a year idiosyncratic vol (ASSUMPTION for large caps)
# x sqrt(60/252) = 12.2 %. Clustering: events bunch in four seasons; effective n taken as n/2 and n/4.
sd_ev = 0.25 * math.sqrt(60 / 252)
cost_ev = FX_RT + SPREAD_RT_US_LARGECAP
pead = {"events_per_year_top_quintile": 400, "event_sd_pct": round(100 * sd_ev, 2),
        "cost_per_event_pct": round(100 * cost_ev, 2)}
for yrs in (1, 3, 10):
    for eff_div in (1, 2, 4):
        n = 400 * yrs / eff_div
        mde = (Z_A + Z_B) * sd_ev / math.sqrt(n)
        pead[f"mde_gross_pct_{yrs}yr_neff_div{eff_div}"] = round(100 * mde, 3)
pead["note"] = ("the bar is drift above cost: a test sees only gross drift larger than cost + MDE; "
                "Martineau (2022) reports no PEAD in large stocks since 2006")
OUT["C4_PEAD_EAR"] = pead

# ------------------------------------------------------------ C5 large-cap reversal (stat-arb leg), long-only
sr = S["strev_big_caps_monthly"]
OUT["C5_REVERSAL"] = {
    per: {"long_only_gross_ann_pct": v["long_only_BigLo_minus_Big_avg"]["mean_ann_pct"],
          "long_only_gross_ir": v["long_only_BigLo_minus_Big_avg"]["sharpe_or_ir"]} for per, v in sr.items()}
OUT["C5_REVERSAL"]["cost_weekly_full_turnover_fx_ann_pct"] = round(100 * 52 * (FX_RT + SPREAD_RT_US_LARGECAP), 1)
OUT["C5_REVERSAL"]["cost_monthly_full_turnover_fx_ann_pct"] = round(100 * 12 * (FX_RT + SPREAD_RT_US_LARGECAP), 1)

# ------------------------------------------------------------ rejected on arithmetic
OUT["rejected"] = {
    "overnight_drift_daily_round_trip_fx_ann_pct": round(100 * 252 * (FX_RT + SPREAD_RT_US_LARGECAP), 1),
    "overnight_drift_daily_round_trip_no_fx_ann_pct": round(100 * 252 * SPREAD_RT_US_LARGECAP, 1),
    "pre_fomc_events_per_year": 8,
    "earnings_premium_weekly_rotation_fx_ann_pct": round(100 * 52 * (FX_RT + SPREAD_RT_US_LARGECAP), 1),
}
OUT["assumptions"] = {"FX_round_trip": FX_RT, "spread_rt_core_gbp_etf": SPREAD_RT_CORE_GBP_ETF,
                      "spread_rt_sector_etf": SPREAD_RT_SECTOR_ETF, "spread_rt_us_largecap": SPREAD_RT_US_LARGECAP,
                      "spreads": "UNVERIFIED estimates; the paper test's first job is to measure them"}
json.dump(OUT, open(os.path.join(HERE, "..", "results", "power.json"), "w"), indent=1)
print(json.dumps(OUT, indent=1))
