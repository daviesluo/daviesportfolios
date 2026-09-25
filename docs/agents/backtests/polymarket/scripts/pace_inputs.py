"""Assemble PACE's committed input. The rule is pace_test.py.

Stores tracker timestamps, never post text, and never a count against a price.
Keyless. Resumes from $PM_DATA/pace.

usage: pace_inputs.py <out.json.gz>
"""
import gzip
import json
import os
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
import pace_test  # noqa: E402
import pmnet  # noqa: E402
import post_inputs  # noqa: E402
import post_test  # noqa: E402

TRACKER = "https://xtracker.polymarket.com"
GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"
START = "2024-01-01T00:00:00Z"
END = "2026-09-11T00:00:00Z"
T_END = datetime(2026, 9, 11, tzinfo=timezone.utc).timestamp()
CAP = 5000


def cache_dir():
    d = os.path.join(pmnet.DATA, "pace")
    os.makedirs(d, exist_ok=True)
    return d


def iso(ts):
    return datetime.fromtimestamp(float(ts), timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def tracker_times(series, start, end):
    handle, platform = pace_test.HANDLES[int(series)]
    d = pmnet.get(TRACKER + "/api/users/%s/posts" % handle, {
        "platform": platform, "startDate": iso(start), "endDate": iso(end),
    })
    rows = d.get("data") if isinstance(d, dict) else None
    if not isinstance(rows, list):
        raise RuntimeError("tracker shape")
    if len(rows) >= CAP:
        return "incomplete"
    out = []
    for r in rows:
        created = post_inputs.ts_of(r.get("createdAt"))
        imported = post_inputs.ts_of(r.get("importedAt"))
        if created is None or imported is None:
            continue
        out.append([created, imported])
    out.sort()
    return out


def one(ev):
    path = os.path.join(cache_dir(), ev["slug"] + ".json")
    if os.path.exists(path):
        return pmnet.load(path)
    end = float(ev["end"])
    d = pmnet.get(GAMMA + "/events", {"slug": ev["slug"]})
    raw = d[0] if isinstance(d, list) else d
    start = post_inputs.ts_of((raw or {}).get("startDate"))
    title = (raw or {}).get("title") or ""
    days = post_test.duration_days(title, end) if start is not None else None
    closed_ev = post_inputs.ts_of((raw or {}).get("closedTime")) or end
    cut = end - pace_test.REMAINING
    w0 = None if days is None else end - int(days) * 86400
    times = []
    if days is not None and w0 is not None and cut > w0:
        times = tracker_times(ev["series"], w0, end)
    markets = []
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
        rate = post_inputs.rate_of(m)
        if rate is None:
            continue
        try:
            tick = float(m.get("orderPriceMinTickSize") or 0.001)
        except (TypeError, ValueError):
            tick = 0.001
        shown = post_inputs.shown_yes(toks[0], cut) if days is not None and cut > (w0 or cut) else None
        markets.append({
            "condition": m.get("conditionId"), "lo": span[0], "hi": span[1], "shown": shown,
            "tick": tick, "rate": rate, "payout_yes": float(prices[0]), "payout_no": float(prices[1]),
            "closed": post_inputs.ts_of(m.get("closedTime")) or closed_ev,
        })
    so_far = None
    if isinstance(times, list) and days is not None:
        so_far, _final = pace_test.so_far_and_final(times, w0, cut, end)
    payload = {
        "slug": ev["slug"], "series": int(ev["series"]), "days": days, "start": start, "end": end,
        "closed": closed_ev, "markets": markets, "times": times, "so_far": so_far,
    }
    pmnet.dump(path, payload)
    return payload


def main():
    outp = sys.argv[1]
    post_inputs._share_pace()
    pmnet.MIN_GAP["xtracker.polymarket.com"] = 0.05
    t0 = time.time()
    # The event list is the same public keyset POST uses. Cached separately.
    list_path = os.path.join(cache_dir(), "events.json")
    if os.path.exists(list_path):
        events = pmnet.load(list_path)
    else:
        events = []
        seen = set()
        for series in (10000, 11108):
            cursor = None
            while True:
                params = {"limit": 100, "closed": "true", "series_id": series, "end_date_min": START, "end_date_max": END}
                if cursor:
                    params["after_cursor"] = cursor
                d = pmnet.get(GAMMA + "/events/keyset", params)
                batch = d.get("events") or []
                for e in batch:
                    end = post_inputs.ts_of(e.get("endDate"))
                    slug = e.get("slug")
                    if end is None or end >= T_END or not slug or slug in seen:
                        continue
                    seen.add(slug)
                    events.append({"slug": slug, "series": series, "end": end})
                cursor = d.get("next_cursor")
                if not cursor or not batch:
                    break
        events.sort(key=lambda r: (r["end"], r["slug"]))
        pmnet.dump(list_path, events)
        print("events_listed", len(events), flush=True)
    rows = []
    for i, ev in enumerate(events, start=1):
        rows.append(one(ev))
        if i % 25 == 0 or i == len(events):
            print("events", i, "/", len(events), round(time.time() - t0, 1), flush=True)
    rows.sort(key=lambda r: (float(r["end"]), r["slug"]))
    picked = 0
    incomplete = 0
    for row in rows:
        if row.get("times") == "incomplete" or row.get("days") is None:
            row["picked"] = None
            if row.get("times") == "incomplete":
                incomplete += 1
            continue
        priors = pace_test._priors_for(row, rows)
        so_far, _final, _rem = pace_test.derived(row)
        row["so_far"] = so_far
        chosen = pace_test.choose(row, priors)
        if chosen is None:
            row["picked"] = None
            continue
        market, _fair = chosen
        cut = pace_test.pace_time(row)
        path = os.path.join(cache_dir(), row["slug"] + ".prints.json")
        if os.path.exists(path):
            prints = pmnet.load(path)
        else:
            prints = post_inputs.prints_of(market["condition"], cut, cut + 3600)
            pmnet.dump(path, prints)
        row["picked"] = {"condition": market["condition"], "prints": prints}
        picked += 1
        if prints == "incomplete":
            incomplete += 1
    os.makedirs(os.path.dirname(os.path.abspath(outp)) or ".", exist_ok=True)
    with gzip.open(outp, "wt") as f:
        json.dump({"events": rows}, f, sort_keys=True, separators=(",", ":"))
    print("wrote", outp, "events", len(rows), "picked", picked, "incomplete", incomplete, round(time.time() - t0, 1), flush=True)


if __name__ == "__main__":
    main()
