"""VOL: the frozen test of `reviews/2026-09-25-polymarket-fp5-prereg-vol-digital.md` (fp5).

Reads only the committed input and writes one JSON. The pre-registration is the rule;
this file is that rule and nothing past it.

usage: vol_test.py <inputs .json.gz> <out json>
       vol_test.py --self-check
"""
import gzip
import json
import math
import random
import sys
from collections import defaultdict
from datetime import datetime, timezone

STAKE = 10.0
MIN_FILL = 2.0
LIMIT = 0.99
T_IS = datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp()
T_OOS1 = datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp()
T_OOS2 = datetime(2026, 6, 1, tzinfo=timezone.utc).timestamp()
T_END = datetime(2026, 9, 11, tzinfo=timezone.utc).timestamp()
OOS_DAYS = (T_END - T_OOS1) / 86400.0
NULL_DRAWS = 10000
SEED = 20260925
# S = K = 100, sigma = 0.40, T = 16/24/365.25, zero drift. Hand value frozen in the pre-registration.
DIGITAL_PIN = 0.496591


def r6(x):
    return None if x is None else round(float(x), 6)


def ncdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def digital(spot, strike, sigma, years):
    """YES price of a zero-drift, undiscounted digital. None when the inputs are not a price."""
    if spot <= 0 or strike <= 0 or sigma <= 0 or years <= 0:
        return None
    vol = sigma * math.sqrt(years)
    d2 = (math.log(spot / strike) - 0.5 * sigma * sigma * years) / vol
    return ncdf(d2)


def fee(rate, price):
    return rate * price * (1.0 - price)


def edge(fair, price, rate):
    return fair - price - fee(rate, price)


def window_of(end):
    if T_IS <= end < T_OOS1:
        return "IS"
    if T_OOS1 <= end < T_OOS2:
        return "OOS1"
    if T_OOS2 <= end < T_END:
        return "OOS2"
    return None


