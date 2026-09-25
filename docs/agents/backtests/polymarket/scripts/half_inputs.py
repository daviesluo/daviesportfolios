"""Pull Premier League moneylines, halftime results, team totals at 1.5 and first-half overs at 0.5.

Keyless. No orders. Odds columns on the score file are dropped. Shown prices
are the last history point in the 30 minutes before the decision, one hour
before kickoff. Prints are not fetched here. Spreads, both-teams-to-score,
full-time totals, corners and every other line are not stored.

usage: half_inputs.py --self-check
       half_inputs.py <out.json.gz>
"""
import csv
import gzip
import io
import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import epl_score as score
import pmnet
import post_inputs
import post_test
import stat_inputs as book

SERIES = book.SERIES
GAMMA = book.GAMMA
SCORE_URLS = book.SCORE_URLS
LONDON = book.LONDON
LIVERPOOL_KICK = book.LIVERPOOL_KICK
PARSER = 1
SCORE_KEYS = (
    "kick", "home", "away", "hg", "ag", "hthg", "htag", "htr", "hc", "ac",
    "hcl", "acl", "hsh", "ash", "hld", "ald",
)


def cache_dir():
    d = os.path.join(pmnet.DATA, "half", "struct")
    os.makedirs(d, exist_ok=True)
    return d


def annotate(row):
    """Clean sheets, second-half goals, and who led at the break. None when a score is missing."""
    out = dict(row)
    try:
        hg, ag = int(row["hg"]), int(row["ag"])
        hthg, htag = int(row["hthg"]), int(row["htag"])
    except (KeyError, TypeError, ValueError):
        out["hcl"] = out["acl"] = out["hsh"] = out["ash"] = out["hld"] = out["ald"] = None
        return out
    htr = row.get("htr")
    if htr not in ("H", "D", "A"):
        if hthg > htag:
            htr = "H"
        elif hthg < htag:
            htr = "A"
        else:
            htr = "D"
        out["htr"] = htr
    out["hcl"] = 1 if ag == 0 else 0
    out["acl"] = 1 if hg == 0 else 0
    out["hsh"] = hg - hthg
    out["ash"] = ag - htag
    out["hld"] = 1 if htr == "H" else 0
    out["ald"] = 1 if htr == "A" else 0
    return out


def parse_csv(text):
    """Final and half-time scores, plus corners. Every odds column is ignored."""
    rows = []
    for row in csv.DictReader(io.StringIO(text.lstrip("\ufeff"))):
        try:
            hg = int(row["FTHG"])
            ag = int(row["FTAG"])
            hthg = int(row["HTHG"])
            htag = int(row["HTAG"])
            stamp = datetime.strptime(row["Date"].strip() + " " + row["Time"].strip(), "%d/%m/%Y %H:%M")
        except (KeyError, TypeError, ValueError):
            continue
        home, away = row["HomeTeam"].strip(), row["AwayTeam"].strip()
        if not home or not away:
            continue
        htr = (row.get("HTR") or "").strip()
        if htr not in ("H", "D", "A"):
            htr = None
        try:
            hc = book._blank_int(row, "HC")
            ac = book._blank_int(row, "AC")
        except ValueError:
            hc = ac = None
        parsed = annotate({
            "kick": stamp.replace(tzinfo=LONDON).timestamp(),
            "home": home, "away": away, "hg": hg, "ag": ag,
            "hthg": hthg, "htag": htag, "htr": htr, "hc": hc, "ac": ac,
        })
        rows.append(parsed)
    rows.sort(key=lambda s: (s["kick"], s["home"], s["away"]))
    return rows


def slug_kind(slug):
    if slug.endswith("-halftime-result"):
        return "ht"
    if slug.endswith("-more-markets"):
        return "more"
    parts = slug.split("-")
    if len(parts) == 6 and parts[0] == "epl":
        return "ml"
    return None


def classify_ht(m, home, away):
    """A club leading at the break, or the halftime draw. Anything else is None."""
    if m.get("sportsMarketType") != "soccer_halftime_result":
        return None
    if book._outs(m) != ["Yes", "No"]:
        return None
    question = m.get("question") or ""
    if question.endswith("Draw at halftime?"):
        return "D"
    suffix = " leading at halftime?"
    if not question.endswith(suffix):
        return None
    team = score.canonical(question[:-len(suffix)].strip())
    if team not in (home, away):
        return None
    return team


