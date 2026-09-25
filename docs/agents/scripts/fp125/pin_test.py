"""Pins for the fp125 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import datetime
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-12


def _expect_fill(trades: list[dict], entry: int) -> None:
    filled = [t for t in trades if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit("entry must be the next daily open")
    if filled[0]["exit_ms"] - filled[0]["entry_ms"] != c.fp5.DAY_MS:
        raise SystemExit("the hold is not one day")
    if filled[0]["coin"] != "BTCUSDT":
        raise SystemExit("the fill is not BTC")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")


def _parse_and_horizon(day: int) -> None:
    parsed = c.parse_contract("BTC-230929-30000-P")
    expiry = datetime.datetime(2023, 9, 29, tzinfo=datetime.timezone.utc)
    want = int((expiry - c.EPOCH).total_seconds() * 1000)
    if parsed != (want, 30000.0, 1):
        raise SystemExit("the put did not parse")
    call = c.parse_contract("BTC-230929-30000-C")
    if call is None or call[2] != 0 or call[1] != 30000.0:
        raise SystemExit("the call did not parse")
    if c.parse_contract("ETH-230929-30000-P") is not None:
        raise SystemExit("another coin parsed")
    day_ms = int((datetime.datetime(2023, 6, 1, tzinfo=datetime.timezone.utc) - c.EPOCH).total_seconds() * 1000)
    if not near(c.days_to_expiry("BTC-230929-30000-P", day_ms), 120.0):
        raise SystemExit("the days to expiry moved")
    later = c.fp5.SCREEN_END_MS
    if c.signal_at({later: (23, 1.0)}, later) is not None:
        raise SystemExit("a 2024 day was a print")
    if day != c.fp5.SCREEN_START_MS:
        raise SystemExit("the pin day moved")

def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    if c.IDEA != "DTE":
        raise SystemExit("the idea moved")
    row = (23, 10.0, 1.0, 23, 30.0, 3.0, 23, -5.0, 100.0)
    if not near(c.signal_at({day: row}, day), 25.0):
        raise SystemExit("the weighted days were wrong")
    if near(c.signal_at({day: row}, day), 20.0):
        raise SystemExit("the unweighted mean replaced the weight")
    if c.signal_at({day: (23, 10.0, 0.0)}, day) is not None:
        raise SystemExit("a zero weight was a print")
    _parse_and_horizon(day)


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.2) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.9)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    rows = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        rows[day] = (23, 0.2, 1.0)
    last = start + 120 * c.fp5.DAY_MS
    rows[last] = (23, 0.9, 1.0)
    if c.signal_days(rows) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    bars = {entry: (100.0,), exit_: (101.0,)}
    _expect_fill(c.signal_trades(rows, bars), entry)


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail_and_fill()
    print("fp125 pins ok")


if __name__ == "__main__":
    main()
