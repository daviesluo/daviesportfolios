"""Assemble VOL's committed input. The rule is vol_test.py; this file only fetches what the
pre-registration names and writes it. It prints counts, never a price against a model.

usage: vol_inputs.py <out .json.gz>
Reads and writes a cache under $PM_DATA/vol so a stopped pull resumes. Keyless.
"""
import gzip
import json
import math
import os
import re
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"
DATA = "https://data-api.polymarket.com"
BINANCE = "https://data-api.binance.vision"
DERIBIT = "https://www.deribit.com/api/v2/public/get_volatility_index_data"
SLUG = re.compile(r"^bitcoin-above-on-[a-z]+-\d{1,2}(-\d{4})?$")
STRIKE = re.compile(r"above \$([\d,]+)")
START = "2025-01-01T00:00:00Z"
END = "2026-09-11T00:00:00Z"


def cache_dir():
    d = os.path.join(pmnet.DATA, "vol")
    os.makedirs(d, exist_ok=True)
    return d


def ts_of(s):
    if not s:
        return None
    s = s.strip().replace(" ", "T")
    if s.endswith("+00"):
        s += ":00"
    s = s.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s).timestamp()
    except ValueError:
        return None


def deribit(start_ms, end_ms):
    # The public method takes a JSON-RPC body. pmnet.post sends JSON.
    d = pmnet.post(DERIBIT, {"jsonrpc": "2.0", "id": 1, "method": "public/get_volatility_index_data",
                             "params": {"currency": "BTC", "resolution": "3600", "start_timestamp": start_ms, "end_timestamp": end_ms}})
    if d.get("error"):
        raise RuntimeError(d["error"])
    return (d.get("result") or {}).get("data") or []


def load_dvol(td_min, td_max):
    path = os.path.join(cache_dir(), "dvol.json")
    have = pmnet.load(path) if os.path.exists(path) else []
    # Candles are [open_ms, o, h, l, c]. Keep an hourly map.
    by = {int(c[0]): float(c[4]) for c in have}
    # Pull any missing month. A candle is usable once its hour has closed.
    cursor = int(td_min - 7200) * 1000
    end_ms = int(td_max) * 1000
    while cursor < end_ms:
        chunk_end = min(cursor + 40 * 86400 * 1000, end_ms)
        # One candle on the boundary is not a cached chunk. Deribit's end is inclusive, so the
        # previous window's last hour sits on this cursor; skipping on that one candle dropped
        # every other 40-day window (found before any return was computed).
        have = sum(1 for t in by if cursor <= t < chunk_end)
        expect = max(1, int((chunk_end - cursor) / 3600000) - 1)
        if have >= expect * 0.9:
            cursor = chunk_end
            continue
        rows = deribit(cursor, chunk_end)
        for c in rows:
            by[int(c[0])] = float(c[4])
        cursor = chunk_end
        time.sleep(0.05)
    pmnet.dump(path, [[t, by[t]] for t in sorted(by)])
    return by


def dvol_at(by, td):
    """Close of the hourly candle whose hour has finished at or before td. `by` keys are open times in ms."""
    hour = int(td // 3600) * 3600
    # The candle that closed at `hour` opened at hour-3600.
    open_ms = (hour - 3600) * 1000
    v = by.get(open_ms)
    if v is None:
        return None
    return v / 100.0


def binance_klines(interval, start_ms, end_ms):
    return pmnet.get(BINANCE + "/api/v3/klines", {
        "symbol": "BTCUSDT", "interval": interval, "startTime": str(start_ms), "endTime": str(end_ms), "limit": "1000",
    })


def spot_at(td):
    """Close of the last 1-minute candle whose close time is <= td."""
    end_ms = int(td * 1000)
    start_ms = end_ms - 5 * 60 * 1000
    rows = binance_klines("1m", start_ms, end_ms)
    best = None
    for k in rows:
        close_time = int(k[6]) / 1000.0
        if close_time <= td + 0.001:
            best = float(k[4])
    return best


def rv_at(td):
    """Population stdev of the last 24 hourly log returns, annualised. None if a close is missing."""
    end_ms = int(td * 1000)
    start_ms = end_ms - 30 * 3600 * 1000
    rows = binance_klines("1h", start_ms, end_ms)
    closes = []
    for k in rows:
        close_time = int(k[6]) / 1000.0
        if close_time <= td + 0.001:
            closes.append(float(k[4]))
    closes = closes[-25:]
    if len(closes) < 25:
        return None
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(1, 25)]
    if any(not math.isfinite(x) or closes[i] <= 0 for i, x in enumerate(rets)):
        return None
    mu = sum(rets) / len(rets)
    var = sum((x - mu) ** 2 for x in rets) / len(rets)
    return math.sqrt(var) * math.sqrt(24.0 * 365.25)


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
    # One per UTC date: the lowest slug among those the rule names.
    picked = {}
    skipped = 0
    for e in out:
        slug = e.get("slug") or ""
        if not SLUG.match(slug):
            skipped += 1
            continue
        end = ts_of(e.get("endDate"))
        if end is None:
            skipped += 1
            continue
        day = datetime.fromtimestamp(end, timezone.utc).strftime("%Y-%m-%d")
        prev = picked.get(day)
        if prev is None or slug < prev["slug"]:
            picked[day] = {"slug": slug, "end": end}
    rows = [picked[k] for k in sorted(picked)]
    pmnet.dump(path, rows)
    print("events listed", len(out), "slug-skipped", skipped, "days", len(rows), flush=True)
    return rows


