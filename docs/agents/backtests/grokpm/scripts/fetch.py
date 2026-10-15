"""GROKPM cadence study, step 1: keyless pulls of resolved low- and high-attention Polymarket markets and their prices.

Run from the repository root:  python3 -I docs/agents/backtests/grokpm/scripts/fetch.py
Writes docs/agents/backtests/grokpm/data/markets.json and data/prices.json.gz. Public GETs only (Gamma /events, the CLOB's
/prices-history); no key, no account. The universe is the experiment's: the kinds of market categories A and B may trade.

  * events closed under the tags politics, economy, world, tech, geopolitics (Gamma `tag_slug`), closed between
    WINDOW_FROM and WINDOW_TO;
  * each binary market resolved cleanly (outcomePrices exactly ["1","0"] or ["0","1"]);
  * no sports, crypto, short-dated price, weather market (feeType in EXCLUDED_FEES, or a sportsMarketType);
  * the YES token's price every FIDELITY minutes over the LOOKBACK_DAYS before the market closed.

A market's attention is its lifetime volume (Gamma `volume`): THIN under THIN_USD (a book the experiment may not trade),
LOW from THIN_USD to under LOW_ATTENTION_USD (the low-attention markets category B looks for), HIGH from LOW_ATTENTION_USD.
At most PER_STRATUM markets of each stratum are kept, drawn with random.Random(SEED) from all that qualify.
"""
import gzip, json, random, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

OUT = "docs/agents/backtests/grokpm/data"
TAGS = ["politics", "economy", "world", "tech", "geopolitics"]
WINDOW_FROM = "2026-08-15T00:00:00Z"
WINDOW_TO = "2026-10-15T00:00:00Z"
EXCLUDED_FEES = {"weather_fees", "finance_prices_fees"}
EXCLUDED_FEE_PREFIXES = ("sports_fees", "crypto_fees")
THIN_USD = 10_000
LOW_ATTENTION_USD = 50_000
PER_STRATUM = 200
LOOKBACK_DAYS = 7
FIDELITY = 5
SEED = 20261015
UA = {"User-Agent": "daviesportfolios-grokpm-study/1.0 (public data only)", "Accept": "application/json"}


def get(url, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.loads(r.read())
        except Exception as e:  # noqa: BLE001 - a public read retried, then reported
            if k == tries - 1:
                raise
            time.sleep(1.5 * (k + 1))


def ts(s):
    s = s.replace(" ", "T").replace("+00", "Z") if s.endswith("+00") else s
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def main():
    lo, hi = ts(WINDOW_FROM), ts(WINDOW_TO)
    seen, cands = set(), []
    for tag in TAGS:
        for offset in range(0, 5000, 100):
            q = urllib.parse.urlencode({"closed": "true", "limit": 100, "offset": offset, "tag_slug": tag, "order": "closedTime", "ascending": "false"})
            evs = get(f"https://gamma-api.polymarket.com/events?{q}")
            if not evs:
                break
            oldest = min((ts(e["closedTime"]) for e in evs if e.get("closedTime")), default=hi)
            for e in evs:
                for m in e.get("markets", []):
                    cid = m.get("conditionId")
                    if not cid or cid in seen or not m.get("closedTime"):
                        continue
                    seen.add(cid)
                    fee = m.get("feeType") or ""
                    if fee in EXCLUDED_FEES or fee.startswith(EXCLUDED_FEE_PREFIXES) or m.get("sportsMarketType"):
                        continue
                    try:
                        prices = json.loads(m.get("outcomePrices") or "[]")
                        toks = json.loads(m.get("clobTokenIds") or "[]")
                    except ValueError:
                        continue
                    if prices not in (["1", "0"], ["0", "1"]) or len(toks) != 2:
                        continue
                    t_close = ts(m["closedTime"])
                    if not lo <= t_close < hi:
                        continue
                    vol = float(m.get("volume") or 0)
                    if vol <= 0:
                        continue
                    cands.append({"cond": cid, "q": m.get("question"), "tag": tag, "fee": fee or None, "yes": toks[0], "y": 1 if prices[0] == "1" else 0,
                                  "closed": m["closedTime"], "end": m.get("endDate"), "start": m.get("startDate"), "volume": round(vol, 2)})
            if oldest < lo:
                break
    rng = random.Random(SEED)
    thin = sorted([c for c in cands if c["volume"] < THIN_USD], key=lambda c: c["cond"])
    low = sorted([c for c in cands if THIN_USD <= c["volume"] < LOW_ATTENTION_USD], key=lambda c: c["cond"])
    high = sorted([c for c in cands if c["volume"] >= LOW_ATTENTION_USD], key=lambda c: c["cond"])
    pick = []
    for name, group in (("thin", thin), ("low", low), ("high", high)):
        pick += [dict(c, stratum=name) for c in rng.sample(group, min(PER_STRATUM, len(group)))]
    prices = {}
    for i, c in enumerate(pick):
        t1 = int(ts(c["closed"]))
        t0 = t1 - LOOKBACK_DAYS * 86400
        q = urllib.parse.urlencode({"market": c["yes"], "startTs": t0, "endTs": t1, "fidelity": FIDELITY})
        try:
            h = get(f"https://clob.polymarket.com/prices-history?{q}").get("history", [])
        except Exception as e:  # noqa: BLE001
            print(f"{c['cond']}: {e}", file=sys.stderr)
            h = []
        prices[c["cond"]] = [[int(p["t"]), float(p["p"])] for p in h]
        if i % 50 == 0:
            print(f"{i}/{len(pick)}", file=sys.stderr)
    meta = {"pulled_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "candidates": len(cands), "thin_candidates": len(thin), "low_candidates": len(low), "high_candidates": len(high),
            "params": {"tags": TAGS, "window": [WINDOW_FROM, WINDOW_TO], "thin_usd": THIN_USD, "low_attention_usd": LOW_ATTENTION_USD, "per_stratum": PER_STRATUM,
                       "lookback_days": LOOKBACK_DAYS, "fidelity_min": FIDELITY, "seed": SEED}}
    with open(f"{OUT}/markets.json", "w") as f:
        json.dump({"meta": meta, "markets": pick}, f, indent=0)
    with gzip.open(f"{OUT}/prices.json.gz", "wt") as f:
        json.dump(prices, f, separators=(",", ":"))
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
