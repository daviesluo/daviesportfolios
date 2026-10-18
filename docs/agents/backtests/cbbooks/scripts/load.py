# Load the pulls of sql/pull_*.sql (cut by grab.py into <raw dir>) into numpy arrays. Times are ms (books, RX) or s
# (Coinbase prints) since T0 = 2026-10-10T03:00:00Z. Prices are integers in each book's own step (USDT-EUR 0.00001, else
# 0.0001); Coinbase sizes in hundredths of a coin.
#
# SIDE (Deviation 1 of params.json): cb_trades.side is the AGGRESSOR's. Coinbase's API serves the maker's side and the recorder
# flips it on write (agents/cb_rec.ts lines 17-18 and 72); params.json's "conventions" line said the stored side was the
# maker's, which is wrong. Checked on the books: of prints within 3 s of a fresh read, those stored "buy" print at the ask
# 83-91 % of coins on the three one-tick books. So a stored "sell" (pulled as "s") is a seller hitting a resting BID.
import os, json
import numpy as np

T0_EPOCH = 1791601200                     # 2026-10-10T03:00:00Z
WIN_END_S = 8 * 86400                      # 2026-10-18T03:00:00Z
SPLIT_S = 4 * 86400                        # 2026-10-14T03:00:00Z: train before, test from
PRODUCTS = ["USDC-GBP", "USDT-GBP", "USDC-EUR", "USDT-EUR"]
TICK = {"USDC-GBP": 1e-4, "USDT-GBP": 1e-4, "USDC-EUR": 1e-4, "USDT-EUR": 1e-5}


def is_weekend(t_s):
    """Friday 21:00 to Sunday 21:00 UTC. T0 is Saturday 03:00, so the window's weekends are [0, 42 h) and [6 d 18 h, ...)."""
    t = np.asarray(t_s, dtype=float)
    return (t < 42 * 3600) | (t >= 6 * 86400 + 18 * 3600)


def half(t_s):
    return np.where(np.asarray(t_s) < SPLIT_S, "train", "test")


class Book:
    """One product's recorded rows: ts, seen_until, reads, best prices, and up to ten (price, size) levels a side."""

    def __init__(self, lines):
        n = len(lines)
        self.ts = np.zeros(n, dtype=np.int64); self.seen = np.zeros(n, dtype=np.int64); self.reads = np.zeros(n, dtype=np.int64)
        self.bpx = np.full((n, 10), -1, dtype=np.int64); self.bsz = np.zeros((n, 10), dtype=np.int64)
        self.apx = np.full((n, 10), -1, dtype=np.int64); self.asz = np.zeros((n, 10), dtype=np.int64)
        self.bn = np.zeros(n, dtype=np.int64); self.an = np.zeros(n, dtype=np.int64)
        for i, ln in enumerate(lines):
            head, bid, ask = ln.split(" | ")
            ts, seen, reads, b1, a1 = head.split()
            self.ts[i], self.seen[i], self.reads[i] = int(ts), int(seen), int(reads)
            bo, bs, bn = bid.split(); ao, as_, an = ask.split()
            b1, a1 = int(b1), int(a1)
            boff = [0] + ([int(x) for x in bo.split(",")] if bo != "-" else [])
            aoff = [0] + ([int(x) for x in ao.split(",")] if ao != "-" else [])
            bsz = [int(x) for x in bs.split(",")]; asz = [int(x) for x in as_.split(",")]
            for j, (o, s) in enumerate(zip(boff, bsz)): self.bpx[i, j] = b1 - o; self.bsz[i, j] = s
            for j, (o, s) in enumerate(zip(aoff, asz)): self.apx[i, j] = a1 + o; self.asz[i, j] = s
            self.bn[i], self.an[i] = int(bn), int(an)
        self.b1 = self.bpx[:, 0]; self.a1 = self.apx[:, 0]
        self.mid = (self.b1 + self.a1) / 2.0

    def at(self, t_ms):
        """Index of the row standing at t (the latest row with ts <= t), -1 before the first."""
        return np.searchsorted(self.ts, t_ms, side="right") - 1

    def size_at(self, i, side, px):
        """Displayed size at price px on a side in row i: the level's size, 0 if px is better than that side's best
        (the level is gone), None if px lies beyond the ten levels recorded."""
        P = self.bpx[i] if side == "b" else self.apx[i]
        S = self.bsz[i] if side == "b" else self.asz[i]
        if (side == "b" and px > P[0]) or (side == "s" and px < P[0]): return 0
        k = np.nonzero(P == px)[0]
        if k.size: return int(S[k[0]])
        valid = P[P >= 0]
        last = valid[-1]
        if (side == "b" and px < last) or (side == "s" and px > last): return None
        return 0                                   # inside the recorded range but no level at px: nothing displayed there


