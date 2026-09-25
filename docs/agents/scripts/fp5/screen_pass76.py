#!/usr/bin/env python3
"""Score one UK maker limit: buy a dollar stable one tick below par.

The rule text is hashed before the hour closes are joined to a P&L.
Maker fee is 0. The 20 bp taker charge is not applied. The 9 bp taker
schedule is not applied. High and low are not fills.
"""

from __future__ import annotations

import hashlib
import json
import random
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
RULE = ROOT / "docs/agents/scripts/fp5/rxpar_rule.txt"
TAPE = ROOT / "docs/agents/backtests/inputs/fp5_2026-09-25/pass76"
SUMMARY = ROOT / "docs/agents/backtests/fp5/summary_pass76.json"

RULE_SHA = "cef434cc494f4866de969211c52646c56e3c61328f8bd3d64412b0735b6a8d48"
FROZEN_AT = "2026-09-25 21:12:21 UTC"
BUY = Decimal("0.9999")
SELL = Decimal("1.0000")
TICK_BPS = (SELL / BUY - Decimal(1)) * Decimal(10000)
MAKER_BPS = Decimal(0)
HOUR = 3600 * 1000


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def month_key(ms: int) -> str:
    stamp = datetime.fromtimestamp(ms / 1000, timezone.utc)
    return f"{stamp.year:04d}-{stamp.month:02d}"


def load_bars(symbol: str) -> list[tuple[int, Decimal, Decimal]]:
    payload = json.loads((TAPE / f"{symbol}_60.json").read_text())
    if payload["region"] != "UK" or payload["interval"] != 60:
        raise SystemExit("tape %s" % symbol)
    bars = []
    last = -1
    for row in payload["rows"]:
        start = int(row["start"])
        if start <= last:
            raise SystemExit("unsorted %s" % symbol)
        last = start
        # High and low stay on disk and are not read.
        bars.append((start, Decimal(row["close"]), Decimal(row["volume"])))
    return bars


def completed(bars: list[tuple[int, Decimal, Decimal]]) -> list[int]:
    """Entry timestamps of buys that later trade back through one dollar."""
    holding = False
    entry = 0
    out: list[int] = []
    for start, close, volume in bars:
        if volume <= 0:
            continue
        if not holding:
            if close <= BUY:
                holding = True
                entry = start
            continue
        if close >= SELL:
            out.append(entry)
            holding = False
    return out


def next_moves(bars: list[tuple[int, Decimal, Decimal]]) -> list[Decimal]:
    traded = [(start, close) for start, close, volume in bars if volume > 0]
    moves = []
    for i in range(len(traded) - 1):
        _start, close = traded[i]
        _nxt, nxt = traded[i + 1]
        moves.append((nxt / close - Decimal(1)) * Decimal(10000))
    return moves


def pool_of(usdc_n: int, usdt_n: int) -> Decimal:
    return (Decimal(usdc_n) + Decimal(usdt_n)) * TICK_BPS / Decimal(2)


def month_share(usdc: list[int], usdt: list[int], pool: Decimal):
    if pool <= 0:
        return None, None
    months: dict[str, Decimal] = {}
    half = TICK_BPS / Decimal(2)
    for entry in usdc + usdt:
        key = month_key(entry)
        months[key] = months.get(key, Decimal(0)) + half
    key, pnl = max(months.items(), key=lambda kv: kv[1])
    return pnl / pool, key


def null_p95(usdc_moves: list[Decimal], usdt_moves: list[Decimal], n: int) -> Decimal:
    if int(Decimal("0.95") * 500) - 1 != 474:
        raise SystemExit("null index moved")
    if n <= 0:
        return Decimal(0)
    if n > len(usdc_moves) or n > len(usdt_moves):
        raise SystemExit("null sample longer than the window")
    rng = random.Random(20260925)
    pools = []
    for _ in range(500):
        left = rng.sample(usdc_moves, n)
        right = rng.sample(usdt_moves, n)
        pools.append((sum(left, Decimal(0)) + sum(right, Decimal(0))) / Decimal(2))
    pools.sort()
    return pools[474]


def fnum(value: Decimal) -> float:
    return float(format(value, ".10f"))


