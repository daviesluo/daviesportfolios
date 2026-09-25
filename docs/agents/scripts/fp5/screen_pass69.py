"""Eight UK opens scored against external fair values. Hashed at 2026-09-25 14:34:23 UTC.

The fair value is a public close from Coinbase or from CME futures. The UK book
sets only the open this account can pay. Pass 68 is not rerun.

    python3 docs/agents/scripts/fp5/screen_pass69.py
    python3 docs/agents/scripts/fp5/screen_pass69.py --check
"""
import bisect, hashlib, importlib.util, json, os, random, sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass62/revx")
EXT = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass69")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass69.json")
FROZEN = "2026-09-25 14:34:23 UTC"
STEP = 4 * 3600 * 1000
ORDER = ("rxcbh", "rxcbd", "rxcb24", "rxcb7", "rxcme", "rxcmed", "rxcbsp", "rxcmsp")
PAY = ("rxcbh", "rxcbd", "rxcb24", "rxcb7", "rxcme", "rxcmed")
# kind, lag seconds, btc file, eth file, granularity, family
SPEC = {
    "rxcbh": ("both", 0, "BTCUSD_1h.json", "ETHUSD_1h.json", 3600, "coinbase"),
    "rxcbd": ("both", 0, "BTCUSD_1d.json", "ETHUSD_1d.json", 86400, "coinbase"),
    "rxcb24": ("both", 86400, "BTCUSD_1h.json", "ETHUSD_1h.json", 3600, "coinbase"),
    "rxcb7": ("both", 7 * 86400, "BTCUSD_1d.json", "ETHUSD_1d.json", 86400, "coinbase"),
    "rxcme": ("both", 0, "cme_btcf_1h.json", "cme_ethf_1h.json", 3600, "cme"),
    "rxcmed": ("both", 0, "cme_btcf_1d.json", "cme_ethf_1d.json", 86400, "cme"),
    "rxcbsp": ("split", 0, "BTCUSD_1h.json", "ETHUSD_1h.json", 3600, "coinbase"),
    "rxcmsp": ("split", 0, "cme_btcf_1h.json", "cme_ethf_1h.json", 3600, "cme"),
}
SHA = {
    "rxcbh": "593d369f723c6bff8d94205f5b63632b4bfdbbace8bfedac80003beab0982a9b",
    "rxcbd": "4609bb11858b634355a8e50ec10ed068bf6425dd2b2840ea530ba43feecc139f",
    "rxcb24": "476c18b920f8a2d384fd345c7e70cb6af7829425de27d175fdd46c451efe208f",
    "rxcb7": "afcf646c5b5ef4eb9541054a3c1515dcd44cd4e67aba9bce3fa72016d7f89f0f",
    "rxcme": "0b56cf735855f7cffc661a272164dc3e54c3b71cf95a737846f7076333aabb9a",
    "rxcmed": "dde6700ad17e63ff25deef722fa311ee66377ec9526c919fa6218f155cde96a5",
    "rxcbsp": "ed8f698b4f3461c69ee17a503609456f5557d034795298094aea75c9f28e3a0d",
    "rxcmsp": "0ae6c277c8189abeb7eabca3639c19fa5b884fb399ff56b2a1ab12c056cfbd84",
}
COUNTED = {
    "rxcbh": 904,
    "rxcbd": 950,
    "rxcb24": 976,
    "rxcb7": 1010,
    "rxcme": 1255,
    "rxcmed": 1027,
    "rxcbsp": 399,
    "rxcmsp": 440,
}
CHEAP = {
    "rxcbsp": {"btc": 210, "eth": 189},
    "rxcmsp": {"btc": 283, "eth": 157},
}
# First entry, frozen from the tapes before any return was joined.
FIRST = {
    "rxcbh": (4, "both", 114222.72, 114488.03, 4414.64, 4429.34),
    "rxcbd": (16, "both", 115845.88, 116106.03, 4654.33, 4714.66),
    "rxcb24": (18, "both", 116014.87, 116102.59, 4668.11, 4698.22),
    "rxcb7": (53, "both", 115157.0, 115540.0, 4443.61, 4460.51),
    "rxcme": (0, "both", 113993.1, 114325.0, 4346.87, 4361.0),
    "rxcmed": (16, "both", 115845.88, 117265.0, 4654.33, 4691.5),
    "rxcbsp": (0, "eth", 113993.1, 113918.04, 4346.87, 4347.03),
    "rxcmsp": (11, "btc", 116770.91, 117120.0, 4662.32, 4652.0),
}
COINBASE_PUB = (
    "The time field is the bucket start. The close is published at start + granularity_sec. "
    "A row is usable only when that instant is strictly before the UK entry open."
)
CME_PUB = (
    "Yahoo's timestamp is the bar start. A null close is not a trade and is omitted. "
    "A non-null close is published at start + granularity_sec. "
    "A row is usable only when that instant is strictly before the UK entry open. "
    "Gaps are not interpolated."
)
GAP_1H = (
    (datetime(2025, 10, 25, 15, tzinfo=timezone.utc), datetime(2025, 10, 25, 21, tzinfo=timezone.utc)),
    (datetime(2026, 5, 8, 1, tzinfo=timezone.utc), datetime(2026, 5, 8, 7, tzinfo=timezone.utc)),
)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def require_rules():
    found = {}
    for name in ORDER:
        have = sha256_file(os.path.join(RULES, name + "_rule.txt"))
        if have != SHA[name]:
            raise SystemExit("rule text moved after the freeze: %s %s" % (name, have))
        with open(os.path.join(RULES, name + "_rule.frozen_at")) as f:
            stamp = f.read().strip()
        if stamp != FROZEN:
            raise SystemExit("freeze moved: %s %s" % (name, stamp))
        found[name] = have
    return found


