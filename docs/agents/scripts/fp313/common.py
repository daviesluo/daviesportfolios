"""The search fp313. Fair value is the price index inside Binance's funding formula for BTCUSDT. The last settled funding rate is negative, so that contract finished below the index. Buy the USDT book for two days. The other trade buys it for two days when that rate is not negative.

Nothing here reads the network or a file. The prints used by the signal have
already happened. Fair value is not another venue's last trade, and it is not
computed from this contract's daily bars. The entry open is not an input. A
fill is an open on the contract being traded. The position is one leg. It is
not a one-day trade and it is not an overnight trade. Funding cash is not
added. The null is the same leg with the price edge turned off. It is not the
opposite side and it is not an unconditional hold. A book ticker is not read.
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
IDEA = "UZERO"
HOLD_DAYS = 2
NULL_KIND = "other_regime"
MODE = "regime"
FAIR_KIND = "index"
RULE_BOOK = "um"
NULL_BOOK = "um"
RULE_SIDE = "long"
NULL_SIDE = "long"
SYMBOL = "BTCUSDT"
FUND_N = 1188
FUND_FIRST = 1_669_852_800_000 + 1
FUND_LAST = 1_704_038_400_000
BOOK_ROWS = 366
HISTORY_HOST = "https://www.binance.com/fapi/v1/fundingRate"

if HOLD_DAYS <= 1:
    raise RuntimeError("the hold is one day or overnight")
if NULL_KIND != "other_regime" or MODE != "regime":
    raise RuntimeError("the edge-off trade is not this leg")
if RULE_BOOK != NULL_BOOK or RULE_SIDE != NULL_SIDE or RULE_SIDE != "long":
    raise RuntimeError("the edge-off trade changed the leg")
if FAIR_KIND not in ("index", "sofr"):
    raise RuntimeError("the fair value is not named")
if FUND_FIRST >= fp5.SCREEN_START_MS or FUND_LAST >= fp5.SCREEN_END_MS:
    raise RuntimeError("the funding window moved")


def _days():
    t = fp5.SCREEN_START_MS
    while t < fp5.SCREEN_END_MS:
        yield t
        t += fp5.DAY_MS


def _open(book: dict, ts: int) -> float | None:
    row = book.get(ts)
    if row is None or len(row) < 1:
        return None
    px = float(row[0])
    if px <= 0.0:
        return None
    return px


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


def _cheap(fund: dict, sofr: dict, entry: int) -> bool | None:
    """True when the open is cheap to the named fair value. None when a print is missing."""
    stamp = _latest(sorted(fund), entry)
    if stamp is None:
        return None
    rate = fund[stamp]
    if FAIR_KIND == "index":
        return rate < 0.0
    if FAIR_KIND == "sofr":
        pub = _latest(sorted(sofr), entry)
        if pub is None:
            return None
        return rate < sofr_eight(sofr[pub])
    raise RuntimeError("fair")


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


def _rule_on(book, fund, sofr, entry) -> bool:
    if _window(entry, book) is None:
        return False
    return _cheap(fund, sofr, entry) is True


def _null_on(book, fund, sofr, entry) -> bool:
    if _window(entry, book) is None:
        return False
    flag = _cheap(fund, sofr, entry)
    if flag is None:
        return False
    return not flag


def rule_spans(book, fund, sofr) -> list[tuple[int, int]]:
    out = []
    for entry in _days():
        if _rule_on(book, fund, sofr, entry):
            out.append((entry, entry + HOLD_DAYS * fp5.DAY_MS))
    return out


def null_spans(book, fund, sofr) -> list[tuple[int, int]]:
    out = []
    for entry in _days():
        if _null_on(book, fund, sofr, entry):
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
    gross = exit_px / entry_px - 1.0
    net = fp5.net_return(entry_px, exit_px)
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


def rule_trades(book, fund, sofr) -> list[dict]:
    trades = []
    for entry, exit_ms in rule_spans(book, fund, sofr):
        trade = _trade(entry, book)
        if trade["exit_ms"] != exit_ms:
            raise RuntimeError("a counted entry did not fill")
        trades.append(trade)
    return trades


def null_trades(book, fund, sofr) -> list[dict]:
    trades = []
    for entry, exit_ms in null_spans(book, fund, sofr):
        trade = _trade(entry, book)
        if trade["exit_ms"] != exit_ms:
            raise RuntimeError("a counted null did not fill")
        trades.append(trade)
    return trades
