"""GROKPM thin-rule study (2026-10-26), step 2: what a small post-only bid would have done in each thin-stopped clear.

Run from the repository root:
  python3 -I docs/agents/backtests/grokpm_thin/scripts/study.py > docs/agents/backtests/grokpm_thin/results/study.txt

Inputs: data/clears.json (sql/clears.sql) and data/public.json.gz (scripts/fetch.py). Not blind.

The bid: the highest price the server's D3 edge rule allows (p - bar, to the cent: A 8 points, B 12), and post-only, so
one tick under the ask the agent's row saw. Its sizes: $1, $2, $5 and the rule's own (a quarter Kelly of the $100 budget
at p and the bid, at most $10), each at least the venue's 5-share minimum (a size under it cannot be placed: shown as
"min"). A fill is the public taker tape trading through the bid after the row: a taker selling the token at the bid or
under, or buying the other outcome at 1 - bid or over (the venue mints the pair), up to the order's size, queue ignored
(so it overstates fills). Two lives: "rest" (re-placed every wake until the market closes or now) and "wake" (alive only
while the agent's rows still cleared the bar, plus one 35-minute GTD). The mark: the payout once resolved, else the
token's book mid now (else Gamma's price). Maker fees 0.
"""
import gzip
import json
import math
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
SIZES = [1.0, 2.0, 5.0]
MIN_SHARES = 5


def ts(s):
    return time.mktime(time.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone


def depth(levels, mid, band=0.05):
    return sum(float(l["price"]) * float(l["size"]) for l in levels if mid is not None and float(l["price"]) >= mid - band - 1e-9)


def main():
    cl = json.load(open(os.path.join(DATA, "clears.json")))
    pub = json.load(gzip.open(os.path.join(DATA, "public.json.gz")))
    now = ts(pub["read_at"])
    t_start, t_end = ts(cl["window"][0]), ts(cl["window"][1])
    days = (t_end - t_start) / 86400
    print(f"GROKPM thin-rule study: clears {cl['window'][0]} to {cl['window'][1]} ({days:.2f} days); public record read {pub['read_at']}. Not blind.\n")
    print("market                                   | cat | p     | book at row    | bid  | tick  | rule $ | min $ | tape fills (rest / wake), shares | outcome or mark now | P&L per $1 if filled | book now: spread, bid $ within 5 pts")
    rows_out = []
    for r in cl["rows"]:
        m = pub["markets"][r["market_id"]]
        g = m["gamma"]
        bid0, ask0 = (r["book_bid"], r["book_ask"]) if r["book_bid"] is not None else tuple(r["stated_book"])
        bar = 0.08 if r["category"] == "A" else 0.12
        tick = float(g.get("orderPriceMinTickSize") or 0.01)
        b = math.floor((r["p"] - bar) * 100 + 1e-9) / 100
        if ask0 is not None and b >= ask0 - 1e-9:
            b = round(math.floor((ask0 - tick) / tick + 1e-9) * tick, 4)
        rule = min(10.0, 0.25 * (r["p"] - b) / (1 - b) * 100)
        min_usd = MIN_SHARES * b
        toks = json.loads(g["clobTokenIds"])
        other = [x for x in toks if x != r["token_id"]][0]
        t0, close = ts(r["ts"]), (ts(g["closedTime"].replace(" ", "T")) if g.get("closedTime") else now)
        wake_end = min(ts(r["last_clear_ts"]) + 35 * 60, close)

        def through(t1):
            q = 0.0
            for x in m["taker_trades"]:
                tt, px, sz = x["timestamp"], float(x["price"]), float(x["size"])
                if t0 <= tt <= t1 and ((x["asset"] == r["token_id"] and x["side"] == "SELL" and px <= b + 1e-9) or (x["asset"] == other and x["side"] == "BUY" and px >= 1 - b - 1e-9)):
                    q += sz
            return q

        rest, wake = through(close), through(wake_end)
        if g.get("closed"):
            prices = json.loads(g["outcomePrices"])
            y = float(prices[toks.index(r["token_id"])])
            mark, mark_kind = y, "paid"
        else:
            bk = m["book_now"]
            bids = sorted((float(l["price"]) for l in bk["bids"]), reverse=True)
            asks = sorted(float(l["price"]) for l in bk["asks"])
            mid = (bids[0] + asks[0]) / 2 if bids and asks else None
            prices = json.loads(g["outcomePrices"])
            mark = mid if mid is not None else float(prices[toks.index(r["token_id"])])
            mark_kind = "mid now"
        bk = m["book_now"]
        bids = sorted((float(l["price"]) for l in bk["bids"]), reverse=True)
        asks = sorted(float(l["price"]) for l in bk["asks"])
        midn = (bids[0] + asks[0]) / 2 if bids and asks else None
        dep = depth(bk["bids"], midn)
        spr = f"{(asks[0] - bids[0]) * 100:.1f} pts, ${dep:.0f}" if bids and asks else "closed"
        per1 = (mark - b) / b
        print(f"{r['name'][:40]:<40} | {r['category']}   | {r['p']:.3f} | {bid0:.3f}/{ask0 if ask0 is not None else 'none'} | {b:.3f} | {tick:<5} | {rule:6.2f} | {min_usd:5.2f} | "
              f"{rest:8.1f} / {wake:8.1f} | {mark:.3f} ({mark_kind}) | {per1:+.3f} | {spr}")
        rows_out.append(dict(name=r["name"], cat=r["category"], b=b, rule=rule, min_usd=min_usd, rest=rest, wake=wake, mark=mark, closed=bool(g.get("closed")),
                             per1=per1, far=(ts((g.get("endDate") or r["ts"])[:19]) - t0) / 86400, depth_now=dep))

    for life in ("wake", "rest"):
      print(f"\nBy size ({life} fills: {'alive while the rows clear, plus one GTD' if life == 'wake' else 're-placed to the close: generous'}): shares filled, and P&L at the mark in % of the $100 budget")
      for label, size in [("$1", 1.0), ("$2", 2.0), ("$5", 5.0), ("rule", None)]:
        tot, n_place, n_fill, res = 0.0, 0, 0, []
        for x in rows_out:
            usd = x["rule"] if size is None else size
            if usd < x["min_usd"] - 1e-9:
                continue
            n_place += 1
            sh = min(usd / x["b"], x[life])
            if sh > 0:
                n_fill += 1
                pnl = sh * (x["mark"] - x["b"])
                tot += pnl
                res.append(f"{x['name'][:24]} {sh:.1f} sh {pnl:+.2f}{'' if x['closed'] else ' (open)'}")
        print(f"  {label:<5}: placeable in {n_place} of {len(rows_out)} markets; filled in {n_fill}; P&L at marks {tot:+.2f} % of budget  [{'; '.join(res) or '-'}]")
    print(f"\nPer week: multiply by 7 / {days:.2f} = {7 / days:.2f}")
    print("Days from the first clearing row to the market's end date: " + ", ".join(f"{x['name'][:18]} {x['far']:.1f}" for x in rows_out))


if __name__ == "__main__":
    main()
