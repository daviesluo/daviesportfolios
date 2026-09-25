"""Assemble COPY's committed input. The rule is copy_test.py.

Prints counts only: never a wallet's P&L. Keyless. Resumes from $PM_DATA/copy.

usage: copy_inputs.py <out.json.gz>
"""
import gzip
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402
import copy_test as rule  # noqa: E402

GAMMA = "https://gamma-api.polymarket.com"
DATA = "https://data-api.polymarket.com"
TRADE_CAP = 60
CLOSED_CAP = 40
USER_CAP = 80


def cache_dir():
    d = os.path.join(pmnet.DATA, "copy")
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
    from datetime import datetime
    try:
        return datetime.fromisoformat(s).timestamp()
    except ValueError:
        return None


def as_list(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        return payload.get("data") or []
    return []


def stamp(value):
    ts = float(value or 0)
    if ts > 10_000_000_000:
        ts /= 1000.0
    return ts


def pages(params, cap, limit):
    """Offset pages. Returns (rows, incomplete). A repeated page is incomplete."""
    rows, seen = [], set()
    incomplete = False
    for page in range(cap):
        q = dict(params)
        q["limit"] = str(limit)
        q["offset"] = str(page * limit)
        batch = as_list(pmnet.get(DATA + "/trades", q))
        if not batch:
            break
        key = (batch[0].get("transactionHash"), batch[0].get("timestamp"), batch[0].get("proxyWallet"))
        if key in seen:
            incomplete = True
            break
        seen.add(key)
        rows.extend(batch)
        if len(batch) < limit:
            break
    else:
        incomplete = True
    return rows, incomplete


def list_events():
    path = os.path.join(cache_dir(), "may_events.json")
    if os.path.exists(path):
        return pmnet.load(path)
    out, cursor = [], None
    while True:
        params = {
            "limit": 100, "closed": "true", "series_id": 45,
            "end_date_min": "2026-05-01T00:00:00Z", "end_date_max": "2026-06-01T00:00:00Z",
        }
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
        if not rule.event_ok(slug):
            continue
        end = ts_of(e.get("endDate"))
        if end is None:
            continue
        day = int(end // 86400)
        prev = picked.get(day)
        if prev is None or slug < prev["slug"]:
            picked[day] = {"slug": slug, "end": end}
    rows = [picked[k] for k in sorted(picked)]
    pmnet.dump(path, rows)
    print("may events", len(rows), flush=True)
    return rows


def event_markets(slug):
    path = os.path.join(cache_dir(), "ev_" + slug + ".json")
    if os.path.exists(path):
        return pmnet.load(path)
    d = pmnet.get(GAMMA + "/events", {"slug": slug})
    ev = d[0] if isinstance(d, list) else d
    mkts = []
    for m in (ev or {}).get("markets") or []:
        try:
            outs = json.loads(m.get("outcomes") or "[]")
            prices = json.loads(m.get("outcomePrices") or "[]")
        except (TypeError, ValueError):
            continue
        if outs != ["Yes", "No"] or len(prices) != 2:
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
        end = ts_of(m.get("endDate"))
        closed = ts_of(m.get("closedTime")) or end
        mkts.append({
            "condition": m.get("conditionId"), "eventSlug": slug, "end": end, "closed": closed,
            "tick": tick, "rate": rate, "payouts": [float(prices[0]), float(prices[1])],
            "outcomes": ["Yes", "No"],
        })
    pmnet.dump(path, mkts)
    return mkts


def print_row(r):
    wallet = r.get("proxyWallet")
    if not wallet or r.get("side") not in ("BUY", "SELL"):
        return None
    oi = r.get("outcomeIndex")
    if oi is None:
        return None
    try:
        return [
            stamp(r.get("timestamp")), r.get("side"), int(oi), float(r.get("price")),
            float(r.get("size")), str(wallet).lower(), str(r.get("transactionHash") or ""),
        ]
    except (TypeError, ValueError):
        return None


def may_market(meta):
    cond = meta["condition"]
    path = os.path.join(cache_dir(), "may_" + cond + ".json")
    if os.path.exists(path):
        return pmnet.load(path)
    end = float(meta["end"])
    start = max(rule.MAY_START, end - 8 * 86400)
    stop = min(rule.CUT, end)
    raw, incomplete = pages({
        "market": cond, "start": str(int(start)), "end": str(int(stop)), "takerOnly": "true",
    }, TRADE_CAP, 500)
    rows = []
    for r in raw:
        p = print_row(r)
        if p is None:
            continue
        if rule.MAY_START <= p[0] < rule.CUT and p[0] < end:
            rows.append(p)
    rec = {"incomplete": incomplete, "n": len(rows), "prints": rows}
    pmnet.dump(path, rec)
    return rec


def closed_positions(wallet):
    path = os.path.join(cache_dir(), "closed_" + wallet + ".json")
    if os.path.exists(path):
        return pmnet.load(path)
    kept, seen = [], set()
    incomplete = False
    for page in range(CLOSED_CAP):
        batch = as_list(pmnet.get(DATA + "/closed-positions", {
            "user": wallet, "limit": "50", "offset": str(page * 50),
        }))
        if not batch:
            break
        key = (batch[0].get("conditionId"), batch[0].get("timestamp"), batch[0].get("outcomeIndex"))
        if key in seen:
            incomplete = True
            break
        seen.add(key)
        for r in batch:
            ts = stamp(r.get("timestamp"))
            slug = r.get("eventSlug")
            if ts >= rule.CUT or not rule.event_ok(slug):
                continue
            try:
                pnl = float(r.get("realizedPnl"))
            except (TypeError, ValueError):
                continue
            kept.append({"eventSlug": slug, "timestamp": ts, "realizedPnl": pnl})
        if len(batch) < 50:
            break
    else:
        incomplete = True
    rec = {"incomplete": incomplete, "rows": kept}
    pmnet.dump(path, rec)
    return rec


def user_buys(wallet):
    path = os.path.join(cache_dir(), "buys_" + wallet + ".json")
    if os.path.exists(path):
        return pmnet.load(path)
    raw, incomplete = pages({
        "user": wallet, "start": str(rule.CUT), "end": str(rule.OOS_END), "takerOnly": "true",
    }, USER_CAP, 500)
    buys = []
    for r in raw:
        p = print_row(r)
        if p is None or p[1] != "BUY":
            continue
        slug = r.get("eventSlug")
        if not rule.event_ok(slug):
            continue
        if not (rule.CUT <= p[0] < rule.OOS_END):
            continue
        buys.append({
            "wallet": wallet, "condition": r.get("conditionId"), "eventSlug": slug,
            "side": "BUY", "ts": p[0], "price": p[3], "outcomeIndex": p[2], "tx": p[6],
        })
    rec = {"incomplete": incomplete, "buys": buys}
    pmnet.dump(path, rec)
    return rec


def tape_for(cond, meta, start, stop):
    path = os.path.join(cache_dir(), "tape_" + cond + ".json")
    if os.path.exists(path):
        return pmnet.load(path)
    raw, incomplete = pages({
        "market": cond, "start": str(int(start)), "end": str(int(stop) + 1), "takerOnly": "true",
    }, TRADE_CAP, 500)
    prints = []
    for r in raw:
        p = print_row(r)
        if p is not None and start <= p[0] <= stop:
            prints.append(p)
    rec = dict(meta)
    rec["prints"] = prints
    rec["incomplete"] = incomplete or meta.get("end") is None
    pmnet.dump(path, rec)
    return rec


def main():
    outp = sys.argv[1]
    t0 = time.time()
    events = list_events()
    may_counts = {}
    may_incomplete = []
    for i, ev in enumerate(events):
        mkts = event_markets(ev["slug"])
        for meta in mkts:
            rec = may_market(meta)
            if rec["incomplete"]:
                may_incomplete.append(meta["condition"])
                continue
            for p in rec["prints"]:
                w = p[5]
                if w in rule.EXCLUDED:
                    continue
                may_counts[w] = may_counts.get(w, 0) + 1
        if i % 5 == 4:
            print("may", i + 1, "/", len(events), "wallets", len(may_counts), round(time.time() - t0, 1), flush=True)
    candidates = sorted(w for w, n in may_counts.items() if n >= rule.MIN_PRINTS)
    print("candidates", len(candidates), "incomplete markets", len(may_incomplete), flush=True)
    closed, closed_incomplete = {}, []
    for i, w in enumerate(candidates):
        rec = closed_positions(w)
        if rec["incomplete"]:
            closed_incomplete.append(w)
        else:
            closed[w] = rec["rows"]
        if i % 25 == 24:
            print("closed", i + 1, "/", len(candidates), flush=True)
    leaders = rule.rank_wallets(may_counts, closed, closed_incomplete)
    names = [w for _, w, _ in leaders]
    print("leaders", len(names), flush=True)
    buys, buys_incomplete = [], []
    need = {}
    for w in names:
        rec = user_buys(w)
        if rec["incomplete"]:
            buys_incomplete.append(w)
        buys.extend(rec["buys"])
        for b in rec["buys"]:
            need.setdefault(b["condition"], []).append(b)
    tapes = {}
    for cond, bs in need.items():
        slug = bs[0]["eventSlug"]
        mkts = {m["condition"]: m for m in event_markets(slug)}
        meta = mkts.get(cond)
        if meta is None:
            tapes[cond] = {"incomplete": True, "prints": [], "outcomes": [], "end": None, "closed": None,
                           "tick": 0.01, "rate": 0.07, "payouts": [0.0, 0.0]}
            continue
        start = min(b["ts"] for b in bs)
        stop = min(float(meta["end"]), max(b["ts"] for b in bs) + rule.LAG)
        tapes[cond] = tape_for(cond, meta, start, stop)
    payload = {
        "may_counts": may_counts,
        "may_incomplete": may_incomplete,
        "closed": closed,
        "closed_incomplete": closed_incomplete,
        "leaders_pulled": names,
        "buys": buys,
        "buys_incomplete": buys_incomplete,
        "tapes": tapes,
    }
    os.makedirs(os.path.dirname(os.path.abspath(outp)) or ".", exist_ok=True)
    with gzip.open(outp, "wt") as f:
        json.dump(payload, f, sort_keys=True, separators=(",", ":"))
    print("wrote", outp, "buys", len(buys), "tapes", len(tapes), round(time.time() - t0, 1), flush=True)


if __name__ == "__main__":
    main()