def self_check() -> None:
    if TICK_BPS != Decimal("1.000100010001000100010001000"):
        # 10000 * 0.0001 / 0.9999 = 1 / 0.9999, 27 decimal places from the division context.
        if abs(TICK_BPS - (Decimal(1) / Decimal("0.9999"))) > Decimal("1e-18"):
            raise SystemExit("tick bps %s" % TICK_BPS)
    # One hand trip: buy 0.9999, sell 1.0000, fee 0.
    hand = (Decimal("1.0000") / Decimal("0.9999") - 1) * 10000
    if hand != TICK_BPS:
        raise SystemExit("hand bps")
    if MAKER_BPS != 0:
        raise SystemExit("maker fee moved")
    usdc = [
        (0, Decimal("1.0001"), Decimal(1)),
        (HOUR, Decimal("0.9999"), Decimal(1)),
        (2 * HOUR, Decimal("0.9998"), Decimal(1)),
        (3 * HOUR, Decimal("1.0000"), Decimal(1)),
        (4 * HOUR, Decimal("0.9999"), Decimal(0)),
        (5 * HOUR, Decimal("0.9999"), Decimal(1)),
        (6 * HOUR, Decimal("1.0001"), Decimal(1)),
    ]
    usdt = [
        (0, Decimal("1.0002"), Decimal(1)),
        (HOUR, Decimal("1.0001"), Decimal(1)),
        (2 * HOUR, Decimal("0.9990"), Decimal(1)),
        (3 * HOUR, Decimal("0.5000"), Decimal(0)),
        (4 * HOUR, Decimal("1.0000"), Decimal(1)),
    ]
    # A low of 0.5 with a close still above the bid must not fill.
    wick = [(0, Decimal("1.0000"), Decimal(1)), (HOUR, Decimal("1.0000"), Decimal(1))]
    if completed(usdc) != [HOUR, 5 * HOUR]:
        raise SystemExit("usdc fixture %s" % completed(usdc))
    if completed(usdt) != [2 * HOUR]:
        raise SystemExit("usdt fixture %s" % completed(usdt))
    if completed(wick) != []:
        raise SystemExit("wick filled without a close through the bid")
    got = pool_of(2, 1)
    if got != TICK_BPS * Decimal("1.5"):
        raise SystemExit("pool %s" % got)
    # The zero-volume 0.9999 bar is not an entry. The 0.5 bar is not an exit.


def pin_tape(usdc_bars, usdt_bars, usdc, usdt) -> None:
    """The first two trips, read off the tape before the summary was trusted."""
    if usdc[0] != 1764190800000 or usdt[0] != 1765900800000:
        raise SystemExit("first entry moved")
    if len(usdc) != 525 or len(usdt) != 454:
        raise SystemExit("trip count moved")
    by_usdc = {start: (close, volume) for start, close, volume in usdc_bars}
    # 21:00 close 0.9994 is a trade. 23:00 close 1.0003 has no volume and is not the exit.
    if by_usdc[1764190800000] != (Decimal("0.9994"), Decimal("1570.11889")):
        raise SystemExit("usdc entry print")
    if by_usdc[1764198000000][1] != 0 or by_usdc[1764198000000][0] != Decimal("1.0003"):
        raise SystemExit("zero-volume quote was treated as a trade")
    if by_usdc[1764201600000] != (Decimal("1.0003"), Decimal("10.06604")):
        raise SystemExit("usdc exit print")
    by_usdt = {start: (close, volume) for start, close, volume in usdt_bars}
    if by_usdt[1765900800000] != (Decimal("0.9996"), Decimal("451.87464")):
        raise SystemExit("usdt entry print")
    if by_usdt[1765904400000] != (Decimal("1.0007"), Decimal("527.99055")):
        raise SystemExit("usdt exit print")


