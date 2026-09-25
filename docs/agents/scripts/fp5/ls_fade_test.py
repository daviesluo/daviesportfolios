"""The pre-registered LS-FADE test. Scores 2024-01-01 through 2026-09-24.

Refuses to run until the pre-registration's sha256 matches the sidecar written
when it was frozen. Re-running the 2023 screen is a check, not the bar.

    python3 docs/agents/scripts/fp5/ls_fade_test.py
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

ROOT = Path(__file__).resolve().parents[4]
DATA = Path(os.environ.get("FP5_DATA", "/tmp/fp5/data"))
PREREG = ROOT / "docs/agents/reviews/2026-09-25-fp5-prereg-ls-fade.md"
SIDECAR = ROOT / "docs/agents/reviews/2026-09-25-fp5-prereg-ls-fade.sha256"

# Measured 2026-09-25 from data-api bookTicker BTCUSDT, bid 84591.62 / ask 84591.63.
HALF_SPREAD = 5.9107506265030525e-08
FEE = c.FEE + HALF_SPREAD
FEE_DOUBLE = 0.002 + HALF_SPREAD

OOS_START = int(datetime(2024, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
OOS_SPLIT = int(datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
OOS_END = int(datetime(2026, 9, 25, tzinfo=timezone.utc).timestamp() * 1000)
NULL_DRAWS = 1000
NULL_SEED = 20260925


def ms(y: int, m: int, d: int) -> int:
    return int(datetime(y, m, d, tzinfo=timezone.utc).timestamp() * 1000)


def load_bars(path: Path) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    return {int(r[0]): (float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])) for r in rows}


def load_metrics(path: Path) -> list[dict]:
    return json.loads(path.read_text())


def month_of(entry_ms: int) -> str:
    d = datetime.fromtimestamp(entry_ms / 1000, timezone.utc)
    return f"{d.year:04d}-{d.month:02d}"


def arm(metrics: list[dict], daily: dict[int, tuple], q: float, fee: float, start: int, end: int) -> list[dict]:
    days = c.ratio_signals(metrics, "count_ls", q, True)
    return c.daily_forward(daily, days, 1, fee=fee, start_ms=start, end_ms=end)


def pool_pnl(daily: dict[int, tuple], fee: float, start: int, end: int) -> list[float]:
    out = []
    for t in daily:
        trade = c._trade("BTCUSDT", t, t + c.DAY_MS, daily, fee=fee, start_ms=start, end_ms=end)
        if trade is not None:
            out.append(trade["pnl"])
    return out


def summarise(trades: list[dict], pool: list[float]) -> dict:
    n = len(trades)
    total = sum(t["pnl"] for t in trades)
    mean = total / n if n else 0.0
    cutoff = c.null_p95(pool, n, draws=NULL_DRAWS, seed=NULL_SEED) if n else None
    by_month: dict[str, float] = {}
    for t in trades:
        by_month[month_of(t["entry_ms"])] = by_month.get(month_of(t["entry_ms"]), 0.0) + t["pnl"]
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
        "by_month": {k: round(v, 4) for k, v in sorted(by_month.items())},
    }


def window_total(trades: list[dict], start: int, end: int) -> float:
    return sum(t["pnl"] for t in trades if start <= t["entry_ms"] < end)


def main() -> None:
    digest = hashlib.sha256(PREREG.read_bytes()).hexdigest()
    frozen = SIDECAR.read_text().strip()
    if digest != frozen:
        raise SystemExit("the pre-registration does not match its frozen sha256")
    screen_daily = load_bars(DATA / "spot1d" / "BTCUSDT.json")
    oos_daily = load_bars(DATA / "oos_spot1d_btc.json")
    daily = {**screen_daily, **oos_daily}
    metrics = load_metrics(DATA / "metrics_btc.json") + load_metrics(DATA / "oos_metrics_btc.json")
    # One row per day. The screen file and the oos file meet at 2024.
    merged: dict[int, dict] = {}
    for row in metrics:
        merged[int(row["day_ms"])] = row
    metrics = [merged[k] for k in sorted(merged)]

    # The screen, reproduced at the screen's own fee (no spread). Not the bar.
    screen = arm(metrics, daily, 0.10, c.FEE, c.SCREEN_START_MS, c.SCREEN_END_MS)
    screen_total = round(sum(t["pnl"] for t in screen), 4)
    screen_n = len(screen)
    if screen_n != 60 or abs(screen_total - 33.7632) > 0.01:
        raise SystemExit(f"2023 did not reproduce: n={screen_n} total={screen_total}")

    primary = arm(metrics, daily, 0.10, FEE, OOS_START, OOS_END)
    doubled = arm(metrics, daily, 0.10, FEE_DOUBLE, OOS_START, OOS_END)
    q05 = arm(metrics, daily, 0.05, FEE, OOS_START, OOS_END)
    q20 = arm(metrics, daily, 0.20, FEE, OOS_START, OOS_END)
    pool = pool_pnl(daily, FEE, OOS_START, OOS_END)
    primary_sum = summarise(primary, pool)
    oos1 = window_total(primary, OOS_START, OOS_SPLIT)
    oos2 = window_total(primary, OOS_SPLIT, OOS_END)
    oos_days = (datetime(2026, 9, 25, tzinfo=timezone.utc) - datetime(2024, 1, 1, tzinfo=timezone.utc)).days
    if oos_days != 998:
        raise SystemExit(f"the pre-registration's 998 days came out as {oos_days}")
    ann = (primary_sum["total_pnl_usd"] / 100.0) * (365.0 / oos_days) if oos_days else 0.0
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
    q05_total = sum(t["pnl"] for t in q05)
    q20_total = sum(t["pnl"] for t in q20)

    def neighbor_ok(trades: list[dict], total: float) -> bool:
        # Fewer than 10 trades is an absence, not a loss. Ten or more must earn.
        return len(trades) < 10 or total > 0

    neighbors_hold = neighbor_ok(q05, q05_total) and neighbor_ok(q20, q20_total)
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
        "quantile_05_pnl_usd": round(q05_total, 4),
        "quantile_05_n": len(q05),
        "quantile_20_pnl_usd": round(q20_total, 4),
        "quantile_20_n": len(q20),
        "conditions": conditions,
        "neighbors_hold": neighbors_hold,
        "passes": passes,
        "half_spread": HALF_SPREAD,
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp5/ls_fade_oos.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text)


if __name__ == "__main__":
    main()
