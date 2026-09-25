"""The pre-registered STEP test. Entries from 2024-01-01 through 2026-09-21.

The buy and the sell stay where the screen put them. The 2026-09-25 bar is
the exit open of the last allowed entry. It is not an entry. Closes used as
the signal stop on 2026-09-20. Refuses to run until the pre-registration's
sha256 matches the sidecar written when it was frozen. Re-running the 2023
screen is a check, not the bar.

    python3 docs/agents/scripts/fp237/step_test.py
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
DATA = Path(os.environ.get("FP237_DATA", "/tmp/fp237/data"))
PREREG = ROOT / "docs/agents/reviews/2026-09-25-fp237-prereg-step.md"
SIDECAR = ROOT / "docs/agents/reviews/2026-09-25-fp237-prereg-step.sha256"
SCREEN = ROOT / "docs/agents/backtests/fp237/screen_2023.json"

BID = 84615.8
ASK = 84615.9
HALF_SPREAD = (ASK - BID) / (ASK + BID)
if HALF_SPREAD != 5.909058408753729e-07:
    raise SystemExit("the frozen half-spread does not match the frozen book")
FEE = c.fp5.FEE + HALF_SPREAD
FEE_DOUBLE = 0.002 + HALF_SPREAD

OOS_START = int(datetime(2024, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
OOS_SPLIT = int(datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
EXIT_OPEN = int(datetime(2026, 9, 25, tzinfo=timezone.utc).timestamp() * 1000)
SIGNAL_LAST = int(datetime(2026, 9, 20, tzinfo=timezone.utc).timestamp() * 1000)
LAST_ENTRY = EXIT_OPEN - c.HOLD_DAYS * c.fp5.DAY_MS
ENTRY_END = LAST_ENTRY + c.fp5.DAY_MS
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


def fill(entry: int, um: dict, fee: float) -> dict | None:
    exit_ms = entry + c.HOLD_DAYS * c.fp5.DAY_MS
    if not (OOS_START <= entry < ENTRY_END):
        return None
    if exit_ms != entry + 4 * c.fp5.DAY_MS or exit_ms > EXIT_OPEN:
        return None
    entry_px = c._px(um, entry, 0)
    exit_px = c._px(um, exit_ms, 0)
    if entry_px is None or exit_px is None:
        return None
    net = c.fp5.net_return(entry_px, exit_px, fee)
    return {
        "coin": c.COIN,
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": exit_px / entry_px - 1.0,
        "net": net,
        "pnl": 100.0 * net,
    }


def signal_trades(um: dict, fee: float) -> list[dict]:
    trades = []
    entry = OOS_START
    while entry < ENTRY_END:
        if c._signal(um, entry):
            trade = fill(entry, um, fee)
            if trade is not None:
                trades.append(trade)
        entry += c.fp5.DAY_MS
    return trades


def pool_nets(um: dict, fee: float) -> list[float]:
    nets = []
    entry = OOS_START
    while entry < ENTRY_END:
        trade = fill(entry, um, fee)
        if trade is not None:
            if trade["exit_ms"] - trade["entry_ms"] != c.HOLD_DAYS * c.fp5.DAY_MS:
                raise SystemExit("the null hold moved")
            nets.append(trade["net"])
        entry += c.fp5.DAY_MS
    return nets


def check_fill(um: dict, trade: dict, fee: float) -> None:
    entry = trade["entry_ms"]
    if entry >= ENTRY_END or entry > LAST_ENTRY:
        raise SystemExit("an entry is after 2026-09-21")
    if trade["exit_ms"] != entry + c.HOLD_DAYS * c.fp5.DAY_MS:
        raise SystemExit("the hold moved")
    if trade["exit_ms"] > EXIT_OPEN:
        raise SystemExit("an exit is after the 2026-09-25 open")
    used = (
        entry - c.fp5.DAY_MS,
        entry - 4 * c.fp5.DAY_MS,
        entry - 7 * c.fp5.DAY_MS,
    )
    for ts in used:
        if ts > SIGNAL_LAST:
            raise SystemExit("a signal close is after 2026-09-20")
        if c._px(um, ts, 1) is None:
            raise SystemExit("a signal close is missing")
    near = c.finished(um, entry, 3)
    far = c.finished(um, entry - 3 * c.fp5.DAY_MS, 3)
    if near is None or far is None or near <= 0.0 or far <= 0.0:
        raise SystemExit("the two rises did not both finish positive")
    if not c._signal(um, entry):
        raise SystemExit("the two-rise rule did not fire")
    entry_px = um[entry][0]
    exit_px = um[trade["exit_ms"]][0]
    net = c.fp5.net_return(entry_px, exit_px, fee)
    if abs(trade["net"] - net) > 1e-12 or abs(trade["pnl"] - 100.0 * net) > 1e-9:
        raise SystemExit("a fill is not the open four days later")
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
    if "bid 84615.8, ask 84615.9" not in prereg or "5.909058408753729e-07" not in prereg:
        raise SystemExit("the frozen book is not the pre-registration")
    screen_doc = json.loads(SCREEN.read_text())
    common_path = Path(__file__).resolve().parent / "common.py"
    if sha256(common_path) != screen_doc["code_sha256"]["fp237_common"]:
        raise SystemExit("the rule file moved after the screen")
    if c.IDEA != "STEP" or c.HOLD_DAYS != 4 or c.MIN_N != 30 or c.COIN != "BTCUSDT":
        raise SystemExit("the frozen name, hold, count or coin moved")
    if LAST_ENTRY != int(datetime(2026, 9, 21, tzinfo=timezone.utc).timestamp() * 1000):
        raise SystemExit("the last entry is not 2026-09-21")
    if ENTRY_END != int(datetime(2026, 9, 22, tzinfo=timezone.utc).timestamp() * 1000):
        raise SystemExit("the entry window does not stop on 2026-09-22")
    screen_path = DATA / "um1d" / "BTCUSDT.json"
    if sha256(screen_path) != screen_doc["input_sha256"]["um"]:
        raise SystemExit("the 2023 USDT prices are not the screen's file")
    screen_um = load_bars(screen_path, 2, c.fp5.SCREEN_END_MS)
    if max(screen_um) != c.fp5.SCREEN_END_MS:
        raise SystemExit("the screen file does not stop on 2024-01-01")
    screen = c.signal_trades(screen_um)
    screen_total = round(sum(t["pnl"] for t in screen), 4)
    if len(screen) != 112 or abs(screen_total - 210.0476) > 0.01:
        raise SystemExit(f"2023 did not reproduce: n={len(screen)} total={screen_total}")
    for trade in screen:
        if trade["entry_ms"] >= OOS_START:
            raise SystemExit("a 2024 open was read as a 2023 entry")
        entry_px = screen_um[trade["entry_ms"]][0]
        exit_px = screen_um[trade["exit_ms"]][0]
        if abs(trade["net"] - c.fp5.net_return(entry_px, exit_px)) > 1e-12:
            raise SystemExit("a 2023 fill is not the screen fee")

    oos_path = DATA / "oos_um1d" / "BTCUSDT.json"
    if not oos_path.exists():
        oos_fetch.pull()
    oos_um = load_bars(oos_path, 2, EXIT_OPEN)
    if min(oos_um) != OOS_START or max(oos_um) != EXIT_OPEN:
        raise SystemExit("the USDT window is wrong")
    day = OOS_START
    while day <= EXIT_OPEN:
        if day not in oos_um:
            raise SystemExit("the USDT perpetual is missing a day")
        day += c.fp5.DAY_MS
    for ts, bar in oos_um.items():
        if ts in screen_um and screen_um[ts] != bar:
            raise SystemExit("an overlapping day does not match the screen")
    um = dict(screen_um)
    um.update(oos_um)
    primary = signal_trades(um, FEE)
    doubled = signal_trades(um, FEE_DOUBLE)
    if not primary:
        raise SystemExit("the out-of-sample run has no fill")
    if [t["entry_ms"] for t in primary] != [t["entry_ms"] for t in doubled]:
        raise SystemExit("the doubled-cost entries moved")
    if max(t["entry_ms"] for t in primary) > LAST_ENTRY:
        raise SystemExit("an entry is after 2026-09-21")
    wrecked = dict(um)
    for trade in primary:
        row = wrecked[trade["entry_ms"]]
        wrecked[trade["entry_ms"]] = (row[0] * 10.0, row[1])
    for ts, row in list(wrecked.items()):
        if ts > SIGNAL_LAST and len(row) > 1:
            wrecked[ts] = (row[0], row[1] * 7.0)
    if [t["entry_ms"] for t in signal_trades(wrecked, FEE)] != [t["entry_ms"] for t in primary]:
        raise SystemExit("a later close or the entry open moved a buy")
    for trade in primary:
        check_fill(um, trade, FEE)
    for trade in doubled:
        check_fill(um, trade, FEE_DOUBLE)
    pool = [100.0 * net for net in pool_nets(um, FEE)]
    if len(pool) < len(primary):
        raise SystemExit("the null pool is shorter than the trades")
    holds = {trade["exit_ms"] - trade["entry_ms"] for trade in primary}
    if holds != {c.HOLD_DAYS * c.fp5.DAY_MS}:
        raise SystemExit("the rule hold is not four days")
    pool_entries = set()
    entry = OOS_START
    while entry < ENTRY_END:
        trade = fill(entry, um, FEE)
        if trade is not None:
            pool_entries.add(entry)
        entry += c.fp5.DAY_MS
    if any(t["entry_ms"] not in pool_entries for t in primary):
        raise SystemExit("a fill is not in the null pool")
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
        "conditions": conditions,
        "passes": all(conditions.values()),
        "half_spread": HALF_SPREAD,
        "last_entry_ms": LAST_ENTRY,
        "exit_open_ms": EXIT_OPEN,
        "signal_last_ms": SIGNAL_LAST,
        "input_sha256": {
            "screen_um": sha256(screen_path),
            "oos_um": sha256(oos_path),
        },
        "code_sha256": {
            "fp237_common": sha256(common_path),
            "fp237_step_test": sha256(Path(__file__)),
            "fp237_oos_fetch": sha256(Path(oos_fetch.__file__)),
        },
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp237/step_oos.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
