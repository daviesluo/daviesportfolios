"""TAKE: lift the touch when Revolut X's GBP stablecoin book rests through a rung of PR5's rule (reference §4 item 52).

In-sample and exploratory, on the recorded books (agent_book_levels, read on QUEUE's deviation 1). The rules the live
executor applies to a fill are ported from quotes.ts / quotes_live.ts / revx_sim.ts and keep their names:

  * A turn stands 85 s after the start of the paper minute T it carries out (the twins' :25 of the next minute), in every
    minute PR5's call ran (its beats from 2026-10-01 16:25; none in the stall 2026-10-02 12:17-14:12), on the fair PR5
    recorded for T and the last recorded book at or before the turn, read at most 90 s before it (query E).
  * An idle rung (book, side, k) whose take limit the touch has reached, on a minute the entry guards pass, sends a taker
    IOC at that limit for its pounds (`rungBase`). The limit is the stated principle's ("the rung itself": a take keeps,
    after its fee, at least the k its maker fill would keep), k + 0.09 % from fair; `RULES` holds the sensitivity's other
    limits (the rung's own price, and fixed margins of 5 / 10 / 15 bps over the fee). It fills against the NEXT recorded book (the first
    read after the turn, within 60 s), walking its levels up to the limit, less what this study's own takes already took
    from the same unchanged levels; nothing when no read came. 0.09 % fee, a buy's in the coin; pennies as the venue moves them.
  * It exits as PR5's rule exits a fill: a post-only at `exitTicks(f)` from the next turn (not placed while the book it
    meets crosses it), re-priced past 0.05 %, filled only by prints strictly through it by their quantity, cancelled by the
    dead-man three minutes after a missed turn; after 24 hours an IOC bounded at fair ± 50 bps against the recorded touch
    24 hours on (query M), else the last print's touch.
  * One position per rung, and none while PR5's paper rung holds a position of its own (variant-2's executor quotes no
    entry on a rung that holds). What is held at the end (2026-10-03 02:20 UTC) is marked at the last print.

  python3 study.py takes      # the takes' (book, minute) list that query M reads
  python3 study.py            # -> results.json (about 2 s)
  python3 study.py power      # the forward bar's power at 0 / 5 / 8 / 10 / 16 bps a trip
"""
import datetime
import gzip
import hashlib
import json
import math
import random
import statistics
import sys
from bisect import bisect_right
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
M, H, DAY = 60_000, 3_600_000, 86_400_000
TICK, FEE, REPRICE = 1e-4, 0.0009, 0.0005
DEPEG, USD_STALE, STOP_BOUND, STOP_RETRY, DEADMAN = 0.005, 2 * H, 0.005, H, 3 * M
STEP = "0.00001"
MIN_SIZE, MIN_QUOTE = 0.00001, 0.1
BOOKS = ["USDC-GBP", "USDT-GBP"]
USD = {"USDC-GBP": "USDC-USD", "USDT-GBP": "USDT-USD"}
RUNGS = [0.001, 0.002, 0.003]
TURN_OFFSET = 85_000
T0 = 1790447400000          # 2026-09-26 18:30 UTC: the first paper minute (the recorder began 18:16 / 18:26)
T1 = 1790992800000          # 2026-10-03 02:00 UTC: takes decide paper minutes before it
END = 1790994000000         # 2026-10-03 02:20 UTC: the simulation stops; what is held is marked at the last print
STALL = (1790943420000, 1790950320000)    # 2026-10-02 12:17 -> 14:12 UTC: no turn (QUOTES_NO_TURN)
BEATS = (1790871900000, 1790975280000)    # PR5's call's beats cover 2026-10-01 16:25 -> 10-02 21:08 UTC
SEED = 20261003


