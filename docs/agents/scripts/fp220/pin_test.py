from __future__ import annotations

"""Pins for the fp220 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _net(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def _book(entry: int, downs: int, flat: int = 0) -> dict:
    book = {}
    for k in range(1, 8):
        day = entry - k * c.fp5.DAY_MS
        if k <= downs:
            book[day] = (100.0, 90.0)
        elif k <= downs + flat:
            book[day] = (100.0, 100.0)
        else:
            book[day] = (100.0, 110.0)
    book[entry] = (50.0, 40.0)
    book[entry + 7 * c.fp5.DAY_MS] = (80.0, 70.0)
    return book


def test_five_down_sessions_hold_seven_days() -> None:
    if c.IDEA != "BRD" or c.MIN_N != 30 or c.HOLD_DAYS != 7 or c.DOWN_DAYS != 5:
        raise SystemExit("the idea moved")
    entry = c.fp5.SCREEN_START_MS + 10 * c.fp5.DAY_MS
    other = entry + 16 * c.fp5.DAY_MS
    um = _book(entry, 5)
    um.update(_book(other, 4))
    trades = c.signal_trades(um)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("five down sessions did not fill")
    if trades[0]["exit_ms"] - trades[0]["entry_ms"] != 7 * c.fp5.DAY_MS:
        raise SystemExit("the hold is not seven days")
    want = _net(Decimal(50), Decimal(80))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg fill moved")
    if abs(trades[0]["gross"] - (80.0 / 50.0 - 1.0)) > 1e-12:
        raise SystemExit("the gross is not the seven-day open")
    if abs(trades[0]["gross"] - (90.0 / 100.0 - 1.0)) < 1e-9:
        raise SystemExit("the gross is a signal-day body")
    flat = _book(entry, 4, flat=1)
    if c.signal_trades(flat):
        raise SystemExit("an equal session counted as down")
    spans = {day for day, _exit in c.pool_spans(um)}
    if entry not in spans or other not in spans or len(c.pool_nets(um)) <= 1:
        raise SystemExit("the null dropped the four-down day")
    late = c.fp5.SCREEN_END_MS
    if c.signal_trades(_book(late, 5)):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_five_down_sessions_hold_seven_days()
    print("fp220 pins ok")


if __name__ == "__main__":
    main()
