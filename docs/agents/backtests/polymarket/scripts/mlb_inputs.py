"""Pull Major League Baseball moneylines, first-inning runs, extra innings,
home-run 0.5 and strikeout 3.5.

Keyless. No orders. The window is the event endDate. The decision is one hour
before first pitch (startTime): endDate is often a week later, so it is not
the first pitch. Spreads, full-game totals, first-five markets, other lines
and inning-winner events are not stored. Prints are not fetched here.

usage: mlb_inputs.py --self-check
       mlb_inputs.py <out.json.gz>
"""
import gzip
import json
import os
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import pmnet
import post_inputs
import post_test

SERIES = 3
GAMMA = "https://gamma-api.polymarket.com"
MLB = "https://statsapi.mlb.com"
UA = "fp5-research/1.0"
PARSER = 1
START = "2025-01-01T00:00:00Z"
END = "2026-09-11T00:00:00Z"
MATCH_WINDOW = 3 * 3600
YES_NRFI = ("Yes", "Yes Run")
NO_NRFI = ("No", "No Run")

_MLB_LAST = 0.0
_MLB_LOCK = threading.Lock()


def _mlb_get(url):
    """Public MLB stats. Paced, retried, and never a Polymarket price."""
    global _MLB_LAST
    delay = 1.0
    for i in range(6):
        with _MLB_LOCK:
            wait = 0.15 - (time.monotonic() - _MLB_LAST)
            if wait > 0:
                time.sleep(wait)
            _MLB_LAST = time.monotonic()
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:
            if i == 5:
                raise RuntimeError("mlb %s: %s" % (url, exc))
            time.sleep(delay)
            delay = min(delay * 2, 30)
    return None


def outs_of(ip):
    """Innings pitched to outs. '5.1' is five and one third, 16 outs."""
    text = str(ip).strip()
    if "." in text:
        whole, frac = text.split(".", 1)
        return int(whole) * 3 + int((frac[:1] or "0"))
    return int(text) * 3


