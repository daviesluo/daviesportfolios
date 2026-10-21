# PR5's four-week review (2026-10-21): what every script here shares.
#
# * The record (data/*.txt, sql/pull.sql), read into plain Python.
# * The frozen simulator, docs/agents/scripts/pr5/pr5_sim.py, imported as it is committed (its bytes are checked against
#   PR5's pre-registration sha256 by src/ tests; here they are only read). `sim(patches)` loads a COPY of its source with
#   named text patches applied, each asserted to apply exactly once:
#     EVENTS  records every order, refusal, withdrawal, fill, exit and stop the rule decides, as agent_quote_events
#             keeps them, so a replay can be compared event by event (PR5-R (d)). Recording only: no decision changes.
#     SIZEFN  lets `size` be a function of the minute's X (PR5-R (c): £50/12 a rung is a GBP size). Unchanged for a number.
#     STRICT  PR5-R (a)'s fill function: entries capped at the taking-side volume through them, exits filled in parts.
# * `stored_folder()` writes (to a temporary folder) the frozen simulator's input folder from the record (its own layout: trades/, fx/, candles/,
#   config.json), so condition 1 runs the frozen file on the stored prints, candles and FX, as the spec words it.
# * `RecBook`: the frozen `Book`'s fields filled from the engine's own minute records (PR5-R (d)).
import os, sys, json, gzip, bisect, collections, datetime, statistics as st, types, hashlib, tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
FROZEN = os.path.join(REPO, 'docs', 'agents', 'scripts', 'pr5', 'pr5_sim.py')
M, H, DAY = 60_000, 3_600_000, 86_400_000
TICK = 1e-4
BOOKS = ['USDC-GBP', 'USDT-GBP']
USD_OF = {'USDC-GBP': 'USDC-USD', 'USDT-GBP': 'USDT-USD'}


def ms(s):
    return int(datetime.datetime.fromisoformat(s).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)


T0, T1 = ms('2026-09-23T15:09'), ms('2026-10-21T15:09')      # the four weeks: [T0, T1)
REC_FROM = ms('2026-09-25T00:05')                             # the engine's minute records begin
DAYS = (T1 - T0) / DAY                                        # 28.0
iso = lambda t: datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime('%Y-%m-%d %H:%M')


def lines(name):
    p = os.path.join(HERE, 'data', name + '.txt')
    f = open(p) if os.path.exists(p) else gzip.open(p + '.gz', 'rt')
    for l in f:
        l = l.rstrip('\n')
        if l: yield l


def load_prints():
    """{book: [(ts, ticks, qty, side, id)]} in time order (then id), every stored print."""
    out = collections.defaultdict(list)
    for l in lines('prints'):
        pid, b, t, px, q, sd = l.split('|')
        out[b].append((int(t), round(float(px) / TICK), float(q), sd, pid))
    for b in out: out[b].sort(key=lambda p: (p[0], p[4]))
    return out


def load_inputs():
    """(fx {ms: value}, {usd_book: [(start_ms, close)]})."""
    fx, hours = {}, collections.defaultdict(list)
    for l in lines('inputs'):
        k, t, v = l.split('|')
        if k == 'fx': fx[int(t)] = float(v)
        else: hours[k.split(':', 1)[1]].append((int(t), float(v)))
    for k in hours: hours[k].sort()
    return fx, hours


def load_minutes():
    """{book: {ms: (x, fair_u, prints_n)}} from the engine's minute records."""
    out = collections.defaultdict(dict)
    for l in lines('minutes'):
        b, t, x, fu, pn = l.split('|')
        out[b][int(t)] = (float(x) if x else None, float(fu) if fu else None, int(pn) if pn else None)
    return out


def load_events():
    """[{book, minute, side, k, kind, ticks, d}] — every event but the book snapshots."""
    out = []
    for l in lines('events'):
        b, t, sd, k, kind, tk, d = l.split('|', 6)
        out.append({'book': b, 'minute': int(t), 'side': sd, 'k': float(k), 'kind': kind, 'ticks': int(tk) if tk else None, 'd': json.loads(d)})
    return out


TRIP_COLS = ['book', 'side', 'k', 't_entry', 'fill_ts', 'fill_print_id', 'entry', 'qty', 'x_entry', 'fair_entry', 'entry_oid', 't_exit', 'exit',
             'how', 'exit_print_id', 'exit_oid', 'notional_usd', 'pnl_usd']


