from __future__ import annotations

"""Pins for the fp253 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _long(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def _short(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (entry * (1 - fee)) / (exit_px * (1 + fee)) - 1


def _put(book, ts, open_px, close_px):
    book[ts] = (float(open_px), float(close_px))



def test_flip() -> None:
    if c.IDEA != "FLIP" or c.MIN_N != 30 or c.HOLD_DAYS != 22:
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    spot = {}
    y = entry - day
    _put(spot, y, 1, 110)
    _put(spot, y - day, 1, 100)
    _put(spot, y - 2 * day, 1, 120)
    _put(spot, entry, 10, 1)
    _put(spot, entry + 22 * day, 12, 1)
    py = missed - day
    _put(spot, py, 1, 100)
    _put(spot, py - day, 1, 110)
    _put(spot, py - 2 * day, 1, 100)
    _put(spot, missed, 10, 1)
    _put(spot, missed + 22 * day, 12, 1)
    trades = c.signal_trades(spot)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("spot was bought without an up day after a down day")
    want = _long(Decimal(10), Decimal(12))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg long moved")
    wrecked = dict(spot)
    wrecked[entry] = (100.0, wrecked[entry][1])
    if [t["entry_ms"] for t in c.signal_trades(wrecked)] != [entry]:
        raise SystemExit("the entry open moved a buy")
    pool = {stamp for stamp, _exit in c.pool_spans(spot)}
    if entry not in pool or missed not in pool:
        raise SystemExit("the null dropped a twenty-two-day long")
    if c.signal_trades({c.fp5.SCREEN_END_MS: (100.0, 100.0)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_flip()
    print("fp253 pins ok")


if __name__ == "__main__":
    main()
