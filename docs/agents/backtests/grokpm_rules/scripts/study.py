"""GROKPM rules study (2026-10-23), step 2: the funnel of the D7 shadow forecasts, their scores, and candidate rule sets.

Run from the repository root:  python3 -I docs/agents/backtests/grokpm_rules/scripts/study.py > docs/agents/backtests/grokpm_rules/results/study.txt

Inputs: data/shadow.json (sql/shadow.sql, the agent's shadow forecasts from D7's start, 2026-10-20 16:58 UTC, to
2026-10-23 04:45 UTC) and data/public.json.gz (scripts/fetch.py: Gamma outcomes, the data API's trade tape, the CLOB's
price history). Not blind: every row was read as it stood (no-peek rules cancelled 2026-10-04).

The book of each row is the one the agent wrote in its reason ("Book 0.012/0.99"); BOOKS below copies it by hand. A row
has no stated depth, so a book is thin here when it is one-sided or its spread is over 5 points (the server's `thin` also
needs $500 bid within 5 points of the mid, which can only make more rows thin). The two Alberta markets' 238 rows never
come within 5 points of any bar (their p − m is at most 4.5 points, shadow.json's `alberta`), so no candidate below opens
them, and neither market has resolved.

A candidate rule set opens a market at its first row that passes every gate the candidate keeps, with a post-only bid at
the highest price the server's D3 edge allows: b = p − bar (to the cent, below the ask), refused when the book's mid is
over p − bar. Its size is the server's quarter Kelly of the $100 budget at p and b, at most $10 a market (or the thin cap).
The bid is filled by the public tape: a taker selling the token at b or under, or buying the other outcome at 1 − b or
over (the venue mints the pair), from the row's time to the market's close, up to the order's size. Two lives are
reported: "rest" (re-placed every wake until the market closes: generous) and "wake" (alive only while the agent's rows
still pass, plus one 35-minute GTD). Maker fees are 0. P&L is per $1 at cost and in percent of the $100 budget.
"""
import gzip
import json
import math
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
D7_START, READ_AT = "2026-10-20T16:58:00Z", "2026-10-23T04:45:00Z"

# Each row's book as the agent stated it (bid, ask); None is "no ask". Gamma's ask of 1.00 on a one-sided book is None.
BOOKS = {
    "2026-10-21T12:05Z-d7-4082027": (0.971, 0.984), "2026-10-21T12:35Z-d7-4082027": (0.963, 0.984),
    "2026-10-21T20:05Z-d7-5412319": (0.31, None), "2026-10-21T20:35Z-d7-5412319": (0.31, None),
    "2026-10-21T21:05Z-d7-5412319": (0.999, None), "2026-10-21T21:35Z-d7-5412319": (0.999, None),
    "2026-10-22T12:05Z-d7-6011608": (0.258, 0.995),
    "2026-10-22T16:05Z-d7-5145476": (0.12, 0.44), "2026-10-22T20:05Z-d7-5145476": (0.03, 0.41),
    "2026-10-22T16:05Z-d7-5145477": (0.54, 0.56), "2026-10-22T20:05Z-d7-5145477": (0.55, 0.56),
    "2026-10-22T16:05Z-d7-5789049": (0.46, 0.56), "2026-10-22T20:05Z-d7-5789049": (0.55, 0.66),
    "2026-10-23T00:05Z-d7-5957694": (0.90, None), "2026-10-23T04:05Z-d7-5957694": (0.96, 0.999),
    "2026-10-23T04:35Z-d7-5957694": (0.96, 0.999),
}
for slot in ("08:05", "08:35", "09:05", "09:35", "10:05", "10:35"):
    BOOKS[f"2026-10-22T{slot}Z-d7-5913244"] = (0.012, 0.99)
BOOKS["2026-10-22T11:05Z-d7-5913244"] = (0.141, 0.99)
for slot in ("11:35", "12:05", "12:35", "13:05", "13:35"):
    BOOKS[f"2026-10-22T{slot}Z-d7-5913244"] = (0.981, 0.99)
