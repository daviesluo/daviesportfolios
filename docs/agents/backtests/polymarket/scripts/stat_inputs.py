"""Pull Premier League moneyline, full-time -1.5, both-teams-to-score, over 3.5 and total corners.

Keyless. No orders. Odds columns on the score file are dropped. Shown prices
are the last history point in the 30 minutes before the decision, one hour
before kickoff. Prints are not fetched here.

usage: stat_inputs.py --self-check
       stat_inputs.py <out.json.gz>
"""
import csv
import gzip
import io
import json
import os
import re
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
LIVERPOOL_KICK = 1755284400
PARSER = 1
OU_LINE = re.compile(r"O/U\s+([0-9]+(?:\.[0-9]+)?)")
SCORE_KEYS = ("kick", "home", "away", "hg", "ag", "hst", "ast", "hf", "af", "hy", "ay", "hc", "ac", "ref")


def cache_dir():
    d = os.path.join(pmnet.DATA, "stat", "struct")
    os.makedirs(d, exist_ok=True)
    return d


def _blank_int(row, key):
    raw = (row.get(key) or "").strip()
    if raw == "":
        return None
    return int(raw)


def parse_csv(text):
    """Goals and match stats. Every odds column is ignored."""
    rows = []
    for row in csv.DictReader(io.StringIO(text.lstrip("\ufeff"))):
        try:
            hg = int(row["FTHG"])
            ag = int(row["FTAG"])
            stamp = datetime.strptime(row["Date"].strip() + " " + row["Time"].strip(), "%d/%m/%Y %H:%M")
        except (KeyError, TypeError, ValueError):
            continue
        home, away = row["HomeTeam"].strip(), row["AwayTeam"].strip()
        if not home or not away:
            continue
        ref = (row.get("Referee") or "").strip() or None
        parsed = {
            "kick": stamp.replace(tzinfo=LONDON).timestamp(),
            "home": home, "away": away, "hg": hg, "ag": ag, "ref": ref,
        }
        for src, dst in (
            ("HST", "hst"), ("AST", "ast"), ("HF", "hf"), ("AF", "af"),
            ("HY", "hy"), ("AY", "ay"), ("HC", "hc"), ("AC", "ac"),
        ):
            try:
                parsed[dst] = _blank_int(row, src)
            except ValueError:
                parsed[dst] = None
        rows.append(parsed)
    rows.sort(key=lambda s: (s["kick"], s["home"], s["away"]))
    return rows


def _outs(m):
    raw = m.get("outcomes")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (TypeError, ValueError):
            return None
    if not isinstance(raw, list):
        return None
    return raw


def _is_half(question):
    text = (question or "").lower()
    return (
        "1st half" in text or "2nd half" in text
        or "first half" in text or "second half" in text
    )


def _line(m, question):
    if m.get("line") is not None and m.get("line") != "":
        try:
            return float(m["line"])
        except (TypeError, ValueError):
            pass
    found = OU_LINE.search(question or "")
    if not found:
        return None
    return float(found.group(1))


def _line_key(line):
    return "%.1f" % float(line)


def classify_more(m):
    """A full-time -1.5, a 3.5 total, or both teams to score. Anything else is None."""
    if _is_half(m.get("question")):
        return None
    smt = m.get("sportsMarketType")
    question = m.get("question") or ""
    outs = _outs(m)
    if smt == "spreads":
        line = _line(m, question)
        if line is None or abs(line - (-1.5)) > 1e-9 or "(-1.5)" not in question:
            return None
        if not question.startswith("Spread: "):
            return None
        name = question[len("Spread: "):].rsplit(" (", 1)[0].strip()
        team = score.canonical(name)
        if team is None or not outs or score.canonical(outs[0]) != team:
            return None
        return ("spread", team, -1.5)
    if smt == "totals":
        line = _line(m, question)
        if line is None or abs(line - 3.5) > 1e-9 or outs != ["Over", "Under"]:
            return None
        return ("over", "Y", 3.5)
    if smt == "both_teams_to_score":
        if outs != ["Yes", "No"]:
            return None
        return ("btts", "Y", None)
    return None


