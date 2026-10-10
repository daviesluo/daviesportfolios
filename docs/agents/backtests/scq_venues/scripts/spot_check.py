"""Re-read a random sample of the raw pages live and compare their sha256 with the pull's log: 30 Coinbase pages
(10 a book of the three largest segments' books, chosen with random.Random(20261009)), 10 OKX day files, 6 Kraken pages and
6 Bitstamp pages. A page is a fixed trade-id range (Coinbase `after`, Kraken `since`) or a closed day, so it should come
back identical.
usage: python3 -I spot_check.py   -> ../results/spot_check.json
"""
import gzip, hashlib, json, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from pull_coinbase import fetch  # noqa: E402
from pull_okx import get  # noqa: E402


def lines(name):
    with gzip.open(os.path.join(ROOT, "inputs", "raw_pages", name), "rt") as f:
        return [l.rstrip("\n").split(" ", 1) for l in f if l.strip()]


def main():
    rng = random.Random(20261009)
    out = {"coinbase": [], "okx": [], "kraken": [], "bitstamp": []}
    cb = [(s, json.loads(j)) for s, j in lines("coinbase_pages.txt.gz")]
    for book in ("USDC-GBP", "USDT-GBP", "USDC-EUR", "USDT-EUR"):
        pool = [x for x in cb if x[0].startswith(book + "_") and x[1]["after"] and x[1]["n"] == 1000]
        for s, r in rng.sample(pool, 8):
            body = fetch(f"https://api.exchange.coinbase.com/products/{book}/trades?limit=1000&after={r['after']}")
            out["coinbase"].append({"seg": s, "after": r["after"], "same": hashlib.sha256(body).hexdigest() == r["sha256"]})
    kr = [(s, json.loads(j)) for s, j in lines("kraken_pages.txt.gz")]
    for s, r in rng.sample([x for x in kr if x[1]["n"] == 1000], 6):
        body = fetch(f"https://api.kraken.com/0/public/Trades?pair={s}&since={r['since']}&count=1000")
        js = json.loads(body)["result"]
        old_last = r["last"]
        out["kraken"].append({"pair": s, "since": r["since"], "same_last": int(js["last"]) == old_last,
                              "same_body": hashlib.sha256(body).hexdigest() == r["sha256"]})
    bs = [(s, json.loads(j)) for s, j in lines("bitstamp_pages.txt.gz")]
    for s, r in rng.sample(bs[:-3], 6):
        body = fetch(f"https://www.bitstamp.net/api/v2/ohlc/{s}/?step=60&limit=1000&start={r['start']}")
        out["bitstamp"].append({"pair": s, "start": r["start"], "same": hashlib.sha256(body).hexdigest() == r["sha256"]})
    with gzip.open(os.path.join(ROOT, "inputs", "raw_pages", "okx_files.json.gz"), "rt") as f:
        ok = json.load(f)
    for k in rng.sample(sorted(x for x, v in ok.items() if v["status"] == 200), 10):
        inst, day = k.split("/")
        st, body = get(f"https://static.okx.com/cdn/okex/traderecords/trades/daily/{day.replace('-', '')}/{inst}-trades-{day}.zip")
        out["okx"].append({"file": k, "same": st == 200 and hashlib.sha256(body).hexdigest() == ok[k]["sha256"]})
    out["summary"] = {v: f"{sum(1 for x in out[v] if x.get('same', x.get('same_last')))}/{len(out[v])}" for v in ("coinbase", "okx", "kraken", "bitstamp")}
    json.dump(out, open(os.path.join(ROOT, "results", "spot_check.json"), "w"), indent=1, sort_keys=True)
    print(out["summary"])


if __name__ == "__main__":
    main()
