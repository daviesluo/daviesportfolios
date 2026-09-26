"""DRAWBASE's code, copied for DRAW-X from fp5's Polymarket branch (commit 31250cab).

Every function here is a copy of the one named in its comment, from
docs/agents/backtests/polymarket/scripts/ on that commit. DRAWBASE's code sat in five
files (post_test.py, post_inputs.py, epl_score.py, epl_hold.py, draw_test.py, plus
epl_inputs.py's CSV reader); here it is one module, so the module prefixes (post.,
score., hold.) are gone. Nothing else is changed, and nothing DRAWBASE's draw rule
does not use is copied.

The proof that the copy is faithful is `drawx_score.py --self-check`: it prints
DRAWBASE's own pin (`D 0.25 88.560401`) and, run on DRAWBASE's committed input, writes
DRAWBASE's committed drawbase_run.json byte for byte.

Nothing here reads the network.
"""
import csv
import io
import random
from collections import defaultdict
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

# post_test.py, lines 17-32 (the constants DRAWBASE's draw rule and its book use).
STAKE = 10.0
MIN_FILL = 2.0
LIMIT = 0.99
OPEN_LAG = 3600
T_IS = datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp()
T_OOS1 = datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp()
T_OOS2 = datetime(2026, 6, 1, tzinfo=timezone.utc).timestamp()
T_END = datetime(2026, 9, 11, tzinfo=timezone.utc).timestamp()
OOS_DAYS = (T_END - T_OOS1) / 86400.0
NULL_DRAWS = 10000
SEED = 20260925

# epl_score.py, lines 15-17.
KNOW = 3 * 3600
LEAD = 3600
MIN_PRIOR = 8

# draw_test.py, lines 16-17.
RULE = "DRAWBASE"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-drawbase.md"

# epl_inputs.py, line 32.
LONDON = ZoneInfo("Europe/London")


# ---------------------------------------------------------------- post_test.py


def r6(x):  # post_test.py, lines 50-51
    return None if x is None else round(float(x), 6)


def fee(rate, price):  # post_test.py, lines 54-55
    return rate * price * (1.0 - price)


def edge(fair, price, rate):  # post_test.py, lines 58-59
    return fair - price - fee(rate, price)


def window_of(end):  # post_test.py, lines 62-69
    if T_IS <= end < T_OOS1:
        return "IS"
    if T_OOS1 <= end < T_OOS2:
        return "OOS1"
    if T_OOS2 <= end < T_END:
        return "OOS2"
    return None


def month(ts):  # post_test.py, lines 72-73
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m")


def walk_buys(prints, shown, tick, rate, fair):  # post_test.py, lines 179-202
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


def pnl_of(c, tick_shift=0, fee_mult=1.0):  # post_test.py, lines 307-316
    tot = 0.0
    for _, px, qty in c["fills"]:
        p = px + tick_shift * c["tick"]
        tot -= qty * p + fee_mult * fee(c["rate"], p) * qty
    for _, px, qty in c["sells"]:
        p = max(0.0, px - tick_shift * c["tick"])
        tot += qty * p - fee_mult * fee(c["rate"], p) * qty
    tot += c["unsold"] * c["payout"]
    return tot


def cost_of(c):  # post_test.py, lines 319-320
    return sum(px * qty for _, px, qty in c["fills"])


def shares_of(c):  # post_test.py, lines 323-324
    return sum(qty for _, _, qty in c["fills"])


def fees_of(c):  # post_test.py, lines 327-330
    tot = sum(fee(c["rate"], px) * qty for _, px, qty in c["fills"])
    tot += sum(fee(c["rate"], px) * qty for _, px, qty in c["sells"])
    return tot


def peak_capital(trades):  # post_test.py, lines 333-343
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


def summarise(trades):  # post_test.py, lines 346-358
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


def null_p95(trades):  # post_test.py, lines 361-377
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


def evaluate(trades, incomplete):  # post_test.py, lines 380-414
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


# -------------------------------------------------------------- post_inputs.py


def ts_of(s):  # post_inputs.py, lines 36-47
    if not s:
        return None
    s = str(s).strip().replace(" ", "T")
    if s.endswith("+00"):
        s = s[:-3] + "+00:00"
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(s).timestamp()
    except ValueError:
        return None


