"""PMLATE, the count family (feasibility, exploration): when a post-count bucket is decided, and what is left to take.

For every closed post-count event with walked prints: the window from its rules ("between <Month D>, <h:mm AM/PM> ET
and <Month D>, <YYYY>, <h:mm AM/PM> ET"), the tracker's posts in it (posted and captured instants), the running count
by post time (the platform) and by capture time (the resolution source's counter), and for each bucket the post that
killed it (the count passed its top) or locked it ("N or more" reached): the market's price before, and every
stale-side print (a taker selling a dead bucket's YES or buying its NO; buying a locked bucket's YES or selling its
NO) timed against the post and the capture. Basis: the winning bucket against the tracker's count at the window's
end, at the market's close, and now. Net edge as in `explore.py` (each market's own fee schedule).

usage: count_measure.py <universe file> <out json>
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import count_common as K  # noqa: E402
from explore import fee  # noqa: E402

HANDLE = {"trump-truth-social": "realDonaldTrump", "elon-tweets": "elonmusk", "elon-tweets-48h": "elonmusk",
          "elon-tweet-daily": "elonmusk", "whitehouse-daily-tweets": "WhiteHouse", "khamenei-daily-tweets": "khamenei_ir",
          "ted-cruz-daily-tweets": "tedcruz", "zelenskyy-tweets": "ZelenskyyUa", "nycmayor-tweets": "NYCMayor",
          "cz-tweets": "cz_binance", "andrew-tate-tweets": "Cobratate"}
ET = ZoneInfo("America/New_York")
WIN = re.compile(r"(?:between|from)\s+(?P<m1>[A-Z][a-z]+)\s+(?P<d1>\d+),?\s*(?:(?P<y1>\d{4}),?\s*)?(?P<h1>\d+):(?P<n1>\d+)\s*(?P<p1>[AP]M)\s*ET"
                 r"\s+(?:and|to)\s+(?P<m2>[A-Z][a-z]+)\s+(?P<d2>\d+),?\s*(?:(?P<y2>\d{4}),?\s*)?(?P<h2>\d+):(?P<n2>\d+)\s*(?P<p2>[AP]M)\s*ET")


def window(desc, end_ts):
    m = WIN.search(desc or "")
    if not m:
        return None
    y_end = datetime.utcfromtimestamp(end_ts).year if end_ts else None

    def at(mon, d, y, h, n, p):
        mo = C.MONTHS[mon.lower()]
        y = int(y) if y else y_end
        h = int(h) % 12 + (12 if p == "PM" else 0)
        return datetime(y, mo, int(d), h, int(n), tzinfo=ET).timestamp()
    t1 = at(m["m2"], m["d2"], m["y2"], m["h2"], m["n2"], m["p2"])
    t0 = at(m["m1"], m["d1"], m["y1"], m["h1"], m["n1"], m["p1"])
    if t0 > t1:  # a window across the new year
        t0 = at(m["m1"], m["d1"], str(datetime.utcfromtimestamp(t1).year - 1), m["h1"], m["n1"], m["p1"])
    return t0, t1


def yes_of(side01, oi, price):
    side = "BUY" if side01 == 0 else "SELL"
    if oi == 0:
        return side, price
    if oi == 1:
        return ("SELL" if side == "BUY" else "BUY"), 1.0 - price
    return None, None


def main():
    uni = C.load_json(sys.argv[1])["events"]
    outp = sys.argv[2]
    q = lambda xs, p: xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None  # noqa: E731
    res, basis, lags = [], Counter(), []
    for e in sorted(uni.values(), key=lambda x: x["event"]):
        if e["family"] != "posts" or e["series"] not in HANDLE:
            continue
        pth = os.path.join(C.DATA, "count", "prints", f"ev_{e['event']}.json")
        if not C.pmnet.exists(pth):
            continue
        dpath = os.path.join(C.DATA, "count", "desc", f"ev_{e['event']}.json")
        if C.pmnet.exists(dpath):
            desc = C.load_json(dpath)["d"]
        else:
            g = C.pmnet.get(C.GAMMA + "/events/" + e["event"])
            desc = (g.get("markets") or [{}])[0].get("description") or g.get("description") or ""
            C.dump_json(dpath, {"d": desc})
        w = window(desc, e["end"])
        if not w:
            basis["no_window"] += 1
            continue
        t0, t1 = w
        iso0 = datetime.utcfromtimestamp(t0).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        iso1 = datetime.utcfromtimestamp(t1 - 1).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        posts = K.xt_posts(HANDLE[e["series"]], iso0, iso1, os.path.join(C.DATA, "count", "xt"))
        if not posts:
            basis["no_tracker_posts"] += 1
            continue
        cre = sorted(p[0] for p in posts if p[0])
        imp = sorted(p[1] for p in posts if p[1])
        lags += [p[1] - p[0] for p in posts if p[0] and p[1]]
        closed = max((m["closed_time"] or 0) for m in e["markets"])
        n_end = sum(1 for t in imp if t < t1)
        n_close = sum(1 for t in imp if t < closed) if closed else None
        n_now = len(posts)
        win = [m for m in e["markets"] if m["payout_yes"] == 1.0]
        def inb(b, n):
            return b is not None and (b[0] is None or n >= b[0]) and (b[1] is None or n <= b[1])
        if win and win[0]["bucket"]:
            wb = win[0]["bucket"]
            basis["events"] += 1
            basis["agree_now"] += inb(wb, n_now)
            basis["agree_at_end"] += inb(wb, n_end)
            basis["agree_at_close"] += inb(wb, n_close) if n_close is not None else 0
        pr = C.load_json(pth)
        rows = pr["rows"]
        by_c = defaultdict(list)
        for r in rows:
            by_c[r[1]].append(r)
        ev_out = {"event": e["event"], "series": e["series"], "title": e["title"], "t0": t0, "t1": t1, "closed": closed,
                  "n_now": n_now, "n_end": n_end, "n_close": n_close, "winner": win[0]["bucket"] if win else None,
                  "complete": pr.get("complete"), "buckets": []}
        for i, m in enumerate(e["markets"]):
            b = m["bucket"]
            if not b:
                continue
            lo, hi = b
            k = (hi + 1) if hi is not None else lo
            state = "dead" if hi is not None else "locked"
            if not k or k > len(cre):
                continue
            t_post, t_cap = cre[k - 1], (imp[k - 1] if k <= len(imp) else None)
            if t_post >= t1:
                continue
            prs = sorted(by_c.get(i, []))
            pre = [r for r in prs if t_post - 3600 <= r[0] < t_post]
            pre_y = yes_of(pre[-1][2], pre[-1][3], pre[-1][4])[1] if pre else None
            won = m["payout_yes"] == 1.0
            wrong = (state == "dead" and won) or (state == "locked" and not won)
            wins = defaultdict(lambda: [0, 0.0, 0.0])
            late = {lag: {th: [0.0, 0.0, 0] for th in (0.005, 0.01, 0.02, 0.05)} for lag in (60, 120, 300)}
            late_cap = {th: [0.0, 0.0, 0] for th in (0.005, 0.01, 0.02, 0.05)}
            for r in prs:
                if r[0] < t_post - 3600:
                    continue
                d, y = yes_of(r[2], r[3], r[4])
                if d is None or not ((state == "dead" and d == "SELL") or (state == "locked" and d == "BUY")):
                    continue
                g = y if state == "dead" else 1 - y
                net = max(g - fee(m["fee_rate"] or 0.0, y), 0)
                dt = r[0] - t_post
                wn = ("before_post" if dt < 0 else "post+0_60" if dt < 60 else "post+60_120" if dt < 120 else
                      "post+120_300" if dt < 300 else "post+300_3600" if dt < 3600 else "post+1h+")
                wins[wn][0] += 1
                wins[wn][1] += r[5] * net
                wins[wn][2] += r[5] * (1 - y if state == "dead" else y)
                for lag, byth in late.items():
                    if dt >= lag:
                        for th, acc in byth.items():
                            if g >= th:
                                acc[0] += r[5] * net; acc[1] += r[5] * (1 - y if state == "dead" else y); acc[2] += 1
                if t_cap and r[0] >= t_cap + 60:
                    for th, acc in late_cap.items():
                        if g >= th:
                            acc[0] += r[5] * net; acc[1] += r[5] * (1 - y if state == "dead" else y); acc[2] += 1
            ev_out["buckets"].append({"bucket": b, "state": state, "post": t_post, "cap": t_cap, "pre_y": pre_y,
                                      "informative": pre_y is not None and ((state == "dead" and pre_y >= 0.05) or (state == "locked" and pre_y <= 0.95)),
                                      "wrong": wrong, "closed": m["closed_time"], "fee_rate": m["fee_rate"],
                                      "win": {k2: v for k2, v in wins.items()},
                                      "late": {str(l): {str(th): v for th, v in bt.items()} for l, bt in late.items()},
                                      "late_cap": {str(th): v for th, v in late_cap.items()}})
        res.append(ev_out)
    lags.sort()
    summ = {"basis": dict(basis), "events": len(res), "capture_lag_s": {"n": len(lags), "p10": q(lags, 0.1), "p50": q(lags, 0.5),
                                                                        "p90": q(lags, 0.9), "p99": q(lags, 0.99)}}
    for lab, sel in (("informative_held", lambda b: b["informative"] and not b["wrong"]),
                     ("other_held", lambda b: (not b["informative"]) and not b["wrong"]), ("wrong", lambda b: b["wrong"])):
        tot = defaultdict(lambda: [0, 0.0, 0.0])
        n = 0
        late = defaultdict(lambda: [0.0, 0.0, 0])
        for ev in res:
            for b in ev["buckets"]:
                if not sel(b):
                    continue
                n += 1
                for k2, v in b["win"].items():
                    tot[k2][0] += v[0]; tot[k2][1] += v[1]; tot[k2][2] += v[2]
                for lag, bt in b["late"].items():
                    for th, v in bt.items():
                        a = late[f"post+{lag}s g>={th}"]; a[0] += v[0]; a[1] += v[1]; a[2] += (1 if v[2] else 0)
                for th, v in b["late_cap"].items():
                    a = late[f"capture+60s g>={th}"]; a[0] += v[0]; a[1] += v[1]; a[2] += (1 if v[2] else 0)
        summ[lab] = {"buckets": n, "windows": {k2: {"prints": v[0], "net_edge_usd": round(v[1], 2), "cost_usd": round(v[2], 2)} for k2, v in tot.items()},
                     "late": {k2: {"net_edge_usd": round(v[0], 2), "cost_usd": round(v[1], 2), "buckets_with_prints": v[2]} for k2, v in sorted(late.items())}}
    drops = []
    for ev in res:
        for b in ev["buckets"]:
            if b["informative"] and not b["wrong"]:
                drops.append(b)
    C.dump_json(outp, {"summary": summ, "events": res})
    print(json.dumps(summ, indent=1, sort_keys=True)[:7000])


if __name__ == "__main__":
    main()
