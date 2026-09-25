from __future__ import annotations

"""Pins for the fp157 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def test_five_day_close_two_day_hold() -> None:
    if c.IDEA != "MOM5" or c.HORIZON != 5 or c.HOLD_DAYS != 2:
        raise SystemExit("the horizon or the hold moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    earlier = signal - 5 * c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    exit_ms = entry + 2 * c.fp5.DAY_MS
    one_day = entry + c.fp5.DAY_MS
    # open, close. The close decides. The opens fill.
    bars = {
        earlier: (999.0, 100.0),
        signal: (1.0, 110.0),
        entry: (100.0, 1.0),
        one_day: (50.0, 1.0),
        exit_ms: (102.0, 1.0),
    }
    trades = c.signal_trades(bars)
    if len(trades) != 1 or trades[0]["exit_ms"] != exit_ms:
        raise SystemExit("the hold is not two days")
    fee = Decimal("0.001")
    want = (Decimal(102) * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the two-day fill moved")
    if abs(trades[0]["net"] - c.fp5.net_return(100.0, 50.0)) < 1e-9:
        raise SystemExit("a one-day hold replaced the two-day hold")
    flat = dict(bars)
    flat[signal] = (1.0, 100.0)
    if c.signal_trades(flat):
        raise SystemExit("a close equal to five days ago fired")
    down = dict(bars)
    down[signal] = (500.0, 90.0)
    if c.signal_trades(down):
        raise SystemExit("a lower close fired because the open was higher")
    missing = dict(bars)
    del missing[earlier]
    if c.signal_trades(missing):
        raise SystemExit("a missing close five days back was filled in")


def main() -> None:
    test_five_day_close_two_day_hold()
    print("fp157 pins ok")


if __name__ == "__main__":
    main()