def classify_corner(m):
    """A full-time total-corners over. Half, team and odd/even markets are None."""
    if m.get("sportsMarketType") != "total_corners" or _is_half(m.get("question")):
        return None
    question = m.get("question") or ""
    if "Total Corners" not in question:
        return None
    if _outs(m) != ["Over", "Under"]:
        return None
    line = _line(m, question)
    if line is None:
        return None
    return _line_key(line)


def clubs_of(title):
    head = (title or "").split(" - ")[0]
    if " vs. " not in head:
        return None, None
    home_raw, away_raw = head.split(" vs. ", 1)
    return score.canonical(home_raw), score.canonical(away_raw)


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


def slug_kind(slug):
    if slug.endswith("-more-markets"):
        return "more"
    if slug.endswith("-total-corners"):
        return "corners"
    parts = slug.split("-")
    if len(parts) == 6 and parts[0] == "epl":
        return "ml"
    return None


def load_scores():
    path = os.path.join(pmnet.DATA, "stat", "scores.json")
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
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pmnet.dump(path, rows)
    print("scores", len(rows), flush=True)
    return rows


def ref_index(scores):
    out = {}
    dup = set()
    for row in scores:
        key = (row["home"], row["away"], int(round(float(row["kick"]))))
        if key in out:
            dup.add(key)
        out[key] = row.get("ref")
    for key in dup:
        out[key] = None
    return out


def list_events():
    path = os.path.join(pmnet.DATA, "stat", "listed.json")
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
            kind = slug_kind(slug)
            if end is None or kind is None or post_test.window_of(end) is None or slug in seen:
                continue
            seen.add(slug)
            rows.append({"slug": slug, "end": end, "kind": kind})
        cursor = data.get("next_cursor")
        if not cursor or not batch:
            break
    rows.sort(key=lambda r: (r["end"], r["slug"]))
    pmnet.dump(path, rows)
    print("events_listed", len(rows), flush=True)
    return rows


def priced(m, td, closed_ev):
    """The first outcome. None when the fee or the settlement is not usable."""
    try:
        prices = json.loads(m.get("outcomePrices") or "[]")
        toks = json.loads(m.get("clobTokenIds") or "[]")
    except (TypeError, ValueError):
        return None
    if len(prices) != 2 or len(toks) < 1:
        return None
    rate = post_inputs.rate_of(m)
    if rate is None or not m.get("conditionId"):
        return None
    try:
        pay = float(prices[0])
    except (TypeError, ValueError):
        return None
    if pay >= 0.99:
        payout = 1.0
    elif pay <= 0.01:
        payout = 0.0
    else:
        return None
    try:
        tick = float(m.get("orderPriceMinTickSize") or 0.001)
    except (TypeError, ValueError):
        tick = 0.001
    return {
        "condition": m.get("conditionId"),
        "shown": post_inputs.shown_yes(toks[0], td),
        "tick": tick,
        "rate": rate,
        "payout_yes": payout,
        "closed": post_inputs.ts_of(m.get("closedTime")) or closed_ev,
    }


def _base(slug, end, closed_ev, home, away, kind):
    return {
        "slug": slug, "series": SERIES, "kind": kind, "end": end, "closed": closed_ev,
        "home": home, "away": away, "markets": {},
    }


def one(ev, refs):
    path = os.path.join(cache_dir(), ev["slug"] + ".json")
    if os.path.exists(path):
        cached = pmnet.load(path)
        if cached.get("parser") == PARSER:
            return cached.get("rows") or []
    end = float(ev["end"])
    data = pmnet.get(GAMMA + "/events", {"slug": ev["slug"]})
    raw = data[0] if isinstance(data, list) else data
    home, away = clubs_of((raw or {}).get("title"))
    if home is None or away is None:
        pmnet.dump(path, {"parser": PARSER, "rows": []})
        return []
    td = end - post_test.OPEN_LAG
    closed_ev = post_inputs.ts_of((raw or {}).get("closedTime")) or end
    rows = build_rows(ev, raw, home, away, end, td, closed_ev, refs)
    pmnet.dump(path, {"parser": PARSER, "rows": rows})
    return rows


