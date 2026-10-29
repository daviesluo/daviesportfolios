"""Exness's public GBPUSD and EURUSD ticks, as the second-level FX of the speed backtest (FX-SPEED, 2026-10-29).

Source (keyless, no login): https://ticks.ex2archive.com/ticks/<PAIR>/<YYYY>/<MM>/Exness_<PAIR>_<YYYY>_<MM>.zip, one CSV of
ticks a month ("Exness","Symbol","Timestamp","Bid","Ask"; millisecond UTC stamps), the current month's file rewritten each
night (the October files read on 2026-10-29 07:54 UTC end at 2026-10-28 23:59:59.998). The zips stay outside the repository
(27 MB); `SHA256SUMS` beside this folder's data lists the four read, and `build` writes the one derived file the replays use,
committed: for every minute m of the window and each offset s, the mid of the last tick at or before m + s seconds, and how
old that tick was.

    EXN_DIR=<folder with the four zips> python3 -I exness.py build ../data/exness_offsets.txt.gz

A value is None when the last tick is more than `STALE_MS` old (the market closed, or a gap): the replays then keep the
engine's own rate for that minute.
"""
import bisect, csv, gzip, io, os, sys, zipfile, datetime

M = 60_000
PAIRS = ("GBPUSD", "EURUSD")
MONTHS = ((2026, 9), (2026, 10))
OFFSETS = (0, 15, 25, 28, 30, 45, 50, 55, 58)   # seconds into the minute
STALE_MS = 10 * M
T0 = int(datetime.datetime(2026, 9, 20, tzinfo=datetime.timezone.utc).timestamp() * 1000)
T1 = int(datetime.datetime(2026, 10, 29, tzinfo=datetime.timezone.utc).timestamp() * 1000)


def ticks(pair, exn_dir):
    """([ms], [mid]) of every tick of the two months, sorted; a tick whose ask is below its bid is dropped (none were)."""
    ts, mids = [], []
    for y, m in MONTHS:
        name = f"Exness_{pair}_{y}_{m:02d}"
        with zipfile.ZipFile(os.path.join(exn_dir, name + ".zip")) as z:
            with z.open(name + ".csv") as f:
                r = csv.reader(io.TextIOWrapper(f, "utf-8"))
                next(r)
                for row in r:
                    t = int(datetime.datetime.fromisoformat(row[2].replace("Z", "+00:00")).timestamp() * 1000)
                    bid, ask = float(row[3]), float(row[4])
                    if ask < bid:
                        continue
                    ts.append(t); mids.append((bid + ask) / 2)
    order = sorted(range(len(ts)), key=ts.__getitem__)
    return [ts[i] for i in order], [mids[i] for i in order]


def build(out_path, exn_dir):
    with gzip.open(out_path, "wt") as out:
        out.write("pair\tminute\t" + "\t".join(f"mid_{s}\tage_{s}" for s in OFFSETS) + "\n")
        for pair in PAIRS:
            ts, mids = ticks(pair, exn_dir)
            print(pair, len(ts), "ticks", ts[0], ts[-1], file=sys.stderr)
            for m in range(T0, T1, M):
                cells = []
                for s in OFFSETS:
                    at = m + s * 1000
                    k = bisect.bisect_right(ts, at) - 1
                    if k < 0 or at - ts[k] > STALE_MS:
                        cells += ["-", "-"]
                    else:
                        cells += [f"{mids[k]:.6f}", str(at - ts[k])]
                out.write(f"{pair}\t{m // M}\t" + "\t".join(cells) + "\n")


class Offsets:
    """The derived file, read back: `mid(pair, minute_ms, s)` and `age(...)`; None where the file has none."""

    def __init__(self, path):
        self.v = {}
        with gzip.open(path, "rt") as f:
            next(f)
            for l in f:
                p = l.rstrip("\n").split("\t")
                vals = p[2:]
                self.v[(p[0], int(p[1]) * M)] = [(None if vals[2 * i] == "-" else float(vals[2 * i]),
                                                   None if vals[2 * i + 1] == "-" else int(vals[2 * i + 1])) for i in range(len(OFFSETS))]

    def mid(self, pair, minute_ms, s):
        r = self.v.get((pair, minute_ms))
        return None if r is None else r[OFFSETS.index(s)][0]

    def at(self, pair, t_ms):
        """The mid at instant t (which must be a minute plus one of OFFSETS seconds)."""
        m = t_ms // M * M
        return self.mid(pair, m, (t_ms - m) // 1000)


if __name__ == "__main__":
    if sys.argv[1] == "build":
        build(sys.argv[2], os.environ["EXN_DIR"])
