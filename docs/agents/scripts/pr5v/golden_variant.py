"""PR5v's golden windows: what `pr5v_sim.simulate` does at the pre-registered settings, for the paper engine to replay.

"Stablecoin quotes - variant" runs forward as `supabase/functions/agents/quotes_variant.ts`, a replay of PR5's stored
minutes through the variant's rule. `quotes_variant.test.ts` replays these windows with that engine and must reproduce
the reference trip for trip, and each key's POSTs day by day and one by one. Both arms run on every window at the
settings the pre-registration names (the imports and the configuration are `ref_timing.py`'s, at PR5's own minute):

  main  nine rungs a side (0.03 ... 0.30 %), a 0.03 % re-price, the shared cap, four keys governed at 600 / 700 POSTs
  top5  the same with k = 0.05, 0.075, 0.10, 0.125, 0.15 %

Each window carries what the engine reads in production and nothing else: every print of each book in the window with
its id, the last print before it (the seed), and for every minute the X and fairU the turn at its start reads
(`agent_quote_minutes` holds exactly these). The prints are in the engine's order, by time and then by id compared as a
string, code point by code point (`printOrder`): a third of them share their millisecond, and under the shared cap the
order decides which quote a print fills. The reference's own order is checked to be that one before anything is run.
Both arms start flat at the window's first minute with every key's count at zero, as the engine does at its start.

The reference closes whatever is still open at its last step. So each window is simulated one minute longer than it is
replayed: the trips that close inside the window are compared field for field; a position still open at the window's
end (closed at the extra step, as a maker at its first print or by the forced close) is compared as open, as entered;
and a POST at the extra step is not counted.

    python3 docs/agents/scripts/pr5v/golden_variant.py docs/agents/backtests/pr5v/golden_variant.json
"""
import collections, datetime, gzip, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import study as S  # noqa: E402
import ref_timing as RT  # noqa: E402

V = S.V
P = V.P
M, DAY = V.M, V.DAY
BOOKS = S.BOOKS
ARMS = {"main": RT.NINE, "top5": RT.TOP5}

# (name, inputs, from, to, what it covers). "N" is the committed tape with Exness GBP/USD (the study's 28 days), "F" the
# fresh keyless pull with Yahoo's GBP/USD, the paper engine's own source (`inputs/pr5v_2026-09-28`).
WINDOWS = [
    ("tight", "N", "2026-08-31T00:00", "2026-09-02T00:00",
     "the tightened market, two weekdays on Exness GBP/USD; no key reaches 600 POSTs"),
    ("governor", "N", "2026-09-02T00:00", "2026-09-04T00:00",
     "keys reach 600 on both days: entries withdrawn, exits still re-priced, every count back to zero at 00:00 UTC"),
    ("stops", "N", "2026-09-04T00:00", "2026-09-06T00:00",
     "a busy Friday, then 24-hour stops on the Saturday, while GBP/USD is dark"),
    ("fresh", "F", "2026-09-23T00:00", "2026-09-25T00:00",
     "the fresh days on Yahoo's GBP/USD, as the paper engine reads it: the governor binds both days, and a stop"),
]


def cfg(rungs):
    """The pre-registration's §2, at PR5's own minute (`study.REF`)."""
    return V.default_cfg(rungs=rungs, reprice=0.0003, size=100.0, vol_share=0.10, cap="shared", exit_share=False,
                         gov=RT.GOV, acct=RT.ACCT4, **S.REF)


def uk_rows(span):
    """Each book's UK print rows, with their ids, as the span's reference markets were built from them: the committed tape,
    and for the fresh span the fresh pull merged into it by id (`study.fresh_markets`)."""
    out = {}
    for bk in BOOKS:
        rows = {}
        for line in gzip.open(os.path.join(P.S, "trades", bk + ".jsonl.gz"), "rt"):
            r = json.loads(line)
            rows[r["id"]] = r
        if span == "F":
            for r in json.load(gzip.open(os.path.join(S.FRESH_DIR, f"prints_{bk}.json.gz"), "rt"))["rows"]:
                rows[r["id"]] = r
        out[bk] = sorted((r for r in rows.values() if r["region"] == "UK"), key=lambda r: (r["ts"], r["id"]))
    return out


def ids_in_engine_order(mk, rows):
    """The ids of the reference's prints, after checking that its order IS the engine's: by time, then by id (Python
    compares strings code point by code point, as the engine's `<` does)."""
    tup = [(r["ts"], round(float(r["price"]) / P.TICK), float(r["qty"]), r["side"]) for r in rows]
    assert tup == mk.prints, "the reference's prints are in (ts, id) order"
    return [r["id"] for r in rows]


def iso(t):
    return datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")


