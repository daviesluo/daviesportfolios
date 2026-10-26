"""GROKPM thin-rule study (2026-10-26), step 1: the public record of each market whose shadow forecast cleared its bar.

Run from the repository root:  python3 -I docs/agents/backtests/grokpm_thin/scripts/fetch.py

For each row of data/clears.json, keylessly: Gamma's market (closed, outcome prices, end date, tokens), the data API's
taker trades (newest 1,000), and the CLOB's book of the forecast token now (its depth, for the size-cap candidate, and
its mark). Writes data/public.json.gz. Re-running pulls the public record again and can differ.
"""
import gzip
import json
import os
import sys
import time
import urllib.request

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")


def get(url):
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "daviesportfolios-study"})
            return json.loads(urllib.request.urlopen(req, timeout=30).read(), strict=False)
        except Exception as e:  # noqa: BLE001 - a study's fetch retries anything
            if i == 3:
                print(f"failed {url}: {e}", file=sys.stderr)
                return None
            time.sleep(2 * (i + 1))


def main():
    rows = json.load(open(os.path.join(DATA, "clears.json")))["rows"]
    out = {"read_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "markets": {}}
    for r in rows:
        cond, tok = r["market_id"], r["token_id"]
        g = get(f"https://gamma-api.polymarket.com/markets?condition_ids={cond}&closed=true") or []
        if not g:
            g = get(f"https://gamma-api.polymarket.com/markets?condition_ids={cond}") or []
        m = g[0] if g else {}
        keep = {k: m.get(k) for k in ("question", "closed", "outcomes", "outcomePrices", "clobTokenIds", "umaResolutionStatus", "closedTime", "endDate", "volumeNum",
                                     "orderPriceMinTickSize")}
        taker = get(f"https://data-api.polymarket.com/trades?market={cond}&limit=1000&takerOnly=true") or []
        taker = [{k: t.get(k) for k in ("asset", "side", "price", "size", "timestamp")} for t in taker]
        book = get(f"https://clob.polymarket.com/book?token_id={tok}") or {}
        book = {"bids": book.get("bids", []), "asks": book.get("asks", []), "tick_size": book.get("tick_size")}
        out["markets"][cond] = {"gamma": keep, "taker_trades": taker, "book_now": book}
        print(r["name"], keep.get("closed"), keep.get("outcomePrices"), len(taker), len(book["bids"]), len(book["asks"]))
    with gzip.GzipFile(os.path.join(DATA, "public.json.gz"), "wb", mtime=0) as f:
        f.write(json.dumps(out, indent=0, sort_keys=True).encode())


if __name__ == "__main__":
    main()
