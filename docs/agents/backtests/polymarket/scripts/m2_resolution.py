"""M2: how Polymarket markets resolve — disputes, overturns, delays, voids (fp4).

Reads the closed-market pulls ($PM_DATA/closed/*.json, pull_closed.py) and the
resolution lifecycle of every one of them from /v2/resolutions (20 conditions a
request; cached in $PM_DATA/resolutions/<month>.json). Crypto up/down markets
(thousands a day, resolved by Chainlink) are sampled one in ten, by a fixed rule
on the condition id. Only markets with at least $5,000 of lifetime volume are
read. Writes the summary JSON named on the command line.

usage: m2_resolution.py <out json> [first month] [last month]
"""
import glob
import json
import math
import os
import sys
from collections import defaultdict
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

DATA_API = "https://data-api.polymarket.com"
UNSET = "69"
MIN_VOL = 5000.0  # the markets a $10 order could matter in (FAV's universe)


def ts(s):
    if not s:
        return None
    s = s.strip().replace(" ", "T")
    if s.endswith("+00"):
        s += ":00"
    s = s.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s).timestamp()
    except ValueError:
        return None


def q(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * p
    f, c = math.floor(k), math.ceil(k)
    return xs[f] if f == c else xs[f] + (xs[c] - xs[f]) * (k - f)


def cat_of(m):
    ft = m.get("feeType") or ""
    return ft[:-5] if ft.endswith("_fees") else ("none" if not ft else ft)


def is_updown(m):
    s = (m.get("slug") or "") + " " + " ".join((e.get("seriesSlug") or "") for e in m.get("events") or [])
    return "updown" in s or "up-or-down" in s


def price_of(x):
    if x is None or x == UNSET or x == "":
        return None
    try:
        v = float(x)
    except ValueError:
        return None
    return v / 1e18 if v > 10 else v


def resolutions_for(month, conds):
    path = os.path.join(pmnet.DATA, "resolutions", month + ".json")
    have = pmnet.load(path) if os.path.exists(path) else {}
    todo = [c for c in conds if c not in have]
    for i in range(0, len(todo), 20):
        chunk = todo[i:i + 20]
        d = pmnet.get(DATA_API + "/v2/resolutions", {"condition": ",".join(chunk)})
        got = {x.get("condition_id"): x for x in (d.get("data") or [])}
        for c in chunk:
            have[c] = got.get(c)
        if (i // 20) % 50 == 49:
            pmnet.dump(path, have)
    pmnet.dump(path, have)
    return have


def main():
    outp = sys.argv[1]
    lo = sys.argv[2] if len(sys.argv) > 2 else "0000-00"
    hi = sys.argv[3] if len(sys.argv) > 3 else "9999-99"
    files = sorted(f for f in glob.glob(os.path.join(pmnet.DATA, "closed", "*.json")) if lo <= os.path.basename(f)[:7] <= hi)
    rows = []
    for f in files:
        month = os.path.basename(f)[:7]
        ms = [m for m in pmnet.load(f) if m.get("enableOrderBook") and (m.get("volumeNum") or 0) >= MIN_VOL]
        keep = [m for m in ms if not is_updown(m) or int(m["conditionId"][-2:], 16) % 10 == 0]
        res = resolutions_for(month, [m["conditionId"] for m in keep])
        for m in keep:
            try:
                op = [float(x) for x in json.loads(m.get("outcomePrices") or "[]")]
            except ValueError:
                op = []
            x = res.get(m["conditionId"]) or {}
            rows.append({"cond": m["conditionId"], "month": month, "grp": "crypto_updown" if is_updown(m) else cat_of(m),
                         "vol": m.get("volumeNum") or 0.0, "end": ts(m.get("endDate")), "closed": ts(m.get("closedTime")),
                         "op": op, "has_res": bool(x), "was_disputed": x.get("was_disputed"), "status": x.get("status"),
                         "p1": price_of(x.get("proposed_price")), "p2": price_of(x.get("reproposed_price")),
                         "pf": price_of(x.get("price")), "q": (m.get("question") or "")[:100]})
    out = {"months": [os.path.basename(f)[:7] for f in files], "markets": len(rows), "min_volume_usd": MIN_VOL,
           "note": "crypto up/down markets sampled 1 in 10 by the last byte of the condition id"}
    grp = defaultdict(list)
    for r in rows:
        grp[r["grp"]].append(r)
    summ = {}
    for k, rs in sorted(grp.items(), key=lambda x: -len(x[1])):
        n = len(rs)
        dis = [r for r in rs if r["was_disputed"]]
        over = [r for r in dis if r["p1"] is not None and r["pf"] is not None and abs(r["p1"] - r["pf"]) > 1e-9]
        void = [r for r in rs if r["op"] and sorted(r["op"]) != [0.0, 1.0]]
        delays = [(r["closed"] - r["end"]) / 3600 for r in rs if r["closed"] and r["end"]]
        summ[k] = {"n": n, "with_resolution_row": sum(1 for r in rs if r["has_res"]), "vol_usd": round(sum(r["vol"] for r in rs)),
                   "disputed": len(dis), "disputed_per_1000": round(1000 * len(dis) / n, 2),
                   "first_proposal_overturned": len(over), "overturned_per_1000": round(1000 * len(over) / n, 3),
                   "overturned_vol_usd": round(sum(r["vol"] for r in over)),
                   "not_0_1_payout": len(void), "not_0_1_per_1000": round(1000 * len(void) / n, 2),
                   "hours_end_to_close_p10": q(delays, 0.1), "hours_end_to_close_p50": q(delays, 0.5),
                   "hours_end_to_close_p90": q(delays, 0.9),
                   "closed_before_end_share": round(sum(1 for d in delays if d < 0) / max(1, len(delays)), 4)}
    out["by_group"] = summ
    allr = [r for r in rows if r["grp"] != "crypto_updown"]
    dis = [r for r in allr if r["was_disputed"]]
    over = [r for r in dis if r["p1"] is not None and r["pf"] is not None and abs(r["p1"] - r["pf"]) > 1e-9]
    out["all_but_updown"] = {"n": len(allr), "disputed": len(dis), "overturned": len(over),
                             "disputed_per_1000": round(1000 * len(dis) / max(1, len(allr)), 2),
                             "overturned_per_1000": round(1000 * len(over) / max(1, len(allr)), 3)}
    out["overturned_examples"] = [{k: r[k] for k in ("q", "grp", "month", "vol", "p1", "p2", "pf", "op")} for r in sorted(over, key=lambda r: -r["vol"])[:25]]
    pmnet.dump(outp, out)
    print(json.dumps({"markets": len(rows), "all_but_updown": out["all_but_updown"]}, indent=1))


if __name__ == "__main__":
    main()
