"""The search fp224. The coin-margined week lagged, then a seven-day short.

Nothing here reads the network or a file. Both seven-day close-to-close
returns are finished before the entry open. The position is one
coin-margined leg, sold at the next open and bought back seven days
later. The USDT perpetual is a signal, not a second leg. It is not a
one-day trade and it is not an overnight trade. Funding cash is not
added. The null is that same seven-day short on every day the two
returns exist.
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
IDEA = "CMS"
HOLD_DAYS = 7


def short_net(entry: float, exit_px: float, fee: float = fp5.FEE) -> float:
    """Sell at `fee` below the entry, buy back at `fee` above the later price."""
    if entry <= 0.0 or exit_px <= 0.0:
        raise ValueError("a fill needs a positive price")
    sold = entry * (1.0 - fee)
    bought = exit_px * (1.0 + fee)
    return sold / bought - 1.0


def _days():
    t = fp5.SCREEN_START_MS
    while t < fp5.SCREEN_END_MS:
        yield t
        t += fp5.DAY_MS


def _close(book: dict, ts: int, index: int) -> float | None:
    row = book.get(ts)
    if row is None:
        return None
    if len(row) <= index:
        raise ValueError("a close is missing")
    px = float(row[index])
    if px <= 0.0:
        return None
    return px


def _open(book: dict, ts: int) -> float | None:
    return _close(book, ts, 0)


def _week(book: dict, entry: int, index: int) -> float | None:
    earlier = _close(book, entry - 8 * fp5.DAY_MS, index)
    later = _close(book, entry - fp5.DAY_MS, index)
    if earlier is None or later is None:
        return None
    return later / earlier - 1.0


def _short(entry: int, cm: dict) -> dict | None:
    exit_ms = entry + HOLD_DAYS * fp5.DAY_MS
    if exit_ms > fp5.SCREEN_END_MS:
        return None
    entry_px = _open(cm, entry)
    exit_px = _open(cm, exit_ms)
    if entry_px is None or exit_px is None:
        return None
    if not (fp5.SCREEN_START_MS <= entry < fp5.SCREEN_END_MS):
        return None
    gross = entry_px / exit_px - 1.0
    net = short_net(entry_px, exit_px)
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": gross,
        "net": net,
        "pnl": 100.0 * net,
    }


def _lagged(cm: dict, um: dict, entry: int) -> bool | None:
    cm_week = _week(cm, entry, 1)
    um_week = _week(um, entry, 0)
    if cm_week is None or um_week is None:
        return None
    return cm_week < um_week


def signal_spans(cm: dict, um: dict) -> list[tuple[int, int]]:
    """The coin-margined week finished strictly behind the USDT week."""
    out = []
    for entry in _days():
        lagged = _lagged(cm, um, entry)
        if not lagged:
            continue
        trade = _short(entry, cm)
        if trade is None:
            continue
        out.append((entry, trade["exit_ms"]))
    return out


def pool_spans(cm: dict, um: dict) -> list[tuple[int, int]]:
    """The same seven-day short on every day both weeks exist."""
    out = []
    for entry in _days():
        if _lagged(cm, um, entry) is None or _short(entry, cm) is None:
            continue
        out.append((entry, entry + HOLD_DAYS * fp5.DAY_MS))
    return out


def signal_trades(cm: dict, um: dict) -> list[dict]:
    trades = []
    for entry, exit_ms in signal_spans(cm, um):
        trade = _short(entry, cm)
        if trade is None or trade["exit_ms"] != exit_ms:
            raise RuntimeError("a counted entry did not fill")
        trades.append(trade)
    return trades


def pool_nets(cm: dict, um: dict) -> list[float]:
    nets = []
    for entry, _exit_ms in pool_spans(cm, um):
        trade = _short(entry, cm)
        if trade is None:
            raise RuntimeError("a pool day did not fill")
        nets.append(trade["net"])
    return nets