BOOKS["2026-10-22T14:05Z-d7-5913244"] = (0.01, 0.981)
BOOKS["2026-10-22T14:35Z-d7-5913244"] = (0.51, 0.981)
for slot in ("15:05", "15:35", "16:05", "16:35", "17:05", "17:35"):
    BOOKS[f"2026-10-22T{slot}Z-d7-5913244"] = (0.51, 0.99)

NAMES = {"0x1f5ac208": "Bank of Israel holds (Oct)", "0xcb6a8b74": "Tesla beats Q3 EPS", "0x67a3c3e4": "Biggest quake 21 Oct 5.3-5.4",
         "0xfc6e8f2f": "US gas 22 Oct $4.270-4.2799", "0x5e96323f": "UMich Oct final 43.0-45.9", "0x51b24bb0": "UMich Oct final 46.0-48.9",
         "0xf89303cc": "HOOD low $95, week of 19 Oct", "0x6ccfe21b": "Biggest quake 22 Oct >= 6.1",
         "0x1976c8f5": "Alberta: Remain by 40-60 %", "0xf860dcb3": "Alberta: Leave wins a division"}

CANDIDATES = [
    # (name, A bar, B bar, thin rule: "on" | "A-off" | "cap", size cap in a thin book)
    ("K0 current: A 8, B 12, thin forbidden", 0.08, 0.12, "on", None),
    ("K1 A 6, B 10, thin forbidden", 0.06, 0.10, "on", None),
    ("K2 A 5, B 8, thin forbidden", 0.05, 0.08, "on", None),
    ("K3 A 8, B 12, thin allowed for A (held to payout)", 0.08, 0.12, "A-off", None),
    ("K4 A 8, B 12, thin allowed at $2 a market", 0.08, 0.12, "cap", 2.0),
    ("K5 A 5, B 8, thin allowed at $2 a market", 0.05, 0.08, "cap", 2.0),
    ("K6 A 5, B 8, thin allowed at $10 (no thin rule)", 0.05, 0.08, "cap", 10.0),
]


