from __future__ import annotations

"""Pins for the fp156 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def test_overnight_uses_the_close() -> None:
    if c.IDEA != "OINIGHT":
        raise SystemExit("the idea moved")
    day = c.fp5.SCREEN_START_MS
    nxt = day + c.fp5.DAY_MS
    # open, close. The fill buys the close, not the open.
    bars = {day: (50.0, 100.0), nxt: (101.0, 80.0)}
    trades = c.signal_trades({day: (10.0, 12.0)}, bars)
    if len(trades) != 1 or trades[0]["entry_ms"] != day or trades[0]["exit_ms"] != nxt:
        raise SystemExit("the overnight bounds moved")
    fee = Decimal("0.001")
    want = (Decimal(101) * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the overnight fill moved")
    if abs(trades[0]["net"] - c.fp5.net_return(50.0, 101.0)) < 1e-9:
        raise SystemExit("the open replaced the close")
    if c.signal_trades({day: (12.0, 12.0)}, bars):
        raise SystemExit("a flat open-interest day fired")
    if c.signal_trades({day: (12.0, 9.0)}, bars):
        raise SystemExit("a falling open-interest day was bought")
    if c.signal_trades({day: (0.0, 5.0)}, bars):
        raise SystemExit("a non-positive first print fired")
    if c.signal_trades({c.fp5.SCREEN_END_MS: (1.0, 2.0)}, bars):
        raise SystemExit("a 2024 day was an entry")


def main() -> None:
    test_overnight_uses_the_close()
    print("fp156 pins ok")


if __name__ == "__main__":
    main()
