"""The twelfth search (fp12). The fill and the null are fp5's.

Nothing here reads the network or a file.
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


def _upper(points: list[tuple[int, float]], q: float = 0.90) -> list[int]:
    """Timestamps strictly above their own trailing-90-day quantile. The low tail is not returned."""
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


def dom_prints(bars: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS) -> list[tuple[int, float]]:
    """(t+8h, dominance close-to-close return on the bar that opened at t)."""
    prints = []
    for t in sorted(bars):
        if t >= end_ms:
            continue
        prev = t - fp5.EIGHT_H_MS
        if prev not in bars:
            continue
        old = bars[prev][3]
        new = bars[t][3]
        if old <= 0 or new <= 0:
            continue
        prints.append((t + fp5.EIGHT_H_MS, new / old - 1.0))
    return prints


def dom_entries(bars: dict[int, tuple], q: float = 0.90, end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    return _upper(dom_prints(bars, end_ms), q)


def dom_trades(
    bars: dict[int, tuple],
    btc: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter spot BTC when dominance's last 8h bar was rich. Hold one 8h bar."""
    trades = []
    for entry in dom_entries(bars, q, end_ms):
        trade = fp5._trade(
            "BTCUSDT", entry, entry + fp5.EIGHT_H_MS, btc,
            fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
