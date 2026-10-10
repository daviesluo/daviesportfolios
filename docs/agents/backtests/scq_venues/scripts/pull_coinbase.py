"""Coinbase Exchange's keyless public trade tape for its fx_stablecoin GBP and EUR books, reduced to minute bars.

Source: https://api.exchange.coinbase.com/products/<ID>/trades?limit=1000&after=<trade_id> (keyless; pages run backward
from the newest trade). Coinbase's `side` is the MAKER's side, so the aggressor (taker) is the opposite; the bars store the
aggressor, as pr5_sim's prints do.

A minute bar holds exactly what PR5's simulator reads from a minute's prints (see bars.py): the lowest and highest price
printed by each aggressor side, the minute's last print (time, price, aggressor), its quote-currency volume and print
count. The raw pages (about 1 GB a book-year) are not kept: each page's trade-id range, row count and the sha256 of its
body go to RAW/coinbase/<ID>.pages.jsonl, so any page can be fetched again and compared.
A book can be pulled in segments at once, each ID:AFTER:STOP (the trade ids that bound it: from AFTER-1 down to STOP+1);
the bars of the segments merge exactly (min, max, sum, and the last print by trade id), in bars.py.
usage: python3 -I pull_coinbase.py RAW_DIR ID[:AFTER:STOP] ...      (each resumes from RAW/coinbase/<seg>.state.json)
"""
import datetime, hashlib, json, os, sys, threading, time, urllib.request, urllib.error

START = int(datetime.datetime(2024, 10, 1, tzinfo=datetime.timezone.utc).timestamp() * 1000)
END = int(datetime.datetime(2026, 10, 9, tzinfo=datetime.timezone.utc).timestamp() * 1000)
M = 60000
UA = "daviesportfolios-research/1.0 (public market data)"
PACE = 2.0       # seconds between requests per segment; sixteen segments together stay under Coinbase's 10 a second per IP


def fetch(url):
    for a in range(12):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as f:
                return f.read()
        except urllib.error.HTTPError as e:
            time.sleep(2 + 3 * a if e.code == 429 else 3 * (a + 1))
        except Exception:
            time.sleep(3 * (a + 1))
    raise SystemExit(f"failed {url}")


def ms_of(s):
    d = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    return int(d.timestamp() * 1000)


def pull(raw, seg):
    pid, after, stop = (seg.split(":") + [None, None])[:3]
    after, stop = (int(after) if after else None), (int(stop) if stop else 0)
    d = os.path.join(raw, "coinbase"); os.makedirs(d, exist_ok=True)
    name = seg.replace(":", "_")
    stf, pgf, barf = (os.path.join(d, f"{name}.{x}") for x in ("state.json", "pages.jsonl", "bars.json"))
    st = json.load(open(stf)) if os.path.exists(stf) else {"after": after, "done": False, "bars": {}}
    bars = st["bars"]
    n = 0
    while not st["done"]:
        url = f"https://api.exchange.coinbase.com/products/{pid}/trades?limit=1000" + (f"&after={st['after']}" if st["after"] else "")
        body = fetch(url)
        rows = json.loads(body)
        with open(pgf, "a") as f:
            f.write(json.dumps({"after": st["after"], "n": len(rows), "first": rows[0]["trade_id"] if rows else None,
                                "last": rows[-1]["trade_id"] if rows else None, "sha256": hashlib.sha256(body).hexdigest()}) + "\n")
        if not rows:
            st["done"] = True
            break
        for r in rows:
            if r["trade_id"] <= stop:
                st["done"] = True
                continue
            t = ms_of(r["time"])
            if t >= END:
                continue
            if t < START:
                st["done"] = True
                continue
            pe8 = round(float(r["price"]) * 1e8)
            q = float(r["size"])
            ag = "buy" if r["side"] == "sell" else "sell"         # maker side -> aggressor side
            k = str(t // M)
            b = bars.get(k)
            if b is None:
                # [sell_min, sell_max, buy_min, buy_max, last_ms, last_pe8, last_side, last_tid, vol_quote, n]
                b = bars[k] = [None, None, None, None, -1, None, None, -1, 0.0, 0]
            j = 0 if ag == "sell" else 2
            b[j] = pe8 if b[j] is None else min(b[j], pe8)
            b[j + 1] = pe8 if b[j + 1] is None else max(b[j + 1], pe8)
            if r["trade_id"] > b[7]:
                b[4], b[5], b[6], b[7] = t, pe8, ag, r["trade_id"]
            b[8] += q * pe8 / 1e8
            b[9] += 1
        st["after"] = rows[-1]["trade_id"]
        n += 1
        if n % 200 == 0:
            json.dump(st, open(stf + ".tmp", "w")); os.replace(stf + ".tmp", stf)
            print(pid, "page", n, "after", st["after"], "minutes", len(bars), datetime.datetime.utcfromtimestamp(ms_of(rows[-1]["time"]) / 1000), flush=True)
        time.sleep(PACE)
    json.dump(st, open(stf + ".tmp", "w")); os.replace(stf + ".tmp", stf)
    json.dump({"product": pid, "segment": seg, "start_ms": START, "end_ms": END, "bars": bars}, open(barf, "w"))
    print(pid, "done", len(bars), "minutes", flush=True)


if __name__ == "__main__":
    raw = sys.argv[1]
    ts = [threading.Thread(target=pull, args=(raw, p)) for p in sys.argv[2:]]
    for t in ts:
        t.start(); time.sleep(0.1)
    for t in ts:
        t.join()