def load_book(symbol):
    path = os.path.join(INP, symbol + "_240.json")
    with open(path) as f:
        doc = json.load(f)
    if doc.get("region") != "UK" or doc.get("interval") != 240 or doc.get("symbol") != symbol:
        raise SystemExit("not the UK book %s" % symbol)
    for call in doc["calls"]:
        url = call["url"]
        if "region=UK" not in url or "region=EEA" in url or call["status"] != 200:
            raise SystemExit("call is not UK %s" % url)
        if symbol not in url:
            raise SystemExit("call is another pair %s" % url)
    rows = []
    seen = set()
    for row in doc["rows"]:
        start = int(row["start"])
        if start % 1000 != 0:
            raise SystemExit("start is not a whole second %s" % start)
        if start in seen:
            raise SystemExit("duplicate start %s" % start)
        seen.add(start)
        vol = float(row["volume"])
        opened = float(row["open"])
        high = float(row["high"])
        low = float(row["low"])
        closed = float(row["close"])
        if vol <= 0 or min(opened, high, low, closed) <= 0:
            raise SystemExit("bar is not a trade %s %s" % (symbol, start))
        if high < max(opened, closed) or low > min(opened, closed) or high < low:
            raise SystemExit("bar extremes %s %s" % (symbol, start))
        rows.append((start, opened, high, low, closed, vol))
    if len(rows) != 2262:
        raise SystemExit("bar count %s %d" % (symbol, len(rows)))
    for i in range(1, len(rows)):
        if rows[i][0] - rows[i - 1][0] != STEP:
            raise SystemExit("gap %s %d" % (symbol, i))
    return rows


def stamp(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc)


def gap_pairs(starts, gran):
    out = []
    for i in range(1, len(starts)):
        if starts[i] - starts[i - 1] != gran:
            out.append(
                (
                    datetime.fromtimestamp(starts[i - 1], timezone.utc),
                    datetime.fromtimestamp(starts[i], timezone.utc),
                )
            )
    return out


