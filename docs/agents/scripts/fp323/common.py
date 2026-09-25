"""The search fp323. Fair value is the standing par of one BTC per WBTC.
The previous WBTCBTC close is at least one basis point under that par.
Buy the spot book for two days. The other trade buys it for two days when
that discount is absent.

Nothing here reads the network or a file. The prints used by the signal have
already happened. Fair value is one BTC per WBTC, the same unit as this contract's
close. It is not another venue's last trade, and it is not computed from this
contract's daily bars. The entry open is not an input. A fill is an open on
the contract being traded. The position is one leg. It is not a one-day trade
and it is not an overnight trade. Funding cash is not added. The null is the
same leg with the price edge turned off. It is not the opposite side and it
is not an unconditional hold. A book ticker is not read.
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
COIN = "WBTCBTC"
IDEA = "WBPAR"
HOLD_DAYS = 2
THRESHOLD_BPS = Decimal("1")
NULL_KIND = "other_regime"
MODE = "regime"
FAIR_KIND = "par"
RULE_BOOK = "spot"
NULL_BOOK = "spot"
RULE_SIDE = "long"
NULL_SIDE = "long"
SYMBOL = "WBTCBTC"
BOOK_DIR = "spot1d"
BOOK_ROWS = 366
BOOK_FIRST = 1_672_531_200_000
FAIR_DIR = ""
FAIR_FILE = ""
FAIR_N = 0
FAIR_FIRST = 0
FAIR_LAST = 0
FAIR_FIRST_PX = "1"
FAIR_LAST_PX = "1"
RULE_N = 167
NULL_N = 196
FILLABLE_N = 364
NEITHER_N = 1
GAP = False
ABSENT: tuple[int, ...] = ()

if HOLD_DAYS <= 1:
    raise RuntimeError("the hold is one day or overnight")
if NULL_KIND != "other_regime" or MODE != "regime":
    raise RuntimeError("the edge-off trade is not this leg")
if RULE_BOOK != NULL_BOOK or RULE_SIDE != NULL_SIDE or RULE_SIDE != "long":
    raise RuntimeError("the edge-off trade changed the leg")
if FAIR_KIND != "par" or THRESHOLD_BPS != Decimal("1"):
    raise RuntimeError("the fair value is not named")
if RULE_N < MIN_N or NULL_N < RULE_N:
    raise RuntimeError("the frozen count is not a screen")


def _days():
    t = fp5.SCREEN_START_MS
    while t < fp5.SCREEN_END_MS:
        yield t
        t += fp5.DAY_MS


def _px(row: tuple, index: int) -> Decimal | None:
    if row is None or len(row) != 2:
        return None
    px = row[index]
    if not isinstance(px, Decimal):
        px = Decimal(px)
    if px <= 0:
        return None
    return px


def _open(book: dict, ts: int) -> Decimal | None:
    return _px(book.get(ts), 0)


def _close(book: dict, ts: int) -> Decimal | None:
    return _px(book.get(ts), 1)


def _latest(stamps: list[int], ts: int) -> int | None:
    lo, hi = 0, len(stamps)
    while lo < hi:
        mid = (lo + hi) // 2
        if stamps[mid] < ts:
            lo = mid + 1
        else:
            hi = mid
    if lo == 0:
        return None
    return stamps[lo - 1]


def _level(fair: dict, entry: int) -> Decimal | None:
    if FAIR_KIND == "par":
        return Decimal(1)
    stamp = _latest(sorted(fair), entry)
    if stamp is None:
        return None
    return fair[stamp]


def discount_bps(fair_px: Decimal, close: Decimal) -> Decimal:
    """How many basis points the finished close sits under the fair value."""
    if close <= 0:
        raise RuntimeError("a close is not a price")
    return (fair_px - close) / close * Decimal(10000)


def _cheap(book: dict, fair: dict, entry: int) -> bool | None:
    """True when the previous close is cheap to the fair value.

    None when the previous close or the fair value is missing. The entry
    open is not an input. The entry day's own close is not an input.
    """
    close = _close(book, entry - fp5.DAY_MS)
    if close is None:
        return None
    level = _level(fair, entry)
    if level is None:
        return None
    return discount_bps(level, close) >= THRESHOLD_BPS


def _window(entry: int, book: dict):
    exit_ms = entry + HOLD_DAYS * fp5.DAY_MS
    if not (fp5.SCREEN_START_MS <= entry < fp5.SCREEN_END_MS):
        return None
    if exit_ms <= entry or exit_ms > fp5.SCREEN_END_MS:
        return None
    entry_px = _open(book, entry)
    exit_px = _open(book, exit_ms)
    if entry_px is None or exit_px is None:
        return None
    return entry_px, exit_px, exit_ms


def _rule_on(book, fair, entry) -> bool:
    if _window(entry, book) is None:
        return False
    return _cheap(book, fair, entry) is True


def _null_on(book, fair, entry) -> bool:
    if _window(entry, book) is None:
        return False
    flag = _cheap(book, fair, entry)
    if flag is None:
        return False
    return not flag


def rule_spans(book, fair) -> list[tuple[int, int]]:
    out = []
    for entry in _days():
        if _rule_on(book, fair, entry):
            out.append((entry, entry + HOLD_DAYS * fp5.DAY_MS))
    return out


def null_spans(book, fair) -> list[tuple[int, int]]:
    out = []
    for entry in _days():
        if _null_on(book, fair, entry):
            out.append((entry, entry + HOLD_DAYS * fp5.DAY_MS))
    return out


def fillable(book: dict) -> int:
    n = 0
    for entry in _days():
        if _window(entry, book) is not None:
            n += 1
    return n


def _trade(entry: int, book: dict) -> dict:
    window = _window(entry, book)
    if window is None:
        raise RuntimeError("a counted entry did not fill")
    entry_px, exit_px, exit_ms = window
    gross = float(exit_px) / float(entry_px) - 1.0
    net = fp5.net_return(float(entry_px), float(exit_px))
    if exit_ms - entry != HOLD_DAYS * fp5.DAY_MS:
        raise RuntimeError("the hold moved")
    return {
        "coin": COIN,
        "book": RULE_BOOK,
        "side": RULE_SIDE,
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": gross,
        "net": net,
        "pnl": 100.0 * net,
    }


def rule_trades(book, fair) -> list[dict]:
    trades = []
    for entry, exit_ms in rule_spans(book, fair):
        trade = _trade(entry, book)
        if trade["exit_ms"] != exit_ms:
            raise RuntimeError("a counted entry did not fill")
        trades.append(trade)
    return trades


def null_trades(book, fair) -> list[dict]:
    trades = []
    for entry, exit_ms in null_spans(book, fair):
        trade = _trade(entry, book)
        if trade["exit_ms"] != exit_ms:
            raise RuntimeError("a counted null did not fill")
        trades.append(trade)
    return trades
