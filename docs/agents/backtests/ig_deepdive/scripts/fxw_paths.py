"""FXW-AUD's minute paths: what an ordinary stop or an IG guaranteed stop does to the frozen rule, from FXCM's minutes.

The 2026-10-14 deep dive could not price a stop: the FXCM weekend table keeps the 24 h high and low but not their order
against the target. FXCM's public weekly 1-minute bid/ask archive (the source of that table, keyless) has the order.
This pulls the weeks of the 85 AUD/USD trades only, keeps each trade's first 24 hours of minutes, and re-scores the rule.

The rule is STATARB-2 E0 as G3 replicates it, unchanged: |gap| >= 20 bps, against the gap, target Friday's mid (taken
when the mid touches it), else the +24 h mid; an assumed opening spread charged half at entry (12, 20, 30 bps) and 2 bps
exit and funding. Written before the first run, the additions:
  STOP_d     an ordinary stop d bps from the entry price on the exit side (bid for a long, ask for a short). It fills
             at the stop level, or at the first minute's open beyond it when the minute opened through it (a gap).
             When the stop and the target fall in the same minute, the stop is taken first.
  GSL_d      the same distance as an IG guaranteed stop: always filled at the level, plus IG's guaranteed-stop premium
             of 1.5 points (0.00015) for AUD/USD (fact F10) charged only when it triggers.
  d          50, 75, 100, 150 and 200 bps. IG's minimum guaranteed distance for AUD/USD is a G1 fact not yet read, so
             every d is reported; none is chosen here.
Also: the adverse excursion from the entry on the exit side (not the mid), its quantiles, and the minutes to target.
A check first: the table's own fill minute and 24 h extremes are recomputed from the minutes and must agree.

Run from the repository root: python3 -I docs/agents/backtests/ig_deepdive/scripts/fxw_paths.py [--pull]
`--pull` reads FXCM's archive into inputs/fxcm_paths/ (the trades' minutes and a log of every URL, status and sha256).
Writes results/fxw_paths.json.
"""
import csv
import datetime as dt
import gzip
import hashlib
import io
import json
import math
import os
import random
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BT = os.path.dirname(HERE)
OUT = os.path.join(HERE, "inputs", "fxcm_paths")
UTC = dt.timezone.utc
BPS = 1e4
GSL_PREMIUM = 0.00015
DISTANCES = [50, 75, 100, 150, 200]
SPREADS = [12, 20, 30]


def trades():
    out = []
    with gzip.open(os.path.join(BT, "statarb_search2", "inputs", "fx", "fxcm_AUDUSD_weekends.csv.gz"), "rt") as fh:
        for r in csv.DictReader(fh):
            fri, sun = int(r["fri_utc"]), int(r["sun_utc"])
            if dt.datetime.fromtimestamp(fri, UTC).weekday() != 4 or not 40 * 3600 <= sun - fri <= 60 * 3600:
                continue
            fmid = (float(r["fri_bid"]) + float(r["fri_ask"])) / 2
            omid = (float(r["sun_bid_open"]) + float(r["sun_ask_open"])) / 2
            g = math.log(omid / fmid)
            if abs(g) >= 20 / BPS:
                out.append({"sun_utc": sun, "fmid": fmid, "omid": omid, "g": g,
                            "fill": int(r["fill_min"]) if r["fill_min"] != "" else None,
                            "m24": float(r["mid_24h"]), "hi": float(r["hi_24h"]), "lo": float(r["lo_24h"])})
    return out


def fetch(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "daviesportfolios-research/1.0 (public market data)"})
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
        return url, 200, body
    except Exception as e:  # noqa: BLE001
        return url, getattr(e, "code", -1), b""


