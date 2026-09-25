"""The search fp220. Five or more down sessions, then a seven-day long.

Nothing here reads the network or a file. A session is down when its
close is strictly below its open. Those seven sessions are finished
before the entry open. The position is one USDT-perpetual leg, held
seven days. It is not one candle's body, it is not a one-day trade, and
it is not an overnight trade. A high and a low are not read. Funding
cash is not added. The null is that same seven-day long on every day
the seven sessions exist.
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
COIN = "BTCUSDT"
IDEA = "BRD"
HOLD_DAYS = 7
DOWN_DAYS = 5
LOOKBACK = 7


def _days():
    t = fp5.SCREEN_START_MS
    while t < fp5.SCREEN_END_MS:
        yield t
        t += fp5.DAY_MS


def _bar(book: dict, ts: int) -> tuple[float, float] | None:
    row = book.get(ts)
    if row is None:
        return None
    if len(row) < 2:
        raise ValueError("a session bar is the open and the close")
    open_px, close_px = float(row[0]), float(row[1])
    if open_px <= 0.0 or close_px <= 0.0:
        return None
    return open_px, close_px


def _prior(book: dict, entry: int) -> list[tuple[float, float]] | None:
    bars = []
    for k in range(1, LOOKBACK + 1):
        bar = _bar(book, entry - k * fp5.DAY_MS)
        if bar is None:
            return None
        bars.append(bar)
    return bars


def _long(entry: int, book: dict) -> dict | None:
    exit_ms = entry + HOLD_DAYS * fp5.DAY_MS
    if exit_ms > fp5.SCREEN_END_MS:
        return None
    entry_bar = _bar(book, entry)
    exit_bar = _bar(book, exit_ms)
    if entry_bar is None or exit_bar is None:
        return None
    if not (fp5.SCREEN_START_MS <= entry < fp5.SCREEN_END_MS):
        return None
    gross = exit_bar[0] / entry_bar[0] - 1.0
    net = fp5.net_return(entry_bar[0], exit_bar[0])
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": gross,
        "net": net,
        "pnl": 100.0 * net,
    }


def _downs(book: dict, entry: int) -> int | None:
    bars = _prior(book, entry)
    if bars is None:
        return None
    return sum(1 for open_px, close_px in bars if close_px < open_px)


def signal_spans(um: dict) -> list[tuple[int, int]]:
    """At least five of the seven finished sessions closed below their open."""
    out = []
    for entry in _days():
        downs = _downs(um, entry)
        if downs is None or downs < DOWN_DAYS:
            continue
        trade = _long(entry, um)
        if trade is None:
            continue
        out.append((entry, trade["exit_ms"]))
    return out


def pool_spans(um: dict) -> list[tuple[int, int]]:
    """The same seven-day long on every day the seven sessions exist."""
    out = []
    for entry in _days():
        if _downs(um, entry) is None or _long(entry, um) is None:
            continue
        out.append((entry, entry + HOLD_DAYS * fp5.DAY_MS))
    return out


def signal_trades(um: dict) -> list[dict]:
    trades = []
    for entry, exit_ms in signal_spans(um):
        trade = _long(entry, um)
        if trade is None or trade["exit_ms"] != exit_ms:
            raise RuntimeError("a counted entry did not fill")
        trades.append(trade)
    return trades


def pool_nets(um: dict) -> list[float]:
    nets = []
    for entry, _exit_ms in pool_spans(um):
        trade = _long(entry, um)
        if trade is None:
            raise RuntimeError("a pool day did not fill")
        nets.append(trade["net"])
    return nets
