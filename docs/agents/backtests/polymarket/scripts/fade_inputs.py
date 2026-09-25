"""Assemble FADE's committed input. The rule is fade_test.py.

Prints counts only: never an earlier price against the shown price.
Keyless. Resumes from $PM_DATA/fade.

usage: fade_inputs.py <out.json.gz>
"""
import gzip
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
import fade_test  # noqa: E402
import pmnet  # noqa: E402

GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"
DATA = "https://data-api.polymarket.com"
SLUG = re.compile(r"^bitcoin-above-on-[a-z]+-\d{1,2}(-\d{4})?$")
STRIKE = re.compile(r"above \$([\d,]+)")
START = "2025-01-01T00:00:00Z"
END = "2026-09-11T00:00:00Z"
LAG = 6 * 3600


def cache_dir():
    d = os.path.join(pmnet.DATA, "fade")
    os.makedirs(d, exist_ok=True)
    return d


def ts_of(s):
    if not s:
        return None
    s = str(s).strip().replace(" ", "T")
    if s.endswith("+00"):
        s = s[:-3] + "+00:00"
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(s).timestamp()
    except ValueError:
        return None


def _share_pace():
    """Several events at once. The gaps are this pull's, set before any fade is drawn.

    A 429 still backs off inside pmnet.get. The rows one() keeps do not depend on the pace.
    """
    pmnet.MIN_GAP["clob.polymarket.com"] = 0.04
    pmnet.MIN_GAP["data-api.polymarket.com"] = 0.04
    pmnet.MIN_GAP["gamma-api.polymarket.com"] = 0.08
    lock = threading.Lock()
    orig = pmnet._pace

    def paced(host):
        with lock:
            orig(host)

    pmnet._pace = paced


def list_events():
    path = os.path.join(cache_dir(), "events.json")
    if os.path.exists(path):
        return pmnet.load(path)
    out, cursor = [], None
    while True:
        params = {"limit": 100, "closed": "true", "series_id": 45, "end_date_min": START, "end_date_max": END}
        if cursor:
            params["after_cursor"] = cursor
        d = pmnet.get(GAMMA + "/events/keyset", params)
        out.extend(d.get("events") or [])
        cursor = d.get("next_cursor")
        if not cursor or not d.get("events"):
            break
    picked = {}
    for e in out:
        slug = e.get("slug") or ""
        if not SLUG.match(slug):
            continue
        end = ts_of(e.get("endDate"))
        if end is None:
            continue
        day = datetime.fromtimestamp(end, timezone.utc).strftime("%Y-%m-%d")
        prev = picked.get(day)
        if prev is None or slug < prev["slug"]:
            picked[day] = {"slug": slug, "end": end}
    rows = [picked[k] for k in sorted(picked)]
    pmnet.dump(path, rows)
    print("days", len(rows), flush=True)
    return rows


def strike_of(q):
    m = STRIKE.search(q or "")
    if not m:
        return None
    return float(m.group(1).replace(",", ""))


def shown_yes(token, t):
    d = pmnet.get(CLOB + "/prices-history", {
        "market": token, "startTs": str(int(t - 1800)), "endTs": str(int(t)), "fidelity": "1",
    })
    hist = d.get("history") if isinstance(d, dict) else None
    best = None
    for pt in hist or []:
        ts = float(pt.get("t"))
        if ts <= t and (best is None or ts >= best[0]):
            best = (ts, float(pt.get("p")))
    if best is None or t - best[0] > 1800:
        return None
    return best[1]


