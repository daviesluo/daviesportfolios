"""The search fp223. The 16:00 funding rate fell over seven days, then a long.

Nothing here reads the network or a file. The signal is the 16:00 rate
against the 16:00 rate seven days earlier. Both prints have happened
before the entry open. It is not the day's funding range, not the level,
and not a signed sum of the three rates. The position is one
USDT-perpetual leg, held seven days. It is not a one-day trade and it
is not an overnight trade. Funding cash is not added. The null is that
same seven-day long on every day both prints exist.
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
IDEA = "FWK"
HOLD_DAYS = 7


def _days():
    t = fp5.SCREEN_START_MS
    while t < fp5.SCREEN_END_MS:
        yield t
        t += fp5.DAY_MS


def _open(book: dict, ts: int) -> float | None:
    row = book.get(ts)
    if row is None:
        return None
    if len(row) < 1:
        raise ValueError("a bar has no open")
    px = float(row[0])
    if px <= 0.0:
        return None
    return px


def _rate(fund: dict, ts: int) -> float | None:
    row = fund.get(ts)
    if row is None:
        return None
    if len(row) < 1:
        raise ValueError("a funding row has no rate")
    return float(row[0])


def _fell(fund: dict, entry: int) -> bool | None:
    earlier = _rate(fund, entry - 8 * fp5.DAY_MS)
    later = _rate(fund, entry - fp5.DAY_MS)
    if earlier is None or later is None:
        return None
    return later < earlier


def _long(entry: int, book: dict) -> dict | None:
    exit_ms = entry + HOLD_DAYS * fp5.DAY_MS
    if exit_ms > fp5.SCREEN_END_MS:
        return None
    entry_px = _open(book, entry)
    exit_px = _open(book, exit_ms)
    if entry_px is None or exit_px is None:
        return None
    if not (fp5.SCREEN_START_MS <= entry < fp5.SCREEN_END_MS):
        return None
    gross = exit_px / entry_px - 1.0
    net = fp5.net_return(entry_px, exit_px)
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": gross,
        "net": net,
        "pnl": 100.0 * net,
    }


def signal_spans(um: dict, fund: dict) -> list[tuple[int, int]]:
    """The later 16:00 print is strictly below the print seven days earlier."""
    out = []
    for entry in _days():
        fell = _fell(fund, entry)
        if not fell:
            continue
        trade = _long(entry, um)
        if trade is None:
            continue
        out.append((entry, trade["exit_ms"]))
    return out


def pool_spans(um: dict, fund: dict) -> list[tuple[int, int]]:
    """The same seven-day long on every day both 16:00 prints exist."""
    out = []
    for entry in _days():
        if _fell(fund, entry) is None or _long(entry, um) is None:
            continue
        out.append((entry, entry + HOLD_DAYS * fp5.DAY_MS))
    return out


def signal_trades(um: dict, fund: dict) -> list[dict]:
    trades = []
    for entry, exit_ms in signal_spans(um, fund):
        trade = _long(entry, um)
        if trade is None or trade["exit_ms"] != exit_ms:
            raise RuntimeError("a counted entry did not fill")
        trades.append(trade)
    return trades


def pool_nets(um: dict, fund: dict) -> list[float]:
    nets = []
    for entry, _exit_ms in pool_spans(um, fund):
        trade = _long(entry, um)
        if trade is None:
            raise RuntimeError("a pool day did not fill")
        nets.append(trade["net"])
    return nets
