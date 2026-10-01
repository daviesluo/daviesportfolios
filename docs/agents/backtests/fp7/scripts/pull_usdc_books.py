"""Keyless pull for the coin/USDC screen (2026-10-01). Revolut X UK prints of four coin/USDC books and Binance's
1-minute klines of the same coin against USDC, 2026-09-24 00:00 -> 2026-10-01 00:00 UTC (7 days).
Screening window only: a forward test would start after a freeze and never use these days."""
import json, time, gzip, urllib.request, urllib.parse, sys, os
P0, P1 = 1790208000000, 1790812800000  # 2026-09-24 00:00, 2026-10-01 00:00 UTC (ms)
DAY = 86400000
BOOKS = ["SOL-USDC", "PEPE-USDC", "HBAR-USDC", "LINK-USDC"]
def get(url):
    for i in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "research"}), timeout=30) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(2 + i); continue
            return e.code, None
        except Exception as e:
            time.sleep(2); last = e
    return -1, None
os.makedirs("samples/usdc", exist_ok=True)
log = []
for sym in BOOKS:
    rows = {}
    for a in range(P0, P1, DAY):
        cursor, page = "", 0
        while True:
            url = (f"https://revx.revolut.com/api/1.0/public/trades/all?symbol={sym}&start_date={a}&end_date={a+DAY-1}"
                   f"&limit=100&region=UK" + (f"&cursor={urllib.parse.quote(cursor)}" if cursor else ""))
            st, d = get(url); time.sleep(1.1)
            data = (d or {}).get("data") or []
            log.append({"url": url, "status": st, "n": len(data)})
            if st != 200:
                print("FAIL", url, st); break
            for r in data:
                if r.get("region") == "UK":
                    rows[r["id"]] = {"price": float(r["price"]), "qty": float(r["quantity"]), "side": r["side"], "ts": int(r["timestamp"])}
            cursor = ((d or {}).get("metadata") or {}).get("next_cursor") or ""
            page += 1
            if not cursor or page > 300: break
    lst = sorted(rows.values(), key=lambda z: z["ts"])
    json.dump({"symbol": sym, "from": P0, "to": P1, "rows": lst}, gzip.open(f"samples/usdc/prints_{sym}.json.gz", "wt"))
    print(sym, "prints", len(lst), flush=True)
for sym in BOOKS:
    bsym = sym.replace("-", "")
    out, t = [], P0 - 120 * 60000
    while t < P1 + 61 * 60000:
        url = f"https://data-api.binance.vision/api/v3/klines?symbol={bsym}&interval=1m&startTime={t}&limit=1000"
        st, d = get(url); time.sleep(0.3)
        log.append({"url": url, "status": st, "n": len(d or [])})
        if st != 200 or not d: print("FAIL", url, st); break
        out += [[int(k[0]), float(k[4]), float(k[5])] for k in d]
        t = int(d[-1][0]) + 60000
    json.dump({"symbol": bsym, "rows": out}, gzip.open(f"samples/usdc/binance_{bsym}_1m.json.gz", "wt"))
    print(bsym, "minutes", len(out), flush=True)
json.dump(log, open("samples/usdc/pull_log.json", "w"))
print("calls", len(log), "non-200", sum(1 for x in log if x["status"] != 200))