def window(name, span, a, b, what, markets, ids):
    t0, t1 = P.ms(a), P.ms(b)
    mk = markets[span]
    n = (t1 - t0) // M
    minutes = [t0 + i * M for i in range(n)]
    xs = [mk[BOOKS[0]].X(t, 0) for t in minutes]
    books = {}
    for bk in BOOKS:
        m = mk[bk]
        assert [m.X(t, 0) for t in minutes] == xs, "one GBP/USD series for both books"
        k0 = V.bisect.bisect_left(m.pts, t0)
        k1 = V.bisect.bisect_left(m.pts, t1)
        seed = list(m.prints[k0 - 1]) + [ids[span][bk][k0 - 1]] if k0 > 0 else None
        books[bk] = {"seed_print": seed,
                     "prints": [list(p) + [ids[span][bk][k]] for k, p in enumerate(m.prints[k0:k1], start=k0)],
                     "fair_u": [m.fairU(t) for t in minutes]}
    arms = {}
    for arm, rungs in ARMS.items():
        r = V.simulate([mk[bk] for bk in BOOKS], cfg(rungs), t0, t1 + M)
        assert all(p[6] for p in r["posts"]), "every POST sent (no stale fill at this timing)"
        per_book = {}
        for bk in BOOKS:
            mine = [x for x in r["trips"] if x["book"] == bk]
            inside = [x for x in mine if x["t_exit"] < t1]
            open_end = [x for x in mine if x["t_entry"] < t1 <= x["t_exit"]]
            assert all(x["t_exit"] == t1 for x in open_end)
            assert len(inside) + len(open_end) == len([x for x in mine if x["t_entry"] < t1])
            posts = [[(p[0] - t0) // M, p[4], p[3], p[5]] for p in r["posts"] if p[0] < t1 and p[1] == BOOKS.index(bk)]
            per_book[bk] = {
                "trips": [{k: x[k] for k in ("side", "k", "t_entry", "fill_ts", "t_exit", "exit_ts", "how", "entry", "exit",
                                             "notional_usd", "pnl_usd")} for x in inside],
                "open_at_end": sorted(({"side": x["side"], "k": x["k"], "t_entry": x["t_entry"], "entry": x["entry"],
                                        "fill_ts": x["fill_ts"]} for x in open_end), key=lambda z: (z["side"], z["k"])),
                "posts": posts,
            }
        by = collections.Counter()
        for p in r["posts"]:
            if p[0] < t1:
                by[f"{p[2]}|{p[0] // DAY}"] += 1
        per_day = collections.defaultdict(dict)
        for key, c in sorted(by.items()):
            acct, day = key.split("|")
            per_day[acct][day] = c
        arms[arm] = {"books": per_book, "posts_by_key_day": per_day}
        bound = sorted(f"{acct} {iso(int(d) * DAY)[:10]}" for acct, ds in per_day.items() for d, c in ds.items() if c >= 600)
        print(f"{name} {arm}: {sum(len(v['trips']) for v in per_book.values())} trips, "
              f"{sum(len(v['open_at_end']) for v in per_book.values())} open at the end, "
              f"{sum(1 for v in per_book.values() for x in v['trips'] if x['how'] == 'taker')} stops, "
              f"{sum(len(v['posts']) for v in per_book.values())} POSTs; 600 reached: {bound or 'none'}", flush=True)
    return {"name": name, "what": what, "inputs": span, "t0": t0, "t1": t1, "x": xs, "books": books, "arms": arms}


def main():
    committed = V.committed_markets()
    fresh, _ = S.fresh_markets()
    markets = {"N": committed, "F": fresh}
    ids = {}
    for span in markets:
        rows = uk_rows(span)
        ids[span] = {bk: ids_in_engine_order(markets[span][bk], rows[bk]) for bk in BOOKS}
    out = {
        "what": "pr5v_sim.simulate at the PR5V pre-registration's settings, PR5's own minute; replayed by quotes_variant.test.ts",
        "inputs": {f: S.sha(os.path.join(HERE, f)) for f in ("golden_variant.py", "ref_timing.py", "study.py", "pr5v_sim.py")},
        "settings": {"arms": {a: r for a, r in ARMS.items()}, "reprice": 0.0003, "size_usd": 100.0, "vol_share": 0.10,
                     "cap": "shared", "exit_share": False, "governor": RT.GOV, "keys": "book/side of the rung",
                     "timing": S.REF},
        "fields": {"prints": "[ts, price ticks, quantity, aggressor, id], by ts then id (code-point order)",
                   "x": "GBP/USD each minute's turn reads, null dark",
                   "fair_u": "the USD book's median each minute's turn reads", "posts": "[minute index, rung side, kind, k]"},
        "windows": [window(*w, markets, ids) for w in WINDOWS],
    }
    with open(sys.argv[1], "w") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")
    print("wrote", sys.argv[1], os.path.getsize(sys.argv[1]), "bytes")


if __name__ == "__main__":
    main()
