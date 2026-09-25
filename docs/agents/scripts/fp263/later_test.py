"""The pre-registered LATER test. Entries from 2024-01-01 through 2026-08-26.

The buy and the sell stay where the screen put them. The other trade stays
the fifteen-day spot long that starts fifteen days later. It is not the
fifteen-day long on every day. The 2026-09-25 bar is that later trade's exit
open. It is not an entry. A close after 2026-08-25 is not a signal. Refuses
to run until the pre-registration's sha256 matches the sidecar written when
it was frozen. Re-running the 2023 screen is a check, not the bar.

    python3 docs/agents/scripts/fp263/later_test.py
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
DATA = Path(os.environ.get("FP263_DATA", "/tmp/fp263/data"))
PREREG = ROOT / "docs/agents/reviews/2026-09-25-fp263-prereg-later.md"
SIDECAR = ROOT / "docs/agents/reviews/2026-09-25-fp263-prereg-later.sha256"
SCREEN = ROOT / "docs/agents/backtests/fp263/screen_2023.json"

SPOT_BID = 84529.73
SPOT_ASK = 84529.74
SPOT_HALF = (SPOT_ASK - SPOT_BID) / (SPOT_ASK + SPOT_BID)
if SPOT_HALF != 5.915078291274204e-08:
    raise SystemExit("the frozen spot half-spread does not match the frozen book")
FEE = c.fp5.FEE + SPOT_HALF
FEE_DOUBLE = 0.002 + SPOT_HALF

OOS_START = int(datetime(2024, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
OOS_SPLIT = int(datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
EXIT_OPEN = int(datetime(2026, 9, 25, tzinfo=timezone.utc).timestamp() * 1000)
LAST_ENTRY = EXIT_OPEN - 2 * c.HOLD_DAYS * c.fp5.DAY_MS
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


def fill_at(entry: int, book: dict, fee: float) -> dict | None:
    exit_ms = entry + c.HOLD_DAYS * c.fp5.DAY_MS
    if exit_ms > EXIT_OPEN:
        return None
    entry_px = c._px(book, entry, 0)
    exit_px = c._px(book, exit_ms, 0)
    if entry_px is None or exit_px is None:
        return None
    net = c.fp5.net_return(entry_px, exit_px, fee)
    return {
        "coin": "BTCUSDT",
        "book": "spot",
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": exit_px / entry_px - 1.0,
        "net": net,
        "pnl": 100.0 * net,
    }


def shifted(spot: dict, fee: float) -> tuple[list[dict], list[dict]]:
    rules = []
    nulls = []
    entry = OOS_START
    while entry < ENTRY_END:
        if c._signal(spot, {}, {}, entry):
            rule = fill_at(entry, spot, fee)
            other = fill_at(entry + c.HOLD_DAYS * c.fp5.DAY_MS, spot, fee)
            if rule is not None and other is not None:
                if not (OOS_START <= entry < ENTRY_END):
                    raise SystemExit("an entry left the frozen window")
                rules.append(rule)
                nulls.append(other)
        entry += c.fp5.DAY_MS
    return rules, nulls


def fillable(spot: dict, fee: float) -> int:
    n = 0
    entry = OOS_START
    while entry < ENTRY_END:
        if fill_at(entry, spot, fee) is not None:
            n += 1
        entry += c.fp5.DAY_MS
    return n


def check_pair(spot: dict, rule: dict, other: dict, fee: float) -> None:
    entry = rule["entry_ms"]
    shift = c.HOLD_DAYS * c.fp5.DAY_MS
    if other["entry_ms"] != entry + shift:
        raise SystemExit("the other trade did not start fifteen days later")
    if entry > LAST_ENTRY or entry >= ENTRY_END:
        raise SystemExit("an entry is after 2026-08-26")
    if rule["book"] != "spot" or other["book"] != "spot":
        raise SystemExit("the leg moved")
    if rule["exit_ms"] - entry != shift or other["exit_ms"] - other["entry_ms"] != shift:
        raise SystemExit("the hold moved")
    if other["exit_ms"] > EXIT_OPEN:
        raise SystemExit("an exit is after the 2026-09-25 open")
    near_end = entry - c.fp5.DAY_MS
    near_start = near_end - 2 * c.fp5.DAY_MS
    prev_entry = entry - 2 * c.fp5.DAY_MS
    prev_end = prev_entry - c.fp5.DAY_MS
    prev_start = prev_end - 2 * c.fp5.DAY_MS
    for ts in (near_start, near_end, prev_start, prev_end):
        if ts > SIGNAL_LAST:
            raise SystemExit("a signal close is after 2026-08-25")
        if c._px(spot, ts, 1) is None:
            raise SystemExit("a signal close is missing")
    if not c._signal(spot, {}, {}, entry):
        raise SystemExit("the two-day turn did not fire")
    rule_net = c.fp5.net_return(spot[entry][0], spot[rule["exit_ms"]][0], fee)
    null_net = c.fp5.net_return(spot[other["entry_ms"]][0], spot[other["exit_ms"]][0], fee)
    if abs(rule["net"] - rule_net) > 1e-12 or abs(other["net"] - null_net) > 1e-12:
        raise SystemExit("a fill is not this contract's own open")


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
    for phrase in ("bid 84529.73, ask", "84529.74, half-spread 5.915078291274204e-08"):
        if phrase not in prereg:
            raise SystemExit("the frozen book is not the pre-registration")
    screen_doc = json.loads(SCREEN.read_text())
    common_path = Path(__file__).resolve().parent / "common.py"
    if sha256(common_path) != screen_doc["code_sha256"]["fp263_common"]:
        raise SystemExit("the rule file moved after the screen")
    if c.IDEA != "LATER" or c.HOLD_DAYS != 15 or c.MIN_N != 30:
        raise SystemExit("the frozen name, hold or count moved")
    if c.NULL_KIND != "other_time" or c.MODE != "shifted":
        raise SystemExit("the null is not the later trade")
    if c.RULE_BOOK != "spot" or c.NULL_BOOK != "spot" or c.RULE_SIDE != "long" or c.NULL_SIDE != "long":
        raise SystemExit("the leg moved")
    if LAST_ENTRY != int(datetime(2026, 8, 26, tzinfo=timezone.utc).timestamp() * 1000):
        raise SystemExit("the last entry is not 2026-08-26")
    if ENTRY_END != int(datetime(2026, 8, 27, tzinfo=timezone.utc).timestamp() * 1000):
        raise SystemExit("the entry window does not stop on 2026-08-27")
    if SIGNAL_LAST != int(datetime(2026, 8, 25, tzinfo=timezone.utc).timestamp() * 1000):
        raise SystemExit("the last signal close is not 2026-08-25")
    screen_spot_path = DATA / "spot1d" / "BTCUSDT.json"
    if sha256(screen_spot_path) != screen_doc["input_sha256"]["spot"]:
        raise SystemExit("the 2023 spot prices are not the screen's file")
    screen_spot = load_bars(screen_spot_path, 2, c.fp5.SCREEN_END_MS)
    if max(screen_spot) != c.fp5.SCREEN_END_MS:
        raise SystemExit("the screen spot file does not stop on 2024-01-01")
    screen = c.rule_trades(screen_spot, {}, {})
    screen_null = c.null_trades(screen_spot, {}, {})
    screen_total = round(sum(t["pnl"] for t in screen), 4)
    if len(screen) != 87 or abs(screen_total - 380.6856) > 0.01:
        raise SystemExit(f"2023 did not reproduce: n={len(screen)} total={screen_total}")
    if len(screen_null) != 87:
        raise SystemExit("the 2023 other trade is not 87")
    null_bps = sum(t["net"] for t in screen_null) / 87 * 10_000.0
    rule_bps = sum(t["net"] for t in screen) / 87 * 10_000.0
    if abs(null_bps - 329.1846) > 0.0001 or abs(rule_bps - 437.5697) > 0.0001:
        raise SystemExit("the 2023 other trade did not reproduce")
    shift = c.HOLD_DAYS * c.fp5.DAY_MS
    if {t["entry_ms"] for t in screen_null} != {t["entry_ms"] + shift for t in screen}:
        raise SystemExit("the 2023 other trade is not the later window")
    for trade in screen:
        if trade["entry_ms"] >= OOS_START:
            raise SystemExit("a 2024 open was read as a 2023 entry")
        if trade["book"] != "spot":
            raise SystemExit("a 2023 fill is not spot")

    oos_spot_path = DATA / "oos_spot1d" / "BTCUSDT.json"
    if not oos_spot_path.exists():
        oos_fetch.pull()
    oos_spot = load_bars(oos_spot_path, 2, EXIT_OPEN)
    if min(oos_spot) != OOS_START or max(oos_spot) != EXIT_OPEN:
        raise SystemExit("the spot window is wrong")
    day = OOS_START
    while day <= EXIT_OPEN:
        if day not in oos_spot:
            raise SystemExit("spot is missing a day")
        day += c.fp5.DAY_MS
    spot = merge(screen_spot, oos_spot)
    primary, nulls = shifted(spot, FEE)
    doubled, _doubled_nulls = shifted(spot, FEE_DOUBLE)
    if not primary:
        raise SystemExit("the out-of-sample run has no fill")
    if [t["entry_ms"] for t in primary] != [t["entry_ms"] for t in doubled]:
        raise SystemExit("the doubled-cost entries moved")
    if len(nulls) != len(primary):
        raise SystemExit("the pool length is not the trade count")
    if max(t["entry_ms"] for t in primary) > LAST_ENTRY:
        raise SystemExit("an entry is after 2026-08-26")
    if len(primary) >= fillable(spot, FEE):
        raise SystemExit("the rule is every spot day")
    wrecked = dict(spot)
    for trade in primary:
        row = wrecked[trade["entry_ms"]]
        wrecked[trade["entry_ms"]] = (row[0] * 10.0, row[1])
    for ts, row in list(wrecked.items()):
        if ts > SIGNAL_LAST:
            wrecked[ts] = (row[0], row[1] * 7.0)
    wrecked_rules, wrecked_nulls = shifted(wrecked, FEE)
    if [t["entry_ms"] for t in wrecked_rules] != [t["entry_ms"] for t in primary]:
        raise SystemExit("a later close or the entry open moved a buy")
    if [t["entry_ms"] for t in wrecked_nulls] != [t["entry_ms"] for t in nulls]:
        raise SystemExit("a later close moved the other trade")
    sample = primary[0]
    thin = dict(spot)
    del thin[sample["entry_ms"] + 2 * shift]
    thin_rules, _thin_nulls = shifted(thin, FEE)
    if any(t["entry_ms"] == sample["entry_ms"] for t in thin_rules):
        raise SystemExit("a missing later open still counted")
    for rule, other in zip(primary, nulls):
        check_pair(spot, rule, other, FEE)
    pool = [t["pnl"] for t in nulls]
    holds = {trade["exit_ms"] - trade["entry_ms"] for trade in primary}
    null_holds = {trade["exit_ms"] - trade["entry_ms"] for trade in nulls}
    if holds != {shift} or null_holds != {shift}:
        raise SystemExit("the hold is not fifteen days")
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
        "spot_half_spread": SPOT_HALF,
        "null_kind": "other_time",
        "last_entry_ms": LAST_ENTRY,
        "exit_open_ms": EXIT_OPEN,
        "signal_last_ms": SIGNAL_LAST,
        "input_sha256": {
            "screen_spot": sha256(screen_spot_path),
            "oos_spot": sha256(oos_spot_path),
        },
        "code_sha256": {
            "fp263_common": sha256(common_path),
            "fp263_later_test": sha256(Path(__file__)),
            "fp263_oos_fetch": sha256(Path(oos_fetch.__file__)),
        },
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp263/later_oos.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
