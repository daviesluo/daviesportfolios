"""Eight frozen Revolut X screens. Fifteen-minute spot structure, open to open.

Reads the eight rule texts hashed at 2026-09-25 10:57:19 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass52.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
The weighted-price family is not rerun. The ETH buy-below-open screen is not
a pass. The LTC weighted price below the midpoint is not a pass. The
coin-margined three-day trade-count rise is not a pass. No testing row is opened.

    python3 docs/agents/scripts/fp5/screen_pass52.py
    python3 docs/agents/scripts/fp5/screen_pass52.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass52")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass52.json")
FROZEN = "2026-09-25 10:57:19 UTC"
SHA = {
    "btcup15": "ec23a6b774eb3ea8f88df7c61823b9dfe737ba7dc423379f0be3fc82ba4f5a75",
    "ethrun15": "3ef624afd72820df444a042ec3fb2d3cf76e7c310353277701ff1096e2276ab9",
    "bnbhigh15": "2f1b46bdac25da7ffa0a5dd7e3e960e364706e57ebc73cfb0d8aca4a264ec42b",
    "ltcdiff15": "c38e1041c71eb14ab6d4e4fd873be8351dc416df97001b97111df7ffbbcc7c6b",
    "xrpdiv15": "8fb70414174be34065aec5c790ae7587fb3b691e8e577b207f230777189b9404",
    "linkgap15": "28f1580cac6c2e6e62216490162fef6d520611b5d812da2d7b54b334275b1cd7",
    "adaexact15": "1d85724850f9e82f593dfd3fb5968948080b2a3a449f8eaa4e6659c6c5cbd3f0",
    "dotmed15": "acf64de7615afcb9117cd3147c2300fe623fbd97a52d0a6a070b9d4e7898ff7f",
}
ORDER = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "LTCUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "DOTUSDT")
GAP = ("2021-02-11", "2021-03-06", "2021-04-20", "2021-04-25", "2021-08-13", "2021-09-29")
COUNTED = {
    "btc_more_up_bars_2021": 158,
    "eth_longer_up_run_2021": 163,
    "bnb_more_new_highs_2021": 197,
    "ltc_up_minus_down_6_2021": 14,
    "xrp_up_day_more_down_bars_2021": 40,
    "link_more_gap_ups_2021": 153,
    "ada_exactly_40_up_2021": 16,
    "dot_median_close_above_2021": 171,
}
COIN = {
    "btc_more_up_bars_2021": "BTCUSDT",
    "eth_longer_up_run_2021": "ETHUSDT",
    "bnb_more_new_highs_2021": "BNBUSDT",
    "ltc_up_minus_down_6_2021": "LTCUSDT",
    "xrp_up_day_more_down_bars_2021": "XRPUSDT",
    "link_more_gap_ups_2021": "LINKUSDT",
    "ada_exactly_40_up_2021": "ADAUSDT",
    "dot_median_close_above_2021": "DOTUSDT",
}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def require_rules():
    found = {}
    for name, digest in SHA.items():
        path = os.path.join(RULES, name + "_rule.txt")
        have = sha256_file(path)
        if have != digest:
            raise SystemExit("rule text moved after the freeze: %s %s" % (name, have))
        stamp = open(os.path.join(RULES, name + "_rule.frozen_at")).read().strip()
        if stamp != FROZEN:
            raise SystemExit("freeze stamp moved: %s" % name)
        found[name] = have
    return found


def load_bars(folder):
    got = {}
    for parts in p30.iter_kline_rows(folder):
        if len(parts) < 5:
            raise SystemExit("bar field gap in %s" % folder)
        ts = p30.stamp_of(int(parts[0]))
        if ts.second != 0 or ts.microsecond != 0 or ts.minute not in (0, 15, 30, 45):
            raise SystemExit("off-grid bar in %s" % folder)
        day = p5.ymd(ts)
        slot = ts.hour * 4 + ts.minute // 15
        o, h, l, c = (float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4]))
        if not (o > 0 and h > 0 and l > 0 and c > 0):
            raise SystemExit("nonpositive bar %s %s" % (folder, day))
        if h < l or h < max(o, c) or l > min(o, c):
            raise SystemExit("bar order %s %s" % (folder, day))
        key = (day, slot)
        if key in got:
            raise SystemExit("duplicate slot %s %s %s" % (folder, day, slot))
        got[key] = (o, h, l, c)
    by_day = {}
    for (day, slot), bar in got.items():
        by_day.setdefault(day, {})[slot] = bar
    days = {}
    for day, slots in by_day.items():
        if len(slots) == 96 and all(i in slots for i in range(96)):
            days[day] = [slots[i] for i in range(96)]
    return days


def up_down(rows):
    up = down = 0
    for _o, _h, _l, c in rows:
        o = _o
        if c > o:
            up += 1
        elif c < o:
            down += 1
    return up, down


def run_lengths(rows):
    longest_up = longest_down = 0
    run_up = run_down = 0
    for o, _h, _l, c in rows:
        if c > o:
            run_up += 1
            run_down = 0
            if run_up > longest_up:
                longest_up = run_up
        elif c < o:
            run_down += 1
            run_up = 0
            if run_down > longest_down:
                longest_down = run_down
        else:
            run_up = run_down = 0
    return longest_up, longest_down


def new_counts(rows):
    highs = lows = 0
    max_high = rows[0][1]
    min_low = rows[0][2]
    for _o, h, l, _c in rows[1:]:
        if h > max_high:
            highs += 1
            max_high = h
        if l < min_low:
            lows += 1
            min_low = l
    return highs, lows


def gap_counts(rows):
    up = down = 0
    for i in range(1, len(rows)):
        previous = rows[i - 1][3]
        opened = rows[i][0]
        if opened > previous:
            up += 1
        elif opened < previous:
            down += 1
    return up, down


def medians(rows):
    if len(rows) != 96:
        raise SystemExit("median needs 96 bars")
    closes = sorted(row[3] for row in rows)
    opens = sorted(row[0] for row in rows)
    return (closes[47] + closes[48]) / 2.0, (opens[47] + opens[48]) / 2.0


def btc_up(rows):
    up, down = up_down(rows)
    return up > down


def eth_run(rows):
    up, down = run_lengths(rows)
    return up > down


def bnb_highs(rows):
    highs, lows = new_counts(rows)
    return highs > lows


def ltc_diff(rows):
    up, down = up_down(rows)
    return up - down == 6


def xrp_div(rows):
    up, down = up_down(rows)
    net = rows[-1][3] - rows[0][0]
    return net > 0 and down > up


def link_gaps(rows):
    up, down = gap_counts(rows)
    return up > down


def ada_exact(rows):
    up, _down = up_down(rows)
    return up == 40


def dot_median(rows):
    close_med, open_med = medians(rows)
    return close_med > open_med


PREDICATES = {
    "btc_more_up_bars_2021": btc_up,
    "eth_longer_up_run_2021": eth_run,
    "bnb_more_new_highs_2021": bnb_highs,
    "ltc_up_minus_down_6_2021": ltc_diff,
    "xrp_up_day_more_down_bars_2021": xrp_div,
    "link_more_gap_ups_2021": link_gaps,
    "ada_exactly_40_up_2021": ada_exact,
    "dot_median_close_above_2021": dot_median,
}


def signals_for(name, books):
    pred = PREDICATES.get(name)
    coin = COIN.get(name)
    if pred is None or coin is None:
        raise SystemExit("unknown rule %s" % name)
    out = set()
    for day in p5.daterange("2020-12-31", "2021-12-30"):
        rows = books[coin].get(day)
        if rows is None:
            continue
        if pred(rows):
            out.add(day)
    return out


def self_check():
    p5.self_check()
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    up = (1.0, 2.0, 0.5, 2.0)
    down = (2.0, 2.0, 0.5, 1.0)
    flat = (1.0, 1.0, 1.0, 1.0)
    if not btc_up([up, up, down]) or btc_up([up, down]) or btc_up([down, down, up]):
        raise SystemExit("btc up")
    if not eth_run([up, up, down, flat, down]) or eth_run([up, down]) or eth_run([down, down, up]):
        raise SystemExit("eth run")
    more_highs = [(10.0, 10.0, 8.0, 9.0), (10.0, 11.0, 8.0, 10.0), (10.0, 11.0, 7.0, 10.0), (11.0, 12.0, 7.0, 11.0)]
    tied = [(10.0, 10.0, 8.0, 9.0), (10.0, 11.0, 7.0, 10.0)]
    more_lows = [(10.0, 10.0, 8.0, 9.0), (10.0, 10.0, 7.0, 9.0)]
    if not bnb_highs(more_highs) or bnb_highs(tied) or bnb_highs(more_lows):
        raise SystemExit("bnb highs")
    six = [up] * 7 + [down]
    five = [up] * 5
    if not ltc_diff([up] * 6) or ltc_diff(five) or not ltc_diff(six):
        raise SystemExit("ltc diff")
    diverge = [(10.0, 10.0, 9.0, 9.0), (9.0, 9.0, 8.0, 8.0), (8.0, 9.0, 8.0, 11.0)]
    net_down = [(10.0, 10.0, 9.0, 9.0), (9.0, 9.0, 8.0, 8.0), (8.0, 9.0, 8.0, 9.0)]
    more_up = [(10.0, 11.0, 9.0, 12.0), (12.0, 13.0, 11.0, 13.0)]
    if not xrp_div(diverge) or xrp_div(net_down) or xrp_div(more_up):
        raise SystemExit("xrp div")
    gap_up = [(1.0, 1.0, 1.0, 10.0), (11.0, 11.0, 11.0, 11.0), (12.0, 12.0, 12.0, 12.0)]
    gap_tie = [(1.0, 1.0, 1.0, 10.0), (11.0, 11.0, 11.0, 9.0), (8.0, 8.0, 8.0, 8.0)]
    gap_down = [(1.0, 1.0, 1.0, 10.0), (9.0, 9.0, 9.0, 9.0)]
    if not link_gaps(gap_up) or link_gaps(gap_tie) or link_gaps(gap_down):
        raise SystemExit("link gaps")
    if not ada_exact([up] * 40) or ada_exact([up] * 39) or ada_exact([up] * 41):
        raise SystemExit("ada exact")
    above = [(1.0, 1.0, 1.0, 2.0)] * 96
    same = [(1.0, 1.0, 1.0, 1.0)] * 96
    below = [(2.0, 2.0, 2.0, 1.0)] * 96
    mixed_open = [(1.0, 1.0, 1.0, 2.0)] * 48 + [(2.0, 2.0, 2.0, 3.0)] * 48
    if not dot_median(above) or dot_median(same) or dot_median(below) or not dot_median(mixed_open):
        raise SystemExit("dot median")


def input_jobs():
    jobs = []
    for sym in ("BTCUSDT", "ETHUSDT"):
        for ym in p5.months("2020-12", "2022-01"):
            name = "%s-1d-%s.zip" % (sym, ym)
            jobs.append((
                p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name),
                os.path.join(INP, "klines", "spot", sym, "1d", name)))
    for sym in ORDER:
        for ym in p5.months("2020-12", "2021-12"):
            name = "%s-15m-%s.zip" % (sym, ym)
            jobs.append((
                p5.VISION + "spot/monthly/klines/%s/15m/%s" % (sym, name),
                os.path.join(INP, "klines", "spot", sym, "15m", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda job: p5.fetch(*job), input_jobs()))
    print("pass52 inputs ready", flush=True)


def detail_for(name, rows):
    if name == "btc_more_up_bars_2021":
        up, down = up_down(rows)
        return "up %d down %d" % (up, down)
    if name == "eth_longer_up_run_2021":
        up, down = run_lengths(rows)
        return "up-run %d down-run %d" % (up, down)
    if name == "bnb_more_new_highs_2021":
        highs, lows = new_counts(rows)
        return "new-high %d new-low %d" % (highs, lows)
    if name == "ltc_up_minus_down_6_2021":
        up, down = up_down(rows)
        return "up %d down %d" % (up, down)
    if name == "xrp_up_day_more_down_bars_2021":
        up, down = up_down(rows)
        return "open %.8f close %.8f up %d down %d" % (rows[0][0], rows[-1][3], up, down)
    if name == "link_more_gap_ups_2021":
        up, down = gap_counts(rows)
        return "gap-up %d gap-down %d" % (up, down)
    if name == "ada_exactly_40_up_2021":
        up, _down = up_down(rows)
        return "up %d" % up
    if name == "dot_median_close_above_2021":
        close_med, open_med = medians(rows)
        return "close-med %.8f open-med %.8f" % (close_med, open_med)
    raise SystemExit("unknown detail %s" % name)


def main():
    check = "--check" in sys.argv
    found = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    spot = os.path.join(INP, "klines", "spot")
    btc_opens = p30.load_field(os.path.join(spot, "BTCUSDT", "1d"), 1, 2)
    eth_opens = p30.load_field(os.path.join(spot, "ETHUSDT", "1d"), 1, 2)
    for day in ("2021-01-01", "2022-01-01"):
        if day not in btc_opens or day not in eth_opens:
            raise SystemExit("spot open does not cover %s" % day)
    if p5.parse_ymd("2021-01-02").weekday() != 5:
        raise SystemExit("saturday")
    books = {}
    for sym in ORDER:
        books[sym] = load_bars(os.path.join(spot, sym, "15m"))
        for day in p5.daterange("2020-12-31", "2021-12-30"):
            have = day in books[sym]
            if day in GAP and have:
                raise SystemExit("filled a missing fifteen-minute day %s %s" % (sym, day))
            if day not in GAP and not have:
                raise SystemExit("fifteen-minute gap %s %s" % (sym, day))
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    specs = (
        ("btc_more_up_bars_2021", "btcup15"),
        ("eth_longer_up_run_2021", "ethrun15"),
        ("bnb_more_new_highs_2021", "bnbhigh15"),
        ("ltc_up_minus_down_6_2021", "ltcdiff15"),
        ("xrp_up_day_more_down_bars_2021", "xrpdiv15"),
        ("link_more_gap_ups_2021", "linkgap15"),
        ("ada_exactly_40_up_2021", "adaexact15"),
        ("dot_median_close_above_2021", "dotmed15"),
    )
    kills = {}
    for name, _key in specs:
        signals = signals_for(name, books)
        if len(signals) != COUNTED[name]:
            raise SystemExit("pre-freeze count moved %s %d" % (name, len(signals)))
        row = p30.run_open(name, p30.marked_for(signals, "2021-01-01", "2021-12-31"), btc_ret, eth_ret, 400)
        entries = row.pop("_entries")
        raw_pool = row.pop("_pool")
        hand, n = p30.hand_sum(entries, btc_opens, eth_opens)
        if n != row["trips"] or abs(hand - raw_pool) > 0.1 or abs(hand - row["pool_bps"]) > 0.1:
            raise SystemExit("hand sum mismatch %s %s %s %s" % (name, hand, raw_pool, row["pool_bps"]))
        if row["long_days"] != row["trips"] or row["trips"] != COUNTED[name]:
            raise SystemExit("open trip count %s" % name)
        if row["signals_without_open"] != 0:
            raise SystemExit("signal lacked an open %s" % name)
        if row["execution_days"] != 365:
            raise SystemExit("execution calendar %s" % name)
        gap = row["pool_bps"] - row["stress_bps"]
        print("COST %s trips %d gap %.1f expected %d" % (name, row["trips"], gap, 40 * row["trips"]), flush=True)
        kills[name] = row
        signal = p30.shift(entries[0], -1)
        entry, exit_px, move = p30.btc_open_text(btc_opens, entries[0])
        print("FIRST %s signal %s exec %s %s BTC open %.2f -> %.2f %+.2f" % (
            name, signal, entries[0], detail_for(name, books[COIN[name]][signal]), entry, exit_px, move), flush=True)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 10:57:19 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series is one coin's Binance spot 15m bar. The open, the high, the low, and the close are fields 1 through 4. "
            "A day needs each of the ninety-six slots from 00:00 through 23:45 once. "
            "Volume columns and the trade count are not the signal. Yesterday is not read. "
            "The other seven coins are not the signal. This is not a ranking of which coin has more trades. "
            "The volume-weighted price is not formed. The weighted price against the open, the close, the high, or the low is not rerun. "
            "The BNB close closer to the weighted price than the open is not rerun at a different cost. "
            "The LTC weighted price strictly below the midpoint is not a pass and its fill is not changed. "
            "The average trade size is not formed. The taker volume ratio is not formed. "
            "Same-day trade-count rankings are not rerun, and that ranking method is not changed. "
            "Hourly session blocks, clock-hour comparisons, and path length are not rerun, and that coin is not swapped. "
            "The taker-buy price against the open, the close, the high, or the low is not rerun. "
            "The ETH taker-buy price strictly below the open is not a pass and its fill is not changed. "
            "The same-day count of which of the eight coins closed up or down is not formed, and that counting method is not changed. "
            "How an index body and a spot body nest is not formed. "
            "Which hour the high falls and which hour the low falls are not formed. "
            "The busiest hour and the quietest hour are not formed. "
            "A term-basis sign comparison is not formed. The no-entry ADA-positive DOT-positive LINK-negative rule is not in this run and its signs are not flipped. "
            "A positive sum of fifteen-minute bodies with a negative net move had no entries and is not in this run. "
            "The premium index is not formed. The coin-margined versus USDT-margined premium is not formed. "
            "The coin-margined versus USDT-margined volume ratio is not formed. "
            "Perpetual quote volume relative to the previous days is not rerun. "
            "Taker-buy base volume relative to its own previous days is not rerun. "
            "Coin-margined trade-count rules are not rerun and their fill is not changed. "
            "The coin-margined BTC three-day trade-count rise is not a pass and is not armed. "
            "The OKX-minus-Binance basis is not a pass and is not in this run. "
            "A numeric clear on this daily open is not a testing row. "
            "These fifteen-minute bars are not a stand-in for the weighted-price family, for trade-count rankings, for hourly session structure, for the taker-price family, for the eight-coin sign count, for index-versus-spot bars, for hourly price extremes, for leveraged-token pairs, for USD-M metrics, or for book depth. "
            "BTCDOMUSDT does not cover January 2021 and is not scored. "
            "BCHUPUSDT and BCHDOWNUSDT do not cover January 2021 and are not scored. "
            "CHZUSDT, SANDUSDT, and MANAUSDT USD-M perpetual files do not cover December 2020 and are not scored. "
            "ANTUSDT USD-M perpetual files do not cover December 2020 or January 2021 and are not scored. "
            "USDT-margined quarterly klines do not cover January 2021 and are not scored. "
            "Coin-margined EOSUSD, ETCUSD, FILUSD, and TRXUSD quarterlies stop at the March 2021 contract and are not scored. "
            "2021-02-11, 2021-03-06, 2021-04-20, 2021-04-25, 2021-08-13, and 2021-09-29 lack a full spot hour set and lack a full spot fifteen-minute set. Those days stay missing. The year is not started later. This screen does not read the hourly tape. "
            "None of these is a volume-weighted price against the open, the close, the high, or the low. "
            "None of these is a same-day trade-count ranking. "
            "None of these is an hourly session block, a clock-hour comparison, or a path length. "
            "None of these is a taker-buy price against the open, the close, the high, or the low. "
            "None of these is an eight-coin up or down count. "
            "None of these is an index-versus-spot body nesting. "
            "None of these is a leveraged-token up-versus-down pair. "
            "None of these is a busiest-hour or quietest-hour rule. "
            "None of these is an hourly price-extreme rule. "
            "None of these is a BTC contract-count path. "
            "None of these is ETH funding. "
            "None of these is a moving average, a breakout, or a candlestick pattern. "
            "None is a top-trader position-ratio or account-ratio slice. "
            "None compares one coin's N-day close return with another's. "
            "The account-minus-position gap narrowing is not rerun. "
            "None lowers 1.30, 0.001, 0.0015, 0.002, the five-day funding window, the 10% SOL excess, or the 0.0004 width. "
            "The 60-trip gate is not lowered to 12, to 46, to 56, to 36, to 28, to 53, to 24, to 39, to 54, to 47, to 15, to 55, to 44, to 53, to 59, to 18, to 2, to 19, to 3, to 20, to 35, to 58, to 9, to 25, to 32, to 17, to 11, to 8, to 42, to 14, to 16, or to 40, and no year is extended. "
            "The three-hour neighborhood is not widened. The one-hour gap is not widened. Twelve is not lowered. "
            "The separation of 11 is not lowered. "
            "The funding-sum half and the funding hour comparison are not changed. "
            "The interior funding peak is not rescored. "
            "The OKX basis is not in this run. "
            "Liquidation snapshots are not in this run and are not replaced. "
            "The LINK quote-volume screen is not rerun and its null is not loosened. "
            "The LTC quote-volume screen that clears the previous three days is not rerun. "
            "The DOGE 1% open gap is not rerun and its threshold is not lowered. "
            "The ETH two-up streak is not rerun and its cost and month gate are not changed. "
            "The DOGE quote-volume mean screen is not extended and its 60-trip gate is not lowered to 45. "
            "A numeric clear is the open-to-open arithmetic and is not adjusted for the venue."
        ),
        "rules": {name + "_rule_sha256": digest for name, digest in found.items()},
        "kills": kills,
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass52.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
