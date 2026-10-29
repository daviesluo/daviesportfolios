# REVX-FAIR addendum (2026-10-29): Revolut X's USDC-GBP mid as a Coinbase minute would read it, one row a minute.
#
# For the Coinbase mirror of the USDC-GBP lead (cb_mirror.ts): the turn at minute t reads the latest Revolut X snapshot of
# `agent_book_levels` stamped before t (data/book_USDC-GBP.txt.gz), if its `seen_until` is within 5 minutes of t; else none.
# Two mids: `raw`, the snapshot's own best bid and ask (LIVE's orders and all, what a production reader of the table sees),
# and `clean`, LIVE's resting orders taken out and the first level of >= 50 coin (fp_data.BookSeries; needs $FP_LIVE, else
# left empty). Writes data/rx_mid_USDC-GBP.txt: minute ms|raw mid|clean mid|age of the snapshot (t - ts, ms)|t - seen_until (ms),
# and prints the freshness the review quotes.
#   FP_LIVE=<live_orders pull> python3 -I scripts/cb_mirror_prep.py
import os, sys, bisect, statistics as st
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fp_data as D

M = D.M
B = 'USDC-GBP'


def main():
    live = D.load_live_orders()
    bs = D.BookSeries(B, live)
    t0 = D.ms(2026, 10, 9); t1 = D.END
    out = []; ages = []; since = []; n_none = 0; n = 0
    for t in range(t0, t1, M):
        n += 1
        i = bisect.bisect_right(bs.t, t - 1) - 1
        if i < 0 or t - bs.until[i] > 5 * M:
            n_none += 1; out.append(f'{t}|||||'); continue
        raw = (bs.raw_bb[i] + bs.raw_ba[i]) / 2 if (bs.raw_bb[i] and bs.raw_ba[i] and bs.raw_ba[i] > bs.raw_bb[i] and bs.raw_ba[i] <= bs.raw_bb[i] * 1.01) else None
        clean = bs.mid[i] if live else None
        ages.append((t - bs.t[i]) / 1000); since.append((t - bs.until[i]) / 1000)
        out.append(f"{t}|{'' if raw is None else round(raw, 6)}|{'' if clean is None else round(clean, 6)}|{t - bs.t[i]}|{t - bs.until[i]}")
    open(os.path.join(D.DATA, f'rx_mid_{B}.txt'), 'w').write('\n'.join(out) + '\n')
    q = lambda a: [round(x, 1) for x in st.quantiles(a, n=20)[::2]] if a else None
    print('minutes', n, 'no fresh snapshot', n_none, f'({100 * n_none / n:.2f} %)')
    print('age of the snapshot read, s, 5th..95th pct by 10', q(ages), 'median', round(st.median(ages), 1))
    print('t - seen_until, s', q(since), 'median', round(st.median(since), 1))


if __name__ == '__main__':
    main()
