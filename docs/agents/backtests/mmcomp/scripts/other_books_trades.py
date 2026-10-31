# MAKER-OTHER-BOOKS (2026-10-31): pull Revolut X's keyless public trades of the UK books named on the command line,
# one UTC day a window (the endpoint's limit), 100 a page, for [FROM, TO). One JSON line per print to OUT (gzip):
# id, ms, price, quantity, taker side. A 429 waits its Retry-After (or 5 s) and tries again. GETs only, no key.
#   SSL_CERT_FILE=<the proxy's CA bundle> python3 -I other_books_trades.py <out.jsonl.gz> <from YYYY-MM-DD> <to> SYM...
import datetime as dt, gzip, json, sys, time, urllib.error, urllib.parse, urllib.request

GAP = 1.6


def get(url):
    for k in range(8):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "maker-other-books-study"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            ra = e.headers.get("Retry-After")
            time.sleep(min(30, (float(ra) / 1000 if ra else 5) + 1))
    raise RuntimeError("429 eight times")


def main(out, d0, d1, syms):
    a = dt.datetime.fromisoformat(d0).replace(tzinfo=dt.timezone.utc)
    b = dt.datetime.fromisoformat(d1).replace(tzinfo=dt.timezone.utc)
    with gzip.open(out, "wt") as f:
        for sym in syms:
            day = a
            while day < b:
                s = int(day.timestamp() * 1000)
                e = int(min(day + dt.timedelta(days=1), b).timestamp() * 1000) - 1
                cur, n = "", 0
                while True:
                    url = (f"https://revx.revolut.com/api/1.0/public/trades/all?symbol={sym}&start_date={s}&end_date={e}&limit=100"
                           + (f"&cursor={urllib.parse.quote(cur)}" if cur else ""))
                    j = get(url)
                    for r in j.get("data") or []:
                        if r.get("region") not in (None, "UK"):
                            continue
                        f.write(json.dumps({"book": sym, "id": r.get("id") or r.get("tid"), "ts": r.get("tdt") or r.get("timestamp"),
                                            "p": r.get("price") or r.get("p"), "q": r.get("quantity") or r.get("q"),
                                            "s": r.get("side") or r.get("s")}) + "\n")
                        n += 1
                    cur = (j.get("metadata") or {}).get("next_cursor") or ""
                    time.sleep(GAP)
                    if not cur:
                        break
                print(sym, day.date(), n, flush=True)
                day += dt.timedelta(days=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:])
