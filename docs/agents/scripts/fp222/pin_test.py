from __future__ import annotations

"""Pins for the fp222 rule. No file and no return from 2023 is read."""

import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _net(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def test_friday_is_a_seven_day_long() -> None:
    if c.IDEA != "FRI7" or c.MIN_N != 30 or c.HOLD_DAYS != 7:
        raise SystemExit("the idea moved")
    start = c.fp5.SCREEN_START_MS
    if datetime.fromtimestamp(start / 1000, timezone.utc).weekday() != 6:
        raise SystemExit("2023-01-01 was not a Sunday")
    friday = start + 5 * c.fp5.DAY_MS
    nxt = friday + 7 * c.fp5.DAY_MS
    monday = start + c.fp5.DAY_MS
    um = {
        friday: (100.0,),
        nxt: (120.0,),
        monday: (100.0,),
        monday + 7 * c.fp5.DAY_MS: (50.0,),
    }
    trades = c.signal_trades(um)
    if len(trades) != 1 or trades[0]["entry_ms"] != friday or trades[0]["exit_ms"] != nxt:
        raise SystemExit("Friday did not fill through the next Friday")
    if trades[0]["exit_ms"] - trades[0]["entry_ms"] != 7 * c.fp5.DAY_MS:
        raise SystemExit("the hold is not seven days")
    if trades[0]["exit_ms"] - trades[0]["entry_ms"] == 4 * c.fp5.DAY_MS:
        raise SystemExit("the hold is the Monday rule")
    want = _net(Decimal(100), Decimal(120))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg fill moved")
    if abs(trades[0]["gross"] - (120.0 / 100.0 - 1.0)) > 1e-12:
        raise SystemExit("the gross is not the one leg")
    if len(c.pool_nets(um)) != 2:
        raise SystemExit("the null is not every seven-day long")
    if c.signal_trades({c.fp5.SCREEN_END_MS: (100.0,), c.fp5.SCREEN_END_MS + 7 * c.fp5.DAY_MS: (120.0,)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_friday_is_a_seven_day_long()
    print("fp222 pins ok")


if __name__ == "__main__":
    main()
