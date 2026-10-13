# LP-BEST: the one simulator. Every strategy, the live replay and the calibration go through these functions.
#
# Inputs (scratch, never committed; built by extract.py from the pm-rec archive): one file a market of minute books
# (8 levels a side within 10 c of the touch), every taker print, the programme the listing read every 15 minutes, and
# the daily dumps' metadata. LPBEST_WORK names the folder.
#
# The model, in one place:
#   - Programme: the rate, max spread v and minimum size the listing read (every 15 minutes, forward-filled); a market the
#     listing stopped showing at its phase minute pays nothing from then on (as Polymarket pays the programme in force).
#   - The book we quote against is the recorded one less our own live orders where the live path rested any (validation).
#   - Reward (Polymarket's Liquidity Rewards, docs read 2026-10-13): S(v, s) = ((v - s) / v)^2 for s < v from the
#     size-cutoff-adjusted midpoint m; our Q_one = S x bid size, Q_two = S x ask size (a BUY of NO at 1 - a is an ask at
#     a in the one book); Q_min = max(min(Q1, Q2), max(Q1, Q2) / 3) while 0.10 <= m <= 0.90, else min(Q1, Q2). The
#     others' score is RW's `othersOf` on the recorded book (levels of at least the minimum size within v), as the live
#     code scores it. A minute pays rate / 1440 x Q_min / (Q_min + others); a day's payout is that sum x R, R calibrated
#     on what Polymarket actually paid the live account (calib.py). `formula_code` is the live code's own (min only).
#   - Fills: a taker print (pm-rec's tape, one line per taker trade, its average price) in the window our quote rested
#     (decided on the book of minute t, resting from about t+10 s to t+70 s on the tape's clock). A quote better than the
#     recorded touch is hit first by every taker of its side whose price reached it; a quote at or behind the touch fills
#     only with what the takers left after the recorded depth ahead of it at or better than its price (the minute's
#     takers cumulated, no replenishment; `strict` takes one print at a time). At most the quote's size a minute a side.
#     A touch quote's fills are scaled by k (calib.py: live filled more shares at the touch than the no-us tape implies,
#     the takers our better price attracted); a fraction of a fill is kept as a fractional share.
#   - Money: cash from fills, inventory marked at the raw touch midpoint; the end mark is the last recorded mid.
#   - Rebates: a share of the taker fee feeRate x p(1 - p) a filled share, scaled to the live account's paid rebates.
import os, json, pickle, bisect, math, re
import numpy as np

WORK = os.environ.get('LPBEST_WORK', '')
# the outputs of a run on the data API's tape (LPBEST_API_TAPE=1) carry this suffix beside the pm-rec runs'
TAG = '_api' if os.environ.get('LPBEST_API_TAPE') == '1' else ''
DAY = 1440
EPS = 1e-9

_meta = None
_prints = None
_prog = None

def meta():
    global _meta
    if _meta is None:
        _meta = {int(k): v for k, v in json.load(open(os.path.join(WORK, 'meta.json'))).items()}
        # pm_rec_markets (sql/rec_markets.sql) fills what the daily dumps left out, the question above all
        p = os.path.join(WORK, 'rec_markets.json.gz')
        if os.path.exists(p):
            import gzip
            for (i, q, end, gs, fee, cat, neg, ev) in json.load(gzip.open(p, 'rt'))['rows']:
                m = _meta.get(int(i))
                if m is None: continue
                if not m.get('q'): m['q'] = q
                if not m.get('end'): m['end'] = end
                if not m.get('gs'): m['gs'] = gs
                if not m.get('fee'): m['fee'] = fee
                if m.get('neg') is None: m['neg'] = neg
                if not m.get('ev'): m['ev'] = ev
                if not m.get('cat'): m['cat'] = cat
    return _meta

def prints_all():
    global _prints
    if _prints is None:
        _prints = pickle.load(open(os.path.join(WORK, 'prints.pkl'), 'rb'))
        # LPBEST_API_TAPE=1: the markets apitape.py read again from Polymarket's data API take their prints from there
        if os.environ.get('LPBEST_API_TAPE') == '1':
            api = pickle.load(open(os.path.join(WORK, 'prints_api.pkl'), 'rb'))
            _prints.update(api)
    return _prints