def build_rows(ev, raw, home, away, end, td, closed_ev, refs):
    kind = ev["kind"]
    if kind == "ml":
        markets = {}
        for m in (raw or {}).get("markets") or []:
            side = side_of(m.get("question") or "", home, away)
            if side is None or side in markets:
                continue
            got = priced(m, td, closed_ev)
            if got is None:
                continue
            markets[side] = got
        if set(markets) != {"H", "D", "A"}:
            return []
        row = _base(ev["slug"], end, closed_ev, home, away, "ml")
        row["markets"] = markets
        row["ref"] = refs.get((home, away, int(round(end))))
        return [row]
    if kind == "corners":
        markets = {}
        for m in (raw or {}).get("markets") or []:
            key = classify_corner(m)
            if key is None or key in markets:
                continue
            got = priced(m, td, closed_ev)
            if got is None:
                continue
            markets[key] = got
        if not markets:
            return []
        row = _base(ev["slug"], end, closed_ev, home, away, "corners")
        row["markets"] = markets
        return [row]
    grouped = {"spread": {}, "btts": {}, "over": {}}
    line_over = None
    for m in (raw or {}).get("markets") or []:
        got_cls = classify_more(m)
        if got_cls is None:
            continue
        slot, key, line = got_cls
        if key in grouped[slot]:
            continue
        got = priced(m, td, closed_ev)
        if got is None:
            continue
        grouped[slot][key] = got
        if slot == "over":
            line_over = line
    out = []
    if grouped["spread"]:
        row = _base(ev["slug"] + "--spread", end, closed_ev, home, away, "spread")
        row["markets"] = grouped["spread"]
        out.append(row)
    if grouped["btts"]:
        row = _base(ev["slug"] + "--btts", end, closed_ev, home, away, "btts")
        row["markets"] = grouped["btts"]
        out.append(row)
    if grouped["over"]:
        row = _base(ev["slug"] + "--over", end, closed_ev, home, away, "over")
        row["markets"] = grouped["over"]
        row["line"] = line_over
        out.append(row)
    return out