def load_fair(filename, gran, family):
    path = os.path.join(EXT, filename)
    with open(path) as f:
        doc = json.load(f)
    if doc.get("fields") != ["start_sec", "close"]:
        raise SystemExit("fair value file has more than a close %s" % filename)
    if int(doc["granularity_sec"]) != gran:
        raise SystemExit("granularity %s" % filename)
    starts = []
    closes = []
    for row in doc["rows"]:
        if len(row) != 2:
            raise SystemExit("row width %s" % filename)
        start = int(row[0])
        close = float(row[1])
        if close <= 0:
            raise SystemExit("nonpositive close %s" % filename)
        starts.append(start)
        closes.append(close)
    if starts != sorted(starts) or len(starts) != len(set(starts)):
        raise SystemExit("starts %s" % filename)
    if family == "coinbase":
        if doc.get("source") != "Coinbase Exchange" or doc.get("publication") != COINBASE_PUB:
            raise SystemExit("coinbase header %s" % filename)
        if doc.get("fetched_at") != "2026-09-25 14:22:58 UTC":
            raise SystemExit("coinbase fetch %s" % filename)
        product = doc["product"]
        url = "https://api.exchange.coinbase.com/products/%s/candles" % product
        if doc.get("url") != url:
            raise SystemExit("coinbase url %s" % filename)
        if filename.startswith("BTC") and product != "BTC-USD":
            raise SystemExit("coinbase product %s" % filename)
        if filename.startswith("ETH") and product != "ETH-USD":
            raise SystemExit("coinbase product %s" % filename)
        gaps = gap_pairs(starts, gran)
        if gran == 3600:
            if len(doc["rows"]) != 9303 or doc.get("gaps") != 2 or gaps != list(GAP_1H):
                raise SystemExit("coinbase hourly gaps %s %s" % (filename, gaps))
        elif gran == 86400:
            if len(doc["rows"]) != 389 or doc.get("gaps") != 0 or gaps:
                raise SystemExit("coinbase daily gaps %s" % filename)
        else:
            raise SystemExit("coinbase gran")
    elif family == "cme":
        if doc.get("source") != "Yahoo Finance chart, CME futures":
            raise SystemExit("cme source %s" % filename)
        if doc.get("publication") != CME_PUB or doc.get("exchange") != "CME":
            raise SystemExit("cme header %s" % filename)
        if doc.get("instrument") != "FUTURE" or doc.get("gmtoffset_sec") != -14400:
            raise SystemExit("cme instrument %s" % filename)
        if doc.get("fetched_at") != "2026-09-25 14:30:33 UTC":
            raise SystemExit("cme fetch %s" % filename)
        if doc.get("rows_kept") != len(starts):
            raise SystemExit("cme rows %s" % filename)
        expect = {
            "cme_btcf_1h.json": ("BTC=F", "1h", 7726, 1434, 6292),
            "cme_ethf_1h.json": ("ETH=F", "1h", 7726, 1491, 6235),
            "cme_btcf_1d.json": ("BTC=F", "1d", 268, 0, 268),
            "cme_ethf_1d.json": ("ETH=F", "1d", 268, 0, 268),
        }[filename]
        got = (
            doc.get("symbol"),
            doc.get("interval"),
            doc.get("raw_timestamps"),
            doc.get("null_closes"),
            len(starts),
        )
        if got != expect:
            raise SystemExit("cme shape %s %s" % (filename, got))
        encoded = expect[0].replace("=", "%3D")
        if encoded not in doc.get("url", "") or ("interval=" + expect[1]) not in doc["url"]:
            raise SystemExit("cme url %s" % filename)
        if "query1.finance.yahoo.com/v8/finance/chart/" not in doc["url"]:
            raise SystemExit("cme host %s" % filename)
    else:
        raise SystemExit("family %s" % family)
    ends = [start + gran for start in starts]
    if ends != sorted(ends):
        raise SystemExit("publish order %s" % filename)
    return ends, closes


def load_books():
    cache = {}
    books = {}
    hashes = {}
    for name in ORDER:
        _kind, _lag, btc_file, eth_file, gran, family = SPEC[name]
        for filename in (btc_file, eth_file):
            if filename not in cache:
                cache[filename] = load_fair(filename, gran, family)
                hashes[filename] = sha256_file(os.path.join(EXT, filename))
        books[name] = cache[btc_file] + cache[eth_file]
    return books, hashes


def last_fv(ends, closes, entry_sec, lag):
    """Last close whose publication is strictly before entry_sec - lag."""
    cutoff = entry_sec - lag
    j = bisect.bisect_left(ends, cutoff) - 1
    if j < 0:
        return None
    return ends[j], closes[j]