def prog_all():
    global _prog
    if _prog is None:
        _prog = pickle.load(open(os.path.join(WORK, 'prog.pkl'), 'rb'))
        fr = _prog['frames']
        ph = {}
        for (mi, phase, phases, cut) in fr:
            if phase is None: continue
            ph.setdefault(phase, []).append(mi)
        _prog['by_phase'] = {k: np.array(sorted(v)) for k, v in ph.items()}
    return _prog

def market_ids():
    d = os.path.join(WORK, 'mk')
    return sorted(int(f[:-4]) for f in os.listdir(d) if f.endswith('.npz'))

# --- market types: what moves the market (LP-ADVERSE's lib.py, word for word, so the two studies read alike)
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

# pm_lp.ts's lpMarketType, word for word (Addendum 12 leaves its "AI" out)
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

# taker fee rate and maker rebate share by Gamma fee type (reference §2d: crypto 0.07 / 20 %, sports 0.05 / 15 %,
# geopolitics 0, the rest 0.04-0.05 / 25 %)
def fee_and_share(fee_type):
    f = (fee_type or '').lower()
    if 'crypto' in f: return 0.07, 0.20
    if 'sport' in f: return 0.05, 0.15
    if 'geopol' in f: return 0.0, 0.0
    return 0.045, 0.25


