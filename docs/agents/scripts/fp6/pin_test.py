"""Pins for the fp6 rules. Expected numbers are computed here, not copied out of the scorer.

    python3 docs/agents/scripts/fp6/pin_test.py
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


def test_thresholds_are_the_fee() -> None:
    if c.USDC_CHEAP != 0.998 or c.GAP_CHEAP != -0.002:
        raise SystemExit("the cheap cuts moved off one round trip")
    if c.usdc_cheap_days({1: _bar(0.997)}) != [1]:
        raise SystemExit("a close under 0.998 must fire")
    if c.usdc_cheap_days({1: _bar(0.998)}) != []:
        raise SystemExit("par minus exactly one round trip does not fire")


def test_gap_needs_both_closes() -> None:
    usdc = {10: (99.7, 99.7, 99.7, 99.7, 1.0), 20: (99.9, 99.9, 99.9, 99.9, 1.0)}
    usdt = {10: _bar(100.0)}
    if c.gap_days(usdc, usdt) != [10]:
        raise SystemExit("only the day cheap by more than 20 bps, and only when both closes exist")
    # 99.8 / 100 - 1 = -0.002, which is the cut and does not fire.
    usdc[10] = (99.8, 99.8, 99.8, 99.8, 1.0)
    if c.gap_days(usdc, usdt) != []:
        raise SystemExit("exactly one round trip cheap does not fire")


def test_forward_uses_the_fp5_fill() -> None:
    day = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {day: _bar(1.0), entry: _bar(100.0), exit_: _bar(101.0)}
    trades = c.forward("USDCUSDT", daily, [day])
    if len(trades) != 1 or trades[0]["coin"] != "USDCUSDT":
        raise SystemExit(f"forward scored the wrong trade: {trades}")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    _eq(trades[0]["net"], sold / bought - 1, "forward fill")
    # An entry on 2024-01-01 is refused by the same gate.
    late_signal = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    daily[late_signal] = _bar(1.0)
    daily[c.fp5.SCREEN_END_MS] = _bar(100.0)
    daily[c.fp5.SCREEN_END_MS + c.fp5.DAY_MS] = _bar(101.0)
    if c.forward("USDCUSDT", daily, [day, late_signal]) != trades:
        raise SystemExit("a 2024 entry was scored")


def test_fund_gap_one_trade() -> None:
    settle = c.fp5.SCREEN_START_MS - c.fp5.EIGHT_H_MS
    binance = []
    deribit = {}
    for k in range(1, 101):
        ts = settle - k * c.fp5.EIGHT_H_MS
        binance.append((ts, 0.0002))
        deribit[ts] = 0.0001
    binance.append((settle, 0.0))
    deribit[settle] = 0.001  # difference -0.001, below a history of +0.0001
    entry = c.fp5.SCREEN_START_MS
    exit_ = entry + c.fp5.EIGHT_H_MS
    bars = {entry: _bar(100.0), exit_: _bar(110.0)}
    trades = c.fund_gap_trades(binance, deribit, bars)
    if len(trades) != 1:
        raise SystemExit(f"expected one funding-gap trade, got {len(trades)}")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(110) * Decimal("0.999")
    _eq(trades[0]["net"], sold / bought - 1, "funding gap fill")
    # Equal to the threshold does not fire: rebuild with the same difference as history.
    binance[-1] = (settle, 0.0002)
    deribit[settle] = 0.0001
    if c.fund_gap_trades(binance, deribit, bars) != []:
        raise SystemExit("a difference equal to its own 10th must not fire")
    # A missing Deribit stamp is a skip, not a shifted neighbour.
    binance[-1] = (settle, 0.0)
    del deribit[settle]
    if c.fund_gap_trades(binance, deribit, bars) != []:
        raise SystemExit("a settlement with no Deribit row was scored")


def test_monday_and_quiet() -> None:
    monday = 1_672_617_600_000  # 2023-01-02
    sunday = monday - c.fp5.DAY_MS
    if c.fp5._utc_weekday(monday) != 0:
        raise SystemExit("2023-01-02 is Monday")
    daily = {
        sunday: _bar(100.0),
        monday: (100.0, 101.0, 99.0, 100.0, 1.0),
        monday + c.fp5.DAY_MS: _bar(110.0),
    }
    trades = c.weekday_entries(daily, 0)
    if len(trades) != 1 or trades[0]["entry_ms"] != monday:
        raise SystemExit(f"Monday was not the entry: {trades}")
    sunday_trades = c.weekday_entries(daily, 6)
    if len(sunday_trades) != 1 or sunday_trades[0]["entry_ms"] != sunday:
        raise SystemExit(f"Sunday was not its own day: {sunday_trades}")
    if any(t["entry_ms"] == sunday for t in trades):
        raise SystemExit("Sunday's open was scored as Monday")
    # Ninety identical ranges of 0.02, then a day of 0.01, must fire. A day of 0.02 must not.
    start = c.fp5.SCREEN_START_MS - 100 * c.fp5.DAY_MS
    series = {}
    for k in range(90):
        day = start + k * c.fp5.DAY_MS
        series[day] = (100.0, 101.0, 99.0, 100.0, 1.0)  # range 0.02
    signal = start + 90 * c.fp5.DAY_MS
    series[signal] = (100.0, 100.5, 99.5, 100.0, 1.0)  # range 0.01
    entry = signal + c.fp5.DAY_MS
    series[entry] = _bar(100.0)
    series[entry + c.fp5.DAY_MS] = _bar(100.0)
    if signal not in c.quiet_days(series):
        raise SystemExit("a range under the trailing 10th must fire")
    series[signal] = (100.0, 101.0, 99.0, 100.0, 1.0)
    if signal in c.quiet_days(series):
        raise SystemExit("a range equal to the trailing 10th must not fire")


def main() -> None:
    test_thresholds_are_the_fee()
    test_gap_needs_both_closes()
    test_forward_uses_the_fp5_fill()
    test_fund_gap_one_trade()
    test_monday_and_quiet()
    print("fp6 pins ok")


if __name__ == "__main__":
    main()
