"""PMLATE step 1c: the mechanism on RW's two same-day count market-days (a weekly post count and a week-1 view count).

For the post count: the tracker's own record of every post in the window (posted and captured instants), the running
count as the resolution source showed it, the instant each bucket died (the count passed it) or locked, and every
print of every bucket (the data API, walked by event) set against those instants, as `rw_mechanism.py` does for
temperatures. For the view count: every bucket's prints and payout (no running count exists after the fact).

usage: rw_counts.py <post-count event id> <handle> <window start iso> <window end iso> [<view-count event id>]
"""
import os
import sys
import time
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import count_common as K  # noqa: E402
from explore import fee, yes_dir  # noqa: E402


def event_markets(eid):
    d = C.pmnet.get(C.GAMMA + "/events/" + eid)
    out = []
    for m in d.get("markets") or []:
        try:
            op = [float(x) for x in __import__("json").loads(m.get("outcomePrices") or "[]")]
        except ValueError:
            op = []
        b = K.count_bucket(m.get("question"), m.get("groupItemTitle"))
        fs = m.get("feeSchedule") or {}
        out.append({"cond": m.get("conditionId"), "q": (m.get("question") or "")[:110], "bucket": b,
                    "payout": op[0] if op and m.get("closed") else None, "closed_time": C.ts(m.get("closedTime")),
                    "fee_rate": fs.get("rate") if m.get("feesEnabled") else 0.0, "vol": m.get("volumeNum")})
    out.sort(key=lambda x: (x["bucket"][0] if x["bucket"] and x["bucket"][0] is not None else -1))
    return d, out


def event_prints(eid, floor):
    path = os.path.join(C.DATA, "prints", f"ev_{eid}.json")
    if C.pmnet.exists(path):
        return C.load_json(path)["rows"]
    rows, cursor, at = [], None, str(int(time.time() * 1000))
    for _ in range(300):
        params = {"event_id": eid, "limit": 1000, "_": at}
        if cursor:
            params["cursor"] = cursor
        d = C.pmnet.get(C.DATA_API + "/v2/trades", params)
        data = d.get("data") or []
        for r in data:
            t = int(r.get("timestamp") or 0)
            if t >= floor:
                rows.append([t, r.get("condition_id"), r.get("side"), r.get("outcome_index"), float(r.get("price") or 0),
                             float(r.get("size") or 0), str(r.get("proxy_wallet") or "")[-8:], str(r.get("transaction_hash") or "")[-10:]])
        cursor = (d.get("pagination") or {}).get("next_cursor")
        if not cursor or not data or int(data[-1].get("timestamp") or 0) < floor:
            break
    rows = sorted({tuple(r) for r in rows})
    C.dump_json(path, {"event": eid, "floor": floor, "rows": rows})
    return rows


def post_count(eid, handle, w0, w1):
    d, mk = event_markets(eid)
    posts = K.xt_posts(handle, w0, w1, os.path.join(C.DATA, "count"))
    t0, t1 = C.ts(w0), C.ts(w1)
    imp = sorted(p[1] for p in posts)
    cre = sorted(p[0] for p in posts)
    lag = sorted(p[1] - p[0] for p in posts)
    print(d.get("title"), "| posts in window", len(posts), "| capture lag s p10/p50/p90",
          lag[len(lag) // 10], lag[len(lag) // 2], lag[9 * len(lag) // 10])
    rows = event_prints(eid, int(t0) - 86400)
    by_cond = defaultdict(list)
    for r in rows:
        by_cond[r[1]].append(r)
    for b in mk:
        lo, hi = b["bucket"] if b["bucket"] else (None, None)
        # the instant the running count (as captured) killed or locked the bucket, and the post's own instant
        dead_i = (hi + 1) if hi is not None else None      # the (hi+1)-th post kills it
        lock_i = lo if (hi is None and lo is not None) else None
        k = dead_i or lock_i
        state = "dead" if dead_i else ("locked" if lock_i else None)
        t_imp = imp[k - 1] if (k and k <= len(imp)) else None
        t_cre = cre[k - 1] if (k and k <= len(cre)) else None
        prs = sorted(by_cond.get(b["cond"], []))
        line = f"  {str(b['bucket']):14} pay {b['payout']} vol {b['vol'] or 0:9.0f} prints {len(prs):4}"
        if t_imp:
            pre = [r for r in prs if t_cre - 3600 <= r[0] < t_cre]
            pre_y = yes_dir(pre[-1][2], pre[-1][3], pre[-1][4])[1] if pre else None
            tot = defaultdict(lambda: [0, 0.0, 0.0])
            for r in prs:
                if r[0] < t_cre - 3600:
                    continue
                dd, y = yes_dir(r[2], r[3], r[4])
                if dd is None or not ((state == "dead" and dd == "SELL") or (state == "locked" and dd == "BUY")):
                    continue
                g = y if state == "dead" else 1 - y
                net = g - fee(b["fee_rate"] or 0.05, y)
                w = ("<posted" if r[0] < t_cre else "posted..captured" if r[0] < t_imp else
                     "cap+0-120s" if r[0] < t_imp + 120 else "cap+120s+")
                tot[w][0] += 1
                tot[w][1] += r[5] * max(net, 0)
                tot[w][2] = max(tot[w][2], g)
            line += (f" {state} by post #{k} posted {C.iso(t_cre)[5:16]} captured +{t_imp - t_cre:.0f}s pre_y {pre_y}"
                     + "".join(f" | {w}: n {v[0]} net ${v[1]:.2f} max {v[2]:.3f}" for w, v in sorted(tot.items())))
        print(line)
    return mk


def main():
    eid, handle, w0, w1 = sys.argv[1:5]
    post_count(eid, handle, w0, w1)
    if len(sys.argv) > 5:
        d, mk = event_markets(sys.argv[5])
        start = C.ts(d.get("startDate")) or 0
        rows = event_prints(sys.argv[5], int(start))
        by_cond = defaultdict(list)
        for r in rows:
            by_cond[r[1]].append(r)
        print(d.get("title"), "| closed", d.get("closed"))
        for b in mk:
            prs = by_cond.get(b["cond"], [])
            print(f"  {str(b['bucket']):22} pay {b['payout']} vol {b['vol'] or 0:9.0f} prints {len(prs)} closed "
                  f"{C.iso(b['closed_time']) if b['closed_time'] else '-'} | {b['q'][:70]}")


if __name__ == "__main__":
    main()
