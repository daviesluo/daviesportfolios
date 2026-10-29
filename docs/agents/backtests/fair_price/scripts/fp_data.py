# REVX-FAIR (2026-10-29): the study's inputs, loaded once, and the causal series built from them.
#
# Every series here answers "what was known at instant t" (an as-of read): a book snapshot is the latest one stamped at or
# before t and still fresh, an hourly close is read only once its hour has ended, GBP/USD is the minute record's own X.
# Nothing reads a value stamped after the instant it is used at.
#
# Data (data/, pulled 2026-10-29 by sql/pulls.sql, md5-checked by pr5_opt/scripts/grab_text.py; rows end 2026-10-29 00:00 UTC):
#   minutes.txt       PR5's minute record: book|ms|x|fair_u|x_lag_min|hours_n|prints_n (agent_quote_minutes)
#   prints.txt        every stored Revolut X UK print: id|book|ms|price|qty|aggressor (agent_quote_prints)
#   hours.txt         the USD books' hourly closes: kind|ms(hour start)|close (agent_quote_inputs, fair:*)
#   book_<B>.txt      Revolut X book snapshots, five levels a side: ms|seen_until_ms|p:q:n;...|p:q:n;... (agent_book_levels)
#   cb_<B>.txt        Coinbase's touch for USDC-GBP and USDT-GBP: ms|bid|ask|bid_size|ask_size (cb_touch)
# LIVE's own orders (agent_quote_live_orders) are read from $FP_LIVE (a local pull, not committed: the repository is public
# and they carry the live account's sizes); they are used only to take LIVE's own resting orders out of the book snapshots
# and to place LIVE's fills in time. Without $FP_LIVE the books are used as recorded (`clean=False`).
import os, gzip, bisect, datetime, collections, math

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(HERE, 'data')
M, H, DAY = 60_000, 3_600_000, 86_400_000
TICK = 1e-4
BOOKS = ('USDC-GBP', 'USDT-GBP')
USD_OF = {'USDC-GBP': 'USDC-USD', 'USDT-GBP': 'USDT-USD'}
BOOK_FRESH_MS = 5 * M        # a snapshot stands until seen_until + this; after that the book is unknown
CB_FRESH_MS = 5 * M
END = int(datetime.datetime(2026, 10, 29, tzinfo=datetime.timezone.utc).timestamp() * 1000)


def ms(*a):
    return int(datetime.datetime(*a, tzinfo=datetime.timezone.utc).timestamp() * 1000)


def day(t):
    return datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime('%Y-%m-%d')


def hour(t):
    return datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).hour


def closure(t):
    d = datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc)
    wd, hh = d.weekday(), d.hour
    return (wd == 4 and hh >= 21) or wd == 5 or (wd == 6 and hh < 21)


def _open(name):
    p = os.path.join(DATA, name)
    if os.path.exists(p): return open(p)
    return gzip.open(p + '.gz', 'rt')


def load_minutes():
    """{book: [(t, x, fu, lag_min)]}, the minute record PR5's engine decided each minute on."""
    out = collections.defaultdict(list)
    for l in _open('minutes.txt'):
        l = l.strip()
        if not l: continue
        b, t, x, fu, lag, hn, pn = l.split('|')
        out[b].append((int(t), float(x) if x else None, float(fu) if fu else None, int(lag) if lag else None))
    for b in out: out[b].sort()
    return dict(out)


def load_prints():
    """{book: [(ms, ticks, qty, aggressor, id)]} in the pr5_opt simulator's shape."""
    out = collections.defaultdict(list)
    for l in _open('prints.txt'):
        l = l.strip()
        if not l: continue
        pid, b, t, px, q, sd = l.split('|')
        out[b].append((int(t), round(float(px) / TICK), float(q), sd, pid))
    for b in out: out[b].sort(key=lambda z: (z[0], z[4]))
    return dict(out)


def load_hours():
    """{usd book: [(hour start ms, close)]}"""
    out = collections.defaultdict(list)
    for l in _open('hours.txt'):
        l = l.strip()
        if not l: continue
        k, t, v = l.split('|')
        out[k.split(':', 1)[1]].append((int(t), float(v)))
    for k in out: out[k].sort()
    return dict(out)


def load_live_orders():
    p = os.environ.get('FP_LIVE')
    if not p or not os.path.exists(p): return None
    rows = []
    for l in open(p):
        l = l.rstrip('\n')
        if not l: continue
        f = l.split('|')
        num = lambda s: float(s) if s not in ('', None) else None
        rows.append(dict(id=int(f[0]), ts=int(f[1]), mode=f[2], book=f[3], rung_side=f[4], k=num(f[5]), leg=f[6], side=f[7],
                         price=float(f[8]), base=float(f[9]), state=f[10], filled=float(f[11]), avg=num(f[12]), fair=num(f[13]),
                         filled_at=int(f[14]) if f[14] else None, cancelled_at=int(f[15]) if f[15] else None,
                         updated_at=int(f[16]) if f[16] else None, paper_live=int(f[17]) if f[17] else None))
    return rows


