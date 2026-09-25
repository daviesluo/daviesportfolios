"""Pins for the fp14 rule. No file and no return from 2023 is read.

    python3 docs/agents/scripts/fp14/pin_test.py
"""

from __future__ import annotations

import statistics
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

COINS = c.fp5.BASKET[:10]


def _bar(open_px: float, close_px: float) -> tuple:
    return (open_px, open_px, open_px, close_px, 1.0)


def _hand(returns: list[float]) -> float:
    n = len(returns)
    mean = sum(returns) / n
    m2 = sum((x - mean) ** 2 for x in returns) / n
    m3 = sum((x - mean) ** 3 for x in returns) / n
    return m3 / (m2 ** 1.5)


def test_formula() -> None:
    returns = [0.0] * 9 + [1.0]
    got = c.population_skew(returns)
    if got is None or abs(got - (8.0 / 3.0)) > 1e-12 or abs(got - _hand(returns)) > 1e-12:
        raise SystemExit(f"skew is not the population third moment: {got}")
    if abs(statistics.pstdev(returns) - (8.0 / 3.0)) < 1e-9:
        raise SystemExit("the print collapsed to dispersion")
    if c.population_skew([0.01] * 10) is not None:
        raise SystemExit("zero variance was scored")
    symmetric = [0.01] * 5 + [-0.01] * 5
    if c.population_skew(symmetric) != 0.0:
        raise SystemExit("a symmetric book was not zero")


def _book(start: int, n_bars: int, last_kind: str) -> dict[str, dict[int, tuple]]:
    """n_bars of 8h closes. Earlier bars are symmetric. The last bar is named."""
    book = {coin: {} for coin in COINS}
    closes = {coin: 100.0 for coin in COINS}
    for i in range(n_bars):
        ts = start + i * c.fp5.EIGHT_H_MS
        kind = "base" if i < n_bars - 1 else last_kind
        for j, coin in enumerate(COINS):
            prev = closes[coin]
            if kind == "base":
                closes[coin] = prev * (1.01 if j < 5 else 0.99)
            elif kind == "flat":
                closes[coin] = prev
            elif kind == "right":
                closes[coin] = prev * (2.0 if j == 9 else 1.0)
            elif kind == "left":
                closes[coin] = prev * (0.5 if j == 9 else 1.0)
            else:
                raise SystemExit(f"unknown kind {kind}")
            book[coin][ts] = _bar(100.0, closes[coin])
    return book


def test_tail_and_count() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    right = _book(start, 92, "right")
    prints = c.skew_prints(right)
    if abs(prints[-1][1] - (8.0 / 3.0)) > 1e-9:
        raise SystemExit(f"the right-tail print is not 8/3: {prints[-1][1]}")
    if prints[-1][0] not in c.skew_entries(right):
        raise SystemExit("a right tail above its own 90th must fire")
    left = _book(start, 92, "left")
    if prints[-1][0] in c.skew_entries(left):
        raise SystemExit("the left tail was scored")
    same = _book(start, 92, "base")
    if c.skew_prints(same)[-1][0] in c.skew_entries(same):
        raise SystemExit("a print equal to its own 90th fired")
    short = {coin: dict(right[coin]) for coin in COINS[:9]}
    if c.skew_prints(short):
        raise SystemExit("nine coins were scored")
    gapped = {coin: dict(right[coin]) for coin in COINS}
    drop = start + 50 * c.fp5.EIGHT_H_MS
    for coin in COINS:
        del gapped[coin][drop]
    if any(ts == drop + c.fp5.EIGHT_H_MS for ts, _ in c.skew_prints(gapped)):
        raise SystemExit("a bar with no previous print was scored")


def test_window_and_fill() -> None:
    # The print known at the 2024 boundary is not an entry.
    t = c.fp5.SCREEN_END_MS - 92 * c.fp5.EIGHT_H_MS
    book = _book(t, 92, "right")
    if c.fp5.SCREEN_END_MS not in c.skew_entries(book):
        raise SystemExit("the boundary print should be an entry candidate")
    if c.skew_trades(book):
        raise SystemExit("an entry at 2024-01-01 was kept")
    # An in-screen entry uses the next open and fp5's fill.
    entry = c.fp5.SCREEN_START_MS + 10 * c.fp5.DAY_MS
    start = entry - 92 * c.fp5.EIGHT_H_MS
    live = _book(start, 92, "right")
    if c.skew_prints(live)[-1][0] != entry:
        raise SystemExit("the print is not stamped at the bar's close")
    btc = live["BTCUSDT"]
    # The print is stamped one bar after the last close. Those opens are the fill.
    btc[entry] = _bar(100.0, 100.0)
    btc[entry + c.fp5.EIGHT_H_MS] = _bar(101.0, 101.0)
    filled = c.skew_trades(live)
    if len(filled) != 1 or filled[0]["entry_ms"] != entry:
        raise SystemExit(f"entry must be the open at the print: {filled}")
    if filled[0]["exit_ms"] != entry + c.fp5.EIGHT_H_MS:
        raise SystemExit("the hold is not one 8h bar")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-9:
        raise SystemExit("the fill is not fp5's")
    del btc[entry + c.fp5.EIGHT_H_MS]
    if c.skew_trades(live):
        raise SystemExit("a hold crossed a missing bar")
    later = {coin: {c.fp5.SCREEN_END_MS: _bar(100.0, 110.0)} for coin in COINS}
    prev = c.fp5.SCREEN_END_MS - c.fp5.EIGHT_H_MS
    for coin in COINS:
        later[coin][prev] = _bar(100.0, 100.0)
    if c.skew_prints(later):
        raise SystemExit("a bar opened in 2024 was scored")


def main() -> None:
    test_formula()
    test_tail_and_count()
    test_window_and_fill()
    print("fp14 pins ok")


if __name__ == "__main__":
    main()
