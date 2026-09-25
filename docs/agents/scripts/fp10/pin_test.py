"""Pins for the fp10 rules. No file and no return from 2023 is read.

    python3 docs/agents/scripts/fp10/pin_test.py
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(close: float) -> tuple:
    return (close, close, close, close, 1.0)


def _eth(start: int, closes: list[float]) -> dict[int, tuple]:
    return {start + i * c.fp5.EIGHT_H_MS: _bar(close) for i, close in enumerate(closes)}


def _btc_hold(entry: int, entry_open: float, exit_open: float) -> dict[int, tuple]:
    return {
        entry: _bar(entry_open),
        entry + c.fp5.EIGHT_H_MS: _bar(exit_open),
    }


def test_eth_lead_fires_above_its_own_tail_and_holds_btc() -> None:
    entry = c.fp5.SCREEN_START_MS + 5 * c.fp5.DAY_MS
    wide_at = 96
    start = entry - (wide_at + 1) * c.fp5.EIGHT_H_MS
    closes = [100.0] * (wide_at + 3)
    closes[wide_at] = 120.0
    eth = _eth(start, closes)
    if entry not in c.eth_lead_entries(eth):
        raise SystemExit("a rich ETH bar must fire")
    btc = _btc_hold(entry, 100.0, 101.0)
    trades = c.eth_lead_trades(eth, btc)
    if len(trades) != 1 or trades[0]["coin"] != "BTCUSDT" or trades[0]["entry_ms"] != entry:
        raise SystemExit("the position is BTC at the print time")
    if trades[0]["exit_ms"] - trades[0]["entry_ms"] != c.fp5.EIGHT_H_MS:
        raise SystemExit("the hold is not one 8h bar")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(trades[0]["net"] - float(sold / bought - 1)) > 1e-9:
        raise SystemExit("the fill is not fp5's")
    flat = [100.0] * (wide_at + 3)
    flat[wide_at] = 80.0
    if entry in c.eth_lead_entries(_eth(start, flat)):
        raise SystemExit("the low tail was scored")


def test_eth_lead_equal_hole_and_window() -> None:
    entry = c.fp5.SCREEN_START_MS + 5 * c.fp5.DAY_MS
    wide_at = 96
    start = entry - (wide_at + 1) * c.fp5.EIGHT_H_MS
    level = [2.0 ** i for i in range(wide_at + 3)]
    if c.eth_lead_entries(_eth(start, level)):
        raise SystemExit("a return equal to the trailing 90th must not fire")
    closes = [100.0] * (wide_at + 3)
    closes[wide_at] = 120.0
    eth = _eth(start, closes)
    prev = start + (wide_at - 1) * c.fp5.EIGHT_H_MS
    del eth[prev]
    if entry in c.eth_lead_entries(eth):
        raise SystemExit("a missing previous bar was filled in")
    # Ninety ancient rich bars do not fill a short recent history.
    ancient_start = start - 200 * c.fp5.DAY_MS
    ancient = _eth(ancient_start, [100.0] * 10)
    ancient[ancient_start + 9 * c.fp5.EIGHT_H_MS] = _bar(150.0)
    recent = _eth(start, [100.0] * 10)
    recent[start + 9 * c.fp5.EIGHT_H_MS] = _bar(150.0)
    merged = {**ancient, **recent}
    spike = start + 10 * c.fp5.EIGHT_H_MS
    if spike in c.eth_lead_entries(merged):
        raise SystemExit("prints older than 90 days were counted")


def test_eth_lead_refuses_2024() -> None:
    t = c.fp5.SCREEN_END_MS - c.fp5.EIGHT_H_MS
    n_bars = 97
    start = t - (n_bars - 1) * c.fp5.EIGHT_H_MS
    closes = [100.0] * n_bars
    closes[-1] = 130.0
    eth = _eth(start, closes)
    if c.fp5.SCREEN_END_MS not in c.eth_lead_entries(eth):
        raise SystemExit("the boundary print should be an entry candidate")
    btc = _btc_hold(c.fp5.SCREEN_END_MS, 100.0, 101.0)
    if c.eth_lead_trades(eth, btc):
        raise SystemExit("an entry at 2024-01-01 was kept")
    # A bar that opens on the screen end is not a print.
    eth[c.fp5.SCREEN_END_MS] = _bar(200.0)
    if c.fp5.SCREEN_END_MS + c.fp5.EIGHT_H_MS in c.eth_lead_entries(eth):
        raise SystemExit("a 2024 bar was read")


def _days(start: int, n: int, value: float) -> list[tuple[int, float]]:
    return [(start + i * c.fp5.DAY_MS, value) for i in range(n)]


def test_tvl_change_and_tail() -> None:
    start = c.fp5.SCREEN_START_MS - 120 * c.fp5.DAY_MS
    points = _days(start, 92, 100.0)
    if c.tvl_signal_days(points):
        raise SystemExit("a flat TVL change must not fire")
    points[-1] = (points[-1][0], 110.0)
    if points[-1][0] not in c.tvl_signal_days(points):
        raise SystemExit("a rich TVL change must fire")
    got = [v for ts, v in c.tvl_changes(points) if ts == points[-1][0]]
    if len(got) != 1 or abs(got[0] - 0.1) > 1e-12:
        raise SystemExit(f"the change is not 110/100 − 1: {got}")
    down = list(points)
    down[-1] = (down[-1][0], 90.0)
    if down[-1][0] in c.tvl_signal_days(down):
        raise SystemExit("the low tail was scored")
    hole = [row for row in points if row[0] != points[-2][0]]
    if any(ts == points[-1][0] for ts, _ in c.tvl_changes(hole)):
        raise SystemExit("a missing day was filled in")
    dead = list(points)
    dead[-2] = (dead[-2][0], 0.0)
    if any(ts == points[-1][0] for ts, _ in c.tvl_changes(dead)):
        raise SystemExit("a non-positive TVL was scored")


def test_tvl_window_and_entry() -> None:
    start = c.fp5.SCREEN_START_MS - 400 * c.fp5.DAY_MS
    ancient = _days(start, 91, 100.0)
    ancient[-1] = (ancient[-1][0], 200.0)
    recent_start = start + 300 * c.fp5.DAY_MS
    recent = _days(recent_start, 11, 100.0)
    recent[-1] = (recent[-1][0], 200.0)
    if recent[-1][0] in c.tvl_signal_days(ancient + recent):
        raise SystemExit("changes older than 90 days were counted")
    signal = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    series = _days(signal - 100 * c.fp5.DAY_MS, 101, 100.0)
    series[-1] = (signal, 150.0)
    daily = {signal: _bar(100.0), c.fp5.SCREEN_END_MS: _bar(101.0), c.fp5.SCREEN_END_MS + c.fp5.DAY_MS: _bar(101.0)}
    if signal not in c.tvl_signal_days(series):
        raise SystemExit("the last 2023 change should be a signal")
    if c.tvl_trades(daily, series):
        raise SystemExit("the next open is 2024-01-01 and must not be an entry")
    entry = c.fp5.SCREEN_START_MS
    probe_signal = entry - c.fp5.DAY_MS
    probe = _days(probe_signal - 100 * c.fp5.DAY_MS, 101, 100.0)
    probe[-1] = (probe_signal, 150.0)
    probe_daily = {
        probe_signal: _bar(100.0),
        entry: _bar(100.0),
        entry + c.fp5.DAY_MS: _bar(101.0),
    }
    filled = c.tvl_trades(probe_daily, probe)
    if len(filled) != 1 or filled[0]["entry_ms"] != entry:
        raise SystemExit("entry must be the open after the signal day")
    later = [(c.fp5.SCREEN_END_MS - c.fp5.DAY_MS, 100.0), (c.fp5.SCREEN_END_MS, 500.0)]
    if c.tvl_changes(later):
        raise SystemExit("a 2024 TVL row was kept")


def main() -> None:
    test_eth_lead_fires_above_its_own_tail_and_holds_btc()
    test_eth_lead_equal_hole_and_window()
    test_eth_lead_refuses_2024()
    test_tvl_change_and_tail()
    test_tvl_window_and_entry()
    print("fp10 pins ok")


if __name__ == "__main__":
    main()
