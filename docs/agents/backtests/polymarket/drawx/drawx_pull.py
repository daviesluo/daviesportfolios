"""DRAW-X pull: four leagues' full-time matches, read the way DRAWBASE read the Premier League's.

The pre-registration is docs/agents/reviews/2026-09-26-draw-x-prereg.md (frozen by commit 714a71c0).
Keyless GETs only. Nothing is placed, and no key is read.

What it reads, in order:
1. Gamma's closed events of series 10193 (La Liga), 10194 (Bundesliga), 10195 (Ligue 1) and 10203
   (Serie A), listed by keyset pages; then each six-part event with its league's prefix read again by its
   slug (/events?slug=), as DRAWBASE's epl_inputs.one read it.
2. football-data.co.uk's SP1, D1, F1 and I1 files for 2024-25, 2025-26 and 2026-27.
3. The kickoff rule (the two fixes): kickoff is the event's startTime; a match is kept only if its league's
   score file has a row for the same two clubs, either order, whose Date and Time read as Europe/London
   equal startTime to the minute, and the draw market's gameStartTime equals startTime to the minute.
4. For every kept match: the draw's screen price an hour before kickoff (DRAWBASE's shown_yes). The home
   and away markets' screen prices are not read: the draw rule never reads them.
5. For every match DRAWBASE's rule picks: the draw market's taker prints in the hour before kickoff
   (DRAWBASE's prints_of, on /trades). /v2/trades is read instead only for a match where /trades stops
   answering, and every such match is reported.

It writes the scorer's input (gzip, only what the scorer reads) and a report: what was listed, what was
dropped and why, and every difference from the 1,554 matches kept at the freeze (frozen_kept.txt) and the
1,574 events listed then (frozen_listed.txt). Raw reads are cached in <cache_dir>, which is not committed.

usage: drawx_pull.py --self-check
       drawx_pull.py <cache_dir> <out_inputs.json.gz> <out_report.json>
"""
import gzip
import hashlib
import http.client
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drawbase as db  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"
DATA = "https://data-api.polymarket.com"
UA = "drawx-research/1.0 (public data only)"

# The four series, checked on Gamma's /series/{id} on 2026-09-26, and each one's slug prefix.
LEAGUES = ("laliga", "bundesliga", "ligue1", "seriea")
SERIES = {"laliga": 10193, "bundesliga": 10194, "ligue1": 10195, "seriea": 10203}
PREFIX = {"laliga": "lal", "bundesliga": "bun", "ligue1": "fl1", "seriea": "sea"}
CODE = {"laliga": "SP1", "bundesliga": "D1", "ligue1": "F1", "seriea": "I1"}
SEASONS = ("2425", "2526", "2627")
SCORE_URL = "https://www.football-data.co.uk/mmz4281/%s/%s.csv"

# The window: startTime in [2025-08-01 00:00, 2026-09-21 00:00) UTC.
T_START = datetime(2025, 8, 1, tzinfo=timezone.utc).timestamp()
T_STOP = datetime(2026, 9, 21, tzinfo=timezone.utc).timestamp()

# The freeze: sorted slugs, one per line, and their sha256 as the pre-registration states them.
FROZEN_LISTED = ("frozen_listed.txt", "90bc93a55b5d685c5c152694466eb7ce072ac63aa42312142378d709bdcbf1a4", 1574)
FROZEN_KEPT = ("frozen_kept.txt", "0b270caef14143f7aa64bf9785e2699d49562c3aa88b50ea1ee16a1fd82b0a42", 1554)

