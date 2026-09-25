"""Eight UK-book price-edge screens. Hashed at 2026-09-25 14:11:21 UTC.

Two edges. One buys both books when the open you pay is cheap versus a named
fair value. The other buys only the cheap book of a named spread. Spot is not
shorted. The fill is that printed UK open to the next UK open.

    python3 docs/agents/scripts/fp5/screen_pass68.py
    python3 docs/agents/scripts/fp5/screen_pass68.py --check
"""
import hashlib, importlib.util, json, os, random, sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass62/revx")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass68.json")
FROZEN = "2026-09-25 14:11:21 UTC"
STEP = 4 * 3600 * 1000
ORDER = ("rxmean", "rxsess", "rxunder", "rxtrade", "rxout", "rxsign", "rxgap", "rxfar")
PAY = ("rxmean", "rxsess", "rxunder", "rxtrade")
SHA = {
    "rxmean": "5638e6387ac0e487d0c4c445fdf449517cf8217984e0047b46245f79c7b8c121",
    "rxsess": "0f388ca4989f1b34ccb549f4d0d50a4d53f6f7b62becfa9ea162104cb52a074b",
    "rxunder": "b39dae5f0cf7f7e052d0e2df3511a9f5cc57cdd4e97327febf0c5ae114e6f666",
    "rxtrade": "36cabc3dcc589e78a5fe733db61bfbf2820c42069672c6580412f598d2c717a2",
    "rxout": "8053fa780038dbbedf1e5c7c654fcd87e326c706507f82a18201bcd19114160d",
    "rxsign": "25bf8d5be6634a3f34fdb306d0a9735c7e47b7d0f60726242f13d96ce4caacc1",
    "rxgap": "72ea45c97faede63bd440b0398877cd4973c1bc0756421fbd7bb067e5e9a2f82",
    "rxfar": "a45b1c910ee44658aa034d28ae1300d2a6c599e104abda8cc55f12d1d409f774",
}
COUNTED = {
    "rxmean": 955,
    "rxsess": 792,
    "rxunder": 130,
    "rxtrade": 173,
    "rxout": 915,
    "rxsign": 364,
    "rxgap": 221,
    "rxfar": 1482,
}
CHEAP = {
    "rxout": {"btc": 415, "eth": 500},
    "rxsign": {"btc": 184, "eth": 180},
    "rxgap": {"btc": 100, "eth": 121},
    "rxfar": {"btc": 671, "eth": 811},
}
WINDOWS = {
    "rxmean": 2255,
    "rxsess": 1879,
    "rxunder": 375,
    "rxtrade": 2260,
    "rxout": 2255,
    "rxsign": 2260,
    "rxgap": 2260,
    "rxfar": 2243,
}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def require_rules():
    found = {}
    for name in ORDER:
        have = sha256_file(os.path.join(RULES, name + "_rule.txt"))
        if have != SHA[name]:
            raise SystemExit("rule text moved after the freeze: %s %s" % (name, have))
        with open(os.path.join(RULES, name + "_rule.frozen_at")) as f:
            stamp = f.read().strip()
        if stamp != FROZEN:
            raise SystemExit("freeze moved: %s %s" % (name, stamp))
        found[name] = have
    return found


def load_book(symbol):
    path = os.path.join(INP, symbol + "_240.json")
    with open(path) as f:
        doc = json.load(f)
    if doc.get("region") != "UK" or doc.get("interval") != 240 or doc.get("symbol") != symbol:
        raise SystemExit("not the UK book %s" % symbol)
    for call in doc["calls"]:
        url = call["url"]
        if "region=UK" not in url or "region=EEA" in url or call["status"] != 200:
            raise SystemExit("call is not UK %s" % url)
        if symbol not in url:
            raise SystemExit("call is another pair %s" % url)
    rows = []
    seen = set()
    for row in doc["rows"]:
        start = int(row["start"])
        if start in seen:
            raise SystemExit("duplicate start %s" % start)
        seen.add(start)
        vol = float(row["volume"])
        opened = float(row["open"])
        high = float(row["high"])
        low = float(row["low"])
        closed = float(row["close"])
        if vol <= 0 or min(opened, high, low, closed) <= 0:
            raise SystemExit("bar is not a trade %s %s" % (symbol, start))
        if high < max(opened, closed) or low > min(opened, closed) or high < low:
            raise SystemExit("bar extremes %s %s" % (symbol, start))
        rows.append((start, opened, high, low, closed, vol))
    if len(rows) != 2262:
        raise SystemExit("bar count %s %d" % (symbol, len(rows)))
    for i in range(1, len(rows)):
        if rows[i][0] - rows[i - 1][0] != STEP:
            raise SystemExit("gap %s %d" % (symbol, i))
    return rows