def side_at(kind, btc_open, eth_open, fb, fe):
    if fb is None or fe is None:
        return None
    btc_cheap = btc_open < fb
    eth_cheap = eth_open < fe
    btc_rich = btc_open > fb
    eth_rich = eth_open > fe
    if kind == "both":
        if btc_cheap and eth_cheap:
            return "both"
        return None
    if kind == "split":
        if btc_cheap and eth_rich:
            return "btc"
        if eth_cheap and btc_rich:
            return "eth"
        return None
    raise SystemExit("unknown kind %s" % kind)


def signals_for(name, btc, eth, books):
    kind, lag, _bf, _ef, _gran, _family = SPEC[name]
    be, bc, ee, ec = books[name]
    out = []
    for i in range(len(btc) - 1):
        t = btc[i][0] // 1000
        fb = last_fv(be, bc, t, lag)
        fe = last_fv(ee, ec, t, lag)
        side = side_at(
            kind,
            btc[i][1],
            eth[i][1],
            None if fb is None else fb[1],
            None if fe is None else fe[1],
        )
        if side:
            out.append((i, side))
    return out


def eligible_for(name, btc, eth, books):
    _kind, lag, _bf, _ef, _gran, _family = SPEC[name]
    be, bc, ee, ec = books[name]
    out = []
    for i in range(len(btc) - 1):
        t = btc[i][0] // 1000
        if last_fv(be, bc, t, lag) is None or last_fv(ee, ec, t, lag) is None:
            continue
        out.append(i)
    return out


