# CRYPTOBOOKS (2026-10-31): pull Revolut X's keyless public trade tape of the UK books named on the command line, one UTC
# day a window (the endpoint's limit), 100 a page, for [FROM, TO), one request every GAP s (this study's book poll shares
# the address's public bucket). One line a print to <dir>/tape_<BOOK>.txt.gz: id|ms|price|quantity|taker side. A 429
# waits its Retry-After (or 5 s) and tries again. GETs only, no key.
#   SSL_CERT_FILE=<the proxy's CA bundle> python3 -I trades.py <dir> <from YYYY-MM-DD> <to> <gap s> SYM...
import datetime as dt, gzip, json, os, sys, time, urllib.error, urllib.parse, urllib.request


def get(url):
    for k in range(10):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "crypto-books-study"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            ra = e.headers.get("Retry-After")
            time.sleep(min(30, (float(ra) / 1000 if ra else 5) + 1))
        except (urllib.error.URLError, TimeoutError):
            time.sleep(5)
    raise RuntimeError("failed ten times: " + url)


def main(out_dir, d0, d1, gap, syms):
    a = dt.datetime.fromisoformat(d0).replace(tzinfo=dt.timezone.utc)
    b = dt.datetime.fromisoformat(d1).replace(tzinfo=dt.timezone.utc)
    for sym in syms:
        path = os.path.join(out_dir, f"tape_{sym}.txt.gz")
        with gzip.open(path, "wt") as f:
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
                        f.write("|".join(str(x) for x in (r.get("id") or r.get("tid"), r.get("tdt") or r.get("timestamp"),
                                                          r.get("price") or r.get("p"), r.get("quantity") or r.get("q"),
                                                          r.get("side") or r.get("s"))) + "\n")
                        n += 1
                    cur = (j.get("metadata") or {}).get("next_cursor") or ""
                    time.sleep(gap)
                    if not cur:
                        break
                print(sym, day.date(), n, flush=True)
                day += dt.timedelta(days=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), sys.argv[5:])
