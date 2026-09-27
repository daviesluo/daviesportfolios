"""HARVEST's shared helpers: after a market's result is confirmed by a public source, what the other side of the book
still pays, per category, in two modes (taking the losing side's resting orders; resting a bid on the confirmed
winner for late takers).

Public reads only: no key, no signed call, no order. The HTTP helper is fp4's `pmnet.py` through PMLATE's
`common.py` (paced per host, retried on 429/5xx, gzip dumps), imported unchanged because committed results pin their
hashes. HARVEST_DATA names the folder raw pulls go to (not committed; hashed in MANIFEST.json).

Every data-API and Gamma read carries `_=<the read's own millisecond>`: both are cached by CloudFront for five
minutes (reference §4 item 36), so a read is never a copy of an earlier read of the same URL.

The history rule of this study: no print of a market-day that ended on or after 2026-09-25 00:00 UTC is requested,
and no print of a held-out market-day (split.py) is requested at all. `walk_prints` refuses a market whose close is
at or after the frozen cut.
"""
import gzip
import json
import os
import sys
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "pmlate", "scripts"))
import common as P  # noqa: E402  PMLATE's helpers (pmnet, ts, iso, the gzip dump)

pmnet = P.pmnet
pmnet.UA = "harvest-research/1.0 (public data only)"
pmnet.MIN_GAP.setdefault("earthquake.usgs.gov", 0.3)
pmnet.MIN_GAP.setdefault("site.api.espn.com", 0.3)
pmnet.MIN_GAP.setdefault("xtracker.polymarket.com", 0.5)
DATA = os.environ.get("HARVEST_DATA", os.path.abspath("harvest_data"))
GAMMA = P.GAMMA
DATA_API = P.DATA_API
CLOB = P.CLOB
ts = P.ts
iso = P.iso
CUT = datetime(2026, 9, 25, tzinfo=timezone.utc).timestamp()   # nothing on or after this instant is read
ROOT = os.path.normpath(os.path.join(HERE, ".."))
INPUTS = os.path.join(ROOT, "inputs")
RESULTS = os.path.join(ROOT, "results")


def bust():
    return str(int(time.time() * 1000))


def load(path):
    return pmnet.load(path)


def dump(path, obj):
    pmnet.dump(path, obj)


def exists(path):
    return pmnet.exists(path)


def jfile(path):
    """A JSON file, plain or gzipped."""
    if path.endswith(".gz"):
        with gzip.open(path, "rt") as f:
            return json.load(f)
    with open(path) as f:
        return json.load(f)


def write_json(path, obj, gz=False):
    """Deterministic JSON (sorted keys, fixed separators); gzip with mtime 0 so a re-run is byte-identical."""
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    text = json.dumps(obj, sort_keys=True, indent=None if gz else 1, separators=(",", ":") if gz else (",", ": "))
    if gz:
        with open(path, "wb") as raw:
            with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as f:
                f.write(text.encode())
    else:
        with open(path, "w") as f:
            f.write(text + "\n")


def jload(s, default):
    try:
        return json.loads(s) if isinstance(s, str) else (s if s is not None else default)
    except (ValueError, TypeError):
        return default


def utc(t):
    return datetime.fromtimestamp(t, timezone.utc)


def day(t):
    return utc(t).strftime("%Y-%m-%d")


# ------------------------------------------------------------------------------------------------ fees

def fee_per_share(m, p):
    """The taker's fee per share at price p from the market's own schedule: rate × (p(1 − p))^exponent; zero where the
    market charged none. Makers pay nothing ("Makers are never charged fees", reference §2d)."""
    if not m.get("fees"):
        return 0.0
    r, e = m["fee_rate"] or 0.0, m.get("fee_exp") or 1
    return r * (p * (1.0 - p)) ** e


def rebate_per_share(m, p):
    """A maker's rebate per share filled at p: the schedule's rebate rate × the fee-equivalent (paid daily from a pool,
    above $1; an upper bound, reported apart and never counted in a total)."""
    if not m.get("fees"):
        return 0.0
    return (m.get("rebate") or 0.0) * fee_per_share(m, p)


# ------------------------------------------------------------------------------------------------ gamma

