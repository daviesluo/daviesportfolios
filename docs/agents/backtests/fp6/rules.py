"""fp6: the frozen decision rules of H2 (CARRY-Q), H3 (CARRY-X), H5 (DELIST-S) and H6 (LIST-S), and of H1 (CARRY-P).

H1 was withdrawn before the freeze on its own counts (the family prereg, 2026-09-26-fp6-prereg-family.md); its hold
rule stays here because measure.py's h1 counts, which the withdrawal rests on, are computed with it.

Decisions only: which day a package opens and closes, which coins are eligible, which events
qualify. Nothing here prices a fill, charges a fee, adds a funding payment or computes a return;
phase 1 of fp6 reads only the counts these rules produce (the power check, `measure.py`). The
phase-2 scorers import these functions unchanged. The pre-registrations
(docs/agents/reviews/2026-09-26-fp6-prereg-*.md) quote every constant below.

Conventions
* Times are UTC milliseconds. A "day" d is the UTC midnight that opens it; a decision "at d" is
  taken at d 00:00 and fills at that day's daily-kline OPEN (the first trade after 00:00).
* A funding settlement is identified by its BUCKET: the hour boundary its stamp belongs to
  (Binance stamps a settlement 0–120 s after the boundary; a stamp further off stops the run).
* A decision at d reads only settlements whose bucket is strictly before d. The d 00:00 settlement
  is NOT known at the d 00:00 decision (fund/ and fp5's frozen convention).
* A position opened at d's open and closed at d' 's open holds every settlement with bucket in
  (d, d'] — it is open at d' 00:00:00, when the d' 00:00 settlement is exchanged, and was not yet
  open at d 00:00:00.
"""

from __future__ import annotations

import bisect
from dataclasses import dataclass

DAY = 86_400_000
HOUR = 3_600_000

# ─────────────────────────────────────────────────────────────── funding


def bucket(ts: int) -> int:
    q, r = divmod(ts, HOUR)
    if r > 120_000:
        raise ValueError(f"settlement stamp {ts} is not within two minutes after an hour boundary")
    return q * HOUR


@dataclass
class Funding:
    """One contract's settlements, by bucket, as floats (the stored strings parse exactly as Binance publishes)."""
    buckets: list[int]
    rates: list[float]
    prefix: list[float]  # prefix[i] = sum(rates[:i])

    @staticmethod
    def of(rows: list[list]) -> "Funding":
        by = {}
        for t, _ih, rate in rows:
            b = bucket(int(t))
            by[b] = float(rate)
        bs = sorted(by)
        rs = [by[b] for b in bs]
        pre = [0.0]
        for r in rs:
            pre.append(pre[-1] + r)
        return Funding(bs, rs, pre)

    def sum_between(self, lo: int, hi: int) -> float:
        """Sum of rates with lo <= bucket < hi."""
        i = bisect.bisect_left(self.buckets, lo)
        j = bisect.bisect_left(self.buckets, hi)
        return self.prefix[j] - self.prefix[i]

    def count_between(self, lo: int, hi: int) -> int:
        return bisect.bisect_left(self.buckets, hi) - bisect.bisect_left(self.buckets, lo)

    def trailing_annualised(self, d: int, days: int) -> float | None:
        """Sum of the rates settled in [d - days, d), times 365 / days: a simple annual rate on notional.
        None when the contract has no settlement at all in that span (not yet listed)."""
        lo = d - days * DAY
        if self.count_between(lo, d) == 0:
            return None
        return self.sum_between(lo, d) * 365.0 / days

    def held_between(self, entry_day: int, exit_day: int) -> list[tuple[int, float]]:
        """The settlements a package open from entry_day's open to exit_day's open receives or pays."""
        i = bisect.bisect_right(self.buckets, entry_day)
        j = bisect.bisect_right(self.buckets, exit_day)
        return list(zip(self.buckets[i:j], self.rates[i:j]))


# ─────────────────────────────────────────────── H1 CARRY-P: BTC and ETH perpetual carry (withdrawn; counts only)

H1_COINS = ("BTCUSDT", "ETHUSDT")
H1_TRAIL_DAYS = 7
H1_ENTER = 0.08   # enter when the trailing 7-day funding, annualised, is at least the worth-money line
H1_EXIT = 0.04    # leave when it falls below cash


