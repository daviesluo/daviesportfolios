# PER-BOOK, 2026-10-27 (docs/agents/reviews/2026-10-27-per-book-returns.md): each stablecoin book's STANDALONE return when it
# gets the whole capital, Revolut X's two and Coinbase's four, on the PR5-OPT replay's basis (sim.py: PR5's paper engine carried
# out by LIVE's executor, LIVE's "at" fill or "through", size-aware, the 24-hour stop, weekends quoted), and the two-venue
# portfolios Davies asked about (Revolut X USDT-GBP alone beside Coinbase's USDC books, and the reverse).
#
# Coinbase's books run on their own record (data_cb/, sql/cb_pulls.sql): the minute's fair as "with Euros - 2" holds it
# (cb_hold_minutes: the book's fair in its own currency, every minute, the rates held through a closure as LIVE's weekend
# rule does), and the aggressor prints of cb_trades summed by 30-second bucket, price and side (stamped mid-bucket, so the
# executor's turn at :30 sees the same side of each print). Coinbase's own constants (agents/cb_quotes.ts): its tick (USDT-EUR
# 0.00001), its taker fee 0.0045 % and each book's half-touch for a stop. A EUR book's rung is £100 in euros at the window's
# mean pounds per euro; its bps of capital are in euros. Coinbase's prints start 2026-10-16 10:53, so the common window is
# 2026-10-17 00:00 -> 10-27 00:00 (W10: ten days, two weekends); Revolut X is also run on its own records (FWD, HIST, LONG).
#   python3 -I scripts/per_book.py   (about five minutes)
import os, sys, json, gzip, collections, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sim, experiments as E, robust as R

ms = lambda y, m, d: int(datetime.datetime(y, m, d, tzinfo=datetime.timezone.utc).timestamp() * 1000)
W10 = (ms(2026, 10, 17), ms(2026, 10, 27))
K = (0.001, 0.002, 0.003)
CB = {'USDC-GBP': (1e-4, 0.0000662), 'USDT-GBP': (1e-4, 0.0000662), 'USDC-EUR': (1e-4, 0.000056), 'USDT-EUR': (1e-5, 0.0000112)}
CB_FEE = 0.000045
RX_CONST = (sim.TICK, sim.FEE, sim.HALF, list(sim.BOOKS))
DCB = os.path.join(sim.HERE, 'data_cb')


def load_cb():
    mins, xs = collections.defaultdict(list), collections.defaultdict(list)
    for l in gzip.open(os.path.join(DCB, 'cb_minutes.txt.gz'), 'rt'):
        l = l.strip()
        if not l: continue
        b, s, fair, x = l.split('|')
        mins[b].append((int(s) * 1000, 1.0, float(fair) if fair else None))
        if x: xs[b].append(float(x))
    for b in mins: mins[b].sort()
    raw = {}
    for b in CB:
        raw[b] = []
        for j, l in enumerate(gzip.open(os.path.join(DCB, f'cb_{b}.txt.gz'), 'rt')):
            l = l.strip()
            if not l: continue
            s, px, q, sd = l.split('|')
            raw[b].append((int(s) * 1000 + 15_000, float(px), float(q), sd, f'{s}-{j}'))
        raw[b].sort(key=lambda z: (z[0], z[4]))
    gbp_per_eur = sum(xs['USDC-EUR']) / len(xs['USDC-EUR'])
    return mins, raw, gbp_per_eur


def rx_consts():
    sim.TICK, sim.FEE, sim.HALF = RX_CONST[0], RX_CONST[1], RX_CONST[2]
    sim.BOOKS[:] = RX_CONST[3]


def rx_size(w_usdc, w_usdt, capital):
    raw = {(b, s, k): (w_usdc if b == 'USDC-GBP' else w_usdt) for b in RX_CONST[3] for s in ('bid', 'ask') for k in K}
    tot = sum(raw.values())
    return {key: capital * v / tot for key, v in raw.items()}