def event_markets(slug):
    d = pmnet.get(GAMMA + "/events", {"slug": slug})
    ev = d[0] if isinstance(d, list) else d
    return (ev or {}).get("markets") or []


def strike_of(q):
    m = STRIKE.search(q or "")
    if not m:
        return None
    return float(m.group(1).replace(",", ""))


def shown_yes(token, td):
    d = pmnet.get(CLOB + "/prices-history", {
        "market": token, "startTs": str(int(td - 1800)), "endTs": str(int(td)), "fidelity": "1",
    })
    hist = d.get("history") if isinstance(d, dict) else None
    best = None
    for pt in hist or []:
        t = float(pt.get("t"))
        if t <= td and (best is None or t >= best[0]):
            best = (t, float(pt.get("p")))
    if best is None or td - best[0] > 1800:
        return None
    return best[1]


def prints_of(cond, td):
    """Taker prints in (td, td+3600], oldest first.

    `/v2/trades` ignores a time bound and returns the newest prints, so the bound is the
    `/trades` parameters the pre-registration names. 'incomplete' if the page cap is hit
    while a full page is still arriving, which means the hour was not finished.
    """
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
                oi = r.get("outcome_index")
            if oi is None:
                continue
            out.append([ts, side, int(oi), float(r.get("price")), float(r.get("size"))])
        if len(rows) < 500:
            out.sort()
            return out
    return "incomplete"


def one(ev, dvol):
    path = os.path.join(cache_dir(), ev["slug"] + ".json")
    if os.path.exists(path):
        return pmnet.load(path)
    end = ev["end"]
    td = end - 16 * 3600
    rec = {"slug": ev["slug"], "end": end, "td": td, "skip": None}
    try:
        mkts = event_markets(ev["slug"])
        spot = spot_at(td)
        if spot is None:
            rec["skip"] = "no_spot"
            pmnet.dump(path, rec)
            return rec
        cands = []
        for m in mkts:
            k = strike_of(m.get("question") or "")
            if k is None:
                continue
            cands.append((abs(k - spot), k, m))
        if not cands:
            rec["skip"] = "no_strike"
            pmnet.dump(path, rec)
            return rec
        cands.sort(key=lambda c: (c[0], c[1], str(c[2].get("conditionId") or "")))
        m = cands[0][2]
        outs = json.loads(m.get("outcomes") or "[]")
        if outs != ["Yes", "No"]:
            rec["skip"] = "outcomes"
            pmnet.dump(path, rec)
            return rec
        toks = json.loads(m.get("clobTokenIds") or "[]")
        prices = json.loads(m.get("outcomePrices") or "[]")
        if len(toks) != 2 or len(prices) != 2:
            rec["skip"] = "tokens"
            pmnet.dump(path, rec)
            return rec
        sched = m.get("feeSchedule") or {}
        rate = sched.get("rate") if isinstance(sched, dict) else None
        try:
            rate = float(rate) if rate is not None else 0.07
        except (TypeError, ValueError):
            rate = 0.07
        if rate <= 0:
            rate = 0.07
        tick = m.get("orderPriceMinTickSize")
        try:
            tick = float(tick) if tick else 0.01
        except (TypeError, ValueError):
            tick = 0.01
        shown = shown_yes(toks[0], td)
        if shown is None:
            rec["skip"] = "no_shown"
            pmnet.dump(path, rec)
            return rec
        prints = prints_of(m.get("conditionId"), td)
        closed = ts_of(m.get("closedTime")) or end
        rec.update({
            "condition": m.get("conditionId"), "strike": cands[0][1], "strikes": [c[1] for c in cands],
            "spot": spot, "sigma_dvol": dvol_at(dvol, td), "sigma_rv": rv_at(td), "shown": shown,
            "tick": tick, "rate": rate, "payout_yes": float(prices[0]), "payout_no": float(prices[1]),
            "closed": closed, "prints": prints,
        })
    except Exception as e:  # a dead market is a skip, recorded, not a silent hole
        rec["skip"] = "error"
        rec["error"] = str(e)[:200]
    pmnet.dump(path, rec)
    return rec


def main():
    outp = sys.argv[1]
    events = list_events()
    if not events:
        raise SystemExit("no events")
    dvol = load_dvol(min(e["end"] for e in events) - 20 * 3600, max(e["end"] for e in events))
    rows, skips = [], {}
    for i, ev in enumerate(events):
        rec = one(ev, dvol)
        if rec.get("skip"):
            skips[rec["skip"]] = skips.get(rec["skip"], 0) + 1
        else:
            # The test checks the strike really is the closest. Drop the helper list's market objects;
            # keep the strike numbers.
            rows.append({k: rec[k] for k in (
                "slug", "end", "closed", "spot", "strike", "strikes", "sigma_dvol", "sigma_rv", "shown",
                "tick", "rate", "payout_yes", "payout_no", "prints")})
        if (i + 1) % 25 == 0:
            print("pulled", i + 1, "kept", len(rows), "skips", skips, flush=True)
    rows.sort(key=lambda r: (r["end"], r["slug"]))
    os.makedirs(os.path.dirname(outp) or ".", exist_ok=True)
    with gzip.open(outp, "wt") as f:
        json.dump({"events": rows, "skipped": skips, "listed_days": len(events)}, f, separators=(",", ":"))
    print("wrote", outp, "events", len(rows), "skips", skips, flush=True)


if __name__ == "__main__":
    main()
