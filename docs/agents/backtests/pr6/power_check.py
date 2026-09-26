"""PR6 power check, from EVENT COUNTS ONLY.

Reads the extracted UK prints (trades/<SYM>.jsonl) and the UK hourly candles (candles/<SYM>_60.json) and reports, per book:
prints, traded minutes and quote volume per day; the size a fill in a traded minute would carry under the rule's cap,
min($100, 10 % of that minute's quote volume); and the tape's completeness against the candles' hourly volume.

It never conditions on a price relative to any quote or to par: a price enters only as the multiplier that turns a
print's quantity into dollars. It computes no fill, no position and no P&L. The upper bounds at the end are arithmetic
on those counts: every rung filled in the busiest minutes at its cap, and every exit a maker exit.
usage: power_check.py OUT.json
"""
import bisect, collections, datetime, json, math, os, statistics as st, sys

D = os.environ.get("PR6_DATA") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
M, H, DAY = 60000, 3600000, 86400000
BOOKS = ["USDC-USD", "USDT-USD"]
CAP_USD, SHARE = 100.0, 0.10
CAPITAL = 1200.0
BAR_PCT = 8.0


def ms(s):
    return int(datetime.datetime.fromisoformat(s).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)


def iso(t):
    return datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def month(t):
    return datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m")


def week(t):
    y, w, _ = datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).isocalendar()
    return f"{y}-W{w:02d}"


END = ms("2026-09-26T00:00")
PULL0 = ms("2025-09-26T00:00")
LAST3M = ms("2026-06-26T00:00")
LAST4W = ms("2026-08-29T00:00")


def load(sym):
    out = []
    for line in open(os.path.join(D, "trades", f"{sym}.jsonl")):
        r = json.loads(line)
        assert r["region"] == "UK"
        out.append((int(r["ts"]), float(r["qty"]) * float(r["price"]), float(r["qty"])))
    return out


def candles(sym):
    rows = json.load(open(os.path.join(D, "candles", f"{sym}_60.json")))["rows"]
    return {int(c["start"]): float(c["volume"]) for c in rows}


def minute_table(prints, t0, t1):
    """{minute_start: (prints, quote_usd)} for minutes in [t0, t1)."""
    mt = collections.defaultdict(lambda: [0, 0.0])
    for ts, q, _ in prints:
        if t0 <= ts < t1:
            m = ts - ts % M
            mt[m][0] += 1
            mt[m][1] += q
    return mt


