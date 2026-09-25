from __future__ import annotations

"""Pins for the fp166 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def test_ten_day_volume_three_day_hold() -> None:
    if c.IDEA != "VOL3" or c.HORIZON != 10 or c.HOLD_DAYS != 3:
        raise SystemExit("the horizon or the hold moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    earlier = signal - 10 * c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    exit_ms = entry + 3 * c.fp5.DAY_MS
    bars = {
        earlier: (1.0, 5.0),
        signal: (1.0, 9.0),
        entry: (100.0, 1.0),
        entry + c.fp5.DAY_MS: (50.0, 1.0),
        entry + 2 * c.fp5.DAY_MS: (50.0, 1.0),
        exit_ms: (103.0, 1.0),
    }
    trades = c.signal_trades(bars)
    if len(trades) != 1 or trades[0]["exit_ms"] != exit_ms:
        raise SystemExit("the hold is not three days")
    fee = Decimal("0.001")
    want = (Decimal(103) * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the three-day fill moved")
    if abs(trades[0]["net"] - c.fp5.net_return(100.0, 50.0)) < 1e-9:
        raise SystemExit("a one-day hold replaced the three-day hold")
    flat = dict(bars)
    flat[signal] = (1.0, 5.0)
    if c.signal_trades(flat):
        raise SystemExit("an equal volume fired")
    missing = dict(bars)
    del missing[earlier]
    if c.signal_trades(missing):
        raise SystemExit("a missing day ten days back was filled in")


def main() -> None:
    test_ten_day_volume_three_day_hold()
    print("fp166 pins ok")


if __name__ == "__main__":
    main()