def minutes_of(body):
    raw = gzip.decompress(body)
    txt = raw.decode("utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode()
    rows = []
    for ln in txt.splitlines()[1:]:
        p = ln.split(",")
        if len(p) < 9:
            continue
        t = dt.datetime.strptime(p[0][:19], "%m/%d/%Y %H:%M:%S").replace(tzinfo=UTC)
        rows.append((int(t.timestamp()), *map(float, p[1:9])))
    return rows


def pull(trs):
    os.makedirs(OUT, exist_ok=True)
    urls = set()
    for t in trs:
        sun = dt.datetime.fromtimestamp(t["sun_utc"], UTC).date()
        y, w, _ = (sun + dt.timedelta(days=1)).isocalendar()
        cands = {(y, ww) for ww in (w - 1, w, w + 1) if 1 <= ww <= 53}
        if w >= 52 or w <= 1:   # FXCM's year-end week may sit under either year
            cands |= {(sun.year, 52), (sun.year, 53), (sun.year + 1, 1), (sun.year, 1)}
        for yy, ww in cands:
            urls.add(f"https://candledata.fxcorporate.com/m1/AUDUSD/{yy}/{ww}.csv.gz")
    log, minutes = [], {}
    with ThreadPoolExecutor(6) as ex:
        for url, status, body in ex.map(fetch, sorted(urls)):
            log.append({"url": url, "status": status, "sha256": hashlib.sha256(body).hexdigest() if body else ""})
            if body:
                for r in minutes_of(body):
                    minutes[r[0]] = r
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["sun_utc", "t_utc", "bid_open", "bid_high", "bid_low", "bid_close", "ask_open", "ask_high", "ask_low", "ask_close"])
    for t in trs:
        for ts in range(t["sun_utc"], t["sun_utc"] + 24 * 3600 + 60, 60):
            if ts in minutes:
                w.writerow([t["sun_utc"], ts, *minutes[ts][1:]])
    with gzip.GzipFile(os.path.join(OUT, "AUDUSD_trades_m1.csv.gz"), "wb", mtime=0) as fh:
        fh.write(buf.getvalue().encode())
    with open(os.path.join(OUT, "pull_log.json"), "w") as fh:
        json.dump(sorted(log, key=lambda x: x["url"]), fh, indent=1)
        fh.write("\n")


def load_paths():
    paths = {}
    with gzip.open(os.path.join(OUT, "AUDUSD_trades_m1.csv.gz"), "rt") as fh:
        for r in csv.DictReader(fh):
            paths.setdefault(int(r["sun_utc"]), []).append((int(r["t_utc"]), *(float(r[k]) for k in (
                "bid_open", "bid_high", "bid_low", "bid_close", "ask_open", "ask_high", "ask_low", "ask_close"))))
    return paths


def run(t, path, spread, stop_bps=None, guaranteed=False):
    """One trade's log return, its exit kind, and its adverse excursion on the exit side (bps of entry)."""
    side = 1 if t["g"] < 0 else -1
    entry = t["omid"] * (1 + side * spread / 2 / BPS)
    stop = entry * (1 - side * stop_bps / BPS) if stop_bps else None
    end = t["sun_utc"] + 24 * 3600
    worst = 0.0
    for (ts, bo, bh, bl, bc, ao, ah, al, ac) in path:
        if ts >= end:
            break
        # Exit side: a long sells at the bid, a short buys at the ask.
        lo_x, hi_x, open_x = (bl, bh, bo) if side > 0 else (al, ah, ao)
        worst = max(worst, (entry - lo_x) / entry if side > 0 else (hi_x - entry) / entry)
        if stop is not None and ((side > 0 and lo_x <= stop) or (side < 0 and hi_x >= stop)):
            gapped = (side > 0 and open_x < stop) or (side < 0 and open_x > stop)
            px = stop if guaranteed or not gapped else open_x
            r = side * math.log(px / entry) - 2 / BPS - (GSL_PREMIUM / entry if guaranteed else 0.0)
            return r, "stop", BPS * worst
        # The target as the table measured it: the minute's mid high (a long) or low (a short) reaches Friday's mid.
        if (side > 0 and (bh + ah) / 2 >= t["fmid"]) or (side < 0 and (bl + al) / 2 <= t["fmid"]):
            return side * math.log(t["fmid"] / entry) - 2 / BPS, "target", BPS * worst
    last = [m for m in path if m[0] <= end][-1]
    return side * math.log(((last[4] + last[8]) / 2) / entry) - 2 / BPS, "time", BPS * worst


