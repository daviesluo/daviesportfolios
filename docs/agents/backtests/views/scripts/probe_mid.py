"""VIEWS exploration: is `/prices-history`'s `p` the book's midpoint or the last trade? (printed)

On busy open markets that are NOT view markets (none under tag 146), read the book, the CLOB's `/midpoint`, the last
trade price and the last minutes of `/prices-history` at fidelity 1, several times a minute apart.

usage: probe_mid.py [rounds]
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402


def main():
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    ms = V.pmnet.get(V.GAMMA + "/markets", {"closed": "false", "limit": 40, "order": "volume24hr", "ascending": "false",
                                           "_": V.bust()})
    toks = []
    for m in ms:
        if any(str(t.get("id")) == "146" for t in (m.get("tags") or [])):
            continue
        t = V.jload(m.get("clobTokenIds"), [])
        if len(t) == 2 and m.get("enableOrderBook"):
            toks.append((m.get("question")[:60], t[0]))
        if len(toks) >= 4:
            break
    for r in range(rounds):
        for q, tok in toks:
            b = V.pmnet.get(V.CLOB + "/book", {"token_id": tok, "_": V.bust()})
            bid = max((float(x["price"]) for x in b.get("bids") or []), default=None)
            ask = min((float(x["price"]) for x in b.get("asks") or []), default=None)
            mid = V.pmnet.get(V.CLOB + "/midpoint", {"token_id": tok, "_": V.bust()})
            now = int(time.time())
            h = V.pmnet.get(V.CLOB + "/prices-history", {"market": tok, "startTs": now - 600, "endTs": now, "fidelity": 1,
                                                        "_": V.bust()}).get("history") or []
            print(r, q, "bid", bid, "ask", ask, "mid", mid, "last_trade", b.get("last_trade_price"),
                  "history_last", h[-2:] if h else None, flush=True)
        if r < rounds - 1:
            time.sleep(61)


if __name__ == "__main__":
    main()
