"""Keyless HTTP GET for the PMSTATARB verification pulls.

Public reads only. No key, no signed call, no order, no POST. Every request
is paced per host and retried on 429/5xx. Raw pulls go under $PM_DATA
(default /tmp/pmstatarb-data), which is not committed.
"""
import http.client
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

DATA = os.environ.get("PM_DATA", "/tmp/pmstatarb-data")
UA = "pmstatarb-research/1.0 (public data only)"
_LAST = {}
# One host at a time, and a gap wide enough that a pull does not pin the box.
# 2026-10-14: two pulls at once took the load to ~100.
MIN_GAP = {
    "gamma-api.polymarket.com": 0.50,
    "clob.polymarket.com": 0.50,
    "data-api.polymarket.com": 0.50,
    "api.binance.com": 0.60,
    "data-api.binance.vision": 0.60,
    "api.elections.kalshi.com": 0.60,
}


def _pace(host):
    gap = MIN_GAP.get(host, 0.25)
    now = time.monotonic()
    wait = gap - (now - _LAST.get(host, 0.0))
    if wait > 0:
        time.sleep(wait)
    _LAST[host] = time.monotonic()


def get_text(url, params=None, tries=6, timeout=60):
    """GET a documentation page as text. Same pacing and retries as get()."""
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params, doseq=True)
    host = urllib.parse.urlparse(url).netloc
    delay = 1.0
    for i in range(tries):
        _pace(host)
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/plain, text/markdown, */*"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
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
            raise RuntimeError(f"HTTP {e.code} {url}: {e.read()[:300]!r}")
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError,
                http.client.HTTPException) as e:
            if i < tries - 1:
                time.sleep(delay)
                delay = min(delay * 2, 30)
                continue
            raise RuntimeError(f"network error {url}: {e}")


def get(url, params=None, tries=12, timeout=60):
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params, doseq=True)
    host = urllib.parse.urlparse(url).netloc
    delay = 3.0
    for i in range(tries):
        _pace(host)
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            # 403 is Cloudflare's anti-bot page. The same URL does not start
            # working on a retry. Do not change the User-Agent, the IP, or the
            # request to get past it. The caller stops and records the gap.
            if e.code == 403:
                body = b""
                try:
                    body = e.read()[:300]
                except OSError:
                    pass
                raise RuntimeError(f"HTTP {e.code} {url}: {body!r}")
            if e.code in (429, 500, 502, 503, 504) and i < tries - 1:
                try:
                    e.read()
                except OSError:
                    pass
                ra = e.headers.get("Retry-After")
                try:
                    wait = float(ra) if ra else delay
                except ValueError:
                    wait = delay
                time.sleep(min(wait, 120))
                delay = min(delay * 2, 60)
                print(f"retry {i + 1} {host} HTTP {e.code}", flush=True)
                continue
            body = b""
            try:
                body = e.read()[:300]
            except OSError:
                pass
            raise RuntimeError(f"HTTP {e.code} {url}: {body!r}")
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError,
                http.client.HTTPException, ValueError) as e:
            if i < tries - 1:
                time.sleep(delay)
                delay = min(delay * 2, 60)
                print(f"retry {i + 1} {host} {e}", flush=True)
                continue
            raise RuntimeError(f"network error {url}: {e}")