# Appendix A of the pre-registration: Polymarket's spellings to football-data's names.
NAMES = {
    "laliga": {
        "Alaves": "Alaves", "Deportivo Alavés": "Alaves",
        "Athletic Club": "Ath Bilbao",
        "Atletico Madrid": "Ath Madrid", "Club Atlético de Madrid": "Ath Madrid",
        "Barcelona": "Barcelona", "FC Barcelona": "Barcelona",
        "Real Betis": "Betis", "Real Betis Balompié": "Betis",
        "Celta Vigo": "Celta", "RC Celta de Vigo": "Celta",
        "Elche CF": "Elche",
        "Espanyol": "Espanol", "RCD Espanyol de Barcelona": "Espanol",
        "Getafe": "Getafe", "Getafe CF": "Getafe",
        "Girona": "Girona", "Girona FC": "Girona",
        "RC Deportivo A Coruña": "La Coruna",
        "Levante UD": "Levante",
        "Málaga CF": "Malaga",
        "Mallorca": "Mallorca", "RCD Mallorca": "Mallorca",
        "CA Osasuna": "Osasuna", "Osasuna": "Osasuna",
        "Real Oviedo": "Oviedo",
        "Real Madrid": "Real Madrid", "Real Madrid CF": "Real Madrid",
        "Real Racing Club": "Santander",
        "Sevilla": "Sevilla", "Sevilla FC": "Sevilla",
        "Real Sociedad": "Sociedad", "Real Sociedad de Fútbol": "Sociedad",
        "Valencia": "Valencia", "Valencia CF": "Valencia",
        "Rayo Vallecano": "Vallecano", "Rayo Vallecano de Madrid": "Vallecano",
        "Villarreal": "Villarreal", "Villarreal CF": "Villarreal",
    },
    "bundesliga": {
        "FC Augsburg": "Augsburg",
        "Bayern München": "Bayern Munich", "FC Bayern München": "Bayern Munich",
        "Borussia Dortmund": "Dortmund", "BV Borussia 09 Dortmund": "Dortmund",
        "Eintracht Frankfurt": "Ein Frankfurt",
        "SV 07 Elversberg": "Elversberg",
        "1. FC Köln": "FC Koln",
        "SC Freiburg": "Freiburg",
        "Hamburger SV": "Hamburg",
        "1. FC Heidenheim": "Heidenheim", "1. FC Heidenheim 1846": "Heidenheim",
        "1899 Hoffenheim": "Hoffenheim", "TSG 1899 Hoffenheim": "Hoffenheim",
        "Bayer Leverkusen": "Leverkusen", "Bayer 04 Leverkusen": "Leverkusen",
        "Borussia Mönchengladbach": "M'gladbach",
        "FSV Mainz 05": "Mainz", "1. FSV Mainz 05": "Mainz",
        "Paderborn": "Paderborn", "SC Paderborn 07": "Paderborn",
        "RB Leipzig": "RB Leipzig",
        "FC Schalke 04": "Schalke 04",
        "FC St. Pauli": "St Pauli", "FC St. Pauli 1910": "St Pauli",
        "VfB Stuttgart": "Stuttgart",
        "Union Berlin": "Union Berlin", "1. FC Union Berlin": "Union Berlin",
        "Werder Bremen": "Werder Bremen", "SV Werder Bremen": "Werder Bremen",
        "Wolfsburg": "Wolfsburg", "VfL Wolfsburg": "Wolfsburg",
    },
    "ligue1": {
        "Angers SCO": "Angers",
        "AJ Auxerre": "Auxerre",
        "Stade Brestois 29": "Brest",
        "Le Havre AC": "Le Havre",
        "Le Mans FC": "Le Mans",
        "Racing Club de Lens": "Lens",
        "Lille OSC": "Lille",
        "FC Lorient": "Lorient",
        "Olympique Lyonnais": "Lyon",
        "Olympique de Marseille": "Marseille",
        "FC Metz": "Metz",
        "AS Monaco FC": "Monaco",
        "FC Nantes": "Nantes",
        "Nice": "Nice", "OGC Nice": "Nice",
        "Paris FC": "Paris FC",
        "Paris Saint-Germain FC": "Paris SG",
        "Stade Rennais FC 1901": "Rennes",
        "Saint-Etienne": "St Etienne",
        "RC Strasbourg Alsace": "Strasbourg",
        "Toulouse FC": "Toulouse",
        "ES Troyes AC": "Troyes",
    },
    "seriea": {
        "Atalanta": "Atalanta", "Atalanta BC": "Atalanta",
        "Bologna": "Bologna", "Bologna FC 1909": "Bologna",
        "Cagliari": "Cagliari", "Cagliari Calcio": "Cagliari",
        "Como": "Como", "Como 1907": "Como",
        "US Cremonese": "Cremonese",
        "Fiorentina": "Fiorentina", "ACF Fiorentina": "Fiorentina",
        "Frosinone Calcio": "Frosinone",
        "Genoa": "Genoa", "Genoa CFC": "Genoa",
        "Inter": "Inter", "FC Internazionale Milano": "Inter",
        "Juventus": "Juventus", "Juventus FC": "Juventus",
        "Lazio": "Lazio", "SS Lazio": "Lazio",
        "Lecce": "Lecce", "US Lecce": "Lecce",
        "AC Milan": "Milan",
        "AC Monza": "Monza",
        "Napoli": "Napoli", "SSC Napoli": "Napoli",
        "Parma": "Parma", "Parma Calcio 1913": "Parma",
        "Pisa SC": "Pisa",
        "AS Roma": "Roma",
        "US Sassuolo Calcio": "Sassuolo",
        "Torino": "Torino", "Torino FC": "Torino",
        "Udinese": "Udinese", "Udinese Calcio": "Udinese",
        "Venezia FC": "Venezia",
        "Verona": "Verona", "Hellas Verona FC": "Verona",
    },
}

