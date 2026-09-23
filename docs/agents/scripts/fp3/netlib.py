"""HTTP helpers for research_fp3 (public endpoints only, no keys).

Revolut X: every request start is serialised through the SHARED file lock
research_fp/.revx_lock (>= 1.1 s between request starts from ANY process on
this machine). Binance hosts are paced gently (>= 0.3 s per host).
"""
import fcntl, json, os, time, urllib.request, urllib.error

S = os.environ.get("FP_ROOT", ".") + "/research_fp3"
LOCK = os.environ.get("FP_ROOT", ".") + "/research_fp/.revx_lock"
REVX_GAP = 1.10
UA = {"User-Agent": "daviesportfolios-research/1.0 (public market data)"}
_other_last = {}

def _pace_revx():
    fd = os.open(LOCK, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        raw = os.pread(fd, 64, 0).decode().strip()
        last = float(raw) if raw else 0.0
        wait = last + REVX_GAP - time.time()
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

def get_raw(url, tries=6, timeout=90, gap=0.3):
    host = url.split("/")[2]
    for a in range(tries):
        if "revx.revolut.com" in host:
            _pace_revx()
        else:
            _pace_other(host, gap)
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as f:
                return 200, f.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code == 418:
                ra = e.headers.get("Retry-After")
                w = 2.0 * (a + 1)
                try:
                    if ra:
                        w = max(w, float(ra) / (1000.0 if float(ra) > 100 else 1.0))
                except Exception:
                    pass
                time.sleep(min(90, w)); continue
            if e.code in (400, 403, 404, 451):
                try:
                    return e.code, e.read()
                except Exception:
                    return e.code, b""
            time.sleep(2.0 * (a + 1))
        except Exception:
            time.sleep(2.0 * (a + 1))
    return -1, b""

def get_json(url, **kw):
    code, b = get_raw(url, **kw)
    try:
        return code, json.loads(b) if b else None
    except Exception:
        return code, None
