from __future__ import annotations

"""Pins for the fp155 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def test_session_not_the_next_open() -> None:
    if c.IDEA != "TAKSESS":
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    bars = {entry: (100.0, 103.0), entry + c.fp5.DAY_MS: (90.0, 90.0)}
    trades = c.signal_trades({signal: (1.1,)}, bars)
    if len(trades) != 1 or trades[0]["exit_ms"] != entry:
        raise SystemExit("the exit was not that day's close")
    fee = Decimal("0.001")
    want = (Decimal(103) * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the session fill moved")
    if abs(trades[0]["net"] - c.fp5.net_return(100.0, 90.0)) < 1e-9:
        raise SystemExit("the next open replaced the close")
    if c.signal_trades({signal: (1.0,)}, bars):
        raise SystemExit("a ratio of one fired")
    if c.signal_trades({signal: (0.4,)}, bars):
        raise SystemExit("sellers in the majority were bought")
    if c.signal_trades({c.fp5.SCREEN_END_MS: (2.0,)}, bars):
        raise SystemExit("a 2024 ratio was an entry")


def main() -> None:
    test_session_not_the_next_open()
    print("fp155 pins ok")


if __name__ == "__main__":
    main()