# ------------------------------------------------------------------ network (public GETs only)

GAP = {"gamma-api.polymarket.com": 0.08, "clob.polymarket.com": 0.04, "data-api.polymarket.com": 0.04,
       "www.football-data.co.uk": 0.5}
_last = {}
_lock = threading.Lock()


def _pace(host):
    with _lock:
        wait = GAP.get(host, 0.25) - (time.monotonic() - _last.get(host, 0.0))
        if wait > 0:
            time.sleep(wait)
        _last[host] = time.monotonic()


def get(url, params=None, tries=6, timeout=60, raw=False):
    """pmnet.get's behaviour: paced per host, retried on 429/5xx and network errors, GET only."""
    if params:
        url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params, doseq=True)
    host = urllib.parse.urlparse(url).netloc
    delay = 1.0
    for i in range(tries):
        _pace(host)
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                return body if raw else json.loads(body)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and i < tries - 1:
                ra = e.headers.get("Retry-After")
                try:
                    wait = float(ra) if ra else delay
                except ValueError:
                    wait = delay
                time.sleep(min(wait, 60))
                delay = min(delay * 2, 30)
                continue
            raise RuntimeError("HTTP %s %s: %r" % (e.code, url, e.read()[:300]))
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, http.client.HTTPException, ValueError) as e:
            if i < tries - 1:
                time.sleep(delay)
                delay = min(delay * 2, 30)
                continue
            raise RuntimeError("network error %s: %s" % (url, e))
    raise RuntimeError("retries exhausted %s" % url)


def cached(cache, name, fetch):
    path = os.path.join(cache, name)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    got = fetch()
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(got, f, sort_keys=True, separators=(",", ":"))
    os.replace(tmp, path)
    return got


# ------------------------------------------------------------ DRAWBASE's reads, copied

def shown_yes(token, t):  # post_inputs.py, lines 98-110 (pmnet.get -> get)
    d = get(CLOB + "/prices-history", {
        "market": token, "startTs": str(int(t - 1800)), "endTs": str(int(t)), "fidelity": "1",
    })
    hist = d.get("history") if isinstance(d, dict) else None
    best = None
    for pt in hist or []:
        ts = float(pt.get("t"))
        if ts <= t and (best is None or ts >= best[0]):
            best = (ts, float(pt.get("p")))
    if best is None or t - best[0] > 1800:
        return None
    return best[1]


def prints_of(cond, t0, t1):  # post_inputs.py, lines 113-140 (pmnet.get -> get)
    out = []
    for page in range(6):
        d = get(DATA + "/trades", {
            "market": cond, "limit": "500", "offset": str(page * 500), "takerOnly": "true",
            "start": str(int(t0) + 1), "end": str(int(t1)),
        })
        rows = d if isinstance(d, list) else (d.get("data") or [])
        for r in rows:
            ts = float(r.get("timestamp") or 0)
            if ts > 10_000_000_000:
                ts /= 1000.0
            if not (t0 < ts <= t1):
                continue
            side = r.get("side")
            if side not in ("BUY", "SELL"):
                continue
            oi = r.get("outcomeIndex")
            if oi is None:
                continue
            try:
                out.append([ts, side, int(oi), float(r.get("price")), float(r.get("size"))])
            except (TypeError, ValueError):
                continue
        if len(rows) < 500:
            out.sort()
            return out
    return "incomplete"