def stats(x):
    n = len(x)
    m = sum(x) / n
    sd = math.sqrt(sum((v - m) ** 2 for v in x) / (n - 1))
    rng = random.Random(20261014)
    means = sorted(sum(x[rng.randrange(n)] for _ in range(n)) / n for _ in range(10000))
    return {"n": n, "mean_bps": round(BPS * m, 2), "t": round(m / (sd / math.sqrt(n)), 2), "worst_bps": round(BPS * min(x), 1),
            "boot95_bps": [round(BPS * means[250], 2), round(BPS * means[9749], 2)]}


def q(xs, p):
    xs = sorted(xs)
    pos = p * (len(xs) - 1)
    lo = math.floor(pos)
    return xs[lo] + (xs[min(lo + 1, len(xs) - 1)] - xs[lo]) * (pos - lo)


def main():
    trs = trades()
    if "--pull" in sys.argv:
        pull(trs)
    paths = load_paths()
    have = [t for t in trs if t["sun_utc"] in paths and len(paths[t["sun_utc"]]) >= 1200]
    out = {"trades": len(trs), "with_minutes": len(have), "missing": [dt.datetime.fromtimestamp(t["sun_utc"], UTC).isoformat() for t in trs if t not in have]}
    # The check: the table's 24 h mid extremes and fill minute, recomputed from the minutes.
    agree_hi = agree_fill = 0
    for t in have:
        p = [m for m in paths[t["sun_utc"]] if m[0] < t["sun_utc"] + 24 * 3600]
        hi = max((m[2] + m[6]) / 2 for m in p)
        lo = min((m[3] + m[7]) / 2 for m in p)
        agree_hi += abs(hi - t["hi"]) < 1e-9 and abs(lo - t["lo"]) < 1e-9
        up = t["g"] > 0
        touch = next(((m[0] - t["sun_utc"]) // 60 for m in p if ((m[3] + m[7]) / 2 <= t["fmid"] if up else (m[2] + m[6]) / 2 >= t["fmid"])), None)
        agree_fill += touch == t["fill"] or (touch is None and t["fill"] is None)
    out["check_table_extremes_equal"] = f"{agree_hi} of {len(have)}"
    out["check_table_fill_minute_equal"] = f"{agree_fill} of {len(have)}"
    for s in SPREADS:
        base = [run(t, paths[t["sun_utc"]], s) for t in have]
        block = {"no_stop": {**stats([b[0] for b in base]), "target_share": round(sum(b[1] == "target" for b in base) / len(base), 3)}}
        maes = [b[2] for b in base]
        block["adverse_excursion_exit_side_bps"] = {k: round(q(maes, v), 1) for k, v in (("p50", .5), ("p75", .75), ("p90", .9), ("p95", .95), ("max", 1.0))}
        for d in DISTANCES:
            for g, name in ((False, "stop"), (True, "gsl")):
                rs = [run(t, paths[t["sun_utc"]], s, d, g) for t in have]
                block[f"{name}_{d}"] = {**stats([r[0] for r in rs]), "stopped": sum(r[1] == "stop" for r in rs),
                                        "target_share": round(sum(r[1] == "target" for r in rs) / len(rs), 3)}
        out[f"spread_{s}"] = block
    path = os.path.join(HERE, "results", "fxw_paths.json")
    with open(path, "w") as fh:
        json.dump(out, fh, indent=1, sort_keys=True)
        fh.write("\n")
    print(json.dumps({k: v for k, v in out.items() if not k.startswith("spread_")}, indent=1))
    for s in SPREADS:
        b = out[f"spread_{s}"]
        print(s, "no stop", b["no_stop"], "MAE", b["adverse_excursion_exit_side_bps"])
        for d in DISTANCES:
            print("   ", d, "stop", {k: b[f"stop_{d}"][k] for k in ("mean_bps", "t", "worst_bps", "stopped")}, "gsl", {k: b[f"gsl_{d}"][k] for k in ("mean_bps", "t", "worst_bps", "stopped")})


if __name__ == "__main__":
    main()
