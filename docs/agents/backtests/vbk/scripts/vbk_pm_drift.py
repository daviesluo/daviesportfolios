"""VB-K, delay leg: how far a sharp football price moves in the minutes before kick-off, on Polymarket's minute history.

A slip is produced at t and clicked at t + delay. Two things erode its edge in between: the bookmaker corrects its
price (not measurable keylessly: no UK book publishes minute history), and the fair price itself moves. This measures
the second on the only keyless minute-level football price history found: Polymarket's CLOB /prices-history at
fidelity 1 (one point a minute) for the home-win YES token of closed soccer match events with at least $100k volume,
kick-off within the last 60 days (Gamma's gameStartTime). For each game: |p(T-5) - p(T-5-d)| for d = 2, 5, 10 minutes,
the same an hour earlier (T-65), and the follow-through after a one-minute move of >= 2 cents (the next 10 minutes'
move in the jump's direction: > 0 continuation, < 0 reversal). Polymarket's history is its own price series (not a UK
book's): it bounds how much the FAIR moves, not how fast a bookmaker reacts. Writes inputs/pm_drift/<stamp>.json.gz and
results/pm_drift_<stamp>.json. GET only.
"""
import datetime, gzip, json, os, re, statistics, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "statarb_search2", "scripts"))
from netget import get_json  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAGS = ["epl", "soccer", "champions-league", "la-liga", "serie-a", "bundesliga", "ligue-1", "uefa-europa-league", "efl-championship"]
MIN_VOL = 100_000
DAYS = 60


def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    stamp = now.strftime("%Y-%m-%dT%H%MZ")
    pat = re.compile(r"^([a-z0-9]+)-([a-z0-9]+)-([a-z0-9]+)-(\d{4}-\d{2}-\d{2})$")
    seen, games = set(), []
    for tag in TAGS:
        for off in range(0, 3000, 100):
            st, d = get_json(f"https://gamma-api.polymarket.com/events?tag_slug={tag}&closed=true&limit=100&offset={off}&order=endDate&ascending=false")
            if st != 200 or not d:
                break
            stop = False
            for e in d:
                if e["slug"] in seen or not pat.match(e["slug"]) or " vs. " not in e.get("title", ""):
                    continue
                ml = [x for x in e.get("markets", []) if x.get("sportsMarketType") == "moneyline"]
                if len(ml) != 3 or not ml[0].get("gameStartTime"):
                    continue
                t = datetime.datetime.fromisoformat(ml[0]["gameStartTime"].replace(" ", "T").replace("+00", "+00:00"))
                if t < now - datetime.timedelta(days=DAYS):
                    stop = True
                    continue
                if float(e.get("volume") or 0) < MIN_VOL:
                    continue
                home = e["title"].split(" vs. ")[0].strip()
                hm = [x for x in ml if x.get("question", "").startswith(f"Will {home} win")]
                if not hm:
                    continue
                seen.add(e["slug"])
                games.append({"slug": e["slug"], "league": pat.match(e["slug"]).group(1), "start": t, "volume": float(e["volume"]),
                              "token": json.loads(hm[0]["clobTokenIds"])[0]})
            if len(d) < 100 or stop:
                break
            time.sleep(0.2)
    raw, per = [], []
    for g in sorted(games, key=lambda g: g["slug"]):
        k = int(g["start"].timestamp())
        st, h = get_json(f"https://clob.polymarket.com/prices-history?market={g['token']}&startTs={k - 80 * 60}&endTs={k}&fidelity=1")
        time.sleep(0.15)
        pts = sorted(((int(x["t"]), float(x["p"])) for x in (h or {}).get("history", [])))
        raw.append({"slug": g["slug"], "start": g["start"].isoformat(), "token": g["token"], "history": pts})
        if len(pts) < 40:
            continue

        def at(ts):
            best = None
            for t, p in pts:
                if t <= ts:
                    best = p
            return best
        row = {"slug": g["slug"], "league": g["league"], "points": len(pts)}
        for base, lab in ((k - 5 * 60, "T-5"), (k - 65 * 60, "T-65")):
            for dmin in (2, 5, 10):
                a, b = at(base), at(base - dmin * 60)
                if a is not None and b is not None:
                    row[f"abs_move_{dmin}m_to_{lab}"] = round(abs(a - b), 4)
        # follow-through after a one-minute move of >= 2 cents, in the last 75 minutes
        ft = []
        minute = {t // 60: p for t, p in pts}
        ms = sorted(minute)
        for i in range(1, len(ms)):
            m0, m1 = ms[i - 1], ms[i]
            if m1 - m0 != 1:
                continue
            j = minute[m1] - minute[m0]
            if abs(j) >= 0.02 and (m1 + 10) in minute:
                ft.append(round((minute[m1 + 10] - minute[m1]) * (1 if j > 0 else -1), 4))
        row["jumps"] = len(ft)
        row["follow_through"] = ft
        per.append(row)
    os.makedirs(os.path.join(HERE, "inputs", "pm_drift"), exist_ok=True)
    with open(os.path.join(HERE, "inputs", "pm_drift", f"{stamp}.json.gz"), "wb") as fh:
        fh.write(gzip.compress(json.dumps({"at": now.isoformat(), "games": raw}, sort_keys=True).encode(), mtime=0))

    def q(xs):
        xs = sorted(xs)
        if not xs:
            return None
        return {"n": len(xs), "median": xs[len(xs) // 2], "p75": xs[3 * len(xs) // 4], "p90": xs[int(0.9 * len(xs))],
                "mean": round(statistics.mean(xs), 4), "share_ge_2c": round(sum(1 for x in xs if x >= 0.02) / len(xs), 3)}
    summ = {"at": now.isoformat(), "games_found": len(games), "games_with_history": len(per),
            "leagues": sorted({r["league"] for r in per})}
    for lab in ("T-5", "T-65"):
        for dmin in (2, 5, 10):
            key = f"abs_move_{dmin}m_to_{lab}"
            summ[key] = q([r[key] for r in per if key in r])
    fts = [x for r in per for x in r["follow_through"]]
    summ["jump_follow_through_10m"] = {"jumps": len(fts), "mean": round(statistics.mean(fts), 4) if fts else None,
                                       "median": (sorted(fts)[len(fts) // 2] if fts else None),
                                       "share_continuation": round(sum(1 for x in fts if x > 0) / len(fts), 3) if fts else None,
                                       "share_reversal": round(sum(1 for x in fts if x < 0) / len(fts), 3) if fts else None}
    summ["games"] = per
    with open(os.path.join(HERE, "results", f"pm_drift_{stamp}.json"), "w") as fh:
        json.dump(summ, fh, indent=1, sort_keys=True)
    print(json.dumps({k: v for k, v in summ.items() if k != "games"}, indent=1))


if __name__ == "__main__":
    main()
