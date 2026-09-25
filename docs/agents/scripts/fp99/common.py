"""The search fp99. The fill and the null are fp5's.

Nothing here reads the network or a file. A daily bar is (open, quote).
The open is the fill on ADAUSDT. BTC's open is not an input. The signal is
ADA's quote volume divided by BTC's quote volume on the same day.
No hourly bar is read.
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
COIN = "ADAUSDT"
IDEA = "ADA-Q"


def relq_at(
    alt: dict[int, tuple],
    btc: dict[int, tuple],
    day: int,
    end_ms: int = fp5.SCREEN_END_MS,
) -> float | None:
    """ADA quote over BTC quote. None when either day is missing or a quote is not positive."""
    if day >= end_ms:
        return None
    a = alt.get(day)
    b = btc.get(day)
    if a is None or b is None or len(a) < 2 or len(b) < 2:
        return None
    if a[1] <= 0 or b[1] <= 0:
        return None
    return a[1] / b[1]


def relq_prints(
    alt: dict[int, tuple],
    btc: dict[int, tuple],
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    if not alt or not btc:
        return []
    out = []
    start = min(min(alt), min(btc)) // fp5.DAY_MS * fp5.DAY_MS
    for day in range(start, end_ms, fp5.DAY_MS):
        value = relq_at(alt, btc, day, end_ms)
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


def relq_signal_days(
    alt: dict[int, tuple],
    btc: dict[int, tuple],
    q: float = 0.90,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(relq_prints(alt, btc, end_ms), q)


def relq_trades(
    alt: dict[int, tuple],
    btc: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next ADAUSDT daily open after ADA quote ran high versus BTC. Hold one day."""
    trades = []
    for day in relq_signal_days(alt, btc, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            COIN, entry, exit_, alt, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