def classify_team(m, home, away):
    """One club's full-time over 1.5. Other lines and half totals are None."""
    if m.get("sportsMarketType") != "soccer_team_totals":
        return None
    question = m.get("question") or ""
    if "1st Half" in question or "2nd Half" in question:
        return None
    if book._outs(m) != ["Over", "Under"]:
        return None
    line = book._line(m, question)
    if line is None or abs(line - 1.5) > 1e-9:
        return None
    if ": " not in question or " O/U " not in question:
        return None
    name = question.split(": ", 1)[1].split(" O/U ", 1)[0].strip()
    team = score.canonical(name)
    if team not in (home, away):
        return None
    return team


def classify_fh(m):
    """The first-half match over 0.5. A 1.5 line and a team total are None."""
    if m.get("sportsMarketType") != "first_half_totals":
        return None
    question = m.get("question") or ""
    if "1st Half O/U" not in question:
        return None
    if book._outs(m) != ["Over", "Under"]:
        return None
    line = book._line(m, question)
    if line is None or abs(line - 0.5) > 1e-9:
        return None
    return "Y"


def load_scores():
    path = os.path.join(pmnet.DATA, "half", "scores.json")
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


def list_events():
    path = os.path.join(pmnet.DATA, "half", "listed.json")
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


def _base(slug, end, closed_ev, home, away, kind):
    return {
        "slug": slug, "series": SERIES, "kind": kind, "end": end, "closed": closed_ev,
        "home": home, "away": away, "markets": {},
    }


def one(ev):
    path = os.path.join(cache_dir(), ev["slug"] + ".json")
    if os.path.exists(path):
        cached = pmnet.load(path)
        if cached.get("parser") == PARSER:
            return cached.get("rows") or []
    end = float(ev["end"])
    data = pmnet.get(GAMMA + "/events", {"slug": ev["slug"]})
    raw = data[0] if isinstance(data, list) else data
    home, away = book.clubs_of((raw or {}).get("title"))
    if home is None or away is None:
        pmnet.dump(path, {"parser": PARSER, "rows": []})
        return []
    td = end - post_test.OPEN_LAG
    closed_ev = post_inputs.ts_of((raw or {}).get("closedTime")) or end
    rows = build_rows(ev, raw, home, away, end, td, closed_ev)
    pmnet.dump(path, {"parser": PARSER, "rows": rows})
    return rows


def build_rows(ev, raw, home, away, end, td, closed_ev):
    kind = ev["kind"]
    if kind == "ml":
        markets = {}
        for m in (raw or {}).get("markets") or []:
            side = book.side_of(m.get("question") or "", home, away)
            if side is None or side in markets:
                continue
            got = book.priced(m, td, closed_ev)
            if got is None:
                continue
            markets[side] = got
        if set(markets) != {"H", "D", "A"}:
            return []
        row = _base(ev["slug"], end, closed_ev, home, away, "ml")
        row["markets"] = markets
        return [row]
    if kind == "ht":
        markets = {}
        for m in (raw or {}).get("markets") or []:
            key = classify_ht(m, home, away)
            if key is None or key in markets:
                continue
            got = book.priced(m, td, closed_ev)
            if got is None:
                continue
            markets[key] = got
        if not markets:
            return []
        row = _base(ev["slug"], end, closed_ev, home, away, "ht")
        row["markets"] = markets
        return [row]
    team_markets = {}
    fh_markets = {}
    for m in (raw or {}).get("markets") or []:
        team = classify_team(m, home, away)
        if team is not None and team not in team_markets:
            got = book.priced(m, td, closed_ev)
            if got is not None:
                team_markets[team] = got
            continue
        if classify_fh(m) == "Y" and "Y" not in fh_markets:
            got = book.priced(m, td, closed_ev)
            if got is not None:
                fh_markets["Y"] = got
    out = []
    if team_markets:
        row = _base(ev["slug"] + "--team", end, closed_ev, home, away, "team")
        row["markets"] = team_markets
        row["line"] = 1.5
        out.append(row)
    if fh_markets:
        row = _base(ev["slug"] + "--fh", end, closed_ev, home, away, "fh")
        row["markets"] = fh_markets
        row["line"] = 0.5
        out.append(row)
    return out


