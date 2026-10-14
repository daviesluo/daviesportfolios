"""Can public volatility gates rescue index short-vol or short front VX?

The straddle leg keeps the earlier 0.8 x Cboe-index pricing convention and
adds gates measurable at the sale date. The VX leg keeps the earlier front-
contract roll and tests only term-structure entries decided at cycle start.
These are mechanism falsifiers, not IG option-quote backtests.
"""
import bisect
import datetime as dt
import json
import math
import os
import statistics as st
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKTESTS = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(BACKTESTS, "ig_research", "scripts"))
from common import INP, LEVEL, cboe, daily, read_csv_gz, summ  # noqa: E402

CLOSES = {d: v[1] for d, v in daily("^GSPC").items() if d >= "1989-01-01"}
DAYS = sorted(CLOSES)
INDEX = {d: i for i, d in enumerate(DAYS)}
RETURNS = {d: math.log(CLOSES[d] / CLOSES[DAYS[INDEX[d] - 1]]) for d in DAYS[1:]}


def trailing_rv(day, window=21):
    i = INDEX[day]
    if i < window:
        return None
    return 100 * st.pstdev([RETURNS[DAYS[j]] for j in range(i - window + 1, i + 1)]) * math.sqrt(252)


def norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def option_fraction(kind, strike_ratio, years, sigma):
    vol = sigma * math.sqrt(years)
    d1 = (-math.log(strike_ratio) + 0.5 * vol * vol) / vol
    d2 = d1 - vol
    if kind == "call":
        return norm_cdf(d1) - strike_ratio * norm_cdf(d2)
    return strike_ratio * norm_cdf(-d2) - norm_cdf(-d1)


def iron_butterfly(move, gross_premium, sigma, years):
    width = 2 * gross_premium
    wing = 0.0
    if width < 1:
        wing = option_fraction("call", 1 + width, years, sigma) + option_fraction("put", 1 - width, years, sigma)
    net = gross_premium - wing
    return net - min(abs(move), width)


