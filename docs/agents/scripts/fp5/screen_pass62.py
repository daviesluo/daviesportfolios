"""Eight UK-book open-to-open screens. Hashed at 2026-09-25 13:10:09 UTC.

The fill is the next Revolut X UK four-hour open, not a Binance daily open.
Nothing here places an order or reads a key.

    python3 docs/agents/scripts/fp5/screen_pass62.py
    python3 docs/agents/scripts/fp5/screen_pass62.py --check
"""
import hashlib, json, os, random, sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass62/revx")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass62.json")
FROZEN = "2026-09-25 13:10:09 UTC"
STEP = 4 * 3600 * 1000
SHA = {
    "rxopp": "6fa5bb00162900b0db298b7dafb306996a1a045cebe4367112146232b07d69e7",
    "rxsmall": "420131a74142d0c4b43ea4ec64320de9ad528a30cc0877d31a7c202d6234e304",
    "rxdown": "2096d89263501ebe052cff81ae44c95772571a700d449db08416e7d9f9120e01",
    "rxopen": "8856e961991a6918d35eb6ba2538524a12cd01bd550f7a1d608235a02ae3c1ad",
    "rxfade": "a21f0178c4f3fa946ac9400d9f02566d6a1e964a5a22fb36456777c1336f9b67",
    "rxgive": "4243a1648d67f4f4c9daeeb3e6156f75e88592d8a4044c400c21235a71ef6a70",
    "rxstep": "6f3fa8dedd429e44147c357fc063e1b8693f6f969bf58aa41504faf5ead89000",
    "rxthru": "affb1522ebbe88ff0c7e252647eb187ee12960ecc2c80ff50adc6f08fb36f14d",
}
COUNTED = {
    "rxopp": 178,
    "rxsmall": 617,
    "rxdown": 293,
    "rxopen": 121,
    "rxfade": 10,
    "rxgive": 50,
    "rxstep": 7,
    "rxthru": 2,
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
        path = os.path.join(RULES, name + "_rule.txt")
        have = sha256_file(path)
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
    rows = []
    seen = set()
    for row in doc["rows"]:
        start = int(row["start"])
        if start in seen:
            raise SystemExit("duplicate start %s" % start)
        seen.add(start)
        vol = float(row["volume"])
        opened = float(row["open"])
        closed = float(row["close"])
        if vol <= 0 or opened <= 0 or closed <= 0:
            raise SystemExit("bar is not a trade %s %s" % (symbol, start))
        if float(row["high"]) <= 0 or float(row["low"]) <= 0:
            raise SystemExit("nonpositive extreme %s" % symbol)
        rows.append((start, opened, closed))
    if len(rows) != 2262:
        raise SystemExit("bar count %s %d" % (symbol, len(rows)))
    for i in range(1, len(rows)):
        if rows[i][0] - rows[i - 1][0] != STEP:
            raise SystemExit("gap %s %d" % (symbol, i))
    return rows


def stamp(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc)


def signals_for(name, btc, eth):
    n = len(btc)
    out = []
    for i in range(2, n - 2):
        bo, bc = btc[i][1], btc[i][2]
        eo, ec = eth[i][1], eth[i][2]
        bp, ep = btc[i - 1][2], eth[i - 1][2]
        bp2, ep2 = btc[i - 2][2], eth[i - 2][2]
        if name == "rxopp":
            take = bc > bo and ec < eo
        elif name == "rxsmall":
            take = bc > bo and ec > eo and (bc - bo) * eo < (ec - eo) * bo
        elif name == "rxdown":
            take = bc < bo and ec < eo and (bo - bc) * eo > (eo - ec) * bo
        elif name == "rxopen":
            take = bo > bp and eo < ep
        elif name == "rxfade":
            take = bo > bp and bc < bo and eo > ep and ec > eo
        elif name == "rxgive":
            take = bo > bp and eo > ep and bc < bo and ec < eo
        elif name == "rxstep":
            take = bc > bp > bp2 and ec < ep < ep2
        elif name == "rxthru":
            take = bo < bp and bc > bp and eo > ep and ec < ep
        else:
            raise SystemExit("unknown rule %s" % name)
        if take:
            out.append(i)
    return out


def score(entries, btc, eth, cost):
    btc_pnl = 0.0
    eth_pnl = 0.0
    months = {}
    for i in entries:
        entry = i + 1
        exit_i = i + 2
        charge = cost + cost
        btc_move = (btc[exit_i][1] / btc[entry][1] - 1.0) * 10000.0
        eth_move = (eth[exit_i][1] / eth[entry][1] - 1.0) * 10000.0
        btc_pnl += btc_move - charge
        eth_pnl += eth_move - charge
        gross = (btc_move + eth_move) / 2.0
        month = stamp(btc[entry][0]).strftime("%Y-%m")
        months[month] = months.get(month, 0.0) + gross - charge
    n = len(entries)
    return {
        "pool": (btc_pnl + eth_pnl) / 2.0,
        "btc": btc_pnl,
        "eth": eth_pnl,
        "trips": n,
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
    p95 = pools[int(0.95 * len(pools)) - 1]
    p50 = (pools[249] + pools[250]) / 2.0
    return p50, p95


def month_share(scored):
    if scored["pool"] <= 0:
        return None, None, None
    month, pnl = max(scored["months"].items(), key=lambda kv: kv[1])
    return pnl / scored["pool"], month, pnl


def self_check():
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    # five bars. signal index 2 enters at 3 and exits at 4.
    btc = [
        (0, 100.0, 100.0),
        (STEP, 100.0, 90.0),
        (2 * STEP, 80.0, 95.0),
        (3 * STEP, 100.0, 100.0),
        (4 * STEP, 110.0, 110.0),
    ]
    eth = [
        (0, 10.0, 10.0),
        (STEP, 10.0, 10.0),
        (2 * STEP, 11.0, 9.0),
        (3 * STEP, 10.0, 10.0),
        (4 * STEP, 9.0, 9.0),
    ]
    if signals_for("rxopp", btc, eth) != [2]:
        raise SystemExit("rxopp fixture")
    if signals_for("rxthru", btc, eth) != [2]:
        raise SystemExit("rxthru fixture")
    one = score([2], btc, eth, 20.0)
    btc_hand = (110.0 / 100.0 - 1.0) * 10000.0 - 40.0
    eth_hand = (9.0 / 10.0 - 1.0) * 10000.0 - 40.0
    pool = (btc_hand + eth_hand) / 2.0
    if one["trips"] != 1 or abs(one["btc"] - btc_hand) > 1e-9 or abs(one["pool"] - pool) > 1e-9:
        raise SystemExit("one uk trip")
    hand, n = hand_sum([2], btc, eth)
    if n != 1 or abs(hand - one["pool"]) > 1e-9:
        raise SystemExit("hand sum")
    # an equal last trade does not fire
    flat = list(btc)
    flat[2] = (2 * STEP, 80.0, 80.0)
    if signals_for("rxopp", flat, eth):
        raise SystemExit("a tie is not a finish")


def detail(name, btc, eth, i):
    bo, bc = btc[i][1], btc[i][2]
    eo, ec = eth[i][1], eth[i][2]
    bp, ep = btc[i - 1][2], eth[i - 1][2]
    return "BTC o %.2f c %.2f prior c %.2f ETH o %.2f c %.2f prior c %.2f" % (bo, bc, bp, eo, ec, ep)


def main():
    self_check()
    check = "--check" in sys.argv
    found = require_rules()
    btc = load_book("BTC-USD")
    eth = load_book("ETH-USD")
    if [row[0] for row in btc] != [row[0] for row in eth]:
        raise SystemExit("books are not aligned")
    first = stamp(btc[0][0])
    last = stamp(btc[-1][0])
    if first != datetime(2025, 9, 11, tzinfo=timezone.utc):
        raise SystemExit("first bar %s" % first)
    if last != datetime(2026, 9, 22, 20, tzinfo=timezone.utc):
        raise SystemExit("last bar %s" % last)
    n = len(btc)
    eligible = list(range(2, n - 2))
    if len(eligible) != 2258:
        raise SystemExit("eligible %d" % len(eligible))
    # Counts were taken before any return was joined. Do not score first.
    entries = {}
    for name in SHA:
        got = signals_for(name, btc, eth)
        if len(got) != COUNTED[name]:
            raise SystemExit("count moved before scoring %s %d" % (name, len(got)))
        if len(got) == 0 or len(got) == len(eligible):
            raise SystemExit("not interior %s" % name)
        entries[name] = got
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
        if row["long_days"] != COUNTED[name]:
            raise SystemExit("trip count %s" % name)
        gap = row["pool_bps"] - row["stress_bps"]
        print(
            "COST %s trips %d gap %.1f expected %d share %s"
            % (name, row["trips"], gap, 40 * row["trips"], row["month_share"]),
            flush=True,
        )
        i0 = entries[name][0]
        entry_px = btc[i0 + 1][1]
        exit_px = btc[i0 + 2][1]
        move = (exit_px / entry_px - 1.0) * 10000.0
        print(
            "FIRST %s signal %s exec %s %s BTC open %.2f -> %.2f %+.2f"
            % (
                name,
                stamp(btc[i0][0]).strftime("%Y-%m-%d %H:%M"),
                stamp(btc[i0 + 1][0]).strftime("%Y-%m-%d %H:%M"),
                detail(name, btc, eth, i0),
                entry_px,
                exit_px,
                move,
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
            "Each rule was hashed at 2026-09-25 13:10:09 UTC, before its own result. "
            "Every fill is the next UK four-hour open to the following UK four-hour open. "
            "The books are BTC-USD and ETH-USD, region=UK. EEA candles are not read. "
            "The open is the first trade of a bar whose volume is strictly above zero. "
            "This pull has 2,262 bars on each book, from 2025-09-11 00:00 UTC through 2026-09-22 20:00 UTC, and no zero-volume bar. "
            "The high, the low, and the volume column are not the signal. "
            "This is not a Binance daily open. The 29-day minute tape is not the fill and has no ETH-USD. "
            "The 60-trip gate is not lowered to 10, to 50, to 7, or to 2. "
            "Backup counts 188, 329, 651, 100, 18, 68, 17, and 12 were interior and were not frozen. "
            "No sign is flipped. No testing row is opened. "
            "A numeric clear on these UK opens is still not paper testing, because no order of this account was shown crossing the book. "
            "It is not voided for being a Binance open. "
            "The five earlier numeric clears and the confirmation-time fall after a higher day stay void as Revolut X fills. "
            "Coin-margined mark closes are not rerun. The ETH mark result is not close to a pass."
        ),
        "rules": {name + "_rule_sha256": digest for name, digest in found.items()},
        "kills": kills,
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass62.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