def h1_holds(f: Funding, days: list[int]) -> list[tuple[int, int | None]]:
    """[(entry day, exit day or None if still open at the end)] for one coin over `days` (sorted UTC midnights,
    the decision days of the window). A decision at day d: flat and A7 >= 8 % -> open; holding and A7 < 4 % -> close."""
    out: list[tuple[int, int | None]] = []
    holding = None
    for d in days:
        a = f.trailing_annualised(d, H1_TRAIL_DAYS)
        if a is None:
            continue
        if holding is None and a >= H1_ENTER:
            holding = d
        elif holding is not None and a < H1_EXIT:
            out.append((holding, d))
            holding = None
    if holding is not None:
        out.append((holding, None))
    return out


# ─────────────────────────────────────────────── H2 CARRY-Q: the ETH quarterly, one at a time

H2_COIN = "ETHUSDT"
H2_FEE_BPS = 40.0        # four fills at 10 bp, SPQTR's charge, used only to rank and to gate
H2_ENTER = 0.08          # annualised net basis at the previous closes, the worth-money line
H2_MIN_DAYS = 14         # a contract with fewer days to delivery than this is not entered


def expiry_ms(contract: str) -> int:
    """BTCUSDT_260925 -> 2026-09-25 08:00 UTC (Binance delivers at 08:00 on the last Friday of the quarter)."""
    from datetime import datetime, timezone
    y, m, d = int("20" + contract[-6:-4]), int(contract[-4:-2]), int(contract[-2:])
    return int(datetime(y, m, d, 8, tzinfo=timezone.utc).timestamp() * 1000)


def delivery_day(contract: str) -> int:
    return expiry_ms(contract) - 8 * HOUR


def h2_pick(d: int, spot_close_prev: float | None, closes_prev: dict[str, float]) -> tuple[str, float] | None:
    """At day d (flat): among the contracts with a close on d-1 and at least 14 days from d to their delivery day,
    the one with the highest annualised NET basis at the previous closes,
        y = ((F/S - 1) - 40 bp) * 365 / days to delivery,
    if y >= 8 %; else None. Ties go to the nearer delivery."""
    if spot_close_prev is None:
        return None
    best = None
    for c, fclose in sorted(closes_prev.items(), key=lambda kv: delivery_day(kv[0])):
        days_left = (delivery_day(c) - d) / DAY
        if days_left < H2_MIN_DAYS:
            continue
        y = ((fclose / spot_close_prev - 1.0) - H2_FEE_BPS / 1e4) * 365.0 / days_left
        if y >= H2_ENTER and (best is None or y > best[1]):
            best = (c, y)
    return best


# ─────────────────────────────────────────────── H3 CARRY-X: cross-sectional alt carry

H3_TOP_N = 40            # the universe: the 40 largest by 30-day perpetual quote volume
H3_KEEP_N = 60           # a held coin that falls out of the top 60 is closed
H3_MIN_AGE_DAYS = 60     # both the perpetual and the spot pair have traded at least 60 days
H3_VOL_DAYS = 30
H3_TRAIL_DAYS = 3
H3_ENTER = 0.25          # trailing 3-day funding, annualised, at least 25 %
H3_EXIT = 0.05           # closed when it falls below 5 %
H3_SLOTS = 5
H3_COOLDOWN_DAYS = 2     # a coin closed at d may not reopen before d + 2 days
H3_GUARD = 1.40          # the short is closed if the perpetual trades 40 % above its entry price (2x margin)
H3_EXCLUDE_BASES = {"BTC", "ETH", "USDC", "BUSD", "TUSD", "FDUSD", "USDP", "DAI", "USDE", "EUR", "EURI", "XUSD",
                    "BFUSD", "RLUSD", "U", "USD1", "PYUSD", "USDS", "AEUR", "UST", "USTC", "SUSD", "GUSD", "PAX",
                    "USDB", "USDD", "BTCDOM", "DEFI", "FOOTBALL", "BLUEBIRD"}


def base_of(perp: str) -> str:
    return perp[:-4]


