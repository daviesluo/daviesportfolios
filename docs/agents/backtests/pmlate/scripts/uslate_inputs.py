"""USLATE data step: the input `uslate_test.py` reads, for a range of target dates and a set of stations.

For every resolved daily temperature event whose station publishes METAR, with the target date in [from, to): the
station's routine and special reports over its local civil day (IEM, `metar.running`), and for every bucket the first
report that made it dead or locked (`rw_mechanism.state_after`): its observation instant. For that bucket, every print
of its market from the report's observation instant to the market's closed time (the walks `prints_pull.py` wrote),
each reduced to [ts, stale, y, size]: `stale` is 1 when the print was on the stale side (a taker selling a dead
bucket's YES or buying its NO; buying a locked bucket's YES or selling its NO), `y` the YES-equivalent price. Also the
market's payout, closed time, fee schedule and tick, the event's source and the station's receipt delays (p50, p90)
from `results/awc_receipt_lags.json`. No price decides what is kept: every bucket the reports decided is in, with every
print after its report.

usage: uslate_inputs.py <from> <to> <us|nonus|all> <lags json> <out json.gz> <events file> [<events file> ...]
"""
import gzip
import json
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import metar as W  # noqa: E402
from explore import yes_dir  # noqa: E402
from rw_mechanism import state_after  # noqa: E402
from stations import tz_of  # noqa: E402


def main():
    d0, d1, which, lagf, outp = sys.argv[1:6]
    files = sys.argv[6:]
    lags = json.load(open(lagf))
    us_default = lags["pooled"]["US_median_of_station_p90"]
    seen, obs_cache = set(), {}
    events, n = [], Counter()
    for f in files:
        ev = C.load_json(f)["events"]
        ev = list(ev.values()) if isinstance(ev, dict) else ev
        for e in sorted(ev, key=lambda x: (x["date"], x["event"])):
            if e["event"] in seen or not (d0 <= e["date"] < d1) or not e.get("closed", True):
                continue
            seen.add(e["event"])
            st = e.get("station")
            if not st or st == "HKO":
                n["no_metar_station"] += 1
                continue
            us = st.startswith("K")
            if (which == "us" and not us) or (which == "nonus" and us):
                continue
            n["events"] += 1
            if st not in obs_cache:
                p = os.path.join(C.DATA, "obs", st + ".json")
                obs_cache[st] = C.load_json(p)["iem"] if C.pmnet.exists(p) else []
            s, t = W.local_day_bounds(e["date"], tz_of(st))
            run = W.running(obs_cache[st], e["unit"], e["hl"], s, t)
            if not run:
                n["no_reports"] += 1
                continue
            pth = os.path.join(C.DATA, "prints", f"ev_{e['event']}.json")
            if not C.pmnet.exists(pth):
                n["no_prints_file"] += 1
                continue
            pf = C.load_json(pth)
            by_cond = defaultdict(list)
            for r in pf["rows"]:
                by_cond[r[1]].append(r)
            lag = lags["stations"].get(st)
            out_b = []
            for b in e["buckets"]:
                state, obs_ts = None, None
                for ts_, v, rr in run:
                    k = state_after(e["hl"], b["bucket"], rr)
                    if k:
                        state, obs_ts = k, ts_
                        break
                if not state:
                    continue
                closed = b.get("closed_time")
                prs = []
                for r in sorted(by_cond.get(b["cond"], [])):
                    if r[0] < obs_ts or (closed and r[0] >= closed):
                        continue
                    d, y = yes_dir(r[2], r[3], r[4])
                    if d is None:
                        continue
                    stale = 1 if ((state == "dead" and d == "SELL") or (state == "locked" and d == "BUY")) else 0
                    prs.append([int(r[0]), stale, round(y, 6), round(r[5], 4)])
                out_b.append({"cond": b["cond"], "bucket": b["bucket"], "state": state, "obs": int(obs_ts),
                              "closed": closed, "payout_yes": b["payout_yes"], "fee_rate": b.get("fee_rate"),
                              "fee_exp": b.get("fee_exp", 1), "tick": b.get("tick"), "prints": prs})
                n["buckets_decided"] += 1
            events.append({"event": e["event"], "date": e["date"], "city": e["city"], "hl": e["hl"], "unit": e["unit"],
                           "station": st, "us": us, "source": e.get("source"), "complete": pf.get("complete"),
                           "lag_p50": lag["p50"] if lag else None,
                           "lag_p90": lag["p90"] if lag else (us_default if us else lags["pooled"]["non-US"]["p90"]),
                           "final": run[-1][2], "buckets": out_b})
    os.makedirs(os.path.dirname(os.path.abspath(outp)), exist_ok=True)
    with gzip.GzipFile(outp, "wb", mtime=0) as g:
        g.write(json.dumps({"from": d0, "to": d1, "stations": which, "counts": dict(n), "events": events},
                           sort_keys=True, separators=(",", ":")).encode())
    print(dict(n))


if __name__ == "__main__":
    main()
