#!/usr/bin/env python3
"""Pull UK public trade prints for pass 78. One UTC day a call, 100 a page."""

from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / "docs/agents/backtests/inputs/fp5_2026-09-25/pass78"
BASE = "https://revx.revolut.com/api/1.0/public/trades/all"
DAY = 86400000


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
                raise SystemExit("fetch %s %s" % (code, exc))
    raise SystemExit("fetch failed")


def pull_range(symbol: str, start: int, end: int) -> list[dict]:
    rows: list[dict] = []
    seen: set[str] = set()
    cursor = ""
    pages = 0
    while pages < 5000:
        url = (
            f"{BASE}?symbol={symbol}&region=UK&start_date={start}"
            f"&end_date={end}&limit=100"
        )
        if cursor:
            url += "&cursor=" + cursor
        time.sleep(1.05)
        status, payload = get(url)
        if status != 200 or not isinstance(payload, dict):
            raise SystemExit("status %s %s" % (status, symbol))
        pages += 1
        if pages % 25 == 0:
            print(symbol, "pages", pages, len(rows), flush=True)
        for row in payload.get("data") or []:
            if row.get("region") != "UK":
                continue
            ident = row.get("id")
            if ident in seen:
                continue
            seen.add(ident)
            rows.append(
                {
                    "id": ident,
                    "timestamp": int(row["timestamp"]),
                    "price": row["price"],
                    "quantity": row["quantity"],
                    "side": row["side"],
                }
            )
        cursor = (payload.get("metadata") or {}).get("next_cursor") or ""
        if not cursor:
            break
    else:
        raise SystemExit("page cap %s %s %s" % (symbol, start, pages))
    rows.sort(key=lambda row: (row["timestamp"], row["id"]))
    return rows


def main() -> None:
    # symbol start_ms end_ms outfile
    symbol, start_s, end_s, name = sys.argv[1:]
    start, end = int(start_s), int(end_s)
    OUT.mkdir(parents=True, exist_ok=True)
    all_rows: list[dict] = []
    cursor_day = start
    while cursor_day <= end:
        day_end = min(cursor_day + DAY - 1, end)
        got = pull_range(symbol, cursor_day, day_end)
        all_rows.extend(got)
        print(symbol, cursor_day, len(got), flush=True)
        cursor_day += DAY
    all_rows.sort(key=lambda row: (row["timestamp"], row["id"]))
    payload = {
        "symbol": symbol,
        "region": "UK",
        "start": start,
        "end": end,
        "rows": all_rows,
    }
    path = OUT / name
    path.write_text(json.dumps(payload, separators=(",", ":")))
    print("wrote", path, len(all_rows), flush=True)


if __name__ == "__main__":
    main()