def load_trips():
    out = []
    for l in lines('trips'):
        v = l.split('|')
        r = dict(zip(TRIP_COLS, v))
        for c in ('k', 'entry', 'qty', 'x_entry', 'notional_usd', 'pnl_usd', 'exit'): r[c] = float(r[c])
        r['fair_entry'] = float(r['fair_entry']) if r['fair_entry'] else None
        for c in ('t_entry', 'fill_ts', 't_exit'): r[c] = int(r[c])
        for c in ('entry_oid', 'exit_oid'): r[c] = int(r[c]) if r[c] else None
        out.append(r)
    return out


def window_trips(trips):
    """The test's round trips: entered in [T0, T1)."""
    return [t for t in trips if T0 <= t['t_entry'] < T1]


# ------------------------------------------------------------------ the frozen simulator, and patched copies of it

def frozen_sha():
    return hashlib.sha256(open(FROZEN, 'rb').read()).hexdigest()


EVENTS = [
    ('                    r["o"] = Order(r["side"], rt(f, r["k"], r["side"]), f, i + 1); r["mode"] = "quote"\n',
     '                    r["o"] = Order(r["side"], rt(f, r["k"], r["side"]), f, i + 1); r["mode"] = "quote"; _ev(B, i, r, "order", r["o"].price, leg="entry", what="place", fair=f, x=x)\n'),
    ('                    if not blocks(o.side, o.price, lp_turn[0]):\n                        o.live, o.state = i + 1, "pending"; orders_by_day[day] += 1\n                    continue\n',
     '                    if not blocks(o.side, o.price, lp_turn[0]):\n                        o.live, o.state = i + 1, "pending"; orders_by_day[day] += 1; _ev(B, i, r, "order", o.price, leg="entry", what="replace", fair=f, x=x)\n                    continue\n'),
    ('                    o.price, o.fair_at, o.live, o.state = rt(f, r["k"], r["side"]), f, i + 1, "pending"\n',
     '                    o.price, o.fair_at, o.live, o.state = rt(f, r["k"], r["side"]), f, i + 1, "pending"; _ev(B, i, r, "order", o.price, leg="entry", what="reprice", fair=f, x=x)\n'),
    ('                    if r["mode"] == "quote":\n                        r["mode"], r["o"] = "idle", None\n',
     '                    if r["mode"] == "quote":\n                        r["mode"], r["o"] = "idle", None; _ev(B, i, r, "withdraw", o.price)\n'),
    ('                        r["o"] = Order(xs, rt_exit(f, r["side"]), f, i + 1); orders_by_day[day] += 1\n',
     '                        r["o"] = Order(xs, rt_exit(f, r["side"]), f, i + 1); orders_by_day[day] += 1; _ev(B, i, r, "order", r["o"].price, leg="exit", what="place", fair=f, x=x)\n'),
    ('                    if not blocks(o.side, o.price, lp_turn[0]):\n                        o.live, o.state = i + 1, "pending"; orders_by_day[day] += 1\n                elif',
     '                    if not blocks(o.side, o.price, lp_turn[0]):\n                        o.live, o.state = i + 1, "pending"; orders_by_day[day] += 1; _ev(B, i, r, "order", o.price, leg="exit", what="replace", fair=f, x=x)\n                elif'),
    ('                    o.price, o.fair_at, o.live, o.state = rt_exit(f, r["side"]), f, i + 1, "pending"\n',
     '                    o.price, o.fair_at, o.live, o.state = rt_exit(f, r["side"]), f, i + 1, "pending"; _ev(B, i, r, "order", o.price, leg="exit", what="reprice", fair=f, x=x)\n'),
    ('                    o.state = "rejected" if blocks(o.side, o.price, lp_live[0]) else "live"\n',
     '                    o.state = "rejected" if blocks(o.side, o.price, lp_live[0]) else "live"\n                    if o.state == "rejected": _ev(B, i, r, "refused", o.price)\n'),
    ('                        r.update(mode="position", o=None, entry=p, t_e=t, i_e=i, qty=nq / p, nq=nq, fill_ts=ts)\n',
     '                        _ev(B, i, r, "fill", o.price, ts=ts, usd=usd, x=lastX)\n                        r.update(mode="position", o=None, entry=p, t_e=t, i_e=i, qty=nq / p, nq=nq, fill_ts=ts)\n'),
    ('                        px = o.price * TICK\n                        _close(r, trips, B.book, t, px, "maker", lastX)\n',
     '                        px = o.price * TICK\n                        _ev(B, i, r, "exit", o.price, ts=ts)\n                        _close(r, trips, B.book, t, px, "maker", lastX)\n'),
    ('                _close(r, trips, B.book, t, px, "taker", lastX)\n',
     '                _ev(B, i, r, "stop", B.last_at_or_before(t + M - 1), px=px)\n                _close(r, trips, B.book, t, px, "taker", lastX)\n'),
    ('def simulate(B, size=100.0,',
     'EV = None\n\n\ndef _ev(B, i, r, kind, ticks, **d):\n    if EV is not None:\n        EV.append({"book": B.book, "minute": B.t0 + i * M, "side": r["side"], "k": r["k"], "kind": kind, "ticks": ticks, "d": d})\n\n\ndef simulate(B, size=100.0,'),
]

