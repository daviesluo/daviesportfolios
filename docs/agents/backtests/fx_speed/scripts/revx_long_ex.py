"""FX-SPEED-RX: GBP/USD at the instants the Revolut X engine needs, from the same Exness archives as FX-SPEED-LONG.

The PR5-OPT replay prices paper minute t, the paper call decides it 25 s into the next minute (t + 85 s, `QUOTES_START_MS`), and
LIVE's executor sends its orders about 30 s into that minute (production, 7 days to 2026-10-29: 1,584 orders a median 32.4 s
after `paper_live` = t + 60 s, 5 %–95 % 29.5–91 s; the replay rests them at t + 90 s). So this keeps, for every minute m, the
last Exness mid at or before m + s for s in OFFSETS: 28 (Yahoo's bar labelled m sits there), and 0, 22, 24, 27, 28, 30 of the
minute after the paper minute (t + 60, 82, 84, 87, 88, 90). Ten minutes without a tick: none.

    python3 -I revx_long_ex.py EXN_DIR OUT.txt.gz       (the zips `exness_long.py fetch` leaves, GBPUSD 2025-11 → 2026-10)

Format: `minute<TAB>ticks<TAB>` then each offset's mid in millionths or '-'. Not committed (its sha256 goes in MANIFEST_rx.json).
"""
import datetime, gzip, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import exness_long as EL  # noqa: E402

M = 60_000
MONTHS = [(2025, 11), (2025, 12)] + [(2026, m) for m in range(1, 11)]
OFFSETS = (0, 22, 24, 27, 28, 30)
FROM = int(datetime.datetime(2025, 11, 20, tzinfo=datetime.timezone.utc).timestamp() * 1000)
TO = int(datetime.datetime(2026, 10, 29, tzinfo=datetime.timezone.utc).timestamp() * 1000)


def build(d, out_path):
    import numpy as np
    prev = None
    with gzip.open(out_path, "wt", compresslevel=9) as out:
        out.write("minute\tn\t" + "\t".join(f"s{s}" for s in OFFSETS) + "\n")
        for y, mo in MONTHS:
            ts, mid, n, bad = EL.month_ticks("GBPUSD", y, mo, d)
            if prev is not None:
                ts, mid = np.concatenate(([prev[0]], ts)), np.concatenate(([prev[1]], mid))
            prev = (ts[-1], mid[-1])
            a = int(datetime.datetime(y, mo, 1, tzinfo=datetime.timezone.utc).timestamp() * 1000)
            ny, nm = (y + 1, 1) if mo == 12 else (y, mo + 1)
            b = int(datetime.datetime(ny, nm, 1, tzinfo=datetime.timezone.utc).timestamp() * 1000)
            mins = np.arange(max(a, FROM), min(b, TO), M, dtype="int64")
            print(y, mo, n, "ticks", bad, "dropped", file=sys.stderr, flush=True)
            if not len(mins):
                continue
            cnt = np.searchsorted(ts, mins + M, side="left") - np.searchsorted(ts, mins, side="left")
            cols = []
            for s in OFFSETS:
                at = mins + s * 1000
                k = np.searchsorted(ts, at, side="right") - 1
                kk = np.clip(k, 0, None)
                good = (k >= 0) & (at - ts[kk] <= EL.STALE_MS)
                cols.append(np.where(good, np.round(mid[kk] * 1e6), np.nan))
            for j, m in enumerate(mins):
                vals = ["-" if np.isnan(c[j]) else str(int(c[j])) for c in cols]
                if cnt[j] == 0 and all(v == "-" for v in vals):
                    continue
                out.write(f"{int(m) // M}\t{int(cnt[j])}\t" + "\t".join(vals) + "\n")


class RxEx:
    """`at(t_ms)` for t a minute plus one of OFFSETS seconds: the mid then, or None."""

    def __init__(self, path):
        self.v = {}
        with gzip.open(path, "rt") as f:
            next(f)
            for l in f:
                p = l.rstrip("\n").split("\t")
                self.v[int(p[0]) * M] = [None if c == "-" else int(c) / 1e6 for c in p[2:]]

    def at(self, t_ms):
        m = t_ms // M * M
        r = self.v.get(m)
        return None if r is None else r[OFFSETS.index((t_ms - m) // 1000)]


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2])
