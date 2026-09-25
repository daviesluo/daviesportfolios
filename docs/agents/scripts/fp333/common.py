"""The PEPE perpetual against PEPE spot.

1000PEPEUSDT is one thousand times the coin. Divided by one thousand, its
open is rich versus the PEPEUSDT open. The buyer of the perpetual is the
one who overpays. Funding is why a premium of that kind should close. The
scored result is the change in the premium between the two daily opens. It
is not the funding cash and it is not the move in the coin.

Ten basis points a fill, four fills, forty basis points. The previous
closes already show at least 50 bp. Fifty is the smallest grid point at or
above that cost. The same short-perpetual long-spot package is the other
trade when the previous close is below 50 bp, including a cheap perpetual.
The cheap side is not a second rule. The rest of the pre-specified basket
does not clear fifty basis points on thirty days. FTT's perpetual is one
unchanged price and is not a book. Those coins are not added here.
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
COIN = "PEPE"
IDEA = "PEPRM"
THRESHOLD_BPS = Decimal("50")
COST = Decimal("0.004")
MULTIPLIER = Decimal(1000)
NULL_KIND = "other_regime"
MODE = "regime"
RULE_BOOK = "um_perp"
RULE_SIDE = "short_premium"
FIELDS = ("coin", "book", "side", "entry_ms", "exit_ms", "gross", "net", "pnl")
RULE_N = 48
NULL_N = 191
FILLABLE_N = 239

if RULE_N < MIN_N or NULL_N < RULE_N:
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
    coin = perp / MULTIPLIER
    return (coin - spot) / spot * Decimal(10000)


def paths(spot: dict, perp: dict) -> list[dict]:
    rows = []
    day = fp5.SCREEN_START_MS
    while day < fp5.SCREEN_END_MS:
        prev = day - fp5.DAY_MS
        exit_ms = day + fp5.DAY_MS
        if (
            prev in spot
            and day in spot
            and exit_ms in spot
            and prev in perp
            and day in perp
            and exit_ms in perp
        ):
            signal = _premium(_pair(perp[prev])[1], _pair(spot[prev])[1])
            entry_bps = _premium(_pair(perp[day])[0], _pair(spot[day])[0])
            exit_bps = _premium(_pair(perp[exit_ms])[0], _pair(spot[exit_ms])[0])
            gross = (entry_bps - exit_bps) / Decimal(10000)
            net = gross - COST
            rows.append(
                {
                    "coin": COIN,
                    "book": RULE_BOOK,
                    "side": RULE_SIDE,
                    "entry_ms": day,
                    "exit_ms": exit_ms,
                    "gross": float(gross),
                    "net": float(net),
                    "pnl": float(Decimal(100) * net),
                    "signal_bps": signal,
                    "entry_bps": entry_bps,
                    "exit_bps": exit_bps,
                    "on": signal >= THRESHOLD_BPS,
                }
            )
        day += fp5.DAY_MS
    return rows


def _public(row: dict) -> dict:
    return {key: row[key] for key in FIELDS}


def rule_trades(spot: dict, perp: dict) -> list[dict]:
    return [_public(row) for row in paths(spot, perp) if row["on"]]


def null_trades(spot: dict, perp: dict) -> list[dict]:
    return [_public(row) for row in paths(spot, perp) if not row["on"]]
