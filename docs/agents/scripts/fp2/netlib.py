"""Shared HTTP helpers (copied from research_fp; LOCK is the SAME shared file).

Revolut X public endpoints share ONE token bucket of 1 request/second. Several
processes (the live sampler and the history pullers) run at once, so request
starts are serialised through a file lock that records the last start time:
no two Revolut X requests from this study start less than REVX_GAP seconds
apart, whichever process sends them. Binance (data-api.binance.vision) and
Kraken are paced separately and far more gently than their limits.
"""
import fcntl, json, os, time, urllib.request, urllib.error

S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCK = (__import__('os').environ.get('FP_ROOT', '.') + '/research_fp/.revx_lock')  # SHARED with every research process on this machine
REVX_GAP = 1.10          # seconds between Revolut X request starts (limit is 1/s)
UA = {"User-Agent": "daviesportfolios-research/1.0 (public market data)"}

_other_last = {}

def _pace_revx():
    fd = os.open(LOCK, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        raw = os.pread(fd, 64, 0).decode().strip()
        last = float(raw) if raw else 0.0
        now = time.time()
        wait = last + REVX_GAP - now
        if wait > 0:
            time.sleep(wait)
        now = time.time()
        os.ftruncate(fd, 0)
        os.pwrite(fd, f"{now:.6f}".encode(), 0)
        os.fsync(fd)
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)

def _pace_other(host, gap):
    last = _other_last.get(host, 0.0)
    wait = last + gap - time.time()
    if wait > 0:
        time.sleep(wait)
    _other_last[host] = time.time()

def get_json(url, tries=6, timeout=60):
    """GET a JSON URL with pacing per host. Returns (status, data, t_start, t_end)."""
    host = url.split("/")[2]
    for a in range(tries):
        if "revx.revolut.com" in host:
            _pace_revx()
        elif "binance" in host:
            _pace_other(host, 0.25)
        elif "kraken" in host:
            _pace_other(host, 1.0)
        else:
            _pace_other(host, 0.5)
        t0 = time.time()
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as f:
                body = f.read()
            t1 = time.time()
            return 200, json.loads(body), t0, t1
        except urllib.error.HTTPError as e:
            t1 = time.time()
            if e.code == 429:
                ra = e.headers.get("Retry-After")
                w = 2.0 * (a + 1)
                try:
                    if ra:
                        w = max(w, float(ra) / (1000.0 if float(ra) > 100 else 1.0))
                except Exception:
                    pass
                time.sleep(min(60, w))
                continue
            if e.code in (400, 404, 451):
                try:
                    return e.code, json.loads(e.read()), t0, t1
                except Exception:
                    return e.code, None, t0, t1
            time.sleep(2.0 * (a + 1))
        except Exception:
            time.sleep(2.0 * (a + 1))
    return -1, None, time.time(), time.time()
