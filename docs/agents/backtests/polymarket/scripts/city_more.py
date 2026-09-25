"""Shared checks for eight fp5 temperature rules.

The rule is still the caller's choose(). This file does not score a book and
does not read a price file. YDAY, CLIM, JUMP and HOT stay in their own files.
"""
from datetime import datetime, timedelta

import city_hold as city
import post_test as post

MIN_PEERS = 3


def add_days(date, n):
    return (datetime.fromisoformat(date) + timedelta(days=n)).date().isoformat()


def mids(priors):
    out = []
    for prior in priors:
        mid = city.mid_of(city.winner_market(prior))
        if mid is not None:
            out.append(mid)
    return out


def mean(xs):
    ys = [float(x) for x in xs]
    return sum(ys) / float(len(ys))


def hit(values, market):
    if not values:
        return 0.0
    return sum(1 for x in values if city.contains_iv(market["iv"], x)) / float(len(values))


def buy(market, fair):
    if market is None or market.get("p") is None or fair is None:
        return None
    tick = float(market.get("tick") or 0.01)
    if post.edge(float(fair), float(market["p"]) + tick, city.FEE) <= 0:
        return None
    return market, float(fair)


def last_prior(priors, ev):
    if not priors:
        return None
    prev = priors[-1]
    if city.days_between(prev["date"], ev["date"]) > city.MAX_LAG_DAYS:
        return None
    return prev


def linked(priors):
    out = []
    for left, right in zip(priors, priors[1:]):
        if city.days_between(left["date"], right["date"]) <= city.MAX_LAG_DAYS:
            out.append((left, right))
    return out


def deltas(priors):
    out = []
    for left, right in linked(priors):
        a = city.mid_of(city.winner_market(left))
        b = city.mid_of(city.winner_market(right))
        if a is None or b is None:
            continue
        out.append(b - a)
    return out


def indexes(events):
    """Latest resolved midpoint by day, and the low of a city on a date."""
    by_day = {}
    lows = {}
    for ev in events or []:
        won = city.winner_market(ev)
        mid = city.mid_of(won) if won else None
        if mid is None or won.get("closed") is None or not ev.get("date"):
            continue
        closed = float(won["closed"])
        ident = str(ev.get("event"))
        day_key = (ev["date"], ev.get("hl"), ev.get("unit"))
        bucket = by_day.setdefault(day_key, {})
        cur = bucket.get(ev.get("city"))
        if cur is None or ident < cur[0]:
            bucket[ev.get("city")] = (ident, closed, mid)
        if ev.get("hl") == "lowest":
            low_key = (ev.get("city"), ev.get("unit"), ev["date"])
            prev = lows.get(low_key)
            if prev is None or ident < prev[0]:
                lows[low_key] = (ident, closed, mid)
    return {"by_day": by_day, "lows": lows}


def peer_mids(ev, idx):
    """Latest resolved midpoint of each other city, same kind and unit, within three days."""
    td = ev.get("td")
    if td is None or not ev.get("date"):
        return []
    td = float(td)
    found = {}
    for lag in range(1, city.MAX_LAG_DAYS + 1):
        day = add_days(ev["date"], -lag)
        bucket = idx["by_day"].get((day, ev.get("hl"), ev.get("unit"))) or {}
        for city_name, (_ident, closed, mid) in bucket.items():
            if city_name == ev.get("city") or city_name in found or closed > td:
                continue
            found[city_name] = mid
    return list(found.values())


def low_mid(city_name, unit, date, idx, td):
    rec = idx["lows"].get((city_name, unit, date))
    if rec is None or rec[1] > float(td):
        return None
    return rec[2]


def recent_low(ev, idx):
    td = ev.get("td")
    if td is None or not ev.get("date"):
        return None
    for lag in range(1, city.MAX_LAG_DAYS + 1):
        mid = low_mid(ev.get("city"), ev.get("unit"), add_days(ev["date"], -lag), idx, td)
        if mid is not None:
            return mid
    return None


def iv_for(mid):
    return [mid - 1, mid + 1]


def prior(date, mid, city_name="Ex", hl="highest", unit="C"):
    closed = city.date_ts(date) + 20 * 3600
    return {
        "event": "%s|%s|%s" % (city_name, hl, date),
        "city": city_name, "hl": hl, "unit": unit, "date": date,
        "td": city.date_ts(date) - 12 * 3600,
        "prints_pulled": True, "prints_complete": True,
        "markets": [{
            "cond": "w", "iv": iv_for(mid), "payout_yes": 1.0, "p": 0.99, "tick": 0.01,
            "start": city.date_ts(date) - 86400, "closed": closed, "prints": [],
        }],
    }


def live(date, buckets, city_name="Ex", hl="highest", unit="C", event="t"):
    td = city.date_ts(date) - 12 * 3600
    closed = td + 86400
    markets = []
    for b in buckets:
        prints = []
        if b.get("print_px") is not None:
            prints = [[td + 10, "BUY", 0, float(b["print_px"]), 500.0]]
        markets.append({
            "cond": b["cond"], "iv": [b["lo"], b["hi"]], "payout_yes": b.get("payout", 0.0),
            "p": b["shown"], "tick": 0.01, "start": td - 86400, "closed": closed, "prints": prints,
        })
    return {
        "event": event, "city": city_name, "hl": hl, "unit": unit, "date": date, "td": td,
        "prints_pulled": True, "prints_complete": True, "markets": markets,
    }


def assert_fill(trades, lo, hi, px, pin):
    if len(trades) != 1:
        raise SystemExit("count %s" % [(t["slug"], t["lo"], t["hi"]) for t in trades])
    trade = trades[0]
    if trade["lo"] != lo or trade["hi"] != hi:
        raise SystemExit("bucket %s %s" % (trade["lo"], trade["hi"]))
    if abs(trade["fills"][0][1] - px) > 1e-9:
        raise SystemExit("px %s" % trade["fills"][0][1])
    sh = 10.0 / px
    hand = sh * (1.0 - px) - post.fee(0.05, px) * sh
    if abs(post.pnl_of(trade) - hand) > 1e-6 or abs(round(hand, 6) - pin) > 1e-9:
        raise SystemExit("pnl %s != %s pin %s" % (post.pnl_of(trade), hand, pin))
    print("self-check ok", round(hand, 6))
