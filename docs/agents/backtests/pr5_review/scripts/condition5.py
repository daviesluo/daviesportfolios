# Condition 5's finding, the fix the review proposed ("a wider re-price step on volatile days"), designed and replayed on the
# four weeks before anything changes (Davies, 2026-10-21: "A，引擎也继续运行，但要确保模拟的真实性和实盘策略完全一致，不一致的地方就直接改";
# the paper engine's rule is frozen under QUEUE's freeze line and read by PR5V, QUEUE and PR5-W, so this is a DRAFT variant).
# The frozen simulator on the engine's own inputs (PR5-R (d)'s replay, the engine event for event) with only its re-price
# step replaced inside `simulate`, by a function of the UTC day's orders so far:
#   frozen     0.05 % always (the baseline, = the record)
#   const075   0.075 % always;   const100   0.10 % always
#   budget300  0.05 % until the BOOK's UTC day has 300 orders (the simulator runs one book at a time, so the budget is split:
#              two books × 300 = 600 a day, under the 700), 0.10 % from then to the day's end
#   budget250  the same from 250 a book
# Each under the frozen fill and under PR5-R (a)'s strict fill. Writes results/condition5.json.
#   python3 -I scripts/condition5.py
import sys, os, json, collections, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

VARIANTS = {'frozen': None, 'const075': (0.00075, None, None), 'const100': (0.001, None, None),
            'budget300': (0.0005, 300, 0.001), 'budget250': (0.0005, 250, 0.001)}


def patched(var, strict=False):
    src = open(C.FROZEN).read()
    if var is not None:
        base, at, wide = var
        a, z = src.index('def simulate('), src.index('def _close(')
        body = src[a:z]
        n = body.count('> REPRICE')
        assert n == 4, n
        body = body.replace('> REPRICE', '> _rp(orders_by_day[day])')
        hook = (f'def _rp(n):\n    return {wide!r} if n >= {at!r} else {base!r}\n\n\n' if at is not None else f'def _rp(n):\n    return {base!r}\n\n\n')
        src = src[:a] + hook + body + src[z:]
    # The patches of common.py apply to the source text; write it where `sim` can read it.
    tmp = os.path.join(C.stored_folder(), f'pr5_sim_{"x" if var is None else "_".join(map(str, var))}.py')
    open(tmp, 'w').write(src)
    old = C.FROZEN
    C.FROZEN = tmp
    try:
        return C.sim(C.SIZEFN, C.STRICT) if strict else C.sim(C.SIZEFN)
    finally:
        C.FROZEN = old


day = lambda t: datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime('%Y-%m-%d')
R = {'window': [C.iso(C.T0), C.iso(C.T1)], 'variants': {name: (None if v is None else {'base': v[0], 'from_orders': v[1], 'wide': v[2]}) for name, v in VARIANTS.items()}}
for name, var in VARIANTS.items():
    for strict in (False, True):
        P = patched(var, strict)
        books = C.rec_books(P)
        trips, orders = [], collections.Counter()
        for b in C.BOOKS:
            tr, od = P.simulate(books[b])
            trips += tr; orders.update(od)
        byday = {day(d * C.DAY): n for d, n in sorted(orders.items())}
        R.setdefault(name, {})['strict' if strict else 'frozen_fill'] = {
            **C.summ(trips), 'orders_total': sum(orders.values()), 'orders_max_day': max(orders.values()), 'max_day': day(max(orders, key=orders.get) * C.DAY),
            'days_over_700': sorted(d for d, n in byday.items() if n > 700), 'orders_2026-10-01': byday.get('2026-10-01'), 'by_day': byday}
        print(name, 'strict' if strict else 'frozen', {k: R[name]['strict' if strict else 'frozen_fill'][k] for k in ('trips', 'pnl_usd', 'orders_total', 'orders_max_day', 'max_day', 'days_over_700')})
C.dump('condition5.json', R)
