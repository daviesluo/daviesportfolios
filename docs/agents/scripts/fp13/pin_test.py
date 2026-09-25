"""Pins for the fp13 rule. No file and no return from 2023 is read.

    python3 docs/agents/scripts/fp13/pin_test.py
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(px: float) -> tuple:
    return (px, px, px, px, 1.0)


def _flat(start: int, n: int, btc: float, eth: float) -> tuple[list, list]:
    days = [start + i * c.fp5.DAY_MS for i in range(n)]
    return [(d, btc) for d in days], [(d, eth) for d in days]


def test_spread_and_tail() -> None:
    start = c.fp5.SCREEN_START_MS - 120 * c.fp5.DAY_MS
    btc, eth = _flat(start, 100, 40.0, 50.0)
    if c.spread_signal_days(btc, eth):
        raise SystemExit("a flat spread must not fire")
    eth[-1] = (eth[-1][0], 60.0)
    got = [v for ts, v in c.spread_points(btc, eth) if ts == eth[-1][0]]
    if got != [20.0]:
        raise SystemExit(f"the spread is not ETH minus BTC: {got}")
    if eth[-1][0] not in c.spread_signal_days(btc, eth):
        raise SystemExit("a rich spread must fire")
    eth[-1] = (eth[-1][0], 30.0)
    if eth[-1][0] in c.spread_signal_days(btc, eth):
        raise SystemExit("the low tail was scored")
    # A day with no BTC print is not a point.
    if any(ts == eth[-1][0] for ts, _ in c.spread_points(btc[:-1], eth)):
        raise SystemExit("a day missing BTC was scored")


def test_window_and_entry() -> None:
    start = c.fp5.SCREEN_START_MS - 400 * c.fp5.DAY_MS
    ancient_btc, ancient_eth = _flat(start, 91, 40.0, 40.0)
    ancient_eth[-1] = (ancient_eth[-1][0], 80.0)
    recent_start = start + 300 * c.fp5.DAY_MS
    recent_btc, recent_eth = _flat(recent_start, 11, 40.0, 40.0)
    recent_eth[-1] = (recent_eth[-1][0], 80.0)
    if recent_eth[-1][0] in c.spread_signal_days(ancient_btc + recent_btc, ancient_eth + recent_eth):
        raise SystemExit("points older than 90 days were counted")
    signal = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    btc, eth = _flat(signal - 100 * c.fp5.DAY_MS, 101, 40.0, 40.0)
    eth[-1] = (signal, 90.0)
    daily = {
        signal: _bar(100.0),
        c.fp5.SCREEN_END_MS: _bar(101.0),
        c.fp5.SCREEN_END_MS + c.fp5.DAY_MS: _bar(101.0),
    }
    if signal not in c.spread_signal_days(btc, eth):
        raise SystemExit("the last 2023 spread should be a signal")
    if c.spread_trades(daily, btc, eth):
        raise SystemExit("the next open is 2024-01-01 and must not be an entry")
    entry = c.fp5.SCREEN_START_MS
    probe_signal = entry - c.fp5.DAY_MS
    probe_btc, probe_eth = _flat(probe_signal - 100 * c.fp5.DAY_MS, 101, 40.0, 40.0)
    probe_eth[-1] = (probe_signal, 90.0)
    probe_daily = {probe_signal: _bar(100.0), entry: _bar(100.0), entry + c.fp5.DAY_MS: _bar(101.0)}
    filled = c.spread_trades(probe_daily, probe_btc, probe_eth)
    if len(filled) != 1 or filled[0]["entry_ms"] != entry:
        raise SystemExit("entry must be the open after the signal day")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-9:
        raise SystemExit("the fill is not fp5's")
    later = [(c.fp5.SCREEN_END_MS, 40.0)]
    if c.spread_points(later, [(c.fp5.SCREEN_END_MS, 90.0)]):
        raise SystemExit("a 2024 stamp was kept")


def main() -> None:
    test_spread_and_tail()
    test_window_and_entry()
    print("fp13 pins ok")


if __name__ == "__main__":
    main()
