# CRYPTOBOOKS-3 (2026-10-31): the card the paper test freezes (FINAL), read as final_opt.py reads a change, plus:
#   - the paired question for each near-tie final_opt.py left (a change against the card, window by window on the year and
#     day by day on the 15 days): P(the change's mean gain <= 0) by the same block bootstraps; a change is taken only below 0.10;
#   - REST_LAG 1, the paper's fill timing, and the d x theta plateau again under it (a quote is filled only from the second after it was placed);
#   - the card at £120, £600 and £1,200 (a third of the capital a quote), the year's windows scaled to a day by 10.6
#     (hist_replay.py's ratio), the expectation the reading is set against;
#   - the bar's power, roughly: 28 days, each the sum of 10 windows drawn from the year's (the card's own, at £600), read as the
#     pre-registration reads them (sum > 0 and the 3-day block bootstrap's P(mean <= 0) < 0.10; 2,000 resamples here, 500 draws).
# Writes results/final_card.json. Pure Python, no network.
#   CRYPTOBOOKS_BN=<binance_1s.py's output> CRYPTOBOOKS_HF=<hist_fair.py's output> python3 -I final_card.py
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import replay  # noqa: E402
from common import ROOT, Fair  # noqa: E402
from best import regimes  # noqa: E402
from final_opt import TAG, short, windows, year, yr_summ  # noqa: E402
from rule import boot, sim  # noqa: E402
from xrp_study import CARD, summ  # noqa: E402

# The card the paper runs: xrp_study.CARD with the 300 bps stop (an hour's cool-down) and the paper's fill timing.
FINAL = {"stop": 300.0, "cooldown": 3600, "rest_lag": 1}
SCALE = 10.6  # a day / a 13:30-16:00 window (hist_replay.py, 14 October days)


def main():
    fair = Fair()
    bk = replay.Book("XRP-GBP", fair, tag=TAG)
    reg = regimes(bk)
    wx = windows("XRP-GBP")
    out = {"card": CARD | FINAL, "tag": TAG}
    base15 = sim(bk, fair, **(CARD | FINAL))
    basey = year(wx, FINAL)
    out["final"] = {"days15": short(summ(base15, reg)), "days": base15["days"], "year": yr_summ(basey)}
    print("final", out["final"]["days15"], out["final"]["year"], flush=True)
    # without the paper's fill timing (the CRYPTOBOOKS-2 card as scored then, with the stop)
    r0 = sim(bk, fair, **(CARD | FINAL | {"rest_lag": 0}))
    out["rest_lag0"] = {"days15": short(summ(r0, reg)), "year": yr_summ(year(wx, FINAL | {"rest_lag": 0}))}
    print("rest_lag0", out["rest_lag0"], flush=True)
    # the near-ties, paired against FINAL
    pairs = {"kappa0.25": {"kappa": 0.25}, "kappa0.375": {"kappa": 0.375}, "Q250": {"Q": 250.0}, "Q300": {"Q": 300.0},
             "target0.25": {"target": 0.25}, "theta6": {"theta": 6.0}, "d13": {"d_min": 13.0}, "d15": {"d_min": 15.0},
             # the plateau again under the paper's fill timing: a quote that rests longer may now be worth more
             "theta8": {"theta": 8.0}, "theta10": {"theta": 10.0}, "d12": {"d_min": 12.0}, "d16": {"d_min": 16.0},
             "d12_theta8": {"d_min": 12.0, "theta": 8.0}, "d16_theta8": {"d_min": 16.0, "theta": 8.0}, "d12_theta10": {"d_min": 12.0, "theta": 10.0}}
    res = {}
    for name, kw in pairs.items():
        r = sim(bk, fair, **(CARD | FINAL | kw))
        y = year(wx, FINAL | kw)
        dd = [r["days"][k] - base15["days"].get(k, 0.0) for k in r["days"]]
        dy = [a - b for a, b in zip(y, basey)]
        res[name] = {"kw": kw, "days15": short(summ(r, reg)), "year": yr_summ(y),
                     "gain_a_day_15": round(sum(dd) / len(dd), 3), "p_gain_15": boot(dd, 3),
                     "gain_a_window": round(sum(dy) / len(dy), 4), "p_gain_year": boot(dy, 5)}
        print(name, res[name]["days15"]["a_day"], res[name]["year"]["mean"], "| gain", res[name]["gain_a_day_15"], res[name]["p_gain_15"],
              res[name]["gain_a_window"], res[name]["p_gain_year"], flush=True)
    out["paired"] = res
    # the capital: a third of it a quote
    cap = {}
    for c in (120.0, 600.0, 1200.0):
        kw = FINAL | {"cap": c, "Q": c / 3}
        r = sim(bk, fair, **(CARD | kw))
        y = yr_summ(year(wx, kw))
        cap[str(int(c))] = {"days15_a_day": r["a_day"], "p_days15": boot(list(r["days"].values()), 3), "year": y,
                            "expected_a_day": round(SCALE * y["mean"], 2)}
        print("cap", c, cap[str(int(c))], flush=True)
    out["capital"] = cap
    import random
    rnd = random.Random(20261031)
    hits = 0
    for _ in range(500):
        days = [sum(rnd.choice(basey) for _ in range(10)) for _ in range(28)]
        pb = boot(days, 3, n=2000, seed=rnd.randrange(10 ** 9))
        hits += sum(days) > 0 and pb is not None and pb < 0.10
    out["power_28d"] = round(hits / 500, 3)
    print("power", out["power_28d"], flush=True)
    with open(os.path.join(ROOT, "results", "final_card.json"), "w") as f:
        json.dump(json.loads(json.dumps(out)), f, indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
