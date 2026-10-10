"""OKX's keyless daily trade archive for its stablecoin-against-EUR books, reduced to minute bars.

Source: https://static.okx.com/cdn/okex/traderecords/trades/daily/<YYYYMMDD>/<INST>-trades-<YYYY-MM-DD>.zip (the public
"historical market data" download; columns instrument_name, trade_id, side, price, size, created_time [ms], source). OKX's
`side` is the taker's, so it is the aggressor as pr5_sim's prints hold it. Files are de-duplicated by trade_id (OKX's
archive day is not the UTC day). Each zip's sha256 and size go to RAW/okx/_log.json; the zips stay in RAW (not committed).
Bars as pull_coinbase.py: [sell_min, sell_max, buy_min, buy_max, last_ms, last_pe8, last_side, last_tid, vol_quote, n].
usage: python3 -I pull_okx.py RAW_DIR INST [INST ...]
"""
import csv, datetime, hashlib, io, json, os, sys, time, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pull_coinbase import START, END, M, fetch  # noqa: E402
import urllib.request, urllib.error  # noqa: E402


def get(url):
    for a in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "daviesportfolios-research/1.0"}), timeout=120) as f:
                return 200, f.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                return e.code, b""
            time.sleep(3 * (a + 1))
        except Exception:
            time.sleep(3 * (a + 1))
    return -1, b""


def pull(raw, inst):
    d = os.path.join(raw, "okx", inst); os.makedirs(d, exist_ok=True)
    logf = os.path.join(raw, "okx", "_log.json")
    log = json.load(open(logf)) if os.path.exists(logf) else {}
    day = datetime.date(2024, 9, 30)
    while day <= datetime.date(2026, 10, 9):
        key = f"{inst}/{day.isoformat()}"
        fn = os.path.join(d, f"{day.isoformat()}.zip")
        if key not in log:
            st, body = get(f"https://static.okx.com/cdn/okex/traderecords/trades/daily/{day:%Y%m%d}/{inst}-trades-{day.isoformat()}.zip")
            log[key] = {"status": st, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest() if body else None}
            if st == 200:
                open(fn, "wb").write(body)
            json.dump(log, open(logf, "w"), indent=0, sort_keys=True)
            time.sleep(0.3)
        day += datetime.timedelta(days=1)
    rows = {}
    for fn in sorted(os.listdir(d)):
        z = zipfile.ZipFile(os.path.join(d, fn))
        for r in csv.DictReader(io.TextIOWrapper(z.open(z.namelist()[0]), "utf-8")):
            rows[int(r["trade_id"])] = (int(r["created_time"]), round(float(r["price"]) * 1e8), float(r["size"]), r["side"])
    bars = {}
    for tid in sorted(rows):
        t, pe8, q, ag = rows[tid]
        if not (START <= t < END):
            continue
        k = str(t // M)
        b = bars.get(k)
        if b is None:
            b = bars[k] = [None, None, None, None, -1, None, None, -1, 0.0, 0]
        j = 0 if ag == "sell" else 2
        b[j] = pe8 if b[j] is None else min(b[j], pe8)
        b[j + 1] = pe8 if b[j + 1] is None else max(b[j + 1], pe8)
        if tid > b[7]:
            b[4], b[5], b[6], b[7] = t, pe8, ag, tid
        b[8] += q * pe8 / 1e8
        b[9] += 1
    json.dump({"product": inst, "start_ms": START, "end_ms": END, "trades": len(rows), "bars": bars},
              open(os.path.join(raw, "okx", f"{inst}.bars.json"), "w"))
    print(inst, len(rows), "trades", len(bars), "minutes", flush=True)


if __name__ == "__main__":
    for i in sys.argv[2:]:
        pull(sys.argv[1], i)
