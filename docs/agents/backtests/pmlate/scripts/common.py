"""PMLATE's shared helpers: keyless HTTP (Polymarket's public APIs, Iowa Environmental Mesonet, aviationweather.gov),
the temperature-market parser, stations and local days.

Public reads only: no key, no signed call, no order. The HTTP helper is fp4's `pmnet.py` (paced per host, retried on
429/5xx), imported from `../../polymarket/scripts/` unchanged, because fp4's results pin its hash. PMLATE_DATA names
the folder raw pulls go to (not committed; hashed in the pull manifest).

The data API and Gamma answer `cache-control: public, max-age=300` and CloudFront serves a repeated URL from its copy
(reference §4 item 36), so every data-API read here carries `_=<the read's own millisecond>`: a print list read for a
market is never a copy of an earlier read of the same URL.
"""
import json
import math
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "polymarket", "scripts"))
import pmnet  # noqa: E402

def _dump_gz(path, obj):
    """pmnet.dump, gzipped: writes `<path>.gz` (pmnet.load and pmnet.exists read the twin) and drops a plain copy."""
    import gzip
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    tmp = path + ".gz.tmp"
    with gzip.open(tmp, "wt") as f:
        json.dump(obj, f, sort_keys=True, separators=(",", ":"))
    os.replace(tmp, path + ".gz")
    if os.path.exists(path):
        os.remove(path)


pmnet.dump = _dump_gz
pmnet.MIN_GAP.setdefault("mesonet.agron.iastate.edu", 0.6)
pmnet.MIN_GAP.setdefault("aviationweather.gov", 0.4)
pmnet.UA = "pmlate-research/1.0 (public data only)"

DATA = os.environ.get("PMLATE_DATA", os.path.abspath("pmlate_data"))
GAMMA = "https://gamma-api.polymarket.com"
DATA_API = "https://data-api.polymarket.com"
CLOB = "https://clob.polymarket.com"
IEM = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"
AWC = "https://aviationweather.gov/api/data"

# ------------------------------------------------------------------------------------------------ the markets

Q = re.compile(r"(?P<hl>highest|lowest) temperature in (?P<city>.+?) (?:be )?(?:be )?(?:between |be tween )?"
               r"(?P<a>-?\d+(?:\.\d+)?)\s*(?:[-–]\s*(?P<b>-?\d+(?:\.\d+)?))?\s*°\s*(?P<u>[FC])"
               r"(?P<tail> or below| or lower| or higher| or above)?\s+on (?P<mon>[A-Z][a-z]+) (?P<day>\d+)", re.I)
WU = re.compile(r"wunderground\.com/history/daily/[^\s\"']*/([A-Z0-9]{4})\b")
NWS = re.compile(r"weather\.gov/wrh/timeseries\?(?:[^\s\"']*&)?site=([A-Za-z0-9]{4})\b")
MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                                      "september", "october", "november", "december"], 1)}
FALLBACK = {"nyc": "KLGA", "new york city": "KLGA", "london": "EGLC"}


def ts(s):
    """An ISO time from Gamma (several spellings) as Unix seconds, or None."""
    if not s:
        return None
    s = str(s).strip().replace(" ", "T")
    if s.endswith("+00"):
        s += ":00"
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def bucket(a, b, tail):
    """A bucket as whole-degree bounds [lo, hi] in the market's unit (None = open). "between 45-46°F" is [45, 46],
    "34°C" is [34, 34], "44°F or below" is [None, 44], "26°C or higher" is [26, None]. The resolution source reports
    whole degrees, so a whole-degree reading r is in the bucket when lo <= r <= hi."""
    a = int(round(float(a)))
    if b is not None:
        return [a, int(round(float(b)))]
    t = (tail or "").strip().lower()
    if t in ("or below", "or lower"):
        return [None, a]
    if t in ("or higher", "or above"):
        return [a, None]
    return [a, a]


