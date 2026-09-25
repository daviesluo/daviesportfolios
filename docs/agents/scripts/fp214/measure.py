"""Score the fp214 screen. 2023 entries only.

    python3 docs/agents/scripts/fp214/measure.py
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
DATA = Path(os.environ.get("FP214_DATA", "/tmp/fp214/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp214-protocol.md"
NOTE = "Spot's residual to the mark and the USDT residual have opposite signs. Next close to the following close, long the more negative residual and short the more positive. Funding cash is not added. The null is that spread on every day the residuals differ."
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
    spot = load_rows(DATA / "spotsig/BTCUSDT.json", 2, last, True)
    um = load_rows(DATA / "umsig/BTCUSDT.json", 2, last, True)
    mark = load_rows(DATA / "mark1d/BTCUSDT.json", 2, last, True)
    spot_px = load_rows(DATA / "spotpx/BTCUSDT.json", 1, end, True)
    um_px = load_rows(DATA / "umpx/BTCUSDT.json", 1, end, True)
    trades = c.signal_trades(spot, um, mark, spot_px, um_px)
    for trade in trades:
        check_common(trade)
        day = trade["entry_ms"] - c.fp5.DAY_MS
        if day > last or day not in spot or day not in um or day not in mark:
            raise SystemExit("the signal day is past the window")
        if trade["exit_ms"] != trade["entry_ms"] + c.fp5.DAY_MS:
            raise SystemExit("the hold moved")
        left = spot[day][1] / spot[day][0] - mark[day][1] / mark[day][0]
        right = um[day][1] / um[day][0] - mark[day][1] / mark[day][0]
        if not ((left > 0.0 > right) or (right > 0.0 > left)):
            raise SystemExit("the residuals were not opposite")
        if left < right:
            long_book, short_book = spot_px, um_px
        else:
            long_book, short_book = um_px, spot_px
        legs_match(
            trade,
            long_book[trade["entry_ms"]][0], long_book[trade["exit_ms"]][0],
            short_book[trade["entry_ms"]][0], short_book[trade["exit_ms"]][0],
        )
        if trade["entry_ms"] == day:
            raise SystemExit("the spread started on the signal day")
    pool = c.pool_nets(spot, um, mark, spot_px, um_px)
    inputs = {
        "spotsig": sha256(DATA / "spotsig/BTCUSDT.json"),
        "umsig": sha256(DATA / "umsig/BTCUSDT.json"),
        "mark": sha256(DATA / "mark1d/BTCUSDT.json"),
        "spot": sha256(DATA / "spotpx/BTCUSDT.json"),
        "um": sha256(DATA / "umpx/BTCUSDT.json"),
    }


    assert_subset(trades, pool)
    if c.IDEA != "MRK" or c.MIN_N != 30:
        raise SystemExit("the frozen name or the count moved")
    row = c.fp5.summarise(c.IDEA, trades, pool, c.MIN_N, NOTE)
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp214_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp214_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": inputs,
        "ideas": [row],
        "passed": [row["idea"]] if row["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp214/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


def main() -> None:
    if os.environ.get("FP214_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    run()


if __name__ == "__main__":
    main()
