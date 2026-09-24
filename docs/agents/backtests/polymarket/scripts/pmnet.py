"""Keyless HTTP helper for Polymarket's PUBLIC endpoints (fp4).

Public reads only: no key, no signed call, no order. Every request is paced
per host and retried on 429/5xx with backoff; nothing here can write.

PM_DATA names the folder raw pulls are written to (not committed; hashed in
MANIFEST.json). It defaults to ./pm_data beside the working directory.
"""
import http.client
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

DATA = os.environ.get("PM_DATA", os.path.abspath("pm_data"))

_LAST = {}
MIN_GAP = {
    "gamma-api.polymarket.com": 0.12,
    "clob.polymarket.com": 0.06,
    "data-api.polymarket.com": 0.12,
    "polymarket.com": 0.5,
    "bridge.polymarket.com": 0.5,
    "data-api.binance.vision": 0.15,
    "api.open-meteo.com": 0.3,
    "historical-forecast-api.open-meteo.com": 0.3,
    "archive-api.open-meteo.com": 0.3,
}
UA = "fp4-research/1.0 (public data only)"


def _pace(host):
    gap = MIN_GAP.get(host, 0.25)
    now = time.monotonic()
    last = _LAST.get(host, 0.0)
    if now - last < gap:
        time.sleep(gap - (now - last))
    _LAST[host] = time.monotonic()


def get(url, params=None, tries=6, timeout=60, raw=False):
    if params:
        q = urllib.parse.urlencode(params, doseq=True)
        url = url + ("&" if "?" in url else "?") + q
    host = urllib.parse.urlparse(url).netloc
    delay = 1.0
    for i in range(tries):
        _pace(host)
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                return body if raw else json.loads(body)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and i < tries - 1:
                ra = e.headers.get("Retry-After")
                try:
                    wait = float(ra) if ra else delay
                except ValueError:
                    wait = delay
                time.sleep(min(wait, 60))
                delay = min(delay * 2, 30)
                continue
            body = e.read()[:500]
            raise RuntimeError(f"HTTP {e.code} {url}: {body!r}")
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, http.client.HTTPException, ValueError) as e:
            # ValueError covers a body cut short mid-JSON; HTTPException an IncompleteRead or a dropped connection
            if i < tries - 1:
                time.sleep(delay)
                delay = min(delay * 2, 30)
                continue
            raise RuntimeError(f"network error {url}: {e}")


def post(url, payload, tries=6, timeout=60):
    host = urllib.parse.urlparse(url).netloc
    data = json.dumps(payload).encode()
    delay = 1.0
    for i in range(tries):
        _pace(host)
        req = urllib.request.Request(
            url, data=data, method="POST",
            headers={"User-Agent": UA, "Content-Type": "application/json", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and i < tries - 1:
                time.sleep(delay)
                delay = min(delay * 2, 30)
                continue
            raise RuntimeError(f"HTTP {e.code} {url}: {e.read()[:500]!r}")
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, http.client.HTTPException, ValueError) as e:
            if i < tries - 1:
                time.sleep(delay)
                delay = min(delay * 2, 30)
                continue
            raise RuntimeError(f"network error {url}: {e}")


def dump(path, obj):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, sort_keys=True, separators=(",", ":"))
    os.replace(tmp, path)


def load(path):
    """Read a JSON file, or its gzipped twin `<path>.gz` when only that exists (raw pulls are gzipped to save disk)."""
    if not os.path.exists(path) and os.path.exists(path + ".gz"):
        import gzip
        with gzip.open(path + ".gz", "rt") as f:
            return json.load(f)
    with open(path) as f:
        return json.load(f)


def exists(path):
    return os.path.exists(path) or os.path.exists(path + ".gz")


def list_json(folder):
    """The logical paths (without .gz) of every *.json and *.json.gz in a folder, sorted."""
    names = set()
    if os.path.isdir(folder):
        for n in os.listdir(folder):
            if n.endswith(".json"):
                names.add(n)
            elif n.endswith(".json.gz"):
                names.add(n[:-3])
    return [os.path.join(folder, n) for n in sorted(names)]
