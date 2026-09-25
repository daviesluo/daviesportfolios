"""Premier League score book for the fp5 full-time rules.

A result is a football-data.co.uk final score. Odds columns are never
read. A match is known three hours after its own kickoff. The decision
is one hour before the match being priced, so a result is usable only
when it kicked off at least four hours earlier. Nothing here reads a
Polymarket price.
"""
import math
from collections import defaultdict
from datetime import datetime, timezone

import post_test as post

KNOW = 3 * 3600
LEAD = 3600
MIN_PRIOR = 8

# Polymarket titles to the short names on the score file. Both spellings
# of one club are one club. A title that is not here is not a match.
NAMES = {
    "Arsenal": "Arsenal",
    "Arsenal FC": "Arsenal",
    "Aston Villa": "Aston Villa",
    "Aston Villa FC": "Aston Villa",
    "Bournemouth": "Bournemouth",
    "AFC Bournemouth": "Bournemouth",
    "Brentford": "Brentford",
    "Brentford FC": "Brentford",
    "Brighton": "Brighton",
    "Brighton & Hove Albion FC": "Brighton",
    "Burnley": "Burnley",
    "Burnley FC": "Burnley",
    "Chelsea": "Chelsea",
    "Chelsea FC": "Chelsea",
    "Crystal Palace": "Crystal Palace",
    "Crystal Palace FC": "Crystal Palace",
    "Everton": "Everton",
    "Everton FC": "Everton",
    "Fulham": "Fulham",
    "Fulham FC": "Fulham",
    "Leeds United": "Leeds",
    "Leeds United FC": "Leeds",
    "Liverpool": "Liverpool",
    "Liverpool FC": "Liverpool",
    "Manchester City": "Man City",
    "Manchester City FC": "Man City",
    "Manchester United": "Man United",
    "Manchester United FC": "Man United",
    "Newcastle": "Newcastle",
    "Newcastle United FC": "Newcastle",
    "Nottingham Forest": "Nott'm Forest",
    "Nottingham Forest FC": "Nott'm Forest",
    "Sunderland AFC": "Sunderland",
    "Tottenham": "Tottenham",
    "Tottenham Hotspur FC": "Tottenham",
    "West Ham": "West Ham",
    "West Ham United FC": "West Ham",
    "Wolves": "Wolves",
    "Wolverhampton Wanderers FC": "Wolves",
    "Coventry City FC": "Coventry",
    "Hull City AFC": "Hull",
    "Ipswich Town FC": "Ipswich",
}


def canonical(name):
    if name is None:
        return None
    return NAMES.get(str(name).strip())


def assert_names():
    """Every full-time title seen on series 10188 maps, and the two spellings agree."""
    pairs = (
        ("Liverpool", "Liverpool FC", "Liverpool"),
        ("Bournemouth", "AFC Bournemouth", "Bournemouth"),
        ("Manchester City", "Manchester City FC", "Man City"),
        ("Manchester United", "Manchester United FC", "Man United"),
        ("Nottingham Forest", "Nottingham Forest FC", "Nott'm Forest"),
        ("Leeds United", "Leeds United FC", "Leeds"),
        ("Newcastle", "Newcastle United FC", "Newcastle"),
        ("Tottenham", "Tottenham Hotspur FC", "Tottenham"),
        ("West Ham", "West Ham United FC", "West Ham"),
        ("Wolves", "Wolverhampton Wanderers FC", "Wolves"),
        ("Brighton", "Brighton & Hove Albion FC", "Brighton"),
        ("Sunderland AFC", "Sunderland AFC", "Sunderland"),
        ("Coventry City FC", "Coventry City FC", "Coventry"),
        ("Hull City AFC", "Hull City AFC", "Hull"),
        ("Ipswich Town FC", "Ipswich Town FC", "Ipswich"),
    )
    for short, long, canon in pairs:
        if canonical(short) != canon or canonical(long) != canon:
            raise SystemExit("name map %s %s" % (short, long))
    if canonical("Leicester") is not None or canonical(None) is not None:
        raise SystemExit("an unknown title was mapped")