def prints_of(cond, td):
    out = []
    for page in range(6):
        d = pmnet.get(DATA + "/trades", {
            "market": cond, "limit": "500", "offset": str(page * 500), "takerOnly": "true",
            "start": str(int(td) + 1), "end": str(int(td + 3600)),
        })
        rows = d if isinstance(d, list) else (d.get("data") or [])
        for r in rows:
            ts = float(r.get("timestamp") or 0)
            if ts > 10_000_000_000:
                ts /= 1000.0
            if not (td < ts <= td + 3600):
                continue
            side = r.get("side")
            if side not in ("BUY", "SELL"):
                continue
            oi = r.get("outcomeIndex")
            if oi is None:
                continue
            try:
                out.append([ts, side, int(oi), float(r.get("price")), float(r.get("size"))])
            except (TypeError, ValueError):
                continue
        if len(rows) < 500:
            out.sort()
            return out
    return "incomplete"


def one(ev):
    path = os.path.join(cache_dir(), ev["slug"] + ".json")
    if os.path.exists(path):
        return pmnet.load(path)
    end = float(ev["end"])
    td = end - 16 * 3600
    te = td - LAG
    d = pmnet.get(GAMMA + "/events", {"slug": ev["slug"]})
    raw = d[0] if isinstance(d, list) else d
    markets = []
    tokens = {}
    closed_ev = ts_of((raw or {}).get("closedTime")) or end
    for m in (raw or {}).get("markets") or []:
        try:
            outs = json.loads(m.get("outcomes") or "[]")
            prices = json.loads(m.get("outcomePrices") or "[]")
            toks = json.loads(m.get("clobTokenIds") or "[]")
        except (TypeError, ValueError):
            continue
        if outs != ["Yes", "No"] or len(prices) != 2 or len(toks) < 1:
            continue
        strike = strike_of(m.get("question") or "")
        if strike is None:
            continue
        sched = m.get("feeSchedule") or {}
        try:
            rate = float(sched.get("rate")) if isinstance(sched, dict) and sched.get("rate") is not None else 0.07
        except (TypeError, ValueError):
            rate = 0.07
        if rate <= 0:
            rate = 0.07
        try:
            tick = float(m.get("orderPriceMinTickSize") or 0.01)
        except (TypeError, ValueError):
            tick = 0.01
        shown = shown_yes(toks[0], td)
        closed = ts_of(m.get("closedTime")) or closed_ev
        cond = m.get("conditionId")
        tokens[cond] = toks[0]
        markets.append({
            "condition": cond, "strike": strike, "shown": shown, "tick": tick, "rate": rate,
            "payout_yes": float(prices[0]), "payout_no": float(prices[1]), "closed": closed,
        })
    payload = {"slug": ev["slug"], "end": end, "closed": closed_ev, "markets": markets}
    chosen = fade_test.select_market(markets)
    if chosen is not None:
        payload["picked"] = {
            "condition": chosen["condition"],
            "earlier": shown_yes(tokens[chosen["condition"]], te),
            "prints": prints_of(chosen["condition"], td),
        }
    pmnet.dump(path, payload)
    return payload


def main():
    outp = sys.argv[1]
    _share_pace()
    t0 = time.time()
    events = list_events()
    done = 0
    rows = []

    def fetch(ev):
        return one(ev)

    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = [pool.submit(fetch, ev) for ev in events]
        for fut in as_completed(futs):
            rows.append(fut.result())
            done += 1
            if done % 25 == 0 or done == len(events):
                print("events", done, "/", len(events), round(time.time() - t0, 1), flush=True)
    rows.sort(key=lambda r: (r["end"], r["slug"]))
    picked = 0
    no_earlier = 0
    incomplete = 0
    for r in rows:
        got = r.get("picked")
        if not got:
            continue
        picked += 1
        if got.get("earlier") is None:
            no_earlier += 1
        if got.get("prints") == "incomplete":
            incomplete += 1
    os.makedirs(os.path.dirname(os.path.abspath(outp)) or ".", exist_ok=True)
    with gzip.open(outp, "wt") as f:
        json.dump({"events": rows}, f, sort_keys=True, separators=(",", ":"))
    print(
        "wrote", outp, "events", len(rows), "picked", picked,
        "no_earlier", no_earlier, "incomplete", incomplete, round(time.time() - t0, 1),
        flush=True,
    )


if __name__ == "__main__":
    main()
