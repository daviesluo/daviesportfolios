"""Pins for the fp18 rule. No file and no return from 2023 is read.

    python3 docs/agents/scripts/fp18/pin_test.py
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(close_px: float, open_px: float = 100.0) -> tuple:
    return (open_px, open_px, open_px, close_px, 1.0)


def from_returns(start: int, returns: list[float], first_close: float = 100.0) -> dict[int, tuple]:
    """Bar i opens at `start + i days`. Its close-to-close return is `returns[i]`."""
    daily = {start - c.fp5.DAY_MS: _bar(first_close)}
    prev = first_close
    for i, ret in enumerate(returns):
        close = prev * (1.0 + ret)
        daily[start + i * c.fp5.DAY_MS] = _bar(close, open_px=prev)
        prev = close
    return daily


def _btc_path(n: int) -> list[float]:
    return [0.02 if i % 2 == 0 else -0.02 for i in range(n)]


def _eth_path(n: int) -> list[float]:
    return [0.03 if i % 3 == 0 else -0.015 for i in range(n)]


def test_formula() -> None:
    same = c.population_corr([1.0, 2.0, 3.0], [2.0, 4.0, 6.0])
    if same is None or abs(same - 1.0) > 1e-12:
        raise SystemExit(f"a scaled copy is not correlation 1: {same}")
    opposite = c.population_corr([1.0, 2.0, 3.0], [-1.0, -2.0, -3.0])
    if opposite is None or abs(opposite - (-1.0)) > 1e-12:
        raise SystemExit(f"the opposite path is not -1: {opposite}")
    if c.population_corr([1.0, 1.0, 1.0], [1.0, 2.0, 3.0]) is not None:
        raise SystemExit("a flat series was a correlation")
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    returns = _btc_path(40)
    # Same returns, different price level. The ratio of the two prices is not the signal.
    btc = from_returns(start, returns, 100.0)
    eth = from_returns(start, returns, 50.0)
    day = start + 39 * c.fp5.DAY_MS
    got = c.corr_at(btc, eth, day)
    if got is None or abs(got - 1.0) > 1e-12:
        raise SystemExit(f"identical returns were not correlation 1: {got}")
    flat = from_returns(start, [0.01] * 40, 80.0)
    if c.corr_at(btc, flat, day) is not None:
        raise SystemExit("a flat ETH window was a print")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.2) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.21)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")
    points[-1] = (points[-1][0], -0.5)
    if c._upper(points, 0.90):
        raise SystemExit("the low correlation was returned")
    ladder = [(i * c.fp5.DAY_MS, float(i)) for i in range(91)]
    last = ladder[-1][0]
    ladder[-1] = (last, 80.0)
    if c._upper(ladder, 0.90):
        raise SystemExit("a value equal to the 90th of a ladder fired")
    ladder[-1] = (last, 75.0)
    if last not in c._upper(ladder, 0.80):
        raise SystemExit("75 did not clear the 80th neighbour")
    if c._upper(ladder, 0.90):
        raise SystemExit("the 80th neighbour was treated as the screen cut")


def test_tail() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    btc_r = _btc_path(160)
    eth_r = _eth_path(160)
    eth_r[-c.WINDOW:] = btc_r[-c.WINDOW:]
    btc = from_returns(start, btc_r, 100.0)
    eth = from_returns(start, eth_r, 50.0)
    last = start + 159 * c.fp5.DAY_MS
    if last not in c.corr_signal_days(btc, eth):
        raise SystemExit("a window where the two coins match did not fire")
    if abs(c.corr_at(btc, eth, last) - 1.0) > 1e-9:
        raise SystemExit("the matched window was not correlation 1")
    # High and low are not inputs.
    marked = {t: (bar[0], 1e9, 1e-9, bar[3], bar[4]) for t, bar in btc.items()}
    if c.corr_prints(marked, eth) != c.corr_prints(btc, eth):
        raise SystemExit("the range moved the correlation")
    gapped = dict(eth)
    del gapped[last - 10 * c.fp5.DAY_MS]
    if c.corr_at(btc, gapped, last) is not None:
        raise SystemExit("a hole inside the window was scored")
    cold_eth = _btc_path(160)
    cold_eth[-c.WINDOW:] = [-r for r in btc_r[-c.WINDOW:]]
    cold = from_returns(start, cold_eth, 50.0)
    if last in c.corr_signal_days(btc, cold):
        raise SystemExit("the low correlation was scored")


def test_window_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    btc_r = _btc_path(160)
    eth_r = _eth_path(160)
    eth_r[-c.WINDOW:] = btc_r[-c.WINDOW:]
    btc = from_returns(start, btc_r, 100.0)
    eth = from_returns(start, eth_r, 50.0)
    signal = start + 159 * c.fp5.DAY_MS
    entry = signal + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    untouched = c.corr_at(btc, eth, signal)
    btc[entry] = _bar(100.0, open_px=100.0)
    btc[exit_] = _bar(101.0, open_px=101.0)
    eth[entry] = _bar(80.0, open_px=70.0)
    if c.corr_at(btc, eth, signal) != untouched:
        raise SystemExit("a later day leaked into the signal")
    filled = [t for t in c.corr_trades(btc, eth) if t["entry_ms"] == entry]
    if len(filled) != 1 or filled[0]["coin"] != "BTCUSDT":
        raise SystemExit(f"entry must be the next BTC open: {filled}")
    if filled[0]["exit_ms"] - filled[0]["entry_ms"] != c.fp5.DAY_MS:
        raise SystemExit("the hold is not one day")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")
    del btc[exit_]
    if any(t["entry_ms"] == entry for t in c.corr_trades(btc, eth)):
        raise SystemExit("a hold crossed a missing day")

    late_start = c.fp5.SCREEN_END_MS - 160 * c.fp5.DAY_MS
    late_btc_r = _btc_path(160)
    late_eth_r = _eth_path(160)
    late_eth_r[-c.WINDOW:] = late_btc_r[-c.WINDOW:]
    late_btc = from_returns(late_start, late_btc_r)
    late_eth = from_returns(late_start, late_eth_r, 50.0)
    boundary = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    if boundary not in c.corr_signal_days(late_btc, late_eth):
        raise SystemExit("the last 2023 signal should be a candidate")
    if any(t["entry_ms"] >= c.fp5.SCREEN_END_MS for t in c.corr_trades(late_btc, late_eth)):
        raise SystemExit("an entry at 2024-01-01 was kept")
    late_btc[c.fp5.SCREEN_END_MS] = _bar(1e6)
    late_eth[c.fp5.SCREEN_END_MS] = _bar(1e6)
    if any(ts >= c.fp5.SCREEN_END_MS for ts, _ in c.corr_prints(late_btc, late_eth)):
        raise SystemExit("a 2024 bar was a print")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail()
    test_window_and_fill()
    print("fp18 pins ok")


if __name__ == "__main__":
    main()
