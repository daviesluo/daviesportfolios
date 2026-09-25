"""Funding cash on TRBUSDT, hedged with TRB spot.

A negative funding rate is cash the short pays the long. It is not a
reason to be long the coin. The package is long the perpetual and short
the spot, held across one settlement. The scored result is that cash
minus forty basis points. The coin's move between the two opens is not
added.

The cash is not in the signal. The signal is the average premium of
Binance's own hourly closes over the funding interval, excluding the
hour that is still open at the entry. Premium here is the perpetual
close minus the spot close, divided by the spot close. The premium
index is not read, and neither is any other venue. The interval length
comes from the funding file. An eight-hour settlement uses the seven
completed hours. A four-hour settlement uses the three completed hours.
It does not reach into the previous interval.

Ten basis points a fill, four fills, forty basis points. The average
premium is already at least 50 bp cheap. Fifty is the smallest grid
point at or above that cost. The same package is the other trade when
the average is not that cheap. A four-month sample of the USDT-M funding
files did not produce a second symbol with thirty such days. No second
symbol is scored.
"""

from __future__ import annotations

import importlib.util
from decimal import Decimal
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "fp5_common",
    Path(__file__).resolve().parents[1] / "fp5" / "common.py",
)
fp5 = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(fp5)

MIN_N = 30
COIN = "TRB"
IDEA = "FDCSH"
THRESHOLD_BPS = Decimal("50")
COST = Decimal("0.004")
NULL_KIND = "other_regime"
MODE = "regime"
RULE_BOOK = "um_perp"
RULE_SIDE = "long_cash"
FIELDS = ("coin", "book", "side", "entry_ms", "exit_ms", "gross", "net", "pnl")
RULE_N = 85
NULL_N = 815
RULE_DAYS = 36
HOUR_MS = 3_600_000

if RULE_N < MIN_N or NULL_N < RULE_N or RULE_DAYS < MIN_N:
    raise RuntimeError("the freeze is shorter than the count")
if COST != Decimal(str(fp5.FEE)) * 4:
    raise RuntimeError("the four-fill cost moved")


def _pair(bar: tuple) -> tuple[Decimal, Decimal]:
    if not isinstance(bar, tuple) or len(bar) != 2:
        raise SystemExit("a high or a low was read")
    opened, closed = Decimal(bar[0]), Decimal(bar[1])
    if opened <= 0 or closed <= 0:
        raise SystemExit("a bar is not a price")
    return opened, closed


def _premium(perp: Decimal, spot: Decimal) -> Decimal:
    return (perp - spot) / spot * Decimal(10000)


def signal_premium(spot: dict, perp: dict, settle_ms: int, hours: int) -> Decimal | None:
    """Completed hours of this interval only. The entry hour is not included."""
    if hours < 2:
        return None
    start = settle_ms - hours * HOUR_MS
    last = settle_ms - 2 * HOUR_MS
    total = Decimal(0)
    count = 0
    stamp = start
    while stamp <= last:
        if stamp not in spot or stamp not in perp:
            return None
        total += _premium(_pair(perp[stamp])[1], _pair(spot[stamp])[1])
        count += 1
        stamp += HOUR_MS
    if count != hours - 1:
        return None
    return total / Decimal(count)


def paths(spot: dict, perp: dict, funding: dict) -> list[dict]:
    """`funding` maps a settlement stamp to (interval hours, rate as Decimal)."""
    rows = []
    for settle_ms in sorted(funding):
        hours, rate = funding[settle_ms]
        entry_ms = settle_ms - HOUR_MS
        exit_ms = settle_ms + HOUR_MS
        if not fp5.in_screen(entry_ms):
            continue
        if entry_ms not in spot or entry_ms not in perp:
            continue
        if exit_ms not in spot or exit_ms not in perp:
            continue
        signal = signal_premium(spot, perp, settle_ms, int(hours))
        if signal is None:
            continue
        _pair(spot[entry_ms])
        _pair(perp[entry_ms])
        _pair(spot[exit_ms])
        _pair(perp[exit_ms])
        cash_bps = -Decimal(rate) * Decimal(10000)
        gross = cash_bps / Decimal(10000)
        net = gross - COST
        rows.append(
            {
                "coin": COIN,
                "book": RULE_BOOK,
                "side": RULE_SIDE,
                "entry_ms": entry_ms,
                "exit_ms": exit_ms,
                "gross": float(gross),
                "net": float(net),
                "pnl": float(Decimal(100) * net),
                "signal_bps": signal,
                "entry_bps": cash_bps,
                "exit_bps": Decimal(0),
                "open_bps": _premium(_pair(perp[entry_ms])[0], _pair(spot[entry_ms])[0]),
                "on": signal <= -THRESHOLD_BPS,
            }
        )
    return rows


def _public(row: dict) -> dict:
    return {key: row[key] for key in FIELDS}


def rule_trades(spot: dict, perp: dict, funding: dict) -> list[dict]:
    return [_public(row) for row in paths(spot, perp, funding) if row["on"]]


def null_trades(spot: dict, perp: dict, funding: dict) -> list[dict]:
    return [_public(row) for row in paths(spot, perp, funding) if not row["on"]]
