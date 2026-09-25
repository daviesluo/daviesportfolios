"""The pre-registered EREAL test. Entries from 2024-01-01 through 2026-09-23.

The buy and the sell stay where the screen put them. The other trade stays
the same leg with the discount below one basis point. The cutoff stays the
sample p95. It is not the edge-off mean. The 2026-09-25 bar is an exit open.
It is not an entry. A close after 2026-09-22 is not a signal. Refuses to run
until the pre-registration's sha256 matches the sidecar written when it was
frozen. Re-running the 2023 screen is a check, not the bar.

    python3 docs/agents/scripts/fp321/ereal_test.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c
import oos_fetch

ROOT = Path(__file__).resolve().parents[4]
DATA = Path(os.environ.get("FP321_DATA", "/tmp/fp321/data"))
PREREG = ROOT / "docs/agents/reviews/2026-09-25-fp321-prereg-ereal.md"
SIDECAR = ROOT / "docs/agents/reviews/2026-09-25-fp321-prereg-ereal.sha256"
SCREEN = ROOT / "docs/agents/backtests/fp321/screen_2023.json"

CM_BID = 2673.58
CM_ASK = 2673.59
CM_HALF = (CM_ASK - CM_BID) / (CM_ASK + CM_BID)
if CM_HALF != 1.8701481344745498e-06:
    raise SystemExit("the frozen half-spread does not match the frozen book")
FEE = c.fp5.FEE + CM_HALF
FEE_DOUBLE = 0.002 + CM_HALF

OOS_START = int(datetime(2024, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
OOS_SPLIT = int(datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
EXIT_OPEN = int(datetime(2026, 9, 25, tzinfo=timezone.utc).timestamp() * 1000)
LAST_ENTRY = EXIT_OPEN - c.HOLD_DAYS * c.fp5.DAY_MS
ENTRY_END = LAST_ENTRY + c.fp5.DAY_MS
SIGNAL_LAST = LAST_ENTRY - c.fp5.DAY_MS
NULL_DRAWS = 1000
NULL_SEED = 20260925
GAP_BPS = 20.0


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_book(path: Path, last_ms: int) -> dict[int, tuple[Decimal, Decimal]]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != 3:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        ts = int(row[0])
        if ts > last_ms:
            raise SystemExit("a bar after the frozen window was stored")
        out[ts] = (Decimal(row[1]), Decimal(row[2]))
    if not out:
        raise SystemExit(f"{path.name} is empty")
    return out


def load_fair(path: Path, last_ms: int) -> dict[int, Decimal]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != 2:
            raise SystemExit("the fair value carries a field this rule does not use")
        ts = int(row[0])
        if ts >= last_ms:
            raise SystemExit("a fair value on or after the frozen bound was stored")
        out[ts] = Decimal(row[1])
    return out


def month_of(entry_ms: int) -> str:
    stamp = datetime.fromtimestamp(entry_ms / 1000, timezone.utc)
    return f"{stamp.year:04d}-{stamp.month:02d}"


def fill(entry: int, book: dict, fee: float) -> dict | None:
    exit_ms = entry + c.HOLD_DAYS * c.fp5.DAY_MS
    if not (OOS_START <= entry < ENTRY_END):
        return None
    if exit_ms != entry + 2 * c.fp5.DAY_MS or exit_ms > EXIT_OPEN:
        return None
    if entry not in book or exit_ms not in book:
        return None
    entry_px = book[entry][0]
    exit_px = book[exit_ms][0]
    if entry_px <= 0 or exit_px <= 0:
        return None
    net = c.fp5.net_return(float(entry_px), float(exit_px), fee)
    return {
        "coin": "ETHUSD_PERP",
        "book": "cm",
        "side": "long",
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": float(exit_px) / float(entry_px) - 1.0,
        "net": net,
        "pnl": 100.0 * net,
    }


def collect(book: dict, fair: dict, fee: float) -> tuple[list[dict], list[dict]]:
    rules = []
    nulls = []
    entry = OOS_START
    while entry < ENTRY_END:
        trade = fill(entry, book, fee)
        if trade is not None:
            flag = c._cheap(book, fair, entry)
            if flag is True:
                rules.append(trade)
            elif flag is False:
                nulls.append(trade)
        entry += c.fp5.DAY_MS
    return rules, nulls


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
    gap_bps = None if cutoff is None else (mean - cutoff) * 100.0
    return {
        "n": n,
        "total_pnl_usd": round(total, 4),
        "mean_pnl_usd": round(mean, 6) if n else None,
        "null_p95_pnl_usd": None if cutoff is None else round(cutoff, 4),
        "gap_bps": None if gap_bps is None else round(gap_bps, 4),
        "beats_null": bool(cutoff is not None and mean > cutoff),
        "clears_by_more_than_20bps": bool(gap_bps is not None and gap_bps > GAP_BPS),
        "best_month": best_month,
        "best_month_pnl_usd": round(best, 4),
        "best_month_share": None if share is None else round(share, 4),
        "without_best_month_usd": round(total - best, 4),
        "by_month": {key: round(value, 4) for key, value in sorted(by_month.items())},
    }


def window_total(trades: list[dict], start: int, end: int) -> float:
    return sum(t["pnl"] for t in trades if start <= t["entry_ms"] < end)


def merge_book(screen: dict, later: dict) -> dict:
    out = dict(screen)
    for ts, bar in later.items():
        if ts in out:
            if out[ts][0] != bar[0] or out[ts][1] != bar[1]:
                raise SystemExit("an overlapping day does not match the screen")
        out[ts] = bar
    return out


def merge_fair(screen: dict, later: dict) -> dict:
    out = dict(screen)
    for ts, px in later.items():
        if ts in out and out[ts] != px:
            raise SystemExit("an overlapping realized price does not match the screen")
        if ts >= ENTRY_END:
            raise SystemExit("a realized price was published too late to store")
        out[ts] = px
    return out


def main() -> None:
    digest = sha256(PREREG)
    if digest != SIDECAR.read_text().strip():
        raise SystemExit("the pre-registration does not match its frozen sha256")
    prereg = PREREG.read_text()
    for phrase in (
        "bid 2673.58, ask 2673.59, half-spread 1.8701481344745498e-06",
        "the book's own time was 1790351725110",
        "strictly more than 20 bps",
    ):
        if phrase not in prereg:
            raise SystemExit("the frozen book is not the pre-registration")
    if "strictly more than 10 bps" in prereg:
        raise SystemExit("the 10 bp bar was copied")
    screen_doc = json.loads(SCREEN.read_text())
    common_path = Path(__file__).resolve().parent / "common.py"
    if sha256(common_path) != screen_doc["code_sha256"]["fp321_common"]:
        raise SystemExit("the rule file moved after the screen")
    if c.IDEA != "EREAL" or c.HOLD_DAYS != 2 or c.MIN_N != 30 or c.THRESHOLD_BPS != Decimal("1"):
        raise SystemExit("the frozen name, hold, count or threshold moved")
    if c.NULL_KIND != "other_regime" or c.MODE != "regime":
        raise SystemExit("the null is not the edge turned off")
    if c.RULE_BOOK != "cm" or c.NULL_BOOK != "cm" or c.RULE_SIDE != "long":
        raise SystemExit("the legs moved")
    if LAST_ENTRY != int(datetime(2026, 9, 23, tzinfo=timezone.utc).timestamp() * 1000):
        raise SystemExit("the last entry is not 2026-09-23")
    if ENTRY_END != int(datetime(2026, 9, 24, tzinfo=timezone.utc).timestamp() * 1000):
        raise SystemExit("the entry window does not stop on 2026-09-24")
    if SIGNAL_LAST != int(datetime(2026, 9, 22, tzinfo=timezone.utc).timestamp() * 1000):
        raise SystemExit("the last signal close is not 2026-09-22")
    screen_book_path = DATA / "cm1d" / "ETHUSD_PERP.json"
    screen_fair_path = DATA / "realized" / "eth.json"
    if sha256(screen_book_path) != screen_doc["input_sha256"]["book"]:
        raise SystemExit("the 2023 book is not the screen's file")
    if sha256(screen_fair_path) != screen_doc["input_sha256"]["fair"]:
        raise SystemExit("the 2023 realized price is not the screen's file")
    screen_book = load_book(screen_book_path, c.fp5.SCREEN_END_MS)
    screen_fair = load_fair(screen_fair_path, c.fp5.SCREEN_END_MS)
    for iso in ("2023-08-28", "2023-08-29", "2023-08-30", "2023-08-31"):
        year, month, day = (int(part) for part in iso.split("-"))
        stamp = int(datetime(year, month, day, tzinfo=timezone.utc).timestamp() * 1000)
        if stamp in screen_book:
            raise SystemExit("the coin-margined gap was filled in")
    screen = c.rule_trades(screen_book, screen_fair)
    screen_null = c.null_trades(screen_book, screen_fair)
    screen_total = round(sum(t["pnl"] for t in screen), 4)
    if len(screen) != 31 or abs(screen_total - 90.824) > 0.01:
        raise SystemExit(f"2023 did not reproduce: n={len(screen)} total={screen_total}")
    if len(screen_null) != 325:
        raise SystemExit("the 2023 edge-off trade is not 325")
    if set(t["entry_ms"] for t in screen) & set(t["entry_ms"] for t in screen_null):
        raise SystemExit("a 2023 day is in both trades")
    rule_bps = sum(t["net"] for t in screen) / 31 * 10_000.0
    null_bps = sum(t["net"] for t in screen_null) / 325 * 10_000.0
    screen_cutoff = c.fp5.null_p95([t["net"] for t in screen_null], 31)
    cutoff_bps = None if screen_cutoff is None else screen_cutoff * 10_000.0
    if abs(rule_bps - 292.9806) > 0.0001 or abs(null_bps - -3.9242) > 0.0001:
        raise SystemExit("the 2023 means did not reproduce")
    if cutoff_bps is None or abs(cutoff_bps - 76.5994) > 0.0001:
        raise SystemExit("the 2023 cutoff is not the sample p95")
    for trade in screen:
        if trade["entry_ms"] >= OOS_START:
            raise SystemExit("a 2024 open was read as a 2023 entry")

    oos_book_path = DATA / "oos_cm1d" / "ETHUSD_PERP.json"
    oos_fair_path = DATA / "oos_realized" / "eth.json"
    if not oos_book_path.exists() or not oos_fair_path.exists():
        oos_fetch.pull()
    oos_book = load_book(oos_book_path, EXIT_OPEN)
    oos_fair = load_fair(oos_fair_path, ENTRY_END)
    if min(oos_book) != OOS_START or max(oos_book) != EXIT_OPEN:
        raise SystemExit("the coin-margined window is wrong")
    if EXIT_OPEN + c.fp5.DAY_MS in oos_book:
        raise SystemExit("2026-09-26 was stored")
    book = merge_book(screen_book, oos_book)
    fair = merge_fair(screen_fair, oos_fair)
    primary, nulls = collect(book, fair, FEE)
    doubled, doubled_nulls = collect(book, fair, FEE_DOUBLE)
    if not primary:
        raise SystemExit("the out-of-sample run has no fill")
    if [t["entry_ms"] for t in primary] != [t["entry_ms"] for t in doubled]:
        raise SystemExit("the doubled-cost entries moved")
    if [t["entry_ms"] for t in nulls] != [t["entry_ms"] for t in doubled_nulls]:
        raise SystemExit("the doubled-cost edge-off entries moved")
    if set(t["entry_ms"] for t in primary) & set(t["entry_ms"] for t in nulls):
        raise SystemExit("a day is in both trades")
    if max(t["entry_ms"] for t in primary) > LAST_ENTRY:
        raise SystemExit("an entry is after 2026-09-23")
    if any(t["exit_ms"] > EXIT_OPEN for t in primary):
        raise SystemExit("an exit is after the 2026-09-25 open")
    wrecked = dict(book)
    for trade in primary:
        opened, closed = wrecked[trade["entry_ms"]]
        wrecked[trade["entry_ms"]] = (opened * Decimal(10), closed)
    for ts, (opened, closed) in list(wrecked.items()):
        if ts > SIGNAL_LAST:
            wrecked[ts] = (opened, closed * Decimal(7))
    wrecked_rules, _wrecked_nulls = collect(wrecked, fair, FEE)
    if [t["entry_ms"] for t in wrecked_rules] != [t["entry_ms"] for t in primary]:
        raise SystemExit("a later close or the entry open moved a buy")
    sample = primary[0]
    late_fair = dict(fair)
    late_fair[sample["entry_ms"]] = Decimal("0.01")
    if [t["entry_ms"] for t in collect(book, late_fair, FEE)[0]] != [t["entry_ms"] for t in primary]:
        raise SystemExit("a fair value stamped on the entry was used")
    thin = dict(book)
    del thin[sample["exit_ms"]]
    if any(t["entry_ms"] == sample["entry_ms"] for t in collect(thin, fair, FEE)[0]):
        raise SystemExit("a missing open was borrowed")
    pool = [t["pnl"] for t in nulls]
    holds = {trade["exit_ms"] - trade["entry_ms"] for trade in primary}
    if holds != {c.HOLD_DAYS * c.fp5.DAY_MS}:
        raise SystemExit("the rule hold is not two days")
    primary_sum = summarise(primary, pool)
    house = c.fp5.null_p95(pool, len(primary), draws=NULL_DRAWS, seed=NULL_SEED)
    if house is None:
        if primary_sum["null_p95_pnl_usd"] is not None or primary_sum["beats_null"]:
            raise SystemExit("a short edge-off set was replaced with its mean")
    elif abs(primary_sum["null_p95_pnl_usd"] - round(house, 4)) > 1e-9:
        raise SystemExit("the cutoff is not the sample p95")
    other_mean = sum(pool) / len(pool) if pool else None
    if house is not None and other_mean is not None and len(pool) > len(primary):
        if abs(house - other_mean) < 1e-12:
            raise SystemExit("the cutoff collapsed onto the edge-off mean")
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
        "not_one_month": bool(
            share is not None and share <= 0.40 and primary_sum["without_best_month_usd"] > 0
        ),
        "above_cash": ann > 0.04,
        "clears_by_more_than_20bps": primary_sum["clears_by_more_than_20bps"],
    }
    payload = {
        "prereg_sha256": digest,
        "screen_reproduction": {
            "n": len(screen),
            "total_pnl_usd": screen_total,
            "mean_net_bps": round(rule_bps, 4),
            "null_n": len(screen_null),
            "null_mean_bps": round(null_bps, 4),
            "null_p95_bps": round(cutoff_bps, 4),
        },
        "oos1_pnl_usd": round(oos1, 4),
        "oos2_pnl_usd": round(oos2, 4),
        "oos_days": oos_days,
        "annualised": round(ann, 6),
        "primary": primary_sum,
        "null_n": len(nulls),
        "null_mean_pnl_usd": None if other_mean is None else round(other_mean, 6),
        "doubled_pnl_usd": round(doubled_total, 4),
        "conditions": conditions,
        "passes": all(conditions.values()),
        "cm_half_spread": CM_HALF,
        "null_kind": "other_regime",
        "last_entry_ms": LAST_ENTRY,
        "exit_open_ms": EXIT_OPEN,
        "signal_last_ms": SIGNAL_LAST,
        "input_sha256": {
            "screen_book": sha256(screen_book_path),
            "screen_fair": sha256(screen_fair_path),
            "oos_book": sha256(oos_book_path),
            "oos_fair": sha256(oos_fair_path),
        },
        "code_sha256": {
            "fp321_common": sha256(common_path),
            "fp321_ereal_test": sha256(Path(__file__)),
            "fp321_oos_fetch": sha256(Path(oos_fetch.__file__)),
        },
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp321/ereal_oos.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
