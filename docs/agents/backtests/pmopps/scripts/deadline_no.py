"""DEADLINE-NO: the pre-registered run (reviews/2026-10-13-deadline-no-2024-prereg.md). FROZEN with that file.

The rule is PMOPPS's `theta.py`, word for word, with the year as its argument and the one-in-two sample off:
  - universe: closed markets of pull_closed.py ($20,000 of volume or more) whose scheduled end date falls in the year,
    whose question says "by" or "before" (a word), not an up/down series, no fee type starting `sports` or `crypto`, no
    sports market type and no game start, paying 0 or 1;
  - the YES token's hourly price (CLOB `/prices-history`, fidelity 60, the window T - 15 d -> T - 2 d) at T - 7 days:
    the last point at or before it, no older than 6 hours (T = Gamma's `endDate`);
  - when that price is in [0.20, 0.50): buy NO at 1 - YES + 1 c (half a spread) + the taker fee (rate x p x (1 - p),
    p the NO price, the rate by the market's own `feeType` as theta.py maps it), $1 a trade, held to the payout.
The bar, every part of which must hold:
  1. at least 150 trades in at least 100 events (an event is the market's first Gamma event slug);
  2. the mean return per $1 > 0, and the 5th percentile of the event bootstrap > -0.02 (2,000 draws, seed 20261013,
     resampling events with their trades, exactly as theta.py's rule lines);
  3. the mean > 0 in each half-year (end dates January-June, July-December);
  4. no event over 25 % of the total (an event's summed return / the total summed return, when the total is > 0).
Reported, not in the bar: T - 14 days on the same band (a sign check: its mean is not below -0.05), every trade's fills on
the public tape around the entry (the data API's `/trades`, 6 hours either side: what takers paid for NO, and how many
shares they took within 2 c of our price), and the result with today's taker rates by the market's category.

`--sample-half` restores theta.py's one-in-two sample and its end-date cut, to check this file reproduces theta.py on
2025 and 2026 before 2024 is read.

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmopps/scripts/deadline_no.py <year> [--sample-half] [--cache <file>] [--no-tape]
"""
import glob
import json
import os
import random
import re
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pmnet  # noqa: E402

CLOB, DATA_API = "https://clob.polymarket.com", "https://data-api.polymarket.com"
HALF = 0.01
FEE = {"politics": 0.04, "finance_prices": 0.04, "tech": 0.04, "mentions": 0.04, "culture": 0.05, "economics": 0.05,
       "weather": 0.05, "general": 0.05}
BAND, DAY, CHECK_DAY = (0.20, 0.50), 7, 14
SEED, DRAWS = 20261013, 2000
# Today's taker rates by category (reference §2d), for the reported fee sensitivity only.
TODAY = [("crypto", r"(bitcoin|\bbtc\b|ethereum|\beth\b|solana|\bsol\b|\bxrp\b|doge|crypto|token|coin|binance|fdv|airdrop)", 0.07),
         ("sports", r"(nfl|nba|mlb|nhl|ufc|fifa|world cup|champions league|premier league|super bowl|olympic|tennis|golf|f1|grand prix)", 0.05),
         ("geo/war", r"(war|ceasefire|strike|invade|invasion|military|troops|missile|attack|israel|iran|ukraine|russia|gaza|hamas|hezbollah|houthi|china|taiwan|nato|nuclear)", 0.0),
         ("politics", r"(trump|biden|harris|election|president|senate|congress|governor|mayor|minister|parliament|vote|impeach|resign|pardon|cabinet|tariff|executive order|supreme court|fed |rate cut)", 0.04),
         ("tech/AI", r"(openai|gpt|gemini|anthropic|claude|grok|\bai\b|apple|google|tesla|spacex|starship|launch|release|iphone|elon|musk|x\.com|twitter)", 0.04)]


def ts(s):
    if not s: return None
    s = s.strip().replace(" ", "T")
    if s.endswith("+00"): s += ":00"
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def fee_rate(m):
    ft = (m.get("feeType") or "")
    return FEE.get(ft[:-5] if ft.endswith("_fees") else ft, 0.0 if not ft else 0.05)


def category(q):
    x = (q or "").lower()
    for name, rx, rate in TODAY:
        if re.search(rx, x): return name, rate
    return "other", 0.05


def no_ret(y, pay, rate):
    p = 1 - y
    if not (0.0 < p < 1.0): return None
    return (1 - pay) / (min(0.999, p + HALF) + rate * p * (1 - p)) - 1


