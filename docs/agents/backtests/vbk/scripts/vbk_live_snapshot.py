"""VB-K, live leg: Polymarket's soccer match markets against Smarkets' exchange, one keyless snapshot.

Question (Davies, 2026-10-09: "并且和polymarket也可以结合"): can Polymarket be (i) a value venue (buy YES when its ask,
fee included, is below a fair price), (ii) the lay leg of a bookmaker back (buy NO), or (iii) a fair-price source?
Fair here is Smarkets' full-time-result book (a UK-regulated exchange, keyless /v3 API): each outcome's mid, the three
normalised to 1. Polymarket: Gamma's open soccer events whose slug is <league>-<team>-<team>-<date> (three binary
"moneyline" markets per match: home, draw, away), CLOB books keyless. Matching: same UTC date and both team names
agree after normalisation (token overlap); an unmatched game is counted, never guessed.

Per outcome: Smarkets back (best offer) and lay (best bid) as probabilities, Polymarket YES bid/ask and the USD within
1 cent of the ask; Polymarket's taker fee per share is rate x p x (1 - p) (the market's feeSchedule, sports_fees_v3 =
0.05). Value: fair / (ask + fee) - 1. Lay cost (pounds or dollars lost when the outcome happens, per unit won when it does
not): Polymarket NO at (1 - YES bid) + fee: c / (1 - c); Smarkets lay at decimal L with 2 % commission: (L - 1) / 0.98.
GBP and USD are treated 1:1 per unit (FX ignored: a screen). Writes inputs/live/<stamp>.json.gz and
results/live_snapshot_<stamp>.json. Nothing is placed: GET only.
"""
import datetime, gzip, json, os, re, sys, time, unicodedata
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "statarb_search2", "scripts"))
from netget import get_json  # noqa: E402  (the keyless GET helper STATARB-2 used)

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SM = "https://api.smarkets.com/v3"
COMM = 0.02
HORIZON_H = 72
STOP = {"fc", "afc", "cf", "sc", "ac", "cd", "ud", "sd", "fk", "sk", "if", "bk", "club", "de", "the", "united", "city",
        "town", "real", "sporting", "and", "vs", "1", "ii", "b", "u21", "u23", "women", "w", "calcio", "1.", "ss", "us",
        "rc", "rcd", "cp", "ca", "sv", "vfl", "vfb", "tsg", "fsv", "spvgg", "as", "ogc", "aj", "stade", "olympique"}


