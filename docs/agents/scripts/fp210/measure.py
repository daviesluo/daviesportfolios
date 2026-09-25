"""Score the fp210 screen. 2023 entries only.

    python3 docs/agents/scripts/fp210/measure.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

ROOT = Path(__file__).resolve().parents[4]
DATA = Path(os.environ.get("FP210_DATA", "/tmp/fp210/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp210-protocol.md"
NOTE = 'The USDT close/open and the coin-margined close/open differ, and the gap widened. Next session, long the lower return and short the higher. Funding cash is not added. The null is that spread on every day the returns differ.'
FIELDS = {"coin", "entry_ms", "exit_ms", "gross", "net", "pnl"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_rows(path: Path, width: int, last_ms: int, required: bool) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != width + 1:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        ts = int(row[0])
        if ts > last_ms:
            raise SystemExit(f"{path.name} goes past the window")
        out[ts] = tuple(float(x) for x in row[1:])
    if not out:
        raise SystemExit(path.name + " came back empty")
    if required and max(out) != last_ms:
        raise SystemExit(f"{path.name} stops on the wrong day")
    return out


def check_common(trade: dict) -> None:
    if set(trade) != FIELDS:
        raise SystemExit("a fill carries a field this rule does not use")
    if trade["coin"] != "BTCUSDT":
        raise SystemExit("a fill is not BTC")
    if not (c.fp5.SCREEN_START_MS <= trade["entry_ms"] < c.fp5.SCREEN_END_MS):
        raise SystemExit("a 2024 open was read as an entry")
    if abs(trade["pnl"] - 100.0 * trade["net"]) > 1e-9:
        raise SystemExit("the dollar result is not a hundred dollars times the net")


def assert_subset(trades: list[dict], pool: list[float]) -> None:
    if not trades:
        return
    if len(pool) <= len(trades):
        raise SystemExit("the null is not a larger pool than the rule")
    counts = Counter(pool)
    for trade in trades:
        if counts[trade["net"]] <= 0:
            raise SystemExit("a fill is not in the null pool")
        counts[trade["net"]] -= 1


def legs_match(trade: dict, long_entry: float, long_exit: float, short_entry: float, short_exit: float) -> None:
    long_net = c.fp5.net_return(long_entry, long_exit)
    short_leg = c.short_net(short_entry, short_exit)
    net = long_net + short_leg
    gross = (long_exit / long_entry - 1.0) + (short_entry / short_exit - 1.0)
    if abs(trade["net"] - net) > 1e-12 or abs(trade["gross"] - gross) > 1e-12:
        raise SystemExit("a fill is not the two legs")
    if abs(short_leg) > 1e-9 and abs(trade["net"] - long_net) <= 1e-12:
        raise SystemExit("the short leg was dropped")

def run() -> None:

    end = c.fp5.SCREEN_END_MS
    last = c.SIGNAL_LAST_MS
    session = end - c.fp5.DAY_MS
    um = load_rows(DATA / "umsig/BTCUSDT.json", 2, last, True)
    cm = load_rows(DATA / "cmsig/BTCUSD_PERP.json", 2, last, True)
    um_f = load_rows(DATA / "um1d/BTCUSDT.json", 2, session, True)
    cm_f = load_rows(DATA / "cm1d/BTCUSD_PERP.json", 2, session, True)
    trades = c.signal_trades(um, cm, um_f, cm_f)
    for trade in trades:
        check_common(trade)
        day = trade["entry_ms"] - c.fp5.DAY_MS
        yday = day - c.fp5.DAY_MS
        if day > last or day not in um or day not in cm or yday not in um or yday not in cm:
            raise SystemExit("the signal day is past the window")
        if trade["exit_ms"] != trade["entry_ms"]:
            raise SystemExit("the hold moved")
        left, right = um[day][1] / um[day][0], cm[day][1] / cm[day][0]
        prev = abs(um[yday][1] / um[yday][0] - cm[yday][1] / cm[yday][0])
        if not (left < right or right < left) or abs(left - right) <= prev:
            raise SystemExit("the gap did not widen")
        if left < right:
            long_bar, short_bar = um_f[trade["entry_ms"]], cm_f[trade["entry_ms"]]
        else:
            long_bar, short_bar = cm_f[trade["entry_ms"]], um_f[trade["entry_ms"]]
        legs_match(trade, long_bar[0], long_bar[1], short_bar[0], short_bar[1])
        if trade["entry_ms"] == day:
            raise SystemExit("the spread started on the signal day")
    pool = c.pool_nets(um, cm, um_f, cm_f)
    inputs = {
        "umsig": sha256(DATA / "umsig/BTCUSDT.json"),
        "cmsig": sha256(DATA / "cmsig/BTCUSD_PERP.json"),
        "um": sha256(DATA / "um1d/BTCUSDT.json"),
        "cm": sha256(DATA / "cm1d/BTCUSD_PERP.json"),
    }


    assert_subset(trades, pool)
    if c.IDEA != "UCR" or c.MIN_N != 30:
        raise SystemExit("the frozen name or the count moved")
    row = c.fp5.summarise(c.IDEA, trades, pool, c.MIN_N, NOTE)
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp210_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp210_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": inputs,
        "ideas": [row],
        "passed": [row["idea"]] if row["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp210/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


def main() -> None:
    if os.environ.get("FP210_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    run()


if __name__ == "__main__":
    main()
