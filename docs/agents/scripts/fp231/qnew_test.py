"""The pre-registered QNEW test. Entries from 2024-01-01 through 2026-09-13.

The buy and the sell stay where the screen put them. A bar on an expiry
midnight is not stored. BTCUSD_261225 is not an entry. Refuses to run until
the pre-registration's sha256 matches the sidecar written when it was frozen.
Re-running the 2023 screen is a check, not the bar.

    python3 docs/agents/scripts/fp231/qnew_test.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c
import oos_fetch

ROOT = Path(__file__).resolve().parents[4]
DATA = Path(os.environ.get("FP231_DATA", "/tmp/fp231/data"))
PREREG = ROOT / "docs/agents/reviews/2026-09-25-fp231-prereg-qnew.md"
SIDECAR = ROOT / "docs/agents/reviews/2026-09-25-fp231-prereg-qnew.sha256"
SCREEN = ROOT / "docs/agents/backtests/fp231/screen_2023.json"

BID = 85644.4
ASK = 85685.6
HALF_SPREAD = (ASK - BID) / (ASK + BID)
if HALF_SPREAD != 0.0002404716045059922:
    raise SystemExit("the frozen half-spread does not match the frozen book")
FEE = c.fp5.FEE + HALF_SPREAD
FEE_DOUBLE = 0.002 + HALF_SPREAD

OOS_START = int(datetime(2024, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
OOS_SPLIT = int(datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
ENTRY_END = int(datetime(2026, 9, 14, tzinfo=timezone.utc).timestamp() * 1000)
LAST_ENTRY = int(datetime(2026, 9, 13, tzinfo=timezone.utc).timestamp() * 1000)
NULL_DRAWS = 1000
NULL_SEED = 20260925
LISTED = oos_fetch.LISTED


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_bars(path: Path, last_ms: int) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != 2:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        ts = int(row[0])
        if ts > last_ms:
            raise SystemExit("a bar after the frozen window was stored")
        out[ts] = (float(row[1]),)
    if not out:
        raise SystemExit(f"{path.name} is empty")
    return out


def month_of(entry_ms: int) -> str:
    stamp = datetime.fromtimestamp(entry_ms / 1000, timezone.utc)
    return f"{stamp.year:04d}-{stamp.month:02d}"


def active(entry: int) -> tuple[int, int, str] | None:
    chosen = None
    for listed, expiry, symbol in LISTED:
        if listed <= entry:
            chosen = (listed, expiry, symbol)
    return chosen


def fill(entry: int, books: dict, fee: float, young_only: bool) -> dict | None:
    found = active(entry)
    if found is None:
        return None
    listed, expiry, symbol = found
    if symbol in {row[2] for row in LISTED[:3]}:
        return None
    age = (entry - listed) // c.fp5.DAY_MS
    if young_only and age > c.AGE_MAX:
        return None
    if age < 0:
        return None
    exit_ms = entry + c.HOLD_DAYS * c.fp5.DAY_MS
    if not (OOS_START <= entry < ENTRY_END):
        return None
    if exit_ms >= expiry or exit_ms != entry + 11 * c.fp5.DAY_MS:
        return None
    book = books.get(symbol)
    if book is None:
        return None
    entry_px = c._open(book, entry)
    exit_px = c._open(book, exit_ms)
    if entry_px is None or exit_px is None:
        return None
    net = c.fp5.net_return(entry_px, exit_px, fee)
    return {
        "coin": c.COIN,
        "symbol": symbol,
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": exit_px / entry_px - 1.0,
        "net": net,
        "pnl": 100.0 * net,
    }


def trades_of(books: dict, fee: float, young_only: bool) -> list[dict]:
    out = []
    entry = OOS_START
    while entry < ENTRY_END:
        trade = fill(entry, books, fee, young_only)
        if trade is not None:
            out.append(trade)
        entry += c.fp5.DAY_MS
    return out


def check_fill(books: dict, trade: dict, fee: float, young_only: bool) -> None:
    entry = trade["entry_ms"]
    if entry >= ENTRY_END or entry > LAST_ENTRY:
        raise SystemExit("an entry is after 2026-09-13")
    found = active(entry)
    if found is None or found[2] != trade["symbol"]:
        raise SystemExit("the contract is not the latest listing")
    listed, expiry, symbol = found
    if symbol in {row[2] for row in c.LISTED}:
        raise SystemExit("a 2023 contract was traded after 2024")
    age = (entry - listed) // c.fp5.DAY_MS
    if young_only and not 0 <= age <= c.AGE_MAX:
        raise SystemExit("the age window moved")
    if trade["exit_ms"] - entry != c.HOLD_DAYS * c.fp5.DAY_MS:
        raise SystemExit("the hold moved")
    if trade["exit_ms"] >= expiry:
        raise SystemExit("the sale landed on expiry")
    book = books[symbol]
    if trade["exit_ms"] not in book or max(book) >= expiry:
        raise SystemExit("an expiry bar was stored")
    entry_px = book[entry][0]
    exit_px = book[trade["exit_ms"]][0]
    net = c.fp5.net_return(entry_px, exit_px, fee)
    if abs(trade["net"] - net) > 1e-12 or abs(trade["pnl"] - 100.0 * net) > 1e-9:
        raise SystemExit("a fill is not the open eleven days later")
    if abs(trade["gross"] - (exit_px / entry_px - 1.0)) > 1e-12:
        raise SystemExit("the gross is not the one leg")


def summarise(trades: list[dict], pool: list[float]) -> dict:
    n = len(trades)
    total = sum(t["pnl"] for t in trades)
    mean = total / n if n else 0.0
    cutoff = c.fp5.null_p95(pool, n, draws=NULL_DRAWS, seed=NULL_SEED) if n else None
    by_month: dict[str, float] = {}
    for trade in trades:
        key = month_of(trade["entry_ms"])
        by_month[key] = by_month.get(key, 0.0) + trade["pnl"]
    best_month = max(by_month, key=by_month.get) if by_month else None
    best = by_month[best_month] if best_month else 0.0
    share = (best / total) if total else None
    return {
        "n": n,
        "total_pnl_usd": round(total, 4),
        "mean_pnl_usd": round(mean, 6) if n else None,
        "null_p95_pnl_usd": None if cutoff is None else round(cutoff, 4),
        "beats_null": bool(cutoff is not None and mean > cutoff),
        "best_month": best_month,
        "best_month_pnl_usd": round(best, 4),
        "best_month_share": None if share is None else round(share, 4),
        "without_best_month_usd": round(total - best, 4),
        "by_month": {key: round(value, 4) for key, value in sorted(by_month.items())},
    }


def window_total(trades: list[dict], start: int, end: int) -> float:
    return sum(t["pnl"] for t in trades if start <= t["entry_ms"] < end)


def main() -> None:
    digest = sha256(PREREG)
    if digest != SIDECAR.read_text().strip():
        raise SystemExit("the pre-registration does not match its frozen sha256")
    prereg = PREREG.read_text()
    if "bid 85644.4, ask 85685.6" not in prereg or "0.0002404716045059922" not in prereg:
        raise SystemExit("the frozen book is not the pre-registration")
    oos_fetch.require_frozen()
    screen_doc = json.loads(SCREEN.read_text())
    common_path = Path(__file__).resolve().parent / "common.py"
    if sha256(common_path) != screen_doc["code_sha256"]["fp231_common"]:
        raise SystemExit("the rule file moved after the screen")
    if c.IDEA != "QNEW" or c.HOLD_DAYS != 11 or c.AGE_MAX != 13 or c.MIN_N != 30:
        raise SystemExit("the frozen name, hold, age or count moved")
    if LISTED[:3] != c.LISTED:
        raise SystemExit("the 2023 list moved")
    screen_books = {}
    for _listed, expiry, symbol in c.LISTED:
        path = DATA / "cm1d" / f"{symbol}.json"
        if sha256(path) != screen_doc["input_sha256"][symbol]:
            raise SystemExit(f"the 2023 prices of {symbol} are not the screen's file")
        screen_books[symbol] = load_bars(path, expiry)
        if max(screen_books[symbol]) > expiry:
            raise SystemExit(f"{symbol} stored a bar after expiry")
    screen = c.signal_trades(screen_books)
    screen_total = round(sum(t["pnl"] for t in screen), 4)
    if len(screen) != 40 or abs(screen_total - 304.5022) > 0.01:
        raise SystemExit(f"2023 did not reproduce: n={len(screen)} total={screen_total}")
    for trade in screen:
        if trade["entry_ms"] >= OOS_START:
            raise SystemExit("a 2024 open was read as a 2023 entry")
        found = c.active(trade["entry_ms"])
        extended = active(trade["entry_ms"])
        if found is None or extended is None or found[2] != extended[2]:
            raise SystemExit("the later list moved a 2023 contract")
        book = screen_books[found[2]]
        entry_px = book[trade["entry_ms"]][0]
        exit_px = book[trade["exit_ms"]][0]
        if abs(trade["net"] - c.fp5.net_return(entry_px, exit_px)) > 1e-12:
            raise SystemExit("a 2023 fill is not the screen fee")

    oos_dir = DATA / "oos_cm1d"
    if not oos_dir.exists() or not any(oos_dir.glob("BTCUSD_*.json")):
        oos_fetch.pull()
    books = {}
    skipped = []
    input_sha = {}
    for listing, expiry, symbol in LISTED[3:]:
        path = oos_dir / f"{symbol}.json"
        if not path.exists():
            skipped.append(symbol)
            continue
        last = expiry - c.fp5.DAY_MS
        book = load_bars(path, last)
        if max(book) >= expiry or max(book) != last:
            raise SystemExit(f"{symbol} does not stop the day before expiry")
        if min(book) < listing:
            raise SystemExit(f"{symbol} starts before it listed")
        books[symbol] = book
        input_sha[symbol] = sha256(path)
    if not books:
        raise SystemExit("every later quarterly was missing")
    age0 = (OOS_START - LISTED[3][0]) // c.fp5.DAY_MS
    if age0 != 3:
        raise SystemExit("2024-01-01 is not age 3 of BTCUSD_240329")
    primary = trades_of(books, FEE, True)
    doubled = trades_of(books, FEE_DOUBLE, True)
    if not primary:
        raise SystemExit("the out-of-sample run has no fill")
    if [t["entry_ms"] for t in primary] != [t["entry_ms"] for t in doubled]:
        raise SystemExit("the doubled-cost entries moved")
    if max(t["entry_ms"] for t in primary) > LAST_ENTRY:
        raise SystemExit("an entry is after 2026-09-13")
    for trade in primary:
        check_fill(books, trade, FEE, True)
    for trade in doubled:
        check_fill(books, trade, FEE_DOUBLE, True)
    pool_trades = trades_of(books, FEE, False)
    for trade in pool_trades:
        check_fill(books, trade, FEE, False)
        if trade["exit_ms"] - trade["entry_ms"] != 11 * c.fp5.DAY_MS:
            raise SystemExit("the null hold moved")
    pool = [t["pnl"] for t in pool_trades]
    pool_entries = {t["entry_ms"] for t in pool_trades}
    if len(pool) < len(primary) or any(t["entry_ms"] not in pool_entries for t in primary):
        raise SystemExit("the null pool does not contain the trades")
    primary_sum = summarise(primary, pool)
    oos1 = window_total(primary, OOS_START, OOS_SPLIT)
    oos2 = window_total(primary, OOS_SPLIT, ENTRY_END)
    oos_days = (datetime(2026, 9, 25, tzinfo=timezone.utc) - datetime(2024, 1, 1, tzinfo=timezone.utc)).days
    if oos_days != 998:
        raise SystemExit(f"the pre-registration's 998 days came out as {oos_days}")
    ann = (primary_sum["total_pnl_usd"] / 100.0) * (365.0 / oos_days)
    doubled_total = sum(t["pnl"] for t in doubled)
    share = primary_sum["best_month_share"]
    conditions = {
        "both_subwindows_positive": oos1 > 0 and oos2 > 0 and primary_sum["total_pnl_usd"] > 0,
        "beats_null": primary_sum["beats_null"],
        "doubled_costs_positive": doubled_total > 0,
        "at_least_30": primary_sum["n"] >= 30,
        "not_one_month": bool(share is not None and share <= 0.40 and primary_sum["without_best_month_usd"] > 0),
        "above_cash": ann > 0.04,
    }
    payload = {
        "prereg_sha256": digest,
        "screen_reproduction": {"n": len(screen), "total_pnl_usd": screen_total},
        "oos1_pnl_usd": round(oos1, 4),
        "oos2_pnl_usd": round(oos2, 4),
        "oos_days": oos_days,
        "annualised": round(ann, 6),
        "primary": primary_sum,
        "doubled_pnl_usd": round(doubled_total, 4),
        "pool_n": len(pool),
        "skipped": skipped,
        "conditions": conditions,
        "passes": all(conditions.values()),
        "half_spread": HALF_SPREAD,
        "last_entry_ms": LAST_ENTRY,
        "input_sha256": input_sha,
        "code_sha256": {
            "fp231_common": sha256(common_path),
            "fp231_qnew_test": sha256(Path(__file__)),
            "fp231_oos_fetch": sha256(Path(oos_fetch.__file__)),
        },
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp231/qnew_oos.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