def ts(s):
    return time.mktime(time.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone


def thin(book):
    bid, ask = book
    return ask is None or ask - bid > 0.05 + 1e-9


def evaluate(row, bar_a, bar_b, thin_mode, cap):
    """The gates a candidate keeps, on one row: (bid, size_usd, refusals)."""
    rid, t, key, cat, p, m, _ = row
    book = BOOKS[rid]
    bid, ask = book
    mid = None if ask is None else (bid + ask) / 2
    bar = bar_a if cat == "A" else bar_b
    refusals = []
    b = math.floor((p - bar) * 100 + 1e-9) / 100
    if ask is not None and b >= ask:
        b = round(ask - 0.01, 2)
    if mid is not None and p - mid < bar - 1e-9:
        refusals.append("edge")
    if b < 0.05:
        refusals.append("longshot")
    if b >= 0.90 and cat != "A":
        refusals.append("favourite")
    size = min(10.0, 0.25 * (p - b) / (1 - b) * 100) if b < 1 else 0
    if thin(book):
        if thin_mode == "on" or (thin_mode == "A-off" and cat != "A"):
            refusals.append("thin")
        elif thin_mode == "cap":
            size = min(size, cap)
    return b, size, refusals


def main():
    sh = json.load(open(os.path.join(DATA, "shadow.json")))
    pub = json.load(gzip.open(os.path.join(DATA, "public.json.gz")))
    rows = sh["rows"]
    days = (ts(READ_AT) - ts(D7_START)) / 86400

    def outcome(key):
        g = pub["markets"][key]["gamma"]
        if not g.get("closed"):
            return None
        toks = json.loads(g["clobTokenIds"])
        prices = json.loads(g["outcomePrices"])
        return float(prices[toks.index(sh["markets"][key]["token_id"])])

    def other(key):
        toks = json.loads(pub["markets"][key]["gamma"]["clobTokenIds"])
        return [x for x in toks if x != sh["markets"][key]["token_id"]][0]

    def close_ts(key):
        g = pub["markets"][key]["gamma"]
        return ts(g["closedTime"].replace(" ", "T")) if g.get("closedTime") else ts(pub["read_at"])

    def fills(key, b, t0, t1):
        tok, oth = sh["markets"][key]["token_id"], other(key)
        out = []
        for x in pub["markets"][key]["taker_trades"]:
            tt, px, sz = x["timestamp"], float(x["price"]), float(x["size"])
            if not (t0 <= tt <= t1):
                continue
            if (x["asset"] == tok and x["side"] == "SELL" and px <= b + 1e-9) or (x["asset"] == oth and x["side"] == "BUY" and px >= 1 - b - 1e-9):
                out.append((tt, px, sz))
        return out

    def last_trade(key, t0):
        tok = sh["markets"][key]["token_id"]
        best = None
        for x in pub["markets"][key]["taker_trades"]:
            if x["timestamp"] <= t0 and (best is None or x["timestamp"] > best[0]):
                px = float(x["price"]) if x["asset"] == tok else 1 - float(x["price"])
                best = (x["timestamp"], px)
        return best

    def hist_at(key, t0):
        h = [x for x in pub["markets"][key]["history"] if x["t"] <= t0]
        return h[-1]["p"] if h else None

    print(f"GROKPM rules study: D7 shadow forecasts {D7_START} to {READ_AT} ({days:.2f} days); public record read {pub['read_at']}")
    print("Not blind: every row was read as it stood.\n")

    # ── 1. funnel ──
    al = sh["alberta"]
    n_rows = len(rows) + sum(a["n"] for a in al.values())
    print("1. FUNNEL (rows, then markets)")
    print(f"   shadow rows with p and m: {n_rows} ({sum(a['n'] for a in al.values())} on the two Alberta markets), markets: {len(sh['markets'])}")
    by = {}
    for r in rows:
        by.setdefault(r[2], []).append(r)
    print("   market                          | cat | rows | max p-m | rows p-m >= bar | outcome | why no order (rows over the bar)")
    for key in sh["markets"]:
        if key in al:
            a = al[key]
            print(f"   {NAMES[key]:<31} |  {a['first'][2]}  | {a['n']:>4} | {a['gap_max']*100:>6.1f}  | {a['clear']:>15} | open    | edge: p − m at most {a['gap_max']*100:.1f} points")
            continue
        rs = by[key]
        bar = 0.08 if rs[0][3] == "A" else 0.12
        over = [r for r in rs if r[4] - r[5] >= bar - 1e-9]
        gates = {}
        for r in over:
            _, _, ref = evaluate(r, 0.08, 0.12, "on", None)
            for g in ref or ["none"]:
                gates[g] = gates.get(g, 0) + 1
        y = outcome(key)
        print(f"   {NAMES[key]:<31} |  {rs[0][3]}  | {len(rs):>4} | {max(r[4]-r[5] for r in rs)*100:>6.1f}  | {len(over):>15} | {('won' if y == 1 else 'lost') if y is not None else 'open':<7} | "
              + (", ".join(f"{g} {n}" for g, n in sorted(gates.items())) if over else "edge (under the bar)"))
    clear = [r for r in rows if r[4] - r[5] >= (0.08 if r[3] == "A" else 0.12) - 1e-9]
    print(f"   rows over their category's bar on p − m: {len(clear)} in {len(set(r[2] for r in clear))} markets; every one refused by `thin` "
          f"({sum(1 for r in clear if 'thin' in evaluate(r, .08, .12, 'on', None)[2])} of {len(clear)}); orders sent: 0\n")

    # ── 2. the books those rows saw, and what traded after the agent looked ──
    print("2. THE GAPS: each market with a row over its bar, its first such row, and the tape from then to its close")
    for key in [k for k in sh["markets"] if k in {r[2] for r in clear}]:
        r = [x for x in rows if x[2] == key and x in clear][0]
        bid, ask = BOOKS[r[0]]
        t0 = ts(r[1])
        lt = last_trade(key, t0)
        b = math.floor((r[4] - (0.08 if r[3] == "A" else 0.12)) * 100 + 1e-9) / 100
        f = fills(key, b, t0, close_ts(key))
        print(f"   {NAMES[key]}: first over the bar {r[1][5:16]} p {r[4]} m {r[5]} book {bid}/{ask if ask is not None else 'none'}; "
              f"last trade before it {time.strftime('%m-%d %H:%M', time.gmtime(lt[0])) if lt else '-'} at {lt[1]:.3f}" if lt else "")
        print(f"      a resting bid at {b:.2f} from then to the close: {len(f)} taker fills"
              + (f" ({sum(x[2] for x in f):.1f} shares)" if f else "") + f"; outcome {outcome(key)}")
    print()

    # ── 3. scores ──
    print("3. SCORES on resolved markets, each at its first counted shadow forecast (D7's rule)")
    print("   market                          | p     | m (agent) | last trade | price history | y")
    sc = []
    for key in sh["markets"]:
        y = outcome(key)
        if y is None:
            continue
        r = by[key][0]
        t0 = ts(r[1])
        lt = last_trade(key, t0)
        hp = hist_at(key, t0)
        sc.append((r[4], r[5], lt[1] if lt else r[5], hp if hp is not None else r[5], y))
        print(f"   {NAMES[key]:<31} | {r[4]:.3f} | {r[5]:.4f}    | {lt[1] if lt else float('nan'):.3f}      | {hp if hp is not None else float('nan'):.3f}         | {y:g}")
    n = len(sc)
    if n:
        for j, label in ((1, "the agent's m (D7's reading)"), (2, "the last trade before the forecast"), (3, "the CLOB price history at the forecast")):
            ba = sum((x[0] - x[4]) ** 2 for x in sc) / n
            bm = sum((x[j] - x[4]) ** 2 for x in sc) / n
            print(f"   Brier on {n}: agent {ba:.4f} against {label} {bm:.4f}")
        ll = lambda q, y: -(y * math.log(max(q, 1e-6)) + (1 - y) * math.log(max(1 - q, 1e-6)))
        print(f"   log loss on {n}: agent {sum(ll(x[0], x[4]) for x in sc)/n:.4f}, m {sum(ll(x[1], x[4]) for x in sc)/n:.4f}, "
              f"last trade {sum(ll(x[2], x[4]) for x in sc)/n:.4f}")
        print(f"   calibration: all {n} resolved forecasts were p 0.93-0.98 on a YES that paid 1; no forecast under 0.9 has resolved")
    print(f"   resolved: {n} of {len(sh['markets'])} markets; open: " + ", ".join(NAMES[k] for k in sh["markets"] if outcome(k) is None) + "\n")

    # ── 4. candidates ──
    print("4. CANDIDATE RULE SETS on every shadow row (one order a market, at its first passing row)")
    print("   candidate                                         | orders | filled (rest) | filled (wake) | resolved fills | won | P&L per $1 | % of budget | worst")
    for name, ba_, bb_, mode, cap in CANDIDATES:
        orders, f_rest, f_wake, res, won, pnl, cost, worst = 0, 0, 0, 0, 0, 0.0, 0.0, 0.0
        for key in sh["markets"]:
            if key in al:
                continue
            rs = by[key]
            passing = [(r, *evaluate(r, ba_, bb_, mode, cap)) for r in rs]
            ok = [(r, b, s) for r, b, s, ref in passing if not ref]
            if not ok:
                continue
            orders += 1
            r, b, s = ok[0]
            t0 = ts(r[1])
            last_ok = max(ts(x[0][1]) for x in ok) + 35 * 60
            fr = fills(key, b, t0, close_ts(key))
            fw = fills(key, b, t0, min(last_ok, close_ts(key)))
            f_rest += bool(fr)
            f_wake += bool(fw)
            y = outcome(key)
            if fr and y is not None:
                shares = min(s / b, sum(x[2] for x in fr))
                res += 1
                won += y == 1
                pnl += shares * (y - b)
                cost += shares * b
                worst = min(worst, shares * (y - b))
        print(f"   {name:<49} | {orders:>6} | {f_rest:>13} | {f_wake:>13} | {res:>14} | {won:>3} | "
              f"{(pnl / cost if cost else 0):>+10.3f} | {pnl:>+10.2f}% | {worst:+.2f}%")
    print(f"   per week: multiply the orders by 7 / {days:.2f} = {7 / days:.2f}")


if __name__ == "__main__":
    main()
