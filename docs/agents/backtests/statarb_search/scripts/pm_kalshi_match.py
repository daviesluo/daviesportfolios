"""S2: the same game on Polymarket and Kalshi (fp4's S5, dead on access then and untested): one keyless snapshot.

For every open Kalshi game market in the named series, guess Polymarket's event slug
(<league>-<away>-<home>-<date>, the date or the day after, a small code map), read both order books
(Kalshi GET /markets/{ticker}/orderbook; Polymarket CLOB GET /book?token_id=), and record, per game:
  * each venue's mid for the same team, and the gap
  * the riskless two-venue cost: buy team A on one venue and team B on the other, both at the best ask,
    with each venue's taker fee (Kalshi 0.07 x p(1-p) a contract, Polymarket the market's sports rate 0.05 x p(1-p)),
    and the depth at those asks; a cost under $1 is an arbitrage before resolution risk.
Saves the raw books to inputs/pmk/<stamp>.json.gz and the table to results/pmk_<stamp>.json.
usage: python3 pm_kalshi_match.py
"""
import datetime, gzip, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netget import get_json

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERIES = {"KXNFLGAME": "nfl", "KXMLBGAME": "mlb", "KXNHLGAME": "nhl", "KXNCAAFGAME": "cfb", "KXEPLGAME": "epl"}
CODE = {"LAR": "la", "JAC": "jax"}
MON = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}
KFEE, PFEE = 0.07, 0.05


def kalshi_markets(series):
    out, cur = [], ""
    while True:
        st, d = get_json(f"https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker={series}&status=open&limit=1000" + (f"&cursor={cur}" if cur else ""))
        if st != 200 or not d:
            return out
        out += d.get("markets") or []
        cur = d.get("cursor") or ""
        if not cur or not d.get("markets"):
            return out


def kbook(ticker):
    st, d = get_json(f"https://api.elections.kalshi.com/trade-api/v2/markets/{ticker}/orderbook")
    time.sleep(0.15)
    ob = (d or {}).get("orderbook_fp") or (d or {}).get("orderbook") or {}
    def lv(key):
        rows = ob.get(key + "_dollars") or ob.get(key) or []
        return sorted(((float(p) if isinstance(p, str) else p / 100, float(q)) for p, q in rows), reverse=True)
    return {"yes_bids": lv("yes"), "no_bids": lv("no"), "raw": d}


def pbook(token):
    st, d = get_json(f"https://clob.polymarket.com/book?token_id={token}")
    time.sleep(0.15)
    if st != 200 or not d:
        return None
    return {"bids": sorted(((float(x["price"]), float(x["size"])) for x in d.get("bids", [])), reverse=True),
            "asks": sorted((float(x["price"]), float(x["size"])) for x in d.get("asks", [])), "raw": d}


