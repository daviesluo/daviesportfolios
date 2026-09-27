"""HARVEST phase 1: the power check (fp5's rule: expected fills and the smallest edge a held-out test could see) for
the candidate rules the measurement suggests, on the exploration months only. Nothing here reads a held-out price.

Candidate rules, per category (every fill from prints that happened, at their own price, the market's own fee):
* CLEAN-A   — from C + 60 s, half of each Mode A print whose W price is in [0.95, 0.999], $100 a market, held to the
              result (the confirmed side taken where the market already agrees with the source).
* CONTEST-A — the same for Mode A prints below 0.95 (the market still disagrees with the source a minute after C).
* PATIENT-B — a resting bid on W at 0.99 from C + 60 s, $100 a market, filled only by prints strictly through it.
* TICK-B    — the Mode B ceiling: a maker one tick above every late print, whole prints, $100 a market.
* FAST-A    — economic releases only: from C + 3 s (the data API's stamp; a match ~1 s after C), half of each Mode A
              print with W below 0.999, $100 a market.

For each: the exploration total, fills, markets, dates with a fill, the best date's share, traps, the peak capital,
and two nulls. The calibration null pays each fill's token 1 with probability equal to its price (its mean is minus
the fees; the p95 is by normal approximation over the fills). The date bootstrap draws the dates with a fill with
replacement. The projection to the held-out months scales dates and fills by the held-out/exploration ratio of events
in the category (split.json; temperature has no held-out set) and asks whether the expected total clears the null's
p95 and the date bootstrap's p5 at that size (z = 1.645 one-sided each, fp5's "power check first").

usage: power.py <split json> <out json> <category input json.gz> [...]
"""
import math
import os
import random
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hcommon as H  # noqa: E402
from harvest import classify, conc, peak, r2, tick_at  # noqa: E402

CAP = 100.0
SEED = 20260927


def rules(cat):
    rs = {
        "CLEAN-A": {"mode": "A", "d": 60, "lo": 0.95, "hi": 0.999, "half": True, "level": None},
        "CONTEST-A": {"mode": "A", "d": 60, "lo": 0.0, "hi": 0.95, "half": True, "level": None},
        "PATIENT-B": {"mode": "B", "d": 60, "lo": 0.0, "hi": 1.0, "half": False, "level": 0.99},
        "TICK-B": {"mode": "B", "d": 60, "lo": 0.0, "hi": 1.0, "half": False, "level": "tick"},
    }
    if cat == "econ":
        rs["FAST-A"] = {"mode": "A", "d": 3, "lo": 0.0, "hi": 0.999, "half": True, "level": None}
    return rs


def run(inp, rule):
    fills, by_date, iv = [], defaultdict(float), []
    traps = 0.0
    for u in sorted(inp["units"], key=lambda x: (x["C"], x["cond"])):
        if u.get("record_ok") is False or (u["closed"] or 0) <= u["C"]:
            continue
        trap = u["r"] is not None and u["w"] != u["r"]
        fs = {"fees": u["fees"], "fee_rate": u["fee_rate"], "fee_exp": u["fee_exp"], "rebate": u["rebate"]}
        cost = 0.0
        for r in inp["prints"].get(u["cond"], []):
            if r[0] < u["C"] + rule["d"]:
                continue
            k = classify(u, r)
            if not k or k[0] != rule["mode"]:
                continue
            px, s = k[1], k[2]
            if rule["mode"] == "A":
                if not (rule["lo"] <= px < rule["hi"]):
                    continue
                price, sh, fee = px, s / 2.0 if rule["half"] else s, H.fee_per_share(fs, px)
            elif rule["level"] == "tick":
                price = px + tick_at(px)
                if price >= 1.0:
                    continue
                sh, fee = s, 0.0
            else:
                if px >= rule["level"] - 1e-9:
                    continue
                price, sh, fee = rule["level"], s, 0.0
            if cost + sh * price > CAP:
                sh = (CAP - cost) / price
            if sh <= 0:
                break
            pnl = sh * ((1.0 - price - fee) if not trap else -(price + fee))
            fills.append((price, sh, fee, pnl))
            traps += pnl if trap else 0.0
            by_date[H.day(u["C"])] += pnl
            iv.append((r[0], max(u["closed"], r[0]), sh * price))
            cost += sh * price
            if cost >= CAP - 1e-9:
                break
    total = sum(f[3] for f in fills)
    mu0 = -sum(f[1] * f[2] for f in fills)
    sd0 = math.sqrt(sum((f[1] ** 2) * f[0] * (1.0 - f[0]) for f in fills))
    vals = [by_date[k] for k in sorted(by_date)]
    rng = random.Random(SEED)
    boots = sorted(sum(rng.choice(vals) for _ in vals) for _ in range(2000)) if vals else []
    mean_d = sum(vals) / len(vals) if vals else 0.0
    sd_d = math.sqrt(sum((v - mean_d) ** 2 for v in vals) / (len(vals) - 1)) if len(vals) > 1 else 0.0
    return {"total": r2(total), "fills": len(fills), "dates": len(vals), "trap_pnl": r2(traps),
            "peak_capital": r2(peak(iv)), "concentration": conc(by_date),
            "null_mean": r2(mu0), "null_sd": r2(sd0), "null_p95": r2(mu0 + 1.645 * sd0),
            "z_vs_null": round((total - mu0) / sd0, 2) if sd0 > 0 else None,
            "date_mean": r2(mean_d), "date_sd": r2(sd_d),
            "bootstrap_p5": r2(boots[int(0.05 * len(boots))]) if boots else None}


def main():
    split = H.jfile(sys.argv[1])
    out = {"rules": {}, "note": "exploration only; held-out projections scale by the category's held-out/exploration "
                                "event ratio"}
    for f in sys.argv[3:]:
        inp = H.jfile(f)
        cat = inp["category"]
        c = split["categories"].get(cat, {}).get("counts", {})
        scale = (c.get("held_out", 0) / c["exploration"]) if c.get("exploration") else 0.0
        res = {}
        for name, rule in rules(cat).items():
            x = run(inp, rule)
            n_h = x["dates"] * scale
            proj_total = x["total"] * scale
            proj_null = x["null_mean"] * scale + 1.645 * x["null_sd"] * math.sqrt(scale)
            proj_boot_p5 = x["date_mean"] * n_h - 1.645 * x["date_sd"] * math.sqrt(n_h) if n_h > 0 else None
            x["heldout"] = {"scale": round(scale, 3), "expected_dates": round(n_h, 1),
                            "expected_total": r2(proj_total), "expected_null_p95": r2(proj_null),
                            "expected_bootstrap_p5": r2(proj_boot_p5) if proj_boot_p5 is not None else None,
                            "min_detectable_per_date": r2(1.645 * x["date_sd"] / math.sqrt(n_h)) if n_h > 0 else None,
                            "enough_dates_fp5": n_h >= 25}
            res[name] = x
        out["rules"][cat] = res
        for name, x in res.items():
            print(cat, name, "total", x["total"], "fills", x["fills"], "dates", x["dates"], "best",
                  x["concentration"]["best_share"], "z", x["z_vs_null"], "boot p5", x["bootstrap_p5"],
                  "| held-out dates", x["heldout"]["expected_dates"], "exp total", x["heldout"]["expected_total"],
                  "null p95", x["heldout"]["expected_null_p95"], "boot p5", x["heldout"]["expected_bootstrap_p5"])
    H.write_json(sys.argv[2], out)


if __name__ == "__main__":
    main()
