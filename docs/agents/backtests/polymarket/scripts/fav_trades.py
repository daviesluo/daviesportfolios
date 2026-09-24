"""FAV data step 3: the taker prints after each decision time, for the markets a rule could buy (fp4).

For every market of the universe whose price at some decision time T_d puts one
token at or above PREFILTER (either side), the public trade feed is walked
newest first back to one hour before the earliest such T_d. The walk is made
per Gamma EVENT (/v2/trades?event_id=, taker rows), which returns the same prints
as walking each market (/v2/trades?condition=) with one walk for all the markets
of an event; a market without an event is walked by condition. Only the prints of
candidate markets are kept: [ts, condition id, side, outcome_index, price, size].
A print is a real fill; a taker BUY at price p proves an ask at or below p then.
Writes $PM_DATA/fav/trades_ev/<event or condition>.json with `complete` = the walk
reached `since`.
"""
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

DATA_API = "https://data-api.polymarket.com"
PREFILTER = 0.85
MAX_PAGES = 400


def walk(params_base, since, keep):
    rows, cursor, pages, complete = [], None, 0, False
    while True:
        params = dict(params_base, limit=1000)
        if cursor:
            params["cursor"] = cursor
        d = pmnet.get(DATA_API + "/v2/trades", params)
        data = d.get("data") or []
        pages += 1
        for r in data:
            if r.get("timestamp", 0) >= since and r.get("condition_id") in keep:
                rows.append([r.get("timestamp"), r.get("condition_id"), r.get("side"), r.get("outcome_index"), r.get("price"), r.get("size")])
        cursor = (d.get("pagination") or {}).get("next_cursor")
        if not cursor or not data or data[-1].get("timestamp", 0) < since:
            complete = True
            break
        if pages >= MAX_PAGES:
            break
    return rows, pages, complete


def main():
    uni = pmnet.load(os.path.join(pmnet.DATA, "fav", "universe.json"))
    prices = pmnet.load(os.path.join(pmnet.DATA, "fav", "prices.json"))
    outdir = os.path.join(pmnet.DATA, "fav", "trades_ev")
    os.makedirs(outdir, exist_ok=True)
    groups = defaultdict(lambda: {"since": None, "conds": set()})
    for m in uni:
        pr = prices.get(m["cond"]) or {}
        tds = [m["tds"][h] for h, x in pr.items() if x and h in m["tds"] and (x[1] >= PREFILTER or x[1] <= 1 - PREFILTER)]
        if not tds:
            continue
        key = ("event", str(m["event"])) if m.get("event") else ("condition", m["cond"])
        g = groups[key]
        s = min(tds) - 3600
        g["since"] = s if g["since"] is None else min(g["since"], s)
        g["conds"].add(m["cond"])
    todo = sorted(groups.items(), key=lambda kv: kv[0])
    print("walks", len(todo), "markets", sum(len(g["conds"]) for _, g in todo), flush=True)
    n = 0
    for (kind, ident), g in todo:
        path = os.path.join(outdir, f"{kind}_{ident}.json")
        if os.path.exists(path):
            continue
        base = {"event_id": ident} if kind == "event" else {"condition": ident}
        try:
            rows, pages, complete = walk(base, g["since"], g["conds"])
        except RuntimeError as e:
            print("error", kind, ident, str(e)[:160], flush=True)
            continue
        pmnet.dump(path, {"since": g["since"], "pages": pages, "complete": complete, "conds": sorted(g["conds"]), "rows": rows})
        n += 1
        if n % 200 == 0:
            print("walked", n, flush=True)
    print("done", n)


if __name__ == "__main__":
    main()
