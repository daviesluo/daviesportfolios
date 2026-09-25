"""Later years of FDCSH. The 2023 screen must reproduce before any later number is kept."""

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
SCREEN_DATA = Path(os.environ.get("FP334_DATA", "/tmp/fp334/data"))
OOS_DATA = Path(os.environ.get("FP334_OOS", "/tmp/fp334/oos"))
PREREG = ROOT / "docs" / "agents" / "reviews" / "2026-09-25-fp334-prereg-fdcsh.md"
SIDECAR = ROOT / "docs" / "agents" / "reviews" / "2026-09-25-fp334-prereg-fdcsh.sha256"
SCREEN = ROOT / "docs" / "agents" / "backtests" / "fp334" / "screen_2023.json"

OOS_START = 1_704_067_200_000
OOS_SPLIT = 1_735_689_600_000
ENTRY_END = 1_788_220_800_000
OOS_DAYS = 974
PRIMARY_COST = Decimal("0.004")
DOUBLED_COST = Decimal("0.008")


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


def load_funding(path: Path) -> dict[int, tuple[int, Decimal]]:
    """Exact stamps. A print a few milliseconds off the hour is not that hour.

    The 2023 screen drops those prints. Snapping them would change that
    screen, so the later years drop them too.
    """
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != 3:
            raise SystemExit("the funding file carries a field this rule does not use")
        out[int(row[0])] = (int(row[1]), Decimal(row[2]))
    return out


def snapped_funding(path: Path) -> dict[int, tuple[int, Decimal]]:
    """The same file read onto the hour, within two minutes. Not the scored rule."""
    rows = json.loads(path.read_text())
    out = {}
    hour = c.HOUR_MS
    for row in rows:
        stamp = int(row[0])
        quotient, remainder = divmod(stamp, hour)
        if remainder > hour - remainder:
            quotient += 1
        snapped = quotient * hour
        value = (int(row[1]), Decimal(row[2]))
        if snapped in out and out[snapped] != value:
            raise SystemExit("two funding prints fell on one hour")
        out[snapped] = value
    return out


def merge_map(screen: dict, later: dict, name: str) -> dict:
    out = dict(screen)
    for stamp, value in later.items():
        if stamp in out and out[stamp] != value:
            raise SystemExit(f"{name} overlaps the screen and the rows differ")
        out[stamp] = value
    return out