def rate_of(m):  # post_inputs.py, lines 143-156
    if not m.get("feesEnabled"):
        return 0.0
    sched = m.get("feeSchedule") or {}
    exponent = sched.get("exponent") if isinstance(sched, dict) else None
    if exponent not in (None, 1, 1.0):
        return None
    try:
        rate = float(sched.get("rate")) if isinstance(sched, dict) and sched.get("rate") is not None else 0.05
    except (TypeError, ValueError):
        rate = 0.05
    if rate < 0:
        rate = 0.05
    return rate


# --------------------------------------------------------------- epl_inputs.py


def parse_csv(text):  # epl_inputs.py, lines 43-59
    """Date, kickoff, clubs and full-time goals. Every other column is ignored."""
    rows = []
    for row in csv.DictReader(io.StringIO(text.lstrip("\ufeff"))):
        try:
            hg = int(row["FTHG"])
            ag = int(row["FTAG"])
            stamp = datetime.strptime(row["Date"].strip() + " " + row["Time"].strip(), "%d/%m/%Y %H:%M")
        except (KeyError, TypeError, ValueError):
            continue
        kick = stamp.replace(tzinfo=LONDON).timestamp()
        home, away = row["HomeTeam"].strip(), row["AwayTeam"].strip()
        if not home or not away:
            continue
        rows.append({"kick": kick, "home": home, "away": away, "hg": hg, "ag": ag})
    rows.sort(key=lambda s: (s["kick"], s["home"], s["away"]))
    return rows


# ---------------------------------------------------------------- epl_score.py

# epl_score.py, lines 21-64: the Premier League names. DRAW-X does not use them; they are
# here because DRAWBASE's own self-check (below) checks them before it prints its pin.
NAMES = {
    "Arsenal": "Arsenal",
    "Arsenal FC": "Arsenal",
    "Aston Villa": "Aston Villa",
    "Aston Villa FC": "Aston Villa",
    "Bournemouth": "Bournemouth",
    "AFC Bournemouth": "Bournemouth",
    "Brentford": "Brentford",
    "Brentford FC": "Brentford",
    "Brighton": "Brighton",
    "Brighton & Hove Albion FC": "Brighton",
    "Burnley": "Burnley",
    "Burnley FC": "Burnley",
    "Chelsea": "Chelsea",
    "Chelsea FC": "Chelsea",
    "Crystal Palace": "Crystal Palace",
    "Crystal Palace FC": "Crystal Palace",
    "Everton": "Everton",
    "Everton FC": "Everton",
    "Fulham": "Fulham",
    "Fulham FC": "Fulham",
    "Leeds United": "Leeds",
    "Leeds United FC": "Leeds",
    "Liverpool": "Liverpool",
    "Liverpool FC": "Liverpool",
    "Manchester City": "Man City",
    "Manchester City FC": "Man City",
    "Manchester United": "Man United",
    "Manchester United FC": "Man United",
    "Newcastle": "Newcastle",
    "Newcastle United FC": "Newcastle",
    "Nottingham Forest": "Nott'm Forest",
    "Nottingham Forest FC": "Nott'm Forest",
    "Sunderland AFC": "Sunderland",
    "Tottenham": "Tottenham",
    "Tottenham Hotspur FC": "Tottenham",
    "West Ham": "West Ham",
    "West Ham United FC": "West Ham",
    "Wolves": "Wolves",
    "Wolverhampton Wanderers FC": "Wolves",
    "Coventry City FC": "Coventry",
    "Hull City AFC": "Hull",
    "Ipswich Town FC": "Ipswich",
}


def canonical(name):  # epl_score.py, lines 67-70
    if name is None:
        return None
    return NAMES.get(str(name).strip())


def assert_names():  # epl_score.py, lines 73-96
    """Every full-time title seen on series 10188 maps, and the two spellings agree."""
    pairs = (
        ("Liverpool", "Liverpool FC", "Liverpool"),
        ("Bournemouth", "AFC Bournemouth", "Bournemouth"),
        ("Manchester City", "Manchester City FC", "Man City"),
        ("Manchester United", "Manchester United FC", "Man United"),
        ("Nottingham Forest", "Nottingham Forest FC", "Nott'm Forest"),
        ("Leeds United", "Leeds United FC", "Leeds"),
        ("Newcastle", "Newcastle United FC", "Newcastle"),
        ("Tottenham", "Tottenham Hotspur FC", "Tottenham"),
        ("West Ham", "West Ham United FC", "West Ham"),
        ("Wolves", "Wolverhampton Wanderers FC", "Wolves"),
        ("Brighton", "Brighton & Hove Albion FC", "Brighton"),
        ("Sunderland AFC", "Sunderland AFC", "Sunderland"),
        ("Coventry City FC", "Coventry City FC", "Coventry"),
        ("Hull City AFC", "Hull City AFC", "Hull"),
        ("Ipswich Town FC", "Ipswich Town FC", "Ipswich"),
    )
    for short, long, canon in pairs:
        if canonical(short) != canon or canonical(long) != canon:
            raise SystemExit("name map %s %s" % (short, long))
    if canonical("Leicester") is not None or canonical(None) is not None:
        raise SystemExit("an unknown title was mapped")


