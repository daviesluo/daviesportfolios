"""SPEED step 2: each keyless source's latency after the observation time, from `poll_sources.py`'s live record.

For every observation a source showed that it had not shown at its first poll, the source made it public somewhere in
(prev, seen] — the last poll that did not show it and the first that did. The estimate used is the middle of that
interval (never earlier than the observation), and `seen` itself is the upper bound; tgftp's own `Last-Modified` (the
instant the station's file was written, to the second) and AWC's `receiptTime` are reported where the source gives
them. METARs are matched across sources by station and observation minute, so each report says which source had it
first and by how much the others trailed AWC's receipt of the same report.

usage: source_latency.py <poll dir> <out json>
"""
import json
import sys
from collections import Counter, defaultdict

METAR_SOURCES = ("tgftp_st", "tgftp_cyc", "awc_api", "awc_cache", "iem_cur", "iem_mtr", "nws_latest", "nws_list",
                 "nws_xml", "vatsim")


def lines(path):
    """A JSON-lines file, plain or gzipped (the committed copies are `<name>.gz`)."""
    import gzip
    import os
    f = gzip.open(path + ".gz", "rt") if not os.path.exists(path) and os.path.exists(path + ".gz") else open(path)
    with f:
        return [json.loads(x) for x in f if x.strip()]


def q(xs, p):
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(p * len(xs)))], 1) if xs else None


def stats(xs):
    return {"n": len(xs), "p10": q(xs, .1), "p50": q(xs, .5), "p90": q(xs, .9), "min": q(xs, 0), "max": q(xs, 1)} if xs else {"n": 0}