def prints_v2(cond, t0, t1, max_pages=100):
    """The same hour's taker rows from /v2/trades, newest first; used only where /trades stops answering."""
    out, cursor = [], None
    for _ in range(max_pages):
        params = {"condition": cond, "limit": 1000, "taker_only": "true"}
        if cursor:
            params["cursor"] = cursor
        d = get(DATA + "/v2/trades", params)
        data = d.get("data") or []
        for r in data:
            ts = float(r.get("timestamp") or 0)
            if ts > 10_000_000_000:
                ts /= 1000.0
            if not (t0 < ts <= t1):
                continue
            side = r.get("side")
            oi = r.get("outcome_index")
            if side not in ("BUY", "SELL") or oi is None:
                continue
            try:
                out.append([ts, side, int(oi), float(r.get("price")), float(r.get("size"))])
            except (TypeError, ValueError):
                continue
        cursor = (d.get("pagination") or {}).get("next_cursor")
        if not cursor or not data or float(data[-1].get("timestamp") or 0) <= t0:
            out.sort()
            return out
    return "incomplete"


# ------------------------------------------------------------------------ the matches

def canonical(league, name):  # epl_score.canonical with the league's own map (appendix A)
    if name is None:
        return None
    return NAMES[league].get(str(name).strip())


def side_of(league, question, home, away):  # epl_inputs.py, lines 116-126, with the league's map
    text = question or ""
    if " end in a draw?" in text:
        return "D"
    if text.startswith("Will ") and " win on " in text:
        name = canonical(league, text[len("Will "):text.rfind(" win on ")])
        if name == home:
            return "H"
        if name == away:
            return "A"
    return None