def straddles():
    configs = (("daily", cboe("VIX1D"), "day", 1.0), ("weekly", cboe("VIX9D"), "week", 2.0))
    vix = cboe("VIX")
    results = {}
    for name, index_values, step, two_leg_cost_points in configs:
        pairs = []
        if step == "day":
            pairs = [(a, b) for a, b in zip(DAYS, DAYS[1:]) if a in index_values and trailing_rv(a)]
        else:
            fridays = [d for d in DAYS if dt.date.fromisoformat(d).weekday() == 4 and d in index_values and trailing_rv(d)]
            pairs = [(a, b) for a, b in zip(fridays, fridays[1:]) if (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days == 7]
        gates = {
            "all": lambda gap, iv, ratio: True,
            "iv_minus_rv_ge_3": lambda gap, iv, ratio: gap >= 3,
            "iv_minus_rv_ge_5": lambda gap, iv, ratio: gap >= 5,
            "iv_minus_rv_ge_3_and_iv_le_30": lambda gap, iv, ratio: gap >= 3 and iv <= 30,
        }
        if step == "week":
            gates["iv_minus_rv_ge_3_and_term_ratio_le_1"] = lambda gap, iv, ratio: gap >= 3 and ratio is not None and ratio <= 1
        years = (dt.date.fromisoformat(pairs[-1][1]) - dt.date.fromisoformat(pairs[0][0])).days / 365.25
        book = {"candidate_pairs": len(pairs), "years": round(years, 2)}
        for gate_name, gate in gates.items():
            for structure in ("naked", "iron_butterfly"):
                values = []
                for start, end in pairs:
                    iv = index_values[start]
                    gap = iv - trailing_rv(start)
                    ratio = iv / vix[start] if start in vix and vix[start] else None
                    if not gate(gap, iv, ratio):
                        continue
                    horizon = (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days / 365
                    sigma = 0.8 * iv / 100
                    premium = math.sqrt(2 / math.pi) * sigma * math.sqrt(horizon)
                    move = math.log(CLOSES[end] / CLOSES[start])
                    if structure == "naked":
                        value = premium - abs(move) - two_leg_cost_points / LEVEL["US500"]
                    else:
                        value = iron_butterfly(move, premium, sigma, horizon) - 2 * two_leg_cost_points / LEVEL["US500"]
                    values.append(value)
                if values:
                    book[f"{gate_name}_{structure}"] = {
                        **summ(values, len(values) / years),
                        "worst_bps": round(1e4 * min(values), 1),
                    }
        results[name] = book
        print(name, "pairs", len(pairs), "all naked", book["all_naked"])
    return results


def front_vx():
    rows = read_csv_gz(os.path.join(INP, "cboe", "VX_monthly.csv.gz"))
    by_day = {}
    for row in rows:
        by_day.setdefault(row["trade_date"], {})[row["expiry"]] = (float(row["settle"]), float(row["high"] or 0))
    days = sorted(by_day)
    expiries = sorted({row["expiry"] for row in rows})
    spot = cboe("VIX")

    def front_pair(day):
        candidates = []
        for expiry in expiries:
            trading_days_left = bisect.bisect_right(days, expiry) - bisect.bisect_right(days, day)
            if expiry > day and trading_days_left > 5 and expiry in by_day[day]:
                candidates.append(expiry)
        if len(candidates) > 1:
            return candidates[0], candidates[1]
        return (candidates[0] if candidates else None), None

    gates = {
        "always": lambda front_ratio, second_ratio, vix: True,
        "front_over_spot_ge_1": lambda front_ratio, second_ratio, vix: front_ratio >= 1,
        "front_over_spot_ge_1_05": lambda front_ratio, second_ratio, vix: front_ratio >= 1.05,
        "second_over_front_ge_1_03": lambda front_ratio, second_ratio, vix: second_ratio is not None and second_ratio >= 1.03,
        "front_over_spot_ge_1_05_and_vix_le_30": lambda front_ratio, second_ratio, vix: front_ratio >= 1.05 and vix <= 30,
    }
    results = {}
    for gate_name, gate in gates.items():
        for stop in (0.30, 0.50):
            daily_values = {}
            current = entry = None
            active = stopped = False
            cycles = stops = 0
            for i in range(1, len(days)):
                d0, d1 = days[i - 1], days[i]
                expiry, second_expiry = front_pair(d0)
                if expiry is None or expiry not in by_day[d1]:
                    daily_values[d1] = 0.0
                    continue
                if expiry != current:
                    current = expiry
                    entry = by_day[d0][expiry][0]
                    second = by_day[d0][second_expiry][0] if second_expiry in by_day[d0] else None
                    vix = spot.get(d0)
                    active = bool(vix and gate(entry / vix, second / entry if second else None, vix))
                    stopped = False
                    if active:
                        cycles += 1
                        daily_values[d0] = daily_values.get(d0, 0.0) - 0.1 / entry
                if not active or stopped:
                    daily_values[d1] = daily_values.get(d1, 0.0)
                    continue
                previous, (settle, high) = by_day[d0][expiry][0], by_day[d1][expiry]
                stop_price = entry * (1 + stop)
                if (high > 0 and high >= stop_price) or (high == 0 and settle >= stop_price):
                    # Daily bars have no open: fill at the stop, or settle if the high is absent.
                    exit_price = stop_price if high > 0 else settle
                    daily_values[d1] = (-(exit_price - previous) - 0.2) / entry
                    stopped = True
                    stops += 1
                else:
                    daily_values[d1] = -(settle - previous) / entry
            ordered = sorted(daily_values.items())
            values = [value for _, value in ordered]
            years = (dt.date.fromisoformat(ordered[-1][0]) - dt.date.fromisoformat(ordered[0][0])).days / 365.25
            results[f"{gate_name}_stop_{int(stop * 100)}"] = {
                **summ(values, len(values) / years), "cycles": cycles, "stops": stops,
                "worst_day_bps": round(1e4 * min(values), 1),
            }
            print("VX", gate_name, stop, results[f"{gate_name}_stop_{int(stop * 100)}"])
    return results


def main():
    results = {"straddles": straddles(), "front_vx": front_vx()}
    out = os.path.join(HERE, "results", "vol_gated.json")
    json.dump(results, open(out, "w"), indent=1)
    print("wrote", out)


if __name__ == "__main__":
    main()