def norm(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return {w for w in s.split() if w not in STOP and len(w) > 2}


def same(a, b):
    x, y = norm(a), norm(b)
    return bool(x and y and (x & y))


def pm_games(now):
    evs, off = [], 0
    while off < 6000:
        st, d = get_json(f"https://gamma-api.polymarket.com/events?tag_slug=soccer&closed=false&limit=100&offset={off}&order=startDate&ascending=false")
        if st != 200 or not d:
            break
        evs += d
        off += 100
        if len(d) < 100:
            break
    pat = re.compile(r"^([a-z0-9]+)-([a-z0-9]+)-([a-z0-9]+)-(\d{4}-\d{2}-\d{2})$")
    out = []
    for e in evs:
        m = pat.match(e.get("slug", ""))
        if not m or " vs. " not in e.get("title", ""):
            continue
        ml = [x for x in e.get("markets", []) if x.get("sportsMarketType") == "moneyline"]
        if len(ml) != 3:
            continue
        gst = ml[0].get("gameStartTime")
        if not gst:
            continue
        t = datetime.datetime.fromisoformat(gst.replace(" ", "T").replace("+00", "+00:00"))
        if not (now < t < now + datetime.timedelta(hours=HORIZON_H)):
            continue
        home, away = [x.strip() for x in e["title"].split(" vs. ")]
        sides = {}
        for x in ml:
            q = x.get("question", "")
            if "draw" in q.lower():
                sides["D"] = x
            elif q.startswith(f"Will {home} win"):
                sides["H"] = x
            elif q.startswith(f"Will {away} win"):
                sides["A"] = x
        if len(sides) == 3:
            out.append({"slug": e["slug"], "league": m.group(1), "home": home, "away": away, "start": t, "sides": sides,
                        "volume": float(e.get("volume") or 0)})
    return out


def sm_games(now):
    out, url = [], f"{SM}/events/?type=football_match&state=upcoming&limit=500&sort=start_datetime,id"
    for _ in range(20):
        st, d = get_json(url)
        if st != 200 or not d:
            break
        for e in d.get("events", []):
            t = datetime.datetime.fromisoformat(e["start_datetime"].replace("Z", "+00:00"))
            if t < now + datetime.timedelta(hours=HORIZON_H):
                out.append(e)
        nxt = (d.get("pagination") or {}).get("next_page")
        last = d.get("events", [])[-1:] if d.get("events") else []
        if not nxt or not last or datetime.datetime.fromisoformat(last[0]["start_datetime"].replace("Z", "+00:00")) > now + datetime.timedelta(hours=HORIZON_H):
            break
        url = f"{SM}/events/{nxt}" if nxt.startswith("?") else nxt
        time.sleep(0.3)
    return out


def book_top(b):
    bids = sorted(((float(x["price"]), float(x["size"])) for x in (b or {}).get("bids", [])), reverse=True)
    asks = sorted((float(x["price"]), float(x["size"])) for x in (b or {}).get("asks", []))
    bid = bids[0][0] if bids else None
    ask = asks[0][0] if asks else None
    ask_usd_1c = sum(p * s for p, s in asks if ask is not None and p <= ask + 0.01 + 1e-9)
    bid_usd_1c = sum(p * s for p, s in bids if bid is not None and p >= bid - 0.01 - 1e-9)
    return bid, ask, round(ask_usd_1c, 2), round(bid_usd_1c, 2)


def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    stamp = now.strftime("%Y-%m-%dT%H%MZ")
    pms = pm_games(now)
    sms = sm_games(now)
    raw, rows = [], []
    for g in pms:
        cands = [e for e in sms if abs((datetime.datetime.fromisoformat(e["start_datetime"].replace("Z", "+00:00")) - g["start"]).total_seconds()) <= 3 * 3600
                 and " vs " in e["name"] and same(e["name"].split(" vs ")[0], g["home"]) and same(e["name"].split(" vs ")[1], g["away"])]
        if len(cands) != 1:
            rows.append({"slug": g["slug"], "matched": False, "smarkets_candidates": len(cands)})
            continue
        e = cands[0]
        st, mk = get_json(f"{SM}/events/{e['id']}/markets/")
        ftr = [m for m in (mk or {}).get("markets", []) if (m.get("market_type") or {}).get("name") == "WINNER_3_WAY"]
        if not ftr:
            rows.append({"slug": g["slug"], "matched": False, "reason": "no full-time result market"})
            continue
        mid = ftr[0]["id"]
        st, cs = get_json(f"{SM}/markets/{mid}/contracts/")
        st, qs = get_json(f"{SM}/markets/{mid}/quotes/")
        st, vol = get_json(f"{SM}/markets/{mid}/volumes/")
        time.sleep(0.3)
        ctype = {}
        for c in (cs or {}).get("contracts", []):
            ty = (c.get("contract_type") or {}).get("name")
            ctype[{"HOME": "H", "DRAW": "D", "AWAY": "A"}.get(ty, ty)] = c["id"]
        if not all(k in ctype for k in "HDA"):
            rows.append({"slug": g["slug"], "matched": False, "reason": "contract types"})
            continue
        books, sides = {}, {}
        for k in "HDA":
            mkt = g["sides"][k]
            tok = json.loads(mkt["clobTokenIds"])[0]
            st, b = get_json(f"https://clob.polymarket.com/book?token_id={tok}")
            time.sleep(0.12)
            books[k] = b
            q = (qs or {}).get(ctype[k], {})
            sb = max((x["price"] for x in q.get("bids", [])), default=None)
            so = min((x["price"] for x in q.get("offers", [])), default=None)
            so_gbp = sum(x["quantity"] for x in q.get("offers", []) if x["price"] == so) / 1e4 if so else 0
            pb, pa, pa_usd, pb_usd = book_top(b)
            fs = mkt.get("feeSchedule") if isinstance(mkt.get("feeSchedule"), dict) else {}
            rate = float(fs.get("rate", 0.05)) if fs else 0.05
            sides[k] = {"s_bid": sb / 1e4 if sb else None, "s_offer": so / 1e4 if so else None, "s_offer_stake_gbp_top": round(so_gbp, 2),
                        "p_bid": pb, "p_ask": pa, "p_ask_usd_within_1c": pa_usd, "p_bid_usd_within_1c": pb_usd, "fee_rate": rate,
                        "fee_type": mkt.get("feeType")}
        raw.append({"pm": {"slug": g["slug"], "markets": {k: g["sides"][k] for k in "HDA"}, "books": books},
                    "smarkets": {"event": e, "contracts": cs, "quotes": qs, "volumes": vol}})
        mids = {k: ((v["s_bid"] + v["s_offer"]) / 2 if v["s_bid"] and v["s_offer"] else None) for k, v in sides.items()}
        fair = None
        if all(mids.values()):
            s = sum(mids.values())
            fair = {k: mids[k] / s for k in mids}
        pmm = {k: ((v["p_bid"] + v["p_ask"]) / 2 if v["p_bid"] is not None and v["p_ask"] is not None else None) for k, v in sides.items()}
        out = {"slug": g["slug"], "league": g["league"], "smarkets": e["name"], "start": g["start"].isoformat(), "matched": True,
               "hours_to_kickoff": round((g["start"] - now).total_seconds() / 3600, 2), "pm_event_volume_usd": round(g["volume"]),
               "smarkets_matched_gbp": ((vol or {}).get("volume") or 0), "sides": sides, "fair_smarkets": fair}
        if fair:
            for k, v in sides.items():
                if v["p_ask"] is not None:
                    c = v["p_ask"] + v["fee_rate"] * v["p_ask"] * (1 - v["p_ask"])
                    v["pm_value_vs_fair"] = round(fair[k] / c - 1, 4)
                if v["p_bid"] is not None:
                    n = 1 - v["p_bid"]
                    c = n + v["fee_rate"] * n * (1 - n)
                    v["pm_lay_cost"] = round(c / (1 - c), 4)
                if v["s_bid"]:
                    L = 1 / v["s_bid"]
                    v["sm_lay_cost"] = round((L - 1) / (1 - COMM), 4)
                if pmm[k] is not None:
                    v["mid_gap_pm_minus_fair"] = round(pmm[k] - fair[k], 4)
                if v["s_bid"] and v["s_offer"]:
                    v["s_spread"] = round(v["s_offer"] - v["s_bid"], 4)
                if v["p_bid"] is not None and v["p_ask"] is not None:
                    v["p_spread"] = round(v["p_ask"] - v["p_bid"], 4)
        rows.append(out)
    os.makedirs(os.path.join(HERE, "inputs", "live"), exist_ok=True)
    with open(os.path.join(HERE, "inputs", "live", f"{stamp}.json.gz"), "wb") as fh:
        fh.write(gzip.compress(json.dumps({"at": now.isoformat(), "games": raw}, sort_keys=True, default=str).encode(), mtime=0))
    m = [r for r in rows if r.get("matched") and r.get("fair_smarkets")]
    allv = [v for r in m for v in r["sides"].values()]

    def q(xs):
        xs = sorted(x for x in xs if x is not None)
        if not xs:
            return None
        return {"n": len(xs), "min": xs[0], "p25": xs[len(xs) // 4], "median": xs[len(xs) // 2], "p75": xs[3 * len(xs) // 4], "max": xs[-1]}
    lay_better = [v for v in allv if v.get("pm_lay_cost") is not None and v.get("sm_lay_cost") is not None]
    summ = {"at": now.isoformat(), "pm_games_in_horizon": len(pms), "smarkets_games_in_horizon": len(sms),
            "matched_with_both_books": len(m), "unmatched": sum(1 for r in rows if not r.get("matched")),
            "leagues_matched": sorted({r["league"] for r in m}),
            "abs_mid_gap_pm_vs_smarkets_fair": q([abs(v["mid_gap_pm_minus_fair"]) for v in allv if v.get("mid_gap_pm_minus_fair") is not None]),
            "pm_spread": q([v.get("p_spread") for v in allv]), "smarkets_spread": q([v.get("s_spread") for v in allv]),
            "pm_ask_usd_within_1c": q([v.get("p_ask_usd_within_1c") for v in allv]),
            "smarkets_top_offer_gbp": q([v.get("s_offer_stake_gbp_top") for v in allv]),
            "pm_value_vs_fair": q([v.get("pm_value_vs_fair") for v in allv]),
            "pm_value_ge_2pct": sum(1 for v in allv if (v.get("pm_value_vs_fair") or -1) >= 0.02),
            "lay_cost_pm_minus_sm": q([v["pm_lay_cost"] - v["sm_lay_cost"] for v in lay_better]),
            "lay_pm_cheaper_share": round(sum(1 for v in lay_better if v["pm_lay_cost"] < v["sm_lay_cost"]) / len(lay_better), 3) if lay_better else None,
            "fee_types": sorted({str(v.get("fee_type")) for v in allv}),
            "games": rows}
    with open(os.path.join(HERE, "results", f"live_snapshot_{stamp}.json"), "w") as fh:
        json.dump(summ, fh, indent=1, sort_keys=True, default=str)
    print(json.dumps({k: v for k, v in summ.items() if k != "games"}, indent=1, default=str))


if __name__ == "__main__":
    main()
