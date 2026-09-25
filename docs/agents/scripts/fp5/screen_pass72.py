"""Six UK opens scored against published USD-per-coin forwards.

Hashed at 2026-09-25 19:55:07 UTC. Two further slots were not opened.
A seventh or eighth rule would have been another company, another threshold,
another lag, or another coin.

    python3 docs/agents/scripts/fp5/screen_pass72.py
    python3 docs/agents/scripts/fp5/screen_pass72.py --check
"""
import bisect, hashlib, importlib.util, json, os, random, re, sys
from collections import defaultdict
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass62/revx")
EXT = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass72")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass72.json")
FROZEN = "2026-09-25 19:55:07 UTC"
STEP = 4 * 3600 * 1000
HOUR = 3600 * 1000
DAY = 86400 * 1000
YEAR = 365.25 * DAY
AGE = 24 * HOUR
ORDER = ("rxfwd", "rxopt", "rxqimp", "rxfimp", "rxmed", "rxeoy")
SHA = {
    "rxfwd": "1b1aa63cfb747f957b81bb3d0c4454948021bbbbcaf8da570650dd5a49fa7a65",
    "rxopt": "da89c0b23bc17efa76edd8ee1c1e10dd7c58f468a923c39bb741a7ed1ba5842f",
    "rxqimp": "9f11c6b4c39b340f21b533b8284e5ff9b19d47945e1e4dfe811963cafdf55797",
    "rxfimp": "e20f6b30c05b512e42a582803cb8f802b8fca0ff917b36e8676e38b62662e59f",
    "rxmed": "70f86187821fd7b1f04ac449ef642697d99e7647e8d98c4cba81be2b3c54dbc5",
    "rxeoy": "bb5c983584698ede822e713d6e5cc113fbae4bd959641d5f451c045b410b37ab",
}
COUNTED = {"rxfwd": 927, "rxopt": 889, "rxqimp": 753, "rxfimp": 1104, "rxmed": 660, "rxeoy": 802}
ELIG = {"rxfwd": 2261, "rxopt": 2257, "rxqimp": 2261, "rxfimp": 2261, "rxmed": 1360, "rxeoy": 1233}
FIRST = {"rxfwd": 4, "rxopt": 9, "rxqimp": 0, "rxfimp": 2, "rxmed": 22, "rxeoy": 1022}
FIRST_ELIG = {"rxfwd": 0, "rxopt": 0, "rxqimp": 0, "rxfimp": 0, "rxmed": 0, "rxeoy": 1014}
DISC = {
    "rxfwd": (22.5157, 28.5368, 26.5084),
    "rxopt": (137.7038, 174.1652, 154.6402),
    "rxqimp": (38.4401, 34.3747, 37.8132),
    "rxfimp": (47.0618, 48.2683, 48.0890),
    "rxmed": (229.5463, 349.9762, 295.4468),
    "rxeoy": (339.3923, 495.3762, 427.0751),
}
SOURCE = {
    "rxfwd": "deribit_funding_forward",
    "rxopt": "deribit_atm_synthetic",
    "rxqimp": "treasury_implied_quarterly",
    "rxfimp": "funding_implied_quarterly",
    "rxmed": "deribit_straddle_median",
    "rxeoy": "kalshi_year_end_median",
}
EDGE = {
    "rxfwd": "settled_funding_forward",
    "rxopt": "front_friday_synthetic",
    "rxqimp": "tbill_implied_spot",
    "rxfimp": "funding_implied_spot",
    "rxmed": "straddle_median",
    "rxeoy": "year_end_forecast_median",
}
MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}
Q_NAMES = (
    "BTC-26SEP25", "BTC-26DEC25", "BTC-27MAR26", "BTC-26JUN26", "BTC-25SEP26",
    "ETH-26SEP25", "ETH-26DEC25", "ETH-27MAR26", "ETH-26JUN26", "ETH-25SEP26",
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
            stamp_at = f.read().strip()
        if stamp_at != FROZEN:
            raise SystemExit("freeze moved: %s %s" % (name, stamp_at))
        found[name] = have
    return found


def stamp(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc)


def discount_bps(fair, paid):
    return (fair / paid - 1.0) * 10000.0


def near(a, b):
    return abs(a - b) <= 1e-6 * max(1.0, abs(b))


def latest_i(pubs, t):
    return bisect.bisect_left(pubs, t) - 1


def rising(pubs, label):
    for i in range(1, len(pubs)):
        if pubs[i] <= pubs[i - 1]:
            raise SystemExit("publication is not rising %s" % label)


def expiry_ms(token):
    matched = re.fullmatch(r"(\d{1,2})([A-Z]{3})(\d{2})", token)
    if matched is None:
        raise SystemExit("expiry %s" % token)
    when = datetime(
        2000 + int(matched.group(3)),
        MONTHS[matched.group(2)],
        int(matched.group(1)),
        8,
        tzinfo=timezone.utc,
    )
    return int(when.timestamp() * 1000)


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


def load_funding(name, instrument, first, last):
    path = os.path.join(EXT, name)
    with open(path) as f:
        doc = json.load(f)
    if doc["url"] != "https://www.deribit.com/api/v2/public/get_funding_rate_history":
        raise SystemExit("funding url")
    if doc["instrument"] != instrument:
        raise SystemExit("funding instrument")
    if doc["fields"] != ["timestamp_ms", "index_price", "interest_8h"]:
        raise SystemExit("funding fields")
    if len(doc["rows"]) != 9159:
        raise SystemExit("funding rows")
    if doc["rows"][0] != first or doc["rows"][-1] != last:
        raise SystemExit("funding ends")
    pubs, idx, rate = [], [], []
    for row in doc["rows"]:
        pubs.append(int(row[0]))
        idx.append(float(row[1]))
        rate.append(float(row[2]))
        if idx[-1] <= 0:
            raise SystemExit("index is not a price")
    rising(pubs, instrument)
    return pubs, idx, rate, sha256_file(path)


def parabola_vertex(x0, y0, x1, y1, x2, y2):
    if x1 == x0 or x2 == x1 or x2 == x0:
        return None
    a = ((y2 - y1) / (x2 - x1) - (y1 - y0) / (x1 - x0)) / (x2 - x0)
    if a == 0:
        return None
    b = (y1 - y0) / (x1 - x0) - a * (x1 + x0)
    return -b / (2 * a), a


def chain_rows(book, exp, tick):
    rows = []
    for strike, sides in book[exp].items():
        if "C" not in sides or "P" not in sides:
            continue
        ct, cc, cv = sides["C"]
        pt, pc, pv = sides["P"]
        ic = bisect.bisect_left(ct, tick)
        ip = bisect.bisect_left(pt, tick)
        if ic >= len(ct) or ct[ic] != tick or ip >= len(pt) or pt[ip] != tick:
            continue
        if cv[ic] <= 0 or pv[ip] <= 0:
            continue
        spread = cc[ic] - pc[ip]
        if not (spread < 0.8 and (1.0 - spread) > 0.05):
            continue
        fair = strike / (1.0 - spread)
        if not (0.5 * strike <= fair <= 1.5 * strike):
            continue
        rows.append((strike, cc[ic], pc[ip], fair, abs(spread)))
    rows.sort()
    return rows


def build_opt_pubs(book, lo, hi, kind):
    ticks = set()
    for strikes in book.values():
        for sides in strikes.values():
            for _cp, (ts, _close, _vol) in sides.items():
                ticks.update(ts)
    out = []
    for tick in sorted(ticks):
        pub = tick + DAY
        cands = sorted(exp for exp in book if (pub + lo * DAY) < exp <= (pub + hi * DAY))
        if not cands:
            continue
        if kind == "parity":
            got = chain_rows(book, cands[0], tick)
            if not got:
                continue
            fair = min(got, key=lambda row: row[4])[3]
            out.append((pub, fair, cands[0]))
            continue
        rows = None
        exp = None
        for exp_i in cands:
            got = chain_rows(book, exp_i, tick)
            if len(got) >= 3:
                rows = got
                exp = exp_i
                break
        if rows is None:
            continue
        atm = min(rows, key=lambda row: row[4])[3]
        straddles = [(k, c + p) for k, c, p, _fair, _gap in rows]
        best_i = min(range(len(straddles)), key=lambda i: straddles[i][1])
        if best_i == 0 or best_i == len(straddles) - 1:
            continue
        k0, s0 = straddles[best_i - 1]
        k1, s1 = straddles[best_i]
        k2, s2 = straddles[best_i + 1]
        vert = parabola_vertex(k0, s0, k1, s1, k2, s2)
        med = k1
        if vert is not None:
            v, a = vert
            if a > 0 and k0 <= v <= k2:
                med = v
        if not (0.8 * atm <= med <= 1.2 * atm):
            continue
        out.append((pub, med, exp))
    return out


def load_options():
    path = os.path.join(EXT, "deribit_options.json")
    with open(path) as f:
        doc = json.load(f)
    if doc["url"] != "https://www.deribit.com/api/v2/public/get_tradingview_chart_data":
        raise SystemExit("option url")
    if doc["resolution"] != "1D" or doc["fields"] != ["ticks", "close", "volume"]:
        raise SystemExit("option fields")
    if len(doc["series"]) != 1032:
        raise SystemExit("option series")
    book = {"BTC": defaultdict(lambda: defaultdict(dict)), "ETH": defaultdict(lambda: defaultdict(dict))}
    parsed = 0
    for key, series in doc["series"].items():
        parts = key.split("-")
        if len(parts) != 4:
            raise SystemExit("option name %s" % key)
        coin, token, strike, cp = parts
        if coin not in book or cp not in ("C", "P"):
            raise SystemExit("option name %s" % key)
        if not series["ticks"]:
            raise SystemExit("empty option %s" % key)
        book[coin][expiry_ms(token)][float(strike)][cp] = (
            series["ticks"], series["close"], series["volume"],
        )
        parsed += 1
    if parsed != 1032:
        raise SystemExit("parsed options")
    opt = {coin: build_opt_pubs(book[coin], 2, 9, "parity") for coin in book}
    med = {coin: build_opt_pubs(book[coin], 2, 40, "median") for coin in book}
    if len(opt["BTC"]) != 378 or len(opt["ETH"]) != 347:
        raise SystemExit("parity publications")
    if len(med["BTC"]) != 171 or len(med["ETH"]) != 86:
        raise SystemExit("median publications")
    return opt, med, sha256_file(path)


def load_quarterlies():
    path = os.path.join(EXT, "deribit_quarterlies.json")
    with open(path) as f:
        doc = json.load(f)
    if doc["url"] != "https://www.deribit.com/api/v2/public/get_tradingview_chart_data":
        raise SystemExit("future url")
    if doc["resolution"] != "60" or doc["fields"] != ["open_ms", "close"]:
        raise SystemExit("future fields")
    if tuple(doc["books"]) != Q_NAMES:
        raise SystemExit("future names")
    out = {"BTC": [], "ETH": []}
    for name, rows in doc["books"].items():
        coin, token = name.split("-", 1)
        exp = expiry_ms(token)
        pubs, closes = [], []
        for open_ms, close in rows:
            pub = int(open_ms) + HOUR
            if pub > exp or close is None or float(close) <= 0:
                continue
            pubs.append(pub)
            closes.append(float(close))
        rising(pubs, name)
        out[coin].append((exp, pubs, closes))
    for coin in out:
        out[coin].sort()
        if len(out[coin]) != 5:
            raise SystemExit("quarterlies %s" % coin)
    return out, sha256_file(path)


def load_treasury():
    path = os.path.join(EXT, "treasury_3m.json")
    with open(path) as f:
        doc = json.load(f)
    url = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv"
    if doc["url"] != url or doc["fields"] != ["date_sec", "yield_pct"]:
        raise SystemExit("treasury header")
    if len(doc["rows"]) != 433:
        raise SystemExit("treasury rows")
    if doc["rows"][0] != [1735776000, 4.36] or doc["rows"][-1] != [1790208000, 4.24]:
        raise SystemExit("treasury ends")
    pubs, ys = [], []
    seen = False
    for date_sec, yield_pct in doc["rows"]:
        pubs.append(int(date_sec) * 1000 + DAY)
        ys.append(float(yield_pct) / 100.0)
        if int(date_sec) == 1757376000 and float(yield_pct) == 4.1:
            seen = True
    rising(pubs, "treasury")
    if not seen or 1757462400000 not in pubs:
        raise SystemExit("first bill")
    return pubs, ys, sha256_file(path)


def load_kalshi():
    path = os.path.join(EXT, "kalshi_eoy.json")
    with open(path) as f:
        doc = json.load(f)
    url = "https://api.elections.kalshi.com/trade-api/v2/series"
    out = {}
    expect = {"btc": ("KXBTCY-27JAN0100", 28), "eth": ("KXETHY-27JAN0100", 18)}
    for coin, (event, n_markets) in expect.items():
        block = doc[coin]
        if block["event_ticker"] != event or block["url"] != url:
            raise SystemExit("kalshi header")
        if len(block["markets"]) != n_markets:
            raise SystemExit("kalshi markets")
        books = []
        for market in block["markets"]:
            rows = market["rows"]
            pubs = [int(row[0]) for row in rows]
            probs = [float(row[1]) for row in rows]
            rising(pubs, market["ticker"])
            books.append((
                market["strike_type"],
                market.get("floor_strike"),
                market.get("cap_strike"),
                market["ticker"],
                pubs,
                probs,
            ))
        out[coin] = books
    return out, sha256_file(path)


def load_external():
    btc_fwd = load_funding(
        "deribit_btc_funding.json",
        "BTC-PERPETUAL",
        [1757293200000, 110834.15, 3.5503567564059255e-06],
        [1790352000000, 83784.68, -9.225361515571414e-06],
    )
    eth_fwd = load_funding(
        "deribit_eth_funding.json",
        "ETH-PERPETUAL",
        [1757293200000, 4298.73, 6.310541264454633e-08],
        [1790352000000, 2686.36, 4.40554624904629e-05],
    )
    opt, med, opt_sha = load_options()
    quarterlies, q_sha = load_quarterlies()
    y_pubs, y_vals, y_sha = load_treasury()
    eoy, eoy_sha = load_kalshi()
    ext = {
        "fwd": {"BTC": btc_fwd[:3], "ETH": eth_fwd[:3]},
        "opt": opt,
        "med": med,
        "q": quarterlies,
        "y_pubs": y_pubs,
        "y": y_vals,
        "eoy": eoy,
    }
    hashes = {
        "deribit_btc_funding.json": btc_fwd[3],
        "deribit_eth_funding.json": eth_fwd[3],
        "deribit_options.json": opt_sha,
        "deribit_quarterlies.json": q_sha,
        "treasury_3m.json": y_sha,
        "kalshi_eoy.json": eoy_sha,
    }
    return ext, hashes


def rate_at(ext, coin, t):
    pubs, idx, rate = ext["fwd"][coin]
    i = latest_i(pubs, t)
    if i < 0:
        return None
    return idx[i], rate[i], pubs[i]


def yield_at(ext, t):
    i = latest_i(ext["y_pubs"], t)
    if i < 0:
        return None
    return ext["y"][i], ext["y_pubs"][i]


def front_fut(ext, coin, t):
    for exp, pubs, closes in ext["q"][coin]:
        if exp <= t + DAY:
            continue
        i = latest_i(pubs, t)
        if i < 0:
            continue
        return exp, closes[i], pubs[i]
    return None


def fair_carry(rows, t):
    if not rows:
        return None
    i = latest_i([row[0] for row in rows], t)
    if i < 0:
        return None
    pub, fair, exp = rows[i]
    if not (t < exp):
        return None
    return pub, fair, exp


def median_at(ext, coin, t):
    fresh = []
    for kind, floor, cap, ticker, pubs, probs in ext["eoy"][coin]:
        i = latest_i(pubs, t)
        if i < 0 or t - pubs[i] > AGE:
            continue
        fresh.append((kind, floor, cap, ticker, probs[i], pubs[i]))
    if len(fresh) < 8:
        return None
    raw = sum(row[4] for row in fresh)
    if not (0.6 <= raw <= 1.4):
        return None
    less = [row for row in fresh if row[0] == "less"]
    greater = [row for row in fresh if row[0] == "greater"]
    mid = [row for row in fresh if row[0] == "between"]
    mid.sort(key=lambda row: row[1])
    cdf = 0.0
    for kind, floor, cap, ticker, prob, pub in less + mid + greater:
        p = prob / raw
        prev = cdf
        cdf += p
        if cdf + 1e-15 >= 0.5:
            if kind != "between" or cap is None or floor is None or cap <= floor or p <= 0:
                return None
            w = min(1.0, max(0.0, (0.5 - prev) / p))
            return {
                "fair": floor + w * (cap - floor),
                "pub": pub,
                "ticker": ticker,
                "floor": floor,
                "cap": cap,
                "raw": raw,
                "n": len(fresh),
            }
    return None


def signal_at(name, ext, t, btc_open, eth_open):
    if name == "rxfwd":
        b = rate_at(ext, "BTC", t)
        e = rate_at(ext, "ETH", t)
        if b is None or e is None:
            return False, None
        fact = {
            "pub_b": b[2], "fair_b": b[0] * (1.0 + b[1]), "idx_b": b[0], "rate_b": b[1],
            "pub_e": e[2], "fair_e": e[0] * (1.0 + e[1]), "idx_e": e[0], "rate_e": e[1],
        }
    elif name == "rxopt":
        b = fair_carry(ext["opt"]["BTC"], t)
        e = fair_carry(ext["opt"]["ETH"], t)
        if b is None or e is None:
            return False, None
        fact = {"pub_b": b[0], "fair_b": b[1], "exp_b": b[2], "pub_e": e[0], "fair_e": e[1], "exp_e": e[2]}
    elif name == "rxmed":
        b = fair_carry(ext["med"]["BTC"], t)
        e = fair_carry(ext["med"]["ETH"], t)
        if b is None or e is None:
            return False, None
        fact = {"pub_b": b[0], "fair_b": b[1], "exp_b": b[2], "pub_e": e[0], "fair_e": e[1], "exp_e": e[2]}
    elif name in ("rxqimp", "rxfimp"):
        y = yield_at(ext, t)
        bq = front_fut(ext, "BTC", t)
        eq = front_fut(ext, "ETH", t)
        if y is None or bq is None or eq is None:
            return False, None
        tb = (bq[0] - t) / YEAR
        te = (eq[0] - t) / YEAR
        if not (tb > 0 and te > 0):
            return False, None
        if name == "rxqimp":
            fact = {
                "pub_b": bq[2], "fair_b": bq[1] / (1.0 + y[0] * tb), "fut_b": bq[1], "exp_b": bq[0],
                "pub_e": eq[2], "fair_e": eq[1] / (1.0 + y[0] * te), "fut_e": eq[1], "exp_e": eq[0],
                "y": y[0], "y_pub": y[1], "tb": tb, "te": te,
            }
        else:
            b = rate_at(ext, "BTC", t)
            e = rate_at(ext, "ETH", t)
            if b is None or e is None:
                return False, None
            nb = (bq[0] - t) / (8 * HOUR)
            ne = (eq[0] - t) / (8 * HOUR)
            fact = {
                "pub_b": bq[2], "fair_b": bq[1] / (1.0 + b[1]) ** nb, "fut_b": bq[1], "exp_b": bq[0],
                "rate_b": b[1], "rate_pub_b": b[2], "n_b": nb,
                "pub_e": eq[2], "fair_e": eq[1] / (1.0 + e[1]) ** ne, "fut_e": eq[1], "exp_e": eq[0],
                "rate_e": e[1], "rate_pub_e": e[2], "n_e": ne,
            }
    elif name == "rxeoy":
        b = median_at(ext, "btc", t)
        e = median_at(ext, "eth", t)
        if b is None or e is None:
            return False, None
        fact = {
            "pub_b": b["pub"], "fair_b": b["fair"], "ticker_b": b["ticker"],
            "floor_b": b["floor"], "cap_b": b["cap"], "raw_b": b["raw"], "n_b": b["n"],
            "pub_e": e["pub"], "fair_e": e["fair"], "ticker_e": e["ticker"],
            "floor_e": e["floor"], "cap_e": e["cap"], "raw_e": e["raw"], "n_e": e["n"],
        }
    else:
        raise SystemExit("unknown rule %s" % name)
    fired = discount_bps(fact["fair_b"], btc_open) > 0 and discount_bps(fact["fair_e"], eth_open) > 0
    return fired, fact


def pct(xs, p):
    xs = sorted(xs)
    k = (len(xs) - 1) * p
    lo = int(k)
    hi = int(k) if k == int(k) else int(k) + 1
    if lo == hi:
        return xs[lo]
    return xs[lo] * (hi - k) + xs[hi] * (k - lo)


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
        if side != "both":
            raise SystemExit("side %s" % side)
        btc_pnl += btc_move - charge
        eth_pnl += eth_move - charge
        inc = (btc_move - charge + eth_move - charge) / 2.0
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
    pool = 0.0
    for i, side in pairs:
        if side != "both":
            raise SystemExit("side %s" % side)
        btc_bps = move_bps(btc, i) - 40.0
        eth_bps = move_bps(eth, i) - 40.0
        pool += (btc_bps + eth_bps) / 2.0
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


def overlap_reason(new, old):
    left, right = set(new), set(old)
    if not left or not right:
        return None
    if left == right:
        return "equal"
    inter = len(left & right)
    union = len(left | right)
    jac = inter / union
    ca = inter / len(left)
    cb = inter / len(right)
    if jac >= 0.75:
        return "jaccard %.3f" % jac
    if ca >= 0.90:
        return "containment %.3f %.3f" % (ca, cb)
    if cb >= 0.90 and len(right) >= 60:
        return "containment %.3f %.3f" % (ca, cb)
    return None


def jac_pair(new, old):
    left, right = set(new), set(old)
    inter = len(left & right)
    union = len(left | right) or 1
    return inter / union, (inter / len(left) if left else 0.0), (inter / len(right) if right else 0.0)


def prior_sets():
    spec = importlib.util.spec_from_file_location(
        "screen_pass71", os.path.join(RULES, "screen_pass71.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    scored = mod.prior_sets()
    if len(scored) != 120:
        raise SystemExit("passes 62-70 %d" % len(scored))
    btc = mod.load_book("BTC-USD")
    eth = mod.load_book("ETH-USD")
    ext, _hashes = mod.load_external()
    for name in mod.ORDER:
        got = mod.signals_for(name, btc, eth, ext)
        scored.append([i for i, _side in got])
    if len(scored) != 122:
        raise SystemExit("prior rules %d" % len(scored))
    if len(scored[104]) != 904 or len(scored[120]) != 964 or len(scored[121]) != 15:
        raise SystemExit("prior identities moved")
    return scored


def self_check():
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    if not near(discount_bps(101.0, 100.0), 100.0):
        raise SystemExit("discount bps")
    year = 365.25 * 86400000
    t0 = 1757548800000
    exp = 1758873600000
    span = (exp - t0) / year
    if not near(114255.0 / (1.0 + 0.041 * span), 114058.68270537774):
        raise SystemExit("bill formula")
    if not near(4355.25 / (1.0 + 0.041 * span), 4347.766643495658):
        raise SystemExit("eth bill formula")
    rate = 9.177964088778931e-05
    if not near(114777.5 / (1.0 + rate) ** 45, 114304.45853235848):
        raise SystemExit("funding basis formula")
    eth_rate = -3.132357635749202e-07
    if not near(4450.0 / (1.0 + eth_rate) ** 45, 4450.062725913554):
        raise SystemExit("negative funding raises the future")
    if not near(114496.12 * (1.0 + 7.479855825884937e-05), 114504.68414470222):
        raise SystemExit("funding forward formula")
    entry = 1_700_000_000
    entry_ms = entry * 1000
    book = make_book([100, 110], entry)
    other = make_book([10, 9], entry)
    ext = {
        "fwd": {
            "BTC": ([entry_ms - 1], [101.0], [0.0]),
            "ETH": ([entry_ms - 1], [11.0], [0.0]),
        },
        "opt": {"BTC": [], "ETH": []},
        "med": {"BTC": [], "ETH": []},
        "q": {"BTC": [], "ETH": []},
        "y_pubs": [],
        "y": [],
        "eoy": {"btc": [], "eth": []},
    }
    fired, fact = signal_at("rxfwd", ext, entry_ms, 100.0, 10.0)
    if not fired or not near(fact["fair_b"], 101.0):
        raise SystemExit("rxfwd fixture")
    ext["fwd"]["BTC"] = ([entry_ms], [101.0], [0.0])
    ext["fwd"]["ETH"] = ([entry_ms], [11.0], [0.0])
    if signal_at("rxfwd", ext, entry_ms, 100.0, 10.0)[1] is not None:
        raise SystemExit("a forward published at the open is not usable")
    ext["fwd"]["BTC"] = ([entry_ms - 1], [100.0], [0.0])
    ext["fwd"]["ETH"] = ([entry_ms - 1], [11.0], [0.0])
    fired, fact = signal_at("rxfwd", ext, entry_ms, 100.0, 10.0)
    if fact is None or fired:
        raise SystemExit("a zero discount does not fire")
    ext["fwd"]["BTC"] = ([entry_ms - 1], [99.0], [0.0])
    fired, fact = signal_at("rxfwd", ext, entry_ms, 100.0, 10.0)
    if fact is None or fired:
        raise SystemExit("one rich book does not fire")
    try:
        signal_at("nope", ext, entry_ms, 100.0, 10.0)
    except SystemExit as exc:
        if "unknown rule" not in str(exc):
            raise
    else:
        raise SystemExit("unknown rule slipped through")
    both = score([(0, "both")], book, other, 20.0)
    btc_hand = (110.0 / 100.0 - 1.0) * 10000.0 - 40.0
    eth_hand = (9.0 / 10.0 - 1.0) * 10000.0 - 40.0
    if both["trips"] != 1 or abs(both["pool"] - (btc_hand + eth_hand) / 2.0) > 1e-9:
        raise SystemExit("one uk trip")
    if abs(both["pool"] - (-40.0)) > 1e-9:
        raise SystemExit("pool is -40")
    hand, n_hand = hand_sum([(0, "both")], book, other)
    if n_hand != 1 or abs(hand - both["pool"]) > 1e-9:
        raise SystemExit("hand sum")
    stress = score([(0, "both")], book, other, 40.0)
    if abs((both["pool"] - stress["pool"]) - 40.0) > 1e-9:
        raise SystemExit("both-book cost gap")


def check_first(name, btc, eth, fact):
    i = FIRST[name]
    if name == "rxfwd":
        if not near(btc[i][1], 114222.72) or not near(eth[i][1], 4414.64):
            raise SystemExit("first forward open")
        if not near(btc[i + 1][1], 114467.97) or not near(eth[i + 1][1], 4423.95):
            raise SystemExit("first forward exit")
        if fact["pub_b"] != 1757602800000 or fact["pub_e"] != 1757602800000:
            raise SystemExit("first forward publication")
        if not near(fact["idx_b"], 114496.12) or not near(fact["rate_b"], 7.479855825884937e-05):
            raise SystemExit("first btc forward inputs")
        if not near(fact["idx_e"], 4429.24) or not near(fact["rate_e"], 4.5420029851153735e-06):
            raise SystemExit("first eth forward inputs")
        if not near(fact["fair_b"], 114504.68414470222) or not near(fact["fair_e"], 4429.260117621301):
            raise SystemExit("first forward")
        if not near(discount_bps(fact["fair_b"], btc[i][1]), 24.685469292118345):
            raise SystemExit("first btc forward discount")
        if not near(discount_bps(fact["fair_e"], eth[i][1]), 33.11734959430712):
            raise SystemExit("first eth forward discount")
    elif name == "rxopt":
        if not near(btc[i][1], 114965.76) or not near(eth[i][1], 4522.15):
            raise SystemExit("first synthetic open")
        if not near(btc[i + 1][1], 115160.91) or not near(eth[i + 1][1], 4543.89):
            raise SystemExit("first synthetic exit")
        if fact["pub_b"] != 1757664000000 or fact["pub_e"] != 1757664000000:
            raise SystemExit("first synthetic publication")
        if fact["exp_b"] != 1758268800000 or fact["exp_e"] != 1758268800000:
            raise SystemExit("first synthetic expiry")
        if not near(fact["fair_b"], 115484.55394091041) or not near(fact["fair_e"], 4547.751389590702):
            raise SystemExit("first synthetic")
        if not near(discount_bps(fact["fair_b"], btc[i][1]), 45.12595236272121):
            raise SystemExit("first btc synthetic discount")
        if not near(discount_bps(fact["fair_e"], eth[i][1]), 56.613313558158126):
            raise SystemExit("first eth synthetic discount")
    elif name == "rxqimp":
        if not near(btc[i][1], 113993.1) or not near(eth[i][1], 4346.87):
            raise SystemExit("first bill open")
        if not near(btc[i + 1][1], 114442.02) or not near(eth[i + 1][1], 4405.51):
            raise SystemExit("first bill exit")
        if fact["pub_b"] != 1757545200000 or fact["pub_e"] != 1757545200000 or fact["y_pub"] != 1757462400000:
            raise SystemExit("first bill publication")
        if fact["exp_b"] != 1758873600000 or fact["exp_e"] != 1758873600000:
            raise SystemExit("first bill expiry")
        if not near(fact["fut_b"], 114255.0) or not near(fact["fut_e"], 4355.25) or not near(fact["y"], 0.041):
            raise SystemExit("first bill inputs")
        if not near(fact["fair_b"], 114058.68270537774) or not near(fact["fair_e"], 4347.766643495658):
            raise SystemExit("first bill fair")
        if not near(discount_bps(fact["fair_b"], btc[i][1]), 5.753217113819709):
            raise SystemExit("first btc bill discount")
        if not near(discount_bps(fact["fair_e"], eth[i][1]), 2.0627336351397574):
            raise SystemExit("first eth bill discount")
    elif name == "rxfimp":
        if not near(btc[i][1], 114100.0) or not near(eth[i][1], 4446.0):
            raise SystemExit("first funding-basis open")
        if not near(btc[i + 1][1], 114128.26) or not near(eth[i + 1][1], 4435.0):
            raise SystemExit("first funding-basis exit")
        if fact["pub_b"] != 1757574000000 or fact["rate_pub_b"] != 1757574000000:
            raise SystemExit("first funding-basis publication")
        if fact["pub_e"] != 1757574000000 or fact["rate_pub_e"] != 1757574000000:
            raise SystemExit("first eth funding-basis publication")
        if not near(fact["fut_b"], 114777.5) or not near(fact["rate_b"], 9.177964088778931e-05):
            raise SystemExit("first funding-basis inputs")
        if not near(fact["n_b"], 45.0) or not near(fact["n_e"], 45.0):
            raise SystemExit("first funding-basis steps")
        if not near(fact["fut_e"], 4450.0) or not near(fact["rate_e"], -3.132357635749202e-07):
            raise SystemExit("first eth funding-basis inputs")
        if not near(fact["fair_b"], 114304.45853235848) or not near(fact["fair_e"], 4450.062725913554):
            raise SystemExit("first funding-basis fair")
        if not near(discount_bps(fact["fair_b"], btc[i][1]), 17.91924034693082):
            raise SystemExit("first btc funding-basis discount")
        if not near(discount_bps(fact["fair_e"], eth[i][1]), 9.137935028236122):
            raise SystemExit("first eth funding-basis discount")
    elif name == "rxmed":
        if not near(btc[i][1], 115250.0) or not near(eth[i][1], 4581.3):
            raise SystemExit("first median open")
        if not near(btc[i + 1][1], 115698.0) or not near(eth[i + 1][1], 4618.15):
            raise SystemExit("first median exit")
        if fact["pub_b"] != 1757664000000 or fact["exp_b"] != 1758268800000:
            raise SystemExit("first btc median publication")
        if fact["pub_e"] != 1757836800000 or fact["exp_e"] != 1758873600000:
            raise SystemExit("first eth median publication")
        if not near(fact["fair_b"], 115546.21848739496) or not near(fact["fair_e"], 4642.045454545455):
            raise SystemExit("first median")
        if not near(discount_bps(fact["fair_b"], btc[i][1]), 25.702254871580177):
            raise SystemExit("first btc median discount")
        if not near(discount_bps(fact["fair_e"], eth[i][1]), 132.5943608701774):
            raise SystemExit("first eth median discount")
    elif name == "rxeoy":
        if not near(btc[i][1], 63751.35) or not near(eth[i][1], 1863.88):
            raise SystemExit("first year-end open")
        if not near(btc[i + 1][1], 63861.01) or not near(eth[i + 1][1], 1862.74):
            raise SystemExit("first year-end exit")
        if fact["pub_b"] != 1772258400000 or fact["pub_e"] != 1772258400000:
            raise SystemExit("first year-end publication")
        if fact["ticker_b"] != "KXBTCY-27JAN0100-B72500" or fact["ticker_e"] != "KXETHY-27JAN0100-B2125":
            raise SystemExit("first year-end bucket")
        if fact["floor_b"] != 70000 or fact["cap_b"] != 74999.99:
            raise SystemExit("first btc bucket")
        if fact["floor_e"] != 2000 or fact["cap_e"] != 2249.99:
            raise SystemExit("first eth bucket")
        if not near(fact["raw_b"], 1.1815) or fact["n_b"] != 28:
            raise SystemExit("first btc ladder")
        if not near(fact["raw_e"], 1.107) or fact["n_e"] != 17:
            raise SystemExit("first eth ladder")
        if not near(fact["fair_b"], 74910.7044642857) or not near(fact["fair_e"], 2012.4995000000001):
            raise SystemExit("first year-end fair")
        if not near(discount_bps(fact["fair_b"], btc[i][1]), 1750.4499064389556):
            raise SystemExit("first btc year-end discount")
        if not near(discount_bps(fact["fair_e"], eth[i][1]), 797.3662467540831):
            raise SystemExit("first eth year-end discount")
    else:
        raise SystemExit("unknown rule %s" % name)


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
    if not near(btc[0][1], 113993.1) or not near(eth[0][1], 4346.87):
        raise SystemExit("first opens")
    ext, inputs = load_external()
    if stamp(btc[1014][0]) != datetime(2026, 2, 27, tzinfo=timezone.utc):
        raise SystemExit("first year-end bar")
    entries = {}
    windows = {}
    discs = {}
    facts = {}
    for name in ORDER:
        got = []
        window = []
        bps_b, bps_e = [], []
        for i in range(len(btc) - 1):
            fired, fact = signal_at(name, ext, btc[i][0], btc[i][1], eth[i][1])
            if fact is None:
                continue
            window.append(i)
            if fired:
                got.append((i, "both"))
                bps_b.append(discount_bps(fact["fair_b"], btc[i][1]))
                bps_e.append(discount_bps(fact["fair_e"], eth[i][1]))
                if got[0][0] == i:
                    facts[name] = fact
        if len(window) != ELIG[name] or window[0] != FIRST_ELIG[name]:
            raise SystemExit("window moved %s %d" % (name, len(window)))
        if len(got) != COUNTED[name]:
            raise SystemExit("count moved before scoring %s %d" % (name, len(got)))
        if len(got) == 0 or len(got) == len(window):
            raise SystemExit("not interior %s" % name)
        if got[0][0] != FIRST[name]:
            raise SystemExit("first entry moved %s" % name)
        avg = [(x + y) / 2.0 for x, y in zip(bps_b, bps_e)]
        have = (pct(bps_b, 0.5), pct(bps_e, 0.5), pct(avg, 0.5))
        want = DISC[name]
        if any(abs(a - b) > 0.02 for a, b in zip(have, want)):
            raise SystemExit("discount moved %s" % name)
        check_first(name, btc, eth, facts[name])
        entries[name] = got
        windows[name] = window
        discs[name] = have
    if windows["rxfwd"] != windows["rxqimp"] or windows["rxfwd"] != windows["rxfimp"]:
        raise SystemExit("the three full windows diverged")
    scored_prior = prior_sets()
    fresh = {name: [i for i, _side in entries[name]] for name in ORDER}
    pair_txt = []
    for i, left_name in enumerate(ORDER):
        for right_name in ORDER[i + 1 :]:
            reason = overlap_reason(fresh[left_name], fresh[right_name])
            if reason:
                raise SystemExit("two rules are too close %s %s %s" % (left_name, right_name, reason))
            jv, ca, cb = jac_pair(fresh[left_name], fresh[right_name])
            pair_txt.append("%s %s jac %.3f cont %.3f %.3f" % (left_name, right_name, jv, ca, cb))
    q_in_fwd = jac_pair(fresh["rxqimp"], fresh["rxfwd"])[1]
    if q_in_fwd >= 0.90:
        raise SystemExit("bill spot sits inside the funding forward")
    fwd_jac, fwd_ca, fwd_cb = jac_pair(fresh["rxfwd"], scored_prior[104])
    if abs(fwd_jac - 0.965) > 0.002 or abs(fwd_ca - 0.970) > 0.002 or abs(fwd_cb - 0.994) > 0.002:
        raise SystemExit("funding-forward overlap moved")
    recorded = [
        "rxfwd overlaps the pass 69 Coinbase hourly set of 904, jaccard %.3f, containment %.3f %.3f. That one overlap is the required example and is not a second rule."
        % (fwd_jac, fwd_ca, fwd_cb)
    ]
    for name in ORDER:
        left = fresh[name]
        for n_old, old in enumerate(scored_prior):
            reason = overlap_reason(left, old)
            if reason is None:
                continue
            if name == "rxfwd":
                if n_old != 104:
                    recorded.append(
                        "rxfwd also overlaps prior set %d (%s), and that overlap is recorded." % (n_old, reason)
                    )
                continue
            raise SystemExit("a rule is too close to one already scored %s %s" % (name, reason))
    eoy_jac, eoy_ca, eoy_cb = jac_pair(fresh["rxeoy"], scored_prior[121])
    recorded.append(
        "rxeoy against the 15 capitalization bars is jaccard %.3f, containment %.3f %.3f. Fourteen of those 15 bars sit inside the year-end set. That is not this forecast."
        % (eoy_jac, eoy_ca, eoy_cb)
    )
    kills = {}
    lines = []
    off_pool = {}
    for name in ORDER:
        base = score(entries[name], btc, eth, 20.0)
        stress = score(entries[name], btc, eth, 40.0)
        expect = 40.0 * base["trips"]
        if abs((base["pool"] - stress["pool"]) - expect) > 1e-4:
            raise SystemExit("cost gap %s" % name)
        off = score([(i, "both") for i in windows[name]], btc, eth, 20.0)
        off_pool[name] = off["pool"]
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
        if not base["pool"] > off["pool"]:
            reasons.append("does not beat the edge-off long-both")
        if share is not None and share > 0.40:
            reasons.append("one month is more than 40% of P&L")
        if not base["pool"] > 400:
            reasons.append("pooled P&L does not exceed 400 bps")
        clear = len(reasons) == 0
        row_out = {
            "name": name + "_2025",
            "edge": EDGE[name],
            "source": SOURCE[name],
            "unit": "USD per coin",
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
            "edge_off_bps": round(off["pool"], 1),
            "month_share": None if share is None else round(share, 3),
            "top_month": month,
            "top_month_bps": None if month_pnl is None else round(month_pnl, 1),
            "btc_discount_p50_bps": round(discs[name][0], 1),
            "eth_discount_p50_bps": round(discs[name][1], 1),
            "avg_discount_p50_bps": round(discs[name][2], 1),
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
            "BOOK %s pool %.1f stress %.1f btc %.1f eth %.1f trips %d p95 %.1f off %.1f share %s"
            % (
                name, row_out["pool_bps"], row_out["stress_bps"], row_out["btc_bps"], row_out["eth_bps"],
                row_out["trips"], row_out["null_p95_bps"], row_out["edge_off_bps"], row_out["month_share"],
            ),
            flush=True,
        )
        kills[name + "_2025"] = row_out
        lines.append(
            "%s is %.1f bps over %d trips, stress %.1f, BTC %.1f, ETH %.1f, edge-off %.1f, null p95 %.1f"
            % (
                name, row_out["pool_bps"], row_out["trips"], row_out["stress_bps"],
                row_out["btc_bps"], row_out["eth_bps"], row_out["edge_off_bps"], row_out["null_p95_bps"],
            )
        )
    if abs(off_pool["rxfwd"] - off_pool["rxqimp"]) > 1e-6 or abs(off_pool["rxfwd"] - off_pool["rxfimp"]) > 1e-6:
        raise SystemExit("full-window edge-off diverged")
    summary = {
        "reached_preregistration": False,
        "inputs_sha256": inputs,
        "note": (
            "Each rule was hashed at 2026-09-25 19:55:07 UTC, before its own result. "
            "Six forwards were scored. Seven and eight were not opened. "
            "Every remaining published number was a rewrite already banned: a company inventory cost, equity divided by coins, a macro number that changed, a funding percent, a volatility point, another venue's last trade, the UK book's own shape, an index coat of a few basis points, a tenor or company twin of these six, a third deflator of the same quarterly, a fourth option functional, a second prediction-market date, the option-density mode, or the linear USDC future. "
            "Pass 71's two USD prices stay scored and are not rerun. Both pools were negative. "
            "Pass 70 is not a price edge. Pass 69's other-venue close and pass 68's own UK opens are not rerun. "
            "Passes 62 through 67 are not rerun and their signs are not flipped. "
            "The fill is a printed UK four-hour open to the next open, BTC-USD and ETH-USD, region=UK, the same pull as pass 62. "
            "EEA candles are not read. No other pair is stood in. "
            "Fair value is USD per coin. discount_bps = (fair_usd / uk_open - 1) * 10000. "
            "Both books are bought only when both discounts are strictly positive. "
            "rxfwd is the Deribit index times one plus the settled 8-hour rate. The rate's median is about 0.06 bp, so after 40 bp the coat cannot pay. "
            "Its overlap with the Coinbase hourly both-below set is the required example. "
            "rxopt is strike over one minus call minus put, on the front Friday two to nine days out. "
            "rxqimp is the front quarterly close over one plus the Treasury 3-month yield times the year fraction. The raw future is not scored. "
            "rxfimp divides that same future by one plus the settled 8-hour rate, raised to the step count. The rate can be negative, so this is not a haircut of rxqimp. "
            "rxmed is the interior minimum of call plus put, interpolated, not the synthetic forward. "
            "rxeoy is the Kalshi median of the 1 January 2027 ladder. It is a forecast, not today's spot. "
            "Counts before any return were 927 of 2261, 889 of 2257, 753 of 2261, 1104 of 2261, 660 of 1360, and 802 of 1233. "
            "rxfwd, rxqimp, and rxfimp share the 2261-bar window, so their edge-off lines are the same long-both of every bar. "
            "rxeoy's window starts at index 1014, 2026-02-27 00:00 UTC. "
            "Median discounts on the fires, BTC, ETH, and the average, were "
            + ", ".join("%s %.1f %.1f %.1f" % (name, discs[name][0], discs[name][1], discs[name][2]) for name in ORDER)
            + ". "
            + " ".join(pair_txt)
            + ". "
            + " ".join(recorded)
            + " "
            "The edge-off control is the same long-both fill with the cheapness filter off. It is not an extra rule. "
            "The null remains 500 long-both draws from that rule's own window, seed 20260925, index 474. "
            "Beating a negative edge-off pool or a negative null while the pool stays negative is not close to a pass. "
            "The 60-trip gate is not lowered. "
            + " ".join(lines)
            + ". No testing row is opened. A numeric clear on these UK opens is still not paper testing, "
            "because no order of this account was shown crossing the book. "
            "The five earlier numeric clears and the confirmation-time fall after a higher day stay void. "
            "The pass 67 result of +263.2 bps over 17 trips stays not close to a pass. "
            "From the next round a rule is not opened unless the causal is written first: who is wrong on which price, why the UK open is below an already-published fair value, that fair value is USD per coin, how many bps cheap the open is, and what remains after the 40 bp both-book cost. "
            "A sentence that cannot state that causal is not run. Changing the company, the threshold, the lag, or the coin does not make a new causal. "
            "Pass 73 is not opened."
        ),
        "rules": {name + "_rule_sha256": found[name] for name in ORDER},
        "kills": kills,
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass72.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
