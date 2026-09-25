"""Assemble POST's committed input. The rule is post_test.py.

Prints counts only: never a bracket price against its historical rate.
Keyless. Resumes from $PM_DATA/post.

usage: post_inputs.py <out.json.gz>
"""
import gzip
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402
import post_test  # noqa: E402

GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"
DATA = "https://data-api.polymarket.com"
SERIES = (10000, 11108)
START = "2024-01-01T00:00:00Z"
END = "2026-09-11T00:00:00Z"
T_END = datetime(2026, 9, 11, tzinfo=timezone.utc).timestamp()


def cache_dir():
    d = os.path.join(pmnet.DATA, "post")
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
    """Several events at once. The gaps are this pull's, set before any bracket is chosen.

    A 429 still backs off inside pmnet.get. The rows kept do not depend on the pace.
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
    rows = []
    seen = set()
    for series in SERIES:
        cursor = None
        while True:
            params = {"limit": 100, "closed": "true", "series_id": series, "end_date_min": START, "end_date_max": END}
            if cursor:
                params["after_cursor"] = cursor
            d = pmnet.get(GAMMA + "/events/keyset", params)
            batch = d.get("events") or []
            for e in batch:
                end = ts_of(e.get("endDate"))
                slug = e.get("slug")
                if end is None or end >= T_END or not slug or slug in seen:
                    continue
                seen.add(slug)
                rows.append({"slug": slug, "series": series, "end": end})
            cursor = d.get("next_cursor")
            if not cursor or not batch:
                break
    rows.sort(key=lambda r: (r["end"], r["slug"]))
    pmnet.dump(path, rows)
    print("events_listed", len(rows), flush=True)
    return rows


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


def prints_of(cond, t0, t1):
    out = []
    for page in range(6):
        d = pmnet.get(DATA + "/trades", {
            "market": cond, "limit": "500", "offset": str(page * 500), "takerOnly": "true",
            "start": str(int(t0) + 1), "end": str(int(t1)),
        })
        rows = d if isinstance(d, list) else (d.get("data") or [])
        for r in rows:
            ts = float(r.get("timestamp") or 0)
            if ts > 10_000_000_000:
                ts /= 1000.0
            if not (t0 < ts <= t1):
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


def rate_of(m):
    if not m.get("feesEnabled"):
        return 0.0
    sched = m.get("feeSchedule") or {}
    exponent = sched.get("exponent") if isinstance(sched, dict) else None
    if exponent not in (None, 1, 1.0):
        return None
    try:
        rate = float(sched.get("rate")) if isinstance(sched, dict) and sched.get("rate") is not None else 0.05
    except (TypeError, ValueError):
        rate = 0.05
    if rate < 0:
        rate = 0.05
    return rate


def one_structure(ev):
    path = os.path.join(cache_dir(), ev["slug"] + ".json")
    if os.path.exists(path):
        return pmnet.load(path)
    end = float(ev["end"])
    d = pmnet.get(GAMMA + "/events", {"slug": ev["slug"]})
    raw = d[0] if isinstance(d, list) else d
    start = ts_of((raw or {}).get("startDate"))
    title = (raw or {}).get("title") or ""
    days = post_test.duration_days(title, end) if start is not None else None
    td = None if start is None else start + post_test.OPEN_LAG
    tx = end - post_test.EXIT_BEFORE
    closed_ev = ts_of((raw or {}).get("closedTime")) or end
    markets = []
    tokens = {}
    for m in (raw or {}).get("markets") or []:
        try:
            outs = json.loads(m.get("outcomes") or "[]")
            prices = json.loads(m.get("outcomePrices") or "[]")
            toks = json.loads(m.get("clobTokenIds") or "[]")
        except (TypeError, ValueError):
            continue
        if outs != ["Yes", "No"] or len(prices) != 2 or len(toks) < 1:
            continue
        span = post_test.bucket_of(m.get("question") or "")
        if span is None:
            continue
        rate = rate_of(m)
        if rate is None:
            continue
        try:
            tick = float(m.get("orderPriceMinTickSize") or 0.001)
        except (TypeError, ValueError):
            tick = 0.001
        shown = shown_yes(toks[0], td) if td is not None else None
        shown_exit = shown_yes(toks[0], tx) if td is not None and tx > td else None
        cond = m.get("conditionId")
        tokens[cond] = toks[0]
        markets.append({
            "condition": cond, "lo": span[0], "hi": span[1], "shown": shown, "shown_exit": shown_exit,
            "tick": tick, "rate": rate, "payout_yes": float(prices[0]), "payout_no": float(prices[1]),
            "closed": ts_of(m.get("closedTime")) or closed_ev,
        })
    payload = {
        "slug": ev["slug"], "series": int(ev["series"]), "title": title, "days": days,
        "start": start, "end": end, "closed": closed_ev, "markets": markets,
        "winner_mid": post_test.winner_mid(markets), "tokens": tokens, "structure": True,
    }
    pmnet.dump(path, payload)
    return payload


def add_prints(row, priors):
    if row.get("prints_done"):
        return row
    path = os.path.join(cache_dir(), row["slug"] + ".json")
    chosen = post_test.choose(row, priors)
    if chosen is None:
        row["picked"] = None
    else:
        market, _frac = chosen
        td = post_test.decision_time(row)
        entry = prints_of(market["condition"], td, td + 3600)
        exit_prints = []
        tx = post_test.exit_time(row)
        shown_x = market.get("shown_exit")
        if tx > td and shown_x is not None and float(shown_x) > float(market["shown"]):
            exit_prints = prints_of(market["condition"], tx, tx + 3600)
        row["picked"] = {"condition": market["condition"], "prints": entry, "exit_prints": exit_prints}
    row["prints_done"] = True
    row.pop("tokens", None)
    pmnet.dump(path, row)
    return row


def main():
    outp = sys.argv[1]
    _share_pace()
    t0 = time.time()
    events = list_events()
    done = 0
    rows = []

    def fetch(ev):
        return one_structure(ev)

    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = [pool.submit(fetch, ev) for ev in events]
        for fut in as_completed(futs):
            rows.append(fut.result())
            done += 1
            if done % 25 == 0 or done == len(events):
                print("structure", done, "/", len(events), round(time.time() - t0, 1), flush=True)
    rows.sort(key=lambda r: (r["end"], r["slug"]))
    for row in rows:
        if row.get("prints_done"):
            continue
        priors = []
        td = None if row.get("start") is None else post_test.decision_time(row)
        if td is not None and row.get("days") is not None:
            for other in rows:
                if other.get("series") != row.get("series") or other.get("days") != row.get("days"):
                    continue
                if other.get("winner_mid") is None or float(other["end"]) > td:
                    continue
                priors.append(float(other["winner_mid"]))
        add_prints(row, priors)
    picked = 0
    incomplete = 0
    for r in rows:
        got = r.get("picked")
        if not got:
            continue
        picked += 1
        if got.get("prints") == "incomplete" or got.get("exit_prints") == "incomplete":
            incomplete += 1
    kept = []
    for r in rows:
        r.pop("tokens", None)
        kept.append(r)
    os.makedirs(os.path.dirname(os.path.abspath(outp)) or ".", exist_ok=True)
    with gzip.open(outp, "wt") as f:
        json.dump({"events": kept}, f, sort_keys=True, separators=(",", ":"))
    print("wrote", outp, "events", len(kept), "picked", picked, "incomplete", incomplete, round(time.time() - t0, 1), flush=True)


if __name__ == "__main__":
    main()
