"""RW data after the window: every universe market's prints over the window, and how it stands now (fp4).

For each market of $PM_DATA/rw/universe.json: its taker prints between the
first and last recorded book round (/v2/trades?condition=, newest first, walked
back to the window's start), and its Gamma record now (closed, final payout),
so a market that resolved inside the window is marked at its payout. Writes
$PM_DATA/rw/prints/<cond>.json and $PM_DATA/rw/status.json.
"""
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

DATA_API = "https://data-api.polymarket.com"
GAMMA = "https://gamma-api.polymarket.com"


def main():
    base = os.path.join(pmnet.DATA, "rw")
    uni = pmnet.load(os.path.join(base, "universe.json"))["markets"]
    minutes = sorted(int(os.path.basename(p)[:-5]) for p in glob.glob(os.path.join(base, "books", "*.json")))
    t_lo, t_hi = minutes[0], minutes[-1] + 120
    os.makedirs(os.path.join(base, "prints"), exist_ok=True)
    # optional sharding (k of n) so several processes can pull disjoint markets at once; shard 0 also reads the status
    k, n_sh = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (0, 1)
    n = 0
    for i, c in enumerate(sorted(uni)):
        if i % n_sh != k:
            continue
        path = os.path.join(base, "prints", c + ".json")
        if pmnet.exists(path):
            continue
        rows, cursor, pages, complete = [], None, 0, False
        while True:
            params = {"condition": c, "limit": 1000}
            if cursor:
                params["cursor"] = cursor
            d = pmnet.get(DATA_API + "/v2/trades", params)
            data = d.get("data") or []
            pages += 1
            for r in data:
                if t_lo <= r.get("timestamp", 0) <= t_hi:
                    rows.append([r.get("timestamp"), r.get("side"), r.get("outcome_index"), r.get("price"), r.get("size")])
            cursor = (d.get("pagination") or {}).get("next_cursor")
            if not cursor or not data or data[-1].get("timestamp", 0) < t_lo:
                complete = True
                break
            if pages >= 300:
                break
        pmnet.dump(path, {"t_lo": t_lo, "t_hi": t_hi, "complete": complete, "rows": sorted(rows)})
        n += 1
        if n % 250 == 0:
            print("prints", n, flush=True)
    if k != 0:
        print("done", n)
        return
    status = {}
    conds = sorted(uni)
    for i in range(0, len(conds), 50):
        chunk = conds[i:i + 50]
        for closed in ("false", "true"):
            d = pmnet.get(GAMMA + "/markets/keyset", {"condition_ids": chunk, "limit": 100, "closed": closed})
            for m in d.get("markets") or []:
                status[m["conditionId"]] = {"closed": m.get("closed"), "closedTime": m.get("closedTime"),
                                            "outcomePrices": m.get("outcomePrices"), "umaResolutionStatuses": m.get("umaResolutionStatuses")}
    pmnet.dump(os.path.join(base, "status.json"), status)
    print("done", n, "status", len(status))


if __name__ == "__main__":
    main()