def parse_market(m):
    """A Gamma market record → the fields PMLATE reads, or None when it is not a daily temperature bucket."""
    q = m.get("question") or ""
    mm = Q.search(q)
    if not mm:
        return None
    try:
        toks = json.loads(m.get("clobTokenIds") or "[]")
        op = [float(x) for x in json.loads(m.get("outcomePrices") or "[]")]
    except (ValueError, TypeError):
        return None
    if len(toks) != 2:
        return None
    end = ts(m.get("endDate"))
    if not end:
        return None
    ed = datetime.fromtimestamp(end, timezone.utc)
    mon = MONTHS.get(mm.group("mon").lower())
    if not mon:
        return None
    year = ed.year - 1 if (mon == 12 and ed.month == 1) else (ed.year + 1 if (mon == 1 and ed.month == 12) else ed.year)
    date = f"{year:04d}-{mon:02d}-{int(mm.group('day')):02d}"
    city = mm.group("city").strip()
    src = m.get("resolutionSource") or ""
    desc = m.get("description") or ""
    st = WU.search(src) or NWS.search(src) or WU.search(desc) or NWS.search(desc)
    station = st.group(1).upper() if st else ("HKO" if "hong kong" in city.lower() else FALLBACK.get(city.lower()))
    source = ("nws" if NWS.search(src) or (not src and NWS.search(desc)) else
              "wu" if WU.search(src) or WU.search(desc) else ("hko" if station == "HKO" else "none"))
    ev = (m.get("events") or [{}])[0]
    fs = m.get("feeSchedule") or {}
    return {
        "cond": m.get("conditionId"), "yes": str(toks[0]), "no": str(toks[1]), "q": q[:120],
        "city": city, "date": date, "hl": mm.group("hl").lower(), "unit": mm.group("u").upper(),
        "bucket": bucket(mm.group("a"), mm.group("b"), mm.group("tail")),
        "station": station, "source": source, "src_url": src[:200],
        "event": str(ev.get("id") or ""), "event_slug": ev.get("slug"),
        "end": end, "start": ts(m.get("startDate")) or ts(m.get("createdAt")), "closed_time": ts(m.get("closedTime")),
        "closed": bool(m.get("closed")),
        "payout_yes": op[0] if len(op) == 2 and m.get("closed") else None,
        "fee_rate": fs.get("rate") if m.get("feesEnabled") else 0.0, "fee_exp": fs.get("exponent"),
        "tick": m.get("orderPriceMinTickSize"), "neg_risk": bool(m.get("negRisk")), "vol": m.get("volumeNum"),
    }


# ------------------------------------------------------------------------------------------------ stations

def load_json(path):
    return pmnet.load(path)


def dump_json(path, obj):
    pmnet.dump(path, obj)


def iem_id(icao):
    """IEM's archive names US stations without the K (KLGA → LGA) and every other station by its ICAO code."""
    return icao[1:] if len(icao) == 4 and icao.startswith("K") else icao


def f_of_c(c):
    return c * 9.0 / 5.0 + 32.0


def round_half_up(x):
    """Round half away from zero, as a person reading a thermometer would (the sources' whole degrees)."""
    return int(math.floor(x + 0.5)) if x >= 0 else -int(math.floor(-x + 0.5))


# ------------------------------------------------------------------------------------------------ prints

def prints_of(cond, cache_dir=None, max_pages=60):
    """Every taker print of a market from the data API (`/v2/trades?condition=`), oldest first, as dicts with
    ts (Unix s), side, oi (outcome index, 0 = YES), price, size, and the taker's wallet. Cached per market under
    `cache_dir` when given (a closed market's prints do not change). Each page carries the read's own millisecond."""
    path = os.path.join(cache_dir, cond + ".json") if cache_dir else None
    if path and pmnet.exists(path):
        return pmnet.load(path)
    out, seen, cursor, complete = [], set(), "", False
    at = str(int(time.time() * 1000))
    for _ in range(max_pages):
        params = {"condition": cond, "limit": 1000, "_": at}
        if cursor:
            params["cursor"] = cursor
        d = pmnet.get(DATA_API + "/v2/trades", params)
        rows = (d or {}).get("data") or []
        for r in rows:
            key = (r.get("transaction_hash"), r.get("proxy_wallet"), str(r.get("token_id"))[-10:], r.get("side"),
                   r.get("price"), r.get("size"), r.get("timestamp"))
            if key in seen:
                continue
            seen.add(key)
            out.append({"ts": int(r.get("timestamp") or 0), "side": r.get("side"), "oi": r.get("outcome_index"),
                        "price": float(r.get("price") or 0), "size": float(r.get("size") or 0),
                        "wallet": r.get("proxy_wallet"), "tx": r.get("transaction_hash")})
        cursor = ((d or {}).get("pagination") or {}).get("next_cursor") or ""
        if not cursor or not rows:
            complete = True
            break
    out.sort(key=lambda p: (p["ts"], p["side"] or "", p["oi"] if p["oi"] is not None else -1, p["price"], p["size"]))
    res = {"cond": cond, "complete": complete, "prints": out}
    if path and complete:
        pmnet.dump(path, res)
    return res


def utc(ts_):
    return datetime.fromtimestamp(ts_, timezone.utc)


def iso(ts_):
    return utc(ts_).strftime("%Y-%m-%dT%H:%M:%SZ")