def universe(year, sample_half):
    mk = []
    for p in sorted(glob.glob(os.path.join(pmnet.DATA, "closed", "*.json"))):
        for m in json.load(open(p)):
            q = (m.get("question") or "").lower()
            slug = (m.get("slug") or "") + " " + " ".join((e.get("seriesSlug") or "") for e in m.get("events") or [])
            if not re.search(r"\b(by|before)\b", q): continue
            if "updown" in slug or "up-or-down" in slug or (m.get("feeType") or "").startswith(("sports", "crypto")): continue
            if m.get("sportsMarketType") or m.get("gameStartTime"): continue
            if sample_half:
                if (m.get("endDate") or "") >= "2026-10-01": continue
                if int(m["conditionId"][-1], 16) % 2: continue
            if not (m.get("endDate") or "").startswith(str(year)): continue
            try:
                pay = [float(v) for v in json.loads(m.get("outcomePrices") or "[]")]
            except ValueError:
                continue
            if len(pay) != 2 or pay[0] not in (0.0, 1.0): continue
            m["_pay"] = pay[0]; mk.append(m)
    return mk


def price_at(h, end, d):
    t = end - d * 86400
    pts = [x for x in h if x["t"] <= t]
    return float(pts[-1]["p"]) if pts and t - pts[-1]["t"] <= 6 * 3600 else None


def boot(vs):
    by = {}
    for v, e in vs: by.setdefault(e, []).append(v)
    evs = list(by); rnd = random.Random(SEED); bs = []
    for _ in range(DRAWS):
        draw = [x for _ in evs for x in by[evs[rnd.randrange(len(evs))]]]
        bs.append(sum(draw) / len(draw))
    bs.sort()
    return bs[int(0.05 * DRAWS)], bs[int(0.95 * DRAWS)], len(evs)


