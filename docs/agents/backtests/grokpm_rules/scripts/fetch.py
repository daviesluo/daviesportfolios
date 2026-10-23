"""GROKPM rules study (2026-10-23), step 1: the public record of every market the agent put a shadow p on.

Run from the repository root:  python3 -I docs/agents/backtests/grokpm_rules/scripts/fetch.py

Reads data/shadow.json (the D7 shadow forecasts, exported by sql/shadow.sql) and, keylessly, for each market:
  - Gamma /markets?condition_ids=… (closed first, then open): its outcome prices, closed flag and token ids;
  - the data API's /trades?market=… (newest 1,000), both every print (takerOnly=false) and the takers' side alone
    (takerOnly=true): a resting YES bid at b is filled by a taker selling YES at b or under, or buying NO at 1 − b or
    over (the venue matches the two by minting);
  - the CLOB's /prices-history for the token the agent priced (fidelity 1 minute, from its first shadow row less an hour
    to now).
Writes data/public.json.gz. Re-running pulls the public record again and can differ; the committed file is what the
study read.
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


def iso(ts):
    return time.mktime(time.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone


def main():
    sh = json.load(open(os.path.join(DATA, "shadow.json")))
    first = {k: a["first"][1] for k, a in sh["alberta"].items()}
    for r in sh["rows"]:
        first[r[2]] = min(first.get(r[2], r[1]), r[1])
    out = {"read_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "markets": {}}
    for key, ids in sh["markets"].items():
        cond, token = ids["market_id"], ids["token_id"]
        g = get(f"https://gamma-api.polymarket.com/markets?condition_ids={cond}&closed=true") or []
        if not g:
            g = get(f"https://gamma-api.polymarket.com/markets?condition_ids={cond}") or []
        m = g[0] if g else {}
        keep = {k: m.get(k) for k in ("question", "closed", "outcomes", "outcomePrices", "clobTokenIds", "umaResolutionStatus",
                                     "closedTime", "endDate", "volumeNum", "bestBid", "bestAsk", "lastTradePrice")}
        trades = get(f"https://data-api.polymarket.com/trades?market={cond}&limit=1000&takerOnly=false") or []
        trades = [{k: t.get(k) for k in ("asset", "side", "price", "size", "timestamp", "outcome")} for t in trades]
        taker = get(f"https://data-api.polymarket.com/trades?market={cond}&limit=1000&takerOnly=true") or []
        taker = [{k: t.get(k) for k in ("asset", "side", "price", "size", "timestamp", "outcome")} for t in taker]
        start = int(iso(first[key])) - 3600
        hist = get(f"https://clob.polymarket.com/prices-history?market={token}&startTs={start}&endTs={int(time.time())}&fidelity=1") or {}
        out["markets"][key] = {"gamma": keep, "trades": trades, "taker_trades": taker, "history": hist.get("history", [])}
        print(cond, keep.get("question"), keep.get("closed"), keep.get("outcomePrices"), len(trades), len(taker), len(hist.get("history", [])))
    with gzip.GzipFile(os.path.join(DATA, "public.json.gz"), "wb", mtime=0) as f:
        f.write(json.dumps(out, indent=0, sort_keys=True).encode())


if __name__ == "__main__":
    main()
