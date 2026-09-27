"""HARVEST, temperature after the day: the slice PMLATE did not isolate — every bucket of a US station's daily high or
low market that is still open once the station's local day D has ended.

Inputs, none new to a price: PMLATE's committed US input (`pmlate/inputs/uslate_2026-03_2026-08.json.gz`: for every
bucket the station's reports decided during D, its state — dead, or locked for an open-ended bucket — from IEM's
routine and special reports), and Gamma's record of each event (every bucket's market, result, close and fees;
`universe_pull.py temperature 103040`). PMLATE and USLATE read every print of these market-days already, so they have
no held-out months: the months below are measurement, not a clean test.

* C = the end of D in the station's local time + 600 s (the day's last routine report is observed at :51–:53 and AWC
  receives a US report a p90 of 1.5–7 minutes later, `pmlate/results/awc_receipt_lags.json`).
* The reports' outcome for every bucket at C: the input's `final` is the day's extreme from the station's reports
  (PMLATE's `metar.running` over D, whole degrees of the market's unit); the bucket holding it is confirmed YES, every
  other bucket NO (for a high, the buckets below it were already dead during D; the ones above were never reached).
* A trap is a bucket whose result differs: the source the market resolves on (NOAA's time series or Weather
  Underground) showed another extreme than IEM's reports.

The split (written here, from metadata): exploration = US stations, target date in [2026-03-01, 2026-06-01), every
market closed before 2026-06-01 00:00 UTC. There is no held-out set.

usage: temperature_units.py <temperature universe> <pmlate us input> <out split json> <out units json> <out floors json>
"""
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hcommon as H  # noqa: E402

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "pmlate", "scripts"))
import common as P  # noqa: E402
import metar as W  # noqa: E402
from stations import tz_of  # noqa: E402

D0, D1 = "2026-03-01", "2026-06-01"
EX_END = H.utc(0).replace(year=2026, month=6, day=1).timestamp()
SETTLE = 600


def main():
    uni = H.jfile(sys.argv[1])["events"]
    pm = H.jfile(sys.argv[2])
    states, finals = {}, {}
    for e in pm["events"]:
        finals[str(e["event"])] = e.get("final")
        for b in e["buckets"]:
            states[b["cond"]] = b["state"]
    pm_events = {str(e["event"]) for e in pm["events"]}
    units, floors, ex = [], {}, []
    skipped = Counter()
    for eid in sorted(uni, key=int):
        e = uni[eid]
        mk = []
        for m in e["markets"]:
            raw = {"question": m["q"], "clobTokenIds": "[]", "outcomePrices": "[]", "endDate": H.iso(e["end"]),
                   "resolutionSource": e["res_source"], "description": m["desc"] or e["desc"]}
            p = P.parse_market(dict(raw, clobTokenIds='["a","b"]', outcomePrices='["0","1"]'))
            if p:
                mk.append((m, p))
        if not mk:
            continue
        p0 = mk[0][1]
        st, date, hl = p0["station"], p0["date"], p0["hl"]
        if not st or not st.startswith("K") or not (D0 <= date < D1):
            continue
        if eid not in pm_events:
            skipped["not_in_pmlate_input"] += 1
            continue
        if any(m["closed_time"] is None or m["closed_time"] >= EX_END for m, _ in mk):
            skipped["closes_after_boundary"] += 1
            continue
        if any(H.winner_index(m) is None for m, _ in mk):
            skipped["not_one_winner"] += 1
            continue
        ex.append(eid)
        _, t_end = W.local_day_bounds(date, tz_of(st))
        c = t_end + SETTLE
        fin = finals.get(eid)
        if fin is None:
            skipped["no_final_extreme"] += 1
            ex.pop()
            continue
        inb = lambda b: (b[0] is None or fin >= b[0]) and (b[1] is None or fin <= b[1])  # noqa: E731
        hits = [m["cond"] for m, p in mk if inb(p["bucket"])]
        winner = hits[0] if len(hits) == 1 else None
        if winner is None:
            skipped["final_not_in_one_bucket"] += 1
            ex.pop()
            continue
        for m, p in mk:
            units.append({"cat": "temperature", "event": eid, "cond": m["cond"], "title": m["title"], "q": m["q"][:120],
                          "C": c, "kind": states.get(m["cond"], "alive"), "w": 0 if m["cond"] == winner else 1,
                          "r": H.winner_index(m), "closed": m["closed_time"], "fees": m["fees"],
                          "fee_rate": m["fee_rate"], "fee_exp": m["fee_exp"] or 1, "rebate": m["rebate"],
                          "tick": m["tick"], "station": st, "date": date, "hl": hl, "source": p["source"]})
        floors[eid] = int(c - 3600)
    split = {"rule": "US stations (ICAO K...), target date in [2026-03-01, 2026-06-01), every market closed before "
                     "2026-06-01 00:00 UTC; no held-out set (PMLATE and USLATE read every US print of 2026-03 to 09)",
             "categories": {"temperature": {"exploration": ex, "held_out": [], "counts": {"exploration": len(ex),
                                                                                          "held_out": 0}}}}
    H.write_json(sys.argv[3], split)
    H.write_json(sys.argv[4], {"category": "temperature", "settle_s": SETTLE, "units": units, "skipped": dict(skipped)})
    H.write_json(sys.argv[5], {"floors": floors})
    traps = [u for u in units if u["w"] != u["r"]]
    by_ev = defaultdict(int)
    for u in traps:
        by_ev[u["event"]] += 1
    print("events", len(ex), "units", len(units), "traps", len(traps), "trap events", len(by_ev), dict(skipped),
          Counter(u["kind"] for u in units))


if __name__ == "__main__":
    main()