def cutoff(kick):  # epl_score.py, lines 99-100
    return float(kick) - KNOW - LEAD


def rows_of(scores):  # epl_score.py, lines 103-104
    return sorted(scores or [], key=lambda s: (float(s["kick"]), s["home"], s["away"]))


def priors(scores, kick):  # epl_score.py, lines 107-109
    limit = cutoff(kick)
    return [s for s in rows_of(scores) if float(s["kick"]) <= limit]


def result_of(s):  # epl_score.py, lines 112-117
    if int(s["hg"]) > int(s["ag"]):
        return "H"
    if int(s["hg"]) < int(s["ag"]):
        return "A"
    return "D"


def teams(ev):  # epl_score.py, lines 145-149
    home, away = ev.get("home"), ev.get("away")
    if not home or not away or home == away or ev.get("end") is None:
        return None, None, None
    return home, away, float(ev["end"])


def best_side(ev, fairs):  # epl_score.py, lines 152-172
    """The side with the largest positive edge at the shown price plus one tick.

    An equal edge keeps H, then D, then A. A side with no shown price is not a candidate.
    """
    best = None
    for i, side in enumerate(("H", "D", "A")):
        fair = None if fairs is None else fairs.get(side)
        market = (ev.get("markets") or {}).get(side)
        if fair is None or not market or market.get("shown") is None:
            continue
        px = float(market["shown"]) + float(market["tick"])
        gap = edge(float(fair), px, float(market["rate"]))
        if gap <= 0:
            continue
        key = (-gap, i)
        if best is None or key < best[0]:
            best = (key, side, float(fair))
    if best is None:
        return None
    return best[1], best[2]


def only_side(ev, side, fair):  # epl_score.py, lines 175-178
    if side is None or fair is None:
        return None
    return best_side(ev, {side: fair})


def draw_quote(ev, scores, minimum):  # epl_score.py, lines 467-476
    """The league's draw rate so far. One draw market, not a club's rate."""
    _home, _away, kick = teams(ev)
    if _home is None:
        return None
    rows = priors(scores, kick)
    if len(rows) < minimum:
        return None
    fair = sum(1 for s in rows if result_of(s) == "D") / float(len(rows))
    return only_side(ev, "D", fair)


# ----------------------------------------------------------------- epl_hold.py


def trades_from(events, scores, choose):  # epl_hold.py, lines 13-60
    counts = defaultdict(int)
    incomplete = 0
    out = []
    for ev in events or []:
        end = ev.get("end")
        if end is None or window_of(float(end)) is None:
            counts["outside_window"] += 1
            continue
        counts["events"] += 1
        chosen = choose(ev, scores)
        stored = ev.get("picked")
        stored_side = None if not stored else stored.get("side")
        picked_side = None if chosen is None else chosen[0]
        if stored_side != picked_side:
            raise SystemExit(
                "picked side mismatch on %s: rule %s, pull %s" % (ev.get("slug"), picked_side, stored_side)
            )
        if chosen is None:
            counts["no_trade"] += 1
            continue
        side, fair = chosen
        market = (ev.get("markets") or {}).get(side)
        if market is None or stored.get("condition") != market.get("condition"):
            raise SystemExit("picked condition mismatch on %s" % ev.get("slug"))
        if stored.get("prints") == "incomplete":
            incomplete += 1
            counts["prints_incomplete"] += 1
            continue
        fills = walk_buys(
            stored.get("prints") or [], float(market["shown"]), float(market["tick"]), float(market["rate"]), fair,
        )
        if not fills:
            counts["under_min_fill"] += 1
            continue
        bought = sum(qty for _, _, qty in fills)
        closed = float(market.get("closed") or ev.get("closed") or end)
        counts["filled"] += 1
        out.append({
            "slug": ev["slug"], "series": ev.get("series"), "side": side,
            "fair": fair, "shown": float(market["shown"]),
            "fills": fills, "sells": [], "unsold": bought,
            "first": fills[0][0], "payout": float(market["payout_yes"]), "end": float(end),
            "closed": closed, "rate": float(market["rate"]), "tick": float(market["tick"]),
            "release": closed,
        })
    out.sort(key=lambda c: (c["first"], c["slug"]))
    return out, dict(counts), incomplete


