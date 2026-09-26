"""fp6, idea K2: does the perpetual's premium dip into a funding settlement and come back after it?

    python3 docs/agents/backtests/fp6/kill_premium.py

The mechanism: longs who would pay funding close just before the settlement and reopen after it, so
the premium index (the perpetual against Binance's price index) should sag into the settlement and
recover. A round trip that buys the sag and sells the recovery pays two perpetual fills (0.04–0.05 %
taker each; the 0 % USDC-margined maker fill is filled only when the market trades through it, the
adverse selection every earlier maker test lost to) and the funding at the settlement itself. This
measures the sag's size on 1-minute premium-index klines, keylessly, for the settlements of
2025-09-01 → 2026-08-31 on BTCUSDT, ETHUSDT, SOLUSDT and DOGEUSDT: the change in the premium index
(close of the minute) from 30 and from 10 minutes before each settlement to 10 and to 30 minutes
after it, in basis points of price. It is the idea's whole gross edge, so it decides the idea.

Source: data.binance.vision/data/futures/um/monthly/premiumIndexKlines/<SYM>/1m/<SYM>-1m-YYYY-MM.zip,
each zip checked against its published sha256 (vision.py). Writes kill_premium.json (sorted keys,
fixed rounding, no clock); the zips' sha256 go into it.
"""

from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vision as V  # noqa: E402

HERE = Path(__file__).resolve().parent
SYMS = ("BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT")
MONTHS = [f"2025-{m:02d}" for m in range(9, 13)] + [f"2026-{m:02d}" for m in range(1, 9)]
MIN = 60_000
H8 = 8 * 3_600_000


def main() -> None:
    out, shas = {}, {}
    for sym in SYMS:
        closes: dict[int, float] = {}
        for mo in MONTHS:
            path = f"data/futures/um/monthly/premiumIndexKlines/{sym}/1m/{sym}-1m-{mo}.zip"
            rows, digest = V.vision_zip(path)
            shas[path] = digest
            for r in rows:
                if not r or not r[0].strip().isdigit():
                    continue
                closes[V.ms_stamp(r[0])] = float(r[4])
        # the 8-hour settlements inside the months pulled (BTC/ETH/SOL/DOGE settle every 8 hours unless capped)
        ts = sorted(closes)
        first, last = ts[0], ts[-1]
        sags = {"m30_p10": [], "m10_p10": [], "m10_p30": []}
        for T in range((first // H8 + 1) * H8, last - 30 * MIN, H8):
            def at(offset_min: int) -> float | None:
                return closes.get(T + offset_min * MIN - MIN)  # the close of the minute that ends at T + offset
            a30, a10, b10, b30 = at(-30), at(-10), at(10), at(30)
            if None in (a30, a10, b10, b30):
                continue
            sags["m30_p10"].append((b10 - a30) * 1e4)
            sags["m10_p10"].append((b10 - a10) * 1e4)
            sags["m10_p30"].append((b30 - a10) * 1e4)
        out[sym] = {k: {"settlements": len(v), "mean_bp": round(statistics.fmean(v), 3),
                        "median_bp": round(statistics.median(v), 3),
                        "p90_abs_bp": round(sorted(abs(x) for x in v)[int(0.9 * (len(v) - 1))], 3)}
                    for k, v in sags.items()}
    doc = {"what": "change of the premium index (close of the minute) across each 8-hour settlement, bp of price; "
                   "positive = the perpetual richer after the settlement than before",
           "months": [MONTHS[0], MONTHS[-1]], "bySymbol": out, "zipSha256": dict(sorted(shas.items()))}
    (HERE / "kill_premium.json").write_text(json.dumps(doc, indent=1, sort_keys=True) + "\n")
    print(json.dumps({k: v for k, v in doc.items() if k != "zipSha256"}, indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
