"""Eight UK opens scored against published funding, volatility, and macro fair values.

Hashed at 2026-09-25 15:18:12 UTC. Pass 69 bought when the UK open was below
another venue's close of the same coin. That family does not count and is not
rerun. The UK book sets only the open this account can pay.

    python3 docs/agents/scripts/fp5/screen_pass70.py
    python3 docs/agents/scripts/fp5/screen_pass70.py --check
"""
import bisect, hashlib, importlib.util, json, os, random, statistics, sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass62/revx")
EXT = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass70")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass70.json")
FROZEN = "2026-09-25 15:18:12 UTC"
STEP = 4 * 3600 * 1000
NEED = 576
WINDOW = 30 * 86400
ORDER = ("rxfund", "rxdvol", "rxdmed", "rxust", "rxbei", "rxdxy", "rxcpi", "rxdebt")
SHA = {
    "rxfund": "76c8fffa7d5b5bd1745e19fd76298a3fb01fc475effc65e4580d46e869a0db44",
    "rxdvol": "439ba66911791769ef729d701b0c155e3d1da14cdb5f33c1fefc6b0acd8bfd46",
    "rxdmed": "80e45a17819bd5cd5555ce7cb4072a419ba2d48b979775287b8c25fd956febe2",
    "rxust": "cc62663475b4cd9722686e7b600ed795523e5b70a30b2072ae4fabd32e34ddc3",
    "rxbei": "fa7ee19777b8c380433715847b8a33d4a84f493810e607807e90558a58b11cc2",
    "rxdxy": "1c0d8bf7d27b6c182d9a4fb124f81c7ca72d2f6734b53aff32cc0af056ec29b0",
    "rxcpi": "8881e3dc7262b7dc4e0b367fc8f750930edf5767d19b97b3de7e41e9014d0d7b",
    "rxdebt": "2bc5dd3aa8f5ad17118090482294babd58fe5d0a06fb65c81327e01f9588aafe",
}
COUNTED = {
    "rxfund": 1287,
    "rxdvol": 772,
    "rxdmed": 1072,
    "rxust": 910,
    "rxbei": 1031,
    "rxdxy": 1197,
    "rxcpi": 1405,
    "rxdebt": 1349,
}
SOURCE = {
    "rxfund": "deribit_funding",
    "rxdvol": "deribit_dvol",
    "rxdmed": "deribit_dvol",
    "rxust": "treasury_nominal",
    "rxbei": "treasury_breakeven",
    "rxdxy": "yahoo_dxy",
    "rxcpi": "bls_cpi",
    "rxdebt": "fiscal_debt",
}
EDGE = {
    "rxfund": "settled_funding_premium",
    "rxdvol": "insurance_quote_fell",
    "rxdmed": "insurance_below_30d_median",
    "rxust": "opportunity_cost_fell",
    "rxbei": "breakeven_rose",
    "rxdxy": "dollar_richer",
    "rxcpi": "official_inflation_rose",
    "rxdebt": "dollar_claims_rose",
}
FUND_PUB = (
    "Deribit timestamp is when this hourly funding rate was published. "
    "interest_8h is the 8-hour rate and interest_1h is the 1-hour rate. "
    "The index price in the same payload is not stored and is not the fair value. "
    "A rate is usable only when its timestamp is strictly before the UK entry open."
)
DVOL_PUB = (
    "The volatility-index timestamp is the bucket start. "
    "The close is published at start + 3600 seconds. "
    "Open, high, and low are not stored. "
    "A close is usable only when that publication instant is strictly before the UK entry open."
)
YAHOO_PUB = (
    "Yahoo's daily timestamp is the bar start. A null close is omitted. "
    "The cash-session close is not known at the start. "
    "A close is published at the next stored timestamp when that gap is at most 86400 seconds, "
    "otherwise at start+86400. The last row is published at start+86400. "
    "A close is usable only when that publication instant is strictly before the UK entry open. "
    "Gaps are not interpolated."
)
TREASURY_PUB = (
    "The CSV date is that business day's curve, stored as 00:00 UTC of that date. "
    "The curve is not known at the start of the dated day. "
    "It is published at date + 86400 seconds. "
    "A curve is usable only when that publication instant is strictly before the UK entry open. "
    "A date missing the 10-year nominal yield or the 10-year real yield is omitted. "
    "Gaps are not interpolated. "
    "Breakeven is the nominal 10-year minus the real 10-year from the same date."
)
CPI_PUB = (
    "The value is the monthly CPI-U index level, not a rate. "
    "A non-numeric value is omitted and is not interpolated. "
    "Year-over-year is this index divided by the index twelve months earlier, minus one. "
    "A month is published at 00:00 UTC on the 1st of the month two months after the reference month. "
    "A print is usable only when that instant is strictly before the UK entry open."
)
DEBT_PUB = (
    "record_date is stored as 00:00 UTC of that date. "
    "The total is not treated as known at the start of the record date. "
    "It is published at record_date + 86400 seconds. "
    "A total is usable only when that publication instant is strictly before the UK entry open. "
    "The field is tot_pub_debt_out_amt. Gaps are not interpolated. "
    "An unchanged total does not fire."
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


def read_json(filename):
    path = os.path.join(EXT, filename)
    with open(path) as f:
        return json.load(f), sha256_file(path)


def yahoo_publish(starts):
    pubs = []
    for i, start in enumerate(starts):
        if i + 1 < len(starts) and starts[i + 1] - start <= 86400:
            pubs.append(starts[i + 1])
        else:
            pubs.append(start + 86400)
    return pubs


def load_external():
    hashes = {}
    fund_b, hashes["deribit_btc_funding.json"] = read_json("deribit_btc_funding.json")
    fund_e, hashes["deribit_eth_funding.json"] = read_json("deribit_eth_funding.json")
    dvol_b, hashes["deribit_btc_dvol.json"] = read_json("deribit_btc_dvol.json")
    dvol_e, hashes["deribit_eth_dvol.json"] = read_json("deribit_eth_dvol.json")
    dxy, hashes["yahoo_dxy.json"] = read_json("yahoo_dxy.json")
    ust, hashes["treasury_curve.json"] = read_json("treasury_curve.json")
    cpi, hashes["bls_cpi.json"] = read_json("bls_cpi.json")
    debt, hashes["debt_to_penny.json"] = read_json("debt_to_penny.json")
    if fund_b["source"] != "Deribit public funding-rate history":
        raise SystemExit("funding source")
    if fund_b["instrument"] != "BTC-PERPETUAL" or fund_e["instrument"] != "ETH-PERPETUAL":
        raise SystemExit("funding instrument")
    if fund_b["url"] != "https://www.deribit.com/api/v2/public/get_funding_rate_history":
        raise SystemExit("funding url")
    if fund_e["url"] != fund_b["url"] or fund_b["publication"] != FUND_PUB or fund_e["publication"] != FUND_PUB:
        raise SystemExit("funding header")
    if fund_b["fetched_at"] != "2026-09-25 14:47:22 UTC" or fund_e["fetched_at"] != fund_b["fetched_at"]:
        raise SystemExit("funding fetch")
    if fund_b["fields"] != ["timestamp_ms", "interest_8h", "interest_1h"]:
        raise SystemExit("funding fields")
    if len(fund_b["rows"]) != 9336 or len(fund_e["rows"]) != 9336:
        raise SystemExit("funding rows")
    fund_t = [int(row[0]) for row in fund_b["rows"]]
    if fund_t != [int(row[0]) for row in fund_e["rows"]]:
        raise SystemExit("funding clocks differ")
    if fund_t[0] != 1756688400000 or fund_t[-1] != 1790294400000:
        raise SystemExit("funding span")
    for i in range(1, len(fund_t)):
        if fund_t[i] - fund_t[i - 1] != 3600000:
            raise SystemExit("funding gap")
    fund_bv = [float(row[1]) for row in fund_b["rows"]]
    fund_ev = [float(row[1]) for row in fund_e["rows"]]
    if max(abs(v) for v in fund_bv + fund_ev) >= 0.1:
        raise SystemExit("funding rate looks like a price")
    if dvol_b["source"] != "Deribit public volatility index" or dvol_b["currency"] != "BTC":
        raise SystemExit("dvol source")
    if dvol_e["currency"] != "ETH":
        raise SystemExit("dvol currency")
    if dvol_b["url"] != "https://www.deribit.com/api/v2/public/get_volatility_index_data":
        raise SystemExit("dvol url")
    if int(dvol_b["resolution_sec"]) != 3600 or int(dvol_e["resolution_sec"]) != 3600:
        raise SystemExit("dvol resolution")
    if dvol_b["publication"] != DVOL_PUB or dvol_e["publication"] != DVOL_PUB:
        raise SystemExit("dvol publication")
    if dvol_b["fetched_at"] != "2026-09-25 14:47:22 UTC" or dvol_e["fetched_at"] != dvol_b["fetched_at"]:
        raise SystemExit("dvol fetch")
    if dvol_b["fields"] != ["start_ms", "close"] or len(dvol_b["rows"]) != 9337 or len(dvol_e["rows"]) != 9337:
        raise SystemExit("dvol rows")
    if dvol_b["rows"][0][0] != 1756684800000 or dvol_b["rows"][0][1] != 39.53:
        raise SystemExit("dvol first")
    dvol_pub = []
    dvol_bv = []
    dvol_ev = []
    for i, (brow, erow) in enumerate(zip(dvol_b["rows"], dvol_e["rows"])):
        if brow[0] != erow[0]:
            raise SystemExit("dvol clocks differ")
        if i and brow[0] - dvol_b["rows"][i - 1][0] != 3600000:
            raise SystemExit("dvol gap")
        close_b = float(brow[1])
        close_e = float(erow[1])
        if not 0 < close_b < 1000 or not 0 < close_e < 1000:
            raise SystemExit("dvol close")
        dvol_pub.append(int(brow[0]) // 1000 + 3600)
        dvol_bv.append(close_b)
        dvol_ev.append(close_e)
    if dxy["symbol"] != "DX-Y.NYB" or dxy["exchange"] != "NYB" or dxy["publication"] != YAHOO_PUB:
        raise SystemExit("dxy header")
    if dxy["url"] != "https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&period1=1754006400&period2=1790294400":
        raise SystemExit("dxy url")
    if dxy["fetched_at"] != "2026-09-25 14:47:22 UTC" or dxy["null_closes"] != 60 or len(dxy["rows"]) != 289:
        raise SystemExit("dxy rows")
    dxy_start = [int(row[0]) for row in dxy["rows"]]
    dxy_close = [float(row[1]) for row in dxy["rows"]]
    if dxy_start != sorted(dxy_start) or len(dxy_start) != len(set(dxy_start)):
        raise SystemExit("dxy starts")
    if ust["publication"] != TREASURY_PUB or ust["fetched_at"] != "2026-09-25 15:05:49 UTC":
        raise SystemExit("treasury header")
    if ust["fields"] != ["curve_sec", "nominal_10y", "real_10y"] or len(ust["rows"]) != 433:
        raise SystemExit("treasury rows")
    ust_pub = []
    ust_nom = []
    ust_bei = []
    prev = None
    for row in ust["rows"]:
        sec = int(row[0])
        nom = float(row[1])
        real = float(row[2])
        if prev is not None and sec <= prev:
            raise SystemExit("treasury order")
        prev = sec
        if not 0 < nom < 30 or not -5 < real < 30:
            raise SystemExit("treasury yield")
        ust_pub.append(sec + 86400)
        ust_nom.append(nom)
        ust_bei.append(nom - real)
    if cpi["series_id"] != "CUUR0000SA0" or cpi["publication"] != CPI_PUB:
        raise SystemExit("cpi header")
    if cpi["url"] != "https://api.bls.gov/publicAPI/v2/timeseries/data/":
        raise SystemExit("cpi url")
    if cpi["fetched_at"] != "2026-09-25 15:05:34 UTC" or len(cpi["rows"]) != 19:
        raise SystemExit("cpi rows")
    cpi_pub = []
    cpi_yoy = []
    for row in cpi["rows"]:
        pub = int(row[0])
        yoy = float(row[4])
        if cpi_pub and pub <= cpi_pub[-1]:
            raise SystemExit("cpi order")
        if not -0.2 < yoy < 0.2:
            raise SystemExit("cpi yoy")
        cpi_pub.append(pub)
        cpi_yoy.append(yoy)
    if debt["publication"] != DEBT_PUB or debt["fetched_at"] != "2026-09-25 15:07:57 UTC":
        raise SystemExit("debt header")
    if debt["fields"] != ["record_sec", "tot_pub_debt_out_amt"] or len(debt["rows"]) != 288:
        raise SystemExit("debt rows")
    if "tot_pub_debt_out_amt" not in debt["url"]:
        raise SystemExit("debt url")
    debt_pub = []
    debt_v = []
    for row in debt["rows"]:
        sec = int(row[0])
        total = float(row[1])
        if debt_pub and sec + 86400 <= debt_pub[-1]:
            raise SystemExit("debt order")
        if total < 1e13:
            raise SystemExit("debt size")
        debt_pub.append(sec + 86400)
        debt_v.append(total)
    ext = {
        "fund_t": fund_t,
        "fund_b": fund_bv,
        "fund_e": fund_ev,
        "dvol_pub": dvol_pub,
        "dvol_b": dvol_bv,
        "dvol_e": dvol_ev,
        "dxy_pub": yahoo_publish(dxy_start),
        "dxy": dxy_close,
        "ust_pub": ust_pub,
        "ust_nom": ust_nom,
        "ust_bei": ust_bei,
        "cpi_pub": cpi_pub,
        "cpi_yoy": cpi_yoy,
        "debt_pub": debt_pub,
        "debt": debt_v,
    }
    return ext, hashes


def latest_index(times, cutoff):
    return bisect.bisect_left(times, cutoff) - 1


def latest_one(times, values, cutoff):
    j = latest_index(times, cutoff)
    if j < 0:
        return None
    return times[j], values[j]


def latest_pair(times, values, cutoff):
    j = latest_index(times, cutoff)
    if j < 1:
        return None
    return (times[j - 1], values[j - 1]), (times[j], values[j])


def median_state(times, values, entry_sec):
    right = bisect.bisect_left(times, entry_sec)
    left = bisect.bisect_left(times, entry_sec - WINDOW)
    n = right - left
    if n < NEED:
        return None
    window = values[left:right]
    return values[right - 1], statistics.median(window), n, times[right - 1]


def signal_at(name, ext, t_ms):
    t = t_ms // 1000
    if name == "rxfund":
        b = latest_one(ext["fund_t"], ext["fund_b"], t_ms)
        e = latest_one(ext["fund_t"], ext["fund_e"], t_ms)
        if b is None or e is None:
            return None, None
        fired = b[1] > 0 and e[1] > 0
        return fired, (b[0], b[1], e[0], e[1])
    if name == "rxdvol":
        b = latest_pair(ext["dvol_pub"], ext["dvol_b"], t)
        e = latest_pair(ext["dvol_pub"], ext["dvol_e"], t)
        if b is None or e is None:
            return None, None
        fired = b[1][1] < b[0][1] and e[1][1] < e[0][1]
        return fired, (b[1][0], b[1][1], b[0][1], e[1][0], e[1][1], e[0][1])
    if name == "rxdmed":
        b = median_state(ext["dvol_pub"], ext["dvol_b"], t)
        e = median_state(ext["dvol_pub"], ext["dvol_e"], t)
        if b is None or e is None:
            return None, None
        fired = b[0] < b[1] and e[0] < e[1]
        return fired, (b[0], b[1], b[2], b[3], e[0], e[1], e[2], e[3])
    if name == "rxust":
        pair = latest_pair(ext["ust_pub"], ext["ust_nom"], t)
        if pair is None:
            return None, None
        return pair[1][1] < pair[0][1], (pair[1][0], pair[1][1], pair[0][0], pair[0][1])
    if name == "rxbei":
        pair = latest_pair(ext["ust_pub"], ext["ust_bei"], t)
        if pair is None:
            return None, None
        return pair[1][1] > pair[0][1], (pair[1][0], pair[1][1], pair[0][0], pair[0][1])
    if name == "rxdxy":
        pair = latest_pair(ext["dxy_pub"], ext["dxy"], t)
        if pair is None:
            return None, None
        return pair[1][1] > pair[0][1], (pair[1][0], pair[1][1], pair[0][0], pair[0][1])
    if name == "rxcpi":
        pair = latest_pair(ext["cpi_pub"], ext["cpi_yoy"], t)
        if pair is None:
            return None, None
        return pair[1][1] > pair[0][1], (pair[1][0], pair[1][1], pair[0][0], pair[0][1])
    if name == "rxdebt":
        pair = latest_pair(ext["debt_pub"], ext["debt"], t)
        if pair is None:
            return None, None
        return pair[1][1] > pair[0][1], (pair[1][0], pair[1][1], pair[0][0], pair[0][1])
    raise SystemExit("unknown rule %s" % name)


def signals_for(name, btc, eth, ext):
    out = []
    for i in range(len(btc) - 1):
        fired, _fact = signal_at(name, ext, btc[i][0])
        if fired:
            out.append((i, "both"))
    return out


def eligible_for(name, btc, eth, ext):
    out = []
    for i in range(len(btc) - 1):
        fired, fact = signal_at(name, ext, btc[i][0])
        if fact is not None:
            out.append(i)
    return out


def prior_sets():
    spec = importlib.util.spec_from_file_location("screen_pass69", os.path.join(RULES, "screen_pass69.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    scored = mod.prior_sets()
    if len(scored) != 104:
        raise SystemExit("passes 62-68 %d" % len(scored))
    btc = mod.load_book("BTC-USD")
    eth = mod.load_book("ETH-USD")
    books, _hashes = mod.load_books()
    for name in mod.ORDER:
        got = mod.signals_for(name, btc, eth, books)
        scored.append([i for i, _side in got])
    if len(scored) != 112:
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
    """Recompute the pool from raw opens. Does not call score."""
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


def self_check():
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    if NEED != 576 or WINDOW != 30 * 86400:
        raise SystemExit("median window moved")
    entry = 1_700_000_000
    entry_ms = entry * 1000
    ext = {
        "fund_t": [entry_ms - 1, entry_ms + 10],
        "fund_b": [0.0001, -0.0001],
        "fund_e": [0.0002, 0.0002],
        "dvol_pub": [entry - 7200, entry - 3600, entry],
        "dvol_b": [11.0, 10.0, 9.0],
        "dvol_e": [21.0, 20.0, 19.0],
        "dxy_pub": yahoo_publish([0, 86400, 200000]),
        "dxy": [1.0, 2.0, 1.5],
        "ust_pub": [entry - 2, entry - 1],
        "ust_nom": [4.0, 3.0],
        "ust_bei": [2.0, 2.1],
        "cpi_pub": [entry - 2, entry - 1],
        "cpi_yoy": [0.02, 0.03],
        "debt_pub": [entry - 2, entry - 1],
        "debt": [10.0, 11.0],
    }
    book = make_book([100, 110], entry)
    other = make_book([10, 9], entry)
    if signals_for("rxfund", book, other, ext) != [(0, "both")]:
        raise SystemExit("rxfund fixture")
    ext["fund_t"] = [entry_ms]
    if signals_for("rxfund", book, other, ext):
        raise SystemExit("a rate published at the open is not usable")
    ext["fund_t"] = [entry_ms - 1]
    ext["fund_b"] = [0.0]
    ext["fund_e"] = [0.0001]
    if signals_for("rxfund", book, other, ext):
        raise SystemExit("a zero rate is not positive")
    ext["fund_b"] = [-0.0001]
    if signals_for("rxfund", book, other, ext):
        raise SystemExit("a negative rate is not the cheap leg")
    ext["dvol_pub"] = [entry - 7200, entry - 3600]
    ext["dvol_b"] = [11.0, 10.0]
    ext["dvol_e"] = [21.0, 20.0]
    if signals_for("rxdvol", book, other, ext) != [(0, "both")]:
        raise SystemExit("rxdvol fixture")
    ext["dvol_b"] = [10.0, 10.0]
    if signals_for("rxdvol", book, other, ext):
        raise SystemExit("an equal close is not a fall")
    ext["dvol_pub"] = [entry - 3600, entry]
    ext["dvol_b"] = [11.0, 10.0]
    ext["dvol_e"] = [21.0, 20.0]
    if signals_for("rxdvol", book, other, ext):
        raise SystemExit("a close published at the open is not usable")
    pubs = [entry - NEED * 3600 + i * 3600 for i in range(NEED)]
    ext["dvol_pub"] = pubs
    ext["dvol_b"] = [10.0] * (NEED - 1) + [9.0]
    ext["dvol_e"] = [20.0] * (NEED - 1) + [19.0]
    if signals_for("rxdmed", book, other, ext) != [(0, "both")]:
        raise SystemExit("rxdmed fixture")
    ext["dvol_b"] = [10.0] * NEED
    ext["dvol_e"] = [20.0] * NEED
    if signals_for("rxdmed", book, other, ext):
        raise SystemExit("a tie with the median does not fire")
    ext["dvol_pub"] = pubs[:-1]
    ext["dvol_b"] = [9.0] * (NEED - 1)
    ext["dvol_e"] = [19.0] * (NEED - 1)
    if eligible_for("rxdmed", book, other, ext):
        raise SystemExit("575 closes are not enough")
    if signals_for("rxust", book, other, ext) != [(0, "both")]:
        raise SystemExit("rxust fixture")
    ext["ust_nom"] = [3.0, 3.0]
    if signals_for("rxust", book, other, ext):
        raise SystemExit("an equal yield does not fire")
    ext["ust_nom"] = [4.0, 3.0]
    if signals_for("rxbei", book, other, ext) != [(0, "both")]:
        raise SystemExit("rxbei fixture")
    ext["ust_bei"] = [2.1, 2.1]
    if signals_for("rxbei", book, other, ext):
        raise SystemExit("an equal breakeven does not fire")
    if yahoo_publish([0, 86400]) != [86400, 172800]:
        raise SystemExit("a one-day gap publishes at the next timestamp")
    if yahoo_publish([0, 172800]) != [86400, 259200]:
        raise SystemExit("a longer gap publishes one day after the start")
    ext["dxy_pub"] = [entry - 2, entry - 1]
    ext["dxy"] = [90.0, 91.0]
    if signals_for("rxdxy", book, other, ext) != [(0, "both")]:
        raise SystemExit("rxdxy fixture")
    ext["dxy"] = [91.0, 91.0]
    if signals_for("rxdxy", book, other, ext):
        raise SystemExit("an equal dollar index does not fire")
    if signals_for("rxcpi", book, other, ext) != [(0, "both")]:
        raise SystemExit("rxcpi fixture")
    ext["cpi_yoy"] = [0.03, 0.03]
    if signals_for("rxcpi", book, other, ext):
        raise SystemExit("an equal inflation rate does not fire")
    if signals_for("rxdebt", book, other, ext) != [(0, "both")]:
        raise SystemExit("rxdebt fixture")
    ext["debt"] = [11.0, 11.0]
    if signals_for("rxdebt", book, other, ext):
        raise SystemExit("an unchanged debt total does not fire")
    try:
        signal_at("nope", ext, entry_ms)
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
    hand, n_hand = hand_sum([(0, "both")], book, other)
    if n_hand != 1 or abs(hand - both["pool"]) > 1e-9:
        raise SystemExit("hand sum")
    stress = score([(0, "both")], book, other, 40.0)
    if abs((both["pool"] - stress["pool"]) - 40.0) > 1e-9:
        raise SystemExit("both-book cost gap")


def near(a, b):
    return abs(a - b) <= 1e-9 * max(1.0, abs(b))


def check_first(name, btc, eth, fact):
    i = {
        "rxfund": 0,
        "rxdvol": 1,
        "rxdmed": 95,
        "rxust": 1,
        "rxbei": 0,
        "rxdxy": 0,
        "rxcpi": 0,
        "rxdebt": 0,
    }[name]
    if not near(btc[i][1], {0: 113993.1, 1: 114442.02, 95: 109202.63}[i]):
        raise SystemExit("first btc open %s" % name)
    if not near(eth[i][1], {0: 4346.87, 1: 4405.51, 95: 4026.96}[i]):
        raise SystemExit("first eth open %s" % name)
    if name == "rxfund":
        pub_b, rate_b, pub_e, rate_e = fact
        if pub_b != 1757545200000 or pub_e != 1757545200000:
            raise SystemExit("first funding time")
        if not near(rate_b, 8.390205092165114e-05) or not near(rate_e, 3.1244590705766065e-06):
            raise SystemExit("first funding rate")
    elif name == "rxdvol":
        pub_b, cur_b, prev_b, pub_e, cur_e, prev_e = fact
        if pub_b != 1757559600 or pub_e != 1757559600:
            raise SystemExit("first dvol time")
        if not near(cur_b, 36.86) or not near(prev_b, 36.89):
            raise SystemExit("first btc dvol")
        if not near(cur_e, 65.05) or not near(prev_e, 65.07):
            raise SystemExit("first eth dvol")
    elif name == "rxdmed":
        cur_b, med_b, n_b, pub_b, cur_e, med_e, n_e, pub_e = fact
        if n_b != 619 or n_e != 619 or pub_b != 1758913200 or pub_e != 1758913200:
            raise SystemExit("first median window")
        if not near(cur_b, 36.34) or not near(med_b, 36.52):
            raise SystemExit("first btc median")
        if not near(cur_e, 63.58) or not near(med_e, 64.12):
            raise SystemExit("first eth median")
    elif name == "rxust":
        pub, cur, prev_pub, prev = fact
        if pub != 1757548800 or prev_pub != 1757462400:
            raise SystemExit("first yield time")
        if not near(cur, 4.04) or not near(prev, 4.08):
            raise SystemExit("first yield")
    elif name == "rxbei":
        pub, cur, prev_pub, prev = fact
        if pub != 1757462400 or prev_pub != 1757376000:
            raise SystemExit("first breakeven time")
        if not near(cur, 4.08 - 1.72) or not near(prev, 4.05 - 1.7):
            raise SystemExit("first breakeven")
    elif name == "rxdxy":
        pub, cur, prev_pub, prev = fact
        if pub != 1757476800 or prev_pub != 1757390400:
            raise SystemExit("first dollar time")
        if not near(cur, 97.79000091552734) or not near(prev, 97.44999694824219):
            raise SystemExit("first dollar")
    elif name == "rxcpi":
        pub, cur, prev_pub, prev = fact
        if pub != 1756684800 or prev_pub != 1754006400:
            raise SystemExit("first cpi time")
        if not near(cur, 0.027049023971513986) or not near(prev, 0.02669213018222316):
            raise SystemExit("first cpi")
    elif name == "rxdebt":
        pub, cur, prev_pub, prev = fact
        if pub != 1757462400 or prev_pub != 1757376000:
            raise SystemExit("first debt time")
        if not near(cur, 37473887187237.77) or not near(prev, 37440609216979.63):
            raise SystemExit("first debt")
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
    ext, inputs = load_external()
    windows = {}
    for name in ORDER:
        window = eligible_for(name, btc, eth, ext)
        if name == "rxdmed":
            if window != list(range(85, 2261)):
                raise SystemExit("median window moved %d" % len(window))
        elif window != list(range(2261)):
            raise SystemExit("window moved %s %d" % (name, len(window)))
        windows[name] = window
    scored_prior = prior_sets()
    entries = {}
    for name in ORDER:
        got = signals_for(name, btc, eth, ext)
        if len(got) != COUNTED[name]:
            raise SystemExit("count moved before scoring %s %d" % (name, len(got)))
        if len(got) == 0 or len(got) == len(windows[name]):
            raise SystemExit("not interior %s" % name)
        idx = [i for i, _side in got]
        if idx != sorted(idx):
            raise SystemExit("entries are not in order %s" % name)
        if any(side != "both" for _i, side in got):
            raise SystemExit("a book was skipped %s" % name)
        _fired, fact = signal_at(name, ext, btc[got[0][0]][0])
        check_first(name, btc, eth, fact)
        if got[0][0] != {"rxfund": 0, "rxdvol": 1, "rxdmed": 95, "rxust": 1, "rxbei": 0, "rxdxy": 0, "rxcpi": 0, "rxdebt": 0}[name]:
            raise SystemExit("first entry moved %s" % name)
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
    kills = {}
    lines = []
    for name in ORDER:
        base = score(entries[name], btc, eth, 20.0)
        stress = score(entries[name], btc, eth, 40.0)
        expect = 40.0 * base["trips"]
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
            "edge": EDGE[name],
            "source": SOURCE[name],
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
        btc_move = move_bps(btc, i0)
        eth_move = move_bps(eth, i0)
        print(
            "FIRST %s %s entry %s exit %s BTC %.2f -> %.2f %+.4f ETH %.2f -> %.2f %+.4f"
            % (
                name,
                side0,
                stamp(btc[i0][0]).strftime("%Y-%m-%d %H:%M"),
                stamp(btc[i0 + 1][0]).strftime("%Y-%m-%d %H:%M"),
                btc[i0][1],
                btc[i0 + 1][1],
                btc_move,
                eth[i0][1],
                eth[i0 + 1][1],
                eth_move,
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
            "Each rule was hashed at 2026-09-25 15:18:12 UTC, before its own result. "
            "Pass 69 bought when the UK open was below another venue's close of the same coin. "
            "Hourly closes, daily closes, a 24-hour lag, and a 7-day lag are that same sentence. "
            "That family does not count as a new price edge and it is not rerun. "
            "Pass 68 priced the UK book's own opens, means, ratios, and last trades. "
            "It does not count as an external fair value and it is not rerun. "
            "Every fill is a printed UK four-hour open to the next UK four-hour open. "
            "The books are BTC-USD and ETH-USD, region=UK, the same pull as pass 62. "
            "EEA candles are not read. No other pair is stood in. "
            "The UK open is the price paid. It is not the fair value. "
            "Another spot or futures last trade of the same coin is not the fair value. "
            "Two rules use Deribit funding and the Deribit volatility index. "
            "The other six use the Treasury par curve, the Treasury breakeven, the dollar index, "
            "CPI-U, and Debt to the Penny. "
            "Yahoo ^TNX down, Yahoo ^IRX down, and the Treasury real-yield decline were counted and not frozen. "
            "The 1-hour funding copy was counted and not frozen. "
            "Both UK opens stay above Coin Metrics realized price on every bar, so that dollar cost basis is not a rule. "
            "A rising VIX close was not frozen. "
            "Every rule buys both books. Spot is not shorted. "
            "The rich side is not the control and is not scored. "
            "Buying every eligible bar is not reported. "
            "The null is 500 long-both draws from that rule's own window, seed 20260925, index 474. "
            "The 30-day DVOL median is drawn from 2,176 bars. The other seven are drawn from 2,261. "
            "The UK high, low, close, mean, ratio, and last trade are not the fair value. "
            "Passes 62 through 67 are not rerun and their signs are not flipped. "
            "No rule here selects the same entry bars as one already scored. "
            "No chosen set is a subset of another, and no pair has Jaccard at or above 0.75. "
            "Counts before any return were 1287, 772, 1072, 910, 1031, 1197, 1405, and 1349. "
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
            raise SystemExit("summary_pass70.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
