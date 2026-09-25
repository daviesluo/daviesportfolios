"""Pull the Premier League full-time sample. Keyless. No orders.

Scores are football-data.co.uk E0 final scores. Odds columns are dropped.
Shown prices are the last history point in the 30 minutes before the
decision, which is one hour before kickoff. Prints are not fetched here.

usage: epl_inputs.py --self-check
       epl_inputs.py <out.json.gz>
"""
import csv
import io
import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from zoneinfo import ZoneInfo

import epl_score as score
import pmnet
import post_inputs
import post_test

SERIES = 10188
GAMMA = "https://gamma-api.polymarket.com"
SCORE_URLS = (
    "https://www.football-data.co.uk/mmz4281/2425/E0.csv",
    "https://www.football-data.co.uk/mmz4281/2526/E0.csv",
    "https://www.football-data.co.uk/mmz4281/2627/E0.csv",
)
LONDON = ZoneInfo("Europe/London")
# 15 August 2025, 20:00 London, is 19:00 UTC. The public kickoff and the file agree.
LIVERPOOL_KICK = 1755284400


def cache_dir():
    d = os.path.join(pmnet.DATA, "epl", "struct")
    os.makedirs(d, exist_ok=True)
    return d


def parse_csv(text):
    """Date, kickoff, clubs and full-time goals. Every other column is ignored."""
    rows = []
    for row in csv.DictReader(io.StringIO(text.lstrip("\ufeff"))):
        try:
            hg = int(row["FTHG"])
            ag = int(row["FTAG"])
            stamp = datetime.strptime(row["Date"].strip() + " " + row["Time"].strip(), "%d/%m/%Y %H:%M")
        except (KeyError, TypeError, ValueError):
            continue
        kick = stamp.replace(tzinfo=LONDON).timestamp()
        home, away = row["HomeTeam"].strip(), row["AwayTeam"].strip()
        if not home or not away:
            continue
        rows.append({"kick": kick, "home": home, "away": away, "hg": hg, "ag": ag})
    rows.sort(key=lambda s: (s["kick"], s["home"], s["away"]))
    return rows


def load_scores():
    path = os.path.join(pmnet.DATA, "epl", "scores.json")
    if os.path.exists(path):
        return pmnet.load(path)
    seen = set()
    rows = []
    for url in SCORE_URLS:
        req = urllib.request.Request(url, headers={"User-Agent": pmnet.UA})
        with urllib.request.urlopen(req, timeout=60) as resp:
            text = resp.read().decode("utf-8-sig")
        for row in parse_csv(text):
            key = (row["kick"], row["home"], row["away"])
            if key in seen:
                continue
            seen.add(key)
            rows.append(row)
    rows.sort(key=lambda s: (s["kick"], s["home"], s["away"]))
    pmnet.dump(path, rows)
    print("scores", len(rows), flush=True)
    return rows


def list_events():
    path = os.path.join(pmnet.DATA, "epl", "events.json")
    if os.path.exists(path):
        return pmnet.load(path)
    rows = []
    seen = set()
    cursor = None
    while True:
        params = {"limit": 100, "closed": "true", "series_id": SERIES}
        if cursor:
            params["after_cursor"] = cursor
        data = pmnet.get(GAMMA + "/events/keyset", params)
        batch = data.get("events") or []
        for ev in batch:
            slug = ev.get("slug") or ""
            end = post_inputs.ts_of(ev.get("endDate"))
            parts = slug.split("-")
            if end is None or post_test.window_of(end) is None or slug in seen:
                continue
            if len(parts) != 6 or parts[0] != "epl":
                continue
            seen.add(slug)
            rows.append({"slug": slug, "end": end})
        cursor = data.get("next_cursor")
        if not cursor or not batch:
            break
    rows.sort(key=lambda r: (r["end"], r["slug"]))
    pmnet.dump(path, rows)
    print("events_listed", len(rows), flush=True)
    return rows


def side_of(question, home, away):
    text = question or ""
    if " end in a draw?" in text:
        return "D"
    if text.startswith("Will ") and " win on " in text:
        name = score.canonical(text[len("Will "):text.rfind(" win on ")])
        if name == home:
            return "H"
        if name == away:
            return "A"
    return None