def self_check():
    text = (
        "Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,HTHG,HTAG,HTR,HC,AC,B365H\n"
        "15/08/2025,20:00,Liverpool,Bournemouth,4,2,1,0,H,6,7,1.50\n"
    )
    rows = parse_csv(text)
    if len(rows) != 1 or rows[0]["home"] != "Liverpool" or rows[0]["hg"] != 4 or rows[0]["htr"] != "H":
        raise SystemExit("parse %s" % rows)
    if rows[0]["kick"] != LIVERPOOL_KICK or rows[0]["hthg"] != 1 or rows[0]["hc"] != 6:
        raise SystemExit("kick %s" % rows[0])
    if set(rows[0]) != set(SCORE_KEYS) or "B365H" in rows[0]:
        raise SystemExit("odds column kept %s" % rows[0])
    blank = {
        "home": "Liverpool", "away": "Bournemouth", "hg": 2, "ag": 0,
        "hthg": 1, "htag": 0, "htr": "H", "hc": 8, "ac": 3,
    }
    got = annotate(blank)
    if (got["hcl"], got["acl"], got["hsh"], got["ash"], got["hld"], got["ald"]) != (1, 0, 1, 0, 1, 0):
        raise SystemExit("annotate %s" % got)
    home, away = "Arsenal", "Chelsea"
    lead = {
        "sportsMarketType": "soccer_halftime_result",
        "question": "Arsenal FC leading at halftime?",
        "outcomes": ["Yes", "No"],
    }
    if classify_ht(lead, home, away) != "Arsenal":
        raise SystemExit("lead %s" % (classify_ht(lead, home, away),))
    draw = {
        "sportsMarketType": "soccer_halftime_result",
        "question": "Arsenal FC vs. Chelsea FC: Draw at halftime?",
        "outcomes": ["Yes", "No"],
    }
    if classify_ht(draw, home, away) != "D":
        raise SystemExit("draw %s" % (classify_ht(draw, home, away),))
    flipped_yn = dict(lead)
    flipped_yn["outcomes"] = ["No", "Yes"]
    if classify_ht(flipped_yn, home, away) is not None:
        raise SystemExit("a reversed yes token was kept")
    other = dict(lead)
    other["question"] = "Tottenham Hotspur FC leading at halftime?"
    if classify_ht(other, home, away) is not None:
        raise SystemExit("a third club was kept")
    fh = {
        "sportsMarketType": "first_half_totals",
        "question": "Arsenal FC vs. Chelsea FC: 1st Half O/U 0.5",
        "line": 0.5, "outcomes": ["Over", "Under"],
    }
    if classify_fh(fh) != "Y":
        raise SystemExit("fh %s" % (classify_fh(fh),))
    fh_wide = dict(fh)
    fh_wide["line"] = 1.5
    fh_wide["question"] = "Arsenal FC vs. Chelsea FC: 1st Half O/U 1.5"
    if classify_fh(fh_wide) is not None:
        raise SystemExit("a 1.5 first-half total was kept")
    fh_team = {
        "sportsMarketType": "soccer_first_half_team_totals",
        "question": "Arsenal FC vs. Chelsea FC: Arsenal FC 1st Half O/U 0.5",
        "line": 0.5, "outcomes": ["Over", "Under"],
    }
    if classify_fh(fh_team) is not None or classify_team(fh_team, home, away) is not None:
        raise SystemExit("a first-half team total was kept")
    full = {
        "sportsMarketType": "totals",
        "question": "Arsenal FC vs. Chelsea FC: O/U 0.5",
        "line": 0.5, "outcomes": ["Over", "Under"],
    }
    if classify_fh(full) is not None or classify_team(full, home, away) is not None:
        raise SystemExit("a full-time total was kept")
    team = {
        "sportsMarketType": "soccer_team_totals",
        "question": "Arsenal FC vs. Coventry City FC: Arsenal FC O/U 1.5",
        "line": 1.5, "outcomes": ["Over", "Under"],
    }
    if classify_team(team, "Arsenal", "Coventry") != "Arsenal":
        raise SystemExit("team %s" % (classify_team(team, "Arsenal", "Coventry"),))
    team_low = dict(team)
    team_low["line"] = 0.5
    team_low["question"] = "Arsenal FC vs. Coventry City FC: Arsenal FC O/U 0.5"
    if classify_team(team_low, "Arsenal", "Coventry") is not None:
        raise SystemExit("a 0.5 team total was kept")
    under = dict(team)
    under["outcomes"] = ["Under", "Over"]
    if classify_team(under, "Arsenal", "Coventry") is not None:
        raise SystemExit("an under token was kept")
    if slug_kind("epl-ars-che-2026-03-01") != "ml":
        raise SystemExit("moneyline slug")
    if slug_kind("epl-ars-che-2026-03-01-halftime-result") != "ht":
        raise SystemExit("halftime slug")
    if slug_kind("epl-ars-che-2026-03-01-more-markets") != "more":
        raise SystemExit("more slug")
    if slug_kind("epl-ars-che-2026-03-01-total-corners") is not None:
        raise SystemExit("a corner slug was kept")
    print("self-check ok", LIVERPOOL_KICK)


def main():
    outp = sys.argv[1]
    scores = load_scores()
    events = list_events()
    done = 0
    rows = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futs = [pool.submit(one, ev) for ev in events]
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
