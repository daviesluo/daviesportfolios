"""The reading of "Stablecoin quotes with Euros - 2" (docs/agents/reviews/2026-10-13-coinbase-weekend-prereg.md, section 3).

It does three things on one export of the window:
* bar 1 (faithful): PR5's frozen `pr5_sim.simulate`, through the base test's own replay (`../../cbpaper/scripts/replay.py`,
  imported read-only), replays the arm's minute record (`cb_hold_minutes`) and must reproduce the arm's round trips
  (`cb_hold_trips`) to within 5 % in number and 10 % in money over the four books;
* the base test on the same window, WITHOUT running anything else: the same minutes with every minute darkened whose rate bar
  started more than ten minutes before it (the base test's rule: `x` and `fair` null), replayed the same way. The arm and the base
  test decide on the same prints and the same rates; they differ only in the closure. Where the base test's own record
  (`cb_quote_trips`) covers the window it is compared with this replay and the gap reported, not used;
* the bars on the arm's own trips in pounds (2 to 4), and the comparison with the base arm, paired by weekend (bar 6): a
  weekend is a closure (the minutes the arm decided on a rate bar over ten minutes old) from its first minute to the Monday
  00:00 UTC after it, and a trip belongs to the weekend its ENTRY minute is in; only whole weekends count.
Money is pounds (each EUR book's at its pounds per euro when the trip closed, as the engine turns it), the replay's own money
being the book's currency, as in Deviation 1 of the base test's pre-registration.

Input, one JSON export of the window (the statements are in the pre-registration):
  {"start": ISO of cb_hold_state.state.startedAt, "minutes": [cb_hold_minutes rows from start to start + 28 d + 2 d],
   "trips": [cb_hold_trips rows entered in the window], "base_trips": [cb_quote_trips rows entered in the window] or [],
   "eur_gbp": EUR/GBP at the window's last minute that had both rates (x of USDC-EUR there), "twin_days": [{"day", "realisedGbp"}]
   of the twin "Stablecoin quotes" (the dashboard payload's quotesTwins[0].detail.days) and "twin_capital_gbp": 1200}
usage: python3 -I replay_wk.py EXPORT.json[.gz]   -> prints the reading as JSON
"""
import collections, datetime, gzip, json, os, random, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, "../../cbpaper/scripts")))
import replay as R  # noqa: E402  (the base test's replay: the frozen simulator, imported read-only, and its book readers)

M, DAY = 60000, 86400000
P = R.P
BASE_DARK_MS = 10 * M          # the base test's rule: a rate bar older than ten minutes is no bar
WINDOW_DAYS = 28
SEED = 20261113                # the bootstrap's, fixed with the pre-registration
CAPITAL = {"GBP": 1200.0, "EUR": 1200.0}


def ms(s):
    return R.ms(s)


def day_of(t):
    return datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")


def lit_rows(rows, base_rule):
    """Minute rows as replay.py reads them (X is 1 in the book's own money, None where dark). With `base_rule`, a minute whose
    GBP/USD bar (or, on a EUR book, EUR/USD bar) started over ten minutes before it is dark, as the base test decides it."""
    out = []
    for r in rows:
        r = dict(r)
        dark = r.get("x") in (None, "")
        if not dark and base_rule:
            t = ms(r["minute"])
            dark = t - ms(r["x_t"]) > BASE_DARK_MS or (r.get("eur_t") not in (None, "") and t - ms(r["eur_t"]) > BASE_DARK_MS)
        r["x"] = None if dark else 1
        if dark:
            r["fair"] = None
        out.append(r)
    return out


def pounds_per_unit(rows_orig, rows_rule):
    """For a book: minute (ms) -> its pounds per unit at that minute under the rule (the last lit minute's while dark)."""
    last, out = None, {}
    for o, r in zip(sorted(rows_orig, key=lambda z: ms(z["minute"])), sorted(rows_rule, key=lambda z: ms(z["minute"]))):
        if r["x"] == 1 and o.get("x") not in (None, ""):
            last = float(o["x"])
        out[ms(o["minute"])] = last
    return out