def compact_market(m):
    fs = m.get("feeSchedule") or {}
    toks = jload(m.get("clobTokenIds"), [])
    return {
        "cond": m.get("conditionId"), "id": str(m.get("id")), "q": (m.get("question") or "")[:300],
        "title": m.get("groupItemTitle"), "slug": m.get("slug"),
        "outcomes": jload(m.get("outcomes"), []), "prices": jload(m.get("outcomePrices"), []),
        "tokens": [str(t) for t in toks],
        "closed": bool(m.get("closed")), "closed_time": ts(m.get("closedTime")), "end": ts(m.get("endDate")),
        "start": ts(m.get("startDate")), "created": ts(m.get("createdAt")),
        "game_start": ts(m.get("gameStartTime")),
        "fees": bool(m.get("feesEnabled")), "fee_type": m.get("feeType"),
        "fee_rate": fs.get("rate") if m.get("feesEnabled") else 0.0, "fee_exp": fs.get("exponent"),
        "rebate": fs.get("rebateRate"),
        "tick": m.get("orderPriceMinTickSize"), "min_size": m.get("orderMinSize"),
        "vol": m.get("volumeNum") or 0.0, "neg_risk_other": bool(m.get("negRiskOther")),
        "uma": jload(m.get("umaResolutionStatuses"), []), "uma_status": m.get("umaResolutionStatus"),
        "auto": bool(m.get("automaticallyResolved")), "resolved_by": m.get("resolvedBy"),
        "desc": (m.get("description") or "")[:6000],
    }


def compact_event(ev):
    mk = [compact_market(m) for m in ev.get("markets") or []]
    ed = (ev.get("description") or "")[:6000]
    for m in mk:  # the market's description is the event's on most events: keep it once
        if m["desc"] == ed:
            m["desc"] = None
    return {
        "event": str(ev.get("id")), "slug": ev.get("slug"), "title": ev.get("title"),
        "tags": sorted({str(t.get("id")) for t in ev.get("tags") or []}),
        "tag_labels": sorted({t.get("label") or "" for t in ev.get("tags") or []}),
        "series": [s.get("slug") for s in ev.get("series") or []], "series_slug": ev.get("seriesSlug"),
        "start": ts(ev.get("startDate")), "end": ts(ev.get("endDate")), "closed_time": ts(ev.get("closedTime")),
        "created": ts(ev.get("createdAt")), "closed": bool(ev.get("closed")), "volume": float(ev.get("volume") or 0),
        "neg_risk": bool(ev.get("negRisk")), "res_source": (ev.get("resolutionSource") or "")[:300],
        "desc": ed, "markets": mk,
    }


def winner_index(m):
    """The index of the outcome that paid 1, or None when the market did not resolve to one outcome (50-50, open)."""
    p = [float(x) for x in m.get("prices") or []]
    if len(p) != 2 or not m.get("closed"):
        return None
    if p[0] >= 0.999 and p[1] <= 0.001:
        return 0
    if p[1] >= 0.999 and p[0] <= 0.001:
        return 1
    return None


# ------------------------------------------------------------------------------------------------ prints

def walk_prints(cond, floor, cache_dir, max_pages=300, closed_time=None):
    """Every taker print of one market from the data API (`/v2/trades?condition=`, taker rows, newest first), walked
    back to `floor` (Unix s). Rows are [ts, side (0 BUY / 1 SELL), outcome index, price, size, taker wallet tail (10
    hex), tx tail (10 hex)], oldest first, the same fill seen on two pages kept once. Cached per market.

    Refuses a market whose close is at or after the frozen cut (2026-09-25 00:00 UTC), or unknown."""
    if closed_time is None or closed_time >= CUT:
        raise ValueError(f"refused: {cond} closes {closed_time}, not before the frozen cut")
    path = os.path.join(cache_dir, cond + ".json")
    if exists(path):
        return load(path)
    rows, cursor, pages, complete = [], None, 0, False
    at = bust()
    while pages < max_pages:
        params = {"condition": cond, "limit": 1000, "_": at}
        if cursor:
            params["cursor"] = cursor
        d = pmnet.get(DATA_API + "/v2/trades", params)
        data = (d or {}).get("data") or []
        pages += 1
        for r in data:
            t = int(r.get("timestamp") or 0)
            if t >= floor:
                rows.append((t, 0 if r.get("side") == "BUY" else 1, r.get("outcome_index"),
                             round(float(r.get("price") or 0), 6), round(float(r.get("size") or 0), 6),
                             str(r.get("proxy_wallet") or "")[-10:], str(r.get("transaction_hash") or "")[-10:]))
        cursor = ((d or {}).get("pagination") or {}).get("next_cursor")
        if not cursor or not data or int(data[-1].get("timestamp") or 0) < floor:
            complete = True
            break
    uniq = sorted(set(rows))
    out = {"cond": cond, "floor": floor, "pages": pages, "complete": complete, "rows": [list(r) for r in uniq]}
    dump(path, out)
    return out
