"""POST: the historically likely bracket on a post-count ladder, when the open is flat (fp5).

The rule is this file. post_inputs.py only fetches what the pre-registration names.
Reads the committed gzip. `--self-check` does not read a file.

usage: post_test.py --self-check
       post_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import random
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone

STAKE = 10.0
MIN_FILL = 2.0
LIMIT = 0.99
MIN_PRIOR = 8
GAP = 0.03
LIVE_FRAC = 0.5
LIVE_FLOOR = 0.02
OPEN_LAG = 3600
EXIT_BEFORE = 24 * 3600
T_IS = datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp()
T_OOS1 = datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp()
T_OOS2 = datetime(2026, 6, 1, tzinfo=timezone.utc).timestamp()
T_END = datetime(2026, 9, 11, tzinfo=timezone.utc).timestamp()
OOS_DAYS = (T_END - T_OOS1) / 86400.0
NULL_DRAWS = 10000
SEED = 20260925

_MONTH = (
    "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
    "aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?"
)
_TWO = re.compile(rf"({_MONTH})\s+(\d{{1,2}})\s*-\s*({_MONTH})\s+(\d{{1,2}})", re.I)
_ONE = re.compile(rf"({_MONTH})\s+(\d{{1,2}})\s*-\s*(\d{{1,2}})\b", re.I)
_MONTHS = {}
for _i, _names in enumerate(
    ["jan january", "feb february", "mar march", "apr april", "may", "jun june",
     "jul july", "aug august", "sep sept september", "oct october", "nov november", "dec december"],
    start=1,
):
    for _n in _names.split():
        _MONTHS[_n] = _i


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


def duration_days(title, end_ts):
    """Days between the two dates in the title. None when the title has no span."""
    year = datetime.fromtimestamp(float(end_ts), timezone.utc).year
    text = (title or "").lower().replace("–", "-")
    m = _TWO.search(text)
    if m:
        a = datetime(year, _MONTHS[m.group(1).lower()], int(m.group(2)), tzinfo=timezone.utc)
        b = datetime(year, _MONTHS[m.group(3).lower()], int(m.group(4)), tzinfo=timezone.utc)
        if b <= a:
            b = datetime(year + 1, b.month, b.day, tzinfo=timezone.utc)
        return int((b - a).total_seconds() // 86400)
    m = _ONE.search(text)
    if m:
        d1, d2 = int(m.group(2)), int(m.group(3))
        if d2 > d1:
            return d2 - d1
    return None


def bucket_of(question):
    text = question or ""
    m = re.search(r"(\d+)\s*-\s*(\d+)", text)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(r"(\d+)\s*\+", text)
    if m:
        return int(m.group(1)), None
    return None


def contains(lo, hi, x):
    if hi is None:
        return x >= lo
    return lo <= x <= hi


def midpoint(lo, hi):
    if hi is None:
        return float(lo)
    return (float(lo) + float(hi)) / 2.0


def decision_time(ev):
    return float(ev["start"]) + OPEN_LAG


def exit_time(ev):
    return float(ev["end"]) - EXIT_BEFORE


def winner_mid(markets):
    best = None
    for m in markets or []:
        if m.get("lo") is None:
            continue
        pay = m.get("payout_yes")
        if pay is None:
            continue
        key = (-float(pay), int(m["lo"]), str(m.get("condition") or ""))
        if best is None or key < best[0]:
            best = (key, m)
    if best is None or float(best[1]["payout_yes"]) < 0.99:
        return None
    return midpoint(best[1]["lo"], best[1]["hi"])


def choose(ev, prior_mids):
    """The live bracket with the highest historical hit rate, when the open is flat.

    Returns (market, fraction) or None. prior_mids are winning midpoints already restricted
    to the same series and the same title span, and already resolved before the decision.
    """
    if len(prior_mids) < MIN_PRIOR:
        return None
    markets = [m for m in (ev.get("markets") or []) if m.get("lo") is not None and m.get("shown") is not None]
    if len(markets) < 2:
        return None
    mx = max(float(m["shown"]) for m in markets)
    floor = max(LIVE_FLOOR, LIVE_FRAC * mx)
    live = [m for m in markets if float(m["shown"]) >= floor]
    if len(live) < 2:
        return None
    gap = max(float(m["shown"]) for m in live) - min(float(m["shown"]) for m in live)
    if gap > GAP + 1e-12:
        return None
    best = None
    n = float(len(prior_mids))
    for m in markets:
        hits = sum(1 for x in prior_mids if contains(m["lo"], m["hi"], x))
        frac = hits / n
        key = (-frac, int(m["lo"]), str(m.get("condition") or ""))
        if best is None or key < best[0]:
            best = (key, m, frac)
    m, frac = best[1], best[2]
    if frac <= 0:
        return None
    if m["condition"] not in {x["condition"] for x in live}:
        return None
    if edge(frac, float(m["shown"]) + float(m["tick"]), float(m["rate"])) <= 0:
        return None
    return m, frac


def walk_buys(prints, shown, tick, rate, fair):
    remaining, fills = STAKE, []
    for ts, sd, oi, price, size in prints:
        if oi == 0 and sd == "BUY":
            ptok = price
        elif oi == 1 and sd == "SELL":
            ptok = 1.0 - price
        else:
            continue
        px = max(ptok, shown + tick)
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


def walk_sells(prints, shown, tick, entry_vwap, shares):
    """Sell YES one tick through the shown price. A fill at or below the entry is skipped."""
    remaining, fills = shares, []
    ceiling = shown - tick
    for ts, sd, oi, price, size in prints:
        if oi == 0 and sd == "SELL":
            ptok = price
        elif oi == 1 and sd == "BUY":
            ptok = 1.0 - price
        else:
            continue
        px = min(ptok, ceiling)
        if px <= entry_vwap + 1e-12 or px <= 0.01:
            continue
        qty = min(size, remaining)
        if qty <= 0:
            break
        fills.append((float(ts), px, qty))
        remaining -= qty
        if remaining <= 1e-9:
            break
    if not fills:
        return []
    return fills


def _priors_for(ev, events):
    td = decision_time(ev)
    out = []
    for other in events:
        if other is ev:
            continue
        if other.get("series") != ev.get("series") or other.get("days") != ev.get("days"):
            continue
        if other.get("winner_mid") is None:
            continue
        if float(other["end"]) > td:
            continue
        out.append(float(other["winner_mid"]))
    return out


def trades_from(events):
    counts = defaultdict(int)
    incomplete = 0
    out = []
    rows = list(events or [])
    for ev in rows:
        end = float(ev["end"])
        if window_of(end) is None:
            counts["outside_window"] += 1
            continue
        if ev.get("days") is None or ev.get("start") is None:
            counts["no_span"] += 1
            continue
        counts["events"] += 1
        priors = _priors_for(ev, rows)
        chosen = choose(ev, priors)
        stored = ev.get("picked")
        stored_id = None if not stored else stored.get("condition")
        picked_id = None if chosen is None else chosen[0].get("condition")
        if stored_id != picked_id:
            raise SystemExit("picked bracket mismatch on %s: rule %s, pull %s" % (ev.get("slug"), picked_id, stored_id))
        if chosen is None:
            counts["no_trade"] += 1
            continue
        market, frac = chosen
        if stored.get("prints") == "incomplete":
            incomplete += 1
            counts["prints_incomplete"] += 1
            continue
        fills = walk_buys(stored.get("prints") or [], float(market["shown"]), float(market["tick"]), float(market["rate"]), frac)
        if not fills:
            counts["under_min_fill"] += 1
            continue
        entry = sum(px * qty for _, px, qty in fills) / sum(qty for _, _, qty in fills)
        sells = []
        tx = exit_time(ev)
        shown_x = market.get("shown_exit")
        if tx > decision_time(ev) and shown_x is not None and float(shown_x) > float(market["shown"]):
            if stored.get("exit_prints") == "incomplete":
                incomplete += 1
                counts["prints_incomplete"] += 1
                continue
            sold_shares = sum(qty for _, _, qty in fills)
            sells = walk_sells(stored.get("exit_prints") or [], float(shown_x), float(market["tick"]), entry, sold_shares)
        counts["filled"] += 1
        bought = sum(qty for _, _, qty in fills)
        sold = sum(qty for _, _, qty in sells)
        out.append({
            "slug": ev["slug"], "series": ev.get("series"), "lo": market["lo"], "hi": market["hi"],
            "fair": frac, "shown": float(market["shown"]),
            "fills": fills, "sells": sells, "unsold": bought - sold,
            "first": fills[0][0], "payout": float(market["payout_yes"]), "end": end,
            "closed": float(market.get("closed") or ev.get("closed") or end),
            "rate": float(market["rate"]), "tick": float(market["tick"]),
            "release": sells[-1][0] if sells and sold >= bought - 1e-9 else float(market.get("closed") or ev.get("closed") or end),
        })
    out.sort(key=lambda c: (c["first"], c["slug"]))
    return out, dict(counts), incomplete


def pnl_of(c, tick_shift=0, fee_mult=1.0):
    tot = 0.0
    for _, px, qty in c["fills"]:
        p = px + tick_shift * c["tick"]
        tot -= qty * p + fee_mult * fee(c["rate"], p) * qty
    for _, px, qty in c["sells"]:
        p = max(0.0, px - tick_shift * c["tick"])
        tot += qty * p - fee_mult * fee(c["rate"], p) * qty
    tot += c["unsold"] * c["payout"]
    return tot


def cost_of(c):
    return sum(px * qty for _, px, qty in c["fills"])


def shares_of(c):
    return sum(qty for _, _, qty in c["fills"])


def fees_of(c):
    tot = sum(fee(c["rate"], px) * qty for _, px, qty in c["fills"])
    tot += sum(fee(c["rate"], px) * qty for _, px, qty in c["sells"])
    return tot


def peak_capital(trades):
    ev = []
    for c in trades:
        ev.append((c["first"], cost_of(c)))
        ev.append((max(c["release"], c["first"]), -cost_of(c)))
    ev.sort()
    cur = peak = 0.0
    for _, d in ev:
        cur += d
        peak = max(peak, cur)
    return peak


def summarise(trades):
    if not trades:
        return {"trades": 0, "pnl": 0.0, "cost": 0.0, "fees": 0.0, "won": 0, "lost": 0,
                "sold_out": 0, "pnl_per_dollar": None}
    p = [pnl_of(c) for c in trades]
    cost = sum(cost_of(c) for c in trades)
    held = [c for c in trades if c["unsold"] > 1e-9]
    wins = sum(1 for c in held if c["payout"] >= 1.0 - 1e-12)
    return {
        "trades": len(trades), "pnl": r6(sum(p)), "cost": r6(cost), "fees": r6(sum(fees_of(c) for c in trades)),
        "won": wins, "lost": len(held) - wins, "sold_out": len(trades) - len(held),
        "pnl_per_dollar": r6(sum(p) / cost) if cost else None,
    }


def null_p95(trades):
    """Sold shares keep their print. Shares still held are redrawn Bernoulli at the entry price."""
    rng = random.Random(SEED)
    base = []
    for c in trades:
        sh = shares_of(c)
        co = cost_of(c)
        cash = pnl_of(c) - c["unsold"] * c["payout"]
        base.append((cash, c["unsold"], co / sh))
    draws = []
    for _ in range(NULL_DRAWS):
        tot = 0.0
        for cash, unsold, q in base:
            tot += cash + (unsold if unsold > 1e-12 and rng.random() < q else 0.0)
        draws.append(tot)
    draws.sort()
    return {"mean": r6(sum(draws) / len(draws)), "p95": r6(draws[int(0.95 * len(draws))]), "draws": NULL_DRAWS}


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
        "rule": "POST",
        "prereg": "reviews/2026-09-25-polymarket-fp5-prereg-post.md",
        "result": out,
    }


def _mkt(lo, hi, shown, condition, payout=0.0, shown_exit=None, rate=0.05):
    return {
        "condition": condition, "lo": lo, "hi": hi, "shown": shown, "shown_exit": shown_exit,
        "tick": 0.001, "rate": rate, "payout_yes": payout, "closed": None,
    }


def self_check():
    assert abs(OOS_DAYS - 253.0) < 1e-9
    assert duration_days("Elon Musk # of tweets May 31 - June 7?", datetime(2024, 6, 7, tzinfo=timezone.utc).timestamp()) == 7
    assert duration_days("Elon Musk # of tweets June 7-14?", datetime(2024, 6, 14, tzinfo=timezone.utc).timestamp()) == 7
    assert duration_days("Elon Musk # tweets September 11 - September 18, 2026?", datetime(2026, 9, 18, tzinfo=timezone.utc).timestamp()) == 7
    assert duration_days("Donald Trump # Truth Social posts February 6 - February 13, 2026?", datetime(2026, 2, 13, tzinfo=timezone.utc).timestamp()) == 7
    assert duration_days("posts December 28 - January 4, 2026?", datetime(2026, 1, 4, tzinfo=timezone.utc).timestamp()) == 7
    assert bucket_of("Will Elon Musk post 200-219 tweets from September 15 to September 22, 2026?") == (200, 219)
    assert bucket_of("Will Elon Musk post 580+ tweets from September 23 to September 30, 2025?") == (580, None)

    end = T_OOS1 + 20 * 86400
    start = end - 10 * 86400
    td = start + OPEN_LAG
    priors = []
    for i in range(MIN_PRIOR):
        priors.append({
            "slug": "prior-%s" % i, "series": 10000, "days": 7, "start": start - (i + 2) * 10 * 86400,
            "end": start - (i + 1) * 86400, "winner_mid": 49.5,
            "markets": [_mkt(40, 59, 0.2, "w", payout=1.0)],
        })
    target = _mkt(40, 59, 0.12, "b", payout=0.0, shown_exit=0.20)
    markets = [_mkt(0, 19, 0.04, "a"), target, _mkt(60, 79, 0.11, "c")]
    buy = [[td + 10, "BUY", 0, 0.10, 100.0]]
    sell = [[exit_time({"end": end}) + 10, "SELL", 0, 0.25, 100.0]]
    ev = {
        "slug": "elon-musk-of-tweets-example", "series": 10000, "days": 7, "start": start, "end": end,
        "closed": end, "winner_mid": 9.5, "markets": markets,
        "picked": {"condition": "b", "prints": buy, "exit_prints": sell},
    }
    for p in priors:
        p["closed"] = p["end"]
    trades, counts, incomplete = trades_from(priors + [ev])
    if len(trades) != 1 or trades[0]["lo"] != 40 or abs(trades[0]["fills"][0][1] - 0.121) > 1e-9:
        raise SystemExit("entry pin %s %s" % (trades, counts))
    if abs(trades[0]["sells"][0][1] - 0.199) > 1e-9 or trades[0]["unsold"] > 1e-9:
        raise SystemExit("exit pin %s" % trades[0]["sells"])
    sh = 10.0 / 0.121
    hand = sh * (0.199 - 0.121) - fee(0.05, 0.121) * sh - fee(0.05, 0.199) * sh
    if abs(pnl_of(trades[0]) - hand) > 1e-6:
        raise SystemExit("pnl %s != %s" % (pnl_of(trades[0]), hand))

    held = dict(ev)
    held["markets"] = [_mkt(0, 19, 0.04, "a"), _mkt(40, 59, 0.12, "b", payout=1.0, shown_exit=0.05), _mkt(60, 79, 0.11, "c")]
    held["picked"] = {"condition": "b", "prints": buy, "exit_prints": sell}
    held["slug"] = ev["slug"]
    held_trades, _, _ = trades_from(priors + [held])
    if held_trades[0]["sells"] or abs(held_trades[0]["unsold"] - sh) > 1e-6:
        raise SystemExit("a price that did not rise was sold %s" % held_trades[0])
    hand_hold = sh * (1.0 - 0.121) - fee(0.05, 0.121) * sh
    if abs(pnl_of(held_trades[0]) - hand_hold) > 1e-6:
        raise SystemExit("hold pnl %s != %s" % (pnl_of(held_trades[0]), hand_hold))

    wide = dict(ev)
    wide["markets"] = [_mkt(0, 19, 0.04, "a"), _mkt(40, 59, 0.20, "b"), _mkt(60, 79, 0.10, "c")]
    wide["picked"] = None
    wide_trades, _, _ = trades_from(priors + [wide])
    if wide_trades:
        raise SystemExit("a wide open was traded")
    short = priors[: MIN_PRIOR - 1] + [ev]
    ev_short = dict(ev)
    ev_short["picked"] = None
    if trades_from(short[:-1] + [ev_short])[0]:
        raise SystemExit("seven priors were enough")

    cut = dict(ev)
    cut["picked"] = {"condition": "b", "prints": "incomplete", "exit_prints": []}
    _, _, inc = trades_from(priors + [cut])
    if inc != 1 or evaluate([], inc)["passes"]:
        raise SystemExit("incomplete tape passed")
    if evaluate([], 0)["passes"]:
        raise SystemExit("empty book passed")
    bad = dict(ev)
    bad["picked"] = {"condition": "a", "prints": buy, "exit_prints": []}
    try:
        trades_from(priors + [bad])
    except SystemExit as e:
        if "mismatch" not in str(e):
            raise
    else:
        raise SystemExit("a mismatched pick was accepted")
    print("self-check ok", round(hand, 6), round(hand_hold, 6))


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