def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    stamp = now.strftime("%Y-%m-%dT%H%MZ")
    games, raw = [], []
    for series, lg in SERIES.items():
        ms = kalshi_markets(series)
        ev = {}
        for m in ms:
            ev.setdefault(m["event_ticker"], []).append(m)
        for et, mk in ev.items():
            if len(mk) != 2:
                continue   # a game with a tie market (soccer) or one side missing: skipped, counted
            code = et.split("-")[1]
            d = datetime.date(2000 + int(code[:2]), MON[code[2:5]], int(code[5:7]))
            teams = [m["ticker"].split("-")[-1] for m in mk]
            rest = code[7:]
            away = rest[: len(rest) - len(teams[1])] if rest.endswith(teams[1]) else rest[: len(rest) - len(teams[0])]
            home = rest[len(away):]
            ev_pm = None
            for dd in (d, d + datetime.timedelta(days=1), d - datetime.timedelta(days=1)):
                slug = f"{lg}-{CODE.get(away, away.lower())}-{CODE.get(home, home.lower())}-{dd.isoformat()}"
                st, e = get_json(f"https://gamma-api.polymarket.com/events?slug={slug}")
                time.sleep(0.1)
                if st == 200 and e:
                    ev_pm = e[0]
                    break
            if not ev_pm:
                games.append({"kalshi_event": et, "matched": False})
                continue
            ml = [m for m in ev_pm.get("markets", []) if m.get("sportsMarketType") == "moneyline"] or ev_pm.get("markets", [])[:1]
            pm = ml[0]
            outcomes = json.loads(pm["outcomes"]); toks = json.loads(pm["clobTokenIds"])
            pbs = {o: pbook(t) for o, t in zip(outcomes, toks)}
            kbs = {m["ticker"].split("-")[-1]: (m, kbook(m["ticker"])) for m in mk}
            raw.append({"kalshi_event": et, "pm_slug": ev_pm["slug"], "pm_question": pm.get("question"), "pm_outcomes": outcomes,
                        "pm_books": {o: (b or {}).get("raw") for o, b in pbs.items()}, "kalshi_books": {k: v[1]["raw"] for k, v in kbs.items()},
                        "kalshi_titles": {k: v[0].get("yes_sub_title") for k, v in kbs.items()}})
            # map Polymarket outcome names to Kalshi team codes by the Kalshi yes_sub_title
            mp = {}
            for k, (m, _) in kbs.items():
                sub = (m.get("yes_sub_title") or "").lower()
                for o in outcomes:
                    if o.lower() in sub or sub in o.lower() or o.lower().split()[-1] in sub:
                        mp[k] = o
            if len(set(mp.values())) != 2 and len(outcomes) == 2 and ev_pm["slug"].split("-")[1:3] == [CODE.get(away, away.lower()), CODE.get(home, home.lower())]:
                mp = {away: outcomes[0], home: outcomes[1]}   # the slug is away-home and the outcomes follow it ("Commanders vs. 49ers")
            if len(set(mp.values())) != 2:
                games.append({"kalshi_event": et, "pm_slug": ev_pm["slug"], "matched": False, "why": "names", "titles": [m.get("yes_sub_title") for m, _ in kbs.values()], "outcomes": outcomes})
                continue
            row = {"kalshi_event": et, "pm_slug": ev_pm["slug"], "matched": True, "pm_fee_schedule": pm.get("feeSchedule"), "teams": {}}
            for k, (m, kb) in kbs.items():
                o = mp[k]; pb = pbs[o]
                ky_bid = kb["yes_bids"][0] if kb["yes_bids"] else None
                kn_bid = kb["no_bids"][0] if kb["no_bids"] else None
                k_ask = (1 - kn_bid[0], kn_bid[1]) if kn_bid else None   # a YES ask is a NO bid
                p_bid = pb["bids"][0] if pb and pb["bids"] else None
                p_ask = pb["asks"][0] if pb and pb["asks"] else None
                row["teams"][k] = {"pm_outcome": o, "k_bid": ky_bid, "k_ask": k_ask, "p_bid": p_bid, "p_ask": p_ask,
                                   "k_mid": (ky_bid[0] + k_ask[0]) / 2 if ky_bid and k_ask else None,
                                   "p_mid": (p_bid[0] + p_ask[0]) / 2 if p_bid and p_ask else None}
            a, b = list(row["teams"])
            ta, tb = row["teams"][a], row["teams"][b]
            best = None
            for x, y, va, vb in ((a, b, "k_ask", "p_ask"), (a, b, "p_ask", "k_ask")):
                pa, pb_ = row["teams"][x][va], row["teams"][y][vb]
                if not pa or not pb_:
                    continue
                fee = lambda p, f: f * p * (1 - p)
                cost = pa[0] + pb_[0] + fee(pa[0], KFEE if va == "k_ask" else PFEE) + fee(pb_[0], KFEE if vb == "k_ask" else PFEE)
                c = {"buy": f"{x}@{va[0]} + {y}@{vb[0]}", "cost": round(cost, 4), "depth": min(pa[1], pb_[1])}
                if best is None or c["cost"] < best["cost"]:
                    best = c
            row["best_cross"] = best
            # quote-and-hedge: rest a bid for x on one venue at its best bid (Polymarket's maker pays 0; Kalshi's maker
            # 0.0175 x p(1-p) where charged, used here everywhere), take y on the other venue at its ask when it fills
            mk = None
            for x, y in ((a, b), (b, a)):
                for vb, va, mf, tf in (("p_bid", "k_ask", 0.0, KFEE), ("k_bid", "p_ask", 0.0175, PFEE)):
                    pb_, pa = row["teams"][x][vb], row["teams"][y][va]
                    if not pb_ or not pa:
                        continue
                    cost = pb_[0] + pa[0] + mf * pb_[0] * (1 - pb_[0]) + tf * pa[0] * (1 - pa[0])
                    c = {"rest": f"{x}@{vb[0]} bid {pb_[0]}", "hedge": f"{y}@{va[0]} ask {pa[0]}", "cost": round(cost, 4), "hedge_depth": pa[1]}
                    if mk is None or c["cost"] < mk["cost"]:
                        mk = c
            row["best_quote_hedge"] = mk
            row["mid_gap"] = round(ta["k_mid"] - ta["p_mid"], 4) if ta["k_mid"] is not None and ta["p_mid"] is not None else None
            games.append(row)
    os.makedirs(os.path.join(HERE, "inputs", "pmk"), exist_ok=True)
    with gzip.open(os.path.join(HERE, "inputs", "pmk", f"{stamp}.json.gz"), "wt") as f:
        json.dump({"at": now.isoformat(), "games": raw}, f, sort_keys=True)
    m = [g for g in games if g.get("matched")]
    gaps = sorted(abs(g["mid_gap"]) for g in m if g.get("mid_gap") is not None)
    costs = sorted(g["best_cross"]["cost"] for g in m if g.get("best_cross"))
    summ = {"at": now.isoformat(), "kalshi_events_two_sided": len(games), "matched": len(m),
            "abs_mid_gap_median": gaps[len(gaps) // 2] if gaps else None, "abs_mid_gap_p90": gaps[int(len(gaps) * 0.9)] if gaps else None,
            "abs_mid_gap_max": gaps[-1] if gaps else None,
            "best_cross_cost_min": costs[0] if costs else None, "best_cross_cost_median": costs[len(costs) // 2] if costs else None,
            "cross_under_1": sum(1 for c in costs if c < 1),
            "quote_hedge_costs": sorted(g["best_quote_hedge"]["cost"] for g in m if g.get("best_quote_hedge")),
            "games": games}
    json.dump(summ, open(os.path.join(HERE, "results", f"pmk_{stamp}.json"), "w"), indent=1, sort_keys=True)
    print(json.dumps({k: v for k, v in summ.items() if k != "games"}, indent=1))
    for g in m:
        print(g["kalshi_event"], g["mid_gap"], g["best_cross"], g.get("best_quote_hedge"))


if __name__ == "__main__":
    main()