def _list(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return None
    if not isinstance(value, list):
        return None
    return value


def _line(m):
    if m.get("line") is None:
        return None
    try:
        return float(m.get("line"))
    except (TypeError, ValueError):
        return None


def _is_date(year, month, day):
    return len(year) == 4 and year.isdigit() and len(month) == 2 and month.isdigit() and len(day) == 2 and day.isdigit()


def slug_kind(slug):
    """A game or a player-prop event. Inning winners and first-five events are None."""
    if not slug or not slug.startswith("mlb-"):
        return None
    if "-inning-" in slug or "-first-five-" in slug:
        return None
    if slug.endswith("-player-props"):
        return "props"
    parts = slug.split("-")
    if len(parts) == 6 and _is_date(parts[3], parts[4], parts[5]):
        return "game"
    if len(parts) == 7 and parts[6] in ("dh1", "dh2") and _is_date(parts[3], parts[4], parts[5]):
        return "game"
    return None


def clubs_of(title):
    text = title or ""
    for sep in (" vs. ", " vs "):
        if sep in text:
            home, away = text.split(sep, 1)
            home, away = home.strip(), away.strip()
            if home and away and " - " not in away:
                return home, away
    return None, None


def player_name(question):
    if ":" not in (question or ""):
        return None
    name = question.split(":", 1)[0].strip()
    return name or None


def classify_ml(m, home, away):
    """Both clubs on one moneyline. A spread is None."""
    if m.get("sportsMarketType") != "moneyline" or not home or not away:
        return None
    outs = _list(m.get("outcomes"))
    if outs is None or len(outs) != 2:
        return None
    if set(outs) != {home, away}:
        return None
    return [(outs[0], 0), (outs[1], 1)]


def classify_nrfi(m):
    """Yes then No, including the 'Yes Run' labels. A reversed pair is None."""
    if m.get("sportsMarketType") != "nrfi":
        return None
    outs = _list(m.get("outcomes"))
    if outs is None or len(outs) != 2:
        return None
    if outs[0] not in YES_NRFI or outs[1] not in NO_NRFI:
        return None
    return [("Y", 0), ("N", 1)]


def classify_xin(m):
    if m.get("sportsMarketType") != "baseball_game_extra_innings":
        return None
    if _list(m.get("outcomes")) != ["Yes", "No"]:
        return None
    return [("Y", 0), ("N", 1)]


def classify_hr(m):
    """Home runs over 0.5 only. A 1.5 line is None."""
    if m.get("sportsMarketType") != "baseball_player_home_runs":
        return None
    if _list(m.get("outcomes")) != ["Over", "Under"]:
        return None
    line = _line(m)
    if line is None or abs(line - 0.5) > 1e-9:
        return None
    if player_name(m.get("question") or "") is None:
        return None
    return 0.5


def classify_k(m):
    """Strikeouts over 3.5 only. A 4.5 line is None."""
    if m.get("sportsMarketType") != "baseball_player_strikeouts":
        return None
    if _list(m.get("outcomes")) != ["Over", "Under"]:
        return None
    line = _line(m)
    if line is None or abs(line - 3.5) > 1e-9:
        return None
    if player_name(m.get("question") or "") is None:
        return None
    return 3.5


def settlement_of(prices, index):
    try:
        pay = float(prices[index])
    except (TypeError, ValueError, IndexError):
        return None
    if pay >= 0.99:
        return 1.0
    if pay <= 0.01:
        return 0.0
    return None


def price_outcome(m, index, td, closed_ev):
    """One outcome. None when the fee, the settlement or the shown price is unusable."""
    prices = _list(m.get("outcomePrices"))
    toks = _list(m.get("clobTokenIds"))
    if prices is None or len(prices) != 2 or toks is None or len(toks) <= index:
        return None
    rate = post_inputs.rate_of(m)
    if rate is None or not m.get("conditionId"):
        return None
    payout = settlement_of(prices, index)
    if payout is None:
        return None
    try:
        tick = float(m.get("orderPriceMinTickSize") or 0.001)
    except (TypeError, ValueError):
        tick = 0.001
    shown = post_inputs.shown_yes(str(toks[index]), td)
    if shown is None:
        return None
    return {
        "condition": m.get("conditionId"),
        "shown": shown,
        "tick": tick,
        "rate": rate,
        "payout_yes": payout,
        "closed": post_inputs.ts_of(m.get("closedTime")) or closed_ev,
        "outcome": int(index),
    }


def pid_of(name, table):
    ids = table.get(name) or []
    if len(ids) != 1:
        return None
    return ids[0]


def index_games(games):
    out = {}
    for game in games:
        out.setdefault(frozenset((game["home"], game["away"])), []).append(game)
    return out


def match_game(home, away, kick, indexed):
    """The clubs' game closest to first pitch, inside three hours. A tie is None."""
    if home is None or kick is None:
        return None
    best = []
    for game in indexed.get(frozenset((home, away))) or []:
        dist = abs(float(game["ts"]) - float(kick))
        if dist <= MATCH_WINDOW:
            best.append((dist, game["pk"], game))
    if not best:
        return None
    best.sort()
    if len(best) >= 2 and best[0][0] == best[1][0]:
        return None
    return best[0][2]


def _row(slug, end, kick, closed_ev, kind, markets, home, away, hp, ap, pid, line):
    row = {
        "slug": slug, "series": SERIES, "kind": kind, "end": end, "kick": kick,
        "closed": closed_ev, "home": home, "away": away, "markets": markets,
    }
    if hp is not None:
        row["hp"] = hp
    if ap is not None:
        row["ap"] = ap
    if pid is not None:
        row["pid"] = pid
    if line is not None:
        row["line"] = line
    return row


def _fill(slot, m, sides, td, closed_ev):
    for key, index in sides:
        if key in slot:
            continue
        got = price_outcome(m, index, td, closed_ev)
        if got is not None:
            slot[key] = got


def build_rows(ev, raw, indexed, people):
    end = float(ev["end"])
    kick = ev.get("kick")
    if kick is None:
        kick = post_inputs.ts_of((raw or {}).get("startTime"))
    if kick is None or post_test.window_of(end) is None:
        return []
    kick = float(kick)
    td = kick - post_test.OPEN_LAG
    closed_ev = post_inputs.ts_of((raw or {}).get("closedTime")) or end
    kind = ev["kind"]
    if kind == "props":
        return _props(ev, raw, people, end, kick, td, closed_ev)
    home, away = clubs_of((raw or {}).get("title"))
    game = match_game(home, away, kick, indexed)
    if game is None:
        return []
    ml, nrfi, xin = {}, {}, {}
    for m in (raw or {}).get("markets") or []:
        sides = classify_ml(m, game["home"], game["away"])
        if sides:
            _fill(ml, m, sides, td, closed_ev)
            continue
        sides = classify_nrfi(m)
        if sides:
            _fill(nrfi, m, sides, td, closed_ev)
            continue
        sides = classify_xin(m)
        if sides:
            _fill(xin, m, sides, td, closed_ev)
    base = ev["slug"]
    home, away = game["home"], game["away"]
    hp, ap = game.get("hp"), game.get("ap")
    out = []
    if ml:
        out.append(_row(base + "--ml", end, kick, closed_ev, "ml", ml, home, away, hp, ap, None, None))
    if nrfi:
        out.append(_row(base + "--nrfi", end, kick, closed_ev, "nrfi", nrfi, home, away, hp, ap, None, None))
    if xin:
        out.append(_row(base + "--xin", end, kick, closed_ev, "xin", xin, home, away, hp, ap, None, None))
    return out


def _props(ev, raw, people, end, kick, td, closed_ev):
    out = []
    seen = set()
    for m in (raw or {}).get("markets") or []:
        if classify_hr(m) is not None:
            kind, line = "hr", 0.5
        elif classify_k(m) is not None:
            kind, line = "k", 3.5
        else:
            continue
        pid = pid_of(player_name(m.get("question") or ""), people)
        if pid is None:
            continue
        key = (kind, pid)
        if key in seen:
            continue
        markets = {}
        _fill(markets, m, (("Y", 0), ("N", 1)), td, closed_ev)
        if not markets:
            continue
        seen.add(key)
        out.append(_row(
            "%s--%s-%s" % (ev["slug"], kind, pid), end, kick, closed_ev, kind, markets,
            None, None, None, None, pid, line,
        ))
    return out


def cache_dir():
    d = os.path.join(pmnet.DATA, "mlb", "struct")
    os.makedirs(d, exist_ok=True)
    return d


def one(ev, indexed, people):
    path = os.path.join(cache_dir(), ev["slug"] + ".json")
    if os.path.exists(path):
        cached = pmnet.load(path)
        if cached.get("parser") == PARSER:
            return cached.get("rows") or []
    data = pmnet.get(GAMMA + "/events", {"slug": ev["slug"]})
    raw = data[0] if isinstance(data, list) and data else None
    rows = build_rows(ev, raw, indexed, people)
    pmnet.dump(path, {"parser": PARSER, "rows": rows})
    return rows


def list_events():
    path = os.path.join(pmnet.DATA, "mlb", "listed.json")
    if os.path.exists(path):
        cached = pmnet.load(path)
        if cached.get("parser") == PARSER:
            return cached.get("events") or []
    rows = []
    seen = set()
    cursor = None
    while True:
        params = {
            "limit": 100, "closed": "true", "series_id": SERIES,
            "end_date_min": START, "end_date_max": END,
        }
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
            rows.append({
                "slug": slug, "end": end, "kick": post_inputs.ts_of(ev.get("startTime")), "kind": kind,
            })
        cursor = data.get("next_cursor")
        if not cursor or not batch:
            break
    rows.sort(key=lambda r: (r["end"], r["slug"]))
    pmnet.dump(path, {"parser": PARSER, "events": rows})
    print("events_listed", len(rows), flush=True)
    return rows


def parse_final(game):
    """One final. None when it is not over or a club name is missing."""
    status = (game.get("status") or {}).get("abstractGameState")
    if status != "Final":
        return None
    teams = game.get("teams") or {}
    home, away = teams.get("home") or {}, teams.get("away") or {}
    try:
        hname = home["team"]["name"]
        aname = away["team"]["name"]
        hr = int(home["score"])
        ar = int(away["score"])
    except (KeyError, TypeError, ValueError):
        return None
    innings = (game.get("linescore") or {}).get("innings") or []
    hfi = afi = None
    if innings:
        try:
            hfi = int(innings[0]["home"]["runs"])
            afi = int(innings[0]["away"]["runs"])
        except (KeyError, TypeError, ValueError):
            hfi = afi = None
    ts = post_inputs.ts_of(game.get("gameDate"))
    if ts is None or not hname or not aname:
        return None
    hp = (home.get("probablePitcher") or {}).get("id")
    ap = (away.get("probablePitcher") or {}).get("id")
    return {
        "pk": int(game["gamePk"]), "ts": ts, "home": hname, "away": aname,
        "hr": hr, "ar": ar, "hp": None if hp is None else int(hp), "ap": None if ap is None else int(ap),
        "hfi": hfi, "afi": afi, "extra": 1 if len(innings) > 9 else 0,
    }


def _month_url(year, month):
    start = "%04d-%02d-01" % (year, month)
    if month == 12:
        end = "%04d-01-01" % (year + 1)
    else:
        end = "%04d-%02d-01" % (year, month + 1)
    return (
        MLB + "/api/v1/schedule?sportId=1&gameType=R&hydrate=probablePitcher,linescore"
        "&startDate=%s&endDate=%s" % (start, end)
    )


def _download_games():
    games = []
    seen = set()
    months = [(2024, m) for m in range(3, 12)] + [(2025, m) for m in range(3, 12)] + [(2026, m) for m in range(3, 10)]
    for year, month in months:
        path = os.path.join(pmnet.DATA, "mlb", "sched", "%04d-%02d.json" % (year, month))
        if os.path.exists(path):
            body = pmnet.load(path)
        else:
            body = _mlb_get(_month_url(year, month))
            pmnet.dump(path, body)
        for day in body.get("dates") or []:
            for game in day.get("games") or []:
                parsed = parse_final(game)
                if parsed is None or parsed["pk"] in seen:
                    continue
                seen.add(parsed["pk"])
                games.append(parsed)
    games.sort(key=lambda g: (g["ts"], g["pk"]))
    return games


def _download_starts(games):
    by_pk = {g["pk"]: g for g in games}
    pids = sorted({pid for g in games for pid in (g.get("hp"), g.get("ap")) if pid})
    starts = []
    seen = set()
    for pid in pids:
        for season in (2024, 2025, 2026):
            path = os.path.join(pmnet.DATA, "mlb", "logs", "%s-%s.json" % (pid, season))
            if os.path.exists(path):
                body = pmnet.load(path)
            else:
                body = _mlb_get(MLB + "/api/v1/people/%s/stats?stats=gameLog&group=pitching&season=%s" % (pid, season))
                pmnet.dump(path, body)
            for block in (body or {}).get("stats") or []:
                for split in block.get("splits") or []:
                    stat = split.get("stat") or {}
                    try:
                        if int(stat.get("gamesStarted") or 0) != 1:
                            continue
                        pk = int((split.get("game") or {})["gamePk"])
                        outs = int(stat["outs"]) if stat.get("outs") is not None else outs_of(stat.get("inningsPitched"))
                    except (KeyError, TypeError, ValueError):
                        continue
                    if (pid, pk) in seen:
                        continue
                    seen.add((pid, pk))
                    game = by_pk.get(pk)
                    ts = None if game is None else game["ts"]
                    if ts is None:
                        ts = post_inputs.ts_of((split.get("date") or "") + "T17:00:00Z")
                    if ts is None:
                        continue
                    fi = None
                    if game is not None and pid == game.get("hp") and game.get("afi") is not None:
                        fi = 1 if int(game["afi"]) > 0 else 0
                    elif game is not None and pid == game.get("ap") and game.get("hfi") is not None:
                        fi = 1 if int(game["hfi"]) > 0 else 0
                    team = (split.get("team") or {}).get("name")
                    opp = (split.get("opponent") or {}).get("name")
                    starts.append({
                        "pid": pid, "ts": ts, "team": team, "opp": opp, "outs": outs,
                        "er": int(stat.get("earnedRuns") or 0), "k": int(stat.get("strikeOuts") or 0),
                        "bb": int(stat.get("baseOnBalls") or 0), "pitches": int(stat.get("numberOfPitches") or 0),
                        "pk": pk, "fi_allowed": fi,
                    })
    starts.sort(key=lambda s: (s["ts"], s["pid"], s["pk"]))
    return starts


def _normalize_cached(games_raw, starts_raw):
    games = []
    for raw in games_raw:
        ts = post_inputs.ts_of(raw.get("start")) if raw.get("ts") is None else float(raw["ts"])
        if ts is None:
            continue
        games.append({
            "pk": int(raw["pk"]), "ts": ts, "home": raw["home"], "away": raw["away"],
            "hr": int(raw["hr"]), "ar": int(raw["ar"]),
            "hp": None if raw.get("hp") is None else int(raw["hp"]),
            "ap": None if raw.get("ap") is None else int(raw["ap"]),
            "hfi": raw.get("hfi"), "afi": raw.get("afi"), "extra": int(raw.get("extra") or 0),
        })
    games.sort(key=lambda g: (g["ts"], g["pk"]))
    by_pk = {g["pk"]: g for g in games}
    starts = []
    for raw in starts_raw:
        game = by_pk.get(raw.get("pk"))
        ts = None if game is None else game["ts"]
        if ts is None:
            ts = post_inputs.ts_of(str(raw.get("date") or "") + "T17:00:00Z")
        if ts is None:
            continue
        pid = int(raw["pid"])
        fi = None
        if game is not None and pid == game.get("hp") and game.get("afi") is not None:
            fi = 1 if int(game["afi"]) > 0 else 0
        elif game is not None and pid == game.get("ap") and game.get("hfi") is not None:
            fi = 1 if int(game["hfi"]) > 0 else 0
        starts.append({
            "pid": pid, "ts": ts, "team": raw.get("team"), "opp": raw.get("opp"),
            "outs": int(raw["outs"]), "er": int(raw["er"]), "k": int(raw["k"]),
            "bb": int(raw["bb"]), "pitches": int(raw["pitches"]),
            "pk": None if raw.get("pk") is None else int(raw["pk"]), "fi_allowed": fi,
        })
    starts.sort(key=lambda s: (s["ts"], s["pid"], s["pk"] or 0))
    return games, starts


def load_book():
    """Games and starts already on disk, or a fresh stats download. No Polymarket price."""
    games_path = os.path.join(pmnet.DATA, "mlb", "games.json")
    starts_path = os.path.join(pmnet.DATA, "mlb", "starts.json")
    if os.path.exists(games_path) and os.path.exists(starts_path):
        games, starts = _normalize_cached(pmnet.load(games_path), pmnet.load(starts_path))
        print("book", "games", len(games), "starts", len(starts), flush=True)
        return games, starts
    games = _download_games()
    starts = _download_starts(games)
    print("book", "games", len(games), "starts", len(starts), flush=True)
    return games, starts


def load_people():
    table = {}
    for season in (2025, 2026):
        path = os.path.join(pmnet.DATA, "mlb", "people-%s.json" % season)
        if os.path.exists(path):
            body = pmnet.load(path)
        else:
            body = _mlb_get(MLB + "/api/v1/sports/1/players?season=%s" % season)
            pmnet.dump(path, body)
        for person in body.get("people") or []:
            name = person.get("fullName")
            pid = person.get("id")
            if not name or pid is None:
                continue
            table.setdefault(name, set()).add(int(pid))
    return {name: sorted(ids) for name, ids in table.items()}


def parse_hitting(body, pid):
    out = []
    for block in (body or {}).get("stats") or []:
        for split in block.get("splits") or []:
            stat = split.get("stat") or {}
            try:
                hr = int(stat.get("homeRuns") or 0)
                pk = int((split.get("game") or {})["gamePk"])
            except (KeyError, TypeError, ValueError):
                continue
            out.append({"pid": int(pid), "pk": pk, "hr": 1 if hr >= 1 else 0})
    return out


def load_hitters(pids, games):
    by_pk = {g["pk"]: g["ts"] for g in games}
    rows = []
    seen = set()
    folder = os.path.join(pmnet.DATA, "mlb", "hitting")
    os.makedirs(folder, exist_ok=True)
    for pid in pids:
        for season in (2025, 2026):
            path = os.path.join(folder, "%s-%s.json" % (pid, season))
            if os.path.exists(path):
                body = pmnet.load(path)
            else:
                body = _mlb_get(MLB + "/api/v1/people/%s/stats?stats=gameLog&group=hitting&season=%s" % (pid, season))
                pmnet.dump(path, body)
            for row in parse_hitting(body, pid):
                ts = by_pk.get(row["pk"])
                if ts is None or (row["pid"], row["pk"]) in seen:
                    continue
                seen.add((row["pid"], row["pk"]))
                rows.append({"pid": row["pid"], "pk": row["pk"], "ts": ts, "hr": row["hr"]})
    rows.sort(key=lambda r: (r["ts"], r["pid"], r["pk"]))
    print("hitters", len(rows), "pids", len(pids), flush=True)
    return rows


def self_check():
    if outs_of("5.1") != 16 or outs_of("6.0") != 18 or outs_of("5") != 15:
        raise SystemExit("innings %s %s %s" % (outs_of("5.1"), outs_of("6.0"), outs_of("5")))
    final = {
        "gamePk": 1, "gameDate": "2025-04-02T16:40:00Z",
        "status": {"abstractGameState": "Final"},
        "teams": {
            "home": {"team": {"name": "Cincinnati Reds"}, "score": 1, "probablePitcher": {"id": 11}},
            "away": {"team": {"name": "Texas Rangers"}, "score": 0, "probablePitcher": {"id": 22}},
        },
        "linescore": {"innings": [{"home": {"runs": 0}, "away": {"runs": 2}}] + [{}] * 8},
    }
    parsed = parse_final(final)
    if parsed["home"] != "Cincinnati Reds" or parsed["hfi"] != 0 or parsed["afi"] != 2 or parsed["extra"] != 0:
        raise SystemExit("parse %s" % parsed)
    if parsed["hp"] != 11 or "B365H" in parsed:
        raise SystemExit("odds column kept %s" % parsed)
    live = dict(final)
    live["status"] = {"abstractGameState": "Live"}
    if parse_final(live) is not None:
        raise SystemExit("a live game was kept")
    extra = dict(final)
    extra["linescore"] = {"innings": [{"home": {"runs": 1}, "away": {"runs": 0}}] * 10}
    if parse_final(extra)["extra"] != 1 or parse_final(extra)["hfi"] != 1:
        raise SystemExit("extra %s" % parse_final(extra))
    home, away = "Seattle Mariners", "Texas Rangers"
    ml = {"sportsMarketType": "moneyline", "outcomes": [home, away], "question": home + " vs. " + away}
    if classify_ml(ml, home, away) != [(home, 0), (away, 1)]:
        raise SystemExit("moneyline %s" % (classify_ml(ml, home, away),))
    spread = {"sportsMarketType": "spreads", "line": -1.5, "outcomes": [home, away], "question": "Spread: " + home + " (-1.5)"}
    if classify_ml(spread, home, away) is not None or classify_nrfi(spread) is not None or classify_xin(spread) is not None:
        raise SystemExit("a spread was kept")
    total = {"sportsMarketType": "totals", "line": 8.5, "outcomes": ["Over", "Under"], "question": "O/U 8.5"}
    if classify_hr(total) is not None or classify_k(total) is not None or classify_nrfi(total) is not None:
        raise SystemExit("a full-game total was kept")
    f5 = {"sportsMarketType": "baseball_team_first_five_total", "line": 4.5, "outcomes": ["Over", "Under"]}
    if classify_hr(f5) is not None or classify_xin(f5) is not None:
        raise SystemExit("a first-five total was kept")
    nrfi = {"sportsMarketType": "nrfi", "outcomes": ["Yes Run", "No Run"]}
    if classify_nrfi(nrfi) != [("Y", 0), ("N", 1)]:
        raise SystemExit("nrfi %s" % (classify_nrfi(nrfi),))
    plain = {"sportsMarketType": "nrfi", "outcomes": ["Yes", "No"]}
    if classify_nrfi(plain) != [("Y", 0), ("N", 1)]:
        raise SystemExit("plain nrfi")
    flipped = {"sportsMarketType": "nrfi", "outcomes": ["No", "Yes"]}
    if classify_nrfi(flipped) is not None:
        raise SystemExit("a reversed first-inning token was kept")
    xin = {"sportsMarketType": "baseball_game_extra_innings", "outcomes": ["Yes", "No"]}
    if classify_xin(xin) != [("Y", 0), ("N", 1)]:
        raise SystemExit("xin")
    hr = {
        "sportsMarketType": "baseball_player_home_runs", "line": 0.5,
        "outcomes": ["Over", "Under"], "question": "Carter Jensen: Home Runs O/U 0.5",
    }
    if classify_hr(hr) != 0.5:
        raise SystemExit("hr %s" % (classify_hr(hr),))
    hr_wide = dict(hr)
    hr_wide["line"] = 1.5
    hr_wide["question"] = "Carter Jensen: Home Runs O/U 1.5"
    if classify_hr(hr_wide) is not None:
        raise SystemExit("a 1.5 home-run line was kept")
    hr_flip = dict(hr)
    hr_flip["outcomes"] = ["Under", "Over"]
    if classify_hr(hr_flip) is not None:
        raise SystemExit("a reversed over token was kept")
    k = {
        "sportsMarketType": "baseball_player_strikeouts", "line": 3.5,
        "outcomes": ["Over", "Under"], "question": "Michael Wacha: Strikeouts O/U 3.5",
    }
    if classify_k(k) != 3.5:
        raise SystemExit("k %s" % (classify_k(k),))
    k_wide = dict(k)
    k_wide["line"] = 4.5
    k_wide["question"] = "Michael Wacha: Strikeouts O/U 4.5"
    if classify_k(k_wide) is not None:
        raise SystemExit("a 4.5 strikeout line was kept")
    if slug_kind("mlb-cin-tex-2025-04-02") != "game":
        raise SystemExit("game slug")
    if slug_kind("mlb-chc-sd-2025-04-14-dh2") != "game":
        raise SystemExit("doubleheader slug")
    if slug_kind("mlb-kc-col-2026-07-31-player-props") != "props":
        raise SystemExit("props slug")
    if slug_kind("mlb-mia-oak-2026-07-03-first-five-winner") is not None:
        raise SystemExit("a first-five slug was kept")
    if slug_kind("mlb-aaa-bbb-2026-07-03-inning-1-winner") is not None:
        raise SystemExit("an inning slug was kept")
    games = [
        {"pk": 1, "ts": 1000.0, "home": "A", "away": "B"},
        {"pk": 2, "ts": 1000.0, "home": "A", "away": "B"},
        {"pk": 3, "ts": 5000.0, "home": "A", "away": "B"},
    ]
    indexed = index_games(games)
    if match_game("A", "B", 1000.0, indexed) is not None:
        raise SystemExit("an ambiguous game was kept")
    if match_game("A", "B", 5000.0, indexed)["pk"] != 3:
        raise SystemExit("closest game")
    if match_game("A", "B", 5000.0 + MATCH_WINDOW + 1, indexed) is not None:
        raise SystemExit("a far game was kept")
    people = {"Carter Jensen": [7], "Same Name": [1, 2]}
    if pid_of("Carter Jensen", people) != 7 or pid_of("Same Name", people) is not None:
        raise SystemExit("pid %s" % people)
    if settlement_of(["1", "0"], 0) != 1.0 or settlement_of(["0.00", "1"], 0) != 0.0:
        raise SystemExit("settlement")
    if settlement_of(["0.50", "0.50"], 0) is not None:
        raise SystemExit("an unsettled price was kept")
    print("self-check ok", outs_of("5.1"))


def main():
    outp = sys.argv[1]
    post_inputs._share_pace()
    games, starts = load_book()
    people = load_people()
    indexed = index_games(games)
    events = list_events()
    done = 0
    rows = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futs = [pool.submit(one, ev, indexed, people) for ev in events]
        for fut in as_completed(futs):
            rows.extend(fut.result())
            done += 1
            if done % 50 == 0:
                print("structures", done, flush=True)
    rows.sort(key=lambda r: (r["end"], r["slug"]))
    pids = sorted({row["pid"] for row in rows if row.get("kind") == "hr" and row.get("pid") is not None})
    hitters = load_hitters(pids, games)
    book = {"games": games, "starts": starts, "hitters": hitters}
    os.makedirs(os.path.dirname(os.path.abspath(outp)) or ".", exist_ok=True)
    with gzip.open(outp, "wt") as f:
        json.dump({"events": rows, "scores": book}, f, sort_keys=True, separators=(",", ":"))
    kinds = {}
    for row in rows:
        kinds[row["kind"]] = kinds.get(row["kind"], 0) + 1
    print(
        "wrote", outp, "events", len(rows), "kinds", kinds,
        "games", len(games), "starts", len(starts), "hitters", len(hitters),
        flush=True,
    )


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--self-check":
        self_check()
    else:
        main()