def minute(t):
    return int(float(t) // 60)


def build(league, slug, raw):
    """epl_inputs.one, less the home and away screen prices; kickoff is startTime. Returns (event, None) or
    (None, reason)."""
    title = (raw or {}).get("title") or ""
    if " vs. " not in title:
        return None, "title"
    home_raw, away_raw = title.split(" vs. ", 1)
    home, away = canonical(league, home_raw), canonical(league, away_raw)
    if home is None or away is None:
        return None, "name"
    start = db.ts_of((raw or {}).get("startTime"))
    if start is None or not (T_START <= start < T_STOP):
        return None, "outside_window"
    closed_ev = db.ts_of((raw or {}).get("closedTime")) or start
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
        side = side_of(league, m.get("question") or "", home, away)
        if side is None or side in markets:
            continue
        rate = db.rate_of(m)
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
            return None, "unresolved"
        try:
            tick = float(m.get("orderPriceMinTickSize") or 0.001)
        except (TypeError, ValueError):
            tick = 0.001
        markets[side] = {
            "condition": m.get("conditionId"), "token": toks[0], "tick": tick, "rate": rate,
            "payout_yes": payout, "closed": db.ts_of(m.get("closedTime")) or closed_ev,
            "game_start": db.ts_of(m.get("gameStartTime")),
        }
    if set(markets) != {"H", "D", "A"}:
        return None, "sides"
    return {"slug": slug, "league": league, "series": SERIES[league], "end": start, "closed": closed_ev,
            "home": home, "away": away, "markets": markets}, None


def kickoff_rule(ev, scores):
    """The two fixes. Returns None when the match is kept, else the reason it is dropped."""
    pair = frozenset((ev["home"], ev["away"]))
    rows = [r for r in scores if frozenset((r["home"], r["away"])) == pair]
    if not rows:
        return "no_score_row"
    if not any(minute(r["kick"]) == minute(ev["end"]) for r in rows):
        return "kickoff_differs"
    gs = ev["markets"]["D"].get("game_start")
    if gs is None or minute(gs) != minute(ev["end"]):
        return "game_start_moved"
    return None


def load_scores(cache, league):
    """epl_inputs.load_scores for one league's three files: parsed by DRAWBASE's parse_csv, duplicates dropped."""
    seen, rows, files = set(), [], []
    for season in SEASONS:
        url = SCORE_URL % (season, CODE[league])
        path = os.path.join(cache, "scores_%s_%s.csv" % (CODE[league], season))
        if not os.path.exists(path):
            body = get(url, raw=True)
            with open(path, "wb") as f:
                f.write(body)
        with open(path, "rb") as f:
            body = f.read()
        text = body.decode("utf-8-sig")
        parsed = db.parse_csv(text)
        files.append({"url": url, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(), "rows": len(parsed)})
        for row in parsed:
            key = (row["kick"], row["home"], row["away"])
            if key in seen:
                continue
            seen.add(key)
            rows.append(row)
    rows.sort(key=lambda s: (s["kick"], s["home"], s["away"]))
    return rows, files


def list_series(league):
    """Closed six-part events of one series with its prefix (epl_inputs.list_events' filter, less the window)."""
    slugs, cursor, seen = [], None, set()
    while True:
        params = {"limit": 100, "closed": "true", "series_id": SERIES[league]}
        if cursor:
            params["after_cursor"] = cursor
        data = get(GAMMA + "/events/keyset", params)
        batch = data.get("events") or []
        for ev in batch:
            slug = ev.get("slug") or ""
            parts = slug.split("-")
            if slug in seen or len(parts) != 6 or parts[0] != PREFIX[league]:
                continue
            seen.add(slug)
            slugs.append(slug)
        cursor = data.get("next_cursor")
        if not cursor or not batch:
            break
    return sorted(slugs)


def frozen(name, digest, count):
    path = os.path.join(HERE, name)
    with open(path, "rb") as f:
        body = f.read()
    if hashlib.sha256(body).hexdigest() != digest:
        raise SystemExit("%s does not hash to the frozen %s" % (name, digest))
    slugs = body.decode().split()
    if len(slugs) != count:
        raise SystemExit("%s holds %d slugs, not %d" % (name, len(slugs), count))
    return set(slugs)


def slug_hash(slugs):
    return hashlib.sha256("".join(s + "\n" for s in sorted(slugs)).encode()).hexdigest()


def write_gz(path, obj):
    raw = json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    with open(path, "wb") as f:
        with gzip.GzipFile(filename="", mode="wb", fileobj=f, mtime=0, compresslevel=9) as g:
            g.write(raw)


def main():
    cache, out_inputs, out_report = sys.argv[1], sys.argv[2], sys.argv[3]
    for sub in ("events", "shown", "prints"):
        os.makedirs(os.path.join(cache, sub), exist_ok=True)
    frozen_listed = frozen(*FROZEN_LISTED)
    frozen_kept = frozen(*FROZEN_KEPT)
    started = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    t0 = time.time()

    scores, score_files = {}, {}
    for league in LEAGUES:
        scores[league], score_files[league] = load_scores(cache, league)
    print("scores", {k: len(v) for k, v in scores.items()}, flush=True)

    candidates = []
    for league in LEAGUES:
        for slug in list_series(league):
            candidates.append((league, slug))
    print("closed six-part events", len(candidates), flush=True)

    def read_event(item):
        league, slug = item
        data = cached(os.path.join(cache, "events"), slug + ".json", lambda: get(GAMMA + "/events", {"slug": slug}))
        raw = data[0] if isinstance(data, list) and data else (data if isinstance(data, dict) else None)
        return league, slug, raw

    with ThreadPoolExecutor(max_workers=8) as pool:
        raws = list(pool.map(read_event, candidates))
    print("events read", len(raws), round(time.time() - t0), "s", flush=True)

    listed, kept, dropped = [], [], {}
    for league, slug, raw in raws:
        ev, why = build(league, slug, raw)
        if ev is None:
            if why != "outside_window":
                listed.append(slug)
            dropped[slug] = why
            continue
        listed.append(slug)
        why = kickoff_rule(ev, scores[league])
        if why is not None:
            dropped[slug] = why
            continue
        kept.append(ev)
    print("listed", len(listed), "kept", len(kept), flush=True)

    def read_shown(ev):
        d = ev["markets"]["D"]
        td = ev["end"] - db.OPEN_LAG
        name = "%s_%d.json" % (d["token"], int(td))
        got = cached(os.path.join(cache, "shown"), name, lambda: {"shown": shown_yes(d["token"], td)})
        return got["shown"]

    with ThreadPoolExecutor(max_workers=8) as pool:
        shown = list(pool.map(read_shown, kept))
    for ev, s in zip(kept, shown):
        ev["markets"]["D"]["shown"] = s
    print("screen prices read", len(shown), "missing", sum(1 for s in shown if s is None), round(time.time() - t0), "s",
          flush=True)

    picks = []
    for ev in kept:
        chosen = db.choose(ev, scores[ev["league"]])
        if chosen is None:
            ev["picked"] = None
        else:
            picks.append(ev)

    feeds = {}

    def read_prints(ev):
        d = ev["markets"]["D"]
        t1 = ev["end"]
        ta = t1 - db.LEAD
        name = "%s_%d_%d.json" % (d["condition"], int(ta), int(t1))

        def fetch():
            try:
                return {"feed": "/trades", "prints": prints_of(d["condition"], ta, t1)}
            except RuntimeError as e:
                return {"feed": "/v2/trades", "prints": prints_v2(d["condition"], ta, t1), "v1_error": str(e)[:200]}

        got = cached(os.path.join(cache, "prints"), name, fetch)
        return ev["slug"], got

    with ThreadPoolExecutor(max_workers=8) as pool:
        got_prints = dict(pool.map(read_prints, picks))
    for ev in picks:
        got = got_prints[ev["slug"]]
        feeds[ev["slug"]] = got["feed"]
        ev["picked"] = {"side": "D", "condition": ev["markets"]["D"]["condition"], "prints": got["prints"]}
    print("picked", len(picks), "prints read", round(time.time() - t0), "s", flush=True)

    events = []
    for ev in kept:
        d = ev["markets"]["D"]
        events.append({
            "slug": ev["slug"], "league": ev["league"], "series": ev["series"], "end": ev["end"],
            "closed": ev["closed"], "home": ev["home"], "away": ev["away"],
            "markets": {"D": {"condition": d["condition"], "shown": d["shown"], "tick": d["tick"], "rate": d["rate"],
                              "payout_yes": d["payout_yes"], "closed": d["closed"]}},
            "picked": ev["picked"],
        })
    events.sort(key=lambda r: (r["end"], r["slug"]))
    write_gz(out_inputs, {"events": events, "scores": scores})

    listed_set, kept_set = set(listed), {ev["slug"] for ev in kept}

    def now_status(slug):
        if slug in kept_set:
            return "kept", "kept"
        if slug in dropped:
            if dropped[slug] == "outside_window":
                return "not listed", "not listed: startTime outside the window"
            return "dropped", "dropped: " + dropped[slug]
        return "not listed", "not listed"

    diffs = []
    for slug in sorted(frozen_kept | kept_set | frozen_listed | listed_set):
        was = "kept" if slug in frozen_kept else ("dropped" if slug in frozen_listed else "not listed")
        cat, label = now_status(slug)
        if cat != was:
            diffs.append({"slug": slug, "at_freeze": was, "now": label})
    skips = {}
    for slug, why in dropped.items():
        skips[why] = skips.get(why, 0) + 1
    report = {
        "pull_started": started,
        "pull_seconds": round(time.time() - t0),
        "closed_six_part_events": len(candidates),
        "listed": len(listed_set), "listed_sha256": slug_hash(listed_set), "frozen_listed_sha256": FROZEN_LISTED[1],
        "listed_by_league": {lg: sum(1 for s in listed_set if s.startswith(PREFIX[lg] + "-")) for lg in LEAGUES},
        "kept": len(kept_set), "kept_sha256": slug_hash(kept_set), "frozen_kept_sha256": FROZEN_KEPT[1],
        "kept_by_league": {lg: sum(1 for ev in kept if ev["league"] == lg) for lg in LEAGUES},
        "differences_from_freeze": diffs,
        "dropped": [{"slug": s, "reason": dropped[s]} for s in sorted(dropped)],
        "dropped_by_reason": dict(sorted(skips.items())),
        "screen_price_missing": sorted(ev["slug"] for ev in kept if ev["markets"]["D"]["shown"] is None),
        "picked": len(picks),
        "prints_incomplete": sorted(ev["slug"] for ev in picks if ev["picked"]["prints"] == "incomplete"),
        "prints_read_from_v2": sorted(s for s, f in feeds.items() if f != "/trades"),
        "score_files": score_files,
        "score_rows": {lg: len(v) for lg, v in scores.items()},
    }
    with open(out_report, "w") as f:
        json.dump(report, f, indent=2, sort_keys=True)
        f.write("\n")
    print("wrote", out_inputs, "and", out_report, "differences from the freeze", len(diffs), flush=True)


def self_check():
    """No network. The name maps, the kickoff rule and the market reader on made-up events."""
    counts = {lg: len(NAMES[lg]) for lg in LEAGUES}
    clubs = {lg: len(set(NAMES[lg].values())) for lg in LEAGUES}
    if counts != {"laliga": 39, "bundesliga": 32, "ligue1": 22, "seriea": 38}:
        raise SystemExit("spellings %s" % counts)
    if clubs != {"laliga": 23, "bundesliga": 21, "ligue1": 21, "seriea": 23}:
        raise SystemExit("clubs %s" % clubs)
    if canonical("laliga", " Real Madrid CF ") != "Real Madrid" or canonical("seriea", "Real Madrid") is not None:
        raise SystemExit("canonical")
    start = datetime(2025, 9, 20, 14, 0, tzinfo=timezone.utc).timestamp()

    def mk(q, pay, gst="2025-09-20 14:00:00+00", fees=False):
        m = {"outcomes": '["Yes", "No"]', "outcomePrices": json.dumps([str(pay), str(1 - pay)]),
             "clobTokenIds": '["tok-%s", "no"]' % q[:4], "question": q, "conditionId": "c-" + q[:9],
             "orderPriceMinTickSize": 0.001, "closedTime": "2025-09-20 16:10:00+00", "gameStartTime": gst,
             "feesEnabled": fees}
        if fees:
            m["feeSchedule"] = {"exponent": 1, "rate": 0.05, "takerOnly": True}
        return m

    raw = {"title": "Real Betis Balompié vs. FC Barcelona", "startTime": "2025-09-20T14:00:00Z",
           "closedTime": "2025-09-20T16:15:00Z",
           "markets": [mk("Will Real Betis win on 2025-09-20?", 0),
                       mk("Will Real Betis vs. FC Barcelona end in a draw?", 1, fees=True),
                       mk("Will Barcelona win on 2025-09-20?", 0)]}
    ev, why = build("laliga", "lal-bet-bar-2025-09-20", raw)
    if why is not None or ev["home"] != "Betis" or ev["away"] != "Barcelona" or ev["markets"]["D"]["rate"] != 0.05:
        raise SystemExit("build %s %s" % (why, ev))
    london = "Date,Time,HomeTeam,AwayTeam,FTHG,FTAG\n20/09/2025,15:00,Barcelona,Betis,1,1\n"
    rows = db.parse_csv(london)
    if kickoff_rule(ev, rows) is not None:
        raise SystemExit("either order, 15:00 London is 14:00 UTC")
    late = db.parse_csv(london.replace("15:00", "15:15"))
    if kickoff_rule(ev, late) != "kickoff_differs":
        raise SystemExit("a moved kickoff was kept")
    moved = dict(raw)
    moved["markets"] = [mk("Will Real Betis win on 2025-09-20?", 0),
                        mk("Will Real Betis vs. FC Barcelona end in a draw?", 1, gst="2025-09-19 18:00:00+00"),
                        mk("Will Barcelona win on 2025-09-20?", 0)]
    ev2, _ = build("laliga", "lal-bet-bar-2025-09-20", moved)
    if kickoff_rule(ev2, rows) != "game_start_moved":
        raise SystemExit("a moved gameStartTime was kept")
    half = dict(raw)
    half["markets"] = [mk("Will Real Betis win on 2025-09-20?", 0),
                       mk("Will Real Betis vs. FC Barcelona end in a draw?", 0.5),
                       mk("Will Barcelona win on 2025-09-20?", 0)]
    if build("laliga", "x", half)[1] != "unresolved":
        raise SystemExit("a 50-50 payout was kept")
    other = dict(raw)
    other["title"] = "Real Betis vs. Leicester"
    if build("laliga", "x", other)[1] != "name":
        raise SystemExit("an unknown club was kept")
    two = dict(raw)
    two["markets"] = raw["markets"][:2]
    if build("laliga", "x", two)[1] != "sides":
        raise SystemExit("a match without its three markets was kept")
    early = dict(raw)
    early["startTime"] = "2025-07-31T23:59:00Z"
    if build("laliga", "x", early)[1] != "outside_window":
        raise SystemExit("the window")
    print("self-check ok", counts, clubs)


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--self-check":
        self_check()
    else:
        main()
