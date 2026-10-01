"""DAT study: one named public episode inside the screen, described (not tested), and MSTR's beta and volatility
against BTC over the screen (close to close at the US close, daily and 20-day non-overlapping). Kerrisdale Capital published
"Long BTC / Short MicroStrategy" on 2024-03-28 (CoinDesk, Bloomberg, 2024-03-28), the textbook premium trade. From the
screen's own series: the pair's outcome from the open of 2024-03-28 to the premium's peak close (2024-11-20) and to
2024-12-31, and the mNAV at each point (simple and EV). Reads ../results/mnav_screen.csv; writes
../results/episodes.json. Run: python3 docs/agents/backtests/dat/scripts/episodes.py
"""
import csv, math, os
import numpy as np
from common import RES, design_sha, r6, write_json


def main():
    R = {r["date"]: r for r in csv.DictReader(open(os.path.join(RES, "mnav_screen.csv")))}
    a, ends = "2024-03-28", ("2024-11-20", "2024-12-31")
    o = R[a]
    out = {"design_sha256": design_sha(), "entry": a, "entry_mstr_open": r6(float(o["mstr_open"])),
           "entry_btc_0930et": r6(float(o["btc_0930et"])), "mnav_simple_prev_close": None, "legs": {}}
    dates = sorted(R)
    prev = dates[dates.index(a) - 1]
    out["mnav_simple_prev_close"] = r6(float(R[prev]["mnav_simple"]))
    out["mnav_ev_prev_close"] = r6(float(R[prev]["mnav_ev"]))
    for e in ends:
        z = R[e]
        m = math.log(float(z["mstr_close"]) / float(o["mstr_open"]))
        b = math.log(float(z["btc_close_et"]) / float(o["btc_0930et"]))
        out["legs"][e] = {"mstr_log": r6(m), "btc_log": r6(b), "pair_long_btc_short_mstr_log": r6(b - m),
                          "pair_simple_per_unit_notional": r6((math.exp(b) - 1) - (math.exp(m) - 1)),
                          "mnav_simple": r6(float(z["mnav_simple"])), "mnav_ev": r6(float(z["mnav_ev"]))}
    P = np.array([float(R[d]["mstr_close"]) for d in dates]); B = np.array([float(R[d]["btc_close_et"]) for d in dates])
    rm, rb = np.diff(np.log(P)), np.diff(np.log(B))
    m20, b20 = np.log(P[20::20] / P[:-20:20]), np.log(B[20::20] / B[:-20:20])
    out["screen_beta_vol"] = {"daily_beta": r6(np.cov(rm, rb)[0, 1] / np.var(rb, ddof=1)), "daily_corr": r6(np.corrcoef(rm, rb)[0, 1]),
                              "beta_20d": r6(np.cov(m20, b20)[0, 1] / np.var(b20, ddof=1)),
                              "vol_mstr_ann": r6(rm.std(ddof=1) * math.sqrt(252)), "vol_btc_ann": r6(rb.std(ddof=1) * math.sqrt(252)),
                              "vol_relative_ann": r6((rm - rb).std(ddof=1) * math.sqrt(252))}
    write_json("episodes.json", out)
    print(out)


if __name__ == "__main__":
    main()
