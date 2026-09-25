"""Pins for the fp35 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    nxt = start + c.fp5.DAY_MS
    # Yesterday VWAP = 200/2 = 100. Today's open is 110. A close is not stored.
    daily = {start: (100.0, 2.0, 200.0), nxt: (110.0, 9.0, 900.0)}
    if not near(c.vwap_at(daily, nxt), 0.1):
        raise SystemExit("an open 10% above yesterday's VWAP was not 0.1")
    daily[start] = (100.0, 4.0, 400.0)
    if not near(c.vwap_at(daily, nxt), 0.1):
        raise SystemExit("scaling yesterday's volume changed the VWAP")
    daily[start] = (100.0, 2.0, 160.0)
    if not near(c.vwap_at(daily, nxt), 110.0 / 80.0 - 1.0):
        raise SystemExit("the open was measured against a close instead of VWAP")
    if c.vwap_at({nxt: (110.0, 1.0, 100.0)}, nxt) is not None:
        raise SystemExit("a missing yesterday was a print")
    later_day = c.fp5.SCREEN_END_MS
    later = {
        later_day - c.fp5.DAY_MS: (1.0, 2.0, 200.0),
        later_day: (110.0, 0.0, 0.0),
    }
    if c.vwap_at(later, later_day) is not None:
        raise SystemExit("a 2024 day was a print")
    later[later_day] = (110.0, 1.0, 100.0)
    if not near(c.vwap_at(later, later_day, later_day + c.fp5.DAY_MS), 0.1):
        raise SystemExit("a later horizon still dropped the 2024 day")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.02)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    daily = {}
    for i in range(121):
        daily[start + i * c.fp5.DAY_MS] = (100.0, 2.0, 200.0)
    last = start + 120 * c.fp5.DAY_MS
    daily[last] = (110.0, 2.0, 200.0)
    if c.vwap_signal_days(daily) != [last]:
        raise SystemExit("an open above yesterday's VWAP did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily[entry] = (100.0, 2.0, 200.0)
    daily[exit_] = (101.0, 2.0, 200.0)
    untouched = c.vwap_at(daily, last)
    daily[entry] = (50.0, 2.0, 200.0)
    if c.vwap_at(daily, last) != untouched:
        raise SystemExit("the entry open leaked into the signal")
    daily[entry] = (100.0, 2.0, 200.0)
    filled = [t for t in c.vwap_trades(daily) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit("entry must be the next daily open")
    if any(t["entry_ms"] == last for t in c.vwap_trades(daily)):
        raise SystemExit("the signal open was the entry")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail_and_fill()
    print("fp35 pins ok")


if __name__ == "__main__":
    main()
