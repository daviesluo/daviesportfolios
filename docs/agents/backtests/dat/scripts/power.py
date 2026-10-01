"""DAT study, step 4: power of the tests a proposal would rest on (design.md §6), from the screen's own parameters.
No held-out data is read.

H1 (log mNAV → MSTR minus BTC over h days, non-overlapping OLS, one-sided 5 %): Monte Carlo of the Stambaugh model
  x_{k+1} = rho x_k + v,  r_{k+1} = beta x_k + u,  (u, v) normal with the screen's sigma_u, sigma_v and corr(u, v),
  rho the screen's Kendall-corrected value. The critical value is the 5 % quantile of beta-hat under beta = 0 (20,000
  draws), so the test is the null bootstrap's parametric twin and carries the bias with it; power = share of draws at
  the alternative (10,000) below it. Effects: the screen's bias-corrected beta, LARGE (one screen-SD of x moves the
  60-day relative return by 10 %, scaled by h/60) and MODERATE (5 %).
H2 (the switch's timing skill): normal approximation from the screen's Newey-West SE, scaled by sqrt(days).
Samples: the held-out years (2025-01-02 → 2026-09-30, 438 NYSE trading days, counted from the weekday calendar less
the exchange's holidays: approximate to a day) and a forward test of 1-10 years from 2026-10-01.
Reads ../results/screen.json; writes ../results/power.json. Run: python3 docs/agents/backtests/dat/scripts/power.py
"""
import datetime as dt, json, math, os
import numpy as np
from common import RES, design_sha, r6, sha256, write_json

SEED = 20261001
HOLIDAYS = {"2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19",
            "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25", "2026-01-01", "2026-01-19", "2026-02-16",
            "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07"}


def heldout_days():
    d, n = dt.date(2025, 1, 2), 0
    while d <= dt.date(2026, 9, 30):
        if d.weekday() < 5 and d.isoformat() not in HOLIDAYS:
            n += 1
        d += dt.timedelta(days=1)
    return n


def sim_beta(rng, n, rho, su, sv, corr, beta, sims):
    """beta-hat of r_{k+1} on x_k over n periods, x stationary AR(1) started from its stationary law."""
    L = np.linalg.cholesky(np.array([[su * su, corr * su * sv], [corr * su * sv, sv * sv]]))
    z = rng.standard_normal((sims, n, 2)) @ L.T
    u, v = z[..., 0], z[..., 1]
    x = np.empty((sims, n + 1))
    x[:, 0] = rng.standard_normal(sims) * sv / math.sqrt(1 - rho * rho)
    for k in range(n):
        x[:, k + 1] = rho * x[:, k] + v[:, k]
    xk = x[:, :n]
    r = beta * xk + u
    xm = xk - xk.mean(1, keepdims=True)
    rm = r - r.mean(1, keepdims=True)
    return (xm * rm).sum(1) / (xm * xm).sum(1)


def power_h1(rng, n, rho, su, sv, corr, beta_alt):
    null = sim_beta(rng, n, rho, su, sv, corr, 0.0, 20000)
    crit = np.quantile(null, 0.05)
    alt = sim_beta(rng, n, rho, su, sv, corr, beta_alt, 10000)
    return float((alt <= crit).mean()), float(crit), float(null.mean())


def main():
    S = json.load(open(os.path.join(RES, "screen.json")))
    rng = np.random.default_rng(SEED)
    ho = heldout_days()
    out = {"design_sha256": design_sha(), "screen_json_sha256": sha256(os.path.join(RES, "screen.json")),
           "heldout_trading_days": ho, "H1": {}, "H2": {}}
    for key in ("x", "xev"):
        out["H1"][key] = []
        for r in S["H1"][key]:
            h = r["h"]
            rho, su, sv = r["rho_kendall"], r["u_sd"], r["v_sd"]
            corr = r["corr_uv"]
            sdx = r["sd_x"]
            effects = {"screen_bias_corrected": r["beta_bias_corrected"],
                       "large_10pct_per_sd_per_60d": -0.10 / sdx * h / 60,
                       "moderate_5pct_per_sd_per_60d": -0.05 / sdx * h / 60}
            row = {"h": h, "rho": rho, "sigma_u": su, "sigma_v": sv, "corr_uv": corr, "samples": {}}
            samples = {"heldout": ho // h}
            samples.update({f"forward_{y}y": (252 * y) // h for y in (1, 2, 3, 5, 10, 20)})
            for sname, n in samples.items():
                row["samples"][sname] = {"n": n}
                if n < 4:
                    row["samples"][sname]["note"] = "too few observations to regress"
                    continue
                for ename, b in effects.items():
                    p, crit, nullmean = power_h1(rng, n, rho, su, sv, corr, b)
                    row["samples"][sname][ename] = {"beta": r6(b), "power": r6(p)}
                row["samples"][sname]["crit_beta_5pct"] = r6(crit)
                row["samples"][sname]["null_mean_beta_bias"] = r6(nullmean)
            out["H1"][key].append(row)
    # H2 timing skill
    for name, d in S["H2"].items():
        r = d["cost_30bps"]
        se = abs(r["timing_skill_bps_day"] / r["timing_skill_nw_t"]) if r["timing_skill_nw_t"] else None
        days = r["days"]
        wbar = r["mean_w"]
        res = {"screen_se_bps_day": r6(se), "screen_days": days, "mean_w": wbar}
        for ex in (0.10, 0.20, 0.40):
            delta = 1e4 * ex / (252 * wbar * (1 - wbar))
            for sname, n in (("heldout", ho), ("forward_3y", 756), ("forward_10y", 2520)):
                se_n = se * math.sqrt(days / n)
                pw = 0.5 * math.erfc((1.6448536 - delta / se_n) / math.sqrt(2))
                res[f"edge_{int(ex * 100)}pct_{sname}"] = {"timing_bps_day": r6(delta), "se": r6(se_n), "power": r6(pw)}
            # n days for SE_n = delta / (1.645 + 0.842): n = days * (se * 2.4865 / delta)^2
            res[f"edge_{int(ex * 100)}pct_years_for_power_0.8"] = r6((se * 2.4865 / delta) ** 2 * days / 252)
        out["H2"][name] = res
    write_json("power.json", out)
    for key in ("x", "xev"):
        for row in out["H1"][key]:
            for sname in ("heldout", "forward_3y", "forward_5y", "forward_10y", "forward_20y"):
                s = row["samples"][sname]
                if "large_10pct_per_sd_per_60d" in s:
                    print(f"H1 {key} h={row['h']} {sname} n={s['n']}: power large {s['large_10pct_per_sd_per_60d']['power']:.2f}"
                          f" moderate {s['moderate_5pct_per_sd_per_60d']['power']:.2f} screen {s['screen_bias_corrected']['power']:.2f}")
    for name, r in out["H2"].items():
        print(f"H2 {name}: SE {r['screen_se_bps_day']:.1f} bp/day over {r['screen_days']} days;",
              {k: (v["power"] if isinstance(v, dict) else v) for k, v in r.items() if k.startswith("edge")})
    print("held-out trading days:", ho)


if __name__ == "__main__":
    main()