def self_check():
    text = (
        "Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,HST,AST,HF,AF,HY,AY,HC,AC,Referee,B365H\n"
        "15/08/2025,20:00,Liverpool,Bournemouth,4,2,10,3,7,10,1,2,6,7,A Taylor,1.50\n"
    )
    rows = parse_csv(text)
    if len(rows) != 1 or rows[0]["home"] != "Liverpool" or rows[0]["hg"] != 4 or rows[0]["hst"] != 10:
        raise SystemExit("parse %s" % rows)
    if rows[0]["kick"] != LIVERPOOL_KICK or rows[0]["ref"] != "A Taylor":
        raise SystemExit("kick %s" % rows[0])
    if set(rows[0]) != set(SCORE_KEYS) or "B365H" in rows[0]:
        raise SystemExit("odds column kept %s" % rows[0])
    spread = {
        "sportsMarketType": "spreads", "question": "Spread: Arsenal FC (-1.5)",
        "line": -1.5, "outcomes": ["Arsenal FC", "Coventry City FC"],
    }
    if classify_more(spread) != ("spread", "Arsenal", -1.5):
        raise SystemExit("spread %s" % (classify_more(spread),))
    wide = dict(spread)
    wide["line"] = -2.5
    wide["question"] = "Spread: Arsenal FC (-2.5)"
    if classify_more(wide) is not None:
        raise SystemExit("a -2.5 spread was kept")
    flipped = dict(spread)
    flipped["outcomes"] = ["Coventry City FC", "Arsenal FC"]
    if classify_more(flipped) is not None:
        raise SystemExit("a reversed spread token was kept")
    total = {
        "sportsMarketType": "totals", "question": "Arsenal FC vs. Coventry City FC: O/U 3.5",
        "line": 3.5, "outcomes": ["Over", "Under"],
    }
    if classify_more(total) != ("over", "Y", 3.5):
        raise SystemExit("total %s" % (classify_more(total),))
    other = dict(total)
    other["line"] = 2.5
    other["question"] = "Arsenal FC vs. Coventry City FC: O/U 2.5"
    if classify_more(other) is not None:
        raise SystemExit("a 2.5 total was kept")
    under = dict(total)
    under["outcomes"] = ["Under", "Over"]
    if classify_more(under) is not None:
        raise SystemExit("an under token was kept")
    half = {
        "sportsMarketType": "first_half_totals",
        "question": "Arsenal FC vs. Coventry City FC: 1st Half O/U 3.5",
        "line": 3.5, "outcomes": ["Over", "Under"],
    }
    if classify_more(half) is not None or classify_corner({
        "sportsMarketType": "soccer_first_half_total_corners",
        "question": "Arsenal FC vs. Coventry City FC: 1st Half O/U 4.5 Total Corners",
        "line": 4.5, "outcomes": ["Over", "Under"],
    }) is not None:
        raise SystemExit("a half market was kept")
    team_total = {
        "sportsMarketType": "soccer_team_totals",
        "question": "Arsenal FC vs. Coventry City FC: Arsenal FC O/U 3.5",
        "line": 3.5, "outcomes": ["Over", "Under"],
    }
    if classify_more(team_total) is not None:
        raise SystemExit("a team total was kept")
    btts = {
        "sportsMarketType": "both_teams_to_score",
        "question": "Arsenal FC vs. Coventry City FC: Both Teams to Score",
        "outcomes": ["Yes", "No"],
    }
    if classify_more(btts) != ("btts", "Y", None):
        raise SystemExit("btts %s" % (classify_more(btts),))
    btts_half = {
        "sportsMarketType": "both_teams_to_score_first_half",
        "question": "Arsenal FC vs. Coventry City FC: Both Teams to Score in First Half",
        "outcomes": ["Yes", "No"],
    }
    if classify_more(btts_half) is not None:
        raise SystemExit("a first-half both-teams market was kept")
    corner = {
        "sportsMarketType": "total_corners",
        "question": "Arsenal FC vs. Coventry City FC: O/U 9.5 Total Corners",
        "line": 9.5, "outcomes": ["Over", "Under"],
    }
    if classify_corner(corner) != "9.5":
        raise SystemExit("corner %s" % (classify_corner(corner),))
    if classify_corner({
        "sportsMarketType": "soccer_team_total_corners",
        "question": "Arsenal FC vs. Coventry City FC: Arsenal FC O/U 4.5 Corners",
        "line": 4.5, "outcomes": ["Over", "Under"],
    }) is not None:
        raise SystemExit("a team corner market was kept")
    print("self-check ok", LIVERPOOL_KICK)


def main():
    outp = sys.argv[1]
    scores = load_scores()
    refs = ref_index(scores)
    events = list_events()
    done = 0
    rows = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futs = [pool.submit(one, ev, refs) for ev in events]
        for fut in as_completed(futs):
            rows.extend(fut.result())
            done += 1
            if done % 50 == 0:
                print("structures", done, flush=True)
    rows.sort(key=lambda r: (r["end"], r["slug"]))
    os.makedirs(os.path.dirname(os.path.abspath(outp)) or ".", exist_ok=True)
    with gzip.open(outp, "wt") as f:
        json.dump({"events": rows, "scores": scores}, f, sort_keys=True, separators=(",", ":"))
    kinds = {}
    for row in rows:
        kinds[row["kind"]] = kinds.get(row["kind"], 0) + 1
    print("wrote", outp, "events", len(rows), "scores", len(scores), "kinds", kinds, flush=True)


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--self-check":
        self_check()
    else:
        main()
