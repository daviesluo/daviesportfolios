from __future__ import annotations

"""Pins for the fp189 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

def test_funding_gap() -> None:
    if c.IDEA != "UMLT" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    bars = {entry: (100.0, 102.0)}
    step = c.fp5.EIGHT_H_MS
    um = {signal: 0.001, signal + step: 0.002}
    cm = {signal: 0.0005, signal + step: 0.003}
    trades = c.signal_trades(bars, (um, cm))
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the last aligned bucket did not fill")
    um16 = dict(um)
    cm16 = dict(cm)
    um16[signal + 2 * step] = 0.004
    cm16[signal + 2 * step] = 0.003
    if c.signal_trades(bars, (um16, cm16)):
        raise SystemExit("an earlier bucket outranked the last one")
    tied = {signal: 0.0005, signal + step: 0.002}
    if c.signal_trades(bars, (um, tied)):
        raise SystemExit("an equal rate fired")
    if trades[0]["pnl"] == trades[0]["net"]:
        raise SystemExit("the dollar result dropped the hundred")


def main() -> None:
    test_funding_gap()
    print("fp189 pins ok")


if __name__ == "__main__":
    main()
