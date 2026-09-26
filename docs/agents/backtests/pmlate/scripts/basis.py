"""PMLATE feasibility (b): how often the resolution differs from what the station's reports said.

For every resolved temperature event of an events file whose station publishes METAR: the local day's running extreme
from IEM's routine and special reports (`metar.running`), and against the winning bucket (payouts, not prices):
* agree: the day's final extreme is in the winning bucket;
* a dead bucket won: some bucket the running extreme had ruled out paid YES — the loss a rule buying that bucket's NO
  would take; counted for every bucket and for those ruled out by a margin of 1 and 2 whole degrees;
* the direction of a disagreement (the source saw a more or a less extreme value than the reports).
By source (Weather Underground, the NWS time series), by US / non-US station, by month and by date, so clustered
failures show. No price or print is read.

usage: basis.py <events file> [<events file> ...] --out <json>
"""
import json
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import metar as W  # noqa: E402
from rw_mechanism import contains, state_after  # noqa: E402
from stations import tz_of  # noqa: E402


def margin_dead(hl, b, run, m):
    lo, hi = b
    if hl == "highest":
        return hi is not None and run > hi + m
    return lo is not None and run < lo - m


def main():
    files = [a for a in sys.argv[1:] if not a.startswith("--") and a != sys.argv[sys.argv.index("--out") + 1]]
    outp = sys.argv[sys.argv.index("--out") + 1]
    seen, obs_cache = set(), {}
    cnt = defaultdict(Counter)
    by_date = defaultdict(Counter)
    rows = []
    for f in files:
        ev = C.load_json(f)["events"]
        ev = list(ev.values()) if isinstance(ev, dict) else ev
        for e in ev:
            if e["event"] in seen or not e.get("closed", True):
                continue
            seen.add(e["event"])
            st = e.get("station")
            if not st or st == "HKO":
                cnt["all"]["no_metar_station"] += 1
                continue
            if st not in obs_cache:
                p = os.path.join(C.DATA, "obs", st + ".json")
                obs_cache[st] = C.load_json(p)["iem"] if C.pmnet.exists(p) else []
            s, t = W.local_day_bounds(e["date"], tz_of(st))
            run = W.running(obs_cache[st], e["unit"], e["hl"], s, t)
            win = [b for b in e["buckets"] if b["payout_yes"] == 1.0]
            keys = ["all", f"src:{e.get('source')}", "US" if st.startswith("K") else "non-US", f"month:{e['date'][:7]}",
                    f"hl:{e['hl']}"]
            if not run:
                for k in keys:
                    cnt[k]["no_reports"] += 1
                continue
            if len(win) != 1:
                for k in keys:
                    cnt[k]["not_one_winner"] += 1
                continue
            final, wb = run[-1][2], win[0]["bucket"]
            agree = contains(wb, final)
            direction = None
            if not agree:
                more = (wb[0] is not None and wb[0] > final) if e["hl"] == "highest" else (wb[1] is not None and wb[1] < final)
                direction = "source_more_extreme" if more else "source_less_extreme"
            dead_won = {m: any(margin_dead(e["hl"], b["bucket"], final, m) and b["payout_yes"] == 1.0 for b in e["buckets"])
                        for m in (0, 1, 2)}
            gaps = max([(b2[0] - b1[0]) / 3600 for b1, b2 in zip(run, run[1:])] or [0])
            for k in keys:
                c = cnt[k]
                c["events"] += 1
                c["agree"] += agree
                if direction:
                    c[direction] += 1
                for m, v in dead_won.items():
                    c[f"dead_bucket_won_margin{m}"] += v
                c["dead_buckets"] += sum(1 for b in e["buckets"] if state_after(e["hl"], b["bucket"], final) == "dead")
            if not agree:
                by_date[e["date"]]["disagree"] += 1
                if dead_won[0]:
                    by_date[e["date"]]["dead_won"] += 1
                rows.append([e["event"], e["date"], e["city"], e["hl"], e["unit"], st, e.get("source"), final, wb,
                             direction, len(run), round(gaps, 1), dead_won[0], dead_won[1], dead_won[2]])
    out = {"counts": {k: dict(v) for k, v in sorted(cnt.items())}, "disagreements": rows,
           "dates_with_2plus": {d: dict(v) for d, v in sorted(by_date.items()) if v["disagree"] >= 2}}
    C.dump_json(outp, out)
    for k in ("all", "src:wu", "src:nws", "US", "non-US", "hl:highest", "hl:lowest"):
        c = cnt.get(k, {})
        n = c.get("events", 0)
        if n:
            print(f"{k:12} events {n:6} agree {c.get('agree', 0) / n:.4f} | source less extreme {c.get('source_less_extreme', 0)} "
                  f"more extreme {c.get('source_more_extreme', 0)} | a dead bucket won: margin0 {c.get('dead_bucket_won_margin0', 0)} "
                  f"margin1 {c.get('dead_bucket_won_margin1', 0)} margin2 {c.get('dead_bucket_won_margin2', 0)} "
                  f"of {c.get('dead_buckets', 0)} dead buckets | no reports {c.get('no_reports', 0)}")
    print("dates with 2+ disagreements:", len(out["dates_with_2plus"]))
    for d, v in list(out["dates_with_2plus"].items())[-30:]:
        print("  ", d, v)


if __name__ == "__main__":
    main()