def cutoff(kick):
    return float(kick) - KNOW - LEAD


def rows_of(scores):
    return sorted(scores or [], key=lambda s: (float(s["kick"]), s["home"], s["away"]))


def priors(scores, kick):
    limit = cutoff(kick)
    return [s for s in rows_of(scores) if float(s["kick"]) <= limit]


def result_of(s):
    if int(s["hg"]) > int(s["ag"]):
        return "H"
    if int(s["hg"]) < int(s["ag"]):
        return "A"
    return "D"


def points_for(team, s):
    won = (s["home"] == team and result_of(s) == "H") or (s["away"] == team and result_of(s) == "A")
    drew = result_of(s) == "D" and team in (s["home"], s["away"])
    if won:
        return 3
    if drew:
        return 1
    if team in (s["home"], s["away"]):
        return 0
    return None


def goal_diff_for(team, s):
    if s["home"] == team:
        return int(s["hg"]) - int(s["ag"])
    if s["away"] == team:
        return int(s["ag"]) - int(s["hg"])
    return None


def season_of(kick):
    dt = datetime.fromtimestamp(float(kick), timezone.utc)
    return dt.year if dt.month >= 8 else dt.year - 1


def teams(ev):
    home, away = ev.get("home"), ev.get("away")
    if not home or not away or home == away or ev.get("end") is None:
        return None, None, None
    return home, away, float(ev["end"])


def best_side(ev, fairs):
    """The side with the largest positive edge at the shown price plus one tick.

    An equal edge keeps H, then D, then A. A side with no shown price is not a candidate.
    """
    best = None
    for i, side in enumerate(("H", "D", "A")):
        fair = None if fairs is None else fairs.get(side)
        market = (ev.get("markets") or {}).get(side)
        if fair is None or not market or market.get("shown") is None:
            continue
        px = float(market["shown"]) + float(market["tick"])
        gap = post.edge(float(fair), px, float(market["rate"]))
        if gap <= 0:
            continue
        key = (-gap, i)
        if best is None or key < best[0]:
            best = (key, side, float(fair))
    if best is None:
        return None
    return best[1], best[2]


def only_side(ev, side, fair):
    if side is None or fair is None:
        return None
    return best_side(ev, {side: fair})


def _games_before(scores, kick):
    games = defaultdict(list)
    for row in priors(scores, kick):
        games[row["home"]].append(row)
        games[row["away"]].append(row)
    return games


def _ppg(team, games, n):
    last = games[team][-n:]
    if len(last) < n:
        return None
    return sum(points_for(team, s) for s in last) / float(n)


def _form_side(home, away, games, n, gap):
    hp, ap = _ppg(home, games, n), _ppg(away, games, n)
    if hp is None or ap is None:
        return None
    if hp - ap >= gap:
        return "H"
    if ap - hp >= gap:
        return "A"
    return None


def _gd(team, games, n):
    last = games[team][-n:]
    if len(last) < n:
        return None
    return sum(goal_diff_for(team, s) for s in last) / float(n)


def _margin_side(home, away, games, n, gap):
    hg, ag = _gd(home, games, n), _gd(away, games, n)
    if hg is None or ag is None:
        return None
    if hg - ag >= gap:
        return "H"
    if ag - hg >= gap:
        return "A"
    return None


def _table_points(team, games, season):
    pts = played = 0
    for row in games[team]:
        if season_of(row["kick"]) != season:
            continue
        pts += points_for(team, row)
        played += 1
    return pts, played


def _table_side(home, away, kick, games, games_min, gap):
    season = season_of(kick)
    hp, hn = _table_points(home, games, season)
    ap, an = _table_points(away, games, season)
    if hn < games_min or an < games_min:
        return None
    if hp - ap >= gap:
        return "H"
    if ap - hp >= gap:
        return "A"
    return None


