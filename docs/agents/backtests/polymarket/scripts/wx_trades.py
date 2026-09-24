"""WX data step 4: every print in the hour after the decision time, for every event (fp4, test WX).

The public trade feed filtered by Gamma event id (/v2/trades?event_id=, taker
rows, newest first), walked back to the decision time T_d; the prints in
(T_d, T_d + 60 min] are kept for every bucket: [ts, condition id, side,
outcome_index, price, size]. The walk is marked complete when it reached T_d.
No model is involved in choosing what to pull. Writes $PM_DATA/wx/prints/<event>.json.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402
from wx_prices import HI, LO, t_decision  # noqa: E402

DATA_API = "https://data-api.polymarket.com"
WINDOW = 3600


def main():
    ev = pmnet.load(os.path.join(pmnet.DATA, "wx", "events.json"))
    outdir = os.path.join(pmnet.DATA, "wx", "prints")
    os.makedirs(outdir, exist_ok=True)
    # optional sharding (k of n) so several processes can walk disjoint events at once
    k, n_sh = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (0, 1)
    n = 0
    for e in ev["events"]:
        if not (LO <= e["date"] < HI) or not e.get("station"):
            continue
        eid = str(e["event"])
        if not eid.isdigit() or int(eid) % n_sh != k:
            continue
        path = os.path.join(outdir, eid + ".json")
        if os.path.exists(path):
            continue
        td = t_decision(e["date"])
        rows, cursor, pages, complete = [], None, 0, False
        while True:
            params = {"event_id": eid, "limit": 1000}
            if cursor:
                params["cursor"] = cursor
            try:
                d = pmnet.get(DATA_API + "/v2/trades", params)
            except RuntimeError as err:
                print("error", eid, str(err)[:120], flush=True)
                rows = None
                break
            data = d.get("data") or []
            pages += 1
            for r in data:
                t = r.get("timestamp", 0)
                if td < t <= td + WINDOW:
                    rows.append([t, r.get("condition_id"), r.get("side"), r.get("outcome_index"), r.get("price"), r.get("size")])
            cursor = (d.get("pagination") or {}).get("next_cursor")
            if not cursor or not data or data[-1].get("timestamp", 0) <= td:
                complete = True
                break
            if pages >= 150:
                break
        if rows is None:
            continue
        pmnet.dump(path, {"td": td, "pages": pages, "complete": complete, "rows": sorted(rows)})
        n += 1
        if n % 200 == 0:
            print("events", n, flush=True)
    print("done", n)


if __name__ == "__main__":
    main()
