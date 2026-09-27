"""HARVEST: who was on the resting side of the late prints — a sample of markets per category, read with maker rows.

For each category, the markets with the largest Mode B flow at C + 60 s (ten) and ten more by a fixed rule (the
markets with any Mode B print at C + 60 s, sorted by condition id, every k-th), walked twice from their newest print
back to C: `/v2/trades?condition=&taker_only=false` (every fill's taker AND maker rows) and `taker_only=true` (the
taker rows). A row of the first walk that the second walk also holds (same transaction, wallet, side, size) is a
taker; every other row is a maker. Rows are [ts, is_taker, side (0 BUY / 1 SELL), outcome index, price, size, wallet
tail (10 hex), tx tail (10 hex)]. Exploration markets only, closed before the cut (hcommon.walk guard).
Writes the committed input `inputs/maker_sample.json.gz`.

usage: maker_pull.py <out json.gz> <category input json.gz> [...]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hcommon as H  # noqa: E402
from harvest import classify  # noqa: E402

TOP, EXTRA = 10, 10


def walk(cond, floor, taker_only, closed):
    if closed is None or closed >= H.CUT:
        raise ValueError("refused: " + cond)
    path = os.path.join(H.DATA, "maker", f"{cond}_{'t' if taker_only else 'all'}.json")
    if H.exists(path):
        return H.load(path)["rows"]
    rows, cursor, pages = [], None, 0
    at = H.bust()
    while pages < 200:
        params = {"condition": cond, "limit": 1000, "taker_only": "true" if taker_only else "false", "_": at}
        if cursor:
            params["cursor"] = cursor
        d = H.pmnet.get(H.DATA_API + "/v2/trades", params)
        data = (d or {}).get("data") or []
        pages += 1
        for r in data:
            t = int(r.get("timestamp") or 0)
            if t >= H.CUT:
                raise RuntimeError("print after the cut")
            if t >= floor:
                rows.append([t, 0 if r.get("side") == "BUY" else 1, r.get("outcome_index"),
                             round(float(r.get("price") or 0), 6), round(float(r.get("size") or 0), 6),
                             str(r.get("proxy_wallet") or "")[-10:], str(r.get("transaction_hash") or "")[-10:]])
        cursor = ((d or {}).get("pagination") or {}).get("next_cursor")
        if not cursor or not data or int(data[-1].get("timestamp") or 0) < floor:
            break
    rows = sorted({tuple(x) for x in rows})
    H.dump(path, {"cond": cond, "floor": floor, "rows": [list(x) for x in rows]})
    return [list(x) for x in rows]


def main():
    out = {}
    for f in sys.argv[2:]:
        inp = H.jfile(f)
        cat = inp["category"]
        flows = []
        for u in inp["units"]:
            if u.get("record_ok") is False or (u["closed"] or 0) <= u["C"]:
                continue
            v = 0.0
            for r in inp["prints"].get(u["cond"], []):
                if r[0] < u["C"] + 60:
                    continue
                k = classify(u, r)
                if k and k[0] == "B":
                    v += (1.0 - k[1]) * k[2]
            if v > 0:
                flows.append((v, u["cond"], u))
        flows.sort(key=lambda x: (-x[0], x[1]))
        chosen = [x[2] for x in flows[:TOP]]
        rest = sorted((x for x in flows[TOP:]), key=lambda x: x[1])
        step = max(1, len(rest) // EXTRA) if rest else 1
        chosen += [x[2] for x in rest[::step][:EXTRA]]
        mk = {}
        for u in chosen:
            floor = int(u["C"])
            allr = walk(u["cond"], floor, False, u["closed"])
            tak = walk(u["cond"], floor, True, u["closed"])
            tk = {}
            for r in tak:
                key = (r[6], r[5], r[1], r[4])
                tk[key] = tk.get(key, 0) + 1
            rows = []
            for r in allr:
                key = (r[6], r[5], r[1], r[4])
                is_t = 1 if tk.get(key, 0) > 0 else 0
                if is_t:
                    tk[key] -= 1
                rows.append([r[0], is_t, r[1], r[2], r[3], r[4], r[5], r[6]])
            mk[u["cond"]] = {"unit": {k: u[k] for k in ("event", "cond", "q", "C", "w", "r", "closed")},
                             "top": u in [x[2] for x in flows[:TOP]], "rows": rows}
        out[cat] = mk
        print(cat, "markets", len(mk), "rows", sum(len(v["rows"]) for v in mk.values()), flush=True)
    H.write_json(sys.argv[1], out, gz=True)


if __name__ == "__main__":
    main()
