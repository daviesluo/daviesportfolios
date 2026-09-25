"""The pre-registered LAG6 test. Entries from 2024-01-01 through 2026-09-23.

The buy and the sell stay where the screen put them. The 2026-09-25 bar is
the exit open of the last allowed entry. It is not an entry. Refuses to run
until the pre-registration's sha256 matches the sidecar written when it was
frozen. Re-running the 2023 screen is a check, not the bar.

    python3 docs/agents/scripts/fp174/lag6_test.py
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
import fetch

ROOT = Path(__file__).resolve().parents[4]
DATA = Path(os.environ.get("FP174_DATA", "/tmp/fp174/data"))
PREREG = ROOT / "docs/agents/reviews/2026-09-25-fp174-prereg-lag6.md"
SIDECAR = ROOT / "docs/agents/reviews/2026-09-25-fp174-prereg-lag6.sha256"
SCREEN = ROOT / "docs/agents/backtests/fp174/screen_2023.json"

BID = 84598.00000000
ASK = 84598.01000000
HALF_SPREAD = (ASK - BID) / (ASK + BID)
if HALF_SPREAD != 5.910304855747668e-08:
    raise SystemExit("the frozen half-spread does not match the frozen book")
FEE = c.fp5.FEE + HALF_SPREAD
FEE_DOUBLE = 0.002 + HALF_SPREAD

OOS_START = int(datetime(2024, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
OOS_SPLIT = int(datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
ENTRY_END = int(datetime(2026, 9, 24, tzinfo=timezone.utc).timestamp() * 1000)
EXIT_OPEN = int(datetime(2026, 9, 25, tzinfo=timezone.utc).timestamp() * 1000)
LAST_ENTRY = ENTRY_END - c.fp5.DAY_MS
NULL_DRAWS = 1000
NULL_SEED = 20260925


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_bars(path: Path, last_ms: int) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != 5:
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


def check_fill(bars: dict[int, tuple], trade: dict, fee: float) -> None:
    entry = trade["entry_ms"]
    if entry >= ENTRY_END or entry >= EXIT_OPEN:
        raise SystemExit("a bar on or after 2026-09-24 was read as an entry")
    if trade["exit_ms"] != entry + c.HOLD_DAYS * c.fp5.DAY_MS:
        raise SystemExit("the hold moved")
    if trade["exit_ms"] > EXIT_OPEN:
        raise SystemExit("an exit is after the 2026-09-25 open")
    day = entry - c.fp5.DAY_MS
    old = day - c.HORIZON * c.fp5.DAY_MS
    today = bars[day][1] - bars[day][2]
    earlier = bars[old][1] - bars[old][2]
    if bars[day][1] < bars[day][2] or bars[old][1] < bars[old][2] or not today > earlier:
        raise SystemExit("a trade was not wider than six days earlier")
    entry_px = bars[entry][0]
    exit_px = bars[trade["exit_ms"]][0]
    net = c.fp5.net_return(entry_px, exit_px, fee)
    if abs(trade["net"] - net) > 1e-12 or abs(trade["pnl"] - 100.0 * net) > 1e-9:
        raise SystemExit("a fill is not the open two days later")


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
    frozen = SIDECAR.read_text().strip()
    if digest != frozen:
        raise SystemExit("the pre-registration does not match its frozen sha256")
    screen_doc = json.loads(SCREEN.read_text())
    common_path = Path(__file__).resolve().parent / "common.py"
    if sha256(common_path) != screen_doc["code_sha256"]["fp174_common"]:
        raise SystemExit("the rule file moved after the screen")
    if c.IDEA != "LAG6" or c.HORIZON != 6 or c.HOLD_DAYS != 2 or c.MIN_N != 30:
        raise SystemExit("the frozen name, horizon, hold or count moved")
    screen_path = DATA / "spot1d" / "BTCUSDT.json"
    if sha256(screen_path) != screen_doc["input_sha256"]["spot_ohlc"]:
        raise SystemExit("the 2023 prices are not the screen's file")
    screen_bars = load_bars(screen_path, c.fp5.SCREEN_END_MS + c.fp5.DAY_MS)
    if max(screen_bars) != c.fp5.SCREEN_END_MS + c.fp5.DAY_MS:
        raise SystemExit("the screen file does not stop on 2024-01-02")
    screen = c.signal_trades(screen_bars)
    screen_total = round(sum(t["pnl"] for t in screen), 4)
    if len(screen) != 179 or abs(screen_total - 119.336) > 0.01:
        raise SystemExit(f"2023 did not reproduce: n={len(screen)} total={screen_total}")
    for trade in screen:
        check_fill(screen_bars, trade, c.fp5.FEE)
        if trade["entry_ms"] >= OOS_START:
            raise SystemExit("a 2024 open was read as a 2023 entry")

    oos_path = DATA / "oos_1d" / "BTCUSDT.json"
    if not oos_path.exists():
        os.environ["FP174_OOS"] = "1"
        fetch.pull_oos(OOS_START, EXIT_OPEN)
    oos_bars = load_bars(oos_path, EXIT_OPEN)
    if min(oos_bars) != OOS_START or max(oos_bars) != EXIT_OPEN:
        raise SystemExit("the out-of-sample window is wrong")
    for ts, bar in oos_bars.items():
        if ts in screen_bars and screen_bars[ts] != bar:
            raise SystemExit("an overlapping day does not match the screen")
    bars = dict(screen_bars)
    bars.update(oos_bars)
    primary = c.signal_trades(bars, FEE, OOS_START, ENTRY_END)
    doubled = c.signal_trades(bars, FEE_DOUBLE, OOS_START, ENTRY_END)
    if not primary:
        raise SystemExit("the out-of-sample run has no fill")
    if max(t["entry_ms"] for t in primary) > LAST_ENTRY:
        raise SystemExit("an entry is after 2026-09-23")
    for trade in primary:
        check_fill(bars, trade, FEE)
    for trade in doubled:
        check_fill(bars, trade, FEE_DOUBLE)
    pool = [100.0 * net for net in c.pool_nets(bars, FEE, OOS_START, ENTRY_END)]
    if len(pool) < len(primary):
        raise SystemExit("the null pool is shorter than the trades")
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
    passes = all(conditions.values())
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
        "passes": passes,
        "half_spread": HALF_SPREAD,
        "last_entry_ms": LAST_ENTRY,
        "exit_open_ms": EXIT_OPEN,
        "input_sha256": {
            "screen_spot_ohlc": sha256(screen_path),
            "oos_spot_ohlc": sha256(oos_path),
        },
        "code_sha256": {
            "fp174_common": sha256(common_path),
            "fp174_lag6_test": sha256(Path(__file__)),
        },
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp174/lag6_oos.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
