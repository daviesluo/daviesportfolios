# LP-ADVERSE: shared loading for the study's scripts. Inputs are the unwrapped replies of sql/*.sql and the books/prints
# pickle of extract_books.py, all in a scratch folder (WORK) that is never committed.
import json, gzip, pickle, os, re, bisect, math
from datetime import datetime, timezone

WORK = os.environ.get('LPADV_WORK', '')

def ep(s):
    if s is None: return None
    s = str(s).replace('Z', '+00:00')
    if ' ' in s and 'T' not in s: s = s.replace(' ', 'T', 1)
    return datetime.fromisoformat(s).timestamp()

def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime('%Y-%m-%d %H:%M')

def day_of(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime('%Y-%m-%d')

def jload(name):
    p = os.path.join(WORK, name)
    op = gzip.open if p.endswith('.gz') else open
    with op(p, 'rt') as f: return json.load(f)

# A finer type than pm_lp.ts's lpMarketType, for this study only: what moves the market. First match wins.
TYPES = [
    ('view-count', r'(views|video|monthly listeners|streams|spotify)'),
    ('box office', r'(box office|rotten tomatoes|tomatometer)'),
    ('AI release', r'(gemini|anthropic|openai|gpt|grok|claude|deepseek|ai model|llm|arena)'),
    ('crypto', r'(ethereum|bitcoin|\bbtc\b|\beth\b|solana|\bxrp\b|crypto)'),
    ('sports', r'(heisman|nfl|nba|mlb|nhl|super bowl|world series|grand prix|\bgame\b|match|championship|trophy|\bcup\b|open\b)'),
    ('earnings/econ data', r'(\bq[1-4]\b|earnings|ffo|revenue|sales|gdp|inflation|consumer sentiment|cpi|pce|jobs|yield|home value|net worth|provision|fed |rate cut|unemployment)'),
    ('statements', r'(publicly (insult|praise|say|mention|call)|\bsay\b|\btweet|truth social|\bpost )'),
    ('elections', r'(election|seats|nomination|win the most|primary|legislative)'),
]
def mtype(q):
    x = (q or '').lower()
    for name, rx in TYPES:
        if re.search(rx, x): return name
    return 'news/geo deadline'

# pm_lp.ts's own lpMarketType, word for word (kept the same as LP-ALLOC's typeOf), for comparison with earlier studies.
def lp_type(q):
    x = (q or '').lower(); t = lambda r: re.search(r, x) is not None
    if t(r"(highest temperature|lowest temperature|rain |rain\?|precipitation|wind gust|drought|earthquake|water level|peak at category|°)"): return "weather/nature"
    if t(r"(mtv|video music)"): return "entertainment/sports"
    if t(r"(views|video|posts? |tweets|truth social|monthly listeners|streams|first week sales|spotify|song this week|netflix show|tokens the week|market share|deaths)"): return "counts"
    if t(r"(box office|rotten tomatoes|tomatometer)"): return "box office/reviews"
    if t(r"(ai model|anthropic|openai|gemini|gpt|grok|claude|deepseek|mistral|llm|arena|livebench|meta muse|fable model)"): return "AI"
    if t(r"(inflation|cpi|pce|gdp|jobs|jolts|pmi|fed |bps|s&p|spx|spy|wti|crude|etf|\(low\)|\(high\)|closes above|up or down|home value|net worth|diesel|committed to|combined ratio)"): return "macro/markets"
    if t(r"(election|presidential|mayor|senate|parliament|nomination|votes|trump|xi jinping|iran|saudi|yemen|houthi|hormuz|russia|ukraine|israel|military|troops|sanaa|bab el|ships|summit|white house|vatican|zelensky|khamenei|moratorium|plague|ubs|lula|bolsonaro|centcom)"): return "politics/geo"
    if t(r"(mtv|video music|coachella|dancing with the stars|award|mlb|nba|nfl|nhl|lcs|major|grand prix|game|bruins|minecraft|messi)"): return "entertainment/sports"
    return "other"


class Mids:
    """Each market's YES touch by minute: live-prep's own minutes (the book WITHOUT our orders) where it watched the
    market, the pm-rec recorder's book (the venue's, ours in it) elsewhere. mid(cond, t) is the touch's midpoint at the
    first recorded minute at or after t (within `tol` seconds); before(cond, t) the last at or before t."""
    def __init__(self, lp_rows, rec_books, cond_of_id):
        self.s = {}
        for cond_id, rows in rec_books.items():
            cond = cond_of_id.get(cond_id)
            if not cond: continue
            d = self.s.setdefault(cond, {})
            for (minute, tick, bids, asks, ab, aa, ltp) in rows:
                bb = bids[0][0] if bids else None; ba = asks[0][0] if asks else None
                d[int(minute)] = (bb, ba, ab, aa, 'rec', tick, bids, asks)
        for r in lp_rows:
            minute, cond, bb, ba, ab, aa = int(r[0]), r[1], r[2], r[3], r[4], r[5]
            f = lambda v: None if v is None else float(v)
            old = self.s.setdefault(cond, {}).get(minute)
            self.s[cond][minute] = (f(bb), f(ba), f(ab), f(aa), 'lp', float(r[16]) if r[16] is not None else None,
                                    old[6] if old else None, old[7] if old else None)
        self.keys = {c: sorted(d) for c, d in self.s.items()}

    @staticmethod
    def midof(v, adjusted=False):
        if v is None: return None
        bb, ba, ab, aa = v[0], v[1], v[2], v[3]
        if adjusted:
            if ab is None or aa is None: return None
            return (ab + aa) / 2
        if bb is None or ba is None: return None
        return (bb + ba) / 2

    def at(self, cond, t, tol=1800, after=True):
        ks = self.keys.get(cond)
        if not ks: return None, None
        if after:
            i = bisect.bisect_left(ks, int(t))
            if i >= len(ks) or ks[i] - t > tol: return None, None
        else:
            i = bisect.bisect_right(ks, int(t)) - 1
            if i < 0 or t - ks[i] > tol: return None, None
        return ks[i], self.s[cond][ks[i]]

    def mid(self, cond, t, tol=1800, after=True, adjusted=False):
        k, v = self.at(cond, t, tol, after)
        return self.midof(v, adjusted)

    def last(self, cond, until=None, adjusted=False):
        ks = self.keys.get(cond) or []
        for k in reversed(ks):
            if until is not None and k > until: continue
            m = self.midof(self.s[cond][k], adjusted)
            if m is not None: return k, m
        return None, None


def bootstrap(groups, stat, n=4000, seed=20261012):
    """Percentile bootstrap over groups (lists of items), `stat` a function of the concatenated draw."""
    import random
    rnd = random.Random(seed)
    keys = list(groups)
    out = []
    for _ in range(n):
        draw = []
        for _ in keys: draw.extend(groups[keys[rnd.randrange(len(keys))]])
        out.append(stat(draw))
    out.sort()
    return out[int(0.05 * n)], out[int(0.5 * n)], out[int(0.95 * n)]
