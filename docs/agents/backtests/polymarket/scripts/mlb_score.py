"""Quotes for eight Major League Baseball rules (fp5). No price is read here.

Moneyline quotes use the starter's own recent outings. The fair value is how
often the side this rule would have named then won. The other quotes are the
rate of the event the contract pays. The caller passes every threshold.
"""
import stat_score as stat

KNOW = 4 * 3600


def _ts(row):
    return float(row["ts"])


def _index(rows, key):
    out = {}
    for row in rows or []:
        out.setdefault(row[key], []).append(row)
    for pid in out:
        out[pid].sort(key=_ts)
    return out


def _before(rows, limit):
    return [row for row in rows or [] if _ts(row) <= limit]


def _last(indexed, pid, limit, n, pred=None):
    if pid is None:
        return None
    got = _before(indexed.get(pid) or [], limit)
    if pred is not None:
        got = [row for row in got if pred(row)]
    if len(got) < n:
        return None
    return got[-n:]


def _per9(rows, key):
    outs = sum(int(row["outs"]) for row in rows)
    if outs <= 0:
        return None
    return sum(int(row[key]) for row in rows) * 27.0 / float(outs)


def _era(rows):
    return _per9(rows, "er")


def _won(game, team):
    if game.get("home") == team:
        return int(game["hr"]) > int(game["ar"])
    if game.get("away") == team:
        return int(game["ar"]) > int(game["hr"])
    return None


def _games(book):
    return sorted(book.get("games") or [], key=_ts)


def _limit(kick):
    return float(kick) - KNOW


def decision_ts(ev):
    """First pitch. A self-check that has no kick uses end."""
    if ev.get("kick") is not None:
        return float(ev["kick"])
    return float(ev["end"])


def _gap_team(home, away, hv, av, gap, higher):
    if hv is None or av is None:
        return None
    diff = hv - av
    if higher:
        if diff >= gap:
            return home
        if -diff >= gap:
            return away
        return None
    if -diff >= gap:
        return home
    if diff >= gap:
        return away
    return None


def _side_rate(book, kick, namer, minimum):
    hits = tot = 0
    for game in _games(book):
        if _ts(game) > _limit(kick):
            break
        named = namer(game)
        won = None if named is None else _won(game, named)
        if won is None:
            continue
        tot += 1
        hits += 1 if won else 0
    if tot < minimum:
        return None
    return hits / float(tot)


def _only(ev, team, fair):
    if team is None or fair is None:
        return None
    return stat.best_labeled(ev, {team: fair}, (team,))


def _starter_metric(game, indexed, limit_of, n, metric):
    home, away = game.get("home"), game.get("away")
    if not home or not away or home == away:
        return None
    limit = limit_of(game)
    hs = _last(indexed, game.get("hp"), limit, n)
    aws = _last(indexed, game.get("ap"), limit, n)
    if hs is None or aws is None:
        return None
    if metric == "era":
        return home, away, _era(hs), _era(aws)
    if metric == "bb":
        return home, away, _per9(hs, "bb"), _per9(aws, "bb")
    if metric == "k":
        return home, away, _per9(hs, "k"), _per9(aws, "k")
    return None


def _ml_quote(ev, book, n, gap, minimum, metric, higher):
    if ev.get("kind") != "ml" or ev.get("end") is None:
        return None
    indexed = _index(book.get("starts"), "pid")

    def limit_of(game):
        return _limit(_ts(game))

    def namer(game):
        got = _starter_metric(game, indexed, limit_of, n, metric)
        if got is None:
            return None
        home, away, hv, av = got
        return _gap_team(home, away, hv, av, gap, higher)

    when = decision_ts(ev)
    current = {
        "ts": when, "home": ev.get("home"), "away": ev.get("away"),
        "hp": ev.get("hp"), "ap": ev.get("ap"), "hr": 0, "ar": 0,
    }
    team = namer(current)
    if team is None:
        return None
    return _only(ev, team, _side_rate(book, when, namer, minimum))


def arm_quote(ev, book, n, gap, minimum):
    """Buy the team whose starter has the lower ERA. A smaller gap does not trade."""
    return _ml_quote(ev, book, n, gap, minimum, "era", False)


def walk_quote(ev, book, n, gap, minimum):
    """Buy the team whose starter walks fewer batters per nine."""
    return _ml_quote(ev, book, n, gap, minimum, "bb", False)


def k9_quote(ev, book, n, gap, minimum):
    """Buy the team whose starter strikes out more batters per nine."""
    return _ml_quote(ev, book, n, gap, minimum, "k", True)


