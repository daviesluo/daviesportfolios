"""Does PR5's rule lose around releases on Revolut X, and what would the Coinbase tests' blackout be worth there?
(docs/agents/reviews/2026-10-15-coinbase-blackout.md, §3). PROPOSAL ONLY: it imports `pr5_sim.py` (PR5's frozen simulator, with
the books it was pre-registered on) and `cbfast.py` read-only, changes no Revolut X file, and writes ../results/cbfast_revx.json.

* HISTORY: PR5's own books (`pr5_sim.Book`: Revolut X UK prints, GBP/USD, the dollar books' hourly closes; 2025-11-26 / 2025-12-16 to
  2026-09-23), $100 a rung, $1,200 in all. `gsim` (cbfast.py) with no hook must equal `pr5_sim.simulate` trip for trip, and the base
  arm's PRIMARY window must give pr5_run1.json's figure; both are asserted. The blackout is cbfast's dark fair (the form the frozen
  `stepMinute` can take as it stands): a1 b5 on all five kinds, on the US and BoE kinds that move GBP/USD, on the US kinds, and a pause
  of entries only, plus three other windows. Two spans of 140 and 141 days (2025-12-16 -> 2026-05-05 -> 2026-09-23), and the week of
  2026-08-24 on, in which the market tightened. Day-bootstrap, paired, 5th and 95th percentile, as cbfast does.
* THE PAPER ENGINE'S OWN RECORD (`../inputs/revx_paper_record.json.gz`, 2026-09-25 .. 2026-10-15, `sql/export_revx_paper_record.sql`):
  the same rule replayed on the prints and the minute record the engine decided on, to check the replay against the engine's own days,
  and then with the blackout, for 2026-10-02 (NFP) and 2026-10-14 (CPI), the two releases the record holds.
usage: python3 -I cbfast_revx.py  (about 6 minutes)  -> ../results/cbfast_revx.json
"""
import bisect, collections, datetime, gzip, json, os, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import cbfast as C  # noqa: E402

P, M, DAY = C.P, C.M, C.DAY
CAP_USD = 1200.0
CLOCK = lambda s: C.S.CI.ms(s)
SPANS = {"span_1_2025-12-16_to_2026-05-05": (CLOCK("2025-12-16T00:00"), CLOCK("2026-05-05T00:00")),
         "span_2_2026-05-05_to_2026-09-23": (CLOCK("2026-05-05T00:00"), P.END),
         "tight_2026-08-24_to_2026-09-23": (CLOCK("2026-08-24T00:00"), P.END)}
CFGS = {
    "base": {"fam": "base"},
    "blackout a1 b5, all five kinds": {"fam": "g3_cal", "kind": "all", "a": 1, "b": 5, "dark": True},
    "blackout a1 b5, US kinds and BoE": {"fam": "g3_cal", "kind": "usboe", "a": 1, "b": 5, "dark": True},
    "blackout a1 b5, US kinds only": {"fam": "g3_cal", "kind": "us", "a": 1, "b": 5, "dark": True},
    "blackout a1 b5, entries only (pause)": {"fam": "g3_cal", "kind": "all", "a": 1, "b": 5},
    "blackout a0 b2, all": {"fam": "g3_cal", "kind": "all", "a": 0, "b": 2, "dark": True},
    "blackout a1 b15, all": {"fam": "g3_cal", "kind": "all", "a": 1, "b": 15, "dark": True},
    "blackout a3 b60, all": {"fam": "g3_cal", "kind": "all", "a": 3, "b": 60, "dark": True},
}
KEY = lambda z: (z["t_entry"], z["t_exit"], round(z["pnl_usd"], 9), z["how"], z["k"], z["side"])


def pk(trips):
    return [(x["t_entry"], x["t_exit"], x["pnl_usd"], x["how"] == "taker") for x in trips]


def usd_span(packs, span):
    st_, ser = C.span_stats(packs, span)
    st_["usd_per_year"] = st_["pnl_gbp"] / st_["days"] * 365
    st_["pct_per_year_on_1200"] = 100 * st_["usd_per_year"] / CAP_USD
    return st_, ser


