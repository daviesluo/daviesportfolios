# CRYPTOBOOKS-2 (2026-10-31): a year of Revolut X's public tape, sampled: for each UTC day in [FROM, TO) the prints of
# 13:00-16:00 UTC only (the busiest European/US overlap hours), for the UK books named, one request every GAP s (the
# address's public bucket is shared with this study's recorder). Enough to date the regimes (the books' effective
# spread, regimes_hist.py) without pulling a year whole. One line a print to <dir>/hist_<BOOK>.txt.gz:
# id|ms|price|quantity|taker side. GETs only, no key.
#   SSL_CERT_FILE=<the proxy's CA bundle> python3 -I hist_pull.py <dir> <from YYYY-MM-DD> <to> <gap s> SYM...
import datetime as dt, gzip, os, sys, time, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from trades import get  # noqa: E402

H0, H1 = 13, 16


def main(out_dir, d0, d1, gap, syms):
    a = dt.datetime.fromisoformat(d0).replace(tzinfo=dt.timezone.utc)
    b = dt.datetime.fromisoformat(d1).replace(tzinfo=dt.timezone.utc)
    for sym in syms:
        with gzip.open(os.path.join(out_dir, f"hist_{sym}.txt.gz"), "wt") as f:
            day = a
            while day < b:
                s = int((day + dt.timedelta(hours=H0)).timestamp() * 1000)
                e = int((day + dt.timedelta(hours=H1)).timestamp() * 1000) - 1
                cur, n = "", 0
                while True:
                    url = (f"https://revx.revolut.com/api/1.0/public/trades/all?symbol={sym}&start_date={s}&end_date={e}&limit=100"
                           + (f"&cursor={urllib.parse.quote(cur)}" if cur else ""))
                    j = get(url)
                    for r in j.get("data") or []:
                        if r.get("region") not in (None, "UK"):
                            continue
                        f.write("|".join(str(x) for x in (r.get("id"), r.get("timestamp"), r.get("price"), r.get("quantity"),
                                                          r.get("side"))) + "\n")
                        n += 1
                    cur = (j.get("metadata") or {}).get("next_cursor") or ""
                    time.sleep(gap)
                    if not cur:
                        break
                print(sym, day.date(), n, flush=True)
                day += dt.timedelta(days=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), sys.argv[5:])
