from __future__ import annotations

"""Pins for the fp162 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def test_both_conditions() -> None:
    if c.IDEA != "ACCUM":
        raise SystemExit("the idea moved")
    day = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    later = entry + c.fp5.DAY_MS
    # open, close on the signal day. Opens fill the next day.
    bars = {day: (10.0, 9.0), entry: (100.0, 1.0), later: (101.0, 1.0)}
    trades = c.signal_trades({day: (5.0, 6.0)}, bars)
    if len(trades) != 1 or trades[0]["exit_ms"] - entry != c.fp5.DAY_MS:
        raise SystemExit("inventory up on a down day did not hold one day")
    fee = Decimal("0.001")
    want = (Decimal(101) * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the fill moved")
    if c.signal_trades({day: (6.0, 6.0)}, bars):
        raise SystemExit("flat open interest fired")
    up = dict(bars)
    up[day] = (9.0, 10.0)
    if c.signal_trades({day: (5.0, 6.0)}, up):
        raise SystemExit("an up day was treated as accumulation")
    if c.signal_trades({day: (0.0, 6.0)}, bars):
        raise SystemExit("a non-positive first print fired")


def main() -> None:
    test_both_conditions()
    print("fp162 pins ok")


if __name__ == "__main__":
    main()
