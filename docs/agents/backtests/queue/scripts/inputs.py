"""QUEUE's inputs, read as `docs/agents/reviews/2026-09-28-queue-prereg.md` ("Data, and when each piece must be taken")
says, into the books `qsim.run` reads. Written 2026-10-24, before the export. Nothing here is opened by the scorer until
checks 1-3 have passed.

* The book record: the decoded export pages, one row a line ({book, ts, seen_until, reads, bids, asks}), gzipped.
* The UK tape: PR6's file layout, one print a line {"id","price","qty","region","side","ts"}; UK rows only, de-duplicated by
  id, ordered by ts, then id compared as a string in code-point order. For the GBP books the union with
  `agent_quote_prints` (both kinds of difference listed), and, from PR5's first live order, the account's own fills taken
  out (Q3).
* Kraken's hours (Q2): the union of the keyless OHLC replies; a closed bar in two must agree exactly on vwap and count,
  else the difference is reported and the later pull is used; the fair of minute t is the VWAP of the latest bar with a
  trade that ended at or before t, read as an exact decimal x 10,000 rounded half up, dark if none started at or after
  t - 180 min.
* PR5's records (Q3): `agent_quote_minutes` (x, fair_u, prints_n), rebuilt where missing from `agent_quote_inputs` by
  `fxBarAt`, `fairHours` and `median`, ported from `agents/quotes.ts` and pinned on `quotes.test.ts`'s cases (checks.py).
"""
import bisect, collections, datetime, decimal, gzip, json, os

M, H, DAY, TICK = 60000, 3600000, 86400000, 1e-4


def ms(s):
    return int(datetime.datetime.fromisoformat(s).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)


def iso(t):
    return datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def parse_iso(s):
    """'YYYY-MM-DDTHH:MM:SS.mmmZ' (the export's to_char format) -> ms."""
    return ms(s.rstrip("Z"))


# ------------------------------------------------------------------ the pre-registration's dates (frozen before 10-04)
W0, HALF, W1 = ms("2026-10-04T00:00"), ms("2026-10-18T00:00"), ms("2026-11-01T00:00")
DATA_END = ms("2026-11-02T00:00")          # every rule runs on data to here
TAPE_FROM = ms("2026-10-03T00:00")         # the tape of 10-03 gives the first minutes their last print
KRAKEN_FROM, KRAKEN_TO = ms("2026-10-03T21:00"), ms("2026-11-01T22:00")    # the hours needed, both starts included
EXPORT_LO, EXPORT_HI = ms("2026-10-03T22:00"), ms("2026-11-02T00:10")
WINDOW_DAYS = 28
USD_BOOKS, GBP_BOOKS = ["USDC-USD", "USDT-USD"], ["USDC-GBP", "USDT-GBP"]
KRAKEN_KEY = {"USDT-USD": "USDTZUSD", "USDC-USD": "USDCUSD"}
USD_OF = {"USDC-GBP": "USDC-USD", "USDT-GBP": "USDT-USD"}
HALF_SPREAD = {"USDC-USD": 0.00005, "USDT-USD": 0.0002}    # half a spread of 1 and of 4 ticks (PR6's)
PAR, GUARD_TICKS = 10000, 30
DARK_AFTER_MS = 180 * M


def _open(path):
    return gzip.open(path, "rt") if path.endswith(".gz") else open(path)


# ------------------------------------------------------------------ the book record
def load_book_record(path):
    """{book: [(ts, seen_until, reads, bids, asks)]} from the decoded export (one JSON row a line)."""
    out = collections.defaultdict(list)
    with _open(path) as f:
        for line in f:
            if not line.strip():
                continue
            r = json.loads(line)
            out[r["book"]].append((parse_iso(r["ts"]), parse_iso(r["seen_until"]), r["reads"], r["bids"], r["asks"]))
    return dict(out)


def void_minutes(rows, t0, t1):
    """The minutes of [t0, t1) on which no valid row was read and which no valid row's span covers: with each row read
    at its ts and its seen_until, a minute is void exactly when no span [ts, seen_until] meets it."""
    spans = sorted((r.ts, r.su) for r in rows)
    void, k = [], 0
    for m in range(t0, t1, M):
        while k < len(spans) and spans[k][1] < m:
            k += 1
        hit = False
        j = k
        while j < len(spans) and spans[j][0] < m + M:
            if spans[j][1] >= m:
                hit = True
                break
            j += 1
        if not hit:
            void.append(m)
    return void


