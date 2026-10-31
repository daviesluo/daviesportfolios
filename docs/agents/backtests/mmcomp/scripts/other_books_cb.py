# MAKER-OTHER-BOOKS (2026-10-31): Coinbase Exchange's keyless one-minute candles, the external fair for the Revolut X
# books studied (reviews/2026-10-31-maker-other-books.md). 300 candles a call, [FROM, TO) UTC, one JSON line per minute
# to OUT (gzip): product, minute (s), open, high, low, close, volume. GETs only, no key.
#   SSL_CERT_FILE=<the proxy's CA bundle> python3 -I other_books_cb.py <out.jsonl.gz> <from ISO> <to ISO> PRODUCT...
import datetime as dt, gzip, json, sys, time, urllib.error, urllib.request


def get(url):
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "maker-other-books-study"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            time.sleep(3)
    raise RuntimeError("429 six times")


def main(out, a, b, prods):
    t0 = int(dt.datetime.fromisoformat(a).replace(tzinfo=dt.timezone.utc).timestamp())
    t1 = int(dt.datetime.fromisoformat(b).replace(tzinfo=dt.timezone.utc).timestamp())
    with gzip.open(out, "wt") as f:
        for p in prods:
            s, n = t0, 0
            while s < t1:
                e = min(s + 300 * 60, t1)
                rows = get(f"https://api.exchange.coinbase.com/products/{p}/candles?granularity=60"
                           f"&start={dt.datetime.utcfromtimestamp(s).isoformat()}Z&end={dt.datetime.utcfromtimestamp(e - 60).isoformat()}Z")
                for t, lo, hi, op, cl, vol in sorted(rows):
                    if s <= t < e:
                        f.write(json.dumps({"p": p, "t": t, "o": op, "h": hi, "l": lo, "c": cl, "v": vol}) + "\n")
                        n += 1
                s = e
                time.sleep(0.4)
            print(p, n, flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:])
