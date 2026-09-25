#!/usr/bin/env python3
"""One UK page per active pair. Counts only. No prices are stored."""

from __future__ import annotations

import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / "docs/agents/backtests/inputs/fp5_2026-09-25/pass78/continuity.json"
PAIRS = "https://revx.revolut.com/api/1.0/public/configuration/pairs"
TRADES = "https://revx.revolut.com/api/1.0/public/trades/all"
# 2026-09-24, a complete UTC day after the later continuity check, not a cutoff.
START = 1790208000000
END = 1790294399999


def get(url: str):
    req = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=40) as response:
                return response.status, json.loads(response.read())
        except Exception as exc:
            code = getattr(exc, "code", None)
            time.sleep(1.5 * (attempt + 1))
            if attempt == 4:
                return code, {"error": str(exc)}
    return None, {"error": "fetch failed"}


def main() -> None:
    status, pairs = get(PAIRS)
    if status != 200 or not isinstance(pairs, dict):
        raise SystemExit("pairs %s" % status)
    rows = []
    for key, spec in sorted(pairs.items()):
        symbol = key.replace("/", "-")
        quote = spec.get("quote")
        active = spec.get("status") == "active"
        time.sleep(1.05)
        url = (
            f"{TRADES}?symbol={symbol}&region=UK&start_date={START}"
            f"&end_date={END}&limit=100"
        )
        code, payload = get(url)
        data = payload.get("data") if isinstance(payload, dict) else None
        cursor = ""
        if isinstance(payload, dict):
            cursor = (payload.get("metadata") or {}).get("next_cursor") or ""
        n = len(data) if isinstance(data, list) else None
        rows.append(
            {
                "pair": key,
                "symbol": symbol,
                "quote": quote,
                "active": active,
                "http": code,
                "prints": n,
                "at_least_100": bool(cursor),
            }
        )
        if len(rows) % 25 == 0:
            print(len(rows), symbol, n, flush=True)
    payload = {
        "read_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
        "day": "2026-09-24",
        "start": START,
        "end": END,
        "region": "UK",
        "pairs": len(rows),
        "rows": rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    full = sum(1 for row in rows if row["at_least_100"])
    zero = [row["symbol"] for row in rows if row["prints"] == 0]
    print("wrote", OUT, "full_page", full, "zero", len(zero), flush=True)


if __name__ == "__main__":
    main()
