"""GROKPM utilisation study (2026-10-28), step 1: the public record of the markets that matter.

Run from the repository root:  python3 -I docs/agents/backtests/grokpm_util/scripts/fetch.py

Reads data/markets.json (condition id, the token the agent priced, a label) and, keylessly, for each market:
  - Gamma /markets?condition_ids=...: closed flag, outcomes, outcome prices, token ids, end date;
  - the data API's /trades?market=... (takers' prints, newest first, paged 500 at a time back to 2026-10-24 00:00 UTC):
    a resting bid at b for a token is filled by a print that sells the token at b or under, or buys the other outcome at
    1 - b or over (the venue matches the pair by minting).
Writes data/public.json.gz. Re-running pulls the record again and can differ; the committed file is what the study read.
"""
import gzip
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")


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
    mk = json.load(open(os.path.join(DATA, "markets.json")))
    out = {"read_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "markets": {}}
    for key, (cond, token, label) in mk.items():
        g = get(f"https://gamma-api.polymarket.com/markets?condition_ids={cond}&closed=true") or []
        if not g:
            g = get(f"https://gamma-api.polymarket.com/markets?condition_ids={cond}") or []
        m = g[0] if g else {}
        keep = {k: m.get(k) for k in ("question", "closed", "outcomes", "outcomePrices", "clobTokenIds", "umaResolutionStatus",
                                     "closedTime", "endDate", "bestBid", "bestAsk", "lastTradePrice", "negRisk", "negRiskMarketID")}
        trades, off = [], 0
        while off <= 3000:
            page = get(f"https://data-api.polymarket.com/trades?market={cond}&limit=500&offset={off}&takerOnly=true") or []
            trades += [{k: t.get(k) for k in ("asset", "side", "price", "size", "timestamp", "outcome")} for t in page]
            if len(page) < 500 or min(t["timestamp"] for t in page) < 1792800000:  # 2026-10-24 00:00 UTC
                break
            off += 500
        out["markets"][key] = {"label": label, "token": token, "gamma": keep, "trades": trades}
        print(key, label, keep.get("closed"), keep.get("outcomePrices"), len(trades))
    with gzip.GzipFile(os.path.join(DATA, "public.json.gz"), "wb", mtime=0) as f:
        f.write(json.dumps(out, indent=0, sort_keys=True).encode())


if __name__ == "__main__":
    main()
