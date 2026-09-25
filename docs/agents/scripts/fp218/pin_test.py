from __future__ import annotations

"""Pins for the fp218 rule. No file and no return from 2023 is read."""

import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _net(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def test_the_first_week_is_held_to_the_next_month() -> None:
    if c.IDEA != "MTH" or c.MIN_N != 30 or c.HOLD_MIN != 22 or c.POOL_MIN != 7:
        raise SystemExit("the idea moved")
    start = c.fp5.SCREEN_START_MS
    day3 = start + 2 * c.fp5.DAY_MS
    if datetime.fromtimestamp(day3 / 1000, timezone.utc).day != 3:
        raise SystemExit("the third of January moved")
    exit_ms = c._next_month(day3)
    if datetime.fromtimestamp(exit_ms / 1000, timezone.utc).day != 1:
        raise SystemExit("the exit is not the next month")
    day20 = start + 19 * c.fp5.DAY_MS
    day28 = start + 27 * c.fp5.DAY_MS
    feb1 = exit_ms
    um = {day3: (100.0,), day20: (50.0,), day28: (70.0,), feb1: (90.0,)}
    trades = c.signal_trades(um)
    if len(trades) != 1 or trades[0]["entry_ms"] != day3 or trades[0]["exit_ms"] != feb1:
        raise SystemExit("the first week did not hold to the next month")
    hold = (trades[0]["exit_ms"] - trades[0]["entry_ms"]) // c.fp5.DAY_MS
    if hold < 22 or hold > 31 or hold == 1:
        raise SystemExit("the month hold moved")
    want = _net(Decimal(100), Decimal(90))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg fill moved")
    if abs(trades[0]["gross"] - (90.0 / 100.0 - 1.0)) > 1e-12:
        raise SystemExit("the gross is not the one leg")
    spans = {entry for entry, _exit in c.pool_spans(um)}
    if day3 not in spans or day20 not in spans or day28 in spans:
        raise SystemExit("the null is not every long-enough month hold")
    if len(c.pool_nets(um)) <= len(trades):
        raise SystemExit("the null is not larger than the rule")
    if c.signal_trades({c.fp5.SCREEN_END_MS: (100.0,)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_the_first_week_is_held_to_the_next_month()
    print("fp218 pins ok")


if __name__ == "__main__":
    main()
