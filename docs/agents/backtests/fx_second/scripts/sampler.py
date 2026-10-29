"""Poll keyless FX sources once a second each, in parallel, and log what came back with our receive time.

usage: python3 -I sampler.py OUT.jsonl SECONDS
"""
import json, os, sys, threading, time, urllib.request, ssl

OUT, SECS = sys.argv[1], float(sys.argv[2])
# A proxy's CA bundle when the machine needs one (FX_CA_BUNDLE); the system's otherwise.
CTX = ssl.create_default_context(cafile=os.environ.get("FX_CA_BUNDLE") or None)
lock = threading.Lock()
fh = open(OUT, "a")

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 fx-probe"})
    with urllib.request.urlopen(req, timeout=5, context=CTX) as r:
        return r.status, r.read().decode()

def truefx(body):
    out = []
    for line in body.strip().splitlines():
        p = line.split(",")
        if p[0] in ("GBP/USD", "EUR/USD") and len(p) >= 6:
            out.append({"pair": p[0].replace("/", ""), "src_ms": int(p[1]), "bid": float(p[2] + p[3]), "ask": float(p[4] + p[5])})
    return out

def kraken(body):
    j = json.loads(body)["result"]
    m = {"ZGBPZUSD": "GBPUSD", "ZEURZUSD": "EURUSD"}
    return [{"pair": m[k], "src_ms": None, "bid": float(v["b"][0]), "ask": float(v["a"][0])} for k, v in j.items() if k in m]

def bitstamp(pair):
    def f(body):
        j = json.loads(body)
        return [{"pair": pair, "src_ms": int(j["timestamp"]) * 1000, "bid": float(j["bid"]), "ask": float(j["ask"])}]
    return f

def coinbase(pair):
    def f(body):
        j = json.loads(body)
        # USDC priced in GBP/EUR: the dollar rate is the inverse; bid and ask swap.
        return [{"pair": pair, "src_ms": None, "bid": 1 / float(j["ask"]), "ask": 1 / float(j["bid"]), "last_trade": j.get("time")}]
    return f

SOURCES = [
    ("truefx", "https://webrates.truefx.com/rates/connect.html?f=csv", truefx),
    ("kraken", "https://api.kraken.com/0/public/Ticker?pair=GBPUSD,EURUSD", kraken),
    ("bitstamp_gbp", "https://www.bitstamp.net/api/v2/ticker/gbpusd/", bitstamp("GBPUSD")),
    ("bitstamp_eur", "https://www.bitstamp.net/api/v2/ticker/eurusd/", bitstamp("EURUSD")),
    ("cb_gbp", "https://api.exchange.coinbase.com/products/USDC-GBP/ticker", coinbase("GBPUSD")),
    ("cb_eur", "https://api.exchange.coinbase.com/products/USDC-EUR/ticker", coinbase("EURUSD")),
]

def run(name, url, parse, end):
    nxt = time.time()
    while time.time() < end:
        t0 = time.time()
        rec = {"src": name, "sent": t0}
        try:
            st, body = get(url)
            rec["recv"] = time.time()
            rec["status"] = st
            rec["rows"] = parse(body)
        except Exception as e:  # noqa: BLE001
            rec["recv"] = time.time()
            rec["err"] = repr(e)[:200]
        with lock:
            fh.write(json.dumps(rec) + "\n"); fh.flush()
        nxt += 1.0
        time.sleep(max(0, nxt - time.time()))

end = time.time() + SECS
ts = [threading.Thread(target=run, args=(n, u, p, end)) for n, u, p in SOURCES]
for t in ts: t.start()
for t in ts: t.join()