def _levels(s):
    out = []
    if not s: return out
    for z in s.split(';'):
        p, q, n = z.split(':')
        out.append([float(p), float(q), int(n) if n else 1])
    return out


class BookSeries:
    """A Revolut X book's snapshots, LIVE's own resting orders taken out (when $FP_LIVE is set), as-of readable.

    For each snapshot: the best bid/ask whose remaining size is at least `min_qty` coin, their sizes, the mid and the
    microprice (bid x ask size + ask x bid size over both sizes)."""

    def __init__(self, book, live=None, min_qty=50.0):
        self.book = book
        own = collections.defaultdict(list)   # (side, ticks) -> [(from, to, qty)]
        if live:
            for o in live:
                if o['mode'] != 'live' or o['book'] != book or o['state'] not in ('filled', 'cancelled') or o['leg'] == 'stop': continue
                end = o['filled_at'] or o['cancelled_at'] or o['updated_at']
                if end is None: continue
                q = o['base'] - (o['filled'] if o['state'] == 'cancelled' else 0.0)
                side = 'bid' if o['side'] == 'buy' else 'ask'
                own[(side, round(o['price'] / TICK))].append((o['ts'], end, q))
        self.own_n = sum(len(v) for v in own.values())
        T, U, BB, BA, BS, AS, MID, MIC, RB, RA = [], [], [], [], [], [], [], [], [], []
        removed = 0
        for l in _open(f'book_{book}.txt'):
            l = l.strip()
            if not l: continue
            t, su, bs, as_ = l.split('|')
            t, su = int(t), int(su)
            bids, asks = _levels(bs), _levels(as_)
            for side, lv in (('bid', bids), ('ask', asks)):
                for z in lv:
                    for (a, e, q) in own.get((side, round(z[0] / TICK)), ()):
                        if a <= t <= e:
                            z[1] -= q; removed += 1
            raw_b = bids[0][0] if bids else None
            raw_a = asks[0][0] if asks else None
            bb = next((z for z in bids if z[1] >= min_qty), None)
            ba = next((z for z in asks if z[1] >= min_qty), None)
            T.append(t); U.append(max(su, t)); RB.append(raw_b); RA.append(raw_a)
            # a touch over 100 bps wide is a book emptied (14 USDC-GBP snapshots, 13 of them 2026-10-08), not a price
            if bb and ba and bb[0] < ba[0] <= bb[0] * 1.01:
                BB.append(bb[0]); BA.append(ba[0]); BS.append(bb[1]); AS.append(ba[1])
                MID.append((bb[0] + ba[0]) / 2)
                MIC.append((bb[0] * ba[1] + ba[0] * bb[1]) / (bb[1] + ba[1]))
            else:
                BB.append(None); BA.append(None); BS.append(None); AS.append(None); MID.append(None); MIC.append(None)
        self.t, self.until, self.bb, self.ba, self.bs, self.as_, self.mid, self.micro = T, U, BB, BA, BS, AS, MID, MIC
        self.raw_bb, self.raw_ba = RB, RA
        self.removed = removed

    def idx(self, t):
        """The snapshot known at t (stamped at or before t, still fresh), or None."""
        i = bisect.bisect_right(self.t, t) - 1
        if i < 0 or t > self.until[i] + BOOK_FRESH_MS: return None
        return i

    def at(self, t, what='mid'):
        i = self.idx(t)
        if i is None: return None
        return getattr(self, what)[i]


class CbSeries:
    """Coinbase's touch for one book, as-of readable: mid and microprice."""

    def __init__(self, book):
        T, MID, MIC = [], [], []
        for l in _open(f'cb_{book}.txt'):
            l = l.strip()
            if not l: continue
            t, b, a, bs, as_ = l.split('|')
            b, a = float(b), float(a)
            if not (a > b > 0): continue
            T.append(int(t)); MID.append((a + b) / 2)
            bs, as_ = float(bs or 0), float(as_ or 0)
            MIC.append((b * as_ + a * bs) / (bs + as_) if bs + as_ > 0 else (a + b) / 2)
        self.t, self.mid, self.micro = T, MID, MIC

    def at(self, t, what='mid'):
        i = bisect.bisect_right(self.t, t) - 1
        if i < 0 or t - self.t[i] > CB_FRESH_MS: return None
        return getattr(self, what)[i]


def fair_series(mins, xhold_from=None):
    """{book: {t: (fair, x_used, fu, held)}}: the fair PR5's rule (and LIVE, on the held X inside closures) priced minute t
    at. `xhold_from` None: the held X applies at every closure minute (the weekend replica's rule)."""
    out = {}
    for b, rows in mins.items():
        d = {}
        last = None
        for t, x, fu, lag in rows:
            held = False
            if x: last = x
            elif closure(t) and last and (xhold_from is None or t >= xhold_from): x, held = last, True
            d[t] = (fu / x if (x and fu) else None, x, fu, held)
        out[b] = d
    return out


def fair_at(fs, b, t):
    """The fair of the paper minute that was decided by instant t: minute m is decided after m + 1 min."""
    m = (t - M) // M * M
    v = fs[b].get(m)
    return v[0] if v else None