def measure(trips, cap, rec, marks, weekly=True):
    s, bps = E.summary(trips, cap, *rec, marks)
    days, _ = E.daily(trips, *rec)
    out = {k: s[k] for k in ('bpsDay', 'pctYear', 'trips', 'won', 'stops', 'perTripBps', 'worstDayBps', 'maxDrawdownBps', 'mtmWorstDayBps', 'mtmMaxDrawdownBps') if k in s}
    if weekly:
        wk = R.weekly(bps, days)
        out['worstWeekBps'] = round(min(wk.values()), 2); out['weeks'] = len(wk)
    return out, dict(zip(days, bps))


def run_rx(m_, p_, rec, w_usdc, w_usdt, capital, **kw):
    rx_consts()
    marks = {}
    tr, cap = sim.run(m_, p_, rec[0] - 2 * sim.DAY, rec[1], marks=marks, size=rx_size(w_usdc, w_usdt, capital), **kw)
    return measure(tr, cap, rec, marks)


def run_cb(book, mins, raw, rec, rung_gbp, gbp_per_eur, **kw):
    tick, half = CB[book]
    sim.TICK, sim.FEE, sim.HALF = tick, CB_FEE, half
    sim.BOOKS[:] = [book]
    prints = {book: [(ts, round(px / tick), q, sd, pid) for ts, px, q, sd, pid in raw[book]]}
    rung = rung_gbp / gbp_per_eur if book.endswith('EUR') else rung_gbp
    marks = {}
    tr, cap = sim.run({book: mins[book]}, prints, max(rec[0] - 2 * sim.DAY, raw[book][0][0]), rec[1], marks=marks,
                      size={(book, s, k): rung for s in ('bid', 'ask') for k in K}, **kw)
    res = measure(tr, cap, rec, marks)
    rx_consts()
    return res


def combo(parts):
    """A portfolio of standalone books: each part (result, capital GBP); its daily bps of the whole capital."""
    tot = sum(c for _, c in parts)
    days = sorted(parts[0][0][1])
    d = [sum(r[1][k] * c for r, c in parts) / tot for k in days]
    wk = R.weekly(d, days)
    return {'bpsDay': round(sum(d) / len(d), 3), 'worstDayBps': round(min(d), 2), 'worstWeekBps': round(min(wk.values()), 2),
            'parts': [round(r[0]['bpsDay'], 3) for r, _ in parts]}


