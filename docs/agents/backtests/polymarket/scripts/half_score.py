"""Quotes for the halftime, team-total and first-half rules (fp5).

Moneyline gaps stay in stat_score.gap_quote. Nothing here reads a price file.
The caller passes every threshold.
"""
import epl_score as score
import stat_score as stat


def _htr(row):
    text = row.get("htr")
    if text in ("H", "D", "A"):
        return text
    try:
        hg, ag = int(row["hthg"]), int(row["htag"])
    except (KeyError, TypeError, ValueError):
        return None
    if hg > ag:
        return "H"
    if hg < ag:
        return "A"
    return "D"


def _led(team, row):
    text = _htr(row)
    if text is None or team not in (row.get("home"), row.get("away")):
        return None
    if row["home"] == team:
        return text == "H"
    return text == "A"


def _level(team, row):
    text = _htr(row)
    if text is None or team not in (row.get("home"), row.get("away")):
        return None
    return text == "D"


def _club_rate(team, scores, kick, minimum, pred):
    rows = [s for s in score.priors(scores, kick) if team in (s.get("home"), s.get("away"))]
    if len(rows) < minimum:
        return None
    hits = 0
    for row in rows:
        got = pred(team, row)
        if got is None:
            return None
        hits += 1 if got else 0
    return hits / float(len(rows))


def htlead_quote(ev, scores, minimum):
    """Buy the club that leads at the break more often. The draw market is not this rule."""
    if ev.get("kind") != "ht":
        return None
    home, away, kick = score.teams(ev)
    if home is None:
        return None
    fairs = {}
    for team in (home, away):
        if team not in (ev.get("markets") or {}):
            continue
        fair = _club_rate(team, scores, kick, minimum, _led)
        if fair is not None:
            fairs[team] = fair
    return stat.best_labeled(ev, fairs, (home, away))


def htdraw_quote(ev, scores, minimum):
    """Buy the halftime draw. The fair value is the average of the two clubs' own rates."""
    if ev.get("kind") != "ht":
        return None
    home, away, kick = score.teams(ev)
    if home is None or "D" not in (ev.get("markets") or {}):
        return None
    rh = _club_rate(home, scores, kick, minimum, _level)
    ra = _club_rate(away, scores, kick, minimum, _level)
    if rh is None or ra is None:
        return None
    return stat.best_labeled(ev, {"D": (rh + ra) / 2.0}, ("D",))


def _pair_rate(ev, scores, minimum, pred):
    home, away, kick = score.teams(ev)
    if home is None:
        return None
    rh = _club_rate(home, scores, kick, minimum, pred)
    ra = _club_rate(away, scores, kick, minimum, pred)
    if rh is None or ra is None:
        return None
    return (rh + ra) / 2.0


def fh_quote(ev, scores, minimum):
    """First-half over 0.5. The fair value is how often the first half had a goal."""
    if ev.get("kind") != "fh":
        return None
    try:
        line = float(ev.get("line"))
    except (TypeError, ValueError):
        return None
    if abs(line - 0.5) > 1e-9:
        return None

    def pred(_team, row):
        try:
            return int(row["hthg"]) + int(row["htag"]) >= 1
        except (KeyError, TypeError, ValueError):
            return None

    fair = _pair_rate(ev, scores, minimum, pred)
    if fair is None:
        return None
    return stat.best_labeled(ev, {"Y": fair}, ("Y",))


def team_quote(ev, scores, goals, minimum):
    """One club's full-time over on goals. Buy the over, not the win-by-two cover."""
    if ev.get("kind") != "team":
        return None
    home, away, kick = score.teams(ev)
    if home is None:
        return None
    try:
        line = float(ev.get("line"))
    except (TypeError, ValueError):
        return None
    if abs(line - (float(goals) - 0.5)) > 1e-9:
        return None

    def pred(team, row):
        if row.get("home") == team:
            return int(row["hg"]) >= goals
        if row.get("away") == team:
            return int(row["ag"]) >= goals
        return None

    fairs = {}
    for team in (home, away):
        if team not in (ev.get("markets") or {}):
            continue
        fair = _club_rate(team, scores, kick, minimum, pred)
        if fair is not None:
            fairs[team] = fair
    return stat.best_labeled(ev, fairs, (home, away))
