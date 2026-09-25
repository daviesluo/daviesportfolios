"""Pins for the fp8 rules.

    python3 docs/agents/scripts/fp8/pin_test.py
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


def _bar(px: float) -> tuple:
    return (px, px, px, px, 1.0)


def test_roll() -> None:
    march = c._day(2023, 3, 31)
    june = c._day(2023, 6, 30)
    # 2023-03-23 + 7 days is 2023-03-30, and 31 March is still after that.
    if c.front_expiry(c._day(2023, 3, 23)) != march:
        raise SystemExit("23 March still uses the March contract")
    # 2023-03-24 + 7 days is 31 March, which is not strictly later.
    if c.front_expiry(c._day(2023, 3, 24)) != june:
        raise SystemExit("24 March has rolled to June")


def test_basis_cut() -> None:
    march = c._day(2023, 3, 31)
    day = c._day(2023, 3, 1)
    spot = {day: _bar(100.0)}
    if c.basis_days({march: {day: 99.7}}, spot) != [day]:
        raise SystemExit("more than a round trip cheap must fire")
    if c.basis_days({march: {day: 99.8}}, spot) != []:
        raise SystemExit("exactly one round trip cheap must not fire")
    if c.basis_days({march: {}}, spot) != []:
        raise SystemExit("a missing future close was scored")


def test_flow_and_hash() -> None:
    start = c.fp5.SCREEN_START_MS - 100 * c.fp5.DAY_MS
    days = [start + k * c.fp5.DAY_MS for k in range(91)]
    inflow = [(d, 1.0) for d in days]
    outflow = [(d, 2.0) for d in days[:-1]] + [(days[-1], 3.0)]
    if days[-1] not in c.flow_out_days(inflow, outflow):
        raise SystemExit("a larger net outflow must fire")
    outflow[-1] = (days[-1], 2.0)
    if days[-1] in c.flow_out_days(inflow, outflow):
        raise SystemExit("an unchanged net outflow must not fire")
    # A day with no inflow is not a point.
    if days[-1] in c.flow_out_days(inflow[:-1], outflow):
        raise SystemExit("a day missing inflow was scored")
    hashes = [(d, 100.0) for d in days[:-1]] + [(days[-1], 50.0)]
    if days[-1] not in c.hash_drop_days(hashes):
        raise SystemExit("a hash rate under the trailing 10th must fire")
    hashes[-1] = (days[-1], 100.0)
    if days[-1] in c.hash_drop_days(hashes):
        raise SystemExit("a hash rate equal to the 10th must not fire")
    if c.hash_drop_days([(days[-1], 0.0)]) != []:
        raise SystemExit("a non-positive hash rate was scored")


def test_fill_gate() -> None:
    day = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {day: _bar(1), entry: _bar(100), exit_: _bar(101)}
    trades = c.forward(daily, [day])
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    _eq(trades[0]["net"], sold / bought - 1, "fp8 fill")
    late = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    daily[late] = _bar(1)
    daily[c.fp5.SCREEN_END_MS] = _bar(100)
    daily[c.fp5.SCREEN_END_MS + c.fp5.DAY_MS] = _bar(101)
    if len(c.forward(daily, [day, late])) != 1:
        raise SystemExit("a 2024 entry was scored")


def main() -> None:
    test_roll()
    test_basis_cut()
    test_flow_and_hash()
    test_fill_gate()
    print("fp8 pins ok")


if __name__ == "__main__":
    main()
