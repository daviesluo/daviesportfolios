from __future__ import annotations

"""Pins for the fp217 rule. No file and no return from 2023 is read."""

import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _net(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def test_monday_is_a_four_day_long() -> None:
    if c.IDEA != "MONX" or c.MIN_N != 30 or c.HOLD_DAYS != 4:
        raise SystemExit("the idea moved")
    start = c.fp5.SCREEN_START_MS
    if datetime.fromtimestamp(start / 1000, timezone.utc).weekday() != 6:
        raise SystemExit("2023-01-01 was not a Sunday")
    monday = start + c.fp5.DAY_MS
    friday = monday + 4 * c.fp5.DAY_MS
    tuesday = monday + c.fp5.DAY_MS
    um = {monday: (100.0,), friday: (110.0,), tuesday: (100.0,), tuesday + 4 * c.fp5.DAY_MS: (80.0,)}
    trades = c.signal_trades(um)
    if len(trades) != 1 or trades[0]["entry_ms"] != monday or trades[0]["exit_ms"] != friday:
        raise SystemExit("Monday did not fill through Friday")
    if trades[0]["exit_ms"] - trades[0]["entry_ms"] != 4 * c.fp5.DAY_MS:
        raise SystemExit("the hold is not four days")
    if trades[0]["exit_ms"] - trades[0]["entry_ms"] == c.fp5.DAY_MS:
        raise SystemExit("the hold is one day")
    want = _net(Decimal(100), Decimal(110))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg fill moved")
    if abs(trades[0]["gross"] - (110.0 / 100.0 - 1.0)) > 1e-12:
        raise SystemExit("the gross is not the one leg")
    if abs(trades[0]["gross"] - 2.0 * (110.0 / 100.0 - 1.0)) < 1e-12:
        raise SystemExit("the gross is two legs")
    if abs(trades[0]["pnl"] - 100.0 * trades[0]["net"]) > 1e-9:
        raise SystemExit("the dollar result is not a hundred dollars on the one leg")
    pool = c.pool_nets(um)
    if len(pool) != 2 or abs(pool[0] - float(want)) > 1e-12:
        raise SystemExit("the null is not every four-day long")
    if c.signal_trades({c.fp5.SCREEN_END_MS: (100.0,), c.fp5.SCREEN_END_MS + 4 * c.fp5.DAY_MS: (110.0,)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_monday_is_a_four_day_long()
    print("fp217 pins ok")


if __name__ == "__main__":
    main()
