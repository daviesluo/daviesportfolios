"""FXW execution-delay and adverse-excursion geometry at assumed IG spreads.

Rule and inputs are unchanged from STATARB-2/IG-FXW: fade a Sunday-open FXCM
mid gap of at least 20 bps back to Friday's mid within 24 hours. This script
does not retune that threshold. It adds bootstrap bounds, era splits, delayed
entries and the 24-hour adverse path the committed weekend rows can support.
"""
import csv
import datetime as dt
import gzip
import io
import json
import math
import os
import random
import statistics as st
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKTESTS = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(BACKTESTS, "ig_research", "scripts"))
from common import summ  # noqa: E402

UTC = dt.timezone.utc


def load(pair):
    path = os.path.join(BACKTESTS, "statarb_search2", "inputs", "fx", f"fxcm_{pair}_weekends.csv.gz")
    out = []
    with gzip.open(path, "rt") as fh:
        for r in csv.DictReader(fh):
            fri, sun = int(r["fri_utc"]), int(r["sun_utc"])
            if dt.datetime.fromtimestamp(fri, UTC).weekday() != 4:
                continue
            if not 40 * 3600 <= sun - fri <= 60 * 3600:
                continue
            fmid = (float(r["fri_bid"]) + float(r["fri_ask"])) / 2
            smid = (float(r["sun_bid_open"]) + float(r["sun_ask_open"])) / 2
            out.append({
                "date": dt.datetime.fromtimestamp(sun, UTC).date().isoformat(),
                "g": math.log(smid / fmid), "fmid": fmid, "smid": smid,
                "m1": float(r["mid_1h"]), "m4": float(r["mid_4h"]), "m24": float(r["mid_24h"]),
                "fill": int(r["fill_min"]) if r["fill_min"] else None,
                "hi": float(r["hi_24h"]), "lo": float(r["lo_24h"]),
            })
    return out


def pnl(w, spread_bps, delay_min=0):
    """Fade P&L as a log return on notional; assumed IG spread plus 2 bps exit/funding."""
    direction = -1 if w["g"] > 0 else 1
    target = w["fmid"] if w["fill"] is not None and w["fill"] <= 1440 else w["m24"]
    if delay_min == 0:
        entry = w["smid"]
    elif delay_min == 60:
        if w["fill"] is not None and w["fill"] <= 60:
            return None
        entry = w["m1"]
    else:
        if w["fill"] is not None and w["fill"] <= 240:
            return None
        entry = w["m4"]
    entry *= 1 + direction * spread_bps / 2e4
    return direction * math.log(target / entry) - 2e-4


def boot95(values, seed=20261014, draws=10000):
    if len(values) < 2:
        return None
    rng = random.Random(seed)
    means = sorted(sum(rng.choice(values) for _ in values) / len(values) for _ in range(draws))
    return [round(1e4 * means[int(0.025 * draws)], 2), round(1e4 * means[int(0.975 * draws)], 2)]


def block(values, years):
    return {**summ(values, len(values) / years), "boot95_bps": boot95(values)}


def main():
    results = {}
    for pair in ("AUDUSD", "EURUSD", "GBPUSD", "USDJPY"):
        weekends = load(pair)
        years = (dt.date.fromisoformat(weekends[-1]["date"]) - dt.date.fromisoformat(weekends[0]["date"])).days / 365.25
        trades = [w for w in weekends if abs(w["g"]) >= 0.002]
        book = {"weekends": len(weekends), "trades": len(trades), "years": round(years, 2)}
        for spread in (12, 20, 30, 40):
            book[f"spread_{spread}"] = block([pnl(w, spread) for w in trades], years)
        if pair == "AUDUSD":
            for delay in (60, 240):
                for spread in (12, 20, 30):
                    vals = [v for w in trades if (v := pnl(w, spread, delay)) is not None]
                    book[f"delay_{delay}_spread_{spread}"] = block(vals, years)
            base = [pnl(w, 12) for w in trades]
            for lo, hi in ((2016, 2018), (2019, 2021), (2022, 2024), (2025, 2026)):
                vals = [v for w, v in zip(trades, base) if lo <= int(w["date"][:4]) <= hi]
                book[f"era_{lo}_{hi}"] = block(vals, hi - lo + 1)
            for lo, hi in ((20, 30), (30, 50), (50, 100), (100, 10**9)):
                vals = [v for w, v in zip(trades, base) if lo <= abs(w["g"]) * 1e4 < hi]
                book[f"gap_{lo}_{hi if hi < 1000 else 'plus'}"] = block(vals, years)
            for name, sign in (("short_up_gap", 1), ("long_down_gap", -1)):
                vals = [v for w, v in zip(trades, base) if (w["g"] > 0) == (sign > 0)]
                book[name] = block(vals, years)
            maes = []
            for w in trades:
                direction = -1 if w["g"] > 0 else 1
                maes.append((w["hi"] - w["smid"]) / w["smid"] if direction < 0 else (w["smid"] - w["lo"]) / w["smid"])
            maes.sort()
            fills = [w["fill"] for w in trades if w["fill"] is not None and w["fill"] <= 1440]
            book["risk_geometry_12bp"] = {
                "worst_trade_bps": round(1e4 * min(base), 1),
                "mae_bps_p50_p75_p90_p95_max": [round(1e4 * maes[min(len(maes) - 1, int(p * len(maes)))], 1) for p in (.5, .75, .9, .95, 1)],
                "target_share": round(len(fills) / len(trades), 3),
                "median_minutes_to_target": st.median(fills) if fills else None,
            }
        results[pair] = book
        print(pair, book["trades"], "trades; 12/20/30 bp annual bps:",
              [book[f"spread_{s}"]["annual_bps"] for s in (12, 20, 30)])
    out = os.path.join(HERE, "results", "fxw_risk.json")
    json.dump(results, open(out, "w"), indent=1)
    print("wrote", out)


if __name__ == "__main__":
    main()
