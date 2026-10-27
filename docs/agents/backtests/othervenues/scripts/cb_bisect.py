"""The first Coinbase trade id at or after an instant, by bisection over `trades?after=<id>` (keyless).
usage: python3 -I cb_bisect.py PRODUCT ISO_INSTANT [ISO_INSTANT ...]   -> prints PRODUCT INSTANT ID
"""
import datetime, json, sys, time, urllib.request

UA = {"User-Agent": "daviesportfolios-research/1.0 (public market data)"}


def get(u):
    for a in range(8):
        try:
            return json.loads(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=30).read())
        except Exception:  # noqa: BLE001
            time.sleep(1 + 2 * a)
    raise SystemExit("failed " + u)


def t_of(s):
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def time_before(pid, tid):
    """Time of the trade just below tid (the newest with id < tid)."""
    r = get(f"https://api.exchange.coinbase.com/products/{pid}/trades?limit=1&after={tid}")
    time.sleep(0.25)
    return (r[0]["trade_id"], t_of(r[0]["time"])) if r else (0, 0.0)


def first_at_or_after(pid, instant):
    T = t_of(instant)
    newest = get(f"https://api.exchange.coinbase.com/products/{pid}/trades?limit=1")[0]["trade_id"]
    lo, hi = 1, newest + 1          # invariant: trade lo-1 is before T (or none), trade hi-1 ... search smallest id with time >= T
    while hi - lo > 1:
        mid = (lo + hi) // 2
        _, t = time_before(pid, mid + 1)    # the trade with id <= mid
        if t >= T:
            hi = mid
        else:
            lo = mid
    return hi


if __name__ == "__main__":
    pid = sys.argv[1]
    for s in sys.argv[2:]:
        print(pid, s, first_at_or_after(pid, s), flush=True)