def prior_sets():
    scored = []
    names = (
        "screen_pass62",
        "screen_pass63",
        "screen_pass64",
        "screen_pass65",
        "screen_pass66",
        "screen_pass67",
    )
    for mod_name in names:
        spec = importlib.util.spec_from_file_location(mod_name, os.path.join(RULES, mod_name + ".py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        btc = mod.load_book("BTC-USD")
        eth = mod.load_book("ETH-USD")
        for name in mod.SHA:
            got = mod.signals_for(name, btc, eth)
            if got and not isinstance(got[0], int):
                raise SystemExit("prior shape %s" % mod_name)
            scored.append(list(got))
            scored.append([i + 1 for i in got])
    spec = importlib.util.spec_from_file_location("screen_pass68", os.path.join(RULES, "screen_pass68.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    btc = mod.load_book("BTC-USD")
    eth = mod.load_book("ETH-USD")
    for name in mod.ORDER:
        got = mod.signals_for(name, btc, eth)
        # Pass 68 already enters at the signal index. That index is the scored set.
        scored.append([i for i, _side in got])
    if len(scored) != 104:
        raise SystemExit("prior rules %d" % len(scored))
    return scored


def move_bps(book, i):
    return (book[i + 1][1] / book[i][1] - 1.0) * 10000.0


def score(pairs, btc, eth, cost):
    btc_pnl = 0.0
    eth_pnl = 0.0
    months = {}
    charge = cost + cost
    for i, side in pairs:
        btc_move = move_bps(btc, i)
        eth_move = move_bps(eth, i)
        if side == "both":
            btc_pnl += btc_move - charge
            eth_pnl += eth_move - charge
            inc = (btc_move - charge + eth_move - charge) / 2.0
        elif side == "btc":
            btc_pnl += btc_move - charge
            inc = (btc_move - charge) / 2.0
        elif side == "eth":
            eth_pnl += eth_move - charge
            inc = (eth_move - charge) / 2.0
        else:
            raise SystemExit("side %s" % side)
        month = stamp(btc[i][0]).strftime("%Y-%m")
        months[month] = months.get(month, 0.0) + inc
    return {
        "pool": (btc_pnl + eth_pnl) / 2.0,
        "btc": btc_pnl,
        "eth": eth_pnl,
        "trips": len(pairs),
        "months": months,
    }


def hand_sum(pairs, btc, eth):
    """Recompute the pool from raw opens. Does not call score."""
    pool = 0.0
    for i, side in pairs:
        btc_bps = move_bps(btc, i) - 40.0
        eth_bps = move_bps(eth, i) - 40.0
        if side == "both":
            pool += (btc_bps + eth_bps) / 2.0
        elif side == "btc":
            pool += btc_bps / 2.0
        elif side == "eth":
            pool += eth_bps / 2.0
        else:
            raise SystemExit("side %s" % side)
    return pool, len(pairs)


def null_long(eligible, n_trips, btc, eth, cost):
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    rng = random.Random(20260925)
    pools = []
    charge = cost + cost
    for _ in range(500):
        chosen = rng.sample(eligible, n_trips)
        pool = 0.0
        for i in chosen:
            btc_move = move_bps(btc, i)
            eth_move = move_bps(eth, i)
            pool += (btc_move - charge + eth_move - charge) / 2.0
        pools.append(pool)
    pools.sort()
    return (pools[249] + pools[250]) / 2.0, pools[474]


def month_share(scored):
    if scored["pool"] <= 0:
        return None, None, None
    month, pnl = max(scored["months"].items(), key=lambda kv: kv[1])
    return pnl / scored["pool"], month, pnl


def make_book(opens, entry_sec):
    rows = []
    for i, opened in enumerate(opens):
        opened = float(opened)
        rows.append((entry_sec * 1000 + i * STEP, opened, opened, opened, opened, 1.0))
    return rows


def pack(pub, btc_close, eth_close):
    return [pub], [float(btc_close)], [pub], [float(eth_close)]


def self_check():
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    if SPEC["rxcb24"][1] != 86400 or SPEC["rxcb7"][1] != 604800:
        raise SystemExit("lag moved")
    entry = 1700000000
    cheap_btc = make_book([99, 110], entry)
    cheap_eth = make_book([9, 8], entry)
    books = {}
    for name in ORDER:
        lag = SPEC[name][1]
        books[name] = pack(entry - lag - 1, 100, 10)
    if signals_for("rxcbh", cheap_btc, cheap_eth, books) != [(0, "both")]:
        raise SystemExit("rxcbh fixture")
    if signals_for("rxcbd", cheap_btc, cheap_eth, books) != [(0, "both")]:
        raise SystemExit("rxcbd fixture")
    if signals_for("rxcme", cheap_btc, cheap_eth, books) != [(0, "both")]:
        raise SystemExit("rxcme fixture")
    if signals_for("rxcmed", cheap_btc, cheap_eth, books) != [(0, "both")]:
        raise SystemExit("rxcmed fixture")
    if signals_for("rxcb24", cheap_btc, cheap_eth, books) != [(0, "both")]:
        raise SystemExit("rxcb24 fixture")
    if signals_for("rxcb7", cheap_btc, cheap_eth, books) != [(0, "both")]:
        raise SystemExit("rxcb7 fixture")
    if signals_for("rxcbsp", cheap_btc, cheap_eth, books):
        raise SystemExit("both cheap is not the spread")
    if signals_for("rxcmsp", cheap_btc, cheap_eth, books):
        raise SystemExit("both cheap is not the cme spread")
    books["rxcbh"] = pack(entry, 100, 10)
    if signals_for("rxcbh", cheap_btc, cheap_eth, books):
        raise SystemExit("a close published at the open is not usable")
    books["rxcbh"] = pack(entry - 1, 99, 9)
    if signals_for("rxcbh", cheap_btc, cheap_eth, books):
        raise SystemExit("an equal open is not cheap")
    books["rxcb24"] = pack(entry - 86400, 100, 10)
    if signals_for("rxcb24", cheap_btc, cheap_eth, books):
        raise SystemExit("a close published exactly 24h earlier is not old enough")
    books["rxcb7"] = pack(entry - 7 * 86400, 100, 10)
    if signals_for("rxcb7", cheap_btc, cheap_eth, books):
        raise SystemExit("a close published exactly 7d earlier is not old enough")
    books["rxcbsp"] = pack(entry - 1, 100, 10)
    if signals_for("rxcbsp", make_book([99, 110], entry), make_book([11, 8], entry), books) != [(0, "btc")]:
        raise SystemExit("rxcbsp btc fixture")
    if signals_for("rxcbsp", make_book([101, 110], entry), make_book([9, 8], entry), books) != [(0, "eth")]:
        raise SystemExit("rxcbsp eth fixture")
    if signals_for("rxcbsp", make_book([101, 110], entry), make_book([11, 8], entry), books):
        raise SystemExit("both rich is not a spread")
    books["rxcmsp"] = pack(entry - 1, 100, 10)
    if signals_for("rxcmsp", make_book([99, 110], entry), make_book([11, 8], entry), books) != [(0, "btc")]:
        raise SystemExit("rxcmsp fixture")
    one_book = make_book([100, 110], entry)
    one_eth = make_book([10, 9], entry)
    both = score([(0, "both")], one_book, one_eth, 20.0)
    btc_hand = (110.0 / 100.0 - 1.0) * 10000.0 - 40.0
    eth_hand = (9.0 / 10.0 - 1.0) * 10000.0 - 40.0
    if both["trips"] != 1 or abs(both["pool"] - (btc_hand + eth_hand) / 2.0) > 1e-9:
        raise SystemExit("one uk trip")
    lone = score([(0, "btc")], one_book, one_eth, 20.0)
    if abs(lone["pool"] - btc_hand / 2.0) > 1e-9 or lone["eth"] != 0.0:
        raise SystemExit("a flat book is not a fill")
    hand, n_hand = hand_sum([(0, "both")], one_book, one_eth)
    if n_hand != 1 or abs(hand - both["pool"]) > 1e-9:
        raise SystemExit("hand sum")
    stress = score([(0, "both")], one_book, one_eth, 40.0)
    if abs((both["pool"] - stress["pool"]) - 40.0) > 1e-9:
        raise SystemExit("both-book cost gap")
    stress_one = score([(0, "btc")], one_book, one_eth, 40.0)
    if abs((lone["pool"] - stress_one["pool"]) - 20.0) > 1e-9:
        raise SystemExit("one-book cost gap")
    try:
        side_at("nope", 1, 1, 2, 2)
    except SystemExit as exc:
        if "unknown kind" not in str(exc):
            raise
    else:
        raise SystemExit("unknown kind slipped through")


def near(a, b):
    return abs(a - b) < 1e-6


def main():
    self_check()
    check = "--check" in sys.argv
    found = require_rules()
    btc = load_book("BTC-USD")
    eth = load_book("ETH-USD")
    if [item[0] for item in btc] != [item[0] for item in eth]:
        raise SystemExit("books are not aligned")
    if stamp(btc[0][0]) != datetime(2025, 9, 11, tzinfo=timezone.utc):
        raise SystemExit("first bar")
    if stamp(btc[-1][0]) != datetime(2026, 9, 22, 20, tzinfo=timezone.utc):
        raise SystemExit("last bar")
    books, inputs = load_books()
    windows = {}
    for name in ORDER:
        window = eligible_for(name, btc, eth, books)
        if len(window) != 2261 or window != list(range(2261)):
            raise SystemExit("window moved %s %d" % (name, len(window)))
        windows[name] = window
    scored_prior = prior_sets()
    entries = {}
    for name in ORDER:
        got = signals_for(name, btc, eth, books)
        if len(got) != COUNTED[name]:
            raise SystemExit("count moved before scoring %s %d" % (name, len(got)))
        if len(got) == 0 or len(got) == len(windows[name]):
            raise SystemExit("not interior %s" % name)
        idx = [i for i, _side in got]
        if idx != sorted(idx):
            raise SystemExit("entries are not in order %s" % name)
        if name in PAY:
            if any(side != "both" for _i, side in got):
                raise SystemExit("a pay rule skipped a book %s" % name)
        else:
            sides = {"btc": 0, "eth": 0}
            for _i, side in got:
                if side not in sides:
                    raise SystemExit("spread side %s %s" % (name, side))
                sides[side] += 1
            if sides != CHEAP[name]:
                raise SystemExit("cheap side moved %s %s" % (name, sides))
        i0, side0, btc_open, btc_fv, eth_open, eth_fv = FIRST[name]
        if got[0][0] != i0 or got[0][1] != side0:
            raise SystemExit("first entry moved %s %s" % (name, got[0]))
        if not near(btc[i0][1], btc_open) or not near(eth[i0][1], eth_open):
            raise SystemExit("first open moved %s" % name)
        _kind, lag, _bf, _ef, _gran, _family = SPEC[name]
        be, bc, ee, ec = books[name]
        fb = last_fv(be, bc, btc[i0][0] // 1000, lag)
        fe = last_fv(ee, ec, eth[i0][0] // 1000, lag)
        if fb is None or fe is None or not near(fb[1], btc_fv) or not near(fe[1], eth_fv):
            raise SystemExit("first fair value moved %s" % name)
        if not fb[0] < (btc[i0][0] // 1000) - lag or not fe[0] < (eth[i0][0] // 1000) - lag:
            raise SystemExit("first fair value is not yet published %s" % name)
        entries[name] = got
    fresh = [[i for i, _side in entries[name]] for name in ORDER]
    for i, left in enumerate(fresh):
        left_set = set(left)
        for right in fresh[i + 1 :]:
            if left == right:
                raise SystemExit("two rules are the same bars")
            right_set = set(right)
            if left_set <= right_set or right_set <= left_set:
                raise SystemExit("one rule is a subset of another")
            inter = len(left_set & right_set)
            union = len(left_set | right_set)
            if inter / union >= 0.75:
                raise SystemExit("two rules are too close")
        for old in scored_prior:
            if left == old:
                raise SystemExit("a rule repeats bars already scored")
    # The spread is the opposite-sign case. It shares no bar with the same-source both-below rule.
    if set(fresh[ORDER.index("rxcbsp")]) & set(fresh[ORDER.index("rxcbh")]):
        raise SystemExit("coinbase spread overlaps both-below")
    if set(fresh[ORDER.index("rxcmsp")]) & set(fresh[ORDER.index("rxcme")]):
        raise SystemExit("cme spread overlaps both-below")
    kills = {}
    lines = []
    for name in ORDER:
        base = score(entries[name], btc, eth, 20.0)
        stress = score(entries[name], btc, eth, 40.0)
        expect = 40.0 * base["trips"] if name in PAY else 20.0 * base["trips"]
        if abs((base["pool"] - stress["pool"]) - expect) > 1e-4:
            raise SystemExit("cost gap %s %.6f %.1f" % (name, base["pool"] - stress["pool"], expect))
        p50, p95 = null_long(windows[name], base["trips"], btc, eth, 20.0)
        share, month, month_pnl = month_share(base)
        reasons = []
        if not base["pool"] > 0:
            reasons.append("pooled P&L is not positive")
        if not stress["pool"] > 0:
            reasons.append("doubled cost is not positive")
        if base["trips"] < 60:
            reasons.append("fewer than 60 round trips")
        if not (base["btc"] > 0 and base["eth"] > 0):
            reasons.append("one book is not positive")
        if not base["pool"] > p95:
            reasons.append("does not beat the random long-both null")
        if share is not None and share > 0.40:
            reasons.append("one month is more than 40% of P&L")
        if not base["pool"] > 400:
            reasons.append("pooled P&L does not exceed 400 bps")
        clear = len(reasons) == 0
        row_out = {
            "name": name + "_2025",
            "edge": "pay_below_external_close" if name in PAY else "external_cross_book_spread",
            "source": SPEC[name][5],
            "fill": "uk_4h_printed_open_to_next_open",
            "pool_bps": round(base["pool"], 1),
            "stress_bps": round(stress["pool"], 1),
            "trips": base["trips"],
            "long_days": base["trips"],
            "execution_bars": len(windows[name]),
            "signals_without_open": 0,
            "btc_bps": round(base["btc"], 1),
            "eth_bps": round(base["eth"], 1),
            "null_p50_bps": round(p50, 1),
            "null_p95_bps": round(p95, 1),
            "month_share": None if share is None else round(share, 3),
            "top_month": month,
            "top_month_bps": None if month_pnl is None else round(month_pnl, 1),
            "candle_bar_clear": clear,
            "why": (
                "UK open numeric bar is clear; not a testing row and not paper testing"
                if clear
                else "; ".join(reasons)
            ),
        }
        hand, n_hand = hand_sum(entries[name], btc, eth)
        if n_hand != row_out["trips"] or abs(hand - base["pool"]) > 0.1 or abs(hand - row_out["pool_bps"]) > 0.1:
            raise SystemExit("hand sum mismatch %s" % name)
        print(
            "COST %s trips %d gap %.1f expected %.1f share %s"
            % (name, row_out["trips"], row_out["pool_bps"] - row_out["stress_bps"], expect, row_out["month_share"]),
            flush=True,
        )
        i0, side0 = entries[name][0]
        _i, _side, btc_open, btc_fv, eth_open, eth_fv = FIRST[name]
        btc_move = move_bps(btc, i0)
        print(
            "FIRST %s %s entry %s exit %s BTC %.2f fv %.2f -> %.2f ETH %.2f fv %.2f -> %.2f btc %+.4f"
            % (
                name,
                side0,
                stamp(btc[i0][0]).strftime("%Y-%m-%d %H:%M"),
                stamp(btc[i0 + 1][0]).strftime("%Y-%m-%d %H:%M"),
                btc_open,
                btc_fv,
                btc[i0 + 1][1],
                eth_open,
                eth_fv,
                eth[i0 + 1][1],
                btc_move,
            ),
            flush=True,
        )
        print(
            "BOOK %s pool %.6f stress %.6f btc %.6f eth %.6f p95 %.6f"
            % (name, base["pool"], stress["pool"], base["btc"], base["eth"], p95),
            flush=True,
        )
        if share is not None:
            print(
                "UNROUNDED %s share %.6f month %s pnl %.6f pool %.6f"
                % (name, share, month, month_pnl, base["pool"]),
                flush=True,
            )
        kills[name + "_2025"] = row_out
        lines.append("%s is %.1f bps over %d trips" % (name, row_out["pool_bps"], row_out["trips"]))
    summary = {
        "reached_preregistration": False,
        "inputs_sha256": inputs,
        "note": (
            "Each rule was hashed at 2026-09-25 14:34:23 UTC, before its own result. "
            "Pass 68 priced the UK book's own opens, means, ratios, and last trades. "
            "It does not count as an external fair value and it is not rerun. "
            "Every fill is a printed UK four-hour open to the next UK four-hour open. "
            "The books are BTC-USD and ETH-USD, region=UK, the same pull as pass 62. "
            "EEA candles are not read. No other pair is stood in. "
            "Fair value is an external close already published strictly before that open. "
            "Four rules use Coinbase Exchange public candles. "
            "Four rules use CME futures closes from the Yahoo Finance chart, symbols BTC=F and ETH=F. "
            "Bitstamp was counted and not frozen: its hourly both-below set is 906 against Coinbase 904, "
            "Jaccard 0.955, and its daily set is 952 against 950, Jaccard 0.992. "
            "The CME 24-hour both-below set, Jaccard 0.818 with the Coinbase 24-hour rule, was not frozen. "
            "The CME 7-day both-below set, Jaccard 0.838 with the Coinbase 7-day rule, was not frozen. "
            "Six rules buy both books when each UK open is strictly below its own external close. "
            "Two rules buy only the book that is strictly below its external close while the other book "
            "is strictly above its own. Spot is not shorted. The rich book is not the control and is not scored. "
            "Buying every eligible bar is not reported. "
            "The null is 500 long-both draws from that rule's own window, seed 20260925, index 474. "
            "The UK high, low, close, mean, ratio, and last trade are not the fair value. "
            "Passes 62 through 67 are not rerun and their signs are not flipped. "
            "No rule here selects the same entry bars as one already scored. "
            "No chosen set is a subset of another, and no pair has Jaccard at or above 0.75. "
            "Counts before any return were 904, 950, 976, 1010, 1255, 1027, 399, and 440. "
            "The 60-trip gate is not lowered. "
            + " ".join(lines)
            + ". No testing row is opened. A numeric clear on these UK opens is still not paper testing, "
            "because no order of this account was shown crossing the book. "
            "The five earlier numeric clears and the confirmation-time fall after a higher day stay void. "
            "The pass 67 result of +263.2 bps over 17 trips stays not close to a pass."
        ),
        "rules": {name + "_rule_sha256": found[name] for name in ORDER},
        "kills": kills,
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass69.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