def _rest_side(home, away, kick, games, gap_days):
    if not games[home] or not games[away]:
        return None
    hr = (float(kick) - float(games[home][-1]["kick"])) / 86400.0
    ar = (float(kick) - float(games[away][-1]["kick"])) / 86400.0
    if hr - ar >= gap_days:
        return "H"
    if ar - hr >= gap_days:
        return "A"
    return None


def _streak_side(home, away, games, n):
    def on(team):
        last = games[team][-n:]
        return len(last) >= n and all(points_for(team, s) == 3 for s in last)

    hs, aws = on(home), on(away)
    if hs and not aws:
        return "H"
    if aws and not hs:
        return "A"
    return None


def _congest_side(home, away, kick, games, days, gap):
    window = float(days) * 86400.0

    def count(team):
        return sum(1 for s in games[team] if float(kick) - window <= float(s["kick"]))

    hc, ac = count(home), count(away)
    if ac - hc >= gap:
        return "H"
    if hc - ac >= gap:
        return "A"
    return None


def _rate(scores, kick, side_of, minimum):
    """How often `side_of` was right on matches already finished before `kick`."""
    rows = rows_of(scores)
    games = defaultdict(list)
    applied = 0
    hits = total = 0
    limit_live = cutoff(kick)
    for row in rows:
        if float(row["kick"]) > limit_live:
            break
        lim = cutoff(row["kick"])
        while applied < len(rows) and float(rows[applied]["kick"]) <= lim:
            prev = rows[applied]
            games[prev["home"]].append(prev)
            games[prev["away"]].append(prev)
            applied += 1
        side = side_of(row["home"], row["away"], row["kick"], games)
        if side is None:
            continue
        total += 1
        if result_of(row) == side:
            hits += 1
    if total < minimum:
        return None
    return hits / float(total)


def _live(home, away, kick, scores, side_of, rate):
    if rate is None:
        return None
    games = _games_before(scores, kick)
    side = side_of(home, away, kick, games)
    if side is None:
        return None
    return side, rate


def form_quote(ev, scores, n, gap, minimum):
    home, away, kick = teams(ev)
    if home is None:
        return None

    def side_of(h, a, _k, games):
        return _form_side(h, a, games, n, gap)

    quoted = _live(home, away, kick, scores, side_of, _rate(scores, kick, side_of, minimum))
    if quoted is None:
        return None
    return only_side(ev, quoted[0], quoted[1])


def margin_quote(ev, scores, n, gap, minimum):
    home, away, kick = teams(ev)
    if home is None:
        return None

    def side_of(h, a, _k, games):
        return _margin_side(h, a, games, n, gap)

    quoted = _live(home, away, kick, scores, side_of, _rate(scores, kick, side_of, minimum))
    if quoted is None:
        return None
    return only_side(ev, quoted[0], quoted[1])


def table_quote(ev, scores, games_min, gap, minimum):
    home, away, kick = teams(ev)
    if home is None:
        return None

    def side_of(h, a, k, games):
        return _table_side(h, a, k, games, games_min, gap)

    quoted = _live(home, away, kick, scores, side_of, _rate(scores, kick, side_of, minimum))
    if quoted is None:
        return None
    return only_side(ev, quoted[0], quoted[1])


def rest_quote(ev, scores, gap_days, minimum):
    home, away, kick = teams(ev)
    if home is None:
        return None

    def side_of(h, a, k, games):
        return _rest_side(h, a, k, games, gap_days)

    quoted = _live(home, away, kick, scores, side_of, _rate(scores, kick, side_of, minimum))
    if quoted is None:
        return None
    return only_side(ev, quoted[0], quoted[1])


def streak_quote(ev, scores, n, minimum):
    home, away, kick = teams(ev)
    if home is None:
        return None

    def side_of(h, a, _k, games):
        return _streak_side(h, a, games, n)

    quoted = _live(home, away, kick, scores, side_of, _rate(scores, kick, side_of, minimum))
    if quoted is None:
        return None
    return only_side(ev, quoted[0], quoted[1])


