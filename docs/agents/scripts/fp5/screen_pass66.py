"""Eight UK-book volume screens. Hashed at 2026-09-25 13:43:02 UTC.

The fill is the next Revolut X UK four-hour open, not a Binance daily open.
The signal is base volume. The high, the low, the wick, and the body are not.
Nothing here places an order or reads a key. Passes 62 through 65 are not rerun.

    python3 docs/agents/scripts/fp5/screen_pass66.py
    python3 docs/agents/scripts/fp5/screen_pass66.py --check
"""
import hashlib, importlib.util, json, os, random, sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass62/revx")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass66.json")
FROZEN = "2026-09-25 13:43:02 UTC"
STEP = 4 * 3600 * 1000
SHA = {
    "rxvup": "5f0ebd810d163c1a358ed757d67b17df92c89d399f79da221823f23bb10330b2",
    "rxvtwo": "4254bc51482e859449ef1377784fe610ddc2e997d898b681ec16f8a8d0a2ea76",
    "rxvboth": "ce6ce46ef741072d4e0a91aa756ef91d758dc0f0dd37d08472a2606d55fe8830",
    "rxvmix": "e8188a9a241ad8fa8394ee61e900b2dc51912956d666db3ccb4e56a7bed461fe",
    "rxvsum": "98d5723692200dcb1d5dab9dce2f192275dea7d6d9c002e87cba7f156f53684b",
    "rxvday": "5bb3f01a4f949f5894ca68507f4ad3a7c7383e6a69c42aa68a5f799717c74b4b",
    "rxvsmall": "5ab7c186d0b707e6528343c2ab307a47c45e98ebbac67677400e4715fed1f921",
    "rxvrev": "654df4ca507797e97c7fc037e0ea6982b931d1c461ece35c17d3241fde904255",
}
COUNTED = {
    "rxvup": 416,
    "rxvtwo": 25,
    "rxvboth": 139,
    "rxvmix": 412,
    "rxvsum": 154,
    "rxvday": 431,
    "rxvsmall": 359,
    "rxvrev": 130,
}
BACKUP = {
    "rxvup": 422,
    "rxvtwo": 38,
    "rxvboth": 132,
    "rxvmix": 456,
    "rxvsum": 145,
    "rxvday": 382,
    "rxvsmall": 336,
    "rxvrev": 136,
}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def require_rules():
    found = {}
    for name, digest in SHA.items():
        have = sha256_file(os.path.join(RULES, name + "_rule.txt"))
        if have != digest:
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


def vol(book, i):
    return book[i][5]


def inside(v, a, b):
    if a == b:
        return False
    lo, hi = (a, b) if a < b else (b, a)
    return lo < v < hi


def outside(v, a, b):
    if a == b:
        return False
    lo, hi = (a, b) if a < b else (b, a)
    return v > hi or v < lo


def take(name, btc, eth, i):
    b0, b1, b2 = vol(btc, i), vol(btc, i - 1), vol(btc, i - 2)
    e0, e1, e2 = vol(eth, i), vol(eth, i - 1), vol(eth, i - 2)
    if name == "rxvup":
        return b0 > b1 and e0 < e1
    if name == "rxvtwo":
        return b0 > b1 > b2 and e0 < e1 < e2
    if name == "rxvboth":
        return b0 > b1 and b0 > b2 and e0 < e1 and e0 < e2
    if name == "rxvmix":
        return inside(b0, b1, b2) and outside(e0, e1, e2)
    if name == "rxvsum":
        return b0 > b1 + b2 and 2 * e0 < e1 + e2
    if name == "rxvday":
        return b0 > vol(btc, i - 6) and e0 < vol(eth, i - 6)
    if name == "rxvsmall":
        return b0 > b1 and e0 > e1 and (b0 - b1) * e1 < (e0 - e1) * b1
    if name == "rxvrev":
        return b0 > b1 and b1 < b2 and e0 < e1 and e1 > e2
    raise SystemExit("unknown rule %s" % name)


def backup(name, btc, eth, i):
    b0, b1, b2 = vol(btc, i), vol(btc, i - 1), vol(btc, i - 2)
    e0, e1, e2 = vol(eth, i), vol(eth, i - 1), vol(eth, i - 2)
    if name == "rxvup":
        return b0 < b1 and e0 > e1
    if name == "rxvtwo":
        return e0 > e1 > e2 and b0 < b1 < b2
    if name == "rxvboth":
        return e0 > e1 and e0 > e2 and b0 < b1 and b0 < b2
    if name == "rxvmix":
        return inside(e0, e1, e2) and outside(b0, b1, b2)
    if name == "rxvsum":
        return e0 > e1 + e2 and 2 * b0 < b1 + b2
    if name == "rxvday":
        return b0 < vol(btc, i - 6) and e0 > vol(eth, i - 6)
    if name == "rxvsmall":
        return b0 > b1 and e0 > e1 and (e0 - e1) * b1 < (b0 - b1) * e1
    if name == "rxvrev":
        return e0 > e1 and e1 < e2 and b0 < b1 and b1 > b2
    raise SystemExit("unknown rule %s" % name)


