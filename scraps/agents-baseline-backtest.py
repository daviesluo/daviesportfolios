#!/usr/bin/env python3
"""Baseline evidence for the agents feature, reproducible by hand.

Pulls two years of hourly candles for BTC/ETH/SOL from Coinbase Exchange
(public, keyless; 300 bars per page) and runs a handful of deliberately
simple long/flat rules at 1h, 4h and 1d, NET of Revolut X's costs:

    taker side = 9 bps fee + half the live spread
    maker side = 0 fee     + half the live spread (assumes the limit fills)

No look-ahead: a signal is computed on the CLOSED bar i and executed at the
OPEN of bar i+1. Costs are charged on every position change. Buy-and-hold
pays one taker entry.

The point of the table is the COST STRUCTURE, not the returns: the same
rule that is positive gross goes deeply negative at taker cost once it
trades more than ~0.3 times a day, and slow rules on 4h/1d bars keep
almost all of their gross. Two years, in-sample parameters — read
docs/agents/reference.md §3 for the caveats.

    python3 scraps/agents-baseline-backtest.py            # pull + run
    python3 scraps/agents-baseline-backtest.py --cached   # reuse ./scraps/.ohlcv
"""
import json, os, sys, time, datetime as dt, urllib.request

HALF_SPREAD = {'BTC-USD': 0.75e-4, 'ETH-USD': 1.05e-4, 'SOL-USD': 1.55e-4}  # measured 2026-09-20
TAKER = 9e-4
CACHE = os.path.join(os.path.dirname(__file__), '.ohlcv')


def fetch_hourly(prod, days=730):
    os.makedirs(CACHE, exist_ok=True)
    path = f'{CACHE}/{prod}_1h.json'
    if '--cached' in sys.argv and os.path.exists(path):
        return json.load(open(path))
    end = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
    cur = end - dt.timedelta(days=days)
    rows = {}
    while cur < end:
        nxt = min(cur + dt.timedelta(hours=300), end)
        url = (f'https://api.exchange.coinbase.com/products/{prod}/candles?granularity=3600'
               f'&start={cur.isoformat().replace("+00:00", "Z")}&end={nxt.isoformat().replace("+00:00", "Z")}')
        with urllib.request.urlopen(url, timeout=25) as r:
            for t, lo, hi, o, c, v in json.load(r):
                rows[t] = [t, o, hi, lo, c, v]
        cur = nxt
        time.sleep(0.12)
    out = [rows[k] for k in sorted(rows)]
    json.dump(out, open(path, 'w'))
    return out


def resample(rows, hours):
    out = []
    for i in range(0, len(rows) - hours + 1, hours):
        ch = rows[i:i + hours]
        out.append([ch[0][0], ch[0][1], max(r[2] for r in ch), min(r[3] for r in ch), ch[-1][4], sum(r[5] for r in ch)])
    return out


def sma(xs, n):
    out, s = [None] * len(xs), 0.0
    for i, x in enumerate(xs):
        s += x
        if i >= n:
            s -= xs[i - n]
        if i >= n - 1:
            out[i] = s / n
    return out


def simulate(bars, signal, cost_side):
    """signal(i) -> 1/0/None using bars[:i+1]; executed at bars[i+1] open."""
    eq, pos, peak, mdd, trades = 1.0, 0, 1.0, 0.0, 0
    for i in range(len(bars) - 1):
        want = signal(i)
        if want is None:
            want = pos
        nxt = bars[i + 1]
        if want != pos:
            eq *= (1 - cost_side)
            trades += 1
            pos = want
        if pos == 1:
            eq *= nxt[4] / nxt[1]                       # open -> close of bar i+1
            if i + 2 < len(bars):
                eq *= bars[i + 2][1] / nxt[4]           # close -> next open (held)
        peak = max(peak, eq)
        mdd = max(mdd, 1 - eq / peak)
    return eq - 1.0, mdd, trades


