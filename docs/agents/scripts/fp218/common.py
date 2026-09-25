"""The search fp218. The first week of the month is held to the next month.

Nothing here reads the network or a file. The day of the month is known
before that open. The position is one USDT-perpetual leg, bought on a
UTC day numbered 1 through 7 and sold at the next month's first open.
The hold is 22 to 31 days. It is not a one-day trade and it is not an
overnight trade. Funding cash is not added. The null keeps that hold
length: each length the rule actually uses is drawn from every in-screen
day held exactly that many days, and a draw takes as many of each length
as the rule has. A shorter hold is not a peer.
"""

from __future__ import annotations

import importlib.util
import random
from datetime import datetime, timezone
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "fp5_common",
    Path(__file__).resolve().parents[1] / "fp5" / "common.py",
)
fp5 = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(fp5)

MIN_N = 30
COIN = "BTCUSDT"
IDEA = "MTH"
HOLD_MIN = 22
HOLD_MAX = 31


def _utc(ms: int) -> datetime:
    stamp = datetime.fromtimestamp(ms / 1000, timezone.utc)
    if stamp.hour or stamp.minute or stamp.second or stamp.microsecond:
        raise ValueError("a session bar is midnight UTC")
    return stamp


def _next_month(ms: int) -> int:
    stamp = _utc(ms)
    year = stamp.year + (1 if stamp.month == 12 else 0)
    month = 1 if stamp.month == 12 else stamp.month + 1
    nxt = datetime(year, month, 1, tzinfo=timezone.utc)
    return int(nxt.timestamp() * 1000)


def _days():
    t = fp5.SCREEN_START_MS
    while t < fp5.SCREEN_END_MS:
        yield t
        t += fp5.DAY_MS


def _hold(entry: int, exit_ms: int) -> int:
    return (exit_ms - entry) // fp5.DAY_MS


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


def _long(entry: int, exit_ms: int, book: dict) -> dict | None:
    entry_px = _open(book, entry)
    exit_px = _open(book, exit_ms)
    if entry_px is None or exit_px is None:
        return None
    if not (fp5.SCREEN_START_MS <= entry < fp5.SCREEN_END_MS):
        return None
    if exit_ms <= entry or exit_ms > fp5.SCREEN_END_MS:
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


def signal_spans(um: dict) -> list[tuple[int, int]]:
    """Days 1 through 7. The span is the position, not a profit."""
    out = []
    for entry in _days():
        if _utc(entry).day > 7:
            continue
        exit_ms = _next_month(entry)
        hold = _hold(entry, exit_ms)
        if hold < HOLD_MIN or hold > HOLD_MAX or exit_ms > fp5.SCREEN_END_MS:
            continue
        if _long(entry, exit_ms, um) is None:
            continue
        out.append((entry, exit_ms))
    return out


def lengths_used(um: dict) -> dict[int, int]:
    """How many strategy spans have each hold. Keys are sorted later."""
    counts: dict[int, int] = {}
    for entry, exit_ms in signal_spans(um):
        hold = _hold(entry, exit_ms)
        counts[hold] = counts.get(hold, 0) + 1
    return counts


def pool_spans(um: dict) -> list[tuple[int, int]]:
    """Same-length peers, ordered by hold then by entry.

    A length is in the pool only when the rule itself used it. The exit
    is that many midnights later, not the next month's open, so a shorter
    month-end hold is not a peer. One start day can appear once per length.
    """
    used = lengths_used(um)
    out = []
    for hold in sorted(used):
        if hold < HOLD_MIN or hold > HOLD_MAX:
            raise RuntimeError("the month hold moved")
        for entry in _days():
            exit_ms = entry + hold * fp5.DAY_MS
            if exit_ms > fp5.SCREEN_END_MS:
                continue
            if _long(entry, exit_ms, um) is None:
                continue
            out.append((entry, exit_ms))
    return out


def signal_trades(um: dict) -> list[dict]:
    trades = []
    for entry, exit_ms in signal_spans(um):
        trade = _long(entry, exit_ms, um)
        if trade is None:
            raise RuntimeError("a counted entry did not fill")
        hold = _hold(trade["entry_ms"], trade["exit_ms"])
        if hold < HOLD_MIN or hold > HOLD_MAX:
            raise RuntimeError("the month hold moved")
        trades.append(trade)
    return trades


def pool_by_hold(um: dict) -> dict[int, list[float]]:
    """Nets in pool order: sorted hold, then entry ascending."""
    groups: dict[int, list[float]] = {}
    for entry, exit_ms in pool_spans(um):
        trade = _long(entry, exit_ms, um)
        if trade is None:
            raise RuntimeError("a pool day did not fill")
        hold = _hold(entry, exit_ms)
        groups.setdefault(hold, []).append(trade["net"])
    return {hold: groups[hold] for hold in sorted(groups)}


def _need(trades: list[dict]) -> dict[int, int]:
    counts: dict[int, int] = {}
    for trade in trades:
        hold = _hold(trade["entry_ms"], trade["exit_ms"])
        counts[hold] = counts.get(hold, 0) + 1
    if sum(counts.values()) != len(trades):
        raise RuntimeError("the length counts moved")
    return counts


def matched_null_p95(
    trades: list[dict],
    by_hold: dict[int, list[float]],
    draws: int = fp5.NULL_DRAWS,
    seed: int = fp5.NULL_SEED,
) -> float | None:
    """One draw takes, within each hold, as many nets as the rule has of it.

    Lengths are visited in ascending order. `random.sample` follows the
    pool list, which is entry order. A length the rule did not use is not
    drawn. The cutoff is the sorted means at floor(0.95 * draws).
    """
    if not trades:
        return None
    need = _need(trades)
    for hold, count in need.items():
        pool = by_hold.get(hold) or []
        if len(pool) < count:
            return None
    rng = random.Random(seed)
    means = []
    for _ in range(draws):
        chosen = []
        for hold in sorted(need):
            picked = rng.sample(by_hold[hold], need[hold])
            if len(picked) != need[hold]:
                raise RuntimeError("a draw took the wrong count")
            chosen.extend(picked)
        if len(chosen) != len(trades):
            raise RuntimeError("a draw changed the count")
        means.append(sum(chosen) / len(chosen))
    means.sort()
    return means[fp5.p95_index(draws)]


def screen_row(trades: list[dict], by_hold: dict[int, list[float]], note: str) -> dict:
    """Same fields as fp5.summarise. The cutoff is the length-matched null."""
    fp5.assert_screen_trades(trades)
    n = len(trades)
    mean_net = sum(t["net"] for t in trades) / n if n else 0.0
    mean_gross = sum(t["gross"] for t in trades) / n if n else 0.0
    total = sum(t["pnl"] for t in trades)
    cutoff = matched_null_p95(trades, by_hold) if n else None
    passes = bool(n >= MIN_N and mean_net > 0.0 and cutoff is not None and mean_net > cutoff)
    return {
        "idea": IDEA,
        "n": n,
        "min_n": MIN_N,
        "mean_gross_bps": round(fp5.bps(mean_gross), 4) if n else None,
        "mean_net_bps": round(fp5.bps(mean_net), 4) if n else None,
        "total_pnl_usd": round(total, 4),
        "null_p95_bps": None if cutoff is None else round(fp5.bps(cutoff), 4),
        "passes_screen": passes,
        "note": note,
    }
