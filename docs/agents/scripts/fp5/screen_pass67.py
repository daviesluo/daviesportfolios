"""Eight UK-book day-open screens. Hashed at 2026-09-25 13:52:31 UTC.

The fill is the next Revolut X UK four-hour open, not a Binance daily open.
The signal is the six opens of one completed UTC day. High, low, wick, body,
close, and volume are not the signal. Passes 62 through 66 are not rerun.

    python3 docs/agents/scripts/fp5/screen_pass67.py
    python3 docs/agents/scripts/fp5/screen_pass67.py --check
"""
import hashlib, importlib.util, json, os, random, sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass62/revx")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass67.json")
FROZEN = "2026-09-25 13:52:31 UTC"
STEP = 4 * 3600 * 1000
SHA = {
    "rxlater": "f43e87d3a50df4eb87cbec3a383cd61d9079f850fad4d16d81bb405c9a2a758e",
    "rxorder": "b1494851af82f293dfaf87999dfd470489838ae321843bd0fd6e7005d3c90d06",
    "rxchoppy": "9069ad99000ddaa088cb2fd538d38fddd6312b9cf06c41b35be25d486e97c3bf",
    "rxwhere": "2ad716e802b9db22322f0a58df29d6f963458eb1864ad9e3847d1b0c20e02410",
    "rxmore": "f1bbee7f60fd6a38a132fea9cde35c0ff0fd43f5e3dfc464cd207c5cdc68637f",
    "rxrun": "262b9c0a40fc6ca3a34b9dc4544aa44cf4b054c81658ede366cd230272bdef85",
    "rxsame": "7c278e6dcfc7ed821d057b7ba797fe001181a1ddaacff4131e32d183f4bd7bab",
    "rxbig": "880d4d79285946446ed12992fbf3b0b556ba9ac4675ab256c1e57a3949a242c3",
}
COUNTED = {
    "rxlater": 64,
    "rxorder": 27,
    "rxchoppy": 186,
    "rxwhere": 28,
    "rxmore": 93,
    "rxrun": 17,
    "rxsame": 111,
    "rxbig": 60,
}
BACKUP = {
    "rxlater": 69,
    "rxorder": 21,
    "rxchoppy": 178,
    "rxwhere": 39,
    "rxmore": 90,
    "rxrun": 17,
    "rxsame": 123,
    "rxbig": 69,
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


def day_opens(book, i):
    return [book[i - 5 + k][1] for k in range(6)]


def uniq_slot(xs, want):
    key = max(xs) if want == "max" else min(xs)
    idx = [k for k, v in enumerate(xs) if v == key]
    if len(idx) != 1:
        return None
    return idx[0]


def open_steps(xs):
    return [xs[k + 1] - xs[k] for k in range(5)]


def path_len(xs):
    return sum(abs(step) for step in open_steps(xs))


def run_len(xs, up):
    best = 0
    cur = 0
    for step in open_steps(xs):
        ok = step > 0 if up else step < 0
        if ok:
            cur += 1
            if cur > best:
                best = cur
        else:
            cur = 0
    return best


def big_slot(xs):
    steps = open_steps(xs)
    sizes = [abs(step) for step in steps]
    largest = max(sizes)
    if largest == 0 or sizes.count(largest) != 1:
        return None
    return sizes.index(largest)


def take(name, btc, eth, i):
    b = day_opens(btc, i)
    e = day_opens(eth, i)
    if name == "rxlater":
        bm, em = uniq_slot(b, "max"), uniq_slot(e, "max")
        return bm is not None and em is not None and bm > em
    if name == "rxorder":
        bi, bx = uniq_slot(b, "min"), uniq_slot(b, "max")
        ei, ex = uniq_slot(e, "min"), uniq_slot(e, "max")
        return None not in (bi, bx, ei, ex) and bi < bx and ei > ex
    if name == "rxchoppy":
        nb, ne = abs(b[5] - b[0]), abs(e[5] - e[0])
        return nb > 0 and ne > 0 and path_len(b) * ne > path_len(e) * nb
    if name == "rxwhere":
        return 2 * b[5] > max(b) + min(b) and 2 * e[5] < max(e) + min(e)
    if name == "rxmore":
        return sum(step > 0 for step in open_steps(b)) > sum(step > 0 for step in open_steps(e))
    if name == "rxrun":
        return run_len(b, True) > run_len(b, False) and run_len(e, False) > run_len(e, True)
    if name == "rxsame":
        bm, em = uniq_slot(b, "max"), uniq_slot(e, "max")
        bi, ei = uniq_slot(b, "min"), uniq_slot(e, "min")
        return None not in (bm, em, bi, ei) and bm == em and bm > bi and bm > ei
    if name == "rxbig":
        bb, eb = big_slot(b), big_slot(e)
        return bb is not None and eb is not None and bb > eb
    raise SystemExit("unknown rule %s" % name)


def backup(name, btc, eth, i):
    b = day_opens(btc, i)
    e = day_opens(eth, i)
    if name == "rxlater":
        bm, em = uniq_slot(b, "max"), uniq_slot(e, "max")
        return bm is not None and em is not None and em > bm
    if name == "rxorder":
        bi, bx = uniq_slot(b, "min"), uniq_slot(b, "max")
        ei, ex = uniq_slot(e, "min"), uniq_slot(e, "max")
        return None not in (bi, bx, ei, ex) and ei < ex and bi > bx
    if name == "rxchoppy":
        nb, ne = abs(b[5] - b[0]), abs(e[5] - e[0])
        return nb > 0 and ne > 0 and path_len(e) * nb > path_len(b) * ne
    if name == "rxwhere":
        return 2 * e[5] > max(e) + min(e) and 2 * b[5] < max(b) + min(b)
    if name == "rxmore":
        return sum(step > 0 for step in open_steps(e)) > sum(step > 0 for step in open_steps(b))
    if name == "rxrun":
        return run_len(e, True) > run_len(e, False) and run_len(b, False) > run_len(b, True)
    if name == "rxsame":
        bm, em = uniq_slot(b, "max"), uniq_slot(e, "max")
        bi, ei = uniq_slot(b, "min"), uniq_slot(e, "min")
        return None not in (bm, em, bi, ei) and bi == ei and bi < bm and bi < em
    if name == "rxbig":
        bb, eb = big_slot(b), big_slot(e)
        return bb is not None and eb is not None and eb > bb
    raise SystemExit("unknown rule %s" % name)


def day_ends(n):
    return [i for i in range(5, n - 2) if i % 6 == 5]


def signals_for(name, btc, eth):
    return [i for i in day_ends(len(btc)) if take(name, btc, eth, i)]


def backups_for(name, btc, eth):
    return [i for i in day_ends(len(btc)) if backup(name, btc, eth, i)]


def prior_sets():
    scored = []
    for mod_name in ("screen_pass62", "screen_pass63", "screen_pass64", "screen_pass65", "screen_pass66"):
        spec = importlib.util.spec_from_file_location(mod_name, os.path.join(RULES, mod_name + ".py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        btc = mod.load_book("BTC-USD")
        eth = mod.load_book("ETH-USD")
        for name in mod.SHA:
            scored.append(mod.signals_for(name, btc, eth))
    if len(scored) != 40:
        raise SystemExit("prior rules %d" % len(scored))
    return scored


def refuse_closed(btc, eth, ends):
    """Shape, volume, and empty clock matches stay unwritten."""
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
    hour = last = 0
    for i in ends:
        b, e = day_opens(btc, i), day_opens(eth, i)
        if uniq_slot(b, "max") == 4 and uniq_slot(e, "max") == 1:
            hour += 1
        sb, se = open_steps(b), open_steps(e)
        ab = [abs(step) for step in sb]
        ae = [abs(step) for step in se]
        if (
            ab.count(max(ab)) == 1
            and ae.count(max(ae)) == 1
            and ab.index(max(ab)) == 4
            and sb[4] > 0
            and ae.index(max(ae)) == 4
            and se[4] < 0
        ):
            last += 1
    if hour or last:
        raise SystemExit("an empty clock match is not a rule")


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


def row(i, opened):
    return (i * STEP, opened, opened, opened, opened, 1.0)


def book_from(opens, fill_a, fill_b):
    vals = list(opens) + [fill_a, fill_b]
    return [row(i, vals[i]) for i in range(8)]


def self_check():
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    btc = book_from([1, 2, 3, 4, 10, 5], 100, 110)
    eth = book_from([1, 10, 3, 4, 5, 6], 10, 9)
    if signals_for("rxlater", btc, eth) != [5]:
        raise SystemExit("rxlater fixture")
    tied = book_from([1, 2, 3, 10, 10, 5], 100, 110)
    if signals_for("rxlater", tied, eth):
        raise SystemExit("a tied high open is not unique")
    ob = book_from([1, 3, 2, 4, 8, 5], 100, 110)
    oe = book_from([8, 9, 7, 6, 4, 1], 10, 9)
    if signals_for("rxorder", ob, oe) != [5]:
        raise SystemExit("rxorder fixture")
    cb = book_from([10, 12, 9, 13, 8, 11], 100, 110)
    ce = book_from([10, 11, 12, 13, 14, 15], 10, 9)
    if signals_for("rxchoppy", cb, ce) != [5]:
        raise SystemExit("rxchoppy fixture")
    flat = book_from([10, 12, 10, 12, 10, 10], 100, 110)
    if signals_for("rxchoppy", flat, ce):
        raise SystemExit("a zero net is not a multiple")
    same = book_from([10, 11, 12, 13, 14, 15], 100, 110)
    if signals_for("rxchoppy", same, ce):
        raise SystemExit("an equal multiple is not larger")
    wb = book_from([1, 2, 3, 4, 5, 10], 100, 110)
    we = book_from([10, 9, 8, 7, 6, 1], 10, 9)
    if signals_for("rxwhere", wb, we) != [5]:
        raise SystemExit("rxwhere fixture")
    level = book_from([5, 5, 5, 5, 5, 5], 100, 110)
    if signals_for("rxwhere", level, we):
        raise SystemExit("a flat day is not above its midpoint")
    mb = book_from([1, 2, 3, 4, 5, 6], 100, 110)
    me = book_from([5, 4, 3, 2, 1, 2], 10, 9)
    if signals_for("rxmore", mb, me) != [5]:
        raise SystemExit("rxmore fixture")
    rb = book_from([1, 2, 3, 4, 2, 3], 100, 110)
    re = book_from([5, 4, 3, 2, 3, 2], 10, 9)
    if signals_for("rxrun", rb, re) != [5]:
        raise SystemExit("rxrun fixture")
    sb = book_from([3, 1, 2, 4, 10, 5], 100, 110)
    se = book_from([8, 2, 3, 4, 9, 6], 10, 9)
    if signals_for("rxsame", sb, se) != [5]:
        raise SystemExit("rxsame fixture")
    bb = book_from([10, 11, 12, 13, 14, 30], 100, 110)
    be = book_from([10, 30, 31, 32, 33, 34], 10, 9)
    if signals_for("rxbig", bb, be) != [5]:
        raise SystemExit("rxbig fixture")
    tie_step = book_from([10, 20, 30, 31, 32, 33], 10, 9)
    if signals_for("rxbig", bb, tie_step):
        raise SystemExit("a tied step is not the largest")
    one = score([5], btc, eth, 20.0)
    btc_hand = (110.0 / 100.0 - 1.0) * 10000.0 - 40.0
    eth_hand = (9.0 / 10.0 - 1.0) * 10000.0 - 40.0
    if one["trips"] != 1 or abs(one["pool"] - (btc_hand + eth_hand) / 2.0) > 1e-9:
        raise SystemExit("one uk trip")
    hand, n = hand_sum([5], btc, eth)
    if n != 1 or abs(hand - one["pool"]) > 1e-9:
        raise SystemExit("hand sum")
    try:
        take("nope", btc, eth, 5)
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
    eligible = day_ends(len(btc))
    if len(eligible) != 376 or eligible[0] != 5 or eligible[-1] != 2255:
        raise SystemExit("eligible %d" % len(eligible))
    if stamp(btc[5][0]) != datetime(2025, 9, 11, 20, tzinfo=timezone.utc):
        raise SystemExit("first day-end")
    if stamp(btc[2255][0]) != datetime(2026, 9, 21, 20, tzinfo=timezone.utc):
        raise SystemExit("last day-end")
    if stamp(btc[6][0]) != datetime(2025, 9, 12, tzinfo=timezone.utc):
        raise SystemExit("entry is not the next open")
    refuse_closed(btc, eth, eligible)
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
        print(
            "COST %s trips %d gap %.1f expected %d share %s"
            % (name, row_out["trips"], row_out["pool_bps"] - row_out["stress_bps"], 40 * row_out["trips"], row_out["month_share"]),
            flush=True,
        )
        i0 = entries[name][0]
        move = (btc[i0 + 2][1] / btc[i0 + 1][1] - 1.0) * 10000.0
        bo = day_opens(btc, i0)
        eo = day_opens(eth, i0)
        print(
            "FIRST %s signal %s exec %s BTC %s ETH %s open %.2f -> %.2f %+.2f"
            % (
                name,
                stamp(btc[i0][0]).strftime("%Y-%m-%d %H:%M"),
                stamp(btc[i0 + 1][0]).strftime("%Y-%m-%d %H:%M"),
                " ".join("%.2f" % v for v in bo),
                " ".join("%.2f" % v for v in eo),
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
            "Each rule was hashed at 2026-09-25 13:52:31 UTC, before its own result. "
            "Every fill is the next UK four-hour open to the following UK four-hour open. "
            "The books are BTC-USD and ETH-USD, region=UK, the same pull as pass 62. "
            "EEA candles are not read. No other pair is stood in. "
            "The signal is the six opens of one completed UTC day. "
            "The high, the low, the wick, the body, and the close are not the signal. "
            "Volume is not the signal. "
            "This is not a Binance daily open. "
            "Passes 62 through 66 are not rerun and their signs are not flipped. "
            "No rule here selects the same bars as one already scored. "
            "A whole bar strictly above the previous last trade had no days either way and is not a rule. "
            "BTC's unique highest open at 16:00 with ETH's at 04:00 had no days and is not a rule. "
            "The last open step being the unique largest had no days and is not a rule. "
            "Counts before any return, out of 376 day-ends, were 64, 27, 186, 28, 93, 17, 111, and 60. "
            "Backups 69, 21, 178, 39, 90, 17, 123, and 69 were not frozen. "
            "The 60-trip gate is not lowered to 27, to 28, or to 17. "
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
            raise SystemExit("summary_pass67.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
