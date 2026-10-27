"""PMSAMEBET: price every relation's covers on live CLOB books (keyless POST /books, read only).

A cover's legs are bought at the asks, walked level by level together (the same number of shares on every leg, since
the payoff is per share), each leg paying its market's taker fee rate × (p(1−p))^exponent a share. The walk stops
where the next share's cost reaches the cover's floor. Reported per cover: the touch edge (floor − Σ best asks − fees),
the capacity in shares and dollars while the edge is positive, the profit at capacity, and at $100 and $300 of capital.

snapshot(relations) -> list of rows; used by snapshot.py (one read) and record.py (a read a minute).
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pmnet  # noqa: E402

CLOB = "https://clob.polymarket.com"


def fetch_books(tokens, batch=50):
    out = {}
    tokens = list(tokens)
    for i in range(0, len(tokens), batch):
        chunk = tokens[i:i + batch]
        d = pmnet.post(CLOB + "/books", [{"token_id": t} for t in chunk])
        for b in d or []:
            asks = sorted(((float(x["price"]), float(x["size"])) for x in b.get("asks") or []), key=lambda x: x[0])
            bids = sorted(((float(x["price"]), float(x["size"])) for x in b.get("bids") or []), key=lambda x: -x[0])
            out[b["asset_id"]] = {"asks": asks, "bids": bids, "ts": b.get("timestamp")}
    return out


def fee(p, rate, exp):
    return rate * (p * (1 - p)) ** exp if rate else 0.0


def walk(cover, books, caps=(100.0, 300.0)):
    legs = cover["legs"]
    ladders = []
    for lg in legs:
        b = books.get(lg["token"])
        if not b or not b["asks"]:
            return None
        ladders.append([list(x) for x in b["asks"]])
    floor = cover["floor"]
    touch = sum(lad[0][0] + fee(lad[0][0], lg["fee_rate"], lg["fee_exp"]) for lad, lg in zip(ladders, legs))
    res = {"touch_cost": round(touch, 6), "touch_edge": round(floor - touch, 6), "cap_shares": 0.0, "cap_capital": 0.0,
           "cap_profit": 0.0}
    at = {c: None for c in caps}
    idx = [0] * len(legs)
    rem = [lad[0][1] for lad in ladders]
    shares = capital = profit = 0.0
    while True:
        unit = sum(ladders[i][idx[i]][0] + fee(ladders[i][idx[i]][0], legs[i]["fee_rate"], legs[i]["fee_exp"])
                   for i in range(len(legs)))
        if unit >= floor - 1e-9:
            break
        step = min(rem)
        for c in caps:
            if at[c] is None and capital + step * unit >= c:
                s = (c - capital) / unit
                at[c] = round(profit + s * (floor - unit), 4)
        shares += step
        capital += step * unit
        profit += step * (floor - unit)
        done = False
        for i in range(len(legs)):
            rem[i] -= step
            if rem[i] <= 1e-9:
                idx[i] += 1
                if idx[i] >= len(ladders[i]):
                    done = True
                    break
                rem[i] = ladders[i][idx[i]][1]
        if done:
            break
    res.update({"cap_shares": round(shares, 2), "cap_capital": round(capital, 2), "cap_profit": round(profit, 4)})
    for c in caps:
        res[f"profit_at_{int(c)}"] = at[c] if at[c] is not None else round(profit, 4)
    return res


def snapshot(R, books=None):
    if books is None:
        toks = {lg["token"] for r in R for c in r["covers"] for lg in c["legs"]}
        books = fetch_books(toks)
    t = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    rows = []
    for r in R:
        for c in r["covers"]:
            w = walk(c, books)
            row = {"t": t, "id": r["id"], "family": r["family"], "cover": c["name"], "legs": len(c["legs"]),
                   "end": r["end"]}
            if w is None:
                row["missing_book"] = True
            else:
                row.update(w)
            rows.append(row)
    return rows, books


if __name__ == "__main__":
    R = pmnet.load(os.path.join(pmnet.DATA, "relations.json"))
    rows, _ = snapshot(R)
    print(json.dumps(rows[:3], indent=1))
