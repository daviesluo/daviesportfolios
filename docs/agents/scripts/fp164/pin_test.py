from __future__ import annotations

"""Pins for the fp164 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(open_px: float, high: float, low: float, close_px: float) -> tuple:
    return (open_px, high, low, close_px)


def test_stop_entry_on_a_wide_day() -> None:
    if c.IDEA != "BRKHI":
        raise SystemExit("the idea moved")
    day = c.fp5.SCREEN_START_MS
    # Three quiet days, then a wide day that trades through yesterday's high.
    bars = {
        day - 3 * c.fp5.DAY_MS: _bar(10, 11, 10, 10),
        day - 2 * c.fp5.DAY_MS: _bar(10, 11, 10, 10),
        day - c.fp5.DAY_MS: _bar(10, 100, 99, 100),
        day: _bar(99, 105, 90, 101),
    }
    trades = c.signal_trades(bars)
    if len(trades) != 1 or trades[0]["entry_ms"] != day or trades[0]["exit_ms"] != day:
        raise SystemExit("the wide break did not sell the close")
    fee = Decimal("0.001")
    want = (Decimal(101) * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the fill did not buy yesterday's high")
    if abs(trades[0]["net"] - c.fp5.net_return(99.0, 101.0)) < 1e-9:
        raise SystemExit("the open replaced the broken high")
    gapped = dict(bars)
    gapped[day] = _bar(102, 105, 90, 104)
    gap_trade = c.signal_trades(gapped)[0]
    want_gap = (Decimal(104) * (1 - fee)) / (Decimal(102) * (1 + fee)) - 1
    if abs(gap_trade["net"] - float(want_gap)) > 1e-12:
        raise SystemExit("a gap through the high did not buy the open")
    quiet = dict(bars)
    quiet[day] = _bar(99, 105, 104, 105)
    if c.signal_trades(quiet):
        raise SystemExit("a day that was not the widest was bought")
    flat = dict(bars)
    flat[day] = _bar(99, 100, 90, 99)
    if c.signal_trades(flat):
        raise SystemExit("a high equal to yesterday fired")


def main() -> None:
    test_stop_entry_on_a_wide_day()
    print("fp164 pins ok")


if __name__ == "__main__":
    main()