def signals_for(name, btc, eth):
    n = len(btc)
    return [i for i in range(6, n - 2) if take(name, btc, eth, i)]


def backups_for(name, btc, eth):
    n = len(btc)
    return [i for i in range(6, n - 2) if backup(name, btc, eth, i)]


def prior_sets():
    scored = []
    for mod_name in ("screen_pass62", "screen_pass63", "screen_pass64", "screen_pass65"):
        spec = importlib.util.spec_from_file_location(mod_name, os.path.join(RULES, mod_name + ".py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        btc = mod.load_book("BTC-USD")
        eth = mod.load_book("ETH-USD")
        for name in mod.SHA:
            scored.append(mod.signals_for(name, btc, eth))
    if len(scored) != 32:
        raise SystemExit("prior rules %d" % len(scored))
    return scored


def refuse_shape(btc, eth):
    """High, low, wick, and body against the previous bar stay unwritten."""
    whole = whole_swap = gap = gap_swap = 0
    for i in range(2, len(btc) - 2):
        b0, b1 = btc[i], btc[i - 1]
        e0, e1 = eth[i], eth[i - 1]
        if b0[3] > b1[4] and e0[2] < e1[4]:
            whole += 1
        if e0[3] > e1[4] and b0[2] < b1[4]:
            whole_swap += 1
        if b0[1] > b1[2] and e0[1] < e1[3]:
            gap += 1
        if e0[1] > e1[2] and b0[1] < b1[3]:
            gap_swap += 1
    if whole or whole_swap or gap or gap_swap:
        raise SystemExit("a zero-day comparison is not a rule")


def score(entries, btc, eth, cost):
    btc_pnl = 0.0
    eth_pnl = 0.0
    months = {}
    for i in entries:
        charge = cost + cost
        btc_move = (btc[i + 2][1] / btc[i + 1][1] - 1.0) * 10000.0
        eth_move = (eth[i + 2][1] / eth[i + 1][1] - 1.0) * 10000.0
        btc_pnl += btc_move - charge
        eth_pnl += eth_move - charge
        gross = (btc_move + eth_move) / 2.0
        month = stamp(btc[i + 1][0]).strftime("%Y-%m")
        months[month] = months.get(month, 0.0) + gross - charge
    return {
        "pool": (btc_pnl + eth_pnl) / 2.0,
        "btc": btc_pnl,
        "eth": eth_pnl,
        "trips": len(entries),
        "months": months,
    }


def hand_sum(entries, btc, eth):
    """Recompute the pool from raw opens. Does not call score."""
    pool = 0.0
    for i in entries:
        btc_bps = (btc[i + 2][1] / btc[i + 1][1] - 1.0) * 10000.0 - 40.0
        eth_bps = (eth[i + 2][1] / eth[i + 1][1] - 1.0) * 10000.0 - 40.0
        pool += (btc_bps + eth_bps) / 2.0
    return pool, len(entries)


def null_open(eligible, n_trips, btc, eth, cost):
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    rng = random.Random(20260925)
    pools = []
    for _ in range(500):
        chosen = rng.sample(eligible, n_trips)
        pools.append(score(chosen, btc, eth, cost)["pool"])
    pools.sort()
    return (pools[249] + pools[250]) / 2.0, pools[474]


def month_share(scored):
    if scored["pool"] <= 0:
        return None, None, None
    month, pnl = max(scored["months"].items(), key=lambda kv: kv[1])
    return pnl / scored["pool"], month, pnl


def row(i, opened, volume):
    return (i * STEP, opened, opened, opened, opened, volume)


def self_check():
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    btc = [row(i, 100.0, v) for i, v in enumerate([1, 1, 1, 1, 1, 1, 3, 100, 110])]
    eth = [row(i, 10.0, v) for i, v in enumerate([5, 5, 5, 5, 5, 5, 2, 10, 9])]
    btc[8] = row(8, 110.0, 11)
    eth[8] = row(8, 9.0, 9)
    if signals_for("rxvup", btc, eth) != [6]:
        raise SystemExit("rxvup fixture")
    if signals_for("rxvday", btc, eth) != [6]:
        raise SystemExit("rxvday fixture")
    tied = list(btc)
    tied[6] = row(6, 250.0, 1.0)
    if 6 in signals_for("rxvup", tied, eth):
        raise SystemExit("an equal volume is not above")
    day = [row(i, 100.0, v) for i, v in enumerate([1, 1, 1, 1, 1, 10, 3, 100, 110])]
    day_e = [row(i, 10.0, v) for i, v in enumerate([5, 5, 5, 5, 5, 1, 2, 10, 9])]
    if signals_for("rxvday", day, day_e) != [6]:
        raise SystemExit("rxvday is not the previous bar")
    if signals_for("rxvup", day, day_e):
        raise SystemExit("a day slot is not one step")
    two_b = [row(i, 100.0, v) for i, v in enumerate([1, 1, 1, 1, 2, 3, 4, 100, 110])]
    two_e = [row(i, 10.0, v) for i, v in enumerate([9, 9, 9, 9, 6, 4, 2, 10, 9])]
    if signals_for("rxvtwo", two_b, two_e) != [6]:
        raise SystemExit("rxvtwo fixture")
    both_b = [row(i, 100.0, v) for i, v in enumerate([1, 1, 1, 1, 5, 2, 6, 100, 110])]
    both_e = [row(i, 10.0, v) for i, v in enumerate([9, 9, 9, 9, 4, 7, 3, 10, 9])]
    if signals_for("rxvboth", both_b, both_e) != [6]:
        raise SystemExit("rxvboth fixture")
    if signals_for("rxvtwo", both_b, both_e):
        raise SystemExit("above both is not two ordered steps")
    mix_b = [row(i, 100.0, v) for i, v in enumerate([1, 1, 1, 1, 1, 5, 3, 100, 110])]
    mix_e = [row(i, 10.0, v) for i, v in enumerate([1, 1, 1, 1, 2, 4, 8, 10, 9])]
    if signals_for("rxvmix", mix_b, mix_e) != [6]:
        raise SystemExit("rxvmix fixture")
    flat = list(mix_b)
    flat[4] = row(4, 100.0, 5.0)
    if 6 in signals_for("rxvmix", flat, mix_e):
        raise SystemExit("equal previous volumes are not a range")
    sum_b = [row(i, 100.0, v) for i, v in enumerate([1, 1, 1, 1, 2, 3, 6, 100, 110])]
    sum_e = [row(i, 10.0, v) for i, v in enumerate([1, 1, 1, 1, 4, 6, 3, 10, 9])]
    if signals_for("rxvsum", sum_b, sum_e) != [6]:
        raise SystemExit("rxvsum fixture")
    small_b = [row(i, 100.0, v) for i, v in enumerate([1, 1, 1, 1, 1, 10, 11, 100, 110])]
    small_e = [row(i, 10.0, v) for i, v in enumerate([1, 1, 1, 1, 1, 10, 20, 10, 9])]
    if signals_for("rxvsmall", small_b, small_e) != [6]:
        raise SystemExit("rxvsmall fixture")
    same = list(small_e)
    same[6] = row(6, 10.0, 11.0)
    if 6 in signals_for("rxvsmall", small_b, same):
        raise SystemExit("an equal fraction is not smaller")
    rev_b = [row(i, 100.0, v) for i, v in enumerate([1, 1, 1, 1, 5, 2, 4, 100, 110])]
    rev_e = [row(i, 10.0, v) for i, v in enumerate([1, 1, 1, 1, 2, 6, 3, 10, 9])]
    if signals_for("rxvrev", rev_b, rev_e) != [6]:
        raise SystemExit("rxvrev fixture")
    one = score([6], btc, eth, 20.0)
    btc_hand = (110.0 / 100.0 - 1.0) * 10000.0 - 40.0
    eth_hand = (9.0 / 10.0 - 1.0) * 10000.0 - 40.0
    if one["trips"] != 1 or abs(one["pool"] - (btc_hand + eth_hand) / 2.0) > 1e-9:
        raise SystemExit("one uk trip")
    hand, n = hand_sum([6], btc, eth)
    if n != 1 or abs(hand - one["pool"]) > 1e-9:
        raise SystemExit("hand sum")
    try:
        take("nope", btc, eth, 6)
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
    if [row_i[0] for row_i in btc] != [row_i[0] for row_i in eth]:
        raise SystemExit("books are not aligned")
    if stamp(btc[0][0]) != datetime(2025, 9, 11, tzinfo=timezone.utc):
        raise SystemExit("first bar")
    if stamp(btc[-1][0]) != datetime(2026, 9, 22, 20, tzinfo=timezone.utc):
        raise SystemExit("last bar")
    eligible = list(range(6, len(btc) - 2))
    if len(eligible) != 2254:
        raise SystemExit("eligible %d" % len(eligible))
    refuse_shape(btc, eth)
    btc_only = sum(1 for i in eligible if vol(btc, i) > vol(btc, i - 1) + vol(btc, i - 2))
    eth_only = sum(1 for i in eligible if 2 * vol(eth, i) < vol(eth, i - 1) + vol(eth, i - 2))
    if (btc_only, eth_only) != (532, 1217):
        raise SystemExit("volume legs moved %d %d" % (btc_only, eth_only))
    scored = prior_sets()
    entries = {}
    for name in SHA:
        got = signals_for(name, btc, eth)
        if len(got) != COUNTED[name]:
            raise SystemExit("count moved before scoring %s %d" % (name, len(got)))
        if len(got) == 0 or len(got) == len(eligible):
            raise SystemExit("not interior %s" % name)
        backed = backups_for(name, btc, eth)
        if len(backed) != BACKUP[name]:
            raise SystemExit("backup moved %s %d" % (name, len(backed)))
        if backed == got:
            raise SystemExit("backup is the rule %s" % name)
        entries[name] = got
    fresh = list(entries.values())
    for i, left in enumerate(fresh):
        for right in fresh[i + 1 :]:
            if left == right:
                raise SystemExit("two rules are the same bars")
        for old in scored:
            if left == old:
                raise SystemExit("a rule repeats bars already scored")
    kills = {}
    for name in SHA:
        base = score(entries[name], btc, eth, 20.0)
        stress = score(entries[name], btc, eth, 40.0)
        if abs((base["pool"] - stress["pool"]) - 40.0 * base["trips"]) > 1e-6:
            raise SystemExit("cost gap %s" % name)
        p50, p95 = null_open(eligible, base["trips"], btc, eth, 20.0)
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
            reasons.append("does not beat the random-day null")
        if share is not None and share > 0.40:
            reasons.append("one month is more than 40% of P&L")
        if not base["pool"] > 400:
            reasons.append("pooled P&L does not exceed 400 bps")
        clear = len(reasons) == 0
        row_out = {
            "name": name + "_2025",
            "fill": "uk_4h_open_to_next_open",
            "pool_bps": round(base["pool"], 1),
            "stress_bps": round(stress["pool"], 1),
            "trips": base["trips"],
            "long_days": base["trips"],
            "execution_bars": len(eligible),
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
        gap_bps = row_out["pool_bps"] - row_out["stress_bps"]
        print(
            "COST %s trips %d gap %.1f expected %d share %s"
            % (name, row_out["trips"], gap_bps, 40 * row_out["trips"], row_out["month_share"]),
            flush=True,
        )
        i0 = entries[name][0]
        move = (btc[i0 + 2][1] / btc[i0 + 1][1] - 1.0) * 10000.0
        print(
            "FIRST %s signal %s exec %s BTC v %.8f %.8f %.8f %.8f ETH v %.8f %.8f %.8f %.8f open %.2f -> %.2f %+.2f"
            % (
                name,
                stamp(btc[i0][0]).strftime("%Y-%m-%d %H:%M"),
                stamp(btc[i0 + 1][0]).strftime("%Y-%m-%d %H:%M"),
                vol(btc, i0),
                vol(btc, i0 - 1),
                vol(btc, i0 - 2),
                vol(btc, i0 - 6),
                vol(eth, i0),
                vol(eth, i0 - 1),
                vol(eth, i0 - 2),
                vol(eth, i0 - 6),
                btc[i0 + 1][1],
                btc[i0 + 2][1],
                move,
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
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 13:43:02 UTC, before its own result. "
            "Every fill is the next UK four-hour open to the following UK four-hour open. "
            "The books are BTC-USD and ETH-USD, region=UK, the same pull as pass 62. "
            "EEA candles are not read. No other pair is stood in. "
            "The open is the first trade of a bar whose volume is strictly above zero. "
            "The signal is the base volume of a closed bar. "
            "The high, the low, the wick, and the body are not the signal. "
            "The open and the close are not the signal. "
            "BTC volume is not compared with ETH volume. "
            "This is not a Binance daily open. "
            "Passes 62, 63, 64, and 65 are not rerun and their signs are not flipped. "
            "No rule here selects the same bars as one already scored. "
            "A whole bar strictly above the previous last trade, with the other book strictly below, had no days either way and is not a rule. "
            "An open strictly above the previous high, with the other book's open strictly below the previous low, had no days either way and is not a rule. "
            "Counts before any return, out of 2,254 bars with six earlier bars and two later bars, were 416, 25, 139, 412, 154, 431, 359, and 130. "
            "Backups 422, 38, 132, 456, 145, 382, 336, and 136 were not frozen. "
            "BTC volume above the sum of the two previous volumes counted 532, and ETH volume below the mean of its two previous volumes counted 1,217. "
            "The joint is 154, so both legs bind. The 60-trip gate is not lowered to 25. "
            "No testing row is opened. A numeric clear on these UK opens is still not paper testing, "
            "because no order of this account was shown crossing the book. "
            "The five earlier numeric clears and the confirmation-time fall after a higher day stay void."
        ),
        "rules": {name + "_rule_sha256": digest for name, digest in found.items()},
        "kills": kills,
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass66.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
