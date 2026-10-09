"""S2b: the same NFL game on Smarkets (a UK-regulated betting exchange) and Polymarket: one keyless snapshot.
Kalshi was ruled out as a venue (Davies, 2026-10-09: "我开不了Kalshi的账户"); Smarkets is the UK-legal second leg.

Smarkets: GET /v3/events/?parent_id=7763291 (NFL), the event's "Winner" market (draw no bet), its contracts and
/quotes/ (price = probability x 10,000; quantity read as payout x 10,000 in GBP). Polymarket: the open NFL game events
on Gamma (slug nfl-<away>-<home>-<date>), matched on the two nicknames and the date; CLOB books.
Per game: the mid gap, the taker-taker cross (back A on Smarkets at its offer + buy B on Polymarket at its ask, with
Smarkets' 2 % commission on net winnings, charged here whenever A wins = 0.02 x (1 - p) per $1 of payout, and the
market's Polymarket taker fee), and a quote-and-hedge (rest a Polymarket bid at its best bid, maker 0 %, hedge on
Smarkets at its offer). GBP and USD are treated 1:1 per unit of payout (the FX leg is ignored: a screen).
usage: python3 smarkets_pm_match.py
"""
import datetime, gzip, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netget import get_json

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMM = 0.02


def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    stamp = now.strftime("%Y-%m-%dT%H%MZ")
    st, d = get_json("https://api.smarkets.com/v3/events/?parent_id=7763291&state=upcoming&limit=100")
    sm = [e for e in d["events"] if e.get("type") == "american_football_match" and e.get("start_datetime")
          and datetime.datetime.fromisoformat(e["start_datetime"].replace("Z", "+00:00")) < now + datetime.timedelta(days=14)]
    pm_events = []
    off = 0
    while True:
        st, evs = get_json(f"https://gamma-api.polymarket.com/events?tag_slug=nfl&closed=false&limit=100&offset={off}")
        if st != 200 or not evs:
            break
        pm_events += [e for e in evs if e["slug"].startswith("nfl-") and len(e["slug"].split("-")) == 6 and " vs. " in e["title"]]
        off += 100
        if len(evs) < 100 or off >= 3000:
            break
    rows, raw = [], []
    for e in sm:
        st, mk = get_json(f"https://api.smarkets.com/v3/events/{e['id']}/markets/")
        win = [m for m in (mk or {}).get("markets", []) if m["name"] == "Winner"]
        if not win:
            continue
        mid = win[0]["id"]
        st, cs = get_json(f"https://api.smarkets.com/v3/markets/{mid}/contracts/")
        st, qs = get_json(f"https://api.smarkets.com/v3/markets/{mid}/quotes/")
        time.sleep(0.3)
        names = {c["id"]: c["name"] for c in cs["contracts"]}
        date = e["start_datetime"][:10]
        cand = [p for p in pm_events if set(n.lower() for n in names.values()) == set(x.strip().lower() for x in p["title"].split(" vs. "))]
        if not cand:
            rows.append({"smarkets": e["name"], "matched": False}); continue
        pe = cand[0]
        ml = [m for m in pe["markets"] if m.get("sportsMarketType") == "moneyline"] or pe["markets"][:1]
        pmk = ml[0]
        outs = json.loads(pmk["outcomes"]); toks = json.loads(pmk["clobTokenIds"])
        fee = (pmk.get("feeSchedule") or {}).get("rate") if isinstance(pmk.get("feeSchedule"), dict) else None
        fee = 0.05 if fee is None else float(fee)
        books = {}
        for o, t in zip(outs, toks):
            st, b = get_json(f"https://clob.polymarket.com/book?token_id={t}")
            time.sleep(0.15)
            books[o] = b
        raw.append({"smarkets_event": e, "smarkets_quotes": qs, "smarkets_contracts": cs, "pm_slug": pe["slug"], "pm_books": books, "pm_fee_schedule": pmk.get("feeSchedule")})
        t = {}
        for cid, nm in names.items():
            q = qs.get(cid, {})
            sb = max((x["price"] for x in q.get("bids", [])), default=None)
            so = min((x["price"] for x in q.get("offers", [])), default=None)
            so_q = next((x["quantity"] for x in q.get("offers", []) if x["price"] == so), 0)
            o = next(x for x in outs if x.lower() == nm.lower())
            b = books[o] or {}
            pb = max((float(x["price"]) for x in b.get("bids", [])), default=None)
            pa = min((float(x["price"]) for x in b.get("asks", [])), default=None)
            t[nm] = {"s_bid": sb / 1e4 if sb else None, "s_offer": so / 1e4 if so else None, "s_offer_payout_gbp": so_q / 1e4,
                     "p_bid": pb, "p_ask": pa}
        a, b_ = list(t)
        best, qh = None, None
        for x, y in ((a, b_), (b_, a)):
            if t[x]["s_offer"] and t[y]["p_ask"]:
                ps, pp = t[x]["s_offer"], t[y]["p_ask"]
                c = ps + COMM * (1 - ps) + pp + fee * pp * (1 - pp)
                if best is None or c < best["cost"]:
                    best = {"buy": f"{x}@smarkets {ps} + {y}@pm {pp}", "cost": round(c, 4)}
            if t[x]["p_bid"] and t[y]["s_offer"]:
                pb, ps = t[x]["p_bid"], t[y]["s_offer"]
                c = pb + ps + COMM * (1 - ps)
                if qh is None or c < qh["cost"]:
                    qh = {"rest": f"{x}@pm bid {pb}", "hedge": f"{y}@smarkets offer {ps}", "cost": round(c, 4)}
        sm_mid = (t[a]["s_bid"] + t[a]["s_offer"]) / 2 if t[a]["s_bid"] and t[a]["s_offer"] else None
        pm_mid = (t[a]["p_bid"] + t[a]["p_ask"]) / 2 if t[a]["p_bid"] and t[a]["p_ask"] else None
        rows.append({"smarkets": e["name"], "pm_slug": pe["slug"], "matched": True, "teams": t, "best_cross": best,
                     "quote_hedge": qh, "mid_gap": round(sm_mid - pm_mid, 4) if sm_mid and pm_mid else None,
                     "smarkets_spread": round(t[a]["s_offer"] - t[a]["s_bid"], 4) if t[a]["s_bid"] and t[a]["s_offer"] else None})
    os.makedirs(os.path.join(HERE, "inputs", "smpm"), exist_ok=True)
    with gzip.open(os.path.join(HERE, "inputs", "smpm", f"{stamp}.json.gz"), "wt") as f:
        json.dump({"at": now.isoformat(), "games": raw}, f, sort_keys=True)
    m = [r for r in rows if r["matched"]]
    out = {"at": now.isoformat(), "smarkets_games_14d": len(sm), "matched": len(m),
           "cross_costs": sorted(r["best_cross"]["cost"] for r in m if r["best_cross"]),
           "quote_hedge_costs": sorted(r["quote_hedge"]["cost"] for r in m if r["quote_hedge"]),
           "abs_mid_gaps": sorted(abs(r["mid_gap"]) for r in m if r["mid_gap"] is not None),
           "smarkets_spreads": sorted(r["smarkets_spread"] for r in m if r["smarkets_spread"] is not None), "games": rows}
    json.dump(out, open(os.path.join(HERE, "results", f"smpm_{stamp}.json"), "w"), indent=1, sort_keys=True)
    print(json.dumps({k: v for k, v in out.items() if k != "games"}, indent=1))


if __name__ == "__main__":
    main()
