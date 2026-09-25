"""ROUND: a $10,000 strike against the two strikes beside it (fp5).

The rule is this file. round_inputs.py only fetches what the pre-registration names.
Reads the committed gzip. `--self-check` does not read a file.

usage: round_test.py --self-check
       round_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import random
import sys
from collections import defaultdict
from datetime import datetime, timezone

STAKE = 10.0
MIN_FILL = 2.0
LIMIT = 0.99
ROUND = 10000
T_IS = datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp()
T_OOS1 = datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp()
T_OOS2 = datetime(2026, 6, 1, tzinfo=timezone.utc).timestamp()
T_END = datetime(2026, 9, 11, tzinfo=timezone.utc).timestamp()
OOS_DAYS = (T_END - T_OOS1) / 86400.0
NULL_DRAWS = 10000
SEED = 20260925


def r6(x):
    return None if x is None else round(float(x), 6)


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


def choose_side(fair, shown, tick, rate):
    """YES, NO, or None. Both and neither are no trade."""
    if fair is None or shown is None or not (0.0 < fair < 1.0) or not (0.0 < shown < 1.0):
        return None
    if tick <= 0 or rate < 0:
        return None
    yes = edge(fair, shown + tick, rate) > 0
    no = edge(1.0 - fair, (1.0 - shown) + tick, rate) > 0
    if yes and not no:
        return "YES"
    if no and not yes:
        return "NO"
    return None


def interpolated(lo, hi, strike):
    span = hi["strike"] - lo["strike"]
    if span <= 0:
        return None
    w = (strike - lo["strike"]) / span
    return lo["shown"] + (hi["shown"] - lo["shown"]) * w


def walk_fills(prints, side, shown, tick, rate, fair):
    """Fills of `side` from prints [ts, side, oi, price, size]. None if under $2."""
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
        fills.append((float(ts), px, qty))
        remaining -= qty * px
        if remaining <= 1e-9:
            break
    if STAKE - remaining < MIN_FILL:
        return None
    return fills


def trades_from(events):
    """One candidate per $10,000 strike that has a strike on each side. Returns trades, counts, incomplete."""
    counts = defaultdict(int)
    incomplete = 0
    out = []
    for ev in events or []:
        end = float(ev["end"])
        win = window_of(end)
        if win is None:
            counts["outside_window"] += 1
            continue
        mkts = sorted(ev.get("markets") or [], key=lambda m: (float(m["strike"]), str(m.get("condition") or "")))
        # One row per strike. A repeated strike keeps the lower condition id.
        uniq = []
        for m in mkts:
            if uniq and float(uniq[-1]["strike"]) == float(m["strike"]):
                continue
            uniq.append(m)
        for i, m in enumerate(uniq):
            strike = float(m["strike"])
            if int(strike) % ROUND != 0:
                continue
            counts["round_strikes"] += 1
            if i == 0 or i == len(uniq) - 1:
                counts["no_neighbor"] += 1
                continue
            lo, hi = uniq[i - 1], uniq[i + 1]
            if lo.get("shown") is None or hi.get("shown") is None or m.get("shown") is None:
                counts["no_shown"] += 1
                continue
            fair = interpolated(
                {"strike": float(lo["strike"]), "shown": float(lo["shown"])},
                {"strike": float(hi["strike"]), "shown": float(hi["shown"])},
                strike,
            )
            side = choose_side(fair, float(m["shown"]), float(m["tick"]), float(m["rate"]))
            if side is None:
                counts["no_edge"] += 1
                continue
            if m.get("prints") == "incomplete":
                incomplete += 1
                counts["prints_incomplete"] += 1
                continue
            token_fair = fair if side == "YES" else 1.0 - fair
            fills = walk_fills(m.get("prints") or [], side, float(m["shown"]), float(m["tick"]), float(m["rate"]), token_fair)
            if not fills:
                counts["under_min_fill"] += 1
                continue
            payout = float(m["payout_yes"] if side == "YES" else m["payout_no"])
            counts["filled"] += 1
            out.append({
                "slug": ev["slug"], "strike": strike, "side": side, "fair": fair, "shown": float(m["shown"]),
                "fills": fills, "first": fills[0][0], "payout": payout, "end": end,
                "closed": float(m.get("closed") or ev.get("closed") or end),
                "rate": float(m["rate"]), "tick": float(m["tick"]),
            })
    out.sort(key=lambda c: (c["first"], c["slug"], c["strike"]))
    return out, dict(counts), incomplete


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
        return {"trades": 0, "pnl": 0.0, "cost": 0.0, "fees": 0.0, "won": 0, "lost": 0,
                "partial_payout": 0, "buy_yes": 0, "buy_no": 0, "pnl_per_dollar": None}
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
    tot = 0.0
    for c in trades:
        shown_tok = c["shown"] if c["side"] == "YES" else 1.0 - c["shown"]
        sh = shares_of(c)
        tot += sh * (c["payout"] - shown_tok) - fee(c["rate"], shown_tok) * sh
    return r6(tot)


def evaluate(trades, incomplete):
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
    res["oos_days"] = OOS_DAYS
    res["oos_return_per_year_on_peak"] = r6(ann)
    res["descriptive_pnl_at_shown_price"] = at_shown(oos)
    res["prints_incomplete"] = incomplete
    res["bar"] = {
        "1_oos_pos_and_both_halves": oos_pnl > 0 and sum(pnl_of(c) for c in by_w["OOS1"]) > 0 and sum(pnl_of(c) for c in by_w["OOS2"]) > 0,
        "2_beats_null_p95": nl.get("p95") is not None and oos_pnl > nl["p95"],
        "3_stress_pos": stress > 0,
        "4_at_least_80_trades": len(oos) >= 80,
        "5_not_one_month": oos_pnl > 0 and best_m <= 0.40 * oos_pnl and (oos_pnl - best_m) > 0,
        "6_beats_cash": ann is not None and ann > 0.04,
    }
    res["passes"] = all(res["bar"].values()) and incomplete == 0
    return res


def run(data):
    trades, counts, incomplete = trades_from(data.get("events"))
    out = evaluate(trades, incomplete)
    out["counts"] = counts
    return {
        "rule": "ROUND",
        "prereg": "reviews/2026-09-25-polymarket-fp5-prereg-round-strike.md",
        "result": out,
    }


def _mkt(strike, shown, prints, payout_yes=0.0, closed=None):
    return {
        "condition": "c%s" % strike, "strike": strike, "shown": shown, "tick": 0.01, "rate": 0.07,
        "payout_yes": payout_yes, "payout_no": 1.0 - payout_yes, "prints": prints, "closed": closed,
    }


def self_check():
    assert abs(OOS_DAYS - 253.0) < 1e-9
    # 90k / 100k / 110k at 0.60 / 0.55 / 0.40. The line is 0.50. YES at 0.55 is rich.
    fair = interpolated({"strike": 90000, "shown": 0.60}, {"strike": 110000, "shown": 0.40}, 100000)
    if abs(fair - 0.50) > 1e-12:
        raise SystemExit("interpolation %s" % fair)
    if choose_side(fair, 0.55, 0.01, 0.07) != "NO":
        raise SystemExit("expected to buy NO")
    # Flat ladder: the middle equals the line, so one tick through has no edge.
    flat = interpolated({"strike": 90000, "shown": 0.50}, {"strike": 110000, "shown": 0.30}, 100000)
    if choose_side(flat, 0.40, 0.01, 0.07) is not None:
        raise SystemExit("a price on the line must not trade")
    end = T_OOS1 + 10 * 86400
    td = end - 16 * 3600
    prints = [
        [td + 10, "BUY", 0, 0.40, 100.0],
        [td + 20, "SELL", 0, 0.54, 100.0],
        [td + 30, "BUY", 1, 0.40, 100.0],
        [td + 3601, "BUY", 1, 0.46, 100.0],
    ]
    ev = {"slug": "bitcoin-above-on-january-11-2026", "end": end, "closed": end, "markets": [
        _mkt(90000, 0.60, [], closed=end),
        _mkt(100000, 0.55, prints, payout_yes=0.0, closed=end),
        _mkt(110000, 0.40, [], closed=end),
        _mkt(76000, 0.90, [[td + 20, "BUY", 1, 0.20, 100.0]], payout_yes=0.0, closed=end),
    ]}
    trades, counts, incomplete = trades_from([ev])
    if len(trades) != 1 or trades[0]["side"] != "NO" or trades[0]["strike"] != 100000:
        raise SystemExit("trade pin %s %s" % (len(trades), counts))
    if abs(trades[0]["fills"][0][1] - 0.46) > 1e-12:
        raise SystemExit("fill was not lifted to the shown NO plus one tick: %s" % trades[0]["fills"][0])
    shares = 10.0 / 0.46
    hand = shares * (1.0 - 0.46) - 0.07 * 0.46 * 0.54 * shares
    if abs(pnl_of(trades[0]) - hand) > 1e-9:
        raise SystemExit("pnl %s != %s" % (pnl_of(trades[0]), hand))
    # A non-round strike is not a candidate, even with a cheap NO.
    if any(c["strike"] == 76000 for c in trades):
        raise SystemExit("traded a strike that is not a multiple of 10000")
    # An end strike has no neighbor.
    lone = {"slug": "bitcoin-above-on-january-12-2026", "end": end, "markets": [
        _mkt(80000, 0.20, [[td + 20, "BUY", 1, 0.70, 100.0]], closed=end),
        _mkt(90000, 0.10, [], closed=end),
    ]}
    none, _, _ = trades_from([lone])
    if none:
        raise SystemExit("an end strike traded")
    # A cut-off tape that would have traded cannot pass, whatever the other trades earn.
    cut = dict(ev)
    cut["markets"] = [
        _mkt(90000, 0.60, [], closed=end),
        _mkt(100000, 0.55, "incomplete", closed=end),
        _mkt(110000, 0.40, [], closed=end),
    ]
    _, _, inc = trades_from([cut])
    bad = evaluate([], inc)
    if inc != 1 or bad["passes"]:
        raise SystemExit("incomplete tape passed")
    empty = evaluate([], 0)
    if empty["passes"]:
        raise SystemExit("empty book passed")
    print("self-check ok", round(hand, 6))


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--self-check":
        self_check()
    else:
        with gzip.open(sys.argv[1], "rt") as f:
            data = json.load(f)
        out = run(data)
        with open(sys.argv[2], "w") as f:
            json.dump(out, f, indent=2, sort_keys=True)
            f.write("\n")
        print("passes", out["result"]["passes"], "oos", out["result"]["OOS"], "bar", out["result"]["bar"])