def replay_book(book, rows):
    tick, half = R.BOOK[book]
    saved = (P.TICK, P.FEE, P.HALF_SPREAD)
    P.TICK, P.FEE, P.HALF_SPREAD = tick, R.TAKER, half
    try:
        trips, _ = P.simulate(R.MinuteBook(book, rows, tick), size=100.0)
    finally:
        P.TICK, P.FEE, P.HALF_SPREAD = saved
    # The simulator closes what is still held at the end of the data; the engine still holds it: not a round trip yet.
    return [x for x in trips if not (x["how"] == "taker" and x["t_exit"] - x["t_entry"] < 1440 * M)]


def replay_all(rows_by_book, base_rule):
    """Every book replayed under the rule: its trips as {book, t_entry, t_exit, gbp}."""
    out = []
    for b, rows in sorted(rows_by_book.items()):
        rule = lit_rows(rows, base_rule)
        x = pounds_per_unit(rows, rule)
        for t in replay_book(b, rule):
            xg = x.get(t["t_exit"]) or x.get(max((k for k in x if k <= t["t_exit"]), default=None)) or 1.0
            out.append({"book": b, "t_entry": t["t_entry"], "t_exit": t["t_exit"], "gbp": t["pnl_usd"] * xg, "ccy": t["pnl_usd"]})
    return out


def within(a, b, f):
    return abs(a - b) <= f * max(abs(b), 1e-9)


def by_day(trips, start, end):
    days = collections.Counter()
    for t in trips:
        days[day_of(t["t_entry"])] += t["gbp"]
    return [days.get(day_of(d), 0.0) for d in range(start, end, DAY)]


def bootstrap(days):
    rng = random.Random(SEED)
    s = sorted(sum(rng.choice(days) for _ in range(len(days))) for _ in range(2000))
    return s[100]


def closures(rows_by_book, start, end):
    """The closures of the window: runs of minutes the arm decided on a rate bar over ten minutes old (any book), a gap of
    15 minutes or less joining two. Each is [first minute, the Monday 00:00 UTC after its last], whole when it lies inside."""
    held = sorted({ms(r["minute"]) for rows in rows_by_book.values() for r in rows
                   if r.get("x") not in (None, "") and ms(r["minute"]) - ms(r["x_t"]) > BASE_DARK_MS})
    runs = []
    for t in held:
        if runs and t - runs[-1][1] <= 15 * M:
            runs[-1][1] = t
        else:
            runs.append([t, t])
    out = []
    for a, z in runs:
        d = datetime.datetime.fromtimestamp(z / 1000, datetime.timezone.utc)
        monday = int((datetime.datetime(d.year, d.month, d.day, tzinfo=datetime.timezone.utc) + datetime.timedelta(days=(7 - d.weekday()) % 7 or 7)).timestamp() * 1000)
        out.append({"from": a, "to": monday, "whole": a > start and monday <= end})
    return out