def period_stats(prints, t0, t1):
    days = (t1 - t0) / DAY
    mt = minute_table(prints, t0, t1)
    n = sum(v[0] for v in mt.values())
    vol = sum(v[1] for v in mt.values())
    caps = sorted((min(CAP_USD, SHARE * v[1]) for v in mt.values()), reverse=True)
    T = len(caps)
    half = sum(caps[: math.ceil(T / 2)])
    per_day = collections.Counter()
    for ts, q, _ in prints:
        if t0 <= ts < t1:
            per_day[(ts - t0) // DAY] += 1
    daily = [per_day.get(i, 0) for i in range(int(round(days)))]
    return {
        "from": iso(t0), "to": iso(t1), "days": round(days, 3),
        "prints": n, "prints_per_day": round(n / days, 2),
        "prints_per_day_median": st.median(daily) if daily else None,
        "days_without_prints": sum(1 for x in daily if x == 0),
        "traded_minutes": T, "traded_minutes_per_day": round(T / days, 2),
        "quote_volume_usd": round(vol, 2), "quote_volume_usd_per_day": round(vol / days, 2),
        "cap_usd_mean": round(sum(caps) / T, 4) if T else None,
        "cap_usd_median": round(caps[T // 2], 4) if T else None,
        "minutes_at_full_100_cap": sum(1 for c in caps if c >= CAP_USD),
        "sum_caps_usd_per_day": round(sum(caps) / days, 2),
        "sum_caps_busiest_half_usd_per_day": round(half / days, 2),
        # six rungs of a book earn at most 1+2+3 ticks a side; a rung's entries alternate with its exits, so it enters in at
        # most ceil(T/2) minutes; its entry sizes sum to at most the busiest half's caps; a maker exit earns n ticks.
        "upper_bound_pnl_usd_per_day": round(12e-4 * half / days, 4),
    }


def completeness(prints, cand, t0, t1):
    """Hourly base volume from the prints (a print in a minute's first 1,000 ms counted in the minute before, as the
    candle builder measurably does: PR5) against the UK hourly candles' volume."""
    hv = collections.Counter()
    for ts, _, qty in prints:
        e = ts - 1000 if ts % M < 1000 else ts
        hv[e - e % H] += qty
    match = more = less = 0
    worst = []
    for h in range(t0 - t0 % H, t1, H):
        if h not in cand:
            continue
        a, b = hv.get(h, 0.0), cand[h]
        if abs(a - b) <= 1e-6 * max(1.0, b):
            match += 1
        elif a > b:
            more += 1
            worst.append((round(a - b, 5), iso(h)))
        else:
            less += 1
            worst.append((round(a - b, 5), iso(h)))
    worst.sort(key=lambda x: -abs(x[0]))
    return {"hours_compared": match + more + less, "match": match, "prints_more": more, "prints_less": less,
            "largest_differences_base_units": worst[:5],
            "print_volume_total": round(sum(v for k, v in hv.items() if t0 <= k < t1), 2),
            "candle_volume_total": round(sum(v for k, v in cand.items() if t0 <= k < t1), 2)}


def main():
    out = {"note": "event counts only; no price relative to any quote or to par was read; no fill, position or P&L",
           "capital_usd": CAPITAL, "bar_pct_per_year": BAR_PCT,
           "bar_usd_per_day": round(CAPITAL * BAR_PCT / 100 / 365, 4), "books": {}}
    for sym in BOOKS:
        pr = load(sym)
        cand = candles(sym)
        first_vol = min(k for k, v in cand.items() if v > 0)
        start = first_vol - first_vol % DAY + DAY          # the first UTC midnight after the first hour with candle volume
        B = {"first_print_pulled": iso(pr[0][0]) if pr else None, "last_print_pulled": iso(pr[-1][0]) if pr else None,
             "first_candle_hour_with_volume": iso(first_vol), "primary_start": iso(start)}
        B["pre_candle_tape"] = period_stats(pr, PULL0, first_vol)
        B["primary"] = period_stats(pr, start, END)
        B["last_three_months"] = period_stats(pr, LAST3M, END)
        B["last_four_weeks"] = period_stats(pr, LAST4W, END)
        months = sorted({month(t) for t in range(PULL0, END, DAY)})
        B["by_month"] = {}
        for mo in months:
            a = ms(mo + "-01T00:00")
            y, m_ = int(mo[:4]), int(mo[5:])
            b = ms(f"{y + (m_ == 12)}-{(m_ % 12) + 1:02d}-01T00:00")
            a, b = max(a, PULL0), min(b, END)
            B["by_month"][mo] = period_stats(pr, a, b)
        B["by_week_since_2026_07"] = {}
        wk0 = ms("2026-06-29T00:00")                        # a Monday
        for a in range(wk0, END, 7 * DAY):
            b = min(END, a + 7 * DAY)
            B["by_week_since_2026_07"][week(a)] = period_stats(pr, a, b)
        B["completeness_primary"] = completeness(pr, cand, start, END)
        B["completeness_pre_candle"] = completeness(pr, cand, PULL0, first_vol)
        out["books"][sym] = B
    # what the worth-money condition needs, pooled over both books: over the last three months (both books quote all of it,
    # $1,200 for 92 days) and over the primary window ($600 a book over that book's own primary days, PR5's capital-years)
    for key, per in (("worth_money_last_three_months", "last_three_months"), ("worth_money_primary_window", "primary")):
        L = [out["books"][s][per] for s in BOOKS]
        cap_years = sum(CAPITAL / 2 * x["days"] / 365 for x in L)
        need = BAR_PCT / 100 * cap_years
        T = sum(x["traded_minutes"] for x in L)
        cap_mean = sum(x["cap_usd_mean"] * x["traded_minutes"] for x in L) / T
        out[key] = {
            "days_by_book": [x["days"] for x in L], "capital_years_usd": round(cap_years, 2), "pnl_needed_usd": round(need, 2),
            "cap_usd_mean_pooled": round(cap_mean, 4),
            "round_trips_needed_at_mean_cap": {f"{n}_tick": round(need / (n * 1e-4 * cap_mean)) for n in (1, 2, 3)},
            "traded_minutes_both_books": T,
            "upper_bound_pnl_usd": round(sum(x["upper_bound_pnl_usd_per_day"] * x["days"] for x in L), 2),
        }
    json.dump(out, open(sys.argv[1], "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
