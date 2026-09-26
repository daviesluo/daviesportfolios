"""PR6's layer over PR5's frozen simulator: 0 % maker quotes at par on Revolut X's UK USDC-USD and USDT-USD books.

Pre-registered in docs/agents/reviews/2026-09-26-pr6-revx-usd-par-prereg.md (frozen on main by 714a71c0; sha256
45e69d0d4c4d0669cdfaac824d543dcac39d7e940e0c9f6631ca405fb5426a54). PR5's `simulate()` and `exit_only()` run as they
are, imported from docs/agents/scripts/pr5/pr5_sim.py. This file supplies only the three things the pre-registration
lets it supply:
* the book object those functions read: the book's UK prints by minute, each minute's USD volume, X = 1 in every
  minute, fair = 1.0000 or none under the de-peg guard, and PR5's own last-print look-ups;
* the rungs, 1, 2 and 3 ticks from par, as the fractions 0.0001, 0.0002 and 0.0003 (PR5's module constant RUNGS);
* each book's half spread for the 24-hour stop (PR5's module constant HALF_SPREAD): half the widest touch seen before
  the freeze, 1 tick wide on USDC-USD and 4 ticks wide on USDT-USD.
The two constants are module globals that PR5's functions read when they run, so `use_book` sets them for the book
before every call.
"""
import datetime
import gzip
import hashlib
import json
import os
import sys

sys.dont_write_bytecode = True                   # importing PR5's module must leave no cache in its folder
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
PR5_DIR = os.path.join(REPO, "docs", "agents", "scripts", "pr5")
if PR5_DIR not in sys.path:
    sys.path.insert(0, PR5_DIR)
import pr5_sim as P  # noqa: E402  PR5's frozen simulator, unchanged

M, DAY, TICK = P.M, 86400000, P.TICK
BOOKS = ["USDC-USD", "USDT-USD"]
PAR = 10000                                      # 1.0000 in ticks of 0.0001
GUARD_TICKS = 30                                 # a last print more than 30 ticks (30 bps) from par darkens the minute
RUNGS = [0.0001, 0.0002, 0.0003]                 # 1, 2 and 3 ticks from par
HALF_SPREAD = {"USDC-USD": 0.00005, "USDT-USD": 0.0002}
INPUTS = os.path.join(HERE, "inputs")


def ms(s):
    return int(datetime.datetime.fromisoformat(s).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)


PRIMARY_START = {"USDC-USD": ms("2025-11-27T00:00"), "USDT-USD": ms("2025-12-17T00:00")}
WHOLE_START = ms("2025-09-26T00:00")
END = ms("2026-09-26T00:00")


def use_book(book):
    """Set the two PR5 module constants this layer supplies, for `book`."""
    P.RUNGS = RUNGS
    P.HALF_SPREAD = HALF_SPREAD[book]


def read_input(sym, folder=INPUTS):
    """The bytes of a committed print file (gzipped JSON lines) once decompressed, and their sha256."""
    with gzip.open(os.path.join(folder, f"{sym}.jsonl.gz"), "rb") as f:
        raw = f.read()
    return raw, hashlib.sha256(raw).hexdigest()


def parse_prints(raw):
    """PR5's `load_prints` on these bytes: (ts, ticks, qty, side) for every UK print, in time order (a stable sort,
    so prints that share a millisecond keep the file's order, which is by id)."""
    out = []
    for line in raw.decode("utf-8").splitlines():
        r = json.loads(line)
        if r["region"] != "UK":
            continue
        pt = round(float(r["price"]) / TICK)
        assert abs(pt * TICK - float(r["price"])) < 1e-9, r
        out.append((r["ts"], pt, float(r["qty"]), r["side"]))
    out.sort(key=lambda x: x[0])
    return out


def dark(ticks):
    """The de-peg guard's test on the last print: more than 30 bps from par."""
    return abs(ticks - PAR) > GUARD_TICKS


class ParBook:
    """What PR5's `simulate()` and `exit_only()` read, for one USD book over [t0, t1): PR5's `Book` with X = 1 and fair
    = 1.0000, except that a minute whose last print before it is more than 30 bps from par has no fair value (the
    guard). `guard=False` is the descriptive arm without the guard. The minute table is a plain dict, so a look-up of a
    minute without prints fails loudly instead of adding an empty minute."""
    last_before = P.Book.last_before
    last_at_or_before = P.Book.last_at_or_before

    def __init__(self, book, prints, t0, t1, guard=True):
        self.book, self.t0, self.t1, self.guard = book, t0, t1, guard
        self.n = (t1 - t0) // M
        self.all_prints = prints
        self.pts = [p[0] for p in prints]
        by_min = {}
        for p in prints:
            if t0 <= p[0] < t1:
                by_min.setdefault((p[0] - t0) // M, []).append(p)
        self.by_min = by_min
        self.qvol = {i: sum(q * pt * TICK for ts, pt, q, s in ps) for i, ps in by_min.items()}
        self.X = [1.0] * self.n
        self.F = [1.0] * self.n
        if guard:
            k = 0
            for i in range(self.n):
                t = t0 + i * M
                while k < len(prints) and prints[k][0] < t:
                    k += 1
                if k and dark(prints[k - 1][1]):
                    self.F[i] = None


def simulate(B, **kw):
    """PR5's `simulate()` on a ParBook, with this book's constants."""
    use_book(B.book)
    return P.simulate(B, **kw)


def exit_only(B, i0, side, usd, lastX0=1.0):
    """PR5's `exit_only()` on a ParBook, with this book's constants."""
    use_book(B.book)
    return P.exit_only(B, i0, side, usd, lastX0)