# --------------------------------------------------------------------------------------------- the paper engine's record
class RecBook:
    """pr5_sim.Book's fields, from the paper engine's own prints and minutes (inputs/revx_paper_record.json.gz)."""

    def __init__(self, book, prints, minutes):
        self.book = book
        pr = []
        for ln in prints.split(";"):
            ms, price, qty, s, _ = ln.split(",")
            pr.append((int(ms), round(float(price) / P.TICK), float(qty), "buy" if s == "b" else "sell"))
        pr.sort(key=lambda x: x[0])
        rows = [ln.split(",") for ln in minutes.split(";")]
        i0, i1 = int(rows[0][0]), int(rows[-1][0])
        self.t0, self.n = i0 * M, i1 - i0 + 1
        self.X, self.F = [None] * self.n, [None] * self.n
        for idx, x, fu in rows:
            i = int(idx) - i0
            if x and fu:
                self.X[i], self.F[i] = float(x), float(fu) / float(x)
            elif x:
                self.X[i] = float(x)
        self.all_prints, self.pts = pr, [p[0] for p in pr]
        self.by_min = collections.defaultdict(list)
        for p in pr:
            if self.t0 <= p[0] < self.t0 + self.n * M:
                self.by_min[(p[0] - self.t0) // M].append(p)
        self.qvol = {i: sum(q * pt * P.TICK for _, pt, q, _ in ps) for i, ps in self.by_min.items()}

    def last_before(self, t_ms):
        k = bisect.bisect_left(self.pts, t_ms) - 1
        return None if k < 0 else (self.all_prints[k][1], self.all_prints[k][3])

    def last_at_or_before(self, t_ms):
        k = bisect.bisect_right(self.pts, t_ms) - 1
        return self.all_prints[k][1] if k >= 0 else None


def day_of(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")


def by_exit_day(trips):
    d = collections.defaultdict(lambda: [0, 0, 0.0])
    for x in trips:
        v = d[day_of(x["t_exit"])]
        v[0] += 1; v[1] += int(x["pnl_usd"] > 1e-12); v[2] += x["pnl_usd"]
    return {k: {"trips": v[0], "won": v[1], "pnl_usd": round(v[2], 4)} for k, v in sorted(d.items())}


def record_study(events):
    d = json.load(gzip.open(os.path.join(ROOT, "inputs", "revx_paper_record.json.gz"), "rt"))
    out = {"arms": {}}
    books = {b: RecBook(b, d["prints"][b], d["minutes"][b]) for b in d["prints"]}
    for name, spec in (("engine rule as replayed", CFGS["base"]), ("blackout a1 b5, all five kinds", CFGS["blackout a1 b5, all five kinds"]), ("blackout a1 b5, US kinds and BoE", CFGS["blackout a1 b5, US kinds and BoE"])):
        trips = []
        for b, B in books.items():
            pb, pa, mult, stop, dark = C.pauses({}, spec, B, events) if spec["fam"] != "base" else (None, None, None, 1440, None)
            tr = C.gsim(B, pb=pb, pa=pa, mult=mult, stop_min=stop, dark=dark, size=100.0)
            tr = [x for x in tr if not (x["how"] == "taker" and x["t_exit"] - x["t_entry"] < 1440 * M)]      # still held at the end of the record
            trips += tr
        cpi = int(datetime.datetime(2026, 10, 14, 12, 30, tzinfo=datetime.timezone.utc).timestamp() * 1000)
        rel = [x for x in trips if x["t_entry"] == cpi]
        out["arms"][name] = {"by_exit_day": by_exit_day(trips), "total_usd": round(sum(x["pnl_usd"] for x in trips), 4), "trips": len(trips),
                             "entered_in_the_2026-10-14_release_minute": {"trips": len(rel), "pnl_usd": round(sum(x["pnl_usd"] for x in rel), 4)}}
    return out


# --------------------------------------------------------------------------------------------- history
def main():
    events = C.load_events()
    fx = P.fx_series()
    res = {"about": "cbfast_revx.py: the Coinbase blackout priced on PR5's rule over Revolut X; PROPOSAL, no Revolut X file touched", "capital_usd": CAP_USD,
           "spans": {k: [C.S.day_of(a), C.S.day_of(z)] for k, (a, z) in SPANS.items()}}
    packs = {name: [] for name in CFGS}
    t_events = {}
    for b in P.BOOKS:
        B = P.Book(b, P.START[b], P.END, fx)
        tick_check = None
        for name, spec in CFGS.items():
            pb, pa, mult, stop, dark = C.pauses({}, spec, B, events) if spec["fam"] != "base" else (None, None, None, 1440, None)
            tr = C.gsim(B, pb=pb, pa=pa, mult=mult, stop_min=stop, dark=dark, size=100.0)
            if name == "base":
                ref = P.simulate(B, size=100.0)[0]
                assert [KEY(a) for a in ref] == [KEY(a) for a in tr], f"gsim differs from pr5_sim.simulate on {b}"
                base_trips = tr
                prim = sum(x["pnl_usd"] for x in tr if P.START[b] <= x["t_entry"] < P.PRIM_END)
                t_events[b] = {"base_primary_pnl_usd": round(prim, 4), "trips": len(tr)}
            packs[name].append(pk(tr))
    # the base arm's PRIMARY window against the committed run
    run1 = json.load(gzip.open(os.path.join(ROOT, "..", "pr5", "pr5_run1.json.gz"), "rt"))
    res["check_primary_vs_pr5_run1"] = {"here_usd": round(sum(v["base_primary_pnl_usd"] for v in t_events.values()), 4), "pr5_run1_usd": run1["primary"]["PRIMARY"]["pnl_usd"]}
    base = {sp: usd_span(packs["base"], w) for sp, w in SPANS.items()}
    res["configs"] = {}
    for name in CFGS:
        res["configs"][name] = {}
        for sp, w in SPANS.items():
            s_, ser = usd_span(packs[name], w)
            b_s, b_ser = base[sp]
            s_["trips_kept"] = s_["trips"] / b_s["trips"] if b_s["trips"] else None
            s_["delta_usd_per_year"] = s_["usd_per_year"] - b_s["usd_per_year"]
            s_["delta_boot"] = C.boot(b_ser, ser) if name != "base" else None
            s_["base_boot"] = C.boot(ser) if name == "base" else None
            res["configs"][name][sp] = s_
    # event by event, on the base arm's trips: what the blackout would have removed
    trips = [x for p in packs["base"] for x in p]
    rows, plc = [], collections.defaultdict(list)
    ev = [e for e in events if SPANS["span_1_2025-12-16_to_2026-05-05"][0] <= e["t"] < P.END]
    for e in ev:
        a, z = e["t"] - 1 * M, e["t"] + 5 * M
        sel = [x for x in trips if a <= x[0] <= z]
        rows.append({"kind": e["kind"], "day": e["day"], "removed_trips": len(sel), "removed_pnl_usd": round(sum(x[2] for x in sel), 4)})
        for off in list(range(-14, -3)) + list(range(4, 15)):
            t = e["t"] + off * DAY
            if datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).weekday() < 5:
                plc[e["kind"]].append(sum(x[2] for x in trips if t - M <= x[0] <= t + 5 * M))
    kinds = {}
    for k in sorted({r["kind"] for r in rows}) + ["all"]:
        v = [r["removed_pnl_usd"] for r in rows if k == "all" or r["kind"] == k]
        n0 = [r for r in rows if (k == "all" or r["kind"] == k) and r["removed_trips"] == 0]
        p = [x for kk in plc for x in plc[kk]] if k == "all" else plc[k]
        kinds[k] = {"events": len(v), "removed_usd": round(sum(v), 3), "lost": sum(1 for x in v if x < 0), "won": sum(1 for x in v if x > 0), "no_trip": len(n0),
                    "mean_per_event_usd": round(sum(v) / len(v), 4), "placebo_mean_usd": round(sum(p) / len(p), 4)}
    res["events"] = {"by_kind": kinds, "rows": rows}
    res["paper_engine_record"] = record_study(events)
    json.dump(res, open(os.path.join(ROOT, "results", "cbfast_revx.json"), "w"), indent=1, sort_keys=True)
    print(json.dumps({"check": res["check_primary_vs_pr5_run1"], "books": t_events}, indent=1))
    for name, d in res["configs"].items():
        print(name)
        for sp, v in d.items():
            db = v["delta_boot"]
            print("   %-34s $/yr %8.2f (%5.1f%%)  trips %4d  d %+7.2f  kept %.3f  worst %+.2f  %s" % (sp, v["usd_per_year"], v["pct_per_year_on_1200"], v["trips"], v["delta_usd_per_year"], v["trips_kept"] or 1, v["worst_day_gbp"],
                  "boot[%+.1f,%+.1f]" % (db["p5"], db["p95"]) if db else ""))
    for k, v in kinds.items():
        print("  %-5s events %2d removed %+8.3f lost %2d won %2d none %2d mean %+.4f placebo %+.4f" % (k, v["events"], v["removed_usd"], v["lost"], v["won"], v["no_trip"], v["mean_per_event_usd"], v["placebo_mean_usd"]))
    for name, a in res["paper_engine_record"]["arms"].items():
        print(name, a["total_usd"], a["trips"], a["by_exit_day"].get("2026-10-14"), a["entered_in_the_2026-10-14_release_minute"])


if __name__ == "__main__":
    main()