def short_rows(rows):
    """Rows whose reads fall short of the minute starts they span ([minute(ts), minute(seen_until)])."""
    return sum(1 for r in rows if r.reads is not None and r.reads < (r.su // M - r.ts // M + 1))


# ------------------------------------------------------------------ the UK tape
def load_tape(path):
    """[(ts, ticks, qty, aggressor, id)] of one book: UK only, by id once, ordered by ts then id (code points)."""
    rows = {}
    with _open(path) as f:
        for line in f:
            if not line.strip():
                continue
            r = json.loads(line)
            if r.get("region") != "UK":
                continue
            rows[r["id"]] = r
    out = []
    for r in sorted(rows.values(), key=lambda z: (z["ts"], z["id"])):
        pt = round(float(r["price"]) / TICK)
        assert abs(pt * TICK - float(r["price"])) < 1e-9, r
        out.append((int(r["ts"]), pt, float(r["qty"]), r["side"], r["id"]))
    return out


def union_tape(pull, store):
    """Data item 2: the union of the pull and the store by id; both kinds of difference listed (ids only)."""
    a, b = {p[4]: p for p in pull}, {p[4]: p for p in store}
    allp = dict(b)
    allp.update(a)
    out = sorted(allp.values(), key=lambda p: (p[0], p[4]))
    return out, {"only_in_pull": sorted(set(a) - set(b)), "only_in_store": sorted(set(b) - set(a))}


def own_fills(prints, live_orders, book):
    """Q3: the prints that are the account's own fills, from PR5's live orders on `book`: at the order's price, the other
    aggressor, stamped after the order's ts and at or before its updated_at, in time order, each only if its quantity fits
    in what is left of the order's filled_base. Returns the set of their ids."""
    taken = set()
    for o in sorted((o for o in live_orders if o["book"] == book), key=lambda o: (o["ts"], o["id"])):
        left = o["filled_base"] or 0.0
        if left <= 0:
            continue
        want = "sell" if o["side"] == "buy" else "buy"
        ticks = round(o["price"] / TICK)
        for p in prints:
            if p[0] <= o["ts"] or p[0] > o["updated_at"]:
                continue
            if p[1] != ticks or p[3] != want or p[4] in taken:
                continue
            if p[2] <= left + 1e-12:
                taken.add(p[4])
                left -= p[2]
    return taken


# ------------------------------------------------------------------ Kraken's hours (Q2)
def load_kraken(paths, key):
    """The union of OHLC replies, oldest pull first: {start_s: (vwap string, count)} of the closed bars, and the closed
    bars two pulls disagree on (the later pull is used). A reply's last bar is the forming one and counts as not closed."""
    bars, diffs = {}, []
    for path in paths:
        with _open(path) as f:
            rep = json.load(f)
        rows = rep["result"][key]
        for b in rows[:-1]:
            s, vw, cnt = int(b[0]), str(b[5]), int(b[7])
            if s in bars and bars[s] != (vw, cnt):
                diffs.append({"start": iso(s * 1000), "earlier": list(bars[s]), "later": [vw, cnt]})
            bars[s] = (vw, cnt)
    return bars, diffs


def kraken_missing(bars, lo=KRAKEN_FROM, hi=KRAKEN_TO):
    return [iso(t) for t in range(lo, hi + 1, H) if t // 1000 not in bars]


def hours_from_trades(trades):
    """Every hour rebuilt from Kraken's public trades [(price string, volume string, time s)]: VWAP = sum price x volume /
    sum volume in exact decimal, as the string the OHLC reply would carry."""
    acc = collections.defaultdict(lambda: [decimal.Decimal(0), decimal.Decimal(0), 0])
    for px, vol, ts in trades:
        h = int(float(ts)) // 3600 * 3600
        a = acc[h]
        a[0] += decimal.Decimal(px) * decimal.Decimal(vol)
        a[1] += decimal.Decimal(vol)
        a[2] += 1
    return {h: (str(a[0] / a[1]) if a[1] else "0", a[2]) for h, a in acc.items()}


def vwap_ticks(vwap):
    """'1.00185' -> 10019: the string as an exact decimal x 10,000, rounded half up."""
    return int((decimal.Decimal(vwap) * 10000).quantize(decimal.Decimal(1), rounding=decimal.ROUND_HALF_UP))


def q2_fair(bars, t0, n):
    """Fair(t) in ticks for the minutes t0 + i min: the VWAP of the latest hourly bar with a trade whose end is at or
    before t; None (dark) if no such bar started at or after t - 180 min."""
    starts = sorted(s for s, (vw, c) in bars.items() if c > 0)
    out = []
    for i in range(n):
        t = t0 + i * M
        k = bisect.bisect_right(starts, (t - H) // 1000) - 1        # start + 60 min <= t
        if k >= 0 and starts[k] * 1000 >= t - DARK_AFTER_MS:
            out.append(vwap_ticks(bars[starts[k]][0]))
        else:
            out.append(None)
    return out


def guard(prints, t0, n, F):
    """Q1's and Q2's de-peg guard: a minute whose last print strictly before it is more than 30 ticks from par is dark."""
    out, k = list(F), 0
    for i in range(n):
        t = t0 + i * M
        while k < len(prints) and prints[k][0] < t:
            k += 1
        if k and abs(prints[k - 1][1] - PAR) > GUARD_TICKS:
            out[i] = None
    return out


# ------------------------------------------------------------------ PR5's own functions, ported (pinned in checks.py)
def fx_bar_at(t, bars):
    """`fxBarAt`: the latest GBP/USD bar whose minute started in [t - 10 min, t - 1 min], or None."""
    starts = [b[0] for b in bars]
    k = bisect.bisect_right(starts, t - M) - 1
    return bars[k] if k >= 0 and bars[k][0] >= t - 10 * M else None


def median(xs):
    """`median`: the middle value, or the mean of the two middle values; None for none."""
    if not xs:
        return None
    a = sorted(xs)
    n = len(a)
    return a[(n - 1) // 2] if n % 2 else (a[n // 2 - 1] + a[n // 2]) / 2


def fair_hours(t, hours):
    """`fairHours`: the closes of the hours lying wholly inside [t - 24 h, t)."""
    return [c for s, c in hours if t - DAY <= s <= t - H]


def book_levels(raw):
    """`bookLevels`: {data: {bids, asks}} -> (bids, asks) as stored: [price, quantity, count], best first, five a side."""
    top = raw if isinstance(raw, dict) else None
    d = top.get("data") if top else None
    if not isinstance(d, dict) or not isinstance(d.get("bids"), list) or not isinstance(d.get("asks"), list):
        return None

    def level(x):
        if not isinstance(x, dict):
            return None
        try:
            p, q = float(x.get("price")), float(x.get("quantity"))
        except (TypeError, ValueError):
            return None
        c = x.get("count")
        try:
            c = None if c is None else float(c)
        except (TypeError, ValueError):
            c = None
        if not (p == p and p > 0 and q == q and q >= 0 and p != float("inf")):
            return None
        return [p, q, c if (c is not None and c == c and abs(c) != float("inf")) else None]

    def side(xs, desc):
        ls = [lv for lv in map(level, xs) if lv is not None]
        ls.sort(key=lambda lv: -lv[0] if desc else lv[0])
        return ls[:5]
    return side(d["bids"], True), side(d["asks"], False)


# ------------------------------------------------------------------ PR5's records (Q3), as reading_pull-style text
def lines(path):
    with _open(path) as f:
        for line in f:
            line = line.rstrip("\n")
            if line:
                yield line


def load_minutes(path):
    """{book: {ms: (x, fair_u, prints_n)}}: book|ms|x|fair_u|prints_n."""
    out = collections.defaultdict(dict)
    for line in lines(path):
        b, t, x, fu, pn = line.split("|")
        out[b][int(t)] = (float(x) if x else None, float(fu) if fu else None, int(pn) if pn else None)
    return dict(out)


def load_quote_inputs(path):
    """(fx [(ms, close)], {usd book: [(start ms, close)]}): kind|ms|value."""
    fx, hours = [], collections.defaultdict(list)
    for line in lines(path):
        k, t, v = line.split("|")
        if k == "fx":
            fx.append((int(t), float(v)))
        else:
            hours[k.split(":", 1)[1]].append((int(t), float(v)))
    return sorted(fx), {k: sorted(v) for k, v in hours.items()}


ENGINE_TRIP_COLS = ["book", "side", "k", "t_entry", "fill_ts", "fill_print_id", "entry", "qty", "x_entry", "fair_entry", "entry_oid",
                    "t_exit", "exit", "how", "exit_print_id", "exit_oid", "notional_usd", "pnl_usd"]


def load_engine_trips(path):
    out = []
    for line in lines(path):
        r = dict(zip(ENGINE_TRIP_COLS, line.split("|")))
        for c in ("k", "entry", "qty", "exit", "notional_usd", "pnl_usd"):
            r[c] = float(r[c])
        for c in ("t_entry", "fill_ts", "t_exit"):
            r[c] = int(r[c])
        out.append(r)
    return out


def load_live_orders(path):
    """PR5's orders of mode live: id|ts|book|side|price|filled_base|updated_at."""
    out = []
    for line in lines(path):
        i, ts, b, sd, px, fb, up = line.split("|")
        out.append({"id": int(i), "ts": int(ts), "book": b, "side": sd, "price": float(px), "filled_base": float(fb) if fb else 0.0,
                    "updated_at": int(up) if up else int(ts)})
    return out


def load_snapshots(path):
    """PR5's go-live order-book snapshots (events of kind book): book|ms|detail json."""
    out = []
    for line in lines(path):
        b, t, d = line.split("|", 2)
        out.append({"book": b, "minute": int(t), "detail": json.loads(d)})
    return out


def q3_inputs(minutes, fx, hours, book, t0, n):
    """X and fairU of every minute of [t0, t0 + n min) on `book`: PR5's record, or, with no record, rebuilt from the
    stored inputs by fxBarAt, fairHours and median (listed)."""
    X, U, rebuilt = [], [], []
    rec = minutes.get(book, {})
    hrs = hours.get(USD_OF[book], [])
    for i in range(n):
        t = t0 + i * M
        if t in rec:
            X.append(rec[t][0])
            U.append(rec[t][1])
        else:
            b = fx_bar_at(t, fx)
            X.append(b[1] if b else None)
            U.append(median(fair_hours(t, hrs)))
            rebuilt.append(t)
    return X, U, rebuilt
