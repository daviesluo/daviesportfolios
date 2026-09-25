"""The search fp327. Fair value is relative purchasing power. The US CPI-U all items index and the euro-area HICP overall index are each rebased to December 2022, scaled by the ECB reference rate of 2022-12-30, and divided by the Coin Metrics BUSD PriceUSD that had already completed. The result is quoted in the same unit as EURBUSD. The previous EURBUSD close is at least one basis point under that price. Buy the spot book for two days. The other trade buys it for two days when that discount is absent.

Nothing here reads the network or a file. The prints used by the signal have
already happened. Fair value and the finished close are in the same unit. The
discount is basis points of that close. It is not a funding sign, it is not
funding against SOFR, it is not another venue's last trade, and it is not
computed from this contract's daily bars. Spot, the coin-margined book and the
USDT book are not used as each other's fair value. The entry open is not an
input. A fill is an open on the contract being traded. The position is one
leg. It is not a one-day trade and it is not an overnight trade. Funding cash
is not added. The null is the same leg with the price edge turned off. It is
not the opposite side and it is not an unconditional hold. A book ticker is
not read.
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
COIN = "EURBUSD"
IDEA = "CPIPP"
HOLD_DAYS = 2
THRESHOLD_BPS = Decimal("1")
NULL_KIND = "other_regime"
MODE = "regime"
FAIR_KIND = "relative"
PULL = "bls"
RULE_BOOK = "spot"
NULL_BOOK = "spot"
RULE_SIDE = "long"
NULL_SIDE = "long"
SYMBOL = "EURBUSD"
BOOK_DIR = "spot1d"
BOOK_ROWS = 345
BOOK_FIRST = 1672531200000
BOOK_LAST = 1702252800000
BOOK_FIRST_OPEN = "1.07200000"
BOOK_FIRST_CLOSE = "1.07390000"
BOOK_LAST_OPEN = "1.07580000"
BOOK_LAST_CLOSE = "1.07570000"
LISTING_ENDS = False
RULE_N = 107
NULL_N = 212
FILLABLE_N = 343
NEITHER_N = 24
READY_MS = 1674604800000
US0 = Decimal("296.797")
EA0 = Decimal("120.52")
BASE_FX = Decimal("1.0666")
PARTS = {
    "us": {
        "file": "us.json",
        "n": 12,
        "first": 1674172800000,
        "last": 1703030400000,
        "first_px": "296.797",
        "last_px": "307.051",
    },
    "ea": {
        "file": "ea.json",
        "n": 13,
        "first": 1671926400000,
        "last": 1703462400000,
        "first_px": "120.95",
        "last_px": "123.85",
    },
    "busd": {
        "file": "busd.json",
        "n": 425,
        "first": 1667350149000,
        "last": 1703982233000,
        "first_px": "1.00008193331052",
        "last_px": "1.00108643186326",
    },
}

BLS_ID = "CUUR0000SA0"
BLS_PUB_DAY = 20
EA_SOURCE = "ecb"
ECB_SERIES = "ICP/M.U2.N.000000.4.INX"
ECB_KEY = "ICP.M.U2.N.000000.4.INX"
ECB_LAG = 1
ECB_PUB_DAY = 25
NOTE = (
    "Fair value is 1.0666 times the US CPI-U, rebased to December 2022, divided by the euro-area HICP rebased to the same month, divided by the Coin Metrics BUSD price that had already completed. The previous EURBUSD close is at least one basis point under that price. Buy the spot book for two days. The other trade buys it for two days when that discount is absent. Same prices, same side, the edge turned off. One leg. The traded open is the fill only. The entry day's close is not an input. Another venue's close is not an input. A book ticker is not read."
)

if HOLD_DAYS <= 1:
    raise RuntimeError("the hold is one day or overnight")
if NULL_KIND != "other_regime" or MODE != "regime":
    raise RuntimeError("the edge-off trade is not this leg")
if RULE_BOOK != NULL_BOOK or RULE_SIDE != NULL_SIDE or RULE_SIDE != "long":
    raise RuntimeError("the edge-off trade changed the leg")
if RULE_N < MIN_N or NULL_N < RULE_N:
    raise RuntimeError("the frozen count is not a screen")
if FAIR_KIND == "quote":
    if READY_MS != 0 or US0 is not None or EA0 is not None or set(PARTS) != {"usd", "busd"}:
        raise RuntimeError("the quote is not named")
elif FAIR_KIND == "relative":
    if READY_MS <= fp5.SCREEN_START_MS or BASE_FX != Decimal("1.0666"):
        raise RuntimeError("the relative price is not named")
    if US0 is None or EA0 is None or US0 <= 0 or EA0 <= 0 or set(PARTS) != {"us", "ea", "busd"}:
        raise RuntimeError("the relative price is not named")
else:
    raise RuntimeError("the fair value is not named")


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


def _value(series: dict, ts: int) -> Decimal | None:
    stamp = _latest(sorted(series), ts)
    if stamp is None:
        return None
    return series[stamp]


def fair_px(parts: dict, entry: int) -> Decimal | None:
    """The published price, in this contract's unit, known strictly before entry."""
    if FAIR_KIND == "quote":
        usd = _value(parts["usd"], entry)
        quote = _value(parts["busd"], entry)
        if usd is None or quote is None or quote <= 0:
            return None
        return usd / quote
    if entry < READY_MS:
        return None
    us = _value(parts["us"], entry)
    ea = _value(parts["ea"], entry)
    quote = _value(parts["busd"], entry)
    if us is None or ea is None or quote is None or ea <= 0 or quote <= 0:
        return None
    return BASE_FX * (us / US0) / (ea / EA0) / quote


def discount_bps(fair: Decimal, close: Decimal) -> Decimal:
    """How many basis points the finished close sits under the fair value."""
    if close <= 0:
        raise RuntimeError("a close is not a price")
    return (fair - close) / close * Decimal(10000)


def _cheap(book: dict, parts: dict, entry: int) -> bool | None:
    """True when the previous close is cheap to the fair value.

    None when the previous close or the fair value is missing. The entry
    open is not an input. The entry day's own close is not an input.
    """
    close = _close(book, entry - fp5.DAY_MS)
    if close is None:
        return None
    level = fair_px(parts, entry)
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


def _rule_on(book, parts, entry) -> bool:
    if _window(entry, book) is None:
        return False
    return _cheap(book, parts, entry) is True


def _null_on(book, parts, entry) -> bool:
    if _window(entry, book) is None:
        return False
    flag = _cheap(book, parts, entry)
    if flag is None:
        return False
    return not flag


def rule_spans(book, parts) -> list[tuple[int, int]]:
    out = []
    for entry in _days():
        if _rule_on(book, parts, entry):
            out.append((entry, entry + HOLD_DAYS * fp5.DAY_MS))
    return out


def null_spans(book, parts) -> list[tuple[int, int]]:
    out = []
    for entry in _days():
        if _null_on(book, parts, entry):
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


def rule_trades(book, parts) -> list[dict]:
    trades = []
    for entry, exit_ms in rule_spans(book, parts):
        trade = _trade(entry, book)
        if trade["exit_ms"] != exit_ms:
            raise RuntimeError("a counted entry did not fill")
        trades.append(trade)
    return trades


def null_trades(book, parts) -> list[dict]:
    trades = []
    for entry, exit_ms in null_spans(book, parts):
        trade = _trade(entry, book)
        if trade["exit_ms"] != exit_ms:
            raise RuntimeError("a counted null did not fill")
        trades.append(trade)
    return trades
