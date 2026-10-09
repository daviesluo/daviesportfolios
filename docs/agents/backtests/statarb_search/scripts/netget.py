"""Keyless GET with retries; every source here is a public market-data endpoint (no key, no signed call)."""
import json, time, urllib.request, urllib.error

UA = "daviesportfolios-research/1.0 (public market data)"


def get(url, tries=5, timeout=60, ua=UA, data=None, headers=None):
    h = {"User-Agent": ua}
    h.update(headers or {})
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers=h, data=data)
            with urllib.request.urlopen(req, timeout=timeout) as f:
                return 200, f.read()
        except urllib.error.HTTPError as e:
            if e.code in (400, 403, 404, 451):
                return e.code, e.read()
            time.sleep(2 * (a + 1))
        except Exception:
            time.sleep(2 * (a + 1))
    return -1, b""


def get_json(url, **kw):
    st, body = get(url, **kw)
    try:
        return st, json.loads(body)
    except Exception:
        return st, None
