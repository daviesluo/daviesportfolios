# MMCOMP part 4b: does the GBP 0.10 bot print on Revolut X's other books too? Keyless public trades (GETs only) of six UK
# books for 2026-10-28 00:00-06:00 UTC: how many prints and how many worth under 0.2 of the quote currency, and the most
# frequent such values. Writes results/bot_elsewhere.json.
# SSL_CERT_FILE=<the proxy's CA bundle, when there is one> python3 -I docs/agents/backtests/mmcomp/scripts/bot_elsewhere.py
import collections, json, os, time, urllib.parse, urllib.request

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results", "bot_elsewhere.json")
A = 1793145600000                # 2026-10-28 00:00 UTC
B = A + 6 * 3_600_000 - 1


def pull(sym):
    rows, cur = [], ""
    for _ in range(80):
        url = (f"https://revx.revolut.com/api/1.0/public/trades/all?symbol={sym}&start_date={A}&end_date={B}&limit=100"
               + (f"&cursor={urllib.parse.quote(cur)}" if cur else ""))
        j = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "mmcomp-study"}), timeout=30))
        rows += [r for r in j.get("data") or [] if r.get("region") == "UK"]
        cur = (j.get("metadata") or {}).get("next_cursor") or ""
        time.sleep(1.2)
        if not cur:
            break
    return rows


res = {"window": "2026-10-28 00:00-06:00 UTC"}
for sym in ("USDT-GBP", "USDC-GBP", "USDT-USD", "USDC-USD", "BTC-GBP", "ETH-GBP"):
    try:
        r = pull(sym)
    except Exception as e:
        res[sym] = {"error": str(e)[:120]}
        continue
    small = [x for x in r if float(x["price"]) * float(x["quantity"]) < 0.2]
    res[sym] = {"prints": len(r), "under_0.2": len(small),
                "top_small_values": collections.Counter(round(float(x["price"]) * float(x["quantity"]), 3) for x in small).most_common(3)}
    print(sym, res[sym], flush=True)
json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)
