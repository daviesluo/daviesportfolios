"""Pull ETH DVOL through 2023-12-31. No later year is requested.

    python3 docs/agents/scripts/fp13/fetch.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

FP13 = Path(os.environ.get("FP13_DATA", "/tmp/fp13/data"))
LOOKBACK_MS = 1_664_582_400_000


def main() -> None:
    if os.environ.get("FP13_OOS"):
        raise SystemExit("this pull does not request a later year")
    points: dict[int, float] = {}
    start = LOOKBACK_MS
    while start < c.fp5.SCREEN_END_MS:
        end = min(start + 120 * c.fp5.DAY_MS, c.fp5.SCREEN_END_MS)
        url = (
            "https://www.deribit.com/api/v2/public/get_volatility_index_data"
            f"?currency=ETH&resolution=1D&start_timestamp={start}&end_timestamp={end - 1}"
        )
        request = urllib.request.Request(url, headers={"User-Agent": "fp13-screen"})
        with urllib.request.urlopen(request, timeout=60) as response:
            rows = json.loads(response.read().decode())["result"]["data"]
        for row in rows:
            day = int(row[0])
            if day % c.fp5.DAY_MS != 0 or day >= c.fp5.SCREEN_END_MS:
                continue
            points[day] = float(row[4])
        start = end
    kept = [[t, points[t]] for t in sorted(points)]
    FP13.mkdir(parents=True, exist_ok=True)
    (FP13 / "dvol_eth.json").write_text(json.dumps(kept, separators=(",", ":")))
    print(f"eth_dvol_rows {len(kept)}")


if __name__ == "__main__":
    main()
