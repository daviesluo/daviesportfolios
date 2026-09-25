"""Quotes for eight Premier League stat rules (fp5). No price is read here.

Moneyline quotes use epl_score's hit rate: how often the side this rule
would have named then won. Contract quotes are the club's own rate of the
event the contract pays. The caller passes every threshold.
"""
import epl_score as score
import post_test as post


def _team_stat(team, row, home_key, away_key):
    if row.get("home") == team:
        val = row.get(home_key)
    elif row.get("away") == team:
        val = row.get(away_key)
    else:
        return None
    if val is None:
        return None
    return float(val)


def _last_avg(team, games, n, home_key, away_key):
    vals = []
    for row in reversed(games[team]):
        val = _team_stat(team, row, home_key, away_key)
        if val is None:
            continue
        vals.append(val)
        if len(vals) == n:
            break
    if len(vals) < n:
        return None
    return sum(vals) / float(n)


def _gap_side(home, away, games, n, gap, home_key, away_key, higher):
    hv = _last_avg(home, games, n, home_key, away_key)
    av = _last_avg(away, games, n, home_key, away_key)
    if hv is None or av is None:
        return None
    diff = hv - av
    if higher:
        if diff >= gap:
            return "H"
        if -diff >= gap:
            return "A"
        return None
    if -diff >= gap:
        return "H"
    if diff >= gap:
        return "A"
    return None


def gap_quote(ev, scores, n, gap, minimum, home_key, away_key, higher):
    """Buy the side the stat names. The fair value is how often that side then won."""
    if ev.get("kind") != "ml":
        return None
    home, away, kick = score.teams(ev)
    if home is None:
        return None

    def side_of(h, a, _k, games):
        return _gap_side(h, a, games, n, gap, home_key, away_key, higher)

    quoted = score._live(home, away, kick, scores, side_of, score._rate(scores, kick, side_of, minimum))
    if quoted is None:
        return None
    return score.only_side(ev, quoted[0], quoted[1])


def ref_quote(ev, scores, minimum):
    """This referee's home-win rate. Buy the home side only."""
    if ev.get("kind") != "ml":
        return None
    home, _away, kick = score.teams(ev)
    if home is None:
        return None
    ref = ev.get("ref")
    if not ref:
        return None
    rows = [s for s in score.priors(scores, kick) if s.get("ref") == ref]
    if len(rows) < minimum:
        return None
    fair = sum(1 for s in rows if score.result_of(s) == "H") / float(len(rows))
    return score.only_side(ev, "H", fair)


def _club_rows(team, scores, kick):
    return [s for s in score.priors(scores, kick) if team in (s.get("home"), s.get("away"))]


def _club_rate(team, scores, kick, minimum, pred):
    rows = _club_rows(team, scores, kick)
    if len(rows) < minimum:
        return None
    return sum(1 for s in rows if pred(team, s)) / float(len(rows))


def best_labeled(ev, fairs, tie_order):
    """Largest positive edge. An equal edge keeps the earlier name in tie_order."""
    best = None
    order = {name: i for i, name in enumerate(tie_order)}
    for key, fair in (fairs or {}).items():
        market = (ev.get("markets") or {}).get(key)
        if fair is None or not market or market.get("shown") is None:
            continue
        px = float(market["shown"]) + float(market["tick"])
        gap = post.edge(float(fair), px, float(market["rate"]))
        if gap <= 0:
            continue
        item = (-gap, order.get(key, 10 ** 9), str(key))
        if best is None or item < best[0]:
            best = (item, key, float(fair))
    if best is None:
        return None
    return best[1], best[2]


def spread_quote(ev, scores, margin, minimum):
    """Buy the -1.5 cover with the larger edge. The fair value is that club's own rate."""
    if ev.get("kind") != "spread":
        return None
    home, away, kick = score.teams(ev)
    if home is None:
        return None

    def pred(team, row):
        gd = score.goal_diff_for(team, row)
        return gd is not None and gd >= margin

    fairs = {}
    for team in (home, away):
        if team not in (ev.get("markets") or {}):
            continue
        fair = _club_rate(team, scores, kick, minimum, pred)
        if fair is not None:
            fairs[team] = fair
    return best_labeled(ev, fairs, (home, away))


def _pair_average(ev, scores, minimum, pred):
    home, away, kick = score.teams(ev)
    if home is None:
        return None
    rh = _club_rate(home, scores, kick, minimum, pred)
    ra = _club_rate(away, scores, kick, minimum, pred)
    if rh is None or ra is None:
        return None
    return (rh + ra) / 2.0


def btts_quote(ev, scores, minimum):
    """Both teams to score. The fair value is the average of the two clubs' rates."""
    if ev.get("kind") != "btts":
        return None

    def pred(_team, row):
        return int(row["hg"]) > 0 and int(row["ag"]) > 0

    fair = _pair_average(ev, scores, minimum, pred)
    if fair is None:
        return None
    return best_labeled(ev, {"Y": fair}, ("Y",))


def over_quote(ev, scores, goals, minimum):
    """Full-time goals over the line goals-0.5. Buy the over only."""
    if ev.get("kind") != "over":
        return None
    try:
        line = float(ev.get("line"))
    except (TypeError, ValueError):
        return None
    if abs(line - (float(goals) - 0.5)) > 1e-9:
        return None

    def pred(_team, row):
        return int(row["hg"]) + int(row["ag"]) >= goals

    fair = _pair_average(ev, scores, minimum, pred)
    if fair is None:
        return None
    return best_labeled(ev, {"Y": fair}, ("Y",))


def _last_corner_rows(team, games, n):
    rows = []
    for row in reversed(games[team]):
        if row.get("hc") is None or row.get("ac") is None:
            continue
        rows.append(row)
        if len(rows) == n:
            break
    if len(rows) < n:
        return None
    return rows


def corner_quote(ev, scores, n):
    """One full-time corner over. The fair value is the share of the pooled last-n matches above the line."""
    if ev.get("kind") != "corners":
        return None
    home, away, kick = score.teams(ev)
    if home is None:
        return None
    games = score._games_before(scores, kick)
    hs = _last_corner_rows(home, games, n)
    aws = _last_corner_rows(away, games, n)
    if hs is None or aws is None:
        return None
    pool = {}
    for row in hs + aws:
        pool[(row["kick"], row["home"], row["away"])] = row
    rows = list(pool.values())
    if not rows:
        return None
    fairs = {}
    for key in ev.get("markets") or {}:
        try:
            line = float(key)
        except (TypeError, ValueError):
            continue
        hits = sum(1 for row in rows if float(row["hc"]) + float(row["ac"]) > line)
        fairs[key] = hits / float(len(rows))
    order = sorted(fairs, key=lambda key: (float(key), key))
    return best_labeled(ev, fairs, order)