def cash_rows(spot, perp, funding, start, end, cost) -> list[dict]:
    rows = []
    for settle in sorted(funding):
        hours, rate = funding[settle]
        entry_ms = settle - c.HOUR_MS
        exit_ms = settle + c.HOUR_MS
        if not (start <= entry_ms < end):
            continue
        if entry_ms not in spot or entry_ms not in perp or exit_ms not in spot or exit_ms not in perp:
            continue
        signal = c.signal_premium(spot, perp, settle, int(hours))
        if signal is None:
            continue
        c._pair(spot[entry_ms])
        c._pair(perp[entry_ms])
        c._pair(spot[exit_ms])
        c._pair(perp[exit_ms])
        cash_bps = -Decimal(rate) * Decimal(10000)
        gross = cash_bps / Decimal(10000)
        net = gross - cost
        rows.append(
            {
                "entry_ms": entry_ms,
                "exit_ms": exit_ms,
                "gross": gross,
                "net": net,
                "pnl": Decimal(100) * net,
                "on": signal <= -c.THRESHOLD_BPS,
                "signal_bps": signal,
                "entry_bps": cash_bps,
                "exit_bps": Decimal(0),
            }
        )
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
        "entry_days": len({row["entry_ms"] // c.fp5.DAY_MS for row in trades}),
    }


def window_total(trades: list[dict], start: int, end: int) -> Decimal:
    return sum((row["pnl"] for row in trades if start <= row["entry_ms"] < end), Decimal(0))


def main() -> None:
    digest = sha256(PREREG)
    if digest != SIDECAR.read_text().strip():
        raise SystemExit("the pre-registration does not match its frozen sha256")
    screen_doc = json.loads(SCREEN.read_text())
    if sha256(HERE / "common.py") != screen_doc["code_sha256"]["fp334_common"]:
        raise SystemExit("the rule file moved after the screen")
    if c.THRESHOLD_BPS != Decimal("50") or c.COST != PRIMARY_COST or c.RULE_N != 85:
        raise SystemExit("the frozen threshold, cost or count moved")
    spot = load_book(SCREEN_DATA / "spot.json")
    perp = load_book(SCREEN_DATA / "perp.json")
    funding = load_funding(SCREEN_DATA / "funding.json")
    if sha256(SCREEN_DATA / "funding.json") != screen_doc["input_sha256"]["funding.json"]:
        raise SystemExit("the 2023 funding file is not the screen's file")
    screen_rows = c.paths(spot, perp, funding)
    rules = [row for row in screen_rows if row["on"]]
    nulls = [row for row in screen_rows if not row["on"]]
    days = len({row["entry_ms"] // c.fp5.DAY_MS for row in rules})
    if len(rules) != 85 or len(nulls) != 815 or days != 36:
        raise SystemExit("2023 did not reproduce")
    screen_total = round(sum(row["pnl"] for row in rules), 4)
    if abs(screen_total - 75.2789) > 0.01:
        raise SystemExit(f"2023 dollars did not reproduce: {screen_total}")
    rule_bps = round(sum(row["net"] for row in rules) / 85 * 10000, 4)
    null_bps = round(sum(row["net"] for row in nulls) / 815 * 10000, 4)
    cutoff = c.fp5.null_p95([row["net"] for row in nulls], 85)
    cutoff_bps = round(c.fp5.bps(cutoff), 4)
    if rule_bps != 88.5634 or null_bps != -38.3963 or cutoff_bps != -36.9061:
        raise SystemExit(f"2023 means moved: {rule_bps} {null_bps} {cutoff_bps}")
    copied = cash_rows(spot, perp, funding, c.fp5.SCREEN_START_MS, c.fp5.SCREEN_END_MS, PRIMARY_COST)
    if [(row["entry_ms"], row["on"]) for row in copied] != [(row["entry_ms"], row["on"]) for row in screen_rows]:
        raise SystemExit("the later-year loop does not reproduce 2023")
    for left, right in zip(copied, screen_rows):
        if abs(left["net"] - Decimal(str(right["net"]))) > Decimal("1e-9"):
            raise SystemExit("the later-year loop changed a 2023 net")

    later_spot = load_book(OOS_DATA / "spot.json")
    later_perp = load_book(OOS_DATA / "perp.json")
    later_funding = load_funding(OOS_DATA / "funding.json")
    if any(stamp >= ENTRY_END for stamp in later_spot):
        raise SystemExit("a September 2026 hour was stored")
    merged_spot = merge_map(spot, later_spot, "spot")
    merged_perp = merge_map(perp, later_perp, "perp")
    merged_funding = merge_map(funding, later_funding, "funding")
    primary_rows = cash_rows(merged_spot, merged_perp, merged_funding, OOS_START, ENTRY_END, PRIMARY_COST)
    doubled_rows = cash_rows(merged_spot, merged_perp, merged_funding, OOS_START, ENTRY_END, DOUBLED_COST)
    primary = [row for row in primary_rows if row["on"]]
    null_rows = [row for row in primary_rows if not row["on"]]
    doubled = [row for row in doubled_rows if row["on"]]
    if [row["entry_ms"] for row in primary] != [row["entry_ms"] for row in doubled]:
        raise SystemExit("the doubled-cost entries moved")
    if not primary_rows:
        raise SystemExit("the later window has no readable settlement")
    if any(row["entry_ms"] >= ENTRY_END or row["entry_ms"] < OOS_START for row in primary):
        raise SystemExit("an entry is outside the pre-registered window")
    snapped_screen = snapped_funding(SCREEN_DATA / "funding.json")
    snapped_later = snapped_funding(OOS_DATA / "funding.json")
    snapped = merge_map(snapped_screen, snapped_later, "snapped funding")
    snapped_rows = cash_rows(merged_spot, merged_perp, snapped, OOS_START, ENTRY_END, PRIMARY_COST)
    snapped_on = [row for row in snapped_rows if row["on"]]
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
            "n": 85,
            "null_n": 815,
            "entry_days": 36,
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
        "median_cash_bps": None
        if not primary
        else round(statistics.median(float(row["entry_bps"]) for row in primary), 4),
        "median_exit_bps": 0,
        "fillable_n": len(primary_rows),
        "cheapest_signal_bps": None
        if not primary_rows
        else round(float(min(row["signal_bps"] for row in primary_rows)), 4),
        "off_hour_prints_not_scored": len(snapped_rows) - len(primary_rows),
        "snapped_fillable_n": len(snapped_rows),
        "snapped_rule_n": len(snapped_on),
        "snapped_cheapest_signal_bps": None
        if not snapped_rows
        else round(float(min(row["signal_bps"] for row in snapped_rows)), 4),
        "conditions": conditions,
        "passes": all(conditions.values()),
        "null_kind": "other_regime",
        "code_sha256": {
            "fp334_common": sha256(HERE / "common.py"),
            "fp334_oos_test": sha256(Path(__file__)),
            "fp334_oos_fetch": sha256(HERE / "oos_fetch.py"),
        },
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs" / "agents" / "backtests" / "fp334" / "fdcsh_oos.json"
    out.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