if __name__ == '__main__':
    out = {'windows': {'W10': [E.iso(W10[0]), E.iso(W10[1])], 'FWD': [E.iso(E.FWD[0]), E.iso(E.FWD[1])],
                       'HIST': [E.iso(E.HIST[0]), E.iso(E.HIST[1])], 'LONG': [E.iso(E.LONG[0]), E.iso(E.LONG[1])]}}
    cmins, craw, gpe = load_cb()
    out['gbpPerEur'] = round(gpe, 5)
    fm, fp = sim.load_fwd()
    rx_consts()
    hm, hp = sim.load_hist(E.HIST[0] - 3 * sim.DAY, E.HIST[1])
    lm, lp = sim.load_hist(E.LONG[0] - 3 * sim.DAY, E.LONG[1])
    RXW = {'LIVE 1:1': (1, 1), 'USDT 2:1': (1, 2), 'USDT 3:1': (1, 3), 'USDT only': (0, 1), 'USDC only': (1, 0)}
    rx, keep = {}, {}
    for cap in (600, 300, 1200):
        for name, (wc, wt) in RXW.items():
            if cap != 600 and name not in ('USDT only', 'USDC only', 'LIVE 1:1'): continue
            for tag, m_, p_, rec, kw in [('W10_at', fm, fp, W10, {}), ('W10_through', fm, fp, W10, {'fill': 'through'}),
                                         ('FWD_at', fm, fp, E.FWD, {}), ('FWD_through', fm, fp, E.FWD, {'fill': 'through'}),
                                         ('HIST_at', hm, hp, E.HIST, {}), ('LONG_at', lm, lp, E.LONG, {})]:
                if cap != 600 and not tag.startswith('W10') and tag != 'FWD_at': continue
                r = run_rx(m_, p_, rec, wc, wt, cap, **kw)
                rx.setdefault(f'{name} £{cap}', {})[tag] = r[0]
                keep[(name, cap, tag)] = r
                print('RX', name, cap, tag, r[0])
    out['revolutX'] = rx
    cb = {}
    for book in CB:
        for rung in (100, 50):
            for tag, kw in [('W10_at', {}), ('W10_through', {'fill': 'through'})]:
                r = run_cb(book, cmins, craw, W10, rung, gpe, **kw)
                cb.setdefault(f'{book} £{rung} a rung (£{6 * rung})', {})[tag] = r[0]
                keep[(book, 6 * rung, tag)] = r
                print('CB', book, rung, tag, r[0])
    out['coinbase'] = cb
    # The two-venue portfolios against one venue on the same days and the same pounds in all: £600 (LIVE's capital, split
    # £300 + £300) and £1,200 (£600 a venue).
    P = {}
    for tag in ('W10_at', 'W10_through'):
        k_ = lambda name, cap: (keep[(name, cap, tag)], cap)
        P[tag] = {
            '£600: RX LIVE 1:1': combo([k_('LIVE 1:1', 600)]),
            '£600: RX USDT 3:1': combo([k_('USDT 3:1', 600)]),
            '£600: RX USDT only': combo([k_('USDT only', 600)]),
            '£600: RX USDT only £300 + CB USDC-GBP £300': combo([k_('USDT only', 300), k_('USDC-GBP', 300)]),
            '£600: RX USDC only £300 + CB USDT-GBP £300 (the reverse)': combo([k_('USDC only', 300), k_('USDT-GBP', 300)]),
            '£1,200: RX LIVE 1:1': combo([k_('LIVE 1:1', 1200)]),
            '£1,200: RX USDT only': combo([k_('USDT only', 1200)]),
            '£1,200: RX USDT only £600 + CB USDC-GBP £600': combo([k_('USDT only', 600), k_('USDC-GBP', 600)]),
            '£1,200: RX USDT only £600 + CB USDC-GBP £300 + USDC-EUR £300': combo([k_('USDT only', 600), k_('USDC-GBP', 300), k_('USDC-EUR', 300)]),
            '£1,200: RX USDT 3:1 £600 + CB USDC-GBP £600': combo([k_('USDT 3:1', 600), k_('USDC-GBP', 600)]),
            '£1,200: RX USDC only £600 + CB USDT-GBP £600 (the reverse)': combo([k_('USDC only', 600), k_('USDT-GBP', 600)]),
            '£1,200: RX USDT only £600 + CB USDT-GBP £600': combo([k_('USDT only', 600), k_('USDT-GBP', 600)]),
        }
        for k, v in P[tag].items(): print('P', tag, k, v)
    out['portfolios'] = P
    # The paper engines' own records by book (data_cb/engine_books.json), as bps of the book's own capital a day: six rungs of
    # £100 (Coinbase GBP), €100 (Coinbase EUR, counted in pounds at the window's pounds per euro) or $100 (PR5 on Revolut X).
    eng = json.load(open(os.path.join(DCB, 'engine_books.json')))['rows']
    span = {'cb_quote': 16, 'cb_hold': 14, 'rx_pr5': 16}
    out['engines'] = {f"{r['src']} {r['book']}": {
        'bpsDay': round(1e4 * float(r['pnl']) / ((600 * gpe) if r['book'].endswith('EUR') else 600) / span[r['src']], 2),
        'trips': r['trips'], 'bpsTrip': float(r['bps_trip']), 'days': span[r['src']],
        'worstDayBps': round(1e4 * float(r['worst_day']) / ((600 * gpe) if r['book'].endswith('EUR') else 600), 2)} for r in eng}
    for k, v in out['engines'].items(): print('E', k, v)
    json.dump(out, open(os.path.join(sim.HERE, 'results', 'per_book.json'), 'w'), indent=1, ensure_ascii=False)