def h3_universe(d: int, perp_bars: dict[str, dict[int, list]], perp_first: dict[str, int],
                spot_bars: dict[str, dict[int, list]], spot_first: dict[str, int], pairs: dict[str, str],
                top: int = H3_TOP_N, crypto: set[str] | None = None) -> list[str]:
    """The perpetuals eligible at day d, largest 30-day quote volume first (ties by symbol):
    a crypto USDT perpetual (`crypto`, as `listing_events` defines it) with a matching Binance spot USDT pair,
    base not excluded, both first traded at least 60 days before d, both with a daily bar on d-1 and on d,
    ranked by the perpetual's quote volume summed over d-30 … d-1 (missing days count zero)."""
    ranked = []
    for perp, sp in pairs.items():
        if base_of(perp) in H3_EXCLUDE_BASES or (crypto is not None and perp not in crypto):
            continue
        pf, sf = perp_first.get(perp), spot_first.get(sp)
        if pf is None or sf is None or pf > d - H3_MIN_AGE_DAYS * DAY or sf > d - H3_MIN_AGE_DAYS * DAY:
            continue
        pb, sb = perp_bars.get(perp, {}), spot_bars.get(sp, {})
        if (d - DAY) not in pb or d not in pb or (d - DAY) not in sb or d not in sb:
            continue
        qv = sum(pb[t][6] for t in range(d - H3_VOL_DAYS * DAY, d, DAY) if t in pb)
        ranked.append((-qv, perp))
    ranked.sort()
    return [p for _, p in ranked[:top]]


@dataclass
class Package:
    perp: str
    entry_day: int
    exit_day: int | None = None      # the day whose open closes it (rule exit), or the day the guard fired (intraday)
    how: str = ""                    # "rule", "universe", "guard" or "end"


def h3_run(days: list[int], universe, a3, guard_hit) -> list[Package]:
    """The daily state machine of H3, deterministic.
    `universe(d, top)` -> ranked perpetuals eligible at d; `a3(perp, d)` -> trailing 3-day annualised funding or None;
    `guard_hit(perp, entry_day, d)` -> True when the perpetual's high on day d-1 reached 1.40 x its price at the
    entry day's open (checked for every day the package was open; the close is then that day, at the level).
    At each day d, in order:
      1. the guard: a held package whose perpetual traded through the guard on day d-1 closed during d-1;
      2. exits at d's open: A3 < 5 %, or A3 unknown, or the coin is out of the top 60;
      3. entries at d's open: the top 40, A3 >= 25 %, not held, not closed in the last two days, highest A3 first
         (ties by symbol), while fewer than five packages are open."""
    held: dict[str, Package] = {}
    closed: list[Package] = []
    cool: dict[str, int] = {}
    for d in days:
        for p in sorted(held):
            if guard_hit(p, held[p].entry_day, d):
                pk = held.pop(p)
                pk.exit_day, pk.how = d - DAY, "guard"
                closed.append(pk)
                cool[p] = d - DAY + H3_COOLDOWN_DAYS * DAY
        keep = set(universe(d, H3_KEEP_N))
        for p in sorted(held):
            a = a3(p, d)
            if a is None or a < H3_EXIT or p not in keep:
                pk = held.pop(p)
                pk.exit_day, pk.how = d, ("universe" if (a is not None and a >= H3_EXIT) else "rule")
                closed.append(pk)
                cool[p] = d + H3_COOLDOWN_DAYS * DAY
        if len(held) < H3_SLOTS:
            cands = []
            for p in universe(d, H3_TOP_N):
                if p in held or cool.get(p, -1) > d:
                    continue
                a = a3(p, d)
                if a is not None and a >= H3_ENTER:
                    cands.append((-a, p))
            for _, p in sorted(cands):
                if len(held) >= H3_SLOTS:
                    break
                held[p] = Package(p, d)
    for p in sorted(held):
        pk = held.pop(p)
        pk.how = "end"
        closed.append(pk)
    return closed


# ─────────────────────────────────────────────── H5 DELIST-S and H6 LIST-S (events)

H5_MAX_DAYS = 30            # enter at the open of the day after the announcement's day; hold at most 30 days
H5_EXIT_BEFORE_CEASE_H = 24  # leave at the open of the day that contains (spot cessation − 24 h), as DL left a day early
H5_STOP = 0.50              # the short is closed if the perpetual trades 50 % above its entry
H5_DONOR_MIN_AGE_DAYS = 180
H5_DONOR_EXCLUSION_DAYS = 60


