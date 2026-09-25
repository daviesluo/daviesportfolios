"""Rules for the eighth search (fp8). The fill and the null are fp5's.

Nothing here reads the network or a file.
"""

from __future__ import annotations

import importlib.util
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "fp5_common",
    Path(__file__).resolve().parents[1] / "fp5" / "common.py",
)
fp5 = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(fp5)

MIN_N = 30
BASIS_CHEAP = Decimal("-0.002")


def _day(y: int, m: int, d: int) -> int:
    return int(datetime(y, m, d, tzinfo=timezone.utc).timestamp() * 1000)


# Expiry, then the archive symbol. The roll uses the expiry only.
CONTRACTS = (
    (_day(2022, 12, 30), "BTCUSDT_221230"),
    (_day(2023, 3, 31), "BTCUSDT_230331"),
    (_day(2023, 6, 30), "BTCUSDT_230630"),
    (_day(2023, 9, 29), "BTCUSDT_230929"),
    (_day(2023, 12, 29), "BTCUSDT_231229"),
    (_day(2024, 3, 29), "BTCUSDT_240329"),
)


def forward(daily: dict[int, tuple], signal_days: list[int]) -> list[dict]:
    trades = []
    for day in signal_days:
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade("BTCUSDT", entry, exit_, daily)
        if trade is not None:
            trades.append(trade)
    return trades


def front_expiry(day_ms: int) -> int | None:
    """Soonest expiry strictly after this day plus seven."""
    cutoff = day_ms + 7 * fp5.DAY_MS
    later = [exp for exp, _sym in CONTRACTS if exp > cutoff]
    return min(later) if later else None


def _tail(points: list[tuple[int, float]], q: float, below: bool) -> list[int]:
    points = sorted(points)
    out = []
    for i, (day, value) in enumerate(points):
        hist = [
            points[j][1]
            for j in range(i)
            if day - 90 * fp5.DAY_MS <= points[j][0] < day
        ]
        thr = fp5.rank_threshold(hist, q, 90)
        if thr is None:
            continue
        if below and value < thr:
            out.append(day)
        if not below and value > thr:
            out.append(day)
    return out


def flow_out_days(inflow: list[tuple[int, float]], outflow: list[tuple[int, float]]) -> list[int]:
    """Net coins leaving exchanges, above the trailing 90th. The low tail is not returned."""
    incoming = dict(inflow)
    points = []
    for day, left in outflow:
        if day not in incoming:
            continue
        points.append((day, left - incoming[day]))
    return _tail(points, 0.90, False)


def hash_drop_days(points: list[tuple[int, float]]) -> list[int]:
    """Hash rate below its own trailing 10th. Non-positive readings are missing."""
    clean = [(day, value) for day, value in points if value > 0]
    return _tail(clean, 0.10, True)


def basis_days(futures: dict[int, dict[int, float]], spot: dict[int, tuple]) -> list[int]:
    """Dated-future close more than a round trip under the spot close."""
    out = []
    for day in sorted(spot):
        exp = front_expiry(day)
        if exp is None:
            continue
        book = futures.get(exp) or {}
        if day not in book:
            continue
        spot_close = spot[day][3]
        if spot_close <= 0:
            continue
        gap = Decimal(str(book[day])) / Decimal(str(spot_close)) - 1
        if gap < BASIS_CHEAP:
            out.append(day)
    return out
