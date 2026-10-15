"""Prints for the TOUCH-CAL universe. Keyless GET, one market at a time.

Pages data-api /trades newest-first until a print is older than T−96 h, or
the page is empty. Does not pass takerOnly. A market that hits the page cap
before T−96 h is marked capped and kept; the study can see that flag.

usage: python3 -I -u docs/agents/backtests/pmstatarb/scripts/g2_trades.py
"""
import csv
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import g1_pull  # noqa: E402
import net  # noqa: E402

TRADES = "https://data-api.polymarket.com/trades"
LIMIT = 500
# 100 pages is 50,000 prints. Past this the walk stops and says so.
PAGE_CAP = 100


def _cutoff(settlement_utc):
    t = dt.datetime.fromisoformat(settlement_utc.replace("Z", "+00:00"))
    return int((t - dt.timedelta(hours=96)).timestamp())


def _rows(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("data", "trades"):
            if isinstance(payload.get(key), list):
                return payload[key]
    raise RuntimeError("trades payload is not a list")


def _ts(row):
    raw = row.get("timestamp")
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return None
    if n > 10**12:
        n //= 1000
    return n


def _keep(cid, row, ts):
    return {
        "conditionId": cid,
        "timestamp": ts,
        "price": row.get("price"),
        "side": row.get("side"),
        "outcome": row.get("outcome"),
        "asset": row.get("asset"),
        "size": row.get("size"),
    }


def pull_one(cid, cutoff):
    kept = []
    offset = 0
    pages = 0
    capped = False
    while pages < PAGE_CAP:
        payload = net.get(TRADES, {"market": cid, "limit": LIMIT, "offset": offset})
        rows = _rows(payload)
        pages += 1
        if not rows:
            break
        oldest = None
        for row in rows:
            ts = _ts(row)
            if ts is None:
                continue
            oldest = ts if oldest is None else min(oldest, ts)
            if ts >= cutoff:
                kept.append(_keep(cid, row, ts))
        if len(rows) < LIMIT or (oldest is not None and oldest < cutoff):
            break
        offset += LIMIT
    else:
        capped = True
    return kept, pages, capped


def _done_path(scratch):
    return os.path.join(scratch, "trades.done.txt")


def _load_done(path):
    if not os.path.exists(path):
        return set()
    with open(path) as f:
        return {line.strip() for line in f if line.strip()}


def main():
    universe = os.path.join(g1_pull.DATA, "touch_s1_universe.csv")
    scratch = os.path.join(net.DATA, "g2")
    os.makedirs(scratch, exist_ok=True)
    out_path = os.path.join(scratch, "trades.jsonl")
    done_path = _done_path(scratch)
    done = _load_done(done_path)
    markets = []
    with open(universe, newline="") as f:
        for row in csv.DictReader(f):
            if row.get("settlement_utc") and row.get("clause_ok") == "1":
                markets.append(row)
    print(f"markets {len(markets)} already_done {len(done)}", flush=True)
    with open(out_path, "a") as out, open(done_path, "a") as flag:
        for i, row in enumerate(markets):
            cid = row["conditionId"]
            if cid in done:
                continue
            kept, pages, capped = pull_one(cid, _cutoff(row["settlement_utc"]))
            for item in kept:
                item["capped"] = "1" if capped else "0"
                out.write(json.dumps(item, separators=(",", ":")) + "\n")
            out.flush()
            flag.write(cid + "\n")
            flag.flush()
            done.add(cid)
            if i % 25 == 0 or capped:
                print(f"  {i} {cid[:10]} pages {pages} kept {len(kept)} capped {int(capped)}", flush=True)
    print("trades done", len(done), flush=True)


if __name__ == "__main__":
    main()
