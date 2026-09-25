from __future__ import annotations

"""Pins for the fp188 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

def test_cm_under() -> None:
    if c.IDEA != "XBOOK" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    bars = {entry: (100.0, 101.0)}
    trades = c.signal_trades(bars, ({signal: (11.0,)}, {signal: (10.0,)}))
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the next session did not fill")
    if c.signal_trades(bars, ({signal: (10.0,)}, {signal: (10.0,)})):
        raise SystemExit("an equal close fired")
    if c.signal_trades(bars, ({signal: (10.0,)}, {signal: (11.0,)})):
        raise SystemExit("a richer coin-margined close fired")
    if c.signal_trades(bars, ({signal: (11.0,)}, {})):
        raise SystemExit("a missing leg fired")


def main() -> None:
    test_cm_under()
    print("fp188 pins ok")


if __name__ == "__main__":
    main()