def month(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m")


def choose_side(model, shown, tick, rate):
    """'YES', 'NO', or None. Both and neither are no trade, as the pre-registration says."""
    if model is None or shown is None or not (0.0 < shown < 1.0) or tick <= 0 or rate < 0:
        return None
    yes = edge(model, shown + tick, rate) > 0
    no = edge(1.0 - model, (1.0 - shown) + tick, rate) > 0
    if yes and not no:
        return "YES"
    if no and not yes:
        return "NO"
    return None


def walk_fills(prints, side, shown, tick, rate, fair):
    """Fills of `side` from prints [ts, side, oi, price, size]. Returns a list of (ts, px, qty) or None if under $2."""
    shown_tok = shown if side == "YES" else 1.0 - shown
    oi_tok = 0 if side == "YES" else 1
    remaining, fills = STAKE, []
    for ts, sd, oi, price, size in prints:
        if oi == oi_tok and sd == "BUY":
            ptok = price
        elif oi is not None and oi != oi_tok and sd == "SELL":
            ptok = 1.0 - price
        else:
            continue
        px = max(ptok, shown_tok + tick)
        if px > LIMIT + 1e-12:
            continue
        if edge(fair, px, rate) <= 0:
            continue
        qty = min(size, remaining / px)
        if qty <= 0:
            break
        fills.append((ts, px, qty))
        remaining -= qty * px
        if remaining <= 1e-9:
            break
    if STAKE - remaining < MIN_FILL:
        return None
    return fills


def trades_from(events, vol_key):
    """vol_key is 'sigma_dvol' or 'sigma_rv'. Returns (trades, counts)."""
    counts = defaultdict(int)
    out = []
    years = 16.0 / (24.0 * 365.25)
    for m in events:
        end = m["end"]
        if window_of(end) is None:
            counts["outside_window"] += 1
            continue
        counts["in_window"] += 1
        sigma = m.get(vol_key)
        model = digital(m["spot"], m["strike"], sigma, years) if sigma else None
        if model is None:
            counts["no_model"] += 1
            continue
        side = choose_side(model, m["shown"], m["tick"], m["rate"])
        if side is None:
            counts["no_edge"] += 1
            continue
        if m.get("prints") == "incomplete":
            counts["prints_incomplete"] += 1
            continue
        fair = model if side == "YES" else 1.0 - model
        fills = walk_fills(m["prints"], side, m["shown"], m["tick"], m["rate"], fair)
        if not fills:
            counts["under_min_fill"] += 1
            continue
        payout = m["payout_yes"] if side == "YES" else m["payout_no"]
        counts["filled"] += 1
        out.append({
            "slug": m["slug"], "side": side, "model": model, "shown": m["shown"], "strike": m["strike"],
            "spot": m["spot"], "fills": fills, "first": fills[0][0], "payout": payout, "end": end,
            "closed": m["closed"], "rate": m["rate"], "tick": m["tick"],
        })
    out.sort(key=lambda c: (c["first"], c["slug"]))
    return out, dict(counts)


def pnl_of(c, tick_shift=0, fee_mult=1.0):
    tot = 0.0
    for _, px, qty in c["fills"]:
        p = px + tick_shift * c["tick"]
        tot += qty * (c["payout"] - p) - fee_mult * fee(c["rate"], p) * qty
    return tot


def cost_of(c):
    return sum(px * qty for _, px, qty in c["fills"])


def shares_of(c):
    return sum(qty for _, _, qty in c["fills"])


def fees_of(c):
    return sum(fee(c["rate"], px) * qty for _, px, qty in c["fills"])


def peak_capital(trades):
    ev = []
    for c in trades:
        ev.append((c["first"], cost_of(c)))
        ev.append((max(c["closed"], c["first"]), -cost_of(c)))
    ev.sort()
    cur = peak = 0.0
    for _, d in ev:
        cur += d
        peak = max(peak, cur)
    return peak


def summarise(trades):
    if not trades:
        return {"trades": 0, "pnl": 0.0}
    p = [pnl_of(c) for c in trades]
    cost = sum(cost_of(c) for c in trades)
    wins = sum(1 for c in trades if c["payout"] >= 1.0 - 1e-12)
    part = sum(1 for c in trades if 0.0 < c["payout"] < 1.0 - 1e-12)
    yes = sum(1 for c in trades if c["side"] == "YES")
    return {
        "trades": len(trades), "pnl": r6(sum(p)), "cost": r6(cost), "fees": r6(sum(fees_of(c) for c in trades)),
        "won": wins, "partial_payout": part, "lost": len(trades) - wins - part,
        "buy_yes": yes, "buy_no": len(trades) - yes,
        "pnl_per_dollar": r6(sum(p) / cost) if cost else None,
    }


def null_p95(trades):
    rng = random.Random(SEED)
    base = []
    for c in trades:
        sh, co = shares_of(c), cost_of(c)
        base.append((sh, co, fees_of(c), co / sh))
    draws = []
    for _ in range(NULL_DRAWS):
        tot = 0.0
        for sh, co, fe, q in base:
            tot += (sh if rng.random() < q else 0.0) - co - fe
        draws.append(tot)
    draws.sort()
    return {"mean": r6(sum(draws) / len(draws)), "p95": r6(draws[int(0.95 * len(draws))]), "draws": NULL_DRAWS}


def at_shown(trades):
    """Descriptive: the same shares filled at the shown token price, which nobody could trade."""
    tot = 0.0
    for c in trades:
        shown_tok = c["shown"] if c["side"] == "YES" else 1.0 - c["shown"]
        sh = shares_of(c)
        tot += sh * (c["payout"] - shown_tok) - fee(c["rate"], shown_tok) * sh
    return r6(tot)


def evaluate(trades):
    by_w = defaultdict(list)
    for c in trades:
        w = window_of(c["end"])
        if w:
            by_w[w].append(c)
    oos = by_w["OOS1"] + by_w["OOS2"]
    res = {w: summarise(by_w[w]) for w in ("IS", "OOS1", "OOS2")}
    res["OOS"] = summarise(oos)
    oos_pnl = sum(pnl_of(c) for c in oos)
    stress = sum(pnl_of(c, 1, 2.0) for c in oos)
    res["stress_OOS_pnl"] = r6(stress)
    nl = null_p95(oos) if oos else {"p95": None, "mean": None, "draws": 0}
    res["null"] = nl
    months = defaultdict(float)
    for c in oos:
        months[month(c["first"])] += pnl_of(c)
    res["oos_by_month"] = {k: r6(v) for k, v in sorted(months.items())}
    best_m = max(months.values()) if months else 0.0
    peak = peak_capital(oos)
    ann = (oos_pnl * 365.0 / OOS_DAYS / peak) if peak > 0 else None
    res["oos_peak_capital"] = r6(peak)
    res["oos_days"] = r6(OOS_DAYS)
    res["oos_return_per_year_on_peak"] = r6(ann)
    res["descriptive_pnl_at_shown_price"] = at_shown(oos)
    losses = sorted(oos, key=lambda c: pnl_of(c))[:5]
    res["largest_losses"] = [{"slug": c["slug"], "side": c["side"], "pnl": r6(pnl_of(c)), "payout": c["payout"]} for c in losses]
    res["bar"] = {
        "1_oos_pos_and_both_halves": oos_pnl > 0 and sum(pnl_of(c) for c in by_w["OOS1"]) > 0 and sum(pnl_of(c) for c in by_w["OOS2"]) > 0,
        "2_beats_null_p95": nl.get("p95") is not None and oos_pnl > nl["p95"],
        "3_stress_pos": stress > 0,
        "4_at_least_80_trades": len(oos) >= 80,
        "5_not_one_month": oos_pnl > 0 and best_m <= 0.40 * oos_pnl and (oos_pnl - best_m) > 0,
        "6_beats_cash": ann is not None and ann > 0.04,
    }
    res["passes"] = all(res["bar"].values())
    return res


def run(events):
    primary, counts = trades_from(events, "sigma_dvol")
    secondary, counts_rv = trades_from(events, "sigma_rv")
    return {
        "rule": "VOL",
        "prereg": "reviews/2026-09-25-polymarket-fp5-prereg-vol-digital.md",
        "events": len(events),
        "counts_dvol": counts,
        "counts_rv": counts_rv,
        "primary_dvol": evaluate(primary),
        "secondary_rv": evaluate(secondary),
    }


def load_events(path):
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt") as f:
        d = json.load(f)
    return d["events"] if isinstance(d, dict) else d


def self_check():
    years = 16.0 / (24.0 * 365.25)
    got = digital(100.0, 100.0, 0.40, years)
    if abs(got - DIGITAL_PIN) > 5e-7:
        raise SystemExit(f"digital pin {got} != {DIGITAL_PIN}")
    # A $10 YES buy. Shown 0.40, one print at 0.40, so the fill is lifted to 0.41.
    # model at S=K is the pin, which clears e(0.41, model).
    end = datetime(2026, 3, 1, 16, 0, tzinfo=timezone.utc).timestamp()
    td = end - 16 * 3600
    ev = [{
        "slug": "pin", "end": end, "closed": end + 3600, "spot": 100.0, "strike": 100.0,
        "sigma_dvol": 0.40, "sigma_rv": 0.40, "shown": 0.40, "tick": 0.01, "rate": 0.07,
        "payout_yes": 1.0, "payout_no": 0.0,
        "prints": [[td + 10, "BUY", 0, 0.40, 100.0]],
    }]
    trades, _ = trades_from(ev, "sigma_dvol")
    if len(trades) != 1 or trades[0]["side"] != "YES":
        raise SystemExit(f"pin side {trades}")
    if abs(trades[0]["fills"][0][1] - 0.41) > 1e-12:
        raise SystemExit("fill was not lifted one tick over the shown price")
    q = 10.0 / 0.41
    hand = q * (1.0 - 0.41) - 0.07 * 0.41 * 0.59 * q
    if abs(pnl_of(trades[0]) - hand) > 1e-9:
        raise SystemExit(f"pnl {pnl_of(trades[0])} != hand {hand}")
    # Stress: same shares, one tick worse, fees doubled. Independent arithmetic.
    hand_s = q * (1.0 - 0.42) - 2 * 0.07 * 0.42 * 0.58 * q
    if abs(pnl_of(trades[0], 1, 2.0) - hand_s) > 1e-9:
        raise SystemExit(f"stress {pnl_of(trades[0], 1, 2.0)} != {hand_s}")
    # One half empty: March is OOS1, so the bar's first condition fails.
    if evaluate(trades)["bar"]["1_oos_pos_and_both_halves"]:
        raise SystemExit("empty OOS2 must fail the bar")
    # Model equal to the shown price: one tick through has no edge.
    ev[0]["shown"] = digital(100.0, 100.0, 0.40, years)
    none, _ = trades_from(ev, "sigma_dvol")
    if none:
        raise SystemExit("a model equal to the shown price must not trade")
    # Counterfactual: accepting the print at its own price would record 0.40. The rule must not.
    if trades[0]["fills"][0][1] <= 0.40 + 1e-12:
        raise SystemExit("filled at our own shown price")
    print("self-check ok", r6(hand))


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "--self-check":
        self_check()
        return
    events = load_events(sys.argv[1])
    out = run(events)
    with open(sys.argv[2], "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    print(json.dumps({"passes": out["primary_dvol"]["passes"], "bar": out["primary_dvol"]["bar"],
                      "oos": out["primary_dvol"]["OOS"]}, sort_keys=True))


if __name__ == "__main__":
    main()
