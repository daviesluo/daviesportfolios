"""Pull Revolut X's PUBLIC trade history (no key) for one or more symbols, day by day.

GET https://revx.revolut.com/api/1.0/public/trades/all?symbol=SYM&start_date=<ms>&end_date=<ms>&limit=100[&cursor=..]
Window <= 1 day; both bounds are INCLUSIVE (measured: a print at T is returned by [T, T+1s] and by [T-1s, T]),
so consecutive day windows share their boundary millisecond and a print exactly there comes back twice:
the extractor dedupes by id. Pages run newest first; follow metadata.next_cursor until it is "".

Every Revolut X request goes through netlib (the shared file lock: >= 1.1 s between request starts across
every process on this machine, 429 honoured with Retry-After).

Output: data/raw/<SYM>.pages.jsonl — one line per page exactly as returned, with the request that made it;
        data/raw/<SYM>.days.jsonl  — one line per completed day (pages, rows, status) so a rerun resumes.
usage: pull_trades.py SYM START_DAY END_DAY_EXCLUSIVE [SYM START END ...]
"""
import json, os, sys, time, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import netlib

S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(S, "data", "raw")
TAG = os.environ.get("TAG", "")   # a second concurrent puller writes its own files: <SYM>.<TAG>.pages.jsonl
BASE = "https://revx.revolut.com/api/1.0/public/trades/all"
DAY = 86400000


def ms(day):
    return int(datetime.datetime.fromisoformat(day + "T00:00").replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)


def done_days(sym):
    fn = os.path.join(RAW, f"{sym}{TAG}.days.jsonl")
    out = set()
    if os.path.exists(fn):
        for line in open(fn):
            r = json.loads(line)
            if r.get("ok"):
                out.add(r["day"])
    return out


def pull_day(sym, a, pages_f):
    b = a + DAY
    cursor, page, rows, stats = "", 0, 0, []
    while True:
        url = f"{BASE}?symbol={sym}&start_date={a}&end_date={b}&limit=100" + (f"&cursor={cursor}" if cursor else "")
        st, d, t0, t1 = netlib.get_json(url)
        if st != 200 or not isinstance(d, dict) or "data" not in d:
            return False, page, rows, f"status {st}: {str(d)[:200]}"
        data = d["data"]
        meta = d.get("metadata") or {}
        pages_f.write(json.dumps({"sym": sym, "start_date": a, "end_date": b, "page": page, "cursor_in": cursor,
                                  "t_req": round(t0, 3), "n": len(data), "metadata": meta, "data": data}, sort_keys=True) + "\n")
        pages_f.flush()
        rows += len(data)
        page += 1
        cursor = meta.get("next_cursor") or ""
        if not cursor:
            return True, page, rows, ""
        if page > 400:
            return False, page, rows, "too many pages"


def main():
    args = sys.argv[1:]
    jobs = [(args[i], args[i + 1], args[i + 2]) for i in range(0, len(args), 3)]
    for sym, d0, d1 in jobs:
        have = done_days(sym)
        pages_f = open(os.path.join(RAW, f"{sym}{TAG}.pages.jsonl"), "a")
        days_f = open(os.path.join(RAW, f"{sym}{TAG}.days.jsonl"), "a")
        a, z = ms(d0), ms(d1)
        n_days = (z - a) // DAY
        k = 0
        while a < z:
            day = datetime.datetime.fromtimestamp(a / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")
            if day not in have:
                for attempt in range(4):
                    ok, pages, rows, err = pull_day(sym, a, pages_f)
                    days_f.write(json.dumps({"sym": sym, "day": day, "start_date": a, "ok": ok, "pages": pages, "rows": rows,
                                             "attempt": attempt, "err": err, "t": round(time.time(), 3)}) + "\n")
                    days_f.flush()
                    if ok:
                        break
                    time.sleep(5 * (attempt + 1))
            k += 1
            if k % 10 == 0:
                print(f"{sym} {day} {k}/{n_days}", flush=True)
            a += DAY
        pages_f.close(); days_f.close()
        print(f"DONE {sym}", flush=True)


if __name__ == "__main__":
    main()