def main():
    args = sys.argv[1:]
    year = int(args[0]); sample_half = "--sample-half" in args; tape = "--no-tape" not in args
    cache_name = args[args.index("--cache") + 1] if "--cache" in args else f"dno_raw_{year}.json"
    mk = universe(year, sample_half)
    cache_p = os.path.join(pmnet.DATA, cache_name)
    cache = json.load(open(cache_p)) if os.path.exists(cache_p) else {}
    for n, m in enumerate(mk):
        c = m["conditionId"]
        if c in cache: continue
        tok = json.loads(m.get("clobTokenIds") or "[]"); end = ts(m["endDate"])
        if not tok or not end:
            cache[c] = []; continue
        try:
            cache[c] = pmnet.get(CLOB + "/prices-history", {"market": tok[0], "startTs": int(end - 15 * 86400), "endTs": int(end - 2 * 86400), "fidelity": 60}).get("history") or []
        except RuntimeError:
            cache[c] = []
        if n % 500 == 0:
            pmnet.dump(cache_p, cache); print("prices", n, len(mk), flush=True)
    pmnet.dump(cache_p, cache)

    trades, checks = [], []
    for m in mk:
        end = ts(m["endDate"]); h = cache.get(m["conditionId"]) or []
        ev = (m.get("events") or [{}])[0].get("slug") or m["conditionId"]
        cat, today = category(m.get("question"))
        for d, out in ((DAY, trades), (CHECK_DAY, checks)):
            y = price_at(h, end, d)
            if y is None or not (BAND[0] <= y < BAND[1]): continue
            v = no_ret(y, m["_pay"], fee_rate(m))
            if v is None: continue
            out.append({"cond": m["conditionId"], "ev": ev, "end": m["endDate"][:10], "y": y, "pay": m["_pay"], "ret": v,
                        "fee": fee_rate(m), "cat": cat, "ret_today_fee": no_ret(y, m["_pay"], today), "t_entry": end - d * 86400,
                        "q": (m.get("question") or "")[:100], "no_token": json.loads(m.get("clobTokenIds") or "[]")[1:2]})

    print(f"DEADLINE-NO {year}{' (theta.py one-in-two sample)' if sample_half else ''}: universe {len(mk)} markets; "
          f"a price at T - {DAY} d: {sum(1 for m in mk if price_at(cache.get(m['conditionId']) or [], ts(m['endDate']), DAY) is not None)}")
    vs = [(t["ret"], t["ev"]) for t in trades]
    if not vs:
        print("no trade"); return
    mean = sum(v for v, _ in vs) / len(vs)
    lo, hi, nev = boot(vs)
    halves = {}
    for t in trades: halves.setdefault("H1" if t["end"][5:7] <= "06" else "H2", []).append(t["ret"])
    tot = sum(v for v, _ in vs)
    by_ev = {}
    for v, e in vs: by_ev[e] = by_ev.get(e, 0.0) + v
    top_e, top_v = max(by_ev.items(), key=lambda kv: kv[1])
    share = top_v / tot if tot > 0 else None
    c1 = len(vs) >= 150 and nev >= 100
    c2 = mean > 0 and lo > -0.02
    c3 = all(len(halves.get(k, [])) and sum(halves[k]) / len(halves[k]) > 0 for k in ("H1", "H2"))
    c4 = share is not None and share <= 0.25
    print(f"T - {DAY} d, YES in [{BAND[0]:.2f}, {BAND[1]:.2f}): {len(vs)} trades in {nev} events, return per $1 {mean:+.4f} "
          f"[{lo:+.4f}, {hi:+.4f}] (event bootstrap, {DRAWS} draws, seed {SEED}); won {100 * sum(1 for t in trades if t['pay'] == 0.0) / len(trades):.1f} %")
    for k in ("H1", "H2"):
        xs = halves.get(k, [])
        print(f"  {k}: {len(xs)} trades, mean {sum(xs) / len(xs) if xs else float('nan'):+.4f}")
    print(f"  largest event: {top_e[:70]} {top_v:+.3f} of a total {tot:+.3f} ({'n/a' if share is None else f'{100 * share:.1f} %'})")
    print(f"BAR: 1 trades/events {'PASS' if c1 else 'FAIL'}; 2 mean and bound {'PASS' if c2 else 'FAIL'}; "
          f"3 halves {'PASS' if c3 else 'FAIL'}; 4 concentration {'PASS' if c4 else 'FAIL'} => {'PASS' if (c1 and c2 and c3 and c4) else 'FAIL'}")
    cv = [(t["ret"], t["ev"]) for t in checks]
    if cv:
        cm = sum(v for v, _ in cv) / len(cv); clo, chi, cn = boot(cv)
        print(f"sign check, T - {CHECK_DAY} d: {len(cv)} trades in {cn} events, mean {cm:+.4f} [{clo:+.4f}, {chi:+.4f}] -> {'holds' if cm >= -0.05 else 'fails'} (mean >= -0.05)")
    tf = [t["ret_today_fee"] for t in trades if t["ret_today_fee"] is not None]
    print(f"with today's taker rates by category: mean {sum(tf) / len(tf):+.4f}; categories: "
          + ", ".join(f"{c} {sum(1 for t in trades if t['cat'] == c)}" for c in sorted({t['cat'] for t in trades})))

    if tape:
        tape_p = os.path.join(pmnet.DATA, f"dno_tape_{year}.json")
        tc = json.load(open(tape_p)) if os.path.exists(tape_p) else {}
        for t in trades:
            k = t["cond"]
            if k in tc: continue
            try:
                tc[k] = pmnet.get(DATA_API + "/trades", {"market": k, "end": int(t["t_entry"] + 6 * 3600), "limit": 500})
            except RuntimeError:
                tc[k] = []
        pmnet.dump(tape_p, tc)
        paid, near, seen = [], [], 0
        for t in trades:
            ours = 1 - t["y"] + HALF
            got = []
            for x in tc.get(t["cond"]) or []:
                if not (t["t_entry"] - 6 * 3600 <= x.get("timestamp", 0) <= t["t_entry"] + 6 * 3600): continue
                o, s, p, z = x.get("outcome"), x.get("side"), float(x.get("price") or 0), float(x.get("size") or 0)
                if o == "No" and s == "BUY": got.append((p, z))
                elif o == "Yes" and s == "SELL": got.append((1 - p, z))
            if got:
                seen += 1
                got.sort()
                paid.append(got[len(got) // 2][0] - (1 - t["y"]))
                near.append(sum(z for p, z in got if p <= ours + 0.02))
        print(f"the tape, 6 h either side of the entry: {seen} of {len(trades)} trades had takers buying NO (or selling YES)")
        if paid:
            paid.sort(); near.sort()
            print(f"  their median NO price less 1 - YES: median {100 * paid[len(paid) // 2]:+.2f} c (p10 {100 * paid[len(paid) // 10]:+.2f}, p90 {100 * paid[9 * len(paid) // 10]:+.2f}); "
                  f"assumed +1.00 c. Shares they took within 2 c of our price: median {near[len(near) // 2]:.0f}, p10 {near[len(near) // 10]:.0f}")
    pmnet.dump(os.path.join(pmnet.DATA, f"dno_trades_{year}{'_half' if sample_half else ''}.json"), {"trades": trades, "checks": checks})


if __name__ == "__main__":
    main()
