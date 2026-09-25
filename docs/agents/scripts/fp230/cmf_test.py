"""The pre-registered CMF test. Entries from 2024-01-01 through 2026-09-13.

The buy and the sell stay where the screen put them. The 2026-09-25 bar is
the exit open of the last allowed entry. It is not an entry. Spot closes
used as the signal stop on 2026-09-12. Refuses to run until the
pre-registration's sha256 matches the sidecar written when it was frozen.
Re-running the 2023 screen is a check, not the bar.

    python3 docs/agents/scripts/fp230/cmf_test.py
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
DATA = Path(os.environ.get("FP230_DATA", "/tmp/fp230/data"))
PREREG = ROOT / "docs/agents/reviews/2026-09-25-fp230-prereg-cmf.md"
SIDECAR = ROOT / "docs/agents/reviews/2026-09-25-fp230-prereg-cmf.sha256"
SCREEN = ROOT / "docs/agents/backtests/fp230/screen_2023.json"

BID = 84668.7
ASK = 84668.8
HALF_SPREAD = (ASK - BID) / (ASK + BID)
if HALF_SPREAD != 5.905366502152256e-07:
    raise SystemExit("the frozen half-spread does not match the frozen book")
FEE = c.fp5.FEE + HALF_SPREAD
FEE_DOUBLE = 0.002 + HALF_SPREAD

OOS_START = int(datetime(2024, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
OOS_SPLIT = int(datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
ENTRY_END = int(datetime(2026, 9, 14, tzinfo=timezone.utc).timestamp() * 1000)
EXIT_OPEN = int(datetime(2026, 9, 25, tzinfo=timezone.utc).timestamp() * 1000)
SPOT_LAST = int(datetime(2026, 9, 12, tzinfo=timezone.utc).timestamp() * 1000)
LAST_ENTRY = EXIT_OPEN - c.HOLD_DAYS * c.fp5.DAY_MS
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


def fill(entry: int, cm: dict, fee: float) -> dict | None:
    exit_ms = entry + c.HOLD_DAYS * c.fp5.DAY_MS
    if not (OOS_START <= entry < ENTRY_END):
        return None
    if exit_ms != entry + 12 * c.fp5.DAY_MS or exit_ms > EXIT_OPEN:
        return None
    entry_px = c._px(cm, entry, 0)
    exit_px = c._px(cm, exit_ms, 0)
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


def signal_trades(cm: dict, spot: dict, fee: float) -> list[dict]:
    trades = []
    entry = OOS_START
    while entry < ENTRY_END:
        if c._split(cm, spot, entry):
            trade = fill(entry, cm, fee)
            if trade is not None:
                trades.append(trade)
        entry += c.fp5.DAY_MS
    return trades


def pool_nets(cm: dict, fee: float) -> list[float]:
    nets = []
    entry = OOS_START
    while entry < ENTRY_END:
        trade = fill(entry, cm, fee)
        if trade is not None:
            if trade["exit_ms"] - trade["entry_ms"] != c.HOLD_DAYS * c.fp5.DAY_MS:
                raise SystemExit("the null hold moved")
            nets.append(trade["net"])
        entry += c.fp5.DAY_MS
    return nets


def check_fill(cm: dict, spot: dict, trade: dict, fee: float) -> None:
    entry = trade["entry_ms"]
    if entry >= ENTRY_END or entry > LAST_ENTRY:
        raise SystemExit("an entry is after 2026-09-13")
    if trade["exit_ms"] != entry + c.HOLD_DAYS * c.fp5.DAY_MS:
        raise SystemExit("the hold moved")
    if trade["exit_ms"] > EXIT_OPEN:
        raise SystemExit("an exit is after the 2026-09-25 open")
    cm_move = c.finished(cm, entry, 1)
    spot_move = c.finished(spot, entry, 0)
    if cm_move is None or spot_move is None or cm_move >= 0.0 or cm_move >= spot_move:
        raise SystemExit("the decline did not lag spot")
    if entry in spot and entry > SPOT_LAST:
        raise SystemExit("a spot close after 2026-09-12 was stored")
    entry_px = cm[entry][0]
    exit_px = cm[trade["exit_ms"]][0]
    net = c.fp5.net_return(entry_px, exit_px, fee)
    if abs(trade["net"] - net) > 1e-12 or abs(trade["pnl"] - 100.0 * net) > 1e-9:
        raise SystemExit("a fill is not the open twelve days later")
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
    if "bid 84668.7, ask 84668.8" not in prereg or "5.905366502152256e-07" not in prereg:
        raise SystemExit("the frozen book is not the pre-registration")
    screen_doc = json.loads(SCREEN.read_text())
    common_path = Path(__file__).resolve().parent / "common.py"
    if sha256(common_path) != screen_doc["code_sha256"]["fp230_common"]:
        raise SystemExit("the rule file moved after the screen")
    if c.IDEA != "CMF" or c.HOLD_DAYS != 12 or c.LOOKBACK != 12 or c.MIN_N != 30:
        raise SystemExit("the frozen name, hold, lookback or count moved")
    if LAST_ENTRY != int(datetime(2026, 9, 13, tzinfo=timezone.utc).timestamp() * 1000):
        raise SystemExit("the last entry is not 2026-09-13")
    screen_cm_path = DATA / "cm1d" / "BTCUSD_PERP.json"
    screen_spot_path = DATA / "spot1d" / "BTCUSDT.json"
    if sha256(screen_cm_path) != screen_doc["input_sha256"]["cm"]:
        raise SystemExit("the 2023 coin-margined prices are not the screen's file")
    if sha256(screen_spot_path) != screen_doc["input_sha256"]["spot"]:
        raise SystemExit("the 2023 spot prices are not the screen's file")
    screen_cm = load_bars(screen_cm_path, 2, c.fp5.SCREEN_END_MS)
    screen_spot = load_bars(screen_spot_path, 1, c.fp5.SCREEN_END_MS - c.fp5.DAY_MS)
    if max(screen_cm) != c.fp5.SCREEN_END_MS:
        raise SystemExit("the screen file does not stop on 2024-01-01")
    if max(screen_spot) != c.fp5.SCREEN_END_MS - c.fp5.DAY_MS:
        raise SystemExit("the screen spot file does not stop on 2023-12-31")
    screen = c.signal_trades(screen_cm, screen_spot)
    screen_total = round(sum(t["pnl"] for t in screen), 4)
    if len(screen) != 96 or abs(screen_total - 471.5815) > 0.01:
        raise SystemExit(f"2023 did not reproduce: n={len(screen)} total={screen_total}")
    for trade in screen:
        if trade["entry_ms"] >= OOS_START:
            raise SystemExit("a 2024 open was read as a 2023 entry")
        entry_px = screen_cm[trade["entry_ms"]][0]
        exit_px = screen_cm[trade["exit_ms"]][0]
        if abs(trade["net"] - c.fp5.net_return(entry_px, exit_px)) > 1e-12:
            raise SystemExit("a 2023 fill is not the screen fee")

    oos_cm_path = DATA / "oos_cm1d" / "BTCUSD_PERP.json"
    oos_spot_path = DATA / "oos_spot1d" / "BTCUSDT.json"
    if not oos_cm_path.exists() or not oos_spot_path.exists():
        oos_fetch.pull()
    oos_cm = load_bars(oos_cm_path, 2, EXIT_OPEN)
    oos_spot = load_bars(oos_spot_path, 1, SPOT_LAST)
    if min(oos_cm) != OOS_START or max(oos_cm) != EXIT_OPEN:
        raise SystemExit("the coin-margined window is wrong")
    if min(oos_spot) != OOS_START or max(oos_spot) != SPOT_LAST:
        raise SystemExit("the spot window is wrong")
    if any(day > SPOT_LAST for day in oos_spot):
        raise SystemExit("a spot close after 2026-09-12 was stored")
    for ts, bar in oos_cm.items():
        if ts in screen_cm and screen_cm[ts] != bar:
            raise SystemExit("an overlapping day does not match the screen")
    cm = dict(screen_cm)
    cm.update(oos_cm)
    spot = dict(screen_spot)
    spot.update(oos_spot)
    primary = signal_trades(cm, spot, FEE)
    doubled = signal_trades(cm, spot, FEE_DOUBLE)
    if not primary:
        raise SystemExit("the out-of-sample run has no fill")
    if [t["entry_ms"] for t in primary] != [t["entry_ms"] for t in doubled]:
        raise SystemExit("the doubled-cost entries moved")
    if max(t["entry_ms"] for t in primary) > LAST_ENTRY:
        raise SystemExit("an entry is after 2026-09-13")
    for trade in primary:
        check_fill(cm, spot, trade, FEE)
    for trade in doubled:
        check_fill(cm, spot, trade, FEE_DOUBLE)
    pool = [100.0 * net for net in pool_nets(cm, FEE)]
    if len(pool) < len(primary):
        raise SystemExit("the null pool is shorter than the trades")
    pool_entries = set()
    entry = OOS_START
    while entry < ENTRY_END:
        trade = fill(entry, cm, FEE)
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
        "spot_last_ms": SPOT_LAST,
        "input_sha256": {
            "screen_cm": sha256(screen_cm_path),
            "screen_spot": sha256(screen_spot_path),
            "oos_cm": sha256(oos_cm_path),
            "oos_spot": sha256(oos_spot_path),
        },
        "code_sha256": {
            "fp230_common": sha256(common_path),
            "fp230_cmf_test": sha256(Path(__file__)),
            "fp230_oos_fetch": sha256(Path(oos_fetch.__file__)),
        },
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp230/cmf_oos.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
