"""SPEED step 2b: the post-count markets' resolution source, polled live — how soon after a post Polymarket's tracker
(xtracker.polymarket.com, keyless) shows it.

Polls `/api/users/<handle>/posts` for the tracked accounts every few seconds and records, for every post it had not
shown at its first poll, the post's own time (`createdAt`), the tracker's capture (`importedAt`), and the instant this
machine first saw it with the poll before that did not. Every request carries a User-Agent naming this project and a
millisecond parameter no earlier read carried (the host sits behind Vercel's cache).

usage: poll_xtracker.py <out dir> <minutes>
"""
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

UA = "daviesportfolios-speed-study/1.0 (research; public data only)"
HANDLES = {"elonmusk": 5, "realDonaldTrump": 15, "WhiteHouse": 15, "tedcruz": 30, "ZelenskyyUa": 30, "cz_binance": 30,
           "Cobratate": 30, "NYCMayor": 30, "khamenei_ir": 30}
OUT = sys.argv[1]
END = time.time() + 60 * float(sys.argv[2])
LOCK = threading.Lock()


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def ts_of(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except (AttributeError, ValueError):
        return None


def write(name, obj):
    with LOCK:
        with open(os.path.join(OUT, name), "a") as f:
            f.write(json.dumps(obj, sort_keys=True) + "\n")


def watch(handle, every):
    seen, prev, first = set(), None, True
    nxt = time.time()
    while time.time() < END:
        now = time.time()
        params = {"startDate": iso(now - 6 * 3600), "endDate": iso(now + 3600), "_": str(int(now * 1000))}
        url = f"https://xtracker.polymarket.com/api/users/{handle}/posts?" + urllib.parse.urlencode(params)
        t0 = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=20) as r:
                body, st = r.read(), r.status
        except urllib.error.HTTPError as e:
            body, st = b"", e.code
        except Exception:  # noqa: BLE001
            body, st = b"", 0
        t1 = time.time()
        write("xt_polls.jsonl", {"h": handle, "t0": round(t0, 3), "t1": round(t1, 3), "status": st})
        if st == 200:
            for p in (json.loads(body).get("data") or []):
                k = p.get("platformId") or p.get("id")
                if k in seen:
                    continue
                seen.add(k)
                write("xt_posts.jsonl", {"h": handle, "id": k, "created": ts_of(p.get("createdAt")),
                                         "imported": ts_of(p.get("importedAt")), "seen": round(t1, 3), "prev": prev,
                                         "initial": first})
            prev, first = round(t1, 3), False
        nxt += every
        time.sleep(max(0.0, nxt - time.time()))


def main():
    os.makedirs(OUT, exist_ok=True)
    th = [threading.Thread(target=watch, args=(h, s), daemon=True) for h, s in HANDLES.items()]
    for t in th:
        t.start()
        time.sleep(0.5)
    for t in th:
        t.join()


if __name__ == "__main__":
    main()