class Market:
    """One market's minutes, programme, prints and derived book quantities, all as arrays over its recorded minutes."""
    def __init__(self, mid_id, our_orders=None):
        self.id = mid_id
        md = meta().get(mid_id, {})
        self.meta = md
        self.cond = md.get('cond')
        self.q = md.get('q') or ''
        self.type = mtype(self.q)
        self.lptype = lp_type(self.q)
        z = np.load(os.path.join(WORK, 'mk', f'{mid_id}.npz'))
        self.t = z['m'].astype(np.int64)            # epoch minute
        self.tick = z['tick'].astype(np.float64) / 1e4
        self.tick[self.tick <= 0] = 0.01
        bp = z['bp'].astype(np.float64) / 1e4; ap = z['ap'].astype(np.float64) / 1e4
        bs = z['bs'].astype(np.float64); as_ = z['as_'].astype(np.float64)
        bs[bp <= 0] = 0; as_[ap <= 0] = 0
        bp[bs <= 0] = np.nan; ap[as_ <= 0] = np.nan
        if our_orders is not None:          # take our own live orders out of the recorded book (validation)
            self._remove_ours(bp, bs, ap, as_, our_orders)
        self.bp, self.bs, self.ap, self.as_ = bp, bs, ap, as_
        self.bb = np.where(np.isnan(bp[:, 0]), np.nan, bp[:, 0]); self.ba = ap[:, 0]
        self.mid = (self.bb + self.ba) / 2
        self._prog()
        P = prints_all().get(mid_id)
        self.pr = P if P is not None else np.zeros((0, 4))
        self.index = {int(x): i for i, x in enumerate(self.t)}

    def _remove_ours(self, bp, bs, ap, as_, ours):
        # ours: {epoch minute: (bid price, bid size, ask price, ask size)} in YES-book terms
        for i, mi in enumerate(self.t):
            o = ours.get(int(mi))
            if not o: continue
            b, bsz, a, asz = o
            if b and bsz:
                j = np.where(np.abs(bp[i] - b) < 1e-6)[0]
                if len(j): bs[i, j[0]] = max(0.0, bs[i, j[0]] - bsz)
            if a and asz:
                j = np.where(np.abs(ap[i] - a) < 1e-6)[0]
                if len(j): as_[i, j[0]] = max(0.0, as_[i, j[0]] - asz)
        # re-pack levels: drop emptied ones
        for P, S in ((bp, bs), (ap, as_)):
            empty = S <= 1e-9
            P[empty] = np.nan; S[empty] = 0
            o = np.argsort(np.isnan(P), axis=1, kind='stable')
            P[:] = np.take_along_axis(P, o, 1); S[:] = np.take_along_axis(S, o, 1)

    def _prog(self):
        G = prog_all()
        reads = G['reads'].get(self.id)
        n = len(self.t)
        rate = np.full(n, np.nan); v = np.full(n, np.nan); ms = np.full(n, np.nan)
        # events: reads (rate, v, ms) and misses (its phase minute framed, no line: no programme)
        ev = []
        if reads is not None:
            for (mi, r, vv, s) in reads: ev.append((int(mi), r, vv, s))
        ph = G['by_phase'].get(self.id % 15)
        have = set(int(x[0]) for x in ev)
        if ph is not None and len(self.t):
            lo, hi = self.t[0] - 1440, self.t[-1]
            for mi in ph[(ph >= lo) & (ph <= hi)]:
                if int(mi) not in have: ev.append((int(mi), 0.0, None, None))
        ev.sort()
        # a miss keeps the last spread and minimum and pays nothing; before the first read the day's dump stands
        days = self.meta.get('days', {})
        lastv = lastms = np.nan
        E = np.zeros((len(ev), 4))
        for j, (mi, r, vv, s) in enumerate(ev):
            if vv is None or vv < 0: vv = lastv
            if s is None or s < 0: s = lastms
            E[j] = (mi, 0.0 if (r is None or r < 0) else r, vv, s); lastv, lastms = vv, s
        idx = np.searchsorted(E[:, 0], self.t, side='right') - 1 if len(E) else np.full(n, -1)
        has = idx >= 0
        rate[has] = E[idx[has], 1]; v[has] = E[idx[has], 2]; ms[has] = E[idx[has], 3]
        if (~has).any():
            for i in np.where(~has)[0]:
                dd = days.get(_day(self.t[i]))
                if dd: rate[i], v[i], ms[i] = (dd[0] or 0.0), (dd[1] if dd[1] is not None else np.nan), (dd[2] if dd[2] is not None else np.nan)
        self.rate, self.v, self.ms = rate, v, ms
        # the size-cutoff touch, the adjusted midpoint and the others' scores within v (RW's summarize)
        ms_ = np.nan_to_num(ms, nan=1e9)[:, None]
        okb = self.bs >= ms_; oka = self.as_ >= ms_
        ib = np.argmax(okb, 1); ia = np.argmax(oka, 1)
        hb = okb.any(1); ha = oka.any(1)
        ab = np.where(hb, self.bp[np.arange(n), ib], np.nan); aa = np.where(ha, self.ap[np.arange(n), ia], np.nan)
        self.ab, self.aa = ab, aa
        self.m = (ab + aa) / 2
        vv = v[:, None]
        db = (self.m[:, None] - self.bp) * 100; da = (self.ap - self.m[:, None]) * 100
        sb = np.where(okb & (db >= -EPS) & (db < vv), ((vv - db) / vv) ** 2 * self.bs, 0.0)
        sa = np.where(oka & (da >= -EPS) & (da < vv), ((vv - da) / vv) ** 2 * self.as_, 0.0)
        self.q1 = np.nansum(sb, 1); self.q2 = np.nansum(sa, 1)
        inrange = (self.m >= 0.10) & (self.m <= 0.90)
        self.others = np.where(inrange, np.maximum(np.minimum(self.q1, self.q2), (self.q1 + self.q2) / 3), np.minimum(self.q1, self.q2))
        self.inrange = inrange

    # ---- quote prices (YES book), vectorised over minutes
    def rw_quote(self):
        """RW's `quote`: a tick inside the touch, no closer than half a tick to m, never through."""
        t, bb, ba, m = self.tick, self.bb, self.ba, self.m
        b = np.floor(np.minimum(bb + t, m - t / 2) / t + EPS) * t
        a = np.ceil(np.maximum(ba - t, m + t / 2) / t - EPS) * t
        b = np.where(b >= ba - 1e-12, np.floor((ba - t) / t + EPS) * t, b)
        a = np.where(a <= bb + 1e-12, np.ceil((bb + t) / t - EPS) * t, a)
        ok = (b > 0) & (a < 1) & (b < a - 1e-12) & ~np.isnan(m)
        return np.where(ok, b, np.nan), np.where(ok, a, np.nan)

    def placed(self, mode, k=0, dist=None):
        """Our bid and ask under a placement: 'inside' (RW), 'join' (at the recorded touch), 'behind' (k ticks behind the
        touch), 'dist' (dist cents from m, never better than RW's price)."""
        bi, ai = self.rw_quote()
        t = self.tick
        if mode == 'inside': return bi, ai
        if mode == 'join': b, a = self.bb.copy(), self.ba.copy()
        elif mode == 'behind': b, a = self.bb - k * t, self.ba + k * t
        elif mode == 'dist':
            b = np.floor((self.m - dist / 100) / t + EPS) * t; a = np.ceil((self.m + dist / 100) / t - EPS) * t
            b = np.minimum(b, bi); a = np.maximum(a, ai)
        else: raise ValueError(mode)
        b = np.where((b > 0) & ~np.isnan(bi), b, np.nan); a = np.where((a < 1) & ~np.isnan(ai), a, np.nan)
        return b, a

    def score(self, b, a, Qb, Qa):
        """Our Q1 (bid side) and Q2 (ask side) per minute."""
        v = self.v
        db = (self.m - b) * 100; da = (a - self.m) * 100
        s1 = np.where((db >= -EPS) & (db < v) & (Qb >= self.ms - EPS), ((v - db) / v) ** 2 * Qb, 0.0)
        s2 = np.where((da >= -EPS) & (da < v) & (Qa >= self.ms - EPS), ((v - da) / v) ** 2 * Qa, 0.0)
        return np.nan_to_num(s1), np.nan_to_num(s2)

    def reward(self, q1, q2, code=False):
        """$ of formula per minute for our Q1/Q2: Polymarket's Q_min, or the live code's min (code=True)."""
        if code: ours = np.minimum(q1, q2)
        else: ours = np.where(self.inrange, np.maximum(np.minimum(q1, q2), np.maximum(q1, q2) / 3), np.minimum(q1, q2))
        rate = np.nan_to_num(self.rate)
        return np.where(ours > 0, rate / 1440 * ours / (ours + self.others), 0.0)

    def depth_ahead_bid(self, b):
        """Recorded bid depth at prices at or better than b (we join behind it)."""
        return np.nansum(np.where(self.bp >= b[:, None] - 1e-9, self.bs, 0.0), 1)

    def depth_ahead_ask(self, a):
        return np.nansum(np.where(self.ap <= a[:, None] + 1e-9, self.as_, 0.0), 1)

    def print_groups(self, lag=10, span=60):
        """Prints grouped by the minute whose quote they meet: tape ts in [t*60+lag, t*60+lag+span)."""
        if not len(self.pr): return {}
        mins = np.floor((self.pr[:, 0] - lag) / 60).astype(np.int64)
        g = {}
        for row, mi in zip(self.pr, mins):
            g.setdefault(int(mi), []).append(row)
        return g


