"""Pull CoinJar UK's whole public print history for USDCGBP and USDTGBP, keyless, resumable.

Source: GET https://data.exchange.coinjar.com/products/{ID}/trades?after=<unix s>&limit=1000 (reference §4 item 57):
`after` is inclusive and the page ascending, 1,000 at most. The cursor is the last print's second; prints already kept
in that second are told apart by `tid`. One request a second.
Raw pages go to RAW/<ID>/pages.jsonl (one line a page: the `after` asked, the body's sha256, the body as served), so a
re-run resumes from the last page. The cut is END (2026-10-09T00:00Z): prints at or after it are not kept.
A segment (`FROM` .. `TO`, ISO days) pages from FROM's first second until a page passes TO, into
RAW/<ID>/pages_<FROM>.jsonl, so segments can be pulled side by side (each at a request a second); segments overlap at
their ends and inputs.py joins them by `tid`. With no segment, the book is paged from its first print to END.
usage: python3 -I pull_cj_trades.py RAW_DIR [ID FROM TO]
"""
import hashlib, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netget import get

END = 1791504000            # 2026-10-09T00:00:00Z
assert time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(END)) == "2026-10-09T00:00:00"
PRODUCTS = ["USDCGBP", "USDTGBP"]


def secs(ts):
    return int(time.mktime(time.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone)


def pull(raw, pid, a0=0, stop=END, name="pages.jsonl"):
    d = os.path.join(raw, pid)
    os.makedirs(d, exist_ok=True)
    fn = os.path.join(d, name)
    after, seen = a0, set()
    if os.path.exists(fn):
        for line in open(fn):
            rec = json.loads(line)
            rows = json.loads(rec["body"])
            for r in rows:
                seen.add(r["tid"])
            if rows:
                after = max(after, secs(rows[-1]["timestamp"]))
    out = open(fn, "a")
    while after < stop:
        st, body = get(f"https://data.exchange.coinjar.com/products/{pid}/trades?after={after}&limit=1000")
        time.sleep(1.0)
        if st != 200:
            raise SystemExit(f"{pid} after={after}: HTTP {st}")
        rows = json.loads(body)
        out.write(json.dumps({"after": after, "sha256": hashlib.sha256(body).hexdigest(), "body": body.decode()}) + "\n")
        out.flush()
        new = [r for r in rows if r["tid"] not in seen]
        for r in rows:
            seen.add(r["tid"])
        if not rows:
            break
        last = secs(rows[-1]["timestamp"])
        if not new and len(rows) < 1000:
            break                              # the newest page, nothing new: caught up
        if last == after and len(rows) >= 1000:
            raise SystemExit(f"{pid}: a second fuller than a page at {after}")
        after = last if new else last + 1
        print(pid, rows[-1]["timestamp"], len(seen), flush=True)
    out.close()
    print(pid, "done", len(seen), flush=True)


if __name__ == "__main__":
    if len(sys.argv) > 2:
        a, z = secs(sys.argv[3] + "T00:00:00"), secs(sys.argv[4] + "T00:00:00")
        pull(sys.argv[1], sys.argv[2], a, min(z, END), "pages.jsonl" if a == 0 else f"pages_{sys.argv[3]}.jsonl")
    else:
        for p in PRODUCTS:
            pull(sys.argv[1], p)