SIZEFN = [
    ('                        usd = size if full else min(size, 0.10 * B.qvol[i] * lastX)\n',
     '                        sz = size(lastX) if callable(size) else size\n                        usd = sz if full else min(sz, 0.10 * B.qvol[i] * lastX)\n'),
]

# PR5-R (a): the fill function replaced, nothing else. An entry fills on the first print strictly through it, capped at
# the base quantity of the prints through it ON THE TAKING SIDE from that print to the end of the minute (a cap of zero
# is no fill on that print: the next is tried); an exit fills in parts, each taking-side print through it filling the
# smaller of its quantity and what is left, each part at its own minute's X; the 24-hour stop closes what is left.
STRICT = [
    ('                    if r["mode"] == "quote":\n                        if not lastX:\n                            continue\n',
     '                    if r["mode"] == "quote":\n                        if not lastX:\n                            continue\n'
     '                        cap = sum(q2 for ts2, pr2, q2, ag2 in ps if ts2 >= ts and through(o.side, o.price, pr2, thr) and ((o.side == "bid" and ag2 == "sell") or (o.side == "ask" and ag2 == "buy")))\n'
     '                        if cap <= 0:\n                            continue\n'),
    ('                        r.update(mode="position", o=None, entry=p, t_e=t, i_e=i, qty=nq / p, nq=nq, fill_ts=ts)\n',
     '                        qc = min(nq / p, cap)\n                        r.update(mode="position", o=None, entry=p, t_e=t, i_e=i, qty=qc, nq=qc * p, fill_ts=ts, left=qc, parts=[])\n'),
    ('                    elif r["mode"] == "position":\n                        px = o.price * TICK\n',
     '                    elif r["mode"] == "position":\n'
     '                        if not ((o.side == "bid" and aggr == "sell") or (o.side == "ask" and aggr == "buy")):\n                            continue\n'
     '                        take = min(qty, r["left"]); r["left"] -= take; r["parts"].append((take, o.price * TICK, lastX))\n'
     '                        if r["left"] > 1e-12:\n                            continue\n'
     '                        px = o.price * TICK\n'),
    ('def _close(r, trips, book, t, px, how, lastX):\n    pnl_q = r["qty"] * (px - r["entry"]) if r["side"] == "bid" else r["qty"] * (r["entry"] - px)\n    xr = lastX or 1.0\n',
     'def _close(r, trips, book, t, px, how, lastX):\n'
     '    parts = list(r.get("parts") or [])\n'
     '    if r.get("left", 0) > 1e-12 or not parts: parts.append((r.get("left", r["qty"]) if parts or "left" in r else r["qty"], px, lastX))\n'
     '    sg = 1 if r["side"] == "bid" else -1\n'
     '    pnl_usd = sum(q * sg * (p - r["entry"]) * (xx or 1.0) for q, p, xx in parts)\n'
     '    pnl_q = pnl_usd / (lastX or 1.0)\n'
     '    xr = lastX or 1.0\n'
     '    px = sum(q * p for q, p, xx in parts) / max(1e-12, sum(q for q, p, xx in parts))\n'
     '    how = how if len(parts) == 1 else (how + "+parts")\n'),
]


def sim(*patch_sets, data=None):
    """The frozen simulator's source with the given patches applied, loaded as a fresh module (PR5_DATA = `data`)."""
    src = open(FROZEN).read()
    for ps in patch_sets:
        for old, new in ps:
            n = src.count(old)
            assert n == 1, f'a patch applies {n} times: {old[:80]!r}'
            src = src.replace(old, new)
    if data: os.environ['PR5_DATA'] = data
    elif 'PR5_DATA' not in os.environ: os.environ['PR5_DATA'] = stored_folder()
    mod = types.ModuleType('pr5_sim_copy')
    mod.__file__ = FROZEN
    exec(compile(src, FROZEN + ' (patched copy)', 'exec'), mod.__dict__)
    return mod


_STORED = None


