"""Prints for one universe csv. Keyless GET, one market at a time.

Unset, the csv is the touch universe. PM_UNIVERSE names another csv, and a
row with pull=0 is skipped. The tape is appended; a market already done or
capped is not requested again.

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
# data-api rejects offset above 10000 with HTTP 400. A market still inside
# the T−96 h window at that offset is truncated. It is not marked done.
OFFSET_CAP = 10000


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
        if offset > OFFSET_CAP:
            capped = True
            break
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


def accept_pull(cid, kept, capped):
    """A walk that hits the page cap is not a complete tape and is not done.

    The partial rows are dropped. Writing them and then listing the market
    in the done file is what marked a truncated pull complete.
    """
    if capped:
        return "capped", []
    rows = []
    for item in kept:
        row = dict(item)
        row["capped"] = "0"
        rows.append(row)
    return "done", rows


def _done_path(scratch):
    return os.path.join(scratch, "trades.done.txt")


def _capped_path(scratch):
    return os.path.join(scratch, "trades.capped.txt")


def _load_done(path):
    if not os.path.exists(path):
        return set()
    with open(path) as f:
        return {line.strip() for line in f if line.strip()}


def selected(row):
    """A row is pulled when it has a clause and a settlement.

    pull=0 is an explicit skip (BUCKET-DIST writes it). A file without the
    column, which is the touch universe, is unchanged.
    """
    if row.get("pull") == "0":
        return False
    return bool(row.get("settlement_utc")) and row.get("clause_ok") == "1"


def universe_path():
    """PM_UNIVERSE points the same walker at another csv. Unset, it stays the touch file."""
    return os.environ.get("PM_UNIVERSE") or os.path.join(g1_pull.DATA, "touch_s1_universe.csv")


def main():
    universe = universe_path()
    scratch = os.path.join(net.DATA, "g2")
    os.makedirs(scratch, exist_ok=True)
    out_path = os.path.join(scratch, "trades.jsonl")
    done_path = _done_path(scratch)
    capped_path = _capped_path(scratch)
    done = _load_done(done_path)
    already_capped = _load_done(capped_path)
    markets = []
    with open(universe, newline="") as f:
        for row in csv.DictReader(f):
            if selected(row):
                markets.append(row)
    print(f"markets {len(markets)} already_done {len(done)} already_capped {len(already_capped)}", flush=True)
    pulled = 0
    with open(out_path, "a") as out, open(done_path, "a") as flag, open(capped_path, "a") as capflag:
        for i, row in enumerate(markets):
            cid = row["conditionId"]
            if cid in done or cid in already_capped:
                continue
            kept, pages, capped = pull_one(cid, _cutoff(row["settlement_utc"]))
            status, rows = accept_pull(cid, kept, capped)
            pulled += 1
            if status == "capped":
                capflag.write(cid + "\n")
                capflag.flush()
                already_capped.add(cid)
                print(f"  capped {pulled} {cid[:10]} pages {pages} kept {len(kept)}", flush=True)
                continue
            for item in rows:
                out.write(json.dumps(item, separators=(",", ":")) + "\n")
            out.flush()
            flag.write(cid + "\n")
            flag.flush()
            done.add(cid)
            if pulled % 10 == 0:
                print(f"  {pulled} {cid[:10]} pages {pages} kept {len(kept)} capped 0", flush=True)
    print("trades done", len(done), "capped", len(already_capped), flush=True)


def self_test():
    assert OFFSET_CAP == 10000
    assert not (0 > OFFSET_CAP)
    assert not (10000 > OFFSET_CAP)
    assert 10500 > OFFSET_CAP
    status, rows = accept_pull("0xabc", [{"conditionId": "0xabc", "price": 0.4}], True)
    assert status == "capped" and rows == [], (status, rows)
    status, rows = accept_pull("0xabc", [{"conditionId": "0xabc", "price": 0.4}], False)
    assert status == "done" and rows[0]["capped"] == "0" and rows[0]["price"] == 0.4, rows
    assert selected({"settlement_utc": "2026-01-01T17:00:00Z", "clause_ok": "1"})
    assert not selected({"settlement_utc": "2026-01-01T17:00:00Z", "clause_ok": "1", "pull": "0"})
    assert not selected({"settlement_utc": "", "clause_ok": "1"})
    assert not selected({"settlement_utc": "2026-01-01T17:00:00Z", "clause_ok": "0"})
    print("g2_trades self-test ok")


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        self_test()
    else:
        main()