def main(path):
    d = json.load(gzip.open(path, "rt") if path.endswith(".gz") else open(path))
    start = ms(d["start"]) if isinstance(d["start"], str) else int(d["start"])
    end = start + WINDOW_DAYS * DAY
    rows = collections.defaultdict(list)
    for r in d["minutes"] or []:
        if ms(r["minute"]) >= start:
            rows[r["book"]].append(r)
    eng = [t for t in d["trips"] or [] if start <= ms(t["t_entry"]) < end]
    in_win = lambda t: start <= t["t_entry"] < end

    # Bar 1: the arm's replay against the arm's own trips, book by book and in all (money in each book's currency).
    arm_replay = [t for t in replay_all(rows, False) if in_win(t)]
    books = {}
    for b in sorted(rows):
        e = [t for t in eng if t["book"] == b]
        r = [t for t in arm_replay if t["book"] == b]
        ccy = sum(float(t["pnl_gbp"]) * float(t["qty"]) * float(t["entry"]) / float(t["notional_gbp"]) for t in e)
        books[b] = {"engine_trips": len(e), "replay_trips": len(r), "engine_ccy": round(ccy, 4), "replay_ccy": round(sum(t["ccy"] for t in r), 4)}
    tot = {k: sum(v[k] for v in books.values()) for k in ("engine_trips", "replay_trips", "engine_ccy", "replay_ccy")}
    bar1 = {"books": books, "all": {k: round(v, 4) for k, v in tot.items()},
            "trips_within_5pct": within(tot["replay_trips"], tot["engine_trips"], 0.05), "pnl_within_10pct": within(tot["replay_ccy"], tot["engine_ccy"], 0.10)}

    # The arm's trips in pounds (the engine's), and the base test on the same window (the darkened replay).
    arm = [{"book": t["book"], "t_entry": ms(t["t_entry"]), "gbp": float(t["pnl_gbp"])} for t in eng]
    base = [t for t in replay_all(rows, True) if in_win(t)]
    base_engine = [t for t in d.get("base_trips") or [] if start <= ms(t["t_entry"]) < end]
    base_check = None
    if base_engine:
        # Only while the base test's own record covers the window; the days it covers are those with a trip of its own.
        upto = max(ms(t["t_entry"]) for t in base_engine)
        rb = [t for t in base if t["t_entry"] <= upto]
        base_check = {"through": datetime.datetime.fromtimestamp(upto / 1000, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
                      "engine_trips": len(base_engine), "replay_trips": len(rb), "engine_gbp": round(sum(float(t["pnl_gbp"]) for t in base_engine), 4), "replay_gbp": round(sum(t["gbp"] for t in rb), 4)}

    # Bars 2 to 4, on the arm's own trips.
    realised = sum(t["gbp"] for t in arm)
    days = by_day(arm, start, end)
    eur_gbp = float(d["eur_gbp"])
    capital = CAPITAL["GBP"] + CAPITAL["EUR"] * eur_gbp
    annual = realised * 365 / WINDOW_DAYS
    twin = None
    if d.get("twin_days") is not None:
        lo, hi = day_of(start), day_of(end - DAY)
        tr = sum(float(x["realisedGbp"]) for x in d["twin_days"] if lo <= str(x["day"])[:10] <= hi)
        twin = {"realised_gbp": round(tr, 4), "pct_per_year": round(100 * tr * 365 / WINDOW_DAYS / float(d.get("twin_capital_gbp", 1200)), 4)}
    pct = 100 * annual / capital
    boot = bootstrap(days)
    bars = {
        "bar2_positive": {"realised_gbp": round(realised, 4), "bootstrap_index100_gbp": round(boot, 4), "passes": realised > 0 and boot > 0},
        "bar3_enough": {"capital_gbp": round(capital, 2), "pct_per_year": round(pct, 4), "passes": pct >= 6.0},
        "bar4_not_one_day": {"best_day_share": round(max(days) / realised, 4) if realised > 0 else None, "passes": realised > 0 and max(days) / realised <= 0.40},
        "bar5_against_revolut_x": None if twin is None else {"twin": twin, "arm_pct_per_year": round(pct, 4), "passes": pct >= 0.5 * twin["pct_per_year"]},
    }

    # Bar 6: the base arm on the same window, paired by weekend.
    weekends = []
    for c in closures(rows, start, end):
        a = sum(t["gbp"] for t in arm if c["from"] <= t["t_entry"] < c["to"])
        b = sum(t["gbp"] for t in base if c["from"] <= t["t_entry"] < c["to"])
        weekends.append({"from": datetime.datetime.fromtimestamp(c["from"] / 1000, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "whole": c["whole"],
                         "arm_gbp": round(a, 4), "base_gbp": round(b, 4), "difference_gbp": round(a - b, 4)})
    whole = [w for w in weekends if w["whole"]]
    base_realised = sum(t["gbp"] for t in base)
    need = len(whole) - 1 if len(whole) >= 3 else len(whole)
    bar6 = {"arm_realised_gbp": round(realised, 4), "base_realised_gbp": round(base_realised, 4), "weekends": weekends,
            "whole_weekends": len(whole), "weekends_positive": sum(1 for w in whole if w["difference_gbp"] > 0), "sum_difference_gbp": round(sum(w["difference_gbp"] for w in whole), 4),
            "passes": bool(whole) and realised > base_realised and sum(1 for w in whole if w["difference_gbp"] > 0) >= need and sum(w["difference_gbp"] for w in whole) > 0}
    print(json.dumps({"window": {"from": day_of(start), "to": day_of(end), "days": WINDOW_DAYS}, "bar1_faithful": bar1, **bars, "bar6_against_the_base_arm": bar6, "base_arm_check": base_check}, indent=1, sort_keys=True))


if __name__ == "__main__":
    main(sys.argv[1])
