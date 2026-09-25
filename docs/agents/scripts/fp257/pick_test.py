"""The pre-registered PICK test. Entries from 2024-01-01 through 2026-09-16.

The buy and the sell stay where the screen put them. The other trade stays
the nine-day spot long on the same entries. It is not the coin-margined long
with the decline turned off. The 2026-09-25 bar is an exit open. It is not
an entry. A close after 2026-09-15 is not a signal. Refuses to run until the
pre-registration's sha256 matches the sidecar written when it was frozen.
Re-running the 2023 screen is a check, not the bar.

    python3 docs/agents/scripts/fp257/pick_test.py
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
DATA = Path(os.environ.get("FP257_DATA", "/tmp/fp257/data"))
PREREG = ROOT / "docs/agents/reviews/2026-09-25-fp257-prereg-pick.md"
SIDECAR = ROOT / "docs/agents/reviews/2026-09-25-fp257-prereg-pick.sha256"
SCREEN = ROOT / "docs/agents/backtests/fp257/screen_2023.json"

CM_BID = 84467.7
CM_ASK = 84467.8
CM_HALF = (CM_ASK - CM_BID) / (CM_ASK + CM_BID)
if CM_HALF != 5.91941895018044e-07:
    raise SystemExit("the frozen coin-margined half-spread does not match the frozen book")
SPOT_BID = 84529.73
SPOT_ASK = 84529.74
SPOT_HALF = (SPOT_ASK - SPOT_BID) / (SPOT_ASK + SPOT_BID)
if SPOT_HALF != 5.915078291274204e-08:
    raise SystemExit("the frozen spot half-spread does not match the frozen book")
RULE_FEE = c.fp5.FEE + CM_HALF
NULL_FEE = c.fp5.FEE + SPOT_HALF
RULE_FEE_DOUBLE = 0.002 + CM_HALF
NULL_FEE_DOUBLE = 0.002 + SPOT_HALF

OOS_START = int(datetime(2024, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
OOS_SPLIT = int(datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
EXIT_OPEN = int(datetime(2026, 9, 25, tzinfo=timezone.utc).timestamp() * 1000)
LAST_ENTRY = EXIT_OPEN - c.HOLD_DAYS * c.fp5.DAY_MS
ENTRY_END = LAST_ENTRY + c.fp5.DAY_MS
SIGNAL_LAST = LAST_ENTRY - c.fp5.DAY_MS
NULL_DRAWS = 1000
NULL_SEED = 20260925


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_bars(path: Path, width: int, last_ms: int) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != width + 1:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        ts = int(row[0])
        if ts > last_ms:
            raise SystemExit("a bar after the frozen window was stored")
        out[ts] = tuple(float(x) for x in row[1:])
    if not out:
        raise SystemExit(f"{path.name} is empty")
    return out


def month_of(entry_ms: int) -> str:
    stamp = datetime.fromtimestamp(entry_ms / 1000, timezone.utc)
    return f"{stamp.year:04d}-{stamp.month:02d}"


def fill(entry: int, book: dict, fee: float, book_name: str) -> dict | None:
    exit_ms = entry + c.HOLD_DAYS * c.fp5.DAY_MS
    if not (OOS_START <= entry < ENTRY_END):
        return None
    if exit_ms != entry + 9 * c.fp5.DAY_MS or exit_ms > EXIT_OPEN:
        return None
    entry_px = c._px(book, entry, 0)
    exit_px = c._px(book, exit_ms, 0)
    if entry_px is None or exit_px is None:
        return None
    net = c.fp5.net_return(entry_px, exit_px, fee)
    return {
        "coin": "BTCUSDT" if book_name == "spot" else "BTCUSD_PERP",
        "book": book_name,
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": exit_px / entry_px - 1.0,
        "net": net,
        "pnl": 100.0 * net,
    }


def paired(spot: dict, cm: dict, rule_fee: float, null_fee: float) -> tuple[list[dict], list[dict]]:
    rules = []
    nulls = []
    entry = OOS_START
    while entry < ENTRY_END:
        if c._signal(spot, {}, cm, entry):
            rule = fill(entry, cm, rule_fee, "cm")
            other = fill(entry, spot, null_fee, "spot")
            if rule is not None and other is not None:
                rules.append(rule)
                nulls.append(other)
        entry += c.fp5.DAY_MS
    return rules, nulls


def fillable(book: dict, fee: float, book_name: str) -> int:
    n = 0
    entry = OOS_START
    while entry < ENTRY_END:
        if fill(entry, book, fee, book_name) is not None:
            n += 1
        entry += c.fp5.DAY_MS
    return n


def check_pair(spot: dict, cm: dict, rule: dict, other: dict, rule_fee: float, null_fee: float) -> None:
    entry = rule["entry_ms"]
    if entry != other["entry_ms"]:
        raise SystemExit("the other trade is not the same entry")
    if entry > LAST_ENTRY or entry >= ENTRY_END:
        raise SystemExit("an entry is after 2026-09-16")
    if rule["book"] != "cm" or other["book"] != "spot":
        raise SystemExit("the legs moved")
    if rule["exit_ms"] - entry != c.HOLD_DAYS * c.fp5.DAY_MS:
        raise SystemExit("the hold moved")
    if other["exit_ms"] != rule["exit_ms"]:
        raise SystemExit("the other trade's hold moved")
    if rule["exit_ms"] > EXIT_OPEN:
        raise SystemExit("an exit is after the 2026-09-25 open")
    end = entry - c.fp5.DAY_MS
    start = end - 4 * c.fp5.DAY_MS
    for ts in (start, end):
        if ts > SIGNAL_LAST:
            raise SystemExit("a signal close is after 2026-09-15")
        if c._px(spot, ts, 1) is None:
            raise SystemExit("a signal close is missing")
    if not c._signal(spot, {}, cm, entry):
        raise SystemExit("the four-day decline did not fire")
    rule_net = c.fp5.net_return(cm[entry][0], cm[rule["exit_ms"]][0], rule_fee)
    null_net = c.fp5.net_return(spot[entry][0], spot[other["exit_ms"]][0], null_fee)
    if abs(rule["net"] - rule_net) > 1e-12 or abs(other["net"] - null_net) > 1e-12:
        raise SystemExit("a fill is not that contract's own open")


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


def merge(screen: dict, later: dict) -> dict:
    for ts, bar in later.items():
        if ts in screen and screen[ts] != bar:
            raise SystemExit("an overlapping day does not match the screen")
    out = dict(screen)
    out.update(later)
    return out


def main() -> None:
    digest = sha256(PREREG)
    if digest != SIDECAR.read_text().strip():
        raise SystemExit("the pre-registration does not match its frozen sha256")
    prereg = PREREG.read_text()
    for phrase in (
        "bid 84467.7,",
        "ask 84467.8, half-spread 5.91941895018044e-07",
        "bid 84529.73, ask",
        "84529.74, half-spread 5.915078291274204e-08",
    ):
        if phrase not in prereg:
            raise SystemExit("the frozen book is not the pre-registration")
    screen_doc = json.loads(SCREEN.read_text())
    common_path = Path(__file__).resolve().parent / "common.py"
    if sha256(common_path) != screen_doc["code_sha256"]["fp257_common"]:
        raise SystemExit("the rule file moved after the screen")
    if c.IDEA != "PICK" or c.HOLD_DAYS != 9 or c.MIN_N != 30:
        raise SystemExit("the frozen name, hold or count moved")
    if c.NULL_KIND != "other_book" or c.MODE != "paired":
        raise SystemExit("the null is not the other book")
    if c.RULE_BOOK != "cm" or c.NULL_BOOK != "spot" or c.RULE_SIDE != "long" or c.NULL_SIDE != "long":
        raise SystemExit("the legs moved")
    if LAST_ENTRY != int(datetime(2026, 9, 16, tzinfo=timezone.utc).timestamp() * 1000):
        raise SystemExit("the last entry is not 2026-09-16")
    if ENTRY_END != int(datetime(2026, 9, 17, tzinfo=timezone.utc).timestamp() * 1000):
        raise SystemExit("the entry window does not stop on 2026-09-17")
    if SIGNAL_LAST != int(datetime(2026, 9, 15, tzinfo=timezone.utc).timestamp() * 1000):
        raise SystemExit("the last signal close is not 2026-09-15")
    screen_spot_path = DATA / "spot1d" / "BTCUSDT.json"
    screen_cm_path = DATA / "cm1d" / "BTCUSD_PERP.json"
    if sha256(screen_spot_path) != screen_doc["input_sha256"]["spot"]:
        raise SystemExit("the 2023 spot prices are not the screen's file")
    if sha256(screen_cm_path) != screen_doc["input_sha256"]["cm"]:
        raise SystemExit("the 2023 coin-margined prices are not the screen's file")
    screen_spot = load_bars(screen_spot_path, 2, c.fp5.SCREEN_END_MS)
    screen_cm = load_bars(screen_cm_path, 2, c.fp5.SCREEN_END_MS)
    if max(screen_spot) != c.fp5.SCREEN_END_MS or max(screen_cm) != c.fp5.SCREEN_END_MS:
        raise SystemExit("the screen files do not stop on 2024-01-01")
    screen = c.rule_trades(screen_spot, {}, screen_cm)
    screen_null = c.null_trades(screen_spot, {}, screen_cm)
    screen_total = round(sum(t["pnl"] for t in screen), 4)
    if len(screen) != 156 or abs(screen_total - 363.8263) > 0.01:
        raise SystemExit(f"2023 did not reproduce: n={len(screen)} total={screen_total}")
    if len(screen_null) != 156:
        raise SystemExit("the 2023 other trade is not 156")
    null_bps = sum(t["net"] for t in screen_null) / 156 * 10_000.0
    rule_bps = sum(t["net"] for t in screen) / 156 * 10_000.0
    if abs(null_bps - 230.2271) > 0.0001 or abs(rule_bps - 233.222) > 0.0001:
        raise SystemExit("the 2023 gap did not reproduce")
    if {t["entry_ms"] for t in screen} != {t["entry_ms"] for t in screen_null}:
        raise SystemExit("the 2023 other trade is not the same entries")
    for trade in screen:
        if trade["entry_ms"] >= OOS_START:
            raise SystemExit("a 2024 open was read as a 2023 entry")
        if trade["book"] != "cm":
            raise SystemExit("a 2023 fill is not the coin-margined book")

    oos_spot_path = DATA / "oos_spot1d" / "BTCUSDT.json"
    oos_cm_path = DATA / "oos_cm1d" / "BTCUSD_PERP.json"
    if not oos_spot_path.exists() or not oos_cm_path.exists():
        oos_fetch.pull()
    oos_spot = load_bars(oos_spot_path, 2, EXIT_OPEN)
    oos_cm = load_bars(oos_cm_path, 2, EXIT_OPEN)
    if min(oos_spot) != OOS_START or max(oos_spot) != EXIT_OPEN:
        raise SystemExit("the spot window is wrong")
    if min(oos_cm) != OOS_START or max(oos_cm) != EXIT_OPEN:
        raise SystemExit("the coin-margined window is wrong")
    for book in (oos_spot, oos_cm):
        day = OOS_START
        while day <= EXIT_OPEN:
            if day not in book:
                raise SystemExit("a book is missing a day")
            day += c.fp5.DAY_MS
    spot = merge(screen_spot, oos_spot)
    cm = merge(screen_cm, oos_cm)
    primary, nulls = paired(spot, cm, RULE_FEE, NULL_FEE)
    doubled, doubled_nulls = paired(spot, cm, RULE_FEE_DOUBLE, NULL_FEE_DOUBLE)
    if not primary:
        raise SystemExit("the out-of-sample run has no fill")
    if [t["entry_ms"] for t in primary] != [t["entry_ms"] for t in doubled]:
        raise SystemExit("the doubled-cost entries moved")
    if [t["entry_ms"] for t in primary] != [t["entry_ms"] for t in nulls]:
        raise SystemExit("the other trade is not the same entries")
    if len(nulls) != len(primary) or len(doubled_nulls) != len(doubled):
        raise SystemExit("the pool length is not the trade count")
    if max(t["entry_ms"] for t in primary) > LAST_ENTRY:
        raise SystemExit("an entry is after 2026-09-16")
    if len(primary) >= fillable(cm, RULE_FEE, "cm"):
        raise SystemExit("the rule is every coin-margined day")
    wrecked_spot = dict(spot)
    wrecked_cm = dict(cm)
    for trade in primary:
        row = wrecked_cm[trade["entry_ms"]]
        wrecked_cm[trade["entry_ms"]] = (row[0] * 10.0, row[1])
        row = wrecked_spot[trade["entry_ms"]]
        wrecked_spot[trade["entry_ms"]] = (row[0] * 10.0, row[1])
    for book in (wrecked_spot, wrecked_cm):
        for ts, row in list(book.items()):
            if ts > SIGNAL_LAST:
                book[ts] = (row[0], row[1] * 7.0)
    wrecked_rules, _wrecked_nulls = paired(wrecked_spot, wrecked_cm, RULE_FEE, NULL_FEE)
    if [t["entry_ms"] for t in wrecked_rules] != [t["entry_ms"] for t in primary]:
        raise SystemExit("a later close or the entry open moved a buy")
    sample = primary[0]
    thin_cm = dict(cm)
    del thin_cm[sample["exit_ms"]]
    thin_rules, _thin_nulls = paired(spot, thin_cm, RULE_FEE, NULL_FEE)
    if any(t["entry_ms"] == sample["entry_ms"] for t in thin_rules):
        raise SystemExit("a missing coin-margined open was filled from spot")
    for rule, other in zip(primary, nulls):
        check_pair(spot, cm, rule, other, RULE_FEE, NULL_FEE)
    for rule, other in zip(doubled, doubled_nulls):
        check_pair(spot, cm, rule, other, RULE_FEE_DOUBLE, NULL_FEE_DOUBLE)
    pool = [t["pnl"] for t in nulls]
    holds = {trade["exit_ms"] - trade["entry_ms"] for trade in primary}
    if holds != {c.HOLD_DAYS * c.fp5.DAY_MS}:
        raise SystemExit("the rule hold is not nine days")
    primary_sum = summarise(primary, pool)
    if primary_sum["n"] != len(pool):
        raise SystemExit("the cutoff is not the other trade")
    other_mean = sum(pool) / len(pool)
    if primary_sum["null_p95_pnl_usd"] != round(other_mean, 4):
        raise SystemExit("the cutoff is not the other trade's mean")
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
        "screen_reproduction": {
            "n": len(screen),
            "total_pnl_usd": screen_total,
            "mean_net_bps": round(rule_bps, 4),
            "null_mean_bps": round(null_bps, 4),
        },
        "oos1_pnl_usd": round(oos1, 4),
        "oos2_pnl_usd": round(oos2, 4),
        "oos_days": oos_days,
        "annualised": round(ann, 6),
        "primary": primary_sum,
        "null_n": len(nulls),
        "null_mean_pnl_usd": round(other_mean, 6),
        "doubled_pnl_usd": round(doubled_total, 4),
        "conditions": conditions,
        "passes": all(conditions.values()),
        "cm_half_spread": CM_HALF,
        "spot_half_spread": SPOT_HALF,
        "null_kind": "other_book",
        "last_entry_ms": LAST_ENTRY,
        "exit_open_ms": EXIT_OPEN,
        "signal_last_ms": SIGNAL_LAST,
        "input_sha256": {
            "screen_spot": sha256(screen_spot_path),
            "screen_cm": sha256(screen_cm_path),
            "oos_spot": sha256(oos_spot_path),
            "oos_cm": sha256(oos_cm_path),
        },
        "code_sha256": {
            "fp257_common": sha256(common_path),
            "fp257_pick_test": sha256(Path(__file__)),
            "fp257_oos_fetch": sha256(Path(oos_fetch.__file__)),
        },
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp257/pick_oos.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
