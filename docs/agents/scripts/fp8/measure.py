"""Score the fp8 screen. 2023 only.

    python3 docs/agents/scripts/fp8/measure.py
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
FP5 = Path(os.environ.get("FP5_DATA", "/tmp/fp5/data"))
FP8 = Path(os.environ.get("FP8_DATA", "/tmp/fp8/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp8-protocol.md"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_bars(path: Path) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {int(r[0]): tuple(float(x) for x in r[1:6]) for r in rows}
    c.fp5.assert_price_horizon(list(out))
    return out


def load_points(path: Path) -> list[tuple[int, float]]:
    rows = [(int(r[0]), float(r[1])) for r in json.loads(path.read_text())]
    if any(t >= c.fp5.SCREEN_END_MS for t, _ in rows):
        raise RuntimeError(f"{path.name} has a 2024 stamp")
    return rows


def load_futures(path: Path) -> dict[int, dict[int, float]]:
    raw = json.loads(path.read_text())
    out = {}
    for exp, rows in raw.items():
        book = {}
        for ts, close in rows:
            ts = int(ts)
            if ts >= c.fp5.SCREEN_END_MS:
                raise RuntimeError("a future bar is on or after 2024-01-01")
            book[ts] = float(close)
        out[int(exp)] = book
    return out


def main() -> None:
    if os.environ.get("FP8_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    btc = load_bars(FP5 / "spot1d" / "BTCUSDT.json")
    inflow = load_points(FP8 / "FlowInExNtv.json")
    outflow = load_points(FP8 / "FlowOutExNtv.json")
    hashes = load_points(FP8 / "HashRate.json")
    futures = load_futures(FP8 / "futures.json")
    pool = c.fp5.pool_from_bars({"BTCUSDT": btc}, ["BTCUSDT"], c.fp5.DAY_MS)
    specs = [
        ("FLOW-OUT", c.forward(btc, c.flow_out_days(inflow, outflow))),
        ("HASH-DROP", c.forward(btc, c.hash_drop_days(hashes))),
        ("BASIS-BACK", c.forward(btc, c.basis_days(futures, btc))),
    ]
    rows = [c.fp5.summarise(name, trades, pool, c.MIN_N, "candidate") for name, trades in specs]
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp8_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp8_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {
            "btc_1d": sha256(FP5 / "spot1d" / "BTCUSDT.json"),
            "flow_in": sha256(FP8 / "FlowInExNtv.json"),
            "flow_out": sha256(FP8 / "FlowOutExNtv.json"),
            "hashrate": sha256(FP8 / "HashRate.json"),
            "futures": sha256(FP8 / "futures.json"),
        },
        "ideas": rows,
        "passed": [r["idea"] for r in rows if r["passes_screen"]],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp8/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text)


if __name__ == "__main__":
    main()