def _day(mi):
    import datetime
    return datetime.datetime.utcfromtimestamp(int(mi) * 60).strftime('%Y-%m-%d')

def day_of_min(mi):
    return _day(mi)

def fill_minute(rows, side, price, Q, D, top, strict=False):
    """Shares our order of size Q at `price` fills in one minute's prints. side +1 = our bid (taker SELLs, dir -1),
    -1 = our ask (taker BUYs, dir +1). `top`: we were better than the recorded touch (no depth ahead).
    Returns (shares, list of (ts, shares, print price, print size))."""
    want = -1 if side == 1 else 1
    left = Q; used = 0.0; out = []
    for (ts, d, y, s) in rows:
        if d != want or left <= 1e-9: continue
        if top:
            # a taker of our side whose price reached ours (we are the best): it trades with us first
            if (side == 1 and y > price + 1e-9) or (side == -1 and y < price - 1e-9): continue
            f = min(left, s)
        else:
            if strict:
                f = min(left, max(0.0, s - D))
            else:
                f = min(left, max(0.0, used + s - D) - max(0.0, used - D)); used += s
        if f > 1e-9:
            left -= f; out.append((ts, f, y, s))
    return Q - left, out


def boot(groups, n=2000, seed=20261013):
    """Percentile bootstrap of a total over groups (each a number): 5 / 50 / 95 %."""
    rnd = np.random.default_rng(seed)
    x = np.array(groups, float)
    if len(x) == 0: return (0.0, 0.0, 0.0)
    s = rnd.integers(0, len(x), size=(n, len(x)))
    tot = x[s].sum(1)
    return tuple(np.percentile(tot, [5, 50, 95]))
