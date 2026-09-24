"""FAV data step 3: the taker prints after each decision time, for the markets a rule could buy (fp4).

For every market of the universe whose price at some decision time T_d puts one
token at or above PREFILTER (either side), walk its public trade feed
(/v2/trades?condition=..., taker rows only, newest first) back to one hour
before its earliest such T_d and keep every print after that: [ts, side,
outcome_index, price, size]. A print is a real fill; a taker BUY at price p
proves an ask at or below p at that moment. Writes $PM_DATA/fav/trades/<cond>.json.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

DATA_API = "https://data-api.polymarket.com"
PREFILTER = 0.85


def main():
    uni = pmnet.load(os.path.join(pmnet.DATA, "fav", "universe.json"))
    prices = pmnet.load(os.path.join(pmnet.DATA, "fav", "prices.json"))
    outdir = os.path.join(pmnet.DATA, "fav", "trades")
    os.makedirs(outdir, exist_ok=True)
    todo = []
    for m in uni:
        pr = prices.get(m["cond"]) or {}
        tds = [m["tds"][h] for h, x in pr.items() if x and h in m["tds"] and (x[1] >= PREFILTER or x[1] <= 1 - PREFILTER)]
        if tds:
            todo.append((m["cond"], min(tds) - 3600))
    print("markets to pull", len(todo), flush=True)
    n = 0
    for cond, since in todo:
        path = os.path.join(outdir, cond + ".json")
        if os.path.exists(path):
            continue
        rows, cursor, pages, complete = [], None, 0, False
        while True:
            params = {"condition": cond, "limit": 1000}
            if cursor:
                params["cursor"] = cursor
            try:
                d = pmnet.get(DATA_API + "/v2/trades", params)
            except RuntimeError as e:
                print("error", cond, str(e)[:160], flush=True)
                rows = None
                break
            data = d.get("data") or []
            pages += 1
            for r in data:
                if r.get("timestamp", 0) >= since:
                    rows.append([r.get("timestamp"), r.get("side"), r.get("outcome_index"), r.get("price"), r.get("size")])
            cursor = (d.get("pagination") or {}).get("next_cursor")
            if not cursor or not data or data[-1].get("timestamp", 0) < since:
                complete = True
                break
            if pages >= 200:
                break
        if rows is None:
            continue
        # complete: the walk reached `since` (or the market's first print); otherwise the oldest
        # prints are missing and a decision window before rows[-1] cannot be judged
        pmnet.dump(path, {"since": since, "pages": pages, "complete": complete, "rows": rows})
        n += 1
        if n % 200 == 0:
            print("pulled", n, flush=True)
    print("done", n)


if __name__ == "__main__":
    main()