def _tired_name(game, indexed, gap, days):
    home, away = game.get("home"), game.get("away")
    if not home or not away:
        return None
    limit = _limit(_ts(game))
    hs = _last(indexed, game.get("hp"), limit, 1)
    aws = _last(indexed, game.get("ap"), limit, 1)
    if hs is None or aws is None:
        return None
    window = days * 86400.0
    if _ts(game) - _ts(hs[0]) > window or _ts(game) - _ts(aws[0]) > window:
        return None
    return _gap_team(home, away, float(hs[0]["pitches"]), float(aws[0]["pitches"]), gap, False)


def tired_quote(ev, book, gap, days, minimum):
    """Buy the team whose starter threw fewer pitches last time out. A short gap does not trade."""
    if ev.get("kind") != "ml" or ev.get("end") is None:
        return None
    indexed = _index(book.get("starts"), "pid")

    def namer(game):
        return _tired_name(game, indexed, gap, days)

    when = decision_ts(ev)
    current = {
        "ts": when, "home": ev.get("home"), "away": ev.get("away"),
        "hp": ev.get("hp"), "ap": ev.get("ap"),
    }
    team = namer(current)
    if team is None:
        return None
    return _only(ev, team, _side_rate(book, when, namer, minimum))


def _window(indexed, pid, limit, n, minimum, pred=None):
    """The last n rows at or before limit, or None when fewer than minimum qualify."""
    if pid is None:
        return None
    got = _before(indexed.get(pid) or [], limit)
    if pred is not None:
        got = [row for row in got if pred(row)]
    if len(got) < minimum:
        return None
    return got[-n:]


def _fi_rate(indexed, pid, limit, n, minimum):
    rows = _window(indexed, pid, limit, n, minimum, pred=lambda row: row.get("fi_allowed") is not None)
    if rows is None:
        return None
    return sum(int(row["fi_allowed"]) for row in rows) / float(len(rows))


def yrfi_quote(ev, book, n, minimum):
    """A run in the first inning. The fair value combines the two starters' own rates."""
    if ev.get("kind") != "nrfi" or ev.get("end") is None:
        return None
    indexed = _index(book.get("starts"), "pid")
    limit = _limit(decision_ts(ev))
    r1 = _fi_rate(indexed, ev.get("hp"), limit, n, minimum)
    r2 = _fi_rate(indexed, ev.get("ap"), limit, n, minimum)
    if r1 is None or r2 is None:
        return None
    fair = 1.0 - (1.0 - r1) * (1.0 - r2)
    return stat.best_labeled(ev, {"Y": fair, "N": 1.0 - fair}, ("Y", "N"))


def _team_rate(games, team, kick, n, minimum):
    rows = [g for g in games if _ts(g) <= _limit(kick) and team in (g.get("home"), g.get("away"))]
    if len(rows) < minimum:
        return None
    window = rows[-n:]
    if len(window) < minimum:
        return None
    return sum(int(g["extra"]) for g in window) / float(len(window))


def xin_quote(ev, book, n, minimum):
    """Extra innings. The fair value is the average of the two clubs' own rates."""
    if ev.get("kind") != "xin" or ev.get("end") is None:
        return None
    home, away = ev.get("home"), ev.get("away")
    if not home or not away:
        return None
    games = _games(book)
    when = decision_ts(ev)
    rh = _team_rate(games, home, when, n, minimum)
    ra = _team_rate(games, away, when, n, minimum)
    if rh is None or ra is None:
        return None
    fair = (rh + ra) / 2.0
    return stat.best_labeled(ev, {"Y": fair, "N": 1.0 - fair}, ("Y", "N"))


def hr_quote(ev, book, n, minimum):
    """One batter, home runs over 0.5 only. The fair value is how often he homered."""
    if ev.get("kind") != "hr" or ev.get("end") is None:
        return None
    try:
        line = float(ev.get("line"))
    except (TypeError, ValueError):
        return None
    if abs(line - 0.5) > 1e-9:
        return None
    indexed = _index(book.get("hitters"), "pid")
    rows = _window(indexed, ev.get("pid"), _limit(decision_ts(ev)), n, minimum)
    if rows is None:
        return None
    fair = sum(1 for row in rows if int(row["hr"]) >= 1) / float(len(rows))
    return stat.best_labeled(ev, {"Y": fair, "N": 1.0 - fair}, ("Y", "N"))


def k_quote(ev, book, line, n, minimum):
    """One pitcher's strikeouts over one line. A different line does not trade."""
    if ev.get("kind") != "k" or ev.get("end") is None:
        return None
    try:
        got = float(ev.get("line"))
    except (TypeError, ValueError):
        return None
    if abs(got - float(line)) > 1e-9:
        return None
    indexed = _index(book.get("starts"), "pid")
    rows = _window(indexed, ev.get("pid"), _limit(decision_ts(ev)), n, minimum)
    if rows is None:
        return None
    need = int(line) + 1
    fair = sum(1 for row in rows if int(row["k"]) >= need) / float(len(rows))
    return stat.best_labeled(ev, {"Y": fair, "N": 1.0 - fair}, ("Y", "N"))
