"""Eight further UK-book open-to-open screens. Hashed at 2026-09-25 13:35:46 UTC.

The fill is the next Revolut X UK four-hour open, not a Binance daily open.
Nothing here places an order or reads a key. Passes 62, 63, and 64 are not rerun.

    python3 docs/agents/scripts/fp5/screen_pass65.py
    python3 docs/agents/scripts/fp5/screen_pass65.py --check
"""
import hashlib, importlib.util, json, os, random, sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass62/revx")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass65.json")
FROZEN = "2026-09-25 13:35:46 UTC"
STEP = 4 * 3600 * 1000
SHA = {
    "rxomid": "5cb12998a488d9e752286e18c650e99db8eab9c2031627622b5ab46c95b27ea4",
    "rxbin": "d90790ba02d9f1d0996039d9ef2e4f3fd9d3179d8f569417eb25c1de1908761f",
    "rxcover": "632a6d5235f438f59e994ea49827ac4bd946c559b2964d35107fe8a92aeaf57e",
    "rxhigh": "945dd691009fe3a30cb00a6a6d33d501b2b5b7c716776b77f3646ac5bab7a448",
    "rxwide": "058150d59f0b000d047ea39f52f8e7265c48ee4d50c5366b6bc79c426b4c1783",
    "rxlast": "e4ab2590ea5be667f8b3a1251f963b0880787f7cebbcf7171b22e8496c7ecc3e",
    "rxbmid": "619547fde2fa2a4de42fc863a22da0af978ec1a6a3211970332df06ca63b4ed0",
    "rxobin": "a91ce3425e610c7dd5ca094c080821ebf6f57a577fa9334ec81d10d3c4cfac44",
}
COUNTED = {
    "rxomid": 220,
    "rxbin": 253,
    "rxcover": 889,
    "rxhigh": 125,
    "rxwide": 116,
    "rxlast": 178,
    "rxbmid": 180,
    "rxobin": 108,
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
        rows.append((start, opened, high, low, closed))
    if len(rows) != 2262:
        raise SystemExit("bar count %s %d" % (symbol, len(rows)))
    for i in range(1, len(rows)):
        if rows[i][0] - rows[i - 1][0] != STEP:
            raise SystemExit("gap %s %d" % (symbol, i))
    return rows


def stamp(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc)


def width(bar):
    return bar[2] - bar[3]


def body_abs(bar):
    return abs(bar[4] - bar[1])


def overlap(a, b):
    return max(0.0, min(a[2], b[2]) - max(a[3], b[3]))


def ends(bar):
    return min(bar[1], bar[4]), max(bar[1], bar[4])


def take(name, btc, eth, i):
    b0, b1, b2 = btc[i], btc[i - 1], btc[i - 2]
    e0, e1 = eth[i], eth[i - 1]
    e2 = eth[i - 2]
    blo, bhi = ends(b1)
    elo, ehi = ends(e1)
    if name == "rxomid":
        return 2 * b0[1] > b1[2] + b1[3] and 2 * e0[1] < e1[2] + e1[3]
    if name == "rxbin":
        return blo < b0[4] < bhi and (e0[4] > ehi or e0[4] < elo)
    if name == "rxcover":
        wb, we = width(b0), width(e0)
        return wb > 0 and we > 0 and overlap(b0, b1) * we > overlap(e0, e1) * wb
    if name == "rxhigh":
        return b0[2] > b1[2] and b0[2] > b2[2] and e0[3] < e1[3] and e0[3] < e2[3]
    if name == "rxwide":
        return width(b0) > body_abs(b1) and width(e0) < body_abs(e1)
    if name == "rxlast":
        return b0[4] > b1[4] and e0[4] < e1[4]
    if name == "rxbmid":
        return 2 * b0[4] > b1[1] + b1[4] and 2 * e0[4] < e1[1] + e1[4]
    if name == "rxobin":
        return blo < b0[1] < bhi and (e0[1] > ehi or e0[1] < elo)
    raise SystemExit("unknown rule %s" % name)


def signals_for(name, btc, eth):
    n = len(btc)
    return [i for i in range(2, n - 2) if take(name, btc, eth, i)]


def refuse_closed(btc, eth, eligible):
    """Zero-day comparisons stay unwritten. A scored set is not scored again."""
    whole = whole_swap = gap = gap_swap = 0
    out = out_swap = hold = hold_swap = near = near_swap = 0
    shift = []
    for i in eligible:
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
        if b0[4] > b1[2] and e0[4] < e1[3]:
            out += 1
        if e0[4] > e1[2] and b0[4] < b1[3]:
            out_swap += 1
        if b0[3] > b1[1] and e0[2] < e1[1]:
            hold += 1
        if e0[3] > e1[1] and b0[2] < b1[1]:
            hold_swap += 1
        if abs(b0[4] - b1[4]) < abs(b0[1] - b1[4]) and abs(e0[4] - e1[4]) > abs(e0[1] - e1[4]):
            near += 1
        if abs(e0[4] - e1[4]) < abs(e0[1] - e1[4]) and abs(b0[4] - b1[4]) > abs(b0[1] - b1[4]):
            near_swap += 1
        if (b0[1] + b0[4]) > (b0[2] + b0[3]) and (e0[1] + e0[4]) < (e0[2] + e0[3]):
            shift.append(i)
    if whole or whole_swap or gap or gap_swap:
        raise SystemExit("a zero-day comparison is not a rule")
    if (out, out_swap, hold, hold_swap, near, near_swap) != (4, 1, 1, 5, 48, 33):
        raise SystemExit("unfrozen short counts moved")
    # The body-center comparison is the already scored wick rule, swapped.
    spec = importlib.util.spec_from_file_location(
        "screen_pass64",
        os.path.join(RULES, "screen_pass64.py"),
    )
    past = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(past)
    wick = past.signals_for("rxwick", btc, eth)
    if shift == wick or len(shift) == 0:
        raise SystemExit("body center was not the wick backup")
    # shift as coded is BTC center above midpoint. That matched the wick swap, not rxwick.
    wick_swap = []
    for i in eligible:
        b0, e0 = btc[i], eth[i]
        up_b = b0[2] - max(b0[1], b0[4])
        lo_b = min(b0[1], b0[4]) - b0[3]
        up_e = e0[2] - max(e0[1], e0[4])
        lo_e = min(e0[1], e0[4]) - e0[3]
        if lo_b > up_b and up_e > lo_e:
            wick_swap.append(i)
    if shift != wick_swap:
        raise SystemExit("body center is not the wick backup")
    scored = []
    for mod_name in ("screen_pass62", "screen_pass63", "screen_pass64"):
        spec = importlib.util.spec_from_file_location(mod_name, os.path.join(RULES, mod_name + ".py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        if mod_name == "screen_pass62":
            b_view = [(r[0], r[1], r[4]) for r in btc]
            e_view = [(r[0], r[1], r[4]) for r in eth]
            for name in mod.SHA:
                scored.append(mod.signals_for(name, b_view, e_view))
        else:
            for name in mod.SHA:
                scored.append(mod.signals_for(name, btc, eth))
    return scored


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


def self_check():
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    btc = [
        (0, 100.0, 110.0, 90.0, 100.0),
        (STEP, 100.0, 110.0, 90.0, 105.0),
        (2 * STEP, 102.0, 120.0, 95.0, 103.0),
        (3 * STEP, 100.0, 101.0, 99.0, 100.0),
        (4 * STEP, 110.0, 111.0, 109.0, 110.0),
    ]
    eth = [
        (0, 10.0, 14.0, 6.0, 10.0),
        (STEP, 10.0, 14.0, 6.0, 12.0),
        (2 * STEP, 9.0, 13.0, 7.0, 8.0),
        (3 * STEP, 10.0, 10.5, 9.5, 10.0),
        (4 * STEP, 9.0, 9.5, 8.5, 9.0),
    ]
    if signals_for("rxomid", btc, eth) != [2]:
        raise SystemExit("rxomid fixture")
    if signals_for("rxbin", btc, eth) != [2]:
        raise SystemExit("rxbin fixture")
    tied = list(btc)
    tied[2] = (2 * STEP, 100.0, 120.0, 95.0, 103.0)
    if 2 in signals_for("rxomid", tied, eth):
        raise SystemExit("a tie is not above the midpoint")
    touched = list(btc)
    touched[2] = (2 * STEP, 102.0, 120.0, 95.0, 105.0)
    if 2 in signals_for("rxbin", touched, eth):
        raise SystemExit("touching the body is not inside")
    one = score([2], btc, eth, 20.0)
    btc_hand = (110.0 / 100.0 - 1.0) * 10000.0 - 40.0
    eth_hand = (9.0 / 10.0 - 1.0) * 10000.0 - 40.0
    if one["trips"] != 1 or abs(one["pool"] - (btc_hand + eth_hand) / 2.0) > 1e-9:
        raise SystemExit("one uk trip")
    hand, n = hand_sum([2], btc, eth)
    if n != 1 or abs(hand - one["pool"]) > 1e-9:
        raise SystemExit("hand sum")
    try:
        take("nope", btc, eth, 2)
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
    if [row[0] for row in btc] != [row[0] for row in eth]:
        raise SystemExit("books are not aligned")
    if stamp(btc[0][0]) != datetime(2025, 9, 11, tzinfo=timezone.utc):
        raise SystemExit("first bar")
    if stamp(btc[-1][0]) != datetime(2026, 9, 22, 20, tzinfo=timezone.utc):
        raise SystemExit("last bar")
    eligible = list(range(2, len(btc) - 2))
    if len(eligible) != 2258:
        raise SystemExit("eligible %d" % len(eligible))
    scored = refuse_closed(btc, eth, eligible)
    entries = {}
    for name in SHA:
        got = signals_for(name, btc, eth)
        if len(got) != COUNTED[name]:
            raise SystemExit("count moved before scoring %s %d" % (name, len(got)))
        if len(got) == 0 or len(got) == len(eligible):
            raise SystemExit("not interior %s" % name)
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
        row = {
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
        if n_hand != row["trips"] or abs(hand - base["pool"]) > 0.1 or abs(hand - row["pool_bps"]) > 0.1:
            raise SystemExit("hand sum mismatch %s" % name)
        gap_bps = row["pool_bps"] - row["stress_bps"]
        print(
            "COST %s trips %d gap %.1f expected %d share %s"
            % (name, row["trips"], gap_bps, 40 * row["trips"], row["month_share"]),
            flush=True,
        )
        i0 = entries[name][0]
        move = (btc[i0 + 2][1] / btc[i0 + 1][1] - 1.0) * 10000.0
        print(
            "FIRST %s signal %s exec %s BTC o %.2f h %.2f l %.2f c %.2f ETH o %.2f h %.2f l %.2f c %.2f open %.2f -> %.2f %+.2f"
            % (
                name,
                stamp(btc[i0][0]).strftime("%Y-%m-%d %H:%M"),
                stamp(btc[i0 + 1][0]).strftime("%Y-%m-%d %H:%M"),
                btc[i0][1], btc[i0][2], btc[i0][3], btc[i0][4],
                eth[i0][1], eth[i0][2], eth[i0][3], eth[i0][4],
                btc[i0 + 1][1], btc[i0 + 2][1], move,
            ),
            flush=True,
        )
        if share is not None:
            print(
                "UNROUNDED %s share %.6f month %s pnl %.6f pool %.6f"
                % (name, share, month, month_pnl, base["pool"]),
                flush=True,
            )
        kills[name + "_2025"] = row
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 13:35:46 UTC, before its own result. "
            "Every fill is the next UK four-hour open to the following UK four-hour open. "
            "The books are BTC-USD and ETH-USD, region=UK, the same pull as pass 62. "
            "EEA candles are not read. No other pair is stood in. "
            "The open is the first trade of a bar whose volume is strictly above zero. "
            "Volume is not the signal. This is not a Binance daily open. "
            "Passes 62, 63, and 64 are not rerun and their signs are not flipped. "
            "No rule here selects the same bars as one already scored. "
            "A whole bar strictly above the previous last trade, with the other book strictly below, had no days either way and is not a rule. "
            "An open strictly above the previous high, with the other book's open strictly below the previous low, had no days either way and is not a rule. "
            "A body center strictly above its own range midpoint is the same bars as the pass 64 wick backup and is not scored again. "
            "Counts before any return were 220, 253, 889, 125, 116, 178, 180, and 108. "
            "Backups 230, 277, 1086, 138, 142, 188, 210, and 122 were not frozen. "
            "A directional close beyond the previous high and low counted 4, and the swap counted 1. "
            "A low strictly above the previous open, with the other book's high strictly below its previous open, counted 1, and the swap counted 5. "
            "A last trade strictly closer to the previous last trade than the first trade is, with the other book farther, counted 48, and the swap counted 33. "
            "Those were not frozen. The 60-trip gate is not lowered to 48, to 4, to 1, or to 5. "
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
            raise SystemExit("summary_pass65.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
