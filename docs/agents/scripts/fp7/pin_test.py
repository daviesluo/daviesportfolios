"""Pins for the fp7 rules.

    python3 docs/agents/scripts/fp7/pin_test.py
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _eq(got: float, expected: Decimal, label: str) -> None:
    if abs(got - float(expected)) > 1e-9:
        raise SystemExit(f"{label}: got {got} expected {expected}")


def _bar(px: float, vol: float = 1.0) -> tuple:
    return (px, px, px, px, vol)


def test_mvrv_line() -> None:
    if c.mvrv_days([(1, 0.99)]) != [1]:
        raise SystemExit("under 1 must fire")
    if c.mvrv_days([(1, 1.0), (2, 1.01)]) != []:
        raise SystemExit("1 and above must not fire")


def test_fill_and_the_2024_gate() -> None:
    day = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {day: _bar(1), entry: _bar(100), exit_: _bar(101)}
    trades = c.forward(daily, [day])
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    _eq(trades[0]["net"], sold / bought - 1, "fp7 fill")
    late = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    daily[late] = _bar(1)
    daily[c.fp5.SCREEN_END_MS] = _bar(100)
    daily[c.fp5.SCREEN_END_MS + c.fp5.DAY_MS] = _bar(101)
    if len(c.forward(daily, [day, late])) != 1:
        raise SystemExit("a 2024 entry was scored")


def test_upper_tail() -> None:
    start = c.fp5.SCREEN_START_MS - 100 * c.fp5.DAY_MS
    points = [(start + k * c.fp5.DAY_MS, 1.0) for k in range(90)]
    signal = start + 90 * c.fp5.DAY_MS
    if signal not in c.upper_tail_days(points + [(signal, 2.0)]):
        raise SystemExit("a value above a flat 90th must fire")
    if signal in c.upper_tail_days(points + [(signal, 1.0)]):
        raise SystemExit("a value equal to the 90th must not fire")


def test_share() -> None:
    start = c.fp5.SCREEN_START_MS - 100 * c.fp5.DAY_MS
    btc, eth = {}, {}
    for k in range(90):
        day = start + k * c.fp5.DAY_MS
        btc[day] = _bar(1, 50)
        eth[day] = _bar(1, 50)
    signal = start + 90 * c.fp5.DAY_MS
    btc[signal] = _bar(1, 90)
    eth[signal] = _bar(1, 10)
    if signal not in c.btc_share_days(btc, eth):
        raise SystemExit("a share above its trailing 90th must fire")
    btc[signal] = _bar(1, 50)
    eth[signal] = _bar(1, 50)
    if signal in c.btc_share_days(btc, eth):
        raise SystemExit("a share equal to its trailing 90th must not fire")
    # A day with no ETH bar is not a signal.
    del eth[signal]
    if signal in c.btc_share_days(btc, eth):
        raise SystemExit("a day missing ETH was scored")


def main() -> None:
    test_mvrv_line()
    test_fill_and_the_2024_gate()
    test_upper_tail()
    test_share()
    print("fp7 pins ok")


if __name__ == "__main__":
    main()