def congest_quote(ev, scores, days, gap, minimum):
    home, away, kick = teams(ev)
    if home is None:
        return None

    def side_of(h, a, k, games):
        return _congest_side(h, a, k, games, days, gap)

    quoted = _live(home, away, kick, scores, side_of, _rate(scores, kick, side_of, minimum))
    if quoted is None:
        return None
    return only_side(ev, quoted[0], quoted[1])


def expected_score(rh, ra, ha):
    diff = rh + ha - ra
    return 1.0 / (1.0 + 10 ** (-diff / 400.0))


def three_way(rh, ra, ha, anchor):
    diff = rh + ha - ra
    p_draw = anchor * math.exp(-abs(diff) / 400.0)
    p_home = (1.0 - p_draw) * expected_score(rh, ra, ha)
    p_away = (1.0 - p_draw) * (1.0 - expected_score(rh, ra, ha))
    return {"H": p_home, "D": p_draw, "A": p_away}


def ratings_at(scores, kick, k, ha):
    """Elo after every match known before `kick`. Simultaneous kickoffs share a rating."""
    rows = priors(scores, kick)
    ratings = defaultdict(lambda: 1500.0)
    i = 0
    while i < len(rows):
        stamp = float(rows[i]["kick"])
        group = []
        while i < len(rows) and float(rows[i]["kick"]) == stamp:
            group.append(rows[i])
            i += 1
        delta = defaultdict(float)
        for row in group:
            rh = ratings[row["home"]]
            ra = ratings[row["away"]]
            eh = expected_score(rh, ra, ha)
            sh = 1.0 if int(row["hg"]) > int(row["ag"]) else (0.5 if int(row["hg"]) == int(row["ag"]) else 0.0)
            delta[row["home"]] += k * (sh - eh)
            delta[row["away"]] += k * ((1.0 - sh) - (1.0 - eh))
        for team, change in delta.items():
            ratings[team] += change
    return ratings


def elo_quote(ev, scores, k, ha, anchor, minimum):
    home, away, kick = teams(ev)
    if home is None:
        return None
    if len(priors(scores, kick)) < minimum:
        return None
    ratings = ratings_at(scores, kick, k, ha)
    return best_side(ev, three_way(ratings[home], ratings[away], ha, anchor))


def venue_quote(ev, scores, minimum):
    """This club's own home win rate. The away rate is not a second trade."""
    home, away, kick = teams(ev)
    if home is None:
        return None
    homes = [s for s in priors(scores, kick) if s["home"] == home]
    if len(homes) < minimum:
        return None
    fair = sum(1 for s in homes if result_of(s) == "H") / float(len(homes))
    return only_side(ev, "H", fair)


def draw_quote(ev, scores, minimum):
    """The league's draw rate so far. One draw market, not a club's rate."""
    _home, _away, kick = teams(ev)
    if _home is None:
        return None
    rows = priors(scores, kick)
    if len(rows) < minimum:
        return None
    fair = sum(1 for s in rows if result_of(s) == "D") / float(len(rows))
    return only_side(ev, "D", fair)


def _orient(row, home_today):
    res = result_of(row)
    if row["home"] == home_today:
        return res
    if row["away"] == home_today:
        return {"H": "A", "A": "H", "D": "D"}[res]
    return None


def h2h_quote(ev, scores, minimum):
    """The modal result of these two clubs, from today's home side. A tie is no trade."""
    home, away, kick = teams(ev)
    if home is None:
        return None
    meetings = [
        s for s in priors(scores, kick)
        if {s["home"], s["away"]} == {home, away}
    ]
    if len(meetings) < minimum:
        return None
    counts = defaultdict(int)
    for row in meetings:
        counts[_orient(row, home)] += 1
    best = max(counts.values())
    sides = [side for side, n in counts.items() if n == best]
    if len(sides) != 1:
        return None
    return only_side(ev, sides[0], best / float(len(meetings)))