def iso(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime("%Y-%m-%d %H:%M")


# ------------------------------------------------------------------ the venue's and the rule's own arithmetic

def floor_to_step(x):
    return f"{math.floor(x / 1e-5 + 1e-9) * 1e-5:.5f}"


def ceil_to_step(x):
    return f"{math.ceil(round(x / 1e-5 * 1e6) / 1e6) * 1e-5:.5f}"


def quote_ticks(f, k, side):
    return math.floor(f * (1 - k) / TICK + 1e-9) if side == "bid" else math.ceil(f * (1 + k) / TICK - 1e-9)


def exit_ticks(f, side):
    return math.ceil(f / TICK - 1e-9) if side == "bid" else math.floor(f / TICK + 1e-9)


def stop_limit_ticks(f, side):
    return math.ceil(f * (1 - STOP_BOUND) / TICK - 1e-9) if side == "bid" else math.floor(f * (1 + STOP_BOUND) / TICK + 1e-9)


def hundredths(vside, n):
    return math.ceil(n * 100 - 1e-9) / 100 if vside == "buy" else math.floor(n * 100 + 1e-9) / 100


def taker_fee(vside, got, moved):
    return float(ceil_to_step(got * FEE)) if vside == "buy" else math.ceil(moved * FEE * 100 - 1e-9) / 100


def dust_base(price):
    return max(MIN_SIZE, MIN_QUOTE / price if price > 0 else 0)


def rung_base(gbp, price, vside):
    base = floor_to_step(gbp / price)
    if vside == "sell":
        up = ceil_to_step(gbp / price)
        pence = lambda b: math.floor(float(b) * price * 100 + 1e-9)
        if up != base and pence(up) > pence(base):
            base = up
    b = float(base)
    return base if b >= MIN_SIZE and b * price >= MIN_QUOTE else None


def penny_exit(vside, base, price, dust):
    b = float(base)
    n = b * price
    if not (b > 0 and price > 0) or abs(n * 100 - round(n * 100)) < 1e-6:
        return base
    pennies = math.floor(n * 100 + 1e-9)
    t_s = ceil_to_step(pennies / 100 / price) if vside == "sell" else floor_to_step(pennies / 100 / price)
    t = float(t_s)
    return base if not (t < b) or b - t > dust or not (t >= dust_base(price)) else t_s


def ioc(vside, size, limit, levels, taken=None):
    """revx_sim's IOC: the levels (ticks, qty) best first, up to the limit."""
    want, got, notional, used = size, 0.0, 0.0, []
    for px, q in sorted(levels, key=lambda l: l[0] if vside == "buy" else -l[0]):
        if want <= 1e-12 or (px > limit if vside == "buy" else px < limit):
            break
        q -= (taken or {}).get(px, 0.0)
        if q <= 1e-12:
            continue
        t = min(want, q)
        got += t
        notional += t * px * TICK
        want -= t
        used.append((px, t))
    got = round(got, 5)
    if got <= 0:
        return None
    moved = hundredths(vside, notional)
    return {"got": got, "notional": notional, "moved": moved, "fee": taker_fee(vside, got, moved), "used": used, "size": size}


# ------------------------------------------------------------------ inputs

def lvl(s):
    p, q = s.split(":")
    return (int(p), float(q))


def expand(rle):
    toks = []
    for r in [l for l in rle.split("\n") if l]:
        if "*" in r:
            t, c = r.rsplit("*", 1)
            toks += [t] * int(c)
        else:
            toks.append(r)
    out, prev = [], None
    for t in toks:
        if t.startswith("+"):
            head, lv = t[1:].split(":", 1) if ":" in t else (t[1:], None)
            b, tm, cb, ca, ev, _, plv = prev
            row = [b, str(int(tm) + int(head[:-1])), cb, ca, ev, head[-1], plv if lv is None else lv]
        else:
            row = t.split(",", 6)
        out.append(row)
        prev = row
    assert hashlib.md5("\n".join(",".join(r) for r in out).encode()).hexdigest() == "3741a0e76d7d6a20c13ff9a3cf53a2ff"
    return {("USDC-GBP" if b == "C" else "USDT-GBP", int(tm) * M): {"cbid": int(cb), "cask": int(ca), "ev": ev, "nflag": nf,
            "levels": [lvl(x) for x in lv.split("/")] if lv else []} for b, tm, cb, ca, ev, nf, lv in out}


def load():
    raw = (REPO / "docs/agents/backtests/twins/inputs/twins_inputs.json.gz").read_bytes()
    assert hashlib.sha256(raw).hexdigest() == "f9ff04901d1b787d55401dac49d7d9be2e6d6b30d997a1ce856cea165e8dffa3"
    files = json.loads(gzip.decompress(raw))["files"]        # rule D's file (d_struct.txt) is never read
    prints = defaultdict(dict)
    tail = (HERE / "inputs/tail_prints.txt").read_text().rstrip("\n")
    assert hashlib.md5(tail.encode()).hexdigest() == "368a06795577dff9febf86949e05c6ce"
    for l in files["prints.txt"].split("\n") + tail.split("\n"):
        if l:
            i, b, ms, p, q, s = l.split("|")
            prints[b][i] = (int(ms), round(float(p) / TICK), float(q), s, i)
    prints = {b: sorted(v.values()) for b, v in prints.items()}
    fair = {b: {} for b in BOOKS}
    for l in files["minutes.txt"].split("\n"):
        if l:
            b, ms, x, _, fu, _, _ = l.split("|")
            if b in fair and x and fu:
                fair[b][int(ms)] = float(fu) / float(x)
    rows = ["USDC-GBP|1790974800000|1.324012279510498|1", "USDT-GBP|1790974800000|1.324012279510498|0.9995"]
    for ms in range(1790974860000, 1790977140001, M):
        rows += [f"USDC-GBP|{ms}|1.324047327041626|1", f"USDT-GBP|{ms}|1.324047327041626|0.99955"]
    assert hashlib.md5("\n".join(rows).encode()).hexdigest() == "2134f4725752baf99e3cf37ae5df1c6c"   # query T's lit minutes
    for l in rows:
        b, ms, x, fu = l.split("|")
        fair[b][int(ms)] = float(fu) / float(x)
    hours = defaultdict(set)
    for l in files["inputs.txt"].split("\n"):
        if l.startswith("fair:"):
            kind, ms, v = l.split("|")
            hours[kind[5:]].add((int(ms), float(v)))
    for kind, ms, v in [("USDC-USD", 1790974800000, 0.9999), ("USDC-USD", 1790978400000, 0.9999), ("USDC-USD", 1790982000000, 1.0),
                        ("USDC-USD", 1790985600000, 1.0), ("USDT-USD", 1790974800000, 0.9996), ("USDT-USD", 1790978400000, 0.9996),
                        ("USDT-USD", 1790982000000, 0.9994), ("USDT-USD", 1790985600000, 0.9996)]:   # query T's hours
        hours[kind].add((ms, v))
    hours = {k: sorted(v) for k, v in hours.items()}
    paper, held = defaultdict(list), {}
    for l in files["pr5_events.tsv"].split("\n"):
        if not l:
            continue
        b, ms, side, k, kind, ticks, d = l.split("\t")
        key = (b, side, float(k))
        if kind == "fill":
            held[key] = (int(ms), int(ticks))
        elif kind in ("exit", "stop") and key in held:
            t0, et = held.pop(key)
            xt = int(ticks) if kind == "exit" else json.loads(d)["px"] / TICK
            paper[key].append((t0, int(ms), (xt - et) / et if side == "bid" else (et - xt) / et))
    for key, (t0, _) in held.items():
        paper[key].append((t0, END, 0.0))
    beats = set(json.loads(files["quotes_beats.json"]))
    events = expand((HERE / "inputs/events_rle.txt").read_text())
    pool_txt = (HERE / "inputs/null_pool.csv").read_text().rstrip("\n")
    assert hashlib.md5(pool_txt.encode()).hexdigest() == "e3732815a95498d9e8077150994b104b"
    pool = []
    for l in pool_txt.split("\n"):
        b, tm, cb, ca, nb, na = l.split(",")
        pool.append({"book": "USDC-GBP" if b == "C" else "USDT-GBP", "T": int(tm) * M, "cbid": int(cb), "cask": int(ca), "nb": lvl(nb), "na": lvl(na)})
    marks = {}
    mp = HERE / "inputs/markouts.csv"
    if mp.exists():
        txt = mp.read_text().rstrip("\n")
        for l in txt.split("\n"):
            b, tm, *v = l.split(",")
            marks[("USDC-GBP" if b == "C" else "USDT-GBP", int(tm) * M)] = [None if x == "" else float(x) for x in v]
    return prints, fair, hours, paper, beats, events, pool, marks


class World:
    def __init__(self, prints, fair, hours, paper, beats, events, marks):
        self.prints, self.fair, self.hours, self.paper, self.beats, self.events, self.marks = prints, fair, hours, paper, beats, events, marks
        self.pts = {b: [p[0] for p in prints[b]] for b in BOOKS}
        self.hts = {k: [h[0] for h in v] for k, v in hours.items()}

    def last_print(self, b, before):
        i = bisect_right(self.pts[b], before - 1)
        return self.prints[b][i - 1] if i else None

    def guards(self, b, T):
        """entryGuards (the stale and de-peg rules); a dark minute has no fair and no take."""
        f = self.fair[b].get(T)
        if f is None:
            return ["dark"]
        hs, i = self.hours[USD[b]], bisect_right(self.hts[USD[b]], T - H)
        out = []
        if not i or T - (hs[i - 1][0] + H) > USD_STALE:
            out.append("usd stale")
        else:
            window = [c for s, c in hs[:i] if s >= T - DAY]
            if window and abs(hs[i - 1][1] / statistics.median(window) - 1) > DEPEG:
                out.append("usd de-peg")
        lp = self.last_print(b, T + M)
        if lp and abs(lp[1] * TICK / f - 1) > DEPEG:
            out.append("gbp de-peg")
        return out

    def turns(self, stall=True):
        out = []
        for T in range(T0, END, M):
            m = T + M
            if stall and STALL[0] <= m < STALL[1]:
                continue
            if BEATS[0] <= m <= BEATS[1] and m not in self.beats:
                continue
            out.append((T, T + TURN_OFFSET))
        return out

    def paper_busy(self, b, side, k, at):
        return any(t0 <= at < t1 for t0, t1, _ in self.paper.get((b, side, k), []))

    def stop_book(self, b, opened, at, side):
        """The touch the 24-hour stop meets: the recorded one 24 hours after the take (query M), else the last print's."""
        m = self.marks.get((b, opened - TURN_OFFSET))
        if m and m[4] is not None and at - opened < DAY + 30 * M:
            return [(int(m[4]), m[5])] if side == "bid" else [(int(m[6]), m[7])]
        lp = self.last_print(b, at)
        if not lp:
            return []
        P = lp[1]
        return [(P - 1 if lp[3] == "buy" else P, float("inf"))] if side == "bid" else [(P if lp[3] == "buy" else P + 1, float("inf"))]


# ------------------------------------------------------------------ positions

def open_position(fill, side, at, T, f, k, null=False):
    avg = fill["notional"] / fill["got"]
    held, cash = (fill["got"] - fill["fee"], -fill["moved"]) if side == "bid" else (fill["got"], fill["moved"] - fill["fee"])
    return {"side": side, "k": k, "opened": at, "T": T, "held": held, "cash": cash, "notional": fill["moved"], "avg": avg, "exit": None,
            "exit_fair": f, "dust": dust_base(avg), "last_stop": None, "fair0": f, "null": null, "partial": fill["got"] < fill["size"] - 1e-9,
            "gap_bps": ((f - avg) / f if side == "bid" else (avg - f) / f) * 1e4}


def close(p, b, ts, how, px_ticks, trips):
    mark = px_ticks * TICK
    pnl = p["cash"] + (p["held"] * mark if p["side"] == "bid" else -p["held"] * mark)
    trips.append({"book": b, "side": p["side"], "k": p["k"], "entry": p["opened"], "T": p["T"], "exit": ts, "how": how, "pnl": pnl,
                  "notional": p["notional"], "bps": pnl / p["notional"] * 1e4, "entry_px": p["avg"], "fair0": p["fair0"],
                  "gap_bps": p["gap_bps"], "partial": p["partial"]})


def fill_exit(p, b, q, ts, trips):
    o = p["exit"]
    vside = "sell" if p["side"] == "bid" else "buy"
    before = o["moved"]
    o["filled"] = round(o["filled"] + q, 9)
    o["notional"] += q * o["ticks"] * TICK
    o["moved"] = hundredths(vside, o["notional"])
    p["cash"] += (o["moved"] - before) * (1 if vside == "sell" else -1)
    p["held"] -= q
    if o["filled"] >= float(o["size"]) - 1e-12:
        p["exit"] = None
    if p["held"] <= p["dust"] + 1e-12:
        close(p, b, ts, "maker", o["ticks"], trips)
        return True
    return False


def apply_print(positions, b, pr, trips):
    """A print fills every exit it goes strictly through, by its quantity, the best price first, then the earlier."""
    ts, px, q, _, _ = pr
    live = [(key, p) for key, p in positions.items() if key[0] == b and p["exit"] and p["exit"]["created"] < ts
            and (px > p["exit"]["ticks"] if p["side"] == "bid" else px < p["exit"]["ticks"])]
    live.sort(key=lambda kp: ((kp[1]["exit"]["ticks"] if kp[1]["side"] == "bid" else -kp[1]["exit"]["ticks"]), kp[1]["exit"]["created"]))
    full = q
    for key, p in live:
        avail = full if p["null"] else q                       # the null's positions are independent of each other
        t = min(float(p["exit"]["size"]) - p["exit"]["filled"], avail)
        if t > 1e-12:
            if not p["null"]:
                q -= t
            if fill_exit(p, b, t, ts, trips):
                del positions[key]


def manage(w, positions, key, p, b, T, at, f, g, trips):
    """Step 5 for one position: the 24-hour stop, else the exit placed or re-priced."""
    if at >= p["opened"] + DAY and (p["last_stop"] is None or at - p["last_stop"] >= STOP_RETRY):
        p["exit"] = None
        f0 = f if f is not None else (p["exit_fair"] or p["avg"])
        vside = "sell" if p["side"] == "bid" else "buy"
        lim = stop_limit_ticks(f0, p["side"])
        base = float(floor_to_step(max(0.0, p["held"])))
        fill = ioc(vside, base, lim, w.stop_book(b, p["opened"], at, p["side"])) if base >= dust_base(lim * TICK) else None
        p["last_stop"] = at
        if fill:
            if vside == "sell":
                p["held"] -= fill["got"]
                p["cash"] += fill["moved"] - fill["fee"]
            else:
                p["held"] -= fill["got"] - fill["fee"]
                p["cash"] -= fill["moved"]
            if p["held"] <= p["dust"] + 1e-9:
                close(p, b, at, "stop", fill["notional"] / fill["got"] / TICK, trips)
                del positions[key]
        return
    if f is None or at <= p["opened"]:
        return
    vside = "sell" if p["side"] == "bid" else "buy"
    if p["exit"] is not None:
        if "usd stale" in g or abs(f / p["exit_fair"] - 1) <= REPRICE:
            return
        p["exit"] = None                                                  # cancelled; its fills so far stay booked
    ticks = exit_ticks(f, p["side"])
    ev = w.events.get((b, T))
    if ev:
        crosses = ev["cbid"] >= ticks if vside == "sell" else ev["cask"] <= ticks
    else:                                                                 # no event minute: the last print's touch
        lp = w.last_print(b, at)
        crosses = lp is not None and ((lp[1] > ticks or (lp[1] == ticks and lp[3] == "sell")) if vside == "sell"
                                      else (lp[1] < ticks or (lp[1] == ticks and lp[3] == "buy")))
    base = floor_to_step(max(0.0, p["held"]))
    if crosses or float(base) < dust_base(ticks * TICK):
        return
    p["exit"] = {"ticks": ticks, "size": penny_exit(vside, base, ticks * TICK, p["dust"]), "filled": 0.0, "notional": 0.0, "moved": 0.0, "created": at}
    p["exit_fair"] = f


RULES = {
    # The rule (the stated principle, "the rung itself"): a take on rung k keeps at least k after its fee, what the maker
    # fill it stands in for keeps. Its limit is k + 0.09 % from fair: 19 / 29 / 39 bps.
    "rung + fee": lambda f, k, side: quote_ticks(f, k + FEE, side),
    # Sensitivity: the IOC at the rung's own price (k - 9 bps kept: 1 / 11 / 21), and a fixed margin over the fee.
    "rung price": lambda f, k, side: quote_ticks(f, k, side),
    "margin 5 bps": lambda f, k, side: (min if side == "bid" else max)(quote_ticks(f, k, side), quote_ticks(f, FEE + 0.0005, side)),
    "margin 10 bps": lambda f, k, side: (min if side == "bid" else max)(quote_ticks(f, k, side), quote_ticks(f, FEE + 0.0010, side)),
    "margin 15 bps": lambda f, k, side: (min if side == "bid" else max)(quote_ticks(f, k, side), quote_ticks(f, FEE + 0.0015, side)),
}
PRIMARY = "rung + fee"


def run(w, gbp, rule=PRIMARY, stall=True, null_entries=None):
    """The take rule over the span (or, with `null_entries`, one independent position per listed entry: the null)."""
    positions, trips, attempts = {}, [], []
    pi = {b: 0 for b in BOOKS}
    taken = {}
    last_turn = None
    by_T = defaultdict(list)
    for i, e in enumerate(null_entries or []):
        by_T[e["T"]].append((i, e))

    def prints_to(upto):
        for b in BOOKS:
            ps = w.prints[b]
            while pi[b] < len(ps) and ps[pi[b]][0] <= upto:
                apply_print(positions, b, ps[pi[b]], trips)
                pi[b] += 1

    for T, at in w.turns(stall):
        if last_turn is not None and at - last_turn > DEADMAN:           # the dead-man cancels every resting exit
            prints_to(last_turn + DEADMAN)
            for p in positions.values():
                p["exit"] = None
        prints_to(at)
        last_turn = at
        for b in BOOKS:
            f, ev = w.fair[b].get(T), w.events.get((b, T))
            g = w.guards(b, T)
            for key in [k2 for k2 in positions if k2[0] == b]:
                if key in positions:
                    manage(w, positions, key, positions[key], b, T, at, f, g, trips)
            if null_entries is not None:
                for i, e in by_T.get(T, []):
                    if e["book"] != b or g:
                        continue
                    vside = "buy" if e["side"] == "bid" else "sell"
                    lim = e["cask"] if e["side"] == "bid" else e["cbid"]
                    base = rung_base(gbp, lim * TICK, vside)
                    fill = ioc(vside, float(base), lim, [e["na"] if e["side"] == "bid" else e["nb"]]) if base else None
                    if fill:
                        positions[(b, "null", i)] = open_position(fill, e["side"], at, T, f, None, null=True)
                continue
            if not ev or f is None or g or T >= T1 or ev["nflag"] == "v":
                continue
            side = "bid" if ev["ev"] == "B" else "ask"
            for k in RUNGS:
                key = (b, side, k)
                if key in positions or w.paper_busy(b, side, k, at):
                    continue
                lim = RULES[rule](f, k, side)
                if (ev["cask"] > lim) if side == "bid" else (ev["cbid"] < lim):
                    continue
                vside = "buy" if side == "bid" else "sell"
                base = rung_base(gbp, lim * TICK, vside)
                lkey = tuple(ev["levels"])
                if taken.get((b, side), (None,))[0] != lkey:
                    taken[(b, side)] = (lkey, {})
                fill = ioc(vside, float(base), lim, ev["levels"], taken[(b, side)][1])
                attempts.append({"book": b, "side": side, "k": k, "T": T, "filled": bool(fill), "partial": bool(fill) and fill["got"] < float(base) - 1e-9})
                if fill:
                    for px, q in fill["used"]:
                        taken[(b, side)][1][px] = taken[(b, side)][1].get(px, 0.0) + q
                    positions[key] = open_position(fill, side, at, T, f, k)
    open_ = []
    for key, p in positions.items():
        lp = w.last_print(key[0], END)
        mark = lp[1] * TICK if lp else p["avg"]
        pnl = p["cash"] + (p["held"] * mark if p["side"] == "bid" else -p["held"] * mark)
        open_.append({"book": key[0], "side": p["side"], "k": p["k"], "entry": p["opened"], "T": p["T"], "pnl": pnl, "notional": p["notional"],
                      "bps": pnl / p["notional"] * 1e4, "gap_bps": p["gap_bps"], "fair0": p["fair0"], "entry_px": p["avg"], "null_i": key[2] if p["null"] else None})
    return sorted(trips, key=lambda t: t["entry"]), open_, attempts


# ------------------------------------------------------------------ readings

def summary(trips, open_=()):
    pnl, notional = sum(t["pnl"] for t in trips), sum(t["notional"] for t in trips)
    holds = sorted((t["exit"] - t["entry"]) / M for t in trips)
    allp = pnl + sum(o["pnl"] for o in open_)
    alln = notional + sum(o["notional"] for o in open_)
    return {"trips": len(trips), "won": sum(t["pnl"] > 0 for t in trips), "stops": sum(t["how"] == "stop" for t in trips),
            "pnl_gbp": round(pnl, 4), "bps_per_trip": round(pnl / notional * 1e4, 1) if notional else None,
            "hold_min_median": round(statistics.median(holds)) if holds else None, "hold_min_max": round(holds[-1]) if holds else None,
            "open": len(open_), "open_marked_gbp": round(sum(o["pnl"] for o in open_), 4),
            "with_open_gbp": round(allp, 4), "with_open_bps": round(allp / alln * 1e4, 1) if alln else None}


def group(trips, open_, key):
    keys = sorted({key(t) for t in list(trips) + list(open_)})
    return {k: summary([t for t in trips if key(t) == k], [o for o in open_ if key(o) == k]) for k in keys}


def displaced(w, trips, open_, gbp):
    """PR5's paper maker trips on a rung that a take held: variant-2's executor quotes no entry on a rung that holds."""
    lost = [x for t in list(trips) + list(open_) for x in w.paper.get((t["book"], t["side"], t["k"]), []) if t["entry"] <= x[0] < t.get("exit", END)]
    return {"trips": len(lost), "gbp": round(sum(x[2] for x in lost) * gbp, 4)}


def markouts(w, keys):
    """The book's mid and fair after an instant, in bps of fair, signed so that + is the take's way: mid_h the book moving
    back towards fair, fair_h fair moving away from the book; gap_h what is left of the gap (gap0 at the instant)."""
    rows = []
    for b, T, side, entry_px in keys:
        m, ev, f0 = w.marks.get((b, T)), w.events[(b, T)], w.fair[b][T]
        s = 1 if side == "bid" else -1
        mid0 = (ev["cbid"] + ev["cask"]) / 2 * TICK
        row = {"gap0": (f0 - mid0) / f0 * 1e4 * s}
        for j, h in enumerate((15, 60, 240, 1440)):
            if m is None or m[j] is None:
                continue
            midh, fh = m[j] / 2 * TICK, w.fair[b].get(T + h * M)
            row[f"mid_{h}"] = (midh - mid0) / f0 * 1e4 * s
            if fh is not None:
                row[f"fair_{h}"] = (fh - f0) / f0 * 1e4 * s
                row[f"gap_{h}"] = (fh - midh) / fh * 1e4 * s
            if entry_px:
                row[f"take_marked_{h}"] = (midh - entry_px) / entry_px * 1e4 * s - FEE * 1e4
        rows.append(row)
    out = {}
    for k in ["gap0"] + [f"{p}_{h}" for h in (15, 60, 240, 1440) for p in ("mid", "fair", "gap", "take_marked")]:
        v = [r[k] for r in rows if k in r]
        if v:
            out[k] = {"n": len(v), "mean": round(statistics.mean(v), 1), "median": round(statistics.median(v), 1)}
    return out


def power(mu_bps, sd_bps=15.0, rate=1.0, sims=1000, gbp=50, seed=7):
    """The forward bar's power (reviews/2026-10-03-take-prereg.md): takes at `rate` a weekday, each trip N(mu, sd) bps of
    £gbp; four weeks, extended a week at a time to eight until 15 trips; C2 and C3 (a day-block bootstrap's 5th
    percentile above zero). Returns the share of runs that pass."""
    rng, ok = random.Random(seed), 0
    for _ in range(sims):
        days, n = [], 0
        while True:
            for _ in range(5):
                k = sum(1 for _ in range(20) if rng.random() < rate / 20)
                n += k
                days.append(sum(rng.gauss(mu_bps, sd_bps) * gbp / 1e4 for _ in range(k)))
            if (len(days) >= 20 and n >= 15) or len(days) >= 40:
                break
        if n < 15 or sum(days) <= 0:
            continue
        bs = sorted(sum(rng.choice(days) for _ in range(len(days))) for _ in range(1000))
        ok += bs[49] > 0
    return ok / sims


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "power":
        print({mu: power(mu) for mu in (0, 5, 8, 10, 16)})
        return
    prints, fair, hours, paper, beats, events, pool, marks = load()
    w = World(prints, fair, hours, paper, beats, events, marks)
    rung = lambda t: f"{t['book']} {t['side']} {t['k'] * 100:.1f}%"
    if len(sys.argv) > 1 and sys.argv[1] == "takes":
        keys = set()
        for gbp in (50, 100):
            for rule in RULES:
                tr, op, _ = run(w, gbp, rule)
                keys |= {(t["book"], t["T"]) for t in tr + op}
        print(len(keys), ",".join(f"{'C' if b == 'USDC-GBP' else 'T'}{T // M}" for b, T in sorted(keys)))
        return
    res = {"rule": f"{PRIMARY}: a take on rung k sends an IOC limited at k + 0.09 % from fair (19 / 29 / 39 bps); sensitivity: {', '.join(r for r in RULES if r != PRIMARY)}",
           "span": f"paper minutes {iso(T0)} -> {iso(T1)} UTC, positions run to {iso(END)}",
           "event_rows": len(events),
           "event_rows_not_through_locally": sum(1 for (b, T), e in events.items() if fair[b].get(T) is None or not (
               e["cask"] <= quote_ticks(fair[b][T], 0.001, "bid") if e["ev"] == "B" else e["cbid"] >= quote_ticks(fair[b][T], 0.001, "ask")))}
    cnt = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    for (b, T), e in sorted(events.items()):
        f, side = fair[b][T], "bid" if e["ev"] == "B" else "ask"
        ok = not w.guards(b, T) and e["nflag"] != "v"
        for name in ("rung + fee", "rung price"):
            for k in RUNGS:
                lim = RULES[name](f, k, side)
                if (e["cask"] <= lim) if side == "bid" else (e["cbid"] >= lim):
                    cnt[name][f"{b} {side} {k * 100:.1f}%"][0 if ok else 1] += 1
    res["event_minutes"] = {n: {k: {"takeable": v[0], "guarded_or_no_next_read": v[1]} for k, v in sorted(c.items())} for n, c in cnt.items()}
    eps = []
    for b in BOOKS:
        for sd in ("B", "A"):
            ts = sorted(T for (bb, T), e in events.items() if bb == b and e["ev"] == sd)
            cur = []
            for T in ts + [None]:
                if cur and (T is None or T - cur[-1] > 10 * M):
                    deep = max(((fair[b][x] - events[(b, x)]["cask"] * TICK) if sd == "B" else (events[(b, x)]["cbid"] * TICK - fair[b][x])) / fair[b][x] * 1e4 for x in cur)
                    eps.append({"book": b, "side": "bid" if sd == "B" else "ask", "from": iso(cur[0]), "to": iso(cur[-1]), "minutes": len(cur), "deepest_bps": round(deep, 1), "T": cur[0]})
                    cur = []
                if T is not None:
                    cur.append(T)
    res["episodes"] = {"count": len(eps), "reaching_19bps": sum(e["deepest_bps"] >= 19 for e in eps), "list": [{k: v for k, v in e.items() if k != "T"} for e in eps]}
    lit = sorted({T for b in BOOKS for T in fair[b] if T0 <= T < T1})
    half = lit[len(lit) // 2]
    res["halves_split_at"] = iso(half)
    halves = lambda t: "1st" if t["T"] < half else "2nd"
    runs = {}
    for gbp in (50, 100):
        for stall in (True, False):
            tr, op, att = run(w, gbp, stall=stall)
            r = {"all": summary(tr, op), "ioc_sent": len(att), "ioc_unfilled": sum(not a["filled"] for a in att), "ioc_partial": sum(a["partial"] for a in att)}
            if stall:
                dis = displaced(w, tr, op, gbp)
                r.update({"maker_trips_displaced": dis, "net_of_displaced_gbp": round(r["all"]["with_open_gbp"] - dis["gbp"], 4),
                          "by_rung": group(tr, op, rung), "by_day": group(tr, op, lambda t: iso(t["entry"])[:10]), "halves": group(tr, op, halves),
                          "trips": [{"rung": rung(t), "entry": iso(t["entry"]), "exit": iso(t["exit"]), "how": t["how"], "gap_bps": round(t["gap_bps"], 1),
                                     "pnl_gbp": round(t["pnl"], 4), "bps": round(t["bps"], 1), "partial": t["partial"]} for t in tr],
                          "open": [{"rung": rung(o), "entry": iso(o["entry"]), "pnl_marked_gbp": round(o["pnl"], 4)} for o in op]})
            runs[f"gbp{gbp}" + ("" if stall else "_without_stall")] = r
    res["rule_runs"] = runs
    sens = {}
    for gbp in (50, 100):
        for rule in RULES:
            tr, op, _ = run(w, gbp, rule)
            dis = displaced(w, tr, op, gbp)
            a = summary(tr, op)
            sens[f"gbp{gbp} {rule}"] = {"trips": a["trips"], "won": a["won"], "pnl_gbp": a["with_open_gbp"], "bps_per_trip": a["with_open_bps"],
                                         "halves_gbp": {k: v["with_open_gbp"] for k, v in group(tr, op, halves).items()},
                                         "displaced_gbp": dis["gbp"], "net_gbp": round(a["with_open_gbp"] - dis["gbp"], 4)}
    res["sensitivity"] = sens
    entries = [dict(e, side=s) for e in pool for s in ("bid", "ask")]
    for gbp in (50, 100):
        tr, op, _ = run(w, gbp, null_entries=entries)
        pools = defaultdict(list)
        for t in tr + op:
            pools[(t["book"], t["side"])].append(t["pnl"])
        out = {"pool": {f"{k[0]} {k[1]}": {"n": len(v), "mean_bps": round(statistics.mean(v) / gbp * 1e4, 1)} for k, v in sorted(pools.items())}}
        for rule in (PRIMARY, "rung price"):
            atr, aop, _ = run(w, gbp, rule)
            need = defaultdict(int)
            for t in atr + aop:
                need[(t["book"], t["side"])] += 1
            rng = random.Random(SEED)
            sums = sorted(sum(rng.choice(pools[k]) for k, n in need.items() for _ in range(n)) for _ in range(10_000))
            tot = sum(t["pnl"] for t in atr + aop)
            out[rule] = {"takes": sum(need.values()), "actual_gbp": round(tot, 4), "null_mean_gbp": round(statistics.mean(sums), 4),
                         "null_p95_gbp": round(sums[9499], 4), "null_at_or_above_actual": sum(s >= tot for s in sums) / 1e4}
        res[f"null_gbp{gbp}"] = out
    res["markouts"] = {"episode_starts": markouts(w, [(e["book"], e["T"], e["side"], None) for e in eps])}
    for rule in (PRIMARY, "rung price"):
        tr, op, _ = run(w, 50, rule)
        res["markouts"][f"takes {rule}"] = markouts(w, [(t["book"], t["T"], t["side"], t["entry_px"]) for t in tr + op])
    (HERE / "results.json").write_text(json.dumps(res, indent=1) + "\n")
    print(json.dumps({k: res[k] for k in ("event_rows", "event_rows_not_through_locally", "halves_split_at")}))


if __name__ == "__main__":
    main()


