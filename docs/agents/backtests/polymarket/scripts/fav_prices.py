"""FAV data step 2: each candidate market's price at each decision time (fp4).

For every market of $PM_DATA/fav/universe.json and every horizon it was open
at, the last hourly point of the first token's price series at or before the
decision time T_d (the CLOB's public batch price history, 20 tokens a request,
window [T_d - 6 h, T_d], 60-minute fidelity). The price read is what the loop
would have read at T_d; nothing after T_d is requested. Writes
$PM_DATA/fav/prices.json: {cond: {h: [t, p] or null}}.
"""
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

CLOB = "https://clob.polymarket.com"


def main():
    uni = pmnet.load(os.path.join(pmnet.DATA, "fav", "universe.json"))
    path = os.path.join(pmnet.DATA, "fav", "prices.json")
    have = pmnet.load(path) if os.path.exists(path) else {}
    groups = defaultdict(list)
    for m in uni:
        for h, td in m["tds"].items():
            if have.get(m["cond"], {}).get(h, "missing") != "missing":
                continue
            groups[int(td)].append((m["cond"], h, m["tokens"][0]))
    todo = sorted(groups.items())
    done = 0
    for td, items in todo:
        for i in range(0, len(items), 20):
            chunk = items[i:i + 20]
            body = {"markets": [t for _, _, t in chunk], "start_ts": td - 6 * 3600, "end_ts": td, "fidelity": 60}
            try:
                d = pmnet.post(CLOB + "/batch-prices-history", body)
            except RuntimeError as e:
                print("error", td, str(e)[:200], flush=True)
                continue
            hist = d.get("history") or {}
            for cond, h, tok in chunk:
                pts = [p for p in (hist.get(tok) or []) if p.get("t") is not None and p["t"] <= td]
                have.setdefault(cond, {})[h] = [pts[-1]["t"], pts[-1]["p"]] if pts else None
            done += 1
            if done % 200 == 0:
                pmnet.dump(path, have)
                print("requests", done, "groups left", len(todo), flush=True)
    pmnet.dump(path, have)
    n = sum(len(v) for v in have.values())
    print("done", n, "prices", sum(1 for v in have.values() for x in v.values() if x))


if __name__ == "__main__":
    main()
