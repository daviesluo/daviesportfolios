"""Dukascopy's public GBP/USD ticks, hour by hour, for the fast-X study (2026-09-28). Keyless.

    GET https://datafeed.dukascopy.com/datafeed/GBPUSD/YYYY/MM/DD/HHh_ticks.bi5

MM in that path is 0-based (00 = January, 07 = August, 08 = September); the files are saved under the calendar date.
Each file is LZMA-compressed 20-byte big-endian records: ms offset in the hour (uint32), ask and bid (uint32, in 1e-5),
ask and bid volume (float32). An hour with no quote (the weekend) is an empty body with status 200.

Pacing: requests START at least 1.5 s apart (one global clock over at most WORKERS requests in flight, because the
feed took about 10 s to answer each request on 2026-09-28), a browser User-Agent, exponential backoff on 429, 5xx and
dropped connections (Retry-After honoured). A body is kept only if it is empty or decompresses to whole 20-byte
records. Resume-safe: a file already saved is not fetched again, and each is written to a .part file and renamed. Every
request is logged to OUT_DIR/_requests.jsonl as it happens. The raw files stay outside the repository; SHA256SUMS
(sha256, saved name, URL) is written beside them and a copy is committed, so anyone can re-fetch and check every byte.

usage: pull_ticks.py OUT_DIR FROM_HOUR TO_HOUR [WORKERS]   (UTC, e.g. 2026-08-26T00 2026-09-28T00, TO exclusive)
"""
import datetime, hashlib, json, lzma, os, queue, sys, threading, time, urllib.error, urllib.request

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0", "Accept": "*/*"}
BASE = "https://datafeed.dukascopy.com/datafeed/GBPUSD"
GAP = 1.5


def url_of(h):
    return f"{BASE}/{h.year:04d}/{h.month - 1:02d}/{h.day:02d}/{h.hour:02d}h_ticks.bi5"


def name_of(h):
    return f"GBPUSD/{h:%Y-%m-%d}/{h.hour:02d}h_ticks.bi5"


def valid(body):
    if not body:
        return True
    try:
        return len(lzma.decompress(body)) % 20 == 0
    except lzma.LZMAError:
        return False


class Pacer:
    """Request starts at least GAP seconds apart across every worker."""
    def __init__(self):
        self.lock, self.last = threading.Lock(), 0.0

    def wait(self):
        with self.lock:
            d = self.last + GAP - time.time()
            if d > 0:
                time.sleep(d)
            self.last = time.time()


class Log:
    """Every request, appended to OUT_DIR/_requests.jsonl as it happens."""
    def __init__(self, path):
        self.f, self.lock = open(path, "a"), threading.Lock()

    def append(self, r):
        with self.lock:
            self.f.write(json.dumps(r) + "\n")
            self.f.flush()


def fetch(url, log, pacer):
    for attempt in range(14):
        pacer.wait()
        t = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
                body = r.read()
                ok = valid(body)
                log.append({"url": url, "status": r.status if ok else "invalid body", "bytes": len(body), "t": round(t, 3),
                            "s": round(time.time() - t, 2)})
                if ok:
                    return body
                time.sleep(min(120, 2 * 2 ** attempt))
        except urllib.error.HTTPError as e:
            log.append({"url": url, "status": e.code, "t": round(t, 3), "s": round(time.time() - t, 2)})
            if e.code == 404:
                return None
            ra = e.headers.get("Retry-After")
            time.sleep(float(ra) if ra and ra.replace(".", "", 1).isdigit() else min(120, 2 * 2 ** attempt))
        except Exception as e:  # dropped connection, timeout, truncated body
            log.append({"url": url, "status": repr(e)[:80], "t": round(t, 3), "s": round(time.time() - t, 2)})
            time.sleep(min(120, 2 * 2 ** attempt))
    return "gave up"


def main():
    out, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
    workers = int(sys.argv[4]) if len(sys.argv) > 4 else 1
    h0 = datetime.datetime.fromisoformat(a + ":00").replace(tzinfo=datetime.timezone.utc)
    h1 = datetime.datetime.fromisoformat(b + ":00").replace(tzinfo=datetime.timezone.utc)
    log, pacer = Log(os.path.join(out, "_requests.jsonl")), Pacer()
    todo = queue.Queue()
    h = h0
    while h < h1:
        if not os.path.exists(os.path.join(out, name_of(h))):
            todo.put(h)
        h += datetime.timedelta(hours=1)
    print("to fetch", todo.qsize(), flush=True)
    done = [0]
    failed = []

    def work():
        while True:
            try:
                hh = todo.get_nowait()
            except queue.Empty:
                return
            body = fetch(url_of(hh), log, pacer)
            if body is None or body == "gave up":
                failed.append((hh.isoformat(), body or 404))
                print("FAILED", url_of(hh), body or 404, flush=True)
                continue
            fn = os.path.join(out, name_of(hh))
            os.makedirs(os.path.dirname(fn), exist_ok=True)
            open(fn + ".part", "wb").write(body)
            os.replace(fn + ".part", fn)
            done[0] += 1
            if done[0] % 24 == 0:
                print(f"{done[0]} saved, last {hh:%Y-%m-%d %H}h", flush=True)

    ths = [threading.Thread(target=work) for _ in range(workers)]
    for t in ths:
        t.start()
    for t in ths:
        t.join()
    # SHA256SUMS over every hour saved under OUT_DIR (all pulls so far)
    rows = []
    for root, _, files in os.walk(os.path.join(out, "GBPUSD")):
        for x in files:
            if x.endswith(".bi5"):
                p = os.path.join(root, x)
                rel = os.path.relpath(p, out).replace(os.sep, "/")
                d = datetime.datetime.strptime(rel.split("/")[1] + " " + x[:2], "%Y-%m-%d %H").replace(tzinfo=datetime.timezone.utc)
                rows.append((rel, hashlib.sha256(open(p, "rb").read()).hexdigest(), url_of(d)))
    with open(os.path.join(out, "SHA256SUMS"), "w") as f:
        for rel, s, u in sorted(rows):
            f.write(f"{s}  {rel}  {u}\n")
    print("done", done[0], "new files;", len(rows), "in SHA256SUMS; failed", failed, flush=True)


if __name__ == "__main__":
    main()
