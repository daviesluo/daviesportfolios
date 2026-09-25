"""Score the fp153 screen. 2023 entries only.

    python3 docs/agents/scripts/fp153/measure.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

ROOT = Path(__file__).resolve().parents[4]
DATA = Path(os.environ.get("FP153_DATA", "/tmp/fp153/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp153-protocol.md"
NOTE = 'Premium close above zero. Next day, long spot and short the perpetual, and the short keeps the 08:00 and 16:00 funding.'


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_rows(path: Path, width: int, last_ms: int) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != width + 1:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        ts = int(row[0])
        if ts > last_ms:
            raise SystemExit(f"{path.name} goes past the exit window")
        out[ts] = tuple(float(x) for x in row[1:])
    if not out:
        raise SystemExit(f"{path.name} is empty")
    return out


def load_funding(path: Path) -> list[tuple[int, float]]:
    rows = json.loads(path.read_text())
    out = []
    for row in rows:
        if len(row) != 2:
            raise SystemExit("funding carries a field this rule does not use")
        ts = int(row[0])
        if ts >= c.fp5.SCREEN_END_MS + c.fp5.DAY_MS:
            raise SystemExit("a funding print is past 2024-01-01")
        out.append((ts, float(row[1])))
    if not out:
        raise SystemExit("funding is empty")
    return out


def main() -> None:
    if os.environ.get("FP153_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")

    end = c.fp5.SCREEN_END_MS
    premium = load_rows(DATA / "premium/close.json", 1, end - c.fp5.DAY_MS)
    spot = load_rows(DATA / "spot1d/BTCUSDT.json", 1, end)
    um = load_rows(DATA / "um1d/BTCUSDT.json", 1, end)
    funding = c.funding_hours(load_funding(DATA / "funding/BTCUSDT.json"))
    if max(premium) >= end:
        raise SystemExit("a premium day is in 2024")
    if max(spot) != end or max(um) != end:
        raise SystemExit("a price does not stop on 2024-01-01")
    trades = c.signal_trades(premium, spot, um, funding)
    for trade in trades:
        if trade["coin"] != "BTCUSDT":
            raise SystemExit("a fill is not BTC")
        if trade["exit_ms"] - trade["entry_ms"] != c.fp5.DAY_MS:
            raise SystemExit("the hold moved")
        rates = funding[trade["entry_ms"]]
        gross, net = c.carry_net(
            spot[trade["entry_ms"]][0], spot[trade["exit_ms"]][0],
            um[trade["entry_ms"]][0], um[trade["exit_ms"]][0],
            rates[1], rates[2],
        )
        if abs(trade["net"] - net) > 1e-12 or abs(trade["gross"] - gross) > 1e-12:
            raise SystemExit("a fill is not the two-leg book")
    pool = c.pool_nets(spot, um, funding)

    row = c.fp5.summarise('BASBOOK', trades, pool, c.MIN_N, NOTE)
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp153_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp153_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {
            "premium_close": sha256(DATA / "premium/close.json"),
            "spot_open": sha256(DATA / "spot1d/BTCUSDT.json"),
            "um_open": sha256(DATA / "um1d/BTCUSDT.json"),
            "funding": sha256(DATA / "funding/BTCUSDT.json"),
        },
        "ideas": [row],
        "passed": [row["idea"]] if row["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp153/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