def stamp(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc)


def median(xs):
    ys = sorted(xs)
    mid = len(ys) // 2
    if len(ys) % 2:
        return ys[mid]
    return (ys[mid - 1] + ys[mid]) / 2.0


def mean6(book, i):
    return sum(book[i - 6 + k][1] for k in range(6)) / 6.0


def ratio_at(btc, eth, i):
    return btc[i][1] / eth[i][1]


def eligible_for(name, n):
    if name in ("rxmean", "rxout"):
        return list(range(6, n - 1))
    if name == "rxsess":
        return [i for i in range(6, n - 1) if i % 6 != 0]
    if name == "rxunder":
        return [i for i in range(12, n - 1) if i % 6 == 0]
    if name in ("rxtrade", "rxsign", "rxgap"):
        return list(range(1, n - 1))
    if name == "rxfar":
        return list(range(18, n - 1))
    raise SystemExit("unknown rule %s" % name)


def decision(name, btc, eth, i):
    if name == "rxmean":
        if btc[i][1] < mean6(btc, i) and eth[i][1] < mean6(eth, i):
            return "both"
        return None
    if name == "rxsess":
        day = i - (i % 6)
        if btc[i][1] < btc[day][1] and eth[i][1] < eth[day][1]:
            return "both"
        return None
    if name == "rxunder":
        cheap_btc = btc[i][1] < btc[i - 6][1] and btc[i][1] < btc[i - 12][1]
        cheap_eth = eth[i][1] < eth[i - 6][1] and eth[i][1] < eth[i - 12][1]
        if cheap_btc and cheap_eth:
            return "both"
        return None
    if name == "rxtrade":
        if btc[i][1] < btc[i - 1][4] and eth[i][1] < eth[i - 1][4]:
            return "both"
        return None
    if name == "rxout":
        ratios = [ratio_at(btc, eth, i - k) for k in range(1, 7)]
        now = ratio_at(btc, eth, i)
        if now < min(ratios):
            return "btc"
        if now > max(ratios):
            return "eth"
        return None
    if name == "rxsign":
        btc_down = btc[i][1] < btc[i - 1][1]
        eth_down = eth[i][1] < eth[i - 1][1]
        btc_up = btc[i][1] > btc[i - 1][1]
        eth_up = eth[i][1] > eth[i - 1][1]
        if btc_down and eth_up:
            return "btc"
        if eth_down and btc_up:
            return "eth"
        return None
    if name == "rxgap":
        btc_cheap = btc[i][1] < btc[i - 1][4]
        eth_cheap = eth[i][1] < eth[i - 1][4]
        btc_rich = btc[i][1] > btc[i - 1][4]
        eth_rich = eth[i][1] > eth[i - 1][4]
        if btc_cheap and eth_rich:
            return "btc"
        if eth_cheap and btc_rich:
            return "eth"
        return None
    if name == "rxfar":
        ratios = [ratio_at(btc, eth, i - k) for k in range(1, 19)]
        center = median(ratios)
        deviations = sorted(abs(item / center - 1.0) for item in ratios)
        typical = (deviations[8] + deviations[9]) / 2.0
        now = ratio_at(btc, eth, i)
        if not abs(now / center - 1.0) > typical:
            return None
        if now < center:
            return "btc"
        if now > center:
            return "eth"
        return None
    raise SystemExit("unknown rule %s" % name)


def signals_for(name, btc, eth):
    out = []
    for i in eligible_for(name, len(btc)):
        side = decision(name, btc, eth, i)
        if side:
            out.append((i, side))
    return out


