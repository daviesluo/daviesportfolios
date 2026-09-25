from __future__ import annotations

"""Pins for the fp165 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def test_failed_break_is_a_short() -> None:
    if c.IDEA != "FAILSH":
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    prev = signal - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    later = entry + c.fp5.DAY_MS
    # open, high, close
    bars = {
        prev: (90.0, 100.0, 95.0),
        signal: (99.0, 110.0, 98.0),
        entry: (50.0, 55.0, 51.0),
        later: (49.0, 49.0, 49.0),
    }
    trades = c.signal_trades(bars)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("a failed break did not short the next open")
    if trades[0]["exit_ms"] - trades[0]["entry_ms"] != c.fp5.DAY_MS:
        raise SystemExit("the hold is not one day")
    fee = Decimal("0.001")
    want = (Decimal(50) * (1 - fee)) / (Decimal(49) * (1 + fee)) - 1
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the short fill moved")
    if abs(trades[0]["net"] - c.fp5.net_return(50.0, 49.0)) < 1e-9:
        raise SystemExit("the short collapsed to a long")
    held = dict(bars)
    held[signal] = (99.0, 110.0, 100.0)
    if c.signal_trades(held):
        raise SystemExit("a close on yesterday's high was a failure")
    no_break = dict(bars)
    no_break[signal] = (99.0, 100.0, 90.0)
    if c.signal_trades(no_break):
        raise SystemExit("a high that did not clear yesterday fired")


def main() -> None:
    test_failed_break_is_a_short()
    print("fp165 pins ok")


if __name__ == "__main__":
    main()