def finish(data, choose, rule, prereg):  # epl_hold.py, lines 63-67
    trades, counts, incomplete = trades_from(data.get("events"), data.get("scores"), choose)
    out = evaluate(trades, incomplete)
    out["counts"] = counts
    return {"rule": rule, "prereg": prereg, "result": out}


def market(side, shown, payout=0.0, rate=0.05, tick=0.001, end=None):  # epl_hold.py, lines 70-74
    return {
        "condition": "cond-%s" % side, "shown": shown, "tick": tick, "rate": rate,
        "payout_yes": payout, "closed": end,
    }


def pack(slug, end, home, away, markets, side, prints):  # epl_hold.py, lines 77-84
    picked = None
    if side is not None:
        picked = {"side": side, "condition": markets[side]["condition"], "prints": prints}
    return {
        "slug": slug, "series": 10188, "end": end, "closed": end + 3 * 3600,
        "home": home, "away": away, "markets": markets, "picked": picked,
    }


def hand_pnl(shown, tick, rate, payout, print_px=0.10, size=100.0):  # epl_hold.py, lines 87-92
    """One taker buy, floored one tick through the shown price, held to settlement."""
    px = max(print_px, shown + tick)
    sh = STAKE / px
    fee = rate * px * (1.0 - px)
    return sh * (payout - px) - fee * sh, px


def assert_book(choose, scores, ev, side, fair):  # epl_hold.py, lines 95-110
    trades, counts, incomplete = trades_from([ev], scores, choose)
    if incomplete or len(trades) != 1 or trades[0]["side"] != side:
        raise SystemExit("book %s %s" % (counts, trades))
    if abs(trades[0]["fair"] - fair) > 1e-9:
        raise SystemExit("fair %s != %s" % (trades[0]["fair"], fair))
    shown = float(ev["markets"][side]["shown"])
    tick = float(ev["markets"][side]["tick"])
    rate = float(ev["markets"][side]["rate"])
    payout = float(ev["markets"][side]["payout_yes"])
    hand, px = hand_pnl(shown, tick, rate, payout)
    if abs(trades[0]["fills"][0][1] - px) > 1e-12:
        raise SystemExit("fill %s != %s" % (trades[0]["fills"][0][1], px))
    if abs(pnl_of(trades[0]) - hand) > 1e-6:
        raise SystemExit("pnl %s != %s" % (pnl_of(trades[0]), hand))
    return trades[0], hand


def day0():  # epl_hold.py, lines 113-114
    return datetime(2025, 9, 1, 15, 0, tzinfo=timezone.utc).timestamp()


def played(day, home, away, hg, ag, origin=None):  # epl_hold.py, lines 117-119
    origin = day0() if origin is None else origin
    return {"kick": origin + day * 86400.0, "home": home, "away": away, "hg": hg, "ag": ag}


def prints_for(end):  # epl_hold.py, lines 131-133
    td = float(end) - 3600.0
    return [[td + 10, "BUY", 0, 0.10, 100.0]]


# ---------------------------------------------------------------- draw_test.py


def choose(ev, scores):  # draw_test.py, lines 20-21
    return draw_quote(ev, scores, minimum=8)


def run(data):  # draw_test.py, lines 24-25
    return finish(data, choose, RULE, PREREG)


def self_check():  # draw_test.py, lines 28-46
    assert_names()
    scores = [played(i, "A%d" % i, "B%d" % i, 1, 0) for i in range(6)]
    scores.append(played(6, "C", "D", 1, 1))
    scores.append(played(7, "E", "F", 0, 0))
    end = day0() + 20 * 86400.0
    board = {
        "H": market("H", 0.80, payout=0.0, end=end),
        "D": market("D", 0.10, payout=1.0, end=end),
        "A": market("A", 0.80, payout=0.0, end=end),
    }
    ev = pack("draw-yes", end, "HOT", "COLD", board, "D", prints_for(end))
    _trade, hand = assert_book(choose, scores, ev, "D", 0.25)
    rich = dict(board)
    rich["D"] = market("D", 0.50, payout=1.0, end=end)
    no = pack("draw-no", end, "HOT", "COLD", rich, None, None)
    if choose(no, scores) is not None:
        raise SystemExit("a rich draw was bought")
    print("self-check ok", "D", round(0.25, 6), round(hand, 6))