def stored_folder():
    """The frozen simulator's input folder, written from the record: the stored prints, hourly candles and minute FX."""
    global _STORED
    if _STORED: return _STORED
    out = _STORED = tempfile.mkdtemp(prefix='pr5_review_stored_inputs_')       # written fresh each run, never committed
    marker = os.path.join(out, 'config.json')
    for d in ('trades', 'fx', 'candles'): os.makedirs(os.path.join(out, d), exist_ok=True)
    prints = load_prints()
    for b in BOOKS:
        with gzip.open(os.path.join(out, 'trades', f'{b}.jsonl.gz'), 'wt') as f:
            for t, pt, q, sd, pid in prints[b]:
                f.write(json.dumps({'id': pid, 'price': f'{pt * TICK:.4f}', 'qty': repr(q), 'region': 'UK', 'side': sd, 'ts': t}) + '\n')
    fx, hours = load_inputs()
    with gzip.open(os.path.join(out, 'fx', 'series_STORED.json.gz'), 'wt') as f:
        json.dump(sorted(fx.items()), f)
    for u, rows in hours.items():
        with gzip.open(os.path.join(out, 'candles', f'{u}_60.json.gz'), 'wt') as f:
            json.dump({'rows': [{'start': t, 'close': v} for t, v in rows]}, f)
    json.dump({'fair_proxy': 'F3', 'fx': 'STORED'}, open(marker, 'w'))
    return out


class RecBook:
    """The frozen `Book`'s fields for [t0, t1) with X and fairU as the ENGINE decided them (PR5-R (d)): its minute records
    from 2026-09-25 00:05; before, or where a minute has no record, the stored inputs with the engine's one-candle lag."""
    def __init__(self, P, book, t0, t1, prints, fx, hours, minutes):
        self.book, self.t0, self.t1 = book, t0, t1
        self.n = (t1 - t0) // M
        pr = [(t, pt, q, sd) for t, pt, q, sd, pid in prints[book]]
        self.all_prints, self.pts = pr, [p[0] for p in pr]
        self.by_min = collections.defaultdict(list)
        for p in pr:
            if t0 <= p[0] < t1: self.by_min[(p[0] - t0) // M].append(p)
        self.qvol = {i: sum(q * pt * TICK for ts, pt, q, s in ps) for i, ps in self.by_min.items()}
        fxt = sorted(fx)
        ht = [h[0] for h in hours[USD_OF[book]]]; hc = [h[1] for h in hours[USD_OF[book]]]
        rec = minutes.get(book, {})
        self.X, self.F, self.source, self.unrecorded = [None] * self.n, [None] * self.n, [None] * self.n, []
        self.prints_mismatch = []
        for i in range(self.n):
            t = t0 + i * M
            r = rec.get(t)
            if r is not None and t >= REC_FROM:
                x, u = r[0], r[1]
                self.source[i] = 'record'
                if r[2] is not None and r[2] != len(self.by_min.get(i, ())): self.prints_mismatch.append((t, r[2], len(self.by_min.get(i, ()))))
            else:
                if t >= REC_FROM: self.unrecorded.append(t)
                k = bisect.bisect_right(fxt, t - M) - 1
                x = fx[fxt[k]] if k >= 0 and fxt[k] >= t - 10 * M else None
                top = (t // H) * H - (H if (t // M) % 60 == 59 else 2 * H)       # the engine's lag: the newest close only at :59
                a, z = bisect.bisect_left(ht, t - DAY), bisect.bisect_right(ht, top)
                u = st.median(hc[a:z]) if z > a else None
                self.source[i] = 'approx'
            self.X[i] = x
            self.F[i] = (u / x) if (x and u) else None

    def last_before(self, t_ms):
        k = bisect.bisect_left(self.pts, t_ms) - 1
        return None if k < 0 else (self.all_prints[k][1], self.all_prints[k][3])

    def last_at_or_before(self, t_ms):
        k = bisect.bisect_right(self.pts, t_ms) - 1
        return self.all_prints[k][1] if k >= 0 else None


def rec_books(P, t0=T0, t1=T1):
    prints = load_prints(); fx, hours = load_inputs(); minutes = load_minutes()
    return {b: RecBook(P, b, t0, t1, prints, fx, hours, minutes) for b in BOOKS}


def summ(trips, days=DAYS):
    pnl = sum(t['pnl_usd'] for t in trips)
    return {'trips': len(trips), 'pnl_usd': round(pnl, 4), 'pnl_usd_per_day': round(pnl / days, 4),
            'won': sum(1 for t in trips if t['pnl_usd'] > 0), 'taker_exits': sum(1 for t in trips if str(t['how']).startswith('taker'))}


def dump(name, obj):
    os.makedirs(os.path.join(HERE, 'results'), exist_ok=True)
    json.dump(obj, open(os.path.join(HERE, 'results', name), 'w'), indent=1, sort_keys=True)
    open(os.path.join(HERE, 'results', name), 'a').write('\n')
