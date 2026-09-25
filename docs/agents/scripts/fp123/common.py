"""The search fp123. The fill and the null are fp5's.

Nothing here reads the network or a file. A fill bar's first field is the
BTCUSDT open. The signal is one statistic of the BTC option book at the
day's last hour. No hourly price bar is read. No funding print is read.
No alt quote is read. No implied vol is read. The hold is one day.
"""

from __future__ import annotations

import datetime
import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "fp5_common",
    Path(__file__).resolve().parents[1] / "fp5" / "common.py",
)
fp5 = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(fp5)

MIN_N = 30
COIN = "BTCUSDT"
IDEA = "STRIKE"
WIDTH = 3
KIND = "count"
EPOCH = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)


def parse_contract(symbol: str) -> tuple[int, float, int] | None:
    """BTC-YYMMDD-STRIKE-C or P. Expiry is that date at 00:00 UTC. Side 1 is a put."""
    parts = symbol.split("-")
    if len(parts) != 4 or parts[0] != "BTC" or parts[3] not in ("C", "P"):
        return None
    ymd = parts[1]
    if len(ymd) != 6 or not ymd.isdigit():
        return None
    year = 2000 + int(ymd[0:2])
    month = int(ymd[2:4])
    day = int(ymd[4:6])
    try:
        expiry = datetime.datetime(year, month, day, tzinfo=datetime.timezone.utc)
    except ValueError:
        return None
    strike = float(parts[2])
    if not strike > 0:
        return None
    side = 1 if parts[3] == "P" else 0
    expiry_ms = int((expiry - EPOCH).total_seconds() * 1000)
    return expiry_ms, strike, side


def days_to_expiry(symbol: str, day_ms: int) -> float | None:
    parsed = parse_contract(symbol)
    if parsed is None:
        return None
    return (parsed[0] - day_ms) / fp5.DAY_MS


def last_hour(row: tuple) -> list[tuple] | None:
    if len(row) < WIDTH or len(row) % WIDTH != 0:
        return None
    grouped = [tuple(row[i:i + WIDTH]) for i in range(0, len(row), WIDTH)]
    hours = []
    for group in grouped:
        hour = group[0]
        if hour != int(hour) or hour < 0 or hour > 23:
            return None
        hours.append(int(hour))
    last = max(hours)
    return [group for group, hour in zip(grouped, hours) if hour == last]


def _stat(snap: list[tuple]) -> float | None:
    if KIND == "sumpos":
        total = 0.0
        seen = 0
        for _hour, value in snap:
            if value > 0:
                total += value
                seen += 1
        if seen == 0:
            return None
        return total
    if KIND == "sumall":
        if any(value < 0 for _hour, value in snap):
            return None
        return sum(value for _hour, value in snap)
    if KIND == "ratio":
        put = 0.0
        call = 0.0
        for _hour, side, value in snap:
            if not value > 0:
                continue
            if side == 1:
                put += value
            elif side == 0:
                call += value
            else:
                return None
        if not put > 0 or not call > 0:
            return None
        return put / call
    if KIND == "count":
        strikes = {strike for _hour, strike, oi in snap if strike > 0 and oi > 0}
        if not strikes:
            return None
        return float(len(strikes))
    if KIND == "product":
        total = 0.0
        seen = 0
        for _hour, gamma, oi in snap:
            if gamma > 0 and oi > 0:
                total += gamma * oi
                seen += 1
        if seen == 0:
            return None
        return total
    if KIND == "wavg":
        weight = 0.0
        total = 0.0
        for _hour, dte, oi in snap:
            if oi > 0 and dte >= 0:
                weight += oi
                total += dte * oi
        if not weight > 0:
            return None
        return total / weight
    if KIND == "absw":
        total = 0.0
        seen = 0
        for _hour, delta, oi in snap:
            if oi > 0:
                total += abs(delta) * oi
                seen += 1
        if seen == 0:
            return None
        return total
    raise RuntimeError("unknown kind")


def signal_at(rows: dict[int, tuple], day: int, end_ms: int = fp5.SCREEN_END_MS) -> float | None:
    if day >= end_ms:
        return None
    row = rows.get(day)
    if row is None:
        return None
    snap = last_hour(row)
    if not snap:
        return None
    return _stat(snap)


def signal_prints(rows: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS) -> list[tuple[int, float]]:
    if not rows:
        return []
    start = min(rows) // fp5.DAY_MS * fp5.DAY_MS
    out = []
    for day in range(start, end_ms, fp5.DAY_MS):
        value = signal_at(rows, day, end_ms)
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


def signal_days(
    rows: dict[int, tuple],
    q: float = 0.90,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(signal_prints(rows, end_ms), q)


def signal_trades(
    rows: dict[int, tuple],
    bars: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next BTCUSDT daily open. Hold one day."""
    trades = []
    for day in signal_days(rows, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            COIN, entry, exit_, bars, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