def one(ev):
    path = os.path.join(cache_dir(), ev["slug"] + ".json")
    if os.path.exists(path):
        return pmnet.load(path)
    end = float(ev["end"])
    data = pmnet.get(GAMMA + "/events", {"slug": ev["slug"]})
    raw = data[0] if isinstance(data, list) else data
    title = (raw or {}).get("title") or ""
    if " vs. " not in title:
        payload = {"slug": ev["slug"], "skip": "title"}
        pmnet.dump(path, payload)
        return payload
    home_raw, away_raw = title.split(" vs. ", 1)
    home, away = score.canonical(home_raw), score.canonical(away_raw)
    if home is None or away is None:
        payload = {"slug": ev["slug"], "skip": "name", "title": title}
        pmnet.dump(path, payload)
        return payload
    td = end - post_test.OPEN_LAG
    closed_ev = post_inputs.ts_of((raw or {}).get("closedTime")) or end
    markets = {}
    for m in (raw or {}).get("markets") or []:
        try:
            outs = json.loads(m.get("outcomes") or "[]")
            prices = json.loads(m.get("outcomePrices") or "[]")
            toks = json.loads(m.get("clobTokenIds") or "[]")
        except (TypeError, ValueError):
            continue
        if outs != ["Yes", "No"] or len(prices) != 2 or len(toks) < 1:
            continue
        side = side_of(m.get("question") or "", home, away)
        if side is None or side in markets:
            continue
        rate = post_inputs.rate_of(m)
        if rate is None:
            continue
        try:
            pay = float(prices[0])
        except (TypeError, ValueError):
            continue
        if pay >= 0.99:
            payout = 1.0
        elif pay <= 0.01:
            payout = 0.0
        else:
            payload = {"slug": ev["slug"], "skip": "unresolved"}
            pmnet.dump(path, payload)
            return payload
        try:
            tick = float(m.get("orderPriceMinTickSize") or 0.001)
        except (TypeError, ValueError):
            tick = 0.001
        shown = post_inputs.shown_yes(toks[0], td)
        markets[side] = {
            "condition": m.get("conditionId"),
            "shown": shown,
            "tick": tick,
            "rate": rate,
            "payout_yes": payout,
            "closed": post_inputs.ts_of(m.get("closedTime")) or closed_ev,
        }
    if set(markets) != {"H", "D", "A"}:
        payload = {"slug": ev["slug"], "skip": "sides", "title": title}
        pmnet.dump(path, payload)
        return payload
    payload = {
        "slug": ev["slug"], "series": SERIES, "end": end, "closed": closed_ev,
        "home": home, "away": away, "markets": markets,
    }
    pmnet.dump(path, payload)
    return payload


def self_check():
    text = "Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,B365H\n15/08/2025,20:00,Liverpool,Bournemouth,4,2,1.50\n"
    rows = parse_csv(text)
    if len(rows) != 1 or rows[0]["home"] != "Liverpool" or rows[0]["hg"] != 4 or rows[0]["ag"] != 2:
        raise SystemExit("parse %s" % rows)
    if rows[0]["kick"] != LIVERPOOL_KICK:
        raise SystemExit("kick %s" % rows[0]["kick"])
    if len(rows[0]) != 5:
        raise SystemExit("odds column kept %s" % rows[0])
    print("self-check ok", LIVERPOOL_KICK)


def main():
    outp = sys.argv[1]
    scores = load_scores()
    events = list_events()
    done = 0
    rows = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = [pool.submit(one, ev) for ev in events]
        for fut in as_completed(futs):
            rows.append(fut.result())
            done += 1
            if done % 50 == 0:
                print("structures", done, flush=True)
    kept = [r for r in rows if r.get("home") and r.get("markets")]
    skipped = {}
    for r in rows:
        if r.get("skip"):
            skipped[r["skip"]] = skipped.get(r["skip"], 0) + 1
    kept.sort(key=lambda r: (r["end"], r["slug"]))
    os.makedirs(os.path.dirname(os.path.abspath(outp)) or ".", exist_ok=True)
    with gzip_open(outp) as f:
        json.dump({"events": kept, "scores": scores}, f, sort_keys=True, separators=(",", ":"))
    print("wrote", outp, "events", len(kept), "scores", len(scores), "skipped", skipped, flush=True)


def gzip_open(path):
    import gzip
    return gzip.open(path, "wt")


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--self-check":
        self_check()
    else:
        main()