def rules_for(bars, hours):
    """Return (name, factory) pairs. A factory builds a FRESH rule closure, so
    a stateful rule (Donchian, RSI) starts flat on every simulation pass —
    the first draft shared one state dict across the gross / maker / taker
    passes and the second pass inherited the first pass's final position,
    which printed a maker return above the gross one on ETH daily."""
    closes = [b[4] for b in bars]
    rules = []
    for f, s in [(10, 50), (20, 100), (50, 200)]:
        fa, sl = sma(closes, f), sma(closes, s)
        rules.append((f'SMA {f}/{s} cross',
                      lambda fa=fa, sl=sl: (lambda i: None if fa[i] is None or sl[i] is None else int(fa[i] > sl[i]))))
    for n in ([168 // hours, 720 // hours] if hours < 24 else [7, 30]):
        rules.append((f'TS momentum {n}-bar',
                      lambda n=n: (lambda i: None if i < n else int(closes[i] > closes[i - n]))))

    def donchian_factory(up=55, dn=20):
        state = {'pos': 0}
        # Enter on a close above the PRIOR up-bar high, exit below the prior dn-bar low.
        def rule(i):
            if i < up:
                return None
            hi = max(b[2] for b in bars[i - up:i]); lo = min(b[3] for b in bars[i - dn:i])
            if state['pos'] == 0 and bars[i][4] > hi:
                state['pos'] = 1
            elif state['pos'] == 1 and bars[i][4] < lo:
                state['pos'] = 0
            return state['pos']
        return rule
    rules.append(('Donchian 55/20 breakout', donchian_factory))

    if hours == 1:
        gains = [0.0] + [max(closes[i] - closes[i - 1], 0) for i in range(1, len(closes))]
        losses = [0.0] + [max(closes[i - 1] - closes[i], 0) for i in range(1, len(closes))]
        ag, al = sma(gains, 14), sma(losses, 14)

        def rsi_factory():
            st = {'pos': 0}
            def rule(i):
                if ag[i] is None:
                    return None
                rsi = 100 - 100 / (1 + (ag[i] / al[i] if al[i] else 99))
                if st['pos'] == 0 and rsi < 30:
                    st['pos'] = 1
                elif st['pos'] == 1 and rsi > 55:
                    st['pos'] = 0
                return st['pos']
            return rule
        rules.append(('RSI(14) <30 buy / >55 exit', rsi_factory))
    return rules


def main():
    for prod in ['BTC-USD', 'ETH-USD', 'SOL-USD']:
        rows = fetch_hourly(prod)
        hs = HALF_SPREAD[prod]
        for hours, tf in [(1, '1h'), (4, '4h'), (24, '1d')]:
            bars = resample(rows, hours)
            days = (bars[-1][0] - bars[0][0]) / 86400
            bh = bars[-1][4] / bars[1][1] * (1 - TAKER - hs) - 1
            print(f'\n{prod} @ {tf}: {len(bars)} bars, {days:.0f} days   buy&hold (taker) {bh*100:+.1f}%')
            for name, make in rules_for(bars, hours):
                g, _, n = simulate(bars, make(), 0.0)
                m, mdd, _ = simulate(bars, make(), hs)
                t, _, _ = simulate(bars, make(), TAKER + hs)
                assert g >= m - 1e-9 >= t - 1e-9, (name, g, m, t)   # costs only ever subtract
                print(f'  {name:28} gross {g*100:+7.1f}%  maker {m*100:+7.1f}% (maxDD {mdd*100:3.0f}%)  taker {t*100:+7.1f}%   {n:4d} trades = {n/days:.2f}/day')
    print('\nRound trip on Revolut X: taker 2×(9 bps + half-spread) ≈ 19.5–21 bps; maker ≈ 1.5–3.1 bps if the limit fills.')
    print('Jev: $0.042 per million input tokens → a 1,000-token call is $0.000042; one call a minute is ≈ $0.06/day.')


if __name__ == '__main__':
    main()