def score() -> dict:
    if sha256(RULE) != RULE_SHA:
        raise SystemExit("rule hash moved")
    frozen = (RULE.parent / "rxpar_rule.frozen_at").read_text().strip()
    if frozen != FROZEN_AT:
        raise SystemExit("frozen_at moved")
    usdc_bars = load_bars("USDC-USD")
    usdt_bars = load_bars("USDT-USD")
    usdc = completed(usdc_bars)
    usdt = completed(usdt_bars)
    pin_tape(usdc_bars, usdt_bars, usdc, usdt)
    pool = pool_of(len(usdc), len(usdt))
    stress = pool - (MAKER_BPS + MAKER_BPS) * Decimal(min(len(usdc), len(usdt)))
    share, month = month_share(usdc, usdt, pool)
    usdc_moves = next_moves(usdc_bars)
    usdt_moves = next_moves(usdt_bars)
    n = min(len(usdc), len(usdt))
    p95 = null_p95(usdc_moves, usdt_moves, n)
    edge = (sum(usdc_moves, Decimal(0)) + sum(usdt_moves, Decimal(0))) / Decimal(2)
    usdc_sum = Decimal(len(usdc)) * TICK_BPS
    usdt_sum = Decimal(len(usdt)) * TICK_BPS
    reasons = []
    if not pool > 0:
        reasons.append("pooled P&L is not positive")
    if not stress > 0:
        reasons.append("doubled maker fee is not positive")
    if n < 60:
        reasons.append("lesser trip count is under 60")
    if not usdc_sum > 0 or not usdt_sum > 0:
        reasons.append("one book is not positive")
    if not pool > p95:
        reasons.append("pooled P&L does not beat the null p95")
    if share is None or share > Decimal("0.40"):
        reasons.append("one month is more than 40% of pooled P&L")
    if not pool > 400:
        reasons.append("pooled P&L does not exceed 400 bps")
    return {
        "rule": "rxpar",
        "rule_sha256": RULE_SHA,
        "frozen_at": FROZEN_AT,
        "maker_fee_bps": 0,
        "taker_fee_not_used_bps": 9,
        "screen_taker_not_used_bps": 20,
        "fee_page": "https://www.revolut.com/legal/crypto-exchange-fees/",
        "fee_page_archive": "https://web.archive.org/web/20250813002900/https://www.revolut.com/legal/crypto-exchange-fees/",
        "buy_limit": "0.9999",
        "sell_limit": "1.0000",
        "tick_bps": fnum(TICK_BPS),
        "usdc_trips": len(usdc),
        "usdt_trips": len(usdt),
        "trips": n,
        "usdc_bps": fnum(usdc_sum),
        "usdt_bps": fnum(usdt_sum),
        "pool_bps": fnum(pool),
        "stress_bps": fnum(stress),
        "null_p95_bps": fnum(p95),
        "edge_off_bps": fnum(edge),
        "month": month,
        "month_share": None if share is None else fnum(share),
        "reasons": reasons,
        "reached_preregistration": False,
        "testing_row": False,
        "rules_scored": 1,
        "rules_not_opened": 7,
        "note": (
            "One rule was scored. Seven were not opened. USDT is the second book of this "
            "par, not a second rule. A sterling quote, a gold ounce, and a staking rate "
            "were not opened. Cloning the bid onto another coin was not opened. "
            "Zero-trip variants were not used to fill the seven. The numeric gates on "
            "this rule clear. That is not a testing row: no order of this account was "
            "shown crossing the book. Stress equals the pool because the maker fee is 0."
        ),
        "usdc_sha256": sha256(TAPE / "USDC-USD_60.json"),
        "usdt_sha256": sha256(TAPE / "USDT-USD_60.json"),
        "window_start": usdc_bars[0][0],
        "window_end": usdc_bars[-1][0],
        "first_usdc_entry": usdc[0] if usdc else None,
        "first_usdt_entry": usdt[0] if usdt else None,
    }


def main() -> None:
    self_check()
    got = score()
    text = json.dumps(got, indent=2, sort_keys=True) + "\n"
    if "--check" in sys.argv:
        have = SUMMARY.read_text()
        if have != text:
            raise SystemExit("summary drifted")
        print("CHECK_OK")
        return
    SUMMARY.write_text(text)
    print(text)
    print(
        "FIRST",
        got["first_usdc_entry"],
        got["first_usdt_entry"],
        "trips",
        got["usdc_trips"],
        got["usdt_trips"],
        "pool",
        got["pool_bps"],
    )


if __name__ == "__main__":
    main()