def main():
    d = sys.argv[1]
    obs = lines(d + "/obs.jsonl")
    polls = lines(d + "/polls.jsonl")
    clock = lines(d + "/clock.jsonl")
    run = lines(d + "/run.jsonl")[0]
    new = [o for o in obs if not o["initial"] and o.get("obs")]
    # estimated first-public instant: the middle of (prev, seen], never before the observation itself
    for o in new:
        lo = max(o["prev"] or o["seen"], o["obs"])
        o["est"] = (lo + o["seen"]) / 2 if o["seen"] >= lo else o["seen"]
        o["us"] = str(o["st"]).startswith("K")
        o["hf"] = (o["src"] in ("nws_latest", "nws_list") and not o["meta"].get("raw")) or (o["src"] == "iem_mtr" and o["meta"].get("hf"))
    out = {"window_utc": [run["start"], run["end"]], "stations": run["stations"], "ua": run["ua"],
           "clock_offset_s": stats([c["offset_s"] for c in clock]), "clock_rtt_s": stats([c["rtt_s"] for c in clock]),
           "sources": {}, "vs_awc_receipt": {}, "first_source": {}}
    # AWC's receipt of each METAR (station, observation minute)
    receipt = {}
    for o in new + [o for o in obs if o["src"] == "awc_api"]:
        if o["src"] == "awc_api" and o["meta"].get("receipt") and o.get("obs"):
            receipt[(o["st"], int(o["obs"]) // 60)] = o["meta"]["receipt"]
    by = defaultdict(list)
    for o in new:
        kind = "5-minute" if o["hf"] else "report"
        by[(o["src"], "US" if o["us"] else "non-US", kind)].append(o)
    for (src, reg, kind), os_ in sorted(by.items()):
        row = {"est_after_obs_s": stats([o["est"] - o["obs"] for o in os_]),
               "seen_after_obs_s": stats([o["seen"] - o["obs"] for o in os_]),
               "poll_gap_s": stats([o["seen"] - o["prev"] for o in os_ if o["prev"]])}
        if src == "tgftp_st":
            row["file_written_after_obs_s"] = stats([o["meta"]["lm"] - o["obs"] for o in os_ if o["meta"].get("lm")])
        if src == "awc_api":
            row["awc_receipt_after_obs_s"] = stats([o["meta"]["receipt"] - o["obs"] for o in os_ if o["meta"].get("receipt")])
            row["api_seen_after_receipt_s"] = stats([o["seen"] - o["meta"]["receipt"] for o in os_ if o["meta"].get("receipt")])
        out["sources"][f"{src}|{reg}|{kind}"] = row
    # each source against AWC's receipt of the same report (METAR sources, reports only)
    vs = defaultdict(list)
    for o in new:
        if o["src"] in METAR_SOURCES and not o["hf"]:
            r = receipt.get((o["st"], int(o["obs"]) // 60))
            if r:
                vs[(o["src"], "US" if o["us"] else "non-US")].append(o["est"] - r)
                if o["src"] == "tgftp_st" and o["meta"].get("lm"):
                    vs[("tgftp_st_file_written", "US" if o["us"] else "non-US")].append(o["meta"]["lm"] - r)
    out["vs_awc_receipt"] = {f"{k[0]}|{k[1]}": stats(v) for k, v in sorted(vs.items())}
    # the per-report samples step 4 draws from: when tgftp wrote the station's file, against AWC's receipt
    out["samples_tgftp_written_minus_receipt_s"] = {r: [round(x, 3) for x in sorted(vs.get(("tgftp_st_file_written", r), []))]
                                                    for r in ("US", "non-US")}
    out["samples_tgftp_written_after_obs_s"] = {
        r: sorted(round(o["meta"]["lm"] - o["obs"], 3) for o in new
                  if o["src"] == "tgftp_st" and o["meta"].get("lm") and (o["us"] == (r == "US")))
        for r in ("US", "non-US")}
    # which source had each report first (estimates; tgftp by its file time when it has one)
    rep = defaultdict(dict)
    for o in new:
        if o["src"] in METAR_SOURCES and not o["hf"]:
            t = o["meta"]["lm"] if (o["src"] == "tgftp_st" and o["meta"].get("lm")) else o["est"]
            k = (o["st"], int(o["obs"]) // 60)
            if o["src"] not in rep[k] or t < rep[k][o["src"]]:
                rep[k][o["src"]] = t
    first, lead = Counter(), defaultdict(list)
    for k, srcs in rep.items():
        if len(srcs) < 3:
            continue
        s = sorted(srcs.items(), key=lambda kv: kv[1])
        reg = "US" if str(k[0]).startswith("K") else "non-US"
        first[(s[0][0], reg)] += 1
        lead[reg].append(s[1][1] - s[0][1])
    out["first_source"] = {"reports_with_3_plus_sources": sum(first.values()),
                           "first_by_source": {f"{a}|{b}": n for (a, b), n in sorted(first.items())},
                           "lead_over_second_s": {r: stats(v) for r, v in lead.items()}}
    # politeness: requests a minute per source, and failures
    span_min = (max(p["t1"] for p in polls) - min(p["t0"] for p in polls)) / 60.0
    pc, bad = Counter(p["src"] for p in polls), Counter(p["src"] for p in polls if p["status"] not in (200, 206, 304, 416))
    out["requests"] = {s: {"per_min": round(n / span_min, 1), "failed": bad[s]} for s, n in sorted(pc.items())}
    out["minutes"] = round(span_min, 1)
    with open(sys.argv[2], "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    for k, v in out["sources"].items():
        extra = {kk: v[kk]["p50"] for kk in v if kk not in ("est_after_obs_s", "seen_after_obs_s", "poll_gap_s")}
        print(f"{k:34s} n={v['est_after_obs_s']['n']:4d} est p50={v['est_after_obs_s']['p50']} p90={v['est_after_obs_s']['p90']}"
              f"  poll gap p50={v['poll_gap_s'].get('p50')} {extra}")
    print("vs AWC receipt:")
    for k, v in out["vs_awc_receipt"].items():
        print(f"   {k:34s} {v}")
    print("first:", out["first_source"])
    print("requests:", out["requests"], "minutes", out["minutes"])
    print("clock:", out["clock_offset_s"])


if __name__ == "__main__":
    main()
