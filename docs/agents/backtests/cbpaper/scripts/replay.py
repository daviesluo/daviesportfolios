"""The Coinbase paper test's faithfulness check (pre-registration §3, bar 1): PR5's frozen `pr5_sim.simulate`, imported
read-only, replayed on the engine's own record of the window — each decided minute's X, fair and bar (`cb_quote_minutes`,
0112) — must give the engine's own round trips (`cb_quote_trips`): trips within 5 % and P&L within 10 %, book by book and
in all.

A minute row is all the simulator reads of a minute (SCQ-VENUES' bars.py, proven equal to the prints): its bar's four
side extremes and its last print become at most five prints, its volume the minute's, its X and fair the book's. The
simulator prices on the book's own step (`P.TICK`: 0.0001, USDT-EUR 0.00001), sizes in pounds at £100 a rung (X is the
pound value of the book's currency, so a GBP book's is 1), and stops at Coinbase's taker fee plus half the touch, as
`agents/cb_quotes.ts` does.

Input: a JSON export of the window, `{"minutes": [cb_quote_minutes rows], "trips": [cb_quote_trips rows]}`, as
`select json_build_object('minutes', (select json_agg(m order by book, minute) from cb_quote_minutes m where minute >= A
and minute < B), 'trips', (select json_agg(t) from cb_quote_trips t where t_entry >= A and t_entry < B))` returns it.
usage: python3 -I replay.py EXPORT.json   -> prints the comparison as JSON
"""
import collections, datetime, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, "../../../scripts/pr5")))
import pr5_sim as P  # noqa: E402  (the frozen simulator, imported read-only)

M = 60000
TAKER = 0.000045
BOOK = {"USDC-GBP": (1e-4, 0.0000662), "USDT-GBP": (1e-4, 0.0000662), "USDC-EUR": (1e-4, 0.000056), "USDT-EUR": (1e-5, 0.0000112)}


def ms(s):
    return int(datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp() * 1000)


class MinuteBook:
    """The fields `simulate` reads, from the engine's minute rows of one book."""

    def __init__(self, book, rows, tick):
        rows = sorted(rows, key=lambda r: ms(r["minute"]))
        self.book, self.t0 = book, ms(rows[0]["minute"])
        self.n = (ms(rows[-1]["minute"]) - self.t0) // M + 1
        self.X, self.F = [None] * self.n, [None] * self.n
        self.by_min, self.qvol, self.all_prints = {}, {}, []
        for r in rows:
            i = (ms(r["minute"]) - self.t0) // M
            x = r.get("x")
            self.X[i] = float(x) if x not in (None, "") else None
            self.F[i] = float(r["fair"]) if r.get("fair") not in (None, "") else None
            if int(r["prints_n"]) == 0:
                continue
            t = ms(r["minute"])
            tk = lambda p: round(float(p) / tick, 6)
            ps = [(t, tk(r[c]), 0.0, side) for c, side in (("sell_lo", "sell"), ("buy_lo", "buy"), ("sell_hi", "sell"), ("buy_hi", "buy")) if r.get(c) not in (None, "")]
            ps.append((t, tk(r["last"]), 0.0, r["last_side"]))
            self.by_min[i] = ps
            self.qvol[i] = float(r["vol"])
            self.all_prints += ps
        self.pts = [p[0] for p in self.all_prints]

    def last_before(self, t_ms):
        import bisect
        k = bisect.bisect_left(self.pts, t_ms) - 1
        return None if k < 0 else (self.all_prints[k][1], self.all_prints[k][3])

    def last_at_or_before(self, t_ms):
        import bisect
        k = bisect.bisect_right(self.pts, t_ms) - 1
        return self.all_prints[k][1] if k >= 0 else None


def main(path):
    d = json.load(open(path))
    mins = collections.defaultdict(list)
    for r in d["minutes"] or []:
        mins[r["book"]].append(r)
    eng = collections.defaultdict(list)
    for t in d["trips"] or []:
        eng[t["book"]].append(t)
    out, tot = {}, {"engine_trips": 0, "replay_trips": 0, "engine_gbp": 0.0, "replay_gbp": 0.0}
    for b, rows in sorted(mins.items()):
        tick, half = BOOK[b]
        saved = (P.TICK, P.FEE, P.HALF_SPREAD)
        P.TICK, P.FEE, P.HALF_SPREAD = tick, TAKER, half
        try:
            tr, _ = P.simulate(MinuteBook(b, rows, tick), size=100.0)
        finally:
            P.TICK, P.FEE, P.HALF_SPREAD = saved
        # The simulator closes what is still held at the end of the data; the engine still holds it: not a round trip yet.
        tr = [x for x in tr if not (x["how"] == "taker" and x["t_exit"] - x["t_entry"] < 1440 * M)]
        e = eng.get(b, [])
        o = {"engine_trips": len(e), "replay_trips": len(tr), "engine_gbp": round(sum(float(t["pnl_gbp"]) for t in e), 4),
             "replay_gbp": round(sum(x["pnl_usd"] for x in tr), 4)}
        out[b] = o
        for k in tot:
            tot[k] += o[k]
    ok = lambda a, b, f: abs(a - b) <= f * max(abs(b), 1e-9)
    tot = {k: round(v, 4) for k, v in tot.items()}
    tot["trips_within_5pct"] = ok(tot["replay_trips"], tot["engine_trips"], 0.05)
    tot["pnl_within_10pct"] = ok(tot["replay_gbp"], tot["engine_gbp"], 0.10)
    print(json.dumps({"books": out, "all": tot}, indent=1, sort_keys=True))


if __name__ == "__main__":
    main(sys.argv[1])