def delist_entry_exit(e: dict) -> tuple[int, int]:
    """The event's entry day (the UTC day after the announcement's day) and its planned exit day."""
    entry = (e["published"] // DAY + 1) * DAY
    exit_day = min(((e["cease"] - H5_EXIT_BEFORE_CEASE_H * HOUR) // DAY) * DAY, entry + H5_MAX_DAYS * DAY)
    return entry, exit_day

H6_HOLD_DAYS = 30           # enter at the open of the first full UTC day after the listing day; hold 30 days
H6_STOP = 0.50


H6_EXCLUDE_BASES = H3_EXCLUDE_BASES - {"BTC", "ETH"}


def crypto_contracts(perp_symbols, xinfo_symbols: list[dict]) -> set[str]:
    """The crypto perpetuals: listed in the 2026-09-26 exchangeInfo as contractType PERPETUAL with underlyingType COIN,
    or not listed there at all (every contract delisted before that day was a crypto contract: Binance's first TradFi
    perpetual, XAUUSDT, listed on 2025-12-11, and no perpetual first traded after 2025-12-01 is missing from the list)."""
    listed = {s["symbol"]: s for s in xinfo_symbols}
    out = set()
    for p in perp_symbols:
        s = listed.get(p)
        if s is None or (s.get("underlyingType") == "COIN" and s.get("contractType") == "PERPETUAL"):
            out.add(p)
    return out


def listing_events(perp_first: dict[str, int], crypto: set[str], win_from: int, win_to: int) -> list[dict]:
    """Every USDT perpetual whose first daily bar in the archive falls in [win_from, win_to), that is a crypto contract
    (`crypto`: not a TradFi or index contract in the 2026-09-26 exchangeInfo; a contract no longer listed there counts as
    crypto, since Binance's first TradFi perpetual listed on 2025-12-11 and none has been delisted), and whose base is
    not a stablecoin or an index. Entry day = the listing day + 1 (the listing day's close)."""
    out = []
    for p, first in perp_first.items():
        if not p.endswith("USDT") or p not in crypto:
            continue
        if base_of(p) in H6_EXCLUDE_BASES:
            continue
        if win_from <= first < win_to:
            out.append({"perp": p, "listed": first, "entry": first + DAY})
    return sorted(out, key=lambda e: (e["entry"], e["perp"]))


def perp_for_token(token: str, perps: set[str]) -> str | None:
    """The USDⓈ-M USDT perpetual of a token: XUSDT, else 1000XUSDT / 1000000XUSDT / 1MXUSDT / 10000XUSDT."""
    for sym in (f"{token}USDT", f"1000{token}USDT", f"1000000{token}USDT", f"1M{token}USDT", f"10000{token}USDT"):
        if sym in perps:
            return sym
    return None


def delist_events(texts: dict, win_from: int, win_to: int) -> list[dict]:
    """Every token named in the TITLE of a "Binance Will Delist <tokens> on <date>" announcement published in
    [win_from, win_to), with the spot cessation time the text gives ("… at YYYY-MM-DD HH:MM (UTC)", the first such
    time, which Binance's texts state before any other). Titles naming no token list (a rebrand, "All …") are skipped."""
    import re
    from datetime import datetime, timezone
    out = []
    for code, t in texts.items():
        title = t["title"]
        m = re.match(r"Binance Will Delist (.+?) on (\d{4}-\d{2}-\d{2})\s*$", title)
        if not m:
            continue
        pub = int(t["publishDate"])
        if not (win_from <= pub < win_to):
            continue
        toks = [x.strip() for x in re.split(r",|\band\b|&", m.group(1)) if x.strip()]
        if not toks or not all(re.fullmatch(r"[A-Z0-9]{1,12}", x) for x in toks):
            continue
        tm = re.search(r"at (\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}) \(UTC\)", t["text"])
        if not tm or tm.group(1) != m.group(2):
            continue
        y, mo, d = (int(x) for x in tm.group(1).split("-"))
        cease = int(datetime(y, mo, d, int(tm.group(2)), int(tm.group(3)), tzinfo=timezone.utc).timestamp() * 1000)
        for tok in toks:
            out.append({"code": code, "published": pub, "token": tok, "cease": cease})
    return sorted(out, key=lambda e: (e["published"], e["token"]))
