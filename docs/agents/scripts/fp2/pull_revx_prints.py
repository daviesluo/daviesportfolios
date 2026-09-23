"""Pull Revolut X UK public trade prints for a set of books, one UTC day at a time.

Endpoint (public, no key):
  GET https://revx.revolut.com/api/1.0/public/trades/all?symbol=<BASE-QUOTE>&region=UK
      &start_date=<ms>&end_date=<ms>&limit=100[&cursor=<metadata.next_cursor>]
Window <= 1 day, 100 rows a page, page until next_cursor == "".

Every request goes through netlib.get_json, which serialises Revolut X request STARTS
through the shared file lock (>= 1.1 s apart across every process on this machine) and
honours 429 Retry-After.

Sampling (fixed before any data was read): every 3rd UTC day (STEP=3; the long-tail books use
STEP=6, i.e. every other day of the same schedule, env BOOKS=... STEP=6) from 2025-10-01 to
2026-09-22 inclusive (day index 0, 3, 6, ...), visited in a seeded random order
(random.Random(20260923)) so that an early stop leaves a sample spread over the year.
PENDLE-USD only from 2026-05-01 (its UK book had ~no volume before).

Output: data/revx_prints/<BOOK>/<YYYY-MM-DD>.json = {"book","day","rows":[...],"pages","requests","complete"}
        data/revx_prints/provenance.jsonl (one line per book-day)
Usage: python3 pull_revx_prints.py [max_requests] [reverse]
"""
import datetime, json, os, random, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import netlib

S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(S, "data", "revx_prints")
os.makedirs(OUT, exist_ok=True)

BOOKS = os.environ.get("BOOKS", "SUI-USD,NEAR-USD,FET-USD,ICP-USD,BCH-USD,AVAX-USD,PENDLE-USD").split(",")
STEP = int(os.environ.get("STEP", "3"))   # every STEP-th day of the schedule (6 = a subset of the 3-day schedule)
FIRST = datetime.date(2025, 10, 1)
LAST = datetime.date(2026, 9, 22)
PENDLE_FROM = datetime.date(2026, 5, 1)
MAX_PAGES = 200

def days():
    out, d, i = [], FIRST, 0
    while d <= LAST:
        if i % STEP == 0:
            out.append(d)
        d += datetime.timedelta(days=1); i += 1
    rng = random.Random(20260923)
    rng.shuffle(out)
    return out

def pull_day(book, day):
    t0 = int(datetime.datetime(day.year, day.month, day.day, tzinfo=datetime.timezone.utc).timestamp() * 1000)
    t1 = t0 + 86400000 - 1
    rows, seen, cursor, pages, reqs, complete = [], set(), "", 0, 0, False
    while pages < MAX_PAGES:
        url = (f"https://revx.revolut.com/api/1.0/public/trades/all?symbol={book}&region=UK"
               f"&start_date={t0}&end_date={t1}&limit=100")
        if cursor:
            url += "&cursor=" + cursor
        st, d, _, _ = netlib.get_json(url)
        reqs += 1
        if st != 200 or not isinstance(d, dict):
            return rows, pages, reqs, False, st
        pages += 1
        for r in d.get("data", []):
            if r.get("id") in seen:
                continue
            seen.add(r.get("id"))
            if r.get("region") != "UK":
                continue
            rows.append(r)
        cursor = (d.get("metadata") or {}).get("next_cursor") or ""
        if not cursor:
            complete = True
            break
    return rows, pages, reqs, complete, 200

def main():
    cap = int(sys.argv[1]) if len(sys.argv) > 1 else 10**9
    order = days()
    if len(sys.argv) > 2 and sys.argv[2] == "reverse":
        order = order[::-1]   # a second process walks the same shuffled list from the other end
    used = 0
    for day in order:
        for book in BOOKS:
            if book == "PENDLE-USD" and day < PENDLE_FROM:
                continue
            fn = os.path.join(OUT, book, day.isoformat() + ".json")
            if os.path.exists(fn) or os.path.exists(fn + ".lock"):
                continue
            if used >= cap:
                print("request cap reached", used, flush=True); return
            os.makedirs(os.path.dirname(fn), exist_ok=True)
            open(fn + ".lock", "w").close()
            rows, pages, reqs, complete, st = pull_day(book, day)
            used += reqs
            rows.sort(key=lambda r: (r["timestamp"], r["id"]))
            if complete:
                json.dump({"book": book, "day": day.isoformat(), "rows": rows, "pages": pages,
                           "requests": reqs, "complete": complete}, open(fn, "w"))
            with open(os.path.join(OUT, "provenance.jsonl"), "a") as f:
                f.write(json.dumps({"book": book, "day": day.isoformat(), "prints": len(rows), "pages": pages,
                                    "requests": reqs, "complete": complete, "status": st,
                                    "at": datetime.datetime.utcnow().isoformat() + "Z"}) + "\n")
            try:
                os.remove(fn + ".lock")
            except OSError:
                pass
            print(book, day, len(rows), "prints", reqs, "req", "total", used, flush=True)

if __name__ == "__main__":
    main()
