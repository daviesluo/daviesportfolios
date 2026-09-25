"""Score the fp6 screen. 2023 only. Refuses a later price.

    python3 docs/agents/scripts/fp6/measure.py
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
FP6 = Path(os.environ.get("FP6_DATA", "/tmp/fp6/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp6-protocol.md"

CANDIDATES = ("USDC-CHEAP", "BTCUSDC-GAP", "FUND-GAP", "MONDAY", "QUIET")
CONTROLS = (
    (1, "WEEKDAY-TUE"),
    (2, "WEEKDAY-WED"),
    (3, "WEEKDAY-THU"),
    (4, "WEEKDAY-FRI"),
    (5, "WEEKDAY-SAT"),
    (6, "WEEKDAY-SUN"),
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_bars(path: Path) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        out[int(row[0])] = tuple(float(x) for x in row[1:6])
    c.fp5.assert_price_horizon(list(out))
    return out


def load_pairs(path: Path) -> list[tuple[int, float]]:
    rows = json.loads(path.read_text())
    out = [(int(r[0]), float(r[1])) for r in rows]
    late = [t for t, _ in out if t >= c.fp5.SCREEN_END_MS]
    if late:
        raise RuntimeError(f"{path.name} has a stamp on or after 2024-01-01")
    return out


def main() -> None:
    if os.environ.get("FP6_OOS"):
        raise SystemExit("this scorer is the 2023 screen and refuses an out-of-sample run")
    btc = load_bars(FP5 / "spot1d" / "BTCUSDT.json")
    btc8 = load_bars(FP5 / "spot8h" / "BTCUSDT.json")
    usdc = load_bars(FP6 / "spot1d" / "USDCUSDT.json")
    btcusdc = load_bars(FP6 / "spot1d" / "BTCUSDC.json")
    binance = load_pairs(FP5 / "funding" / "BTCUSDT.json")
    deribit_rows = load_pairs(FP6 / "deribit_btc_funding.json")
    deribit = dict(deribit_rows)

    btc_pool = c.fp5.pool_from_bars({"BTCUSDT": btc}, ["BTCUSDT"], c.fp5.DAY_MS)
    usdc_pool = c.fp5.pool_from_bars({"USDCUSDT": usdc}, ["USDCUSDT"], c.fp5.DAY_MS)
    gap_pool = c.fp5.pool_from_bars({"BTCUSDC": btcusdc}, ["BTCUSDC"], c.fp5.DAY_MS)
    bar8_pool = c.fp5.pool_from_bars({"BTCUSDT": btc8}, ["BTCUSDT"], c.fp5.EIGHT_H_MS)

    rows = []
    specs = [
        ("USDC-CHEAP", c.forward("USDCUSDT", usdc, c.usdc_cheap_days(usdc)), usdc_pool),
        ("BTCUSDC-GAP", c.forward("BTCUSDC", btcusdc, c.gap_days(btcusdc, btc)), gap_pool),
        ("FUND-GAP", c.fund_gap_trades(binance, deribit, btc8), bar8_pool),
        ("MONDAY", c.weekday_entries(btc, 0), btc_pool),
        ("QUIET", c.forward("BTCUSDT", btc, c.quiet_days(btc)), btc_pool),
    ]
    for name, trades, pool in specs:
        row = c.fp5.summarise(name, trades, pool, c.MIN_N, "candidate")
        rows.append(row)
    for weekday, name in CONTROLS:
        trades = c.weekday_entries(btc, weekday)
        row = c.fp5.summarise(name, trades, btc_pool, c.MIN_N, "spent control, not a candidate")
        row["cleared_hurdle"] = row["passes_screen"]
        row["passes_screen"] = False
        rows.append(row)

    passed = [r["idea"] for r in rows if r["passes_screen"]]
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp6_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp6_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {
            "btc_1d": sha256(FP5 / "spot1d" / "BTCUSDT.json"),
            "btc_8h": sha256(FP5 / "spot8h" / "BTCUSDT.json"),
            "binance_funding": sha256(FP5 / "funding" / "BTCUSDT.json"),
            "usdc": sha256(FP6 / "spot1d" / "USDCUSDT.json"),
            "btcusdc": sha256(FP6 / "spot1d" / "BTCUSDC.json"),
            "deribit_funding": sha256(FP6 / "deribit_btc_funding.json"),
        },
        "ideas": rows,
        "passed": passed,
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp6/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text)
    if set(passed) - set(CANDIDATES):
        raise SystemExit("a control was marked as a pass")


if __name__ == "__main__":
    main()
