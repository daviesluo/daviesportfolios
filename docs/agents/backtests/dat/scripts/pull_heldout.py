"""DAT study: the held-out pull (design.md §1). NOT RUN by this study, and inert by construction: no candidate survived
the screen (reviews/2026-10-01-dat-study.md), so no pre-registration exists, and this script refuses to fetch anything
unless a pre-registration at PREREG_REL is committed and it and this script are unchanged since the commit that added
the pre-registration (the guard of docs/agents/backtests/equity2/scripts/heldout_dfc_score.py).

If a later round freezes one, this is the pull it names: MSTR's daily bars (Yahoo, meta stripped) and BTC-USD
15-minute candles (Coinbase) from 2025-01-01 to END, into ../inputs/heldout/, plus MSTR's SEC filings over the same span
through pull_sec.py. It writes files and prints counts; it computes nothing on them.
Run from inside the repository: python3 docs/agents/backtests/dat/scripts/pull_heldout.py END (YYYY-MM-DD)
"""
import datetime as dt, gzip, json, os, subprocess, sys, time, urllib.request
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "inputs", "heldout")
PREREG_REL = "docs/agents/reviews/2026-10-01-dat-prereg.md"
ET = ZoneInfo("America/New_York")
KEEP_META = ("currency", "exchangeName", "symbol", "instrumentType", "firstTradeDate", "exchangeTimezoneName")


def git(*args, cwd=HERE):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)


def guard(repo):
    me = os.path.relpath(os.path.abspath(__file__), repo)
    for r in (PREREG_REL, me):
        if git("ls-files", "--error-unmatch", r, cwd=repo).returncode != 0:
            sys.exit(f"refusing: {r} is not committed (no DAT pre-registration has been frozen)")
    added = git("log", "--diff-filter=A", "--format=%H", "--", PREREG_REL, cwd=repo).stdout.split()
    if len(added) != 1 or git("rev-parse", "--verify", "--quiet", added[0] + "^", cwd=repo).returncode != 0:
        sys.exit("refusing: the commit that froze the pre-registration cannot be identified (deepen a shallow clone)")
    if git("diff", "--quiet", added[0], "--", PREREG_REL, me, cwd=repo).returncode != 0:
        sys.exit("refusing: the pre-registration or this script differs from the freeze commit")
    return added[0]


def get(url):
    last = None
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (research script)"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except Exception as e:                                          # noqa: BLE001 - retried, then raised
            last = e
            time.sleep(1.5 * (k + 1))
    raise RuntimeError(f"failed {url}: {last}")


def write_gz(name, obj):
    with gzip.GzipFile(os.path.join(OUT, name), "wb", mtime=0) as g:
        g.write(json.dumps(obj, separators=(",", ":")).encode())


def main():
    repo = git("rev-parse", "--show-toplevel").stdout.strip()
    freeze = guard(repo)
    end = dt.date.fromisoformat(sys.argv[1])
    os.makedirs(OUT, exist_ok=True)
    p1 = int(dt.datetime(2025, 1, 1, tzinfo=dt.timezone.utc).timestamp())
    p2 = int(dt.datetime(end.year, end.month, end.day, 23, 59, 59, tzinfo=dt.timezone.utc).timestamp())
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/MSTR?period1={p1}&period2={p2}&interval=1d"
           f"&events=div%2Csplit&includeAdjustedClose=true")
    res = get(url)["chart"]["result"][0]
    q = res["indicators"]["quote"][0]
    rows = [[dt.datetime.fromtimestamp(t, ET).strftime("%Y-%m-%d"), t, q["open"][i], q["high"][i], q["low"][i],
             q["close"][i], q["close"][i], q["volume"][i]] for i, t in enumerate(res["timestamp"]) if q["close"][i] is not None]
    write_gz("yahoo_MSTR_1d_heldout.json.gz", {"symbol": "MSTR", "url": url, "freeze": freeze,
                                               "meta": {k: res["meta"].get(k) for k in KEEP_META},
                                               "events": res.get("events", {}), "rows": rows})
    start, stop, out = dt.datetime(2025, 1, 1, tzinfo=dt.timezone.utc), dt.datetime(end.year, end.month, end.day,
                                                                                     tzinfo=dt.timezone.utc) + dt.timedelta(days=1), {}
    t = start
    while t < stop:
        e = min(t + dt.timedelta(minutes=15 * 300), stop)
        for c in get(f"https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900"
                     f"&start={t.strftime('%Y-%m-%dT%H:%M:%SZ')}&end={e.strftime('%Y-%m-%dT%H:%M:%SZ')}"):
            if start.timestamp() <= c[0] < stop.timestamp():
                out[int(c[0])] = [int(c[0]), float(c[3]), float(c[2]), float(c[1]), float(c[4]), float(c[5])]
        t = e
        time.sleep(0.2)
    write_gz("coinbase_BTC-USD_15m_heldout.json.gz", [out[k] for k in sorted(out)])
    subprocess.run([sys.executable, os.path.join(HERE, "pull_sec.py"), "1050446", "2025-01-01", end.isoformat(),
                    "--exhibits", "--facts"], check=True)
    print(f"freeze {freeze}: MSTR {len(rows)} bars, BTC {len(out)} candles, filings via pull_sec.py; nothing computed")


if __name__ == "__main__":
    main()
