"""Later years of SPQTR. The 2023 screen must reproduce before any later number is kept."""

from __future__ import annotations

import hashlib
import json
import os
import statistics
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import common as c

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
SCREEN_DATA = Path(os.environ.get("FP332_DATA", "/tmp/fp332/data"))
OOS_DATA = Path(os.environ.get("FP332_OOS", "/tmp/fp332/oos"))
PREREG = ROOT / "docs" / "agents" / "reviews" / "2026-09-25-fp332-prereg-spqtr.md"
SIDECAR = ROOT / "docs" / "agents" / "reviews" / "2026-09-25-fp332-prereg-spqtr.sha256"
SCREEN = ROOT / "docs" / "agents" / "backtests" / "fp332" / "screen_2023.json"

OOS_START = 1_704_067_200_000
OOS_SPLIT = 1_735_689_600_000
ENTRY_END = 1_788_220_800_000
LAST_ENTRY = 1_788_134_400_000
OOS_DAYS = 974
PRIMARY_COST = Decimal("0.004")
DOUBLED_COST = Decimal("0.008")

# Delivery opens inside a published month. September 2026 is not here.
EXPIRY = {
    "BTCUSDT_240329": 1711670400000,
    "BTCUSDT_240628": 1719532800000,
    "BTCUSDT_240927": 1727395200000,
    "BTCUSDT_241227": 1735257600000,
    "BTCUSDT_250328": 1743120000000,
    "BTCUSDT_250627": 1750982400000,
    "BTCUSDT_250926": 1758844800000,
    "BTCUSDT_251226": 1766707200000,
    "BTCUSDT_260327": 1774569600000,
    "BTCUSDT_260626": 1782432000000,
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_book(path: Path) -> dict[int, tuple[str, str]]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != 3:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        out[int(row[0])] = (row[1], row[2])
    return out


def merge_book(screen: dict, later: dict, name: str) -> dict:
    out = dict(screen)
    for stamp, bar in later.items():
        if stamp in out and out[stamp] != bar:
            raise SystemExit(f"{name} overlaps the screen and the bars differ")
        out[stamp] = bar
    return out


def basis_rows(spot, books, start, end, expiry, cost) -> list[dict]:
    rows = []
    day = start
    while day < end:
        prev = day - c.fp5.DAY_MS
        found = []
        for symbol, exp in expiry.items():
            book = books.get(symbol)
            if book is None or exp <= day:
                continue
            if prev not in book or day not in book or exp not in book:
                continue
            if prev not in spot or day not in spot or exp not in spot:
                continue
            found.append((exp, symbol))
        if found:
            found.sort()
            exp, symbol = found[0]
            signal = c._bps(c._pair(books[symbol][prev])[1], c._pair(spot[prev])[1])
            entry_bps = c._bps(c._pair(books[symbol][day])[0], c._pair(spot[day])[0])
            exit_bps = c._bps(c._pair(books[symbol][exp])[0], c._pair(spot[exp])[0])
            gross = (entry_bps - exit_bps) / Decimal(10000)
            net = gross - cost
            rows.append(
                {
                    "entry_ms": day,
                    "exit_ms": exp,
                    "gross": gross,
                    "net": net,
                    "pnl": Decimal(100) * net,
                    "on": signal >= c.THRESHOLD_BPS,
                    "signal_bps": signal,
                    "entry_bps": entry_bps,
                    "exit_bps": exit_bps,
                }
            )
        day += c.fp5.DAY_MS
    return rows


def month_of(entry_ms: int) -> str:
    stamp = datetime.fromtimestamp(entry_ms / 1000, timezone.utc)
    return f"{stamp.year:04d}-{stamp.month:02d}"


def summarise(trades: list[dict], pool: list[Decimal]) -> dict:
    n = len(trades)
    total = sum((row["pnl"] for row in trades), Decimal(0))
    mean = total / Decimal(n) / Decimal(100) if n else Decimal(0)
    cutoff = c.fp5.null_p95([float(value) for value in pool], n) if n else None
    by_month: dict[str, Decimal] = {}
    for row in trades:
        key = month_of(row["entry_ms"])
        by_month[key] = by_month.get(key, Decimal(0)) + row["pnl"]
    best_month = max(by_month, key=by_month.get) if by_month else None
    best = by_month[best_month] if best_month else Decimal(0)
    share = (best / total) if total else None
    gap = None if cutoff is None else (mean - Decimal(str(cutoff))) * Decimal(10000)
    return {
        "n": n,
        "total_pnl_usd": round(float(total), 4),
        "mean_net_bps": round(float(mean * Decimal(10000)), 4) if n else None,
        "null_p95_bps": None if cutoff is None else round(c.fp5.bps(cutoff), 4),
        "gap_bps": None if gap is None else round(float(gap), 4),
        "beats_null": bool(cutoff is not None and mean > Decimal(str(cutoff))),
        "clears_by_more_than_20bps": bool(gap is not None and gap > 20),
        "best_month": best_month,
        "best_month_pnl_usd": round(float(best), 4),
        "best_month_share": None if share is None else round(float(share), 4),
        "without_best_month_usd": round(float(total - best), 4),
        "by_month": {key: round(float(value), 4) for key, value in sorted(by_month.items())},
    }


def window_total(trades: list[dict], start: int, end: int) -> Decimal:
    return sum((row["pnl"] for row in trades if start <= row["entry_ms"] < end), Decimal(0))


def main() -> None:
    digest = sha256(PREREG)
    if digest != SIDECAR.read_text().strip():
        raise SystemExit("the pre-registration does not match its frozen sha256")
    if "BTCUSDT_260925" in EXPIRY or "BTCUSDT_261225" in EXPIRY:
        raise SystemExit("an unpublished expiry was used as a front")
    screen_doc = json.loads(SCREEN.read_text())
    if sha256(HERE / "common.py") != screen_doc["code_sha256"]["fp332_common"]:
        raise SystemExit("the rule file moved after the screen")
    if c.THRESHOLD_BPS != Decimal("100") or c.COST != PRIMARY_COST or c.RULE_N != 125:
        raise SystemExit("the frozen threshold, cost or count moved")
    spot = load_book(SCREEN_DATA / "spot.json")
    books = {symbol: load_book(SCREEN_DATA / f"{symbol}.json") for symbol in c.EXPIRY}
    if sha256(SCREEN_DATA / "spot.json") != screen_doc["input_sha256"]["spot.json"]:
        raise SystemExit("the 2023 spot file is not the screen's file")
    screen_rows = c.paths(spot, books)
    rules = [row for row in screen_rows if row["on"]]
    nulls = [row for row in screen_rows if not row["on"]]
    if len(rules) != 125 or len(nulls) != 240:
        raise SystemExit("2023 did not reproduce")
    screen_total = round(sum(row["pnl"] for row in rules), 4)
    if abs(screen_total - 116.6183) > 0.01:
        raise SystemExit(f"2023 dollars did not reproduce: {screen_total}")
    rule_bps = round(sum(row["net"] for row in rules) / 125 * 10000, 4)
    null_bps = round(sum(row["net"] for row in nulls) / 240 * 10000, 4)
    cutoff = c.fp5.null_p95([row["net"] for row in nulls], 125)
    cutoff_bps = round(c.fp5.bps(cutoff), 4)
    if rule_bps != 93.2947 or null_bps != 5.9951 or cutoff_bps != 9.2826:
        raise SystemExit(f"2023 means moved: {rule_bps} {null_bps} {cutoff_bps}")
    copied = basis_rows(spot, books, c.fp5.SCREEN_START_MS, c.fp5.SCREEN_END_MS, c.EXPIRY, PRIMARY_COST)
    if [(row["entry_ms"], row["on"]) for row in copied] != [(row["entry_ms"], row["on"]) for row in screen_rows]:
        raise SystemExit("the later-year loop does not reproduce 2023")
    for left, right in zip(copied, screen_rows):
        if abs(left["net"] - Decimal(str(right["net"]))) > Decimal("1e-9"):
            raise SystemExit("the later-year loop changed a 2023 net")

    later_spot = load_book(OOS_DATA / "spot.json")
    stamps = sorted(later_spot)
    if len(stamps) != 974 or stamps[0] != OOS_START or stamps[-1] != LAST_ENTRY:
        raise SystemExit("the later spot book is not 2024-01-01 through 2026-08-31")
    if ENTRY_END in later_spot:
        raise SystemExit("2026-09-01 was stored")
    merged_spot = merge_book(spot, later_spot, "spot")
    merged = {}
    for symbol, exp in EXPIRY.items():
        later = load_book(OOS_DATA / f"{symbol}.json")
        if exp not in later:
            raise SystemExit(f"{symbol} has no expiry open")
        screen_path = SCREEN_DATA / f"{symbol}.json"
        base = load_book(screen_path) if screen_path.is_file() else {}
        merged[symbol] = merge_book(base, later, symbol)
    primary_rows = basis_rows(merged_spot, merged, OOS_START, ENTRY_END, EXPIRY, PRIMARY_COST)
    doubled_rows = basis_rows(merged_spot, merged, OOS_START, ENTRY_END, EXPIRY, DOUBLED_COST)
    primary = [row for row in primary_rows if row["on"]]
    null_rows = [row for row in primary_rows if not row["on"]]
    doubled = [row for row in doubled_rows if row["on"]]
    if not primary:
        raise SystemExit(f"the out-of-sample run has no fill ({len(primary_rows)} fillable)")
    if [row["entry_ms"] for row in primary] != [row["entry_ms"] for row in doubled]:
        raise SystemExit("the doubled-cost entries moved")
    if max(row["entry_ms"] for row in primary) > LAST_ENTRY:
        raise SystemExit("an entry is after 2026-08-31")
    if any(row["entry_ms"] < OOS_START for row in primary):
        raise SystemExit("a 2023 day was scored as a later year")
    pool = [row["net"] for row in null_rows]
    primary_sum = summarise(primary, pool)
    oos1 = window_total(primary, OOS_START, OOS_SPLIT)
    oos2 = window_total(primary, OOS_SPLIT, ENTRY_END)
    span = (datetime(2026, 9, 1, tzinfo=timezone.utc) - datetime(2024, 1, 1, tzinfo=timezone.utc)).days
    if span != OOS_DAYS:
        raise SystemExit(f"the pre-registration's 974 days came out as {span}")
    ann = (primary_sum["total_pnl_usd"] / 100.0) * (365.0 / OOS_DAYS)
    doubled_total = sum((row["pnl"] for row in doubled), Decimal(0))
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
            "n": 125,
            "null_n": 240,
            "total_pnl_usd": screen_total,
            "mean_net_bps": rule_bps,
            "null_mean_bps": null_bps,
            "null_p95_bps": cutoff_bps,
        },
        "oos1_pnl_usd": round(float(oos1), 4),
        "oos2_pnl_usd": round(float(oos2), 4),
        "oos_days": OOS_DAYS,
        "annualised": round(ann, 6),
        "primary": primary_sum,
        "null_n": len(null_rows),
        "null_mean_bps": round(float(sum(pool) / len(pool) * 10000), 4) if pool else None,
        "doubled_pnl_usd": round(float(doubled_total), 4),
        "median_entry_bps": round(statistics.median(float(row["entry_bps"]) for row in primary), 4),
        "median_exit_bps": round(statistics.median(float(row["exit_bps"]) for row in primary), 4),
        "conditions": conditions,
        "passes": all(conditions.values()),
        "null_kind": "other_regime",
        "last_entry_ms": LAST_ENTRY,
        "code_sha256": {
            "fp332_common": sha256(HERE / "common.py"),
            "fp332_oos_test": sha256(Path(__file__)),
            "fp332_oos_fetch": sha256(HERE / "oos_fetch.py"),
        },
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs" / "agents" / "backtests" / "fp332" / "spqtr_oos.json"
    out.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
