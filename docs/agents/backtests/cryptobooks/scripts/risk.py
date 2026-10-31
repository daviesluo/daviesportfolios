# CRYPTOBOOKS (2026-10-31): the price risk of carrying each coin, from Binance's one-second closes (binance_1s.py),
# 2026-10-17 -> 10-31: the standard deviation of log returns over 1 s, 1 min, 1 h and 1 day (non-overlapping), the worst
# 1-minute, 1-hour and 1-day move, and what a carried inventory of 300 and 600 pounds lost in its worst hour and day.
# A stop's cost on Revolut X: the 9 bps taker fee plus what a taker selling paid against the fair there (tape.py's
# dev_sell_p50, about 1-3 bps on the books with a tape), so ~10-12 bps of the inventory, before any gap through it.
# Writes results/risk.json. Pure Python, no network.
#   CRYPTOBOOKS_BN=<binance_1s.py's output> python3 -I risk.py
import json, math, os, statistics, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT, Fair  # noqa: E402


def main():
    fair = Fair()
    out = {}
    for coin, a in fair.bn.items():
        n = len(a)
        res = {}
        for name, step in (("1s", 1), ("1m", 60), ("1h", 3600), ("1d", 86400)):
            r = [1e4 * math.log(a[i + step] / a[i]) for i in range(0, n - step, step)]
            res[name] = {"sd_bps": round(statistics.pstdev(r), 2), "worst_bps": round(min(r), 1), "best_bps": round(max(r), 1), "n": len(r)}
        # worst rolling hour (minute steps) and the worst rolling day (hour steps)
        wh = min(1e4 * math.log(a[i + 3600] / a[i]) for i in range(0, n - 3600, 60))
        wd = min(1e4 * math.log(a[i + 86400] / a[i]) for i in range(0, n - 86400, 3600))
        res["worst_rolling_hour_bps"] = round(wh, 1)
        res["worst_rolling_day_bps"] = round(wd, 1)
        res["loss_gbp_worst_hour"] = {c: round(c * (1 - math.exp(wh / 1e4)), 2) for c in (300, 600)}
        res["loss_gbp_worst_day"] = {c: round(c * (1 - math.exp(wd / 1e4)), 2) for c in (300, 600)}
        res["daily_sd_gbp"] = {c: round(c * res["1d"]["sd_bps"] / 1e4, 2) for c in (300, 600)}
        out[coin] = res
        print(coin, res["1m"]["sd_bps"], res["1h"]["sd_bps"], res["1d"]["sd_bps"], res["worst_rolling_hour_bps"], res["worst_rolling_day_bps"], flush=True)
    with open(os.path.join(ROOT, "results", "risk.json"), "w") as f:
        json.dump(json.loads(json.dumps(out)), f, indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
