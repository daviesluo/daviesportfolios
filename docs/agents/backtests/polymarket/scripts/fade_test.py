"""FADE: a six-hour move in the coin-flip strike, taken the other way (fp5).

The rule is this file. fade_inputs.py only fetches what the pre-registration names.
Reads the committed gzip. `--self-check` does not read a file.

usage: fade_test.py --self-check
       fade_test.py <inputs.json.gz> <out.json>
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
BAND_LO = 0.40
BAND_HI = 0.60
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


def dedupe(markets):
    rows = sorted(markets or [], key=lambda m: (float(m["strike"]), str(m.get("condition") or "")))
    out = []
    for m in rows:
        if out and float(out[-1]["strike"]) == float(m["strike"]):
            continue
        out.append(m)
    return out


def select_market(markets):
    """The strike whose YES price is closest to 0.50 inside [0.40, 0.60].

    A tie takes the lower strike, then the lower condition id. None if the band is empty.
    """
    cands = []
    for m in dedupe(markets):
        shown = m.get("shown")
        if shown is None:
            continue
        shown = float(shown)
        if not (BAND_LO <= shown <= BAND_HI):
            continue
        cands.append((abs(shown - 0.5), float(m["strike"]), str(m.get("condition") or ""), m))
    if not cands:
        return None
    cands.sort()
    return cands[0][3]


def fade_side(earlier, shown, tick, rate):
    """Buy the side the six-hour move made cheaper. Both and neither are no trade."""
    if earlier is None or shown is None:
        return None
    if not (0.0 < earlier < 1.0) or not (0.0 < shown < 1.0) or tick <= 0 or rate < 0:
        return None
    yes = edge(earlier, shown + tick, rate) > 0
    no = edge(1.0 - earlier, (1.0 - shown) + tick, rate) > 0
    if yes and not no:
        return "YES"
    if no and not yes:
        return "NO"
    return None


def walk_fills(prints, side, shown, tick, rate, fair):
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
    counts = defaultdict(int)
    incomplete = 0
    out = []
    for ev in events or []:
        end = float(ev["end"])
        if window_of(end) is None:
            counts["outside_window"] += 1
            continue
        counts["events"] += 1
        picked = select_market(ev.get("markets"))
        stored = ev.get("picked")
        stored_id = None if not stored else stored.get("condition")
        picked_id = None if picked is None else picked.get("condition")
        if stored_id != picked_id:
            raise SystemExit("picked strike mismatch on %s: rule %s, pull %s" % (ev.get("slug"), picked_id, stored_id))
        if picked is None:
            counts["no_band"] += 1
            continue
        earlier = stored.get("earlier")
        side = fade_side(None if earlier is None else float(earlier), float(picked["shown"]), float(picked["tick"]), float(picked["rate"]))
        if side is None:
            counts["no_fade"] += 1
            continue
        if stored.get("prints") == "incomplete":
            incomplete += 1
            counts["prints_incomplete"] += 1
            continue
        fair = float(earlier) if side == "YES" else 1.0 - float(earlier)
        fills = walk_fills(stored.get("prints") or [], side, float(picked["shown"]), float(picked["tick"]), float(picked["rate"]), fair)
        if not fills:
            counts["under_min_fill"] += 1
            continue
        payout = float(picked["payout_yes"] if side == "YES" else picked["payout_no"])
        counts["filled"] += 1
        out.append({
            "slug": ev["slug"], "strike": float(picked["strike"]), "side": side,
            "earlier": float(earlier), "shown": float(picked["shown"]),
            "fills": fills, "first": fills[0][0], "payout": payout, "end": end,
            "closed": float(picked.get("closed") or ev.get("closed") or end),
            "rate": float(picked["rate"]), "tick": float(picked["tick"]),
        })
    out.sort(key=lambda c: (c["first"], c["slug"]))
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
        "rule": "FADE",
        "prereg": "reviews/2026-09-25-polymarket-fp5-prereg-fade.md",
        "result": out,
    }


def _mkt(strike, shown, condition=None, payout_yes=0.0, closed=None):
    return {
        "condition": condition or ("c%s" % strike), "strike": strike, "shown": shown,
        "tick": 0.01, "rate": 0.07, "payout_yes": payout_yes, "payout_no": 1.0 - payout_yes,
        "closed": closed,
    }


def self_check():
    assert abs(OOS_DAYS - 253.0) < 1e-9
    assert abs(BAND_HI - BAND_LO - 0.20) < 1e-12
    markets = [
        _mkt(80000, 0.42, "a"),
        _mkt(82000, 0.48, "b"),
        _mkt(84000, 0.70, "c"),
    ]
    got = select_market(markets)
    if got["condition"] != "b":
        raise SystemExit("closest to one half should be 0.48, got %s" % got["shown"])
    tie = [_mkt(80000, 0.48, "a"), _mkt(82000, 0.52, "b")]
    if select_market(tie)["strike"] != 80000:
        raise SystemExit("an equal distance must take the lower strike")
    if select_market([_mkt(80000, 0.39)]) is not None:
        raise SystemExit("outside the band was selected")
    if fade_side(0.50, 0.495, 0.01, 0.07) is not None:
        raise SystemExit("a one-tick move must not trade")
    if fade_side(0.50, 0.40, 0.01, 0.07) != "YES":
        raise SystemExit("a down move must buy YES")
    if fade_side(0.50, 0.62, 0.01, 0.07) != "NO":
        raise SystemExit("an up move must buy NO")

    end = T_OOS1 + 10 * 86400
    td = end - 16 * 3600
    yes_m = _mkt(82000, 0.40, "b", payout_yes=1.0, closed=end)
    prints = [
        [td + 10, "BUY", 1, 0.70, 100.0],
        [td + 20, "BUY", 0, 0.39, 100.0],
        [td + 3601, "BUY", 0, 0.41, 100.0],
    ]
    ev = {
        "slug": "bitcoin-above-on-january-11-2026", "end": end, "closed": end,
        "markets": [_mkt(80000, 0.30, "a", closed=end), yes_m, _mkt(84000, 0.70, "c", closed=end)],
        "picked": {"condition": "b", "earlier": 0.50, "prints": prints},
    }
    trades, counts, incomplete = trades_from([ev])
    if len(trades) != 1 or trades[0]["side"] != "YES" or abs(trades[0]["fills"][0][1] - 0.41) > 1e-12:
        raise SystemExit("yes fill pin %s %s" % (trades, counts))
    shares = 10.0 / 0.41
    hand = shares * (1.0 - 0.41) - 0.07 * 0.41 * 0.59 * shares
    if abs(pnl_of(trades[0]) - hand) > 1e-9:
        raise SystemExit("pnl %s != %s" % (pnl_of(trades[0]), hand))

    # The other direction: price rose, buy NO, floor at shown NO plus one tick.
    no_m = _mkt(82000, 0.60, "b", payout_yes=0.0, closed=end)
    no_prints = [[td + 15, "BUY", 1, 0.30, 100.0]]
    ev_no = {
        "slug": ev["slug"], "end": end, "markets": [no_m],
        "picked": {"condition": "b", "earlier": 0.48, "prints": no_prints},
    }
    traded_no, _, _ = trades_from([ev_no])
    if len(traded_no) != 1 or traded_no[0]["side"] != "NO" or abs(traded_no[0]["fills"][0][1] - 0.41) > 1e-12:
        raise SystemExit("no fill pin %s" % traded_no)

    cut = dict(ev)
    cut["picked"] = {"condition": "b", "earlier": 0.50, "prints": "incomplete"}
    _, _, inc = trades_from([cut])
    if inc != 1 or evaluate([], inc)["passes"]:
        raise SystemExit("incomplete tape passed")
    if evaluate([], 0)["passes"]:
        raise SystemExit("empty book passed")
    # A stored pick the rule would not make is a pull error, not a trade.
    bad = dict(ev)
    bad["picked"] = {"condition": "a", "earlier": 0.50, "prints": prints}
    try:
        trades_from([bad])
    except SystemExit as e:
        if "mismatch" not in str(e):
            raise
    else:
        raise SystemExit("a mismatched pick was accepted")
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