class Prints:
    """One product's prints summed by (second, price, aggressor side); `mb` is True where the MAKER was a bid (a seller hit it)."""

    def __init__(self, lines):
        n = len(lines)
        self.s = np.zeros(n, dtype=np.int64); self.px = np.zeros(n, dtype=np.int64)
        self.mb = np.zeros(n, dtype=bool); self.sz = np.zeros(n, dtype=np.int64); self.n = np.zeros(n, dtype=np.int64)
        for i, ln in enumerate(lines):
            s, px, sd, sz, k = ln.split()
            self.s[i], self.px[i], self.mb[i], self.sz[i], self.n[i] = int(s), int(px), sd == "s", int(sz), int(k)


def read_lines(path):
    with open(path) as f:
        return [ln for ln in f.read().split("\n") if ln]


def load_cb(raw):
    books, prints = {}, {}
    for p in PRODUCTS:
        lines = []
        for part in ("1", "2"):
            lines += read_lines(os.path.join(raw, f"books_{p}_{part}.txt"))
        books[p] = Book(lines)
        tl = []
        if os.path.exists(os.path.join(raw, f"trades_{p}.txt")):
            tl = read_lines(os.path.join(raw, f"trades_{p}.txt"))
        else:
            for part in ("1", "2"): tl += read_lines(os.path.join(raw, f"trades_{p}_{part}.txt"))
        prints[p] = Prints(tl)
    return books, prints


def load_rx(raw):
    """Revolut X: books (ts_ms, seen_ms, reads, bid, bid size, ask, ask size, depth5 bid/ask, prices in GBP), prints
    (ts_ms, price, qty, aggressor side), PR5's minutes (minute index, x, fair_u)."""
    out = {}
    for ln in read_lines(os.path.join(raw, "revx_books.txt")):
        if len(ln.split()) != 10: continue          # six reads in the window stored both sides empty: skipped
        b, ts, seen, reads, bp, bs, ap, as_, d5b, d5a = ln.split()
        out.setdefault(b, {"books": [], "prints": [], "minutes": []})["books"].append(
            (int(ts), int(seen), int(reads), float(bp), float(bs), float(ap), float(as_), float(d5b), float(d5a)))
    for ln in read_lines(os.path.join(raw, "revx_prints.txt")):
        b, ts, px, q, sd = ln.split()
        out[b]["prints"].append((int(ts), float(px), float(q), sd))
    for ln in read_lines(os.path.join(raw, "revx_minutes.txt")):
        b, mi, x, fu, pn = ln.split()
        out[b]["minutes"].append((int(mi), None if x == "-" else float(x), None if fu == "-" else float(fu), int(pn)))
    for b in out:
        bk = np.array(out[b]["books"], dtype=float)
        out[b]["bk"] = {"ts": bk[:, 0].astype(np.int64), "seen": bk[:, 1].astype(np.int64), "reads": bk[:, 2].astype(np.int64),
                        "bid": bk[:, 3], "bsz": bk[:, 4], "ask": bk[:, 5], "asz": bk[:, 6], "d5b": bk[:, 7], "d5a": bk[:, 8]}
    return out


def load_paper(raw):
    ev = []
    for ln in read_lines(os.path.join(raw, "paper_events.txt")):
        arm, book, epoch, side, k, kind, ticks, detail = ln.split("\t")
        ev.append({"arm": arm, "book": book, "t": int(epoch) - T0_EPOCH, "side": side, "k": float(k), "kind": kind,
                   "ticks": None if ticks == "-" else int(ticks), "detail": json.loads(detail)})
    trips = [json.loads(ln) for ln in read_lines(os.path.join(raw, "paper_trips.txt"))]
    return ev, trips
