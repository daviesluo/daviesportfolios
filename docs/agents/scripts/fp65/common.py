"""The sixty-fifth search (fp65). The fill and the null are fp5's.

Nothing here reads the network or a file. A daily bar is (open, high, low)
on BTCUSDT and on ETHUSDT. The signal is ETH's range divided by its open,
over the same figure for BTC. A close is not stored. The fill reads a later
BTC open.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "fp5_common",
    Path(__file__).resolve().parents[1] / "fp5" / "common.py",
)
fp5 = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(fp5)

MIN_N = 30


def _range_pct(bar: tuple) -> float | None:
    if len(bar) < 3 or bar[0] <= 0 or bar[1] < bar[2]:
        return None
    width = (bar[1] - bar[2]) / bar[0]
    if width <= 0:
        return None
    return width


def span_at(
    btc: dict[int, tuple],
    eth: dict[int, tuple],
    day: int,
    end_ms: int = fp5.SCREEN_END_MS,
) -> float | None:
    """ETH range percent over BTC range percent. None when either range is missing or zero."""
    if day >= end_ms:
        return None
    b = btc.get(day)
    e = eth.get(day)
    if b is None or e is None:
        return None
    b_pct = _range_pct(b)
    e_pct = _range_pct(e)
    if b_pct is None or e_pct is None:
        return None
    return e_pct / b_pct


def span_prints(
    btc: dict[int, tuple],
    eth: dict[int, tuple],
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    if not btc or not eth:
        return []
    out = []
    start = min(min(btc), min(eth)) // fp5.DAY_MS * fp5.DAY_MS
    for day in range(start, end_ms, fp5.DAY_MS):
        value = span_at(btc, eth, day, end_ms)
        if value is None:
            continue
        out.append((day, value))
    return out


def _upper(points: list[tuple[int, float]], q: float) -> list[int]:
    points = sorted(points)
    out = []
    for i, (ts, value) in enumerate(points):
        hist = [
            points[j][1]
            for j in range(i)
            if ts - 90 * fp5.DAY_MS <= points[j][0] < ts
        ]
        thr = fp5.rank_threshold(hist, q, 90)
        if thr is None or not value > thr:
            continue
        out.append(ts)
    return out


def span_signal_days(
    btc: dict[int, tuple],
    eth: dict[int, tuple],
    q: float = 0.90,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(span_prints(btc, eth, end_ms), q)


def span_trades(
    btc: dict[int, tuple],
    eth: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next BTC open after ETH's range ran wide relative to BTC. Hold one day."""
    trades = []
    for day in span_signal_days(btc, eth, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, btc, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
