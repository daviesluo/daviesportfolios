"""The pre-registered BASE-CHG test. Scores 2024-01-01 through 2026-09-24.

Refuses to run until the pre-registration's sha256 matches the sidecar written
when it was frozen. Re-running the 2023 screen is a check, not the bar.

    python3 docs/agents/scripts/fp57/base_test.py
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
DATA = Path(os.environ.get("FP57_DATA", "/tmp/fp57/data"))
PREREG = ROOT / "docs/agents/reviews/2026-09-25-fp57-prereg-base.md"
SIDECAR = ROOT / "docs/agents/reviews/2026-09-25-fp57-prereg-base.sha256"

# Measured 2026-09-25T04:06:10Z from data-api bookTicker BTCUSDT, bid 84178.00000000 / ask 84178.01000000.
HALF_SPREAD = 5.9397938896041255e-08
FEE = c.fp5.FEE + HALF_SPREAD
FEE_DOUBLE = 0.002 + HALF_SPREAD

OOS_START = int(datetime(2024, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
OOS_SPLIT = int(datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
OOS_END = int(datetime(2026, 9, 25, tzinfo=timezone.utc).timestamp() * 1000)
NULL_DRAWS = 1000
NULL_SEED = 20260925


def load_bars(path: Path, width: int) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != width:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        out[int(row[0])] = tuple(float(x) for x in row[1:])
    return out


def month_of(entry_ms: int) -> str:
    stamp = datetime.fromtimestamp(entry_ms / 1000, timezone.utc)
    return f"{stamp.year:04d}-{stamp.month:02d}"


def pool_pnl(daily: dict[int, tuple]) -> list[float]:
    out = []
    for t in daily:
        trade = c.fp5._trade(
            "BTCUSDT", t, t + c.fp5.DAY_MS, daily,
            fee=FEE, start_ms=OOS_START, end_ms=OOS_END,
        )
        if trade is not None:
            out.append(trade["pnl"])
    return out


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
    digest = hashlib.sha256(PREREG.read_bytes()).hexdigest()
    frozen = SIDECAR.read_text().strip()
    if digest != frozen:
        raise SystemExit("the pre-registration does not match its frozen sha256")
    screen_day_path = DATA / "spot1d" / "BTCUSDT.json"
    oos_day_path = DATA / "oos_1d" / "BTCUSDT.json"
    if not oos_day_path.exists():
        os.environ["FP57_OOS"] = "1"
        fetch.pull_oos()
    screen_daily = load_bars(screen_day_path, 3)
    screen = c.base_trades(screen_daily)
    screen_total = round(sum(t["pnl"] for t in screen), 4)
    screen_n = len(screen)
    if screen_n != 44 or abs(screen_total - 28.6869) > 0.01:
        raise SystemExit(f"2023 did not reproduce: n={screen_n} total={screen_total}")

    oos_daily = load_bars(oos_day_path, 3)
    if max(oos_daily) != OOS_END:
        raise SystemExit("the 2026-09-25 open is missing")
    if min(oos_daily) != OOS_START:
        raise SystemExit("the out-of-sample days do not start on 2024-01-01")
    horizon = oos_daily[OOS_END]
    if len(horizon) != 2 or horizon[1] != 0:
        raise SystemExit("the 2026-09-25 bar stored a base volume")
    daily = dict(screen_daily)
    daily.update(oos_daily)
    primary = c.base_trades(daily, 0.90, FEE, OOS_START, OOS_END)
    doubled = c.base_trades(daily, 0.90, FEE_DOUBLE, OOS_START, OOS_END)
    q80 = c.base_trades(daily, 0.80, FEE, OOS_START, OOS_END)
    q95 = c.base_trades(daily, 0.95, FEE, OOS_START, OOS_END)
    primary_sum = summarise(primary, pool_pnl(daily))
    oos1 = window_total(primary, OOS_START, OOS_SPLIT)
    oos2 = window_total(primary, OOS_SPLIT, OOS_END)
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
    q80_total = sum(t["pnl"] for t in q80)
    q95_total = sum(t["pnl"] for t in q95)

    def neighbor_ok(trades: list[dict], total: float) -> bool:
        return len(trades) < 10 or total > 0

    neighbors_hold = neighbor_ok(q80, q80_total) and neighbor_ok(q95, q95_total)
    passes = all(conditions.values()) and neighbors_hold
    payload = {
        "prereg_sha256": digest,
        "screen_reproduction": {"n": screen_n, "total_pnl_usd": screen_total},
        "oos1_pnl_usd": round(oos1, 4),
        "oos2_pnl_usd": round(oos2, 4),
        "oos_days": oos_days,
        "annualised": round(ann, 6),
        "primary": primary_sum,
        "doubled_pnl_usd": round(doubled_total, 4),
        "quantile_80_pnl_usd": round(q80_total, 4),
        "quantile_80_n": len(q80),
        "quantile_95_pnl_usd": round(q95_total, 4),
        "quantile_95_n": len(q95),
        "conditions": conditions,
        "neighbors_hold": neighbors_hold,
        "passes": passes,
        "half_spread": HALF_SPREAD,
        "input_sha256": {
            "screen_btc_1d": hashlib.sha256(screen_day_path.read_bytes()).hexdigest(),
            "oos_btc_1d": hashlib.sha256(oos_day_path.read_bytes()).hexdigest(),
        },
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp57/base_oos.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