def prior_sets():
    scored = []
    names = (
        "screen_pass62",
        "screen_pass63",
        "screen_pass64",
        "screen_pass65",
        "screen_pass66",
        "screen_pass67",
    )
    for mod_name in names:
        spec = importlib.util.spec_from_file_location(mod_name, os.path.join(RULES, mod_name + ".py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        btc = mod.load_book("BTC-USD")
        eth = mod.load_book("ETH-USD")
        for name in mod.SHA:
            got = mod.signals_for(name, btc, eth)
            scored.append(got)
            scored.append([i + 1 for i in got])
    if len(scored) != 96:
        raise SystemExit("prior rules %d" % len(scored))
    return scored


def refuse_not_rules(btc, eth):
    """All-bar ratio gaps and the empty whole-bar comparison stay unwritten."""
    whole = whole_swap = 0
    for i in range(2, len(btc) - 2):
        if btc[i][3] > btc[i - 1][4] and eth[i][2] < eth[i - 1][4]:
            whole += 1
        if eth[i][3] > eth[i - 1][4] and btc[i][2] < btc[i - 1][4]:
            whole_swap += 1
    if whole or whole_swap:
        raise SystemExit("a zero-day comparison is not a rule")
    hour = session = 0
    session_n = 0
    for i in range(6, len(btc) - 1):
        if ratio_at(btc, eth, i) != ratio_at(btc, eth, i - 6):
            hour += 1
        if i % 6 != 0:
            session_n += 1
            day = i - (i % 6)
            if ratio_at(btc, eth, i) != ratio_at(btc, eth, day):
                session += 1
    if hour != 2255 or session != 1879 or session_n != 1879:
        raise SystemExit("an all-bar ratio is not a rule %d %d" % (hour, session))


def move_bps(book, i):
    return (book[i + 1][1] / book[i][1] - 1.0) * 10000.0


def score(pairs, btc, eth, cost):
    btc_pnl = 0.0
    eth_pnl = 0.0
    months = {}
    charge = cost + cost
    for i, side in pairs:
        btc_move = move_bps(btc, i)
        eth_move = move_bps(eth, i)
        if side == "both":
            btc_pnl += btc_move - charge
            eth_pnl += eth_move - charge
            inc = (btc_move - charge + eth_move - charge) / 2.0
        elif side == "btc":
            btc_pnl += btc_move - charge
            inc = (btc_move - charge) / 2.0
        elif side == "eth":
            eth_pnl += eth_move - charge
            inc = (eth_move - charge) / 2.0
        else:
            raise SystemExit("side %s" % side)
        month = stamp(btc[i][0]).strftime("%Y-%m")
        months[month] = months.get(month, 0.0) + inc
    return {
        "pool": (btc_pnl + eth_pnl) / 2.0,
        "btc": btc_pnl,
        "eth": eth_pnl,
        "trips": len(pairs),
        "months": months,
    }


def hand_sum(pairs, btc, eth):
    """Recompute the pool from raw opens. Does not call score."""
    pool = 0.0
    for i, side in pairs:
        btc_bps = move_bps(btc, i) - 40.0
        eth_bps = move_bps(eth, i) - 40.0
        if side == "both":
            pool += (btc_bps + eth_bps) / 2.0
        elif side == "btc":
            pool += btc_bps / 2.0
        elif side == "eth":
            pool += eth_bps / 2.0
        else:
            raise SystemExit("side %s" % side)
    return pool, len(pairs)


def null_long(eligible, n_trips, btc, eth, cost):
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    rng = random.Random(20260925)
    pools = []
    charge = cost + cost
    for _ in range(500):
        chosen = rng.sample(eligible, n_trips)
        pool = 0.0
        for i in chosen:
            btc_move = move_bps(btc, i)
            eth_move = move_bps(eth, i)
            pool += (btc_move - charge + eth_move - charge) / 2.0
        pools.append(pool)
    pools.sort()
    return (pools[249] + pools[250]) / 2.0, pools[474]


def month_share(scored):
    if scored["pool"] <= 0:
        return None, None, None
    month, pnl = max(scored["months"].items(), key=lambda kv: kv[1])
    return pnl / scored["pool"], month, pnl


def make_book(opens, closes=None):
    rows = []
    for i, opened in enumerate(opens):
        closed = float(opened if closes is None else closes[i])
        opened = float(opened)
        rows.append((i * STEP, opened, max(opened, closed), min(opened, closed), closed, 1.0))
    return rows


def self_check():
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    btc = make_book([10, 10, 10, 10, 10, 10, 9, 11])
    eth = make_book([10, 10, 10, 10, 10, 10, 8, 7])
    if signals_for("rxmean", btc, eth) != [(6, "both")]:
        raise SystemExit("rxmean fixture")
    if signals_for("rxmean", make_book([10] * 8), eth):
        raise SystemExit("an equal average is not cheap")
    sb = make_book([1, 1, 1, 1, 1, 1, 20, 15, 16])
    se = make_book([1, 1, 1, 1, 1, 1, 10, 9, 8])
    if signals_for("rxsess", sb, se) != [(7, "both")]:
        raise SystemExit("rxsess fixture")
    if signals_for("rxsess", sb, make_book([1, 1, 1, 1, 1, 1, 10, 10, 8])):
        raise SystemExit("an equal session open is not cheap")
    ob = [1] * 14
    oe = [1] * 14
    ob[0], ob[6], ob[12], ob[13] = 10, 12, 9, 11
    oe[0], oe[6], oe[12], oe[13] = 10, 11, 8, 7
    if signals_for("rxunder", make_book(ob), make_book(oe)) != [(12, "both")]:
        raise SystemExit("rxunder fixture")
    ob[12] = 13
    if signals_for("rxunder", make_book(ob), make_book(oe)):
        raise SystemExit("a 00:00 open above a prior session open is not cheap")
    tb = make_book([10, 9, 11], [12, 9, 11])
    te = make_book([10, 8, 7], [14, 8, 7])
    if signals_for("rxtrade", tb, te) != [(1, "both")]:
        raise SystemExit("rxtrade fixture")
    if signals_for("rxtrade", tb, make_book([10, 14, 7], [14, 14, 7])):
        raise SystemExit("an open equal to the last trade is not cheap")
    xb = make_book([20] * 6 + [10, 12])
    xe = make_book([10] * 6 + [10, 9])
    if signals_for("rxout", xb, xe) != [(6, "btc")]:
        raise SystemExit("rxout fixture")
    if signals_for("rxout", make_book([20] * 8), make_book([10] * 8)):
        raise SystemExit("a ratio on the boundary is not outside")
    yb = make_book([20] * 6 + [40, 12])
    if signals_for("rxout", yb, xe) != [(6, "eth")]:
        raise SystemExit("rxout eth fixture")
    if signals_for("rxsign", make_book([10, 9, 11]), make_book([10, 11, 9])) != [(1, "btc")]:
        raise SystemExit("rxsign fixture")
    if signals_for("rxsign", make_book([10, 9, 11]), make_book([10, 8, 9])):
        raise SystemExit("two cheapened opens are not this spread")
    gb = make_book([10, 9, 11], [12, 9, 11])
    ge = make_book([10, 11, 9], [8, 11, 9])
    if signals_for("rxgap", gb, ge) != [(1, "btc")]:
        raise SystemExit("rxgap fixture")
    if signals_for("rxgap", gb, make_book([10, 7, 9], [8, 7, 9])):
        raise SystemExit("two cheap gaps are not this spread")
    fb = make_book([20] * 18 + [10, 12])
    fe = make_book([10] * 18 + [10, 9])
    if signals_for("rxfar", fb, fe) != [(18, "btc")]:
        raise SystemExit("rxfar fixture")
    if signals_for("rxfar", make_book([20] * 20), make_book([10] * 20)):
        raise SystemExit("a ratio on the median is not a spread")
    one_book = make_book([100, 110])
    one_eth = make_book([10, 9])
    both = score([(0, "both")], one_book, one_eth, 20.0)
    btc_hand = (110.0 / 100.0 - 1.0) * 10000.0 - 40.0
    eth_hand = (9.0 / 10.0 - 1.0) * 10000.0 - 40.0
    if both["trips"] != 1 or abs(both["pool"] - (btc_hand + eth_hand) / 2.0) > 1e-9:
        raise SystemExit("one uk trip")
    lone = score([(0, "btc")], one_book, one_eth, 20.0)
    if abs(lone["pool"] - btc_hand / 2.0) > 1e-9 or lone["eth"] != 0.0:
        raise SystemExit("a flat book is not a fill")
    hand, n_hand = hand_sum([(0, "both")], one_book, one_eth)
    if n_hand != 1 or abs(hand - both["pool"]) > 1e-9:
        raise SystemExit("hand sum")
    stress = score([(0, "both")], one_book, one_eth, 40.0)
    if abs((both["pool"] - stress["pool"]) - 40.0) > 1e-9:
        raise SystemExit("both-book cost gap")
    stress_one = score([(0, "btc")], one_book, one_eth, 40.0)
    if abs((lone["pool"] - stress_one["pool"]) - 20.0) > 1e-9:
        raise SystemExit("one-book cost gap")
    try:
        decision("nope", btc, eth, 6)
    except SystemExit as exc:
        if "unknown rule" not in str(exc):
            raise
    else:
        raise SystemExit("unknown rule slipped through")


def main():
    self_check()
    check = "--check" in sys.argv
    found = require_rules()
    btc = load_book("BTC-USD")
    eth = load_book("ETH-USD")
    if [item[0] for item in btc] != [item[0] for item in eth]:
        raise SystemExit("books are not aligned")
    if stamp(btc[0][0]) != datetime(2025, 9, 11, tzinfo=timezone.utc):
        raise SystemExit("first bar")
    if stamp(btc[-1][0]) != datetime(2026, 9, 22, 20, tzinfo=timezone.utc):
        raise SystemExit("last bar")
    refuse_not_rules(btc, eth)
    windows = {}
    for name in ORDER:
        window = eligible_for(name, len(btc))
        if len(window) != WINDOWS[name]:
            raise SystemExit("window moved %s %d" % (name, len(window)))
        windows[name] = window
    if stamp(btc[6][0]) != datetime(2025, 9, 12, tzinfo=timezone.utc):
        raise SystemExit("first mean bar")
    if stamp(btc[7][0]) != datetime(2025, 9, 12, 4, tzinfo=timezone.utc):
        raise SystemExit("first later bar")
    if stamp(btc[12][0]) != datetime(2025, 9, 13, tzinfo=timezone.utc):
        raise SystemExit("first two-session bar")
    scored = prior_sets()
    entries = {}
    for name in ORDER:
        got = signals_for(name, btc, eth)
        if len(got) != COUNTED[name]:
            raise SystemExit("count moved before scoring %s %d" % (name, len(got)))
        if len(got) == 0 or len(got) == len(windows[name]):
            raise SystemExit("not interior %s" % name)
        idx = [i for i, _side in got]
        if idx != sorted(idx):
            raise SystemExit("entries are not in order %s" % name)
        if name in PAY:
            if any(side != "both" for _i, side in got):
                raise SystemExit("a pay rule skipped a book %s" % name)
        else:
            sides = {"btc": 0, "eth": 0}
            for _i, side in got:
                if side not in sides:
                    raise SystemExit("spread side %s %s" % (name, side))
                sides[side] += 1
            if sides != CHEAP[name]:
                raise SystemExit("cheap side moved %s %s" % (name, sides))
        entries[name] = got
    fresh = [[i for i, _side in entries[name]] for name in ORDER]
    for i, left in enumerate(fresh):
        for right in fresh[i + 1 :]:
            if left == right:
                raise SystemExit("two rules are the same bars")
        for old in scored:
            if left == old:
                raise SystemExit("a rule repeats bars already scored")
    kills = {}
    lines = []
    for name in ORDER:
        base = score(entries[name], btc, eth, 20.0)
        stress = score(entries[name], btc, eth, 40.0)
        expect = 40.0 * base["trips"] if name in PAY else 20.0 * base["trips"]
        if abs((base["pool"] - stress["pool"]) - expect) > 1e-4:
            raise SystemExit("cost gap %s %.6f %.1f" % (name, base["pool"] - stress["pool"], expect))
        p50, p95 = null_long(windows[name], base["trips"], btc, eth, 20.0)
        share, month, month_pnl = month_share(base)
        reasons = []
        if not base["pool"] > 0:
            reasons.append("pooled P&L is not positive")
        if not stress["pool"] > 0:
            reasons.append("doubled cost is not positive")
        if base["trips"] < 60:
            reasons.append("fewer than 60 round trips")
        if not (base["btc"] > 0 and base["eth"] > 0):
            reasons.append("one book is not positive")
        if not base["pool"] > p95:
            reasons.append("does not beat the random long-both null")
        if share is not None and share > 0.40:
            reasons.append("one month is more than 40% of P&L")
        if not base["pool"] > 400:
            reasons.append("pooled P&L does not exceed 400 bps")
        clear = len(reasons) == 0
        row_out = {
            "name": name + "_2025",
            "edge": "pay_below_fair_value" if name in PAY else "named_spread_long_cheap",
            "fill": "uk_4h_printed_open_to_next_open",
            "pool_bps": round(base["pool"], 1),
            "stress_bps": round(stress["pool"], 1),
            "trips": base["trips"],
            "long_days": base["trips"],
            "execution_bars": len(windows[name]),
            "signals_without_open": 0,
            "btc_bps": round(base["btc"], 1),
            "eth_bps": round(base["eth"], 1),
            "null_p50_bps": round(p50, 1),
            "null_p95_bps": round(p95, 1),
            "month_share": None if share is None else round(share, 3),
            "top_month": month,
            "top_month_bps": None if month_pnl is None else round(month_pnl, 1),
            "candle_bar_clear": clear,
            "why": (
                "UK open numeric bar is clear; not a testing row and not paper testing"
                if clear
                else "; ".join(reasons)
            ),
        }
        hand, n_hand = hand_sum(entries[name], btc, eth)
        if n_hand != row_out["trips"] or abs(hand - base["pool"]) > 0.1 or abs(hand - row_out["pool_bps"]) > 0.1:
            raise SystemExit("hand sum mismatch %s" % name)
        print(
            "COST %s trips %d gap %.1f expected %.1f share %s"
            % (name, row_out["trips"], row_out["pool_bps"] - row_out["stress_bps"], expect, row_out["month_share"]),
            flush=True,
        )
        i0, side0 = entries[name][0]
        btc_move = move_bps(btc, i0)
        print(
            "FIRST %s %s entry %s exit %s BTC %.2f -> %.2f ETH %.2f -> %.2f btc %+.2f"
            % (
                name,
                side0,
                stamp(btc[i0][0]).strftime("%Y-%m-%d %H:%M"),
                stamp(btc[i0 + 1][0]).strftime("%Y-%m-%d %H:%M"),
                btc[i0][1],
                btc[i0 + 1][1],
                eth[i0][1],
                eth[i0 + 1][1],
                btc_move,
            ),
            flush=True,
        )
        print(
            "BOOK %s pool %.6f stress %.6f btc %.6f eth %.6f p95 %.6f"
            % (name, base["pool"], stress["pool"], base["btc"], base["eth"], p95),
            flush=True,
        )
        if share is not None:
            print(
                "UNROUNDED %s share %.6f month %s pnl %.6f pool %.6f"
                % (name, share, month, month_pnl, base["pool"]),
                flush=True,
            )
        kills[name + "_2025"] = row_out
        lines.append(
            "%s is %.1f bps over %d trips"
            % (name, row_out["pool_bps"], row_out["trips"])
        )
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 14:11:21 UTC, before its own result. "
            "Every fill is a printed UK four-hour open to the next UK four-hour open. "
            "The books are BTC-USD and ETH-USD, region=UK, the same pull as pass 62. "
            "EEA candles are not read. No other pair is stood in. "
            "Two price edges are scored. Four rules buy both books when each open is cheap "
            "versus its own named fair value. Four rules buy only the cheap book of a named spread. "
            "Spot is not shorted. The rich book is not the control and is not scored. "
            "Buying every eligible bar is not reported. "
            "The null is 500 long-both draws from that rule's own window, seed 20260925, index 474. "
            "The high, the low, the wick, and the body are not the signal. Volume is not the signal. "
            "Which path is later or longer is not the signal. "
            "This is not a Binance daily open. "
            "Passes 62 through 67 are not rerun and their signs are not flipped. "
            "No rule here selects the same entry bars as one already scored. "
            "A ratio differing from six bars earlier is every one of 2,255 bars and is not a rule. "
            "A ratio differing from today's 00:00 ratio is every one of 1,879 later bars and is not a rule. "
            "Counts before any return were 955, 792, 130, 173, 915, 364, 221, and 1482. "
            "The 60-trip gate is not lowered to 130. "
            + " ".join(lines)
            + ". No testing row is opened. A numeric clear on these UK opens is still not paper testing, "
            "because no order of this account was shown crossing the book. "
            "The five earlier numeric clears and the confirmation-time fall after a higher day stay void."
        ),
        "rules": {name + "_rule_sha256": found[name] for name in ORDER},
        "kills": kills,
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass68.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
