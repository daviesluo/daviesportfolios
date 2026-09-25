"""Two UK opens scored against published USD-per-coin fair values.

Hashed at 2026-09-25 16:19:22 UTC. Pass 70 bought both books because a funding
rate, a volatility point, a yield, CPI, the dollar index, or the debt total
moved. That is not a price. The UK book sets only the open this account can pay.

    python3 docs/agents/scripts/fp5/screen_pass71.py
    python3 docs/agents/scripts/fp5/screen_pass71.py --check
"""
import bisect, hashlib, importlib.util, json, os, random, sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass62/revx")
EXT = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass71")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass71.json")
FROZEN = "2026-09-25 16:19:22 UTC"
STEP = 4 * 3600 * 1000
ORDER = ("rxcost", "rxmnav")
SHA = {
    "rxcost": "3bc258f5411269373fa3473c945987d497ad6e094d029f0d50edc83b581da173",
    "rxmnav": "b21d6cc70d17bacd2dc5680ad0f0df25b195c44c5c54a96f839a57433f2aff5a",
}
COUNTED = {"rxcost": 964, "rxmnav": 15}
SOURCE = {"rxcost": "sec_inventory_cost", "rxmnav": "equity_market_cap"}
EDGE = {"rxcost": "inventory_average_cost", "rxmnav": "equity_cap_per_coin"}
FIRST = {"rxcost": 875, "rxmnav": 1432}
INV_PUB = (
    "acceptanceDateTime is the publication instant, in UTC. "
    "The as-of date in the filing is not the publication instant. "
    "A price is usable only when acceptance is strictly before the UK entry open. "
    "The latest lot price is not stored. A sale price is not a purchase fair value."
)
ETH_PUB = (
    "acceptanceDateTime is the publication instant, in UTC. "
    "The table's cost column is thousands of USD. "
    "USD per ETH is that cost times 1000, divided by the ETH units on the same line. "
    "The fair-value column is a principal-market mark and is not stored. "
    "BTC units and other-token units are separate lines and are not included. "
    "A price is usable only when acceptance is strictly before the UK entry open."
)
SHARE_PUB = (
    "The cover-page class A count is EntityCommonStockSharesOutstanding. "
    "acceptanceDateTime is the publication instant. "
    "The as-of date is not. "
    "A count is usable only when acceptance is strictly before the UK entry open. "
    "Class B is 19640250 on each of these filings and converts one for one. "
    "It is not in the class A close, so the common share count is class A plus class B."
)
YAHOO_PUB = (
    "Yahoo's daily timestamp is the bar start. A null close is omitted. "
    "The cash-session close is not known at the start. "
    "A close is published at the next stored timestamp when that gap is at most 86400 seconds, "
    "otherwise at start+86400. The last row is published at start+86400. "
    "A close is usable only when that publication instant is strictly before the UK entry open. "
    "Gaps are not interpolated."
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


def yahoo_publish(starts):
    pubs = []
    for i, start in enumerate(starts):
        if i + 1 < len(starts) and starts[i + 1] - start <= 86400:
            pubs.append(starts[i + 1])
        else:
            pubs.append(start + 86400)
    return pubs


def discount_bps(fair, paid):
    return (fair / paid - 1.0) * 10000.0


def latest(pubs, vals, t):
    i = bisect.bisect_left(pubs, t) - 1
    if i < 0:
        return None
    return pubs[i], vals[i]


def rising(pubs, label):
    for i in range(1, len(pubs)):
        if pubs[i] <= pubs[i - 1]:
            raise SystemExit("publication is not rising %s" % label)


def load_external():
    path = os.path.join(EXT, "inventory_cost.json")
    with open(path) as f:
        doc = json.load(f)
    hashes = {"inventory_cost.json": sha256_file(path)}
    if doc["assembled_at"] != FROZEN:
        raise SystemExit("input assembled after the freeze")
    inv = doc["mstr_inventory"]
    if inv["cik"] != "0001050446" or inv["unit"] != "USD per BTC":
        raise SystemExit("btc inventory header")
    if inv["url"] != "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001050446&type=8-K":
        raise SystemExit("btc inventory url")
    if inv["fetched_at"] != "2026-09-25 16:04:11 UTC" or inv["publication"] != INV_PUB:
        raise SystemExit("btc inventory publication")
    if inv["fields"] != ["pub_ms", "life_usd", "holdings", "accession"] or len(inv["rows"]) != 57:
        raise SystemExit("btc inventory rows")
    if inv["rows"][0] != [1754308828000, 73277.0, 628791.0, "0000950170-25-101634"]:
        raise SystemExit("first btc cost")
    if inv["rows"][-1] != [1789992013000, 75416.0, 846000.0, "0001193125-26-396093"]:
        raise SystemExit("last btc cost")
    btc_pub, btc_life, btc_hold = [], [], []
    seen = {}
    for pub, life, hold, acc in inv["rows"]:
        pub = int(pub)
        life = float(life)
        hold = float(hold)
        if life <= 0 or hold <= 0:
            raise SystemExit("btc cost is not a price")
        btc_pub.append(pub)
        btc_life.append(life)
        btc_hold.append(hold)
        seen[acc] = (life, hold)
    rising(btc_pub, "btc cost")
    if seen["0001193125-26-249768"] != (75699.0, 843706.0):
        raise SystemExit("2026-06-01 inventory average")
    if seen["0001193125-26-295586"] != (75578.0, 846000.0):
        raise SystemExit("2026-07-06 inventory average")
    shares = doc["mstr_shares"]
    if shares["class_b_shares"] != 19640250 or shares["publication"] != SHARE_PUB:
        raise SystemExit("class B")
    if shares["fields"] != ["pub_ms", "class_a", "accession"] or len(shares["rows"]) != 5:
        raise SystemExit("share rows")
    if shares["rows"][0] != [1754344681000, 263912697, "0000950170-25-102209"]:
        raise SystemExit("first class A")
    if shares["rows"][-1] != [1785790196000, 364585501, "0001050446-26-000044"]:
        raise SystemExit("last class A")
    sh_pub, sh_a = [], []
    for pub, count, _acc in shares["rows"]:
        if int(count) <= 0:
            raise SystemExit("class A")
        sh_pub.append(int(pub))
        sh_a.append(int(count))
    rising(sh_pub, "class A")
    eth = doc["bmnr_eth"]
    if eth["cik"] != "0001829311" or eth["unit"] != "USD per ETH" or eth["publication"] != ETH_PUB:
        raise SystemExit("eth header")
    if eth["url"] != "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001829311&type=10-":
        raise SystemExit("eth url")
    if eth["fields"] != ["pub_ms", "units", "cost_thousands", "shares", "accession"] or len(eth["rows"]) != 4:
        raise SystemExit("eth rows")
    expect = [
        (1763762610000, 1874927, 7426698, 384067823, "0001493152-25-024679"),
        (1768342847000, 3737140, 14953824, 454862451, "0001493152-26-002084"),
        (1776198644000, 4473459, 16973446, 537628819, "0001493152-26-016560"),
        (1784060137000, 5416945, 19052159, 603226394, "0001628280-26-048157"),
    ]
    if [tuple(row) for row in eth["rows"]] != expect:
        raise SystemExit("eth lines moved")
    eth_pub, eth_usd, eth_units, eth_sh = [], [], [], []
    for pub, units, thou, count, _acc in eth["rows"]:
        units = int(units)
        thou = int(thou)
        usd = thou * 1000.0 / units
        eth_pub.append(int(pub))
        eth_usd.append(usd)
        eth_units.append(units)
        eth_sh.append(int(count))
    rising(eth_pub, "eth")
    if not near(eth_usd[0], 7426698000 / 1874927) or not near(eth_usd[1], 14953824000 / 3737140):
        raise SystemExit("eth average")
    yb = doc["yahoo_mstr"]
    ye = doc["yahoo_bmnr"]
    if yb["publication"] != YAHOO_PUB or ye["publication"] != YAHOO_PUB:
        raise SystemExit("yahoo publication")
    if yb["fetched_at"] != "2026-09-25 15:44:56 UTC" or ye["fetched_at"] != yb["fetched_at"]:
        raise SystemExit("yahoo fetch")
    if yb["currency"] != "USD" or ye["currency"] != "USD":
        raise SystemExit("yahoo currency")
    if yb["exchange"] != "NMS" or ye["exchange"] != "NYQ":
        raise SystemExit("yahoo exchange")
    if yb["url"] != "https://query1.finance.yahoo.com/v8/finance/chart/MSTR?interval=1d":
        raise SystemExit("mstr url")
    if ye["url"] != "https://query1.finance.yahoo.com/v8/finance/chart/BMNR?interval=1d":
        raise SystemExit("bmnr url")
    if len(yb["rows"]) != 289 or len(ye["rows"]) != 289:
        raise SystemExit("yahoo rows")
    if yb["rows"][0][0] != 1754055000 or not near(yb["rows"][0][1], 366.6300048828125):
        raise SystemExit("first mstr close")
    if ye["rows"][0][0] != 1754055000 or not near(ye["rows"][0][1], 31.68000030517578):
        raise SystemExit("first bmnr close")
    m_starts = [int(row[0]) for row in yb["rows"]]
    e_starts = [int(row[0]) for row in ye["rows"]]
    rising(m_starts, "mstr")
    rising(e_starts, "bmnr")
    if yahoo_publish(m_starts)[0] != 1754141400:
        raise SystemExit("first mstr publication")
    ext = {
        "btc_pub": btc_pub,
        "btc_life": btc_life,
        "btc_hold": btc_hold,
        "sh_pub": sh_pub,
        "sh_a": sh_a,
        "class_b": 19640250,
        "eth_pub": eth_pub,
        "eth_usd": eth_usd,
        "eth_units": eth_units,
        "eth_sh": eth_sh,
        "m_pub": [p * 1000 for p in yahoo_publish(m_starts)],
        "m_px": [float(row[1]) for row in yb["rows"]],
        "e_pub": [p * 1000 for p in yahoo_publish(e_starts)],
        "e_px": [float(row[1]) for row in ye["rows"]],
    }
    return ext, hashes


def signal_at(name, ext, t, btc_open, eth_open):
    if name == "rxcost":
        btc = latest(ext["btc_pub"], ext["btc_life"], t)
        eth = latest(ext["eth_pub"], ext["eth_usd"], t)
        if btc is None or eth is None:
            return False, None
        fired = discount_bps(btc[1], btc_open) > 0 and discount_bps(eth[1], eth_open) > 0
        return fired, (btc[0], btc[1], eth[0], eth[1])
    if name == "rxmnav":
        close_b = latest(ext["m_pub"], ext["m_px"], t)
        shares = latest(ext["sh_pub"], ext["sh_a"], t)
        hold = latest(ext["btc_pub"], ext["btc_hold"], t)
        close_e = latest(ext["e_pub"], ext["e_px"], t)
        units = latest(ext["eth_pub"], ext["eth_units"], t)
        eth_sh = latest(ext["eth_pub"], ext["eth_sh"], t)
        if None in (close_b, shares, hold, close_e, units, eth_sh):
            return False, None
        if hold[1] <= 0 or units[1] <= 0:
            return False, None
        fair_b = close_b[1] * (shares[1] + ext["class_b"]) / hold[1]
        fair_e = close_e[1] * eth_sh[1] / units[1]
        fired = discount_bps(fair_b, btc_open) > 0 and discount_bps(fair_e, eth_open) > 0
        return fired, (close_b[0], fair_b, close_e[0], fair_e)
    raise SystemExit("unknown rule %s" % name)


def signals_for(name, btc, eth, ext):
    out = []
    for i in range(len(btc) - 1):
        fired, _fact = signal_at(name, ext, btc[i][0], btc[i][1], eth[i][1])
        if fired:
            out.append((i, "both"))
    return out


def eligible_for(name, btc, eth, ext):
    out = []
    for i in range(len(btc) - 1):
        _fired, fact = signal_at(name, ext, btc[i][0], btc[i][1], eth[i][1])
        if fact is not None:
            out.append(i)
    return out


def prior_sets():
    spec = importlib.util.spec_from_file_location("screen_pass70", os.path.join(RULES, "screen_pass70.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    scored = mod.prior_sets()
    if len(scored) != 112:
        raise SystemExit("passes 62-69 %d" % len(scored))
    btc = mod.load_book("BTC-USD")
    eth = mod.load_book("ETH-USD")
    ext, _hashes = mod.load_external()
    for name in mod.ORDER:
        got = mod.signals_for(name, btc, eth, ext)
        scored.append([i for i, _side in got])
    if len(scored) != 120:
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
    if yahoo_publish([0, 86400]) != [86400, 172800]:
        raise SystemExit("a one-day gap publishes at the next timestamp")
    if yahoo_publish([0, 172800]) != [86400, 259200]:
        raise SystemExit("a longer gap publishes one day after the start")
    entry = 1_700_000_000
    entry_ms = entry * 1000
    book = make_book([100, 110], entry)
    other = make_book([10, 9], entry)
    ext = {
        "btc_pub": [entry_ms - 1],
        "btc_life": [101.0],
        "btc_hold": [1.0],
        "sh_pub": [entry_ms - 1],
        "sh_a": [1],
        "class_b": 0,
        "eth_pub": [entry_ms - 1],
        "eth_usd": [11.0],
        "eth_units": [1],
        "eth_sh": [1],
        "m_pub": [entry_ms - 1],
        "m_px": [101.0],
        "e_pub": [entry_ms - 1],
        "e_px": [11.0],
    }
    if signals_for("rxcost", book, other, ext) != [(0, "both")]:
        raise SystemExit("rxcost fixture")
    if not near(discount_bps(101.0, 100.0), 100.0):
        raise SystemExit("discount bps")
    ext["btc_pub"] = [entry_ms]
    ext["eth_pub"] = [entry_ms]
    if eligible_for("rxcost", book, other, ext):
        raise SystemExit("a cost published at the open is not usable")
    ext["btc_pub"] = [entry_ms - 1]
    ext["eth_pub"] = [entry_ms - 1]
    ext["btc_life"] = [100.0]
    if signals_for("rxcost", book, other, ext):
        raise SystemExit("a zero discount does not fire")
    ext["btc_life"] = [99.0]
    if signals_for("rxcost", book, other, ext):
        raise SystemExit("one rich book does not fire")
    ext["btc_life"] = [101.0]
    ext["eth_usd"] = [10.0]
    if signals_for("rxcost", book, other, ext):
        raise SystemExit("the other rich book does not fire")
    ext["eth_usd"] = [11.0]
    ext["class_b"] = 1
    ext["m_px"] = [51.0]
    ext["e_px"] = [11.0]
    if signals_for("rxmnav", book, other, ext) != [(0, "both")]:
        raise SystemExit("class B is in the share count")
    ext["m_pub"] = [entry_ms]
    if eligible_for("rxmnav", book, other, ext):
        raise SystemExit("a close published at the open is not usable")
    ext["m_pub"] = [entry_ms - 1]
    ext["class_b"] = 0
    ext["m_px"] = [100.0]
    ext["e_px"] = [10.0]
    if signals_for("rxmnav", book, other, ext):
        raise SystemExit("a capitalization equal to the open does not fire")
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
    hand, n_hand = hand_sum([(0, "both")], book, other)
    if n_hand != 1 or abs(hand - both["pool"]) > 1e-9:
        raise SystemExit("hand sum")
    stress = score([(0, "both")], book, other, 40.0)
    if abs((both["pool"] - stress["pool"]) - 40.0) > 1e-9:
        raise SystemExit("both-book cost gap")


def near(a, b):
    return abs(a - b) <= 1e-6 * max(1.0, abs(b))


def check_first(name, btc, eth, fact):
    i = FIRST[name]
    if name == "rxcost":
        if not near(btc[i][1], 74939.64) or not near(eth[i][1], 2205.6):
            raise SystemExit("first cost open")
        if not near(btc[i + 1][1], 75662.4) or not near(eth[i + 1][1], 2228.06):
            raise SystemExit("first cost exit")
        pub_b, fair_b, pub_e, fair_e = fact
        if pub_b != 1770037225000 or not near(fair_b, 76052.0):
            raise SystemExit("first btc cost")
        if pub_e != 1768342847000 or not near(fair_e, 14953824000 / 3737140):
            raise SystemExit("first eth cost")
        if not near(discount_bps(fair_b, btc[i][1]), (76052.0 / 74939.64 - 1.0) * 10000.0):
            raise SystemExit("first btc discount")
    elif name == "rxmnav":
        if not near(btc[i][1], 79844.86) or not near(eth[i][1], 2293.39):
            raise SystemExit("first cap open")
        if not near(btc[i + 1][1], 80090.44) or not near(eth[i + 1][1], 2295.55):
            raise SystemExit("first cap exit")
        pub_b, fair_b, pub_e, fair_e = fact
        if pub_b != 1778160600000 or pub_e != 1778160600000:
            raise SystemExit("first cap publication")
        if not near(fair_b, 186.82000732421875 * (330807622 + 19640250) / 818334.0):
            raise SystemExit("first btc cap")
        if not near(fair_e, 22.90999984741211 * 537628819 / 4473459):
            raise SystemExit("first eth cap")
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
    window = list(range(432, 2261))
    if stamp(btc[432][0]) != datetime(2025, 11, 22, tzinfo=timezone.utc):
        raise SystemExit("first eligible bar")
    windows = {}
    for name in ORDER:
        got = eligible_for(name, btc, eth, ext)
        if got != window:
            raise SystemExit("window moved %s %d" % (name, len(got)))
        windows[name] = got
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
        if got[0][0] != FIRST[name]:
            raise SystemExit("first entry moved %s" % name)
        _fired, fact = signal_at(name, ext, btc[got[0][0]][0], btc[got[0][0]][1], eth[got[0][0]][1])
        check_first(name, btc, eth, fact)
        entries[name] = got
    fresh = [[i for i, _side in entries[name]] for name in ORDER]
    for i, left in enumerate(fresh):
        left_set = set(left)
        for right in fresh[i + 1 :]:
            right_set = set(right)
            if left_set <= right_set or right_set <= left_set:
                raise SystemExit("one rule is a subset of another")
            inter = len(left_set & right_set)
            union = len(left_set | right_set)
            if inter / union >= 0.75:
                raise SystemExit("two rules are too close")
        for old in scored_prior:
            old_set = set(old)
            if left == old:
                raise SystemExit("a rule repeats bars already scored")
            inter = len(left_set & old_set)
            union = len(left_set | old_set)
            if union and inter / union >= 0.75:
                raise SystemExit("a rule is too close to one already scored")
    kills = {}
    lines = []
    for name in ORDER:
        base = score(entries[name], btc, eth, 20.0)
        stress = score(entries[name], btc, eth, 40.0)
        expect = 40.0 * base["trips"]
        if abs((base["pool"] - stress["pool"]) - expect) > 1e-4:
            raise SystemExit("cost gap %s %.6f %.1f" % (name, base["pool"] - stress["pool"], expect))
        off = score([(i, "both") for i in windows[name]], btc, eth, 20.0)
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
            "COST %s trips %d gap %.1f expected %.1f off %.1f share %s"
            % (
                name,
                row_out["trips"],
                row_out["pool_bps"] - row_out["stress_bps"],
                expect,
                row_out["edge_off_bps"],
                row_out["month_share"],
            ),
            flush=True,
        )
        i0, side0 = entries[name][0]
        _fired, fact = signal_at(name, ext, btc[i0][0], btc[i0][1], eth[i0][1])
        print(
            "FIRST %s %s entry %s exit %s BTC %.2f -> %.2f fair %.4f %+.4f bp ETH %.2f -> %.2f fair %.4f %+.4f bp"
            % (
                name,
                side0,
                stamp(btc[i0][0]).strftime("%Y-%m-%d %H:%M"),
                stamp(btc[i0 + 1][0]).strftime("%Y-%m-%d %H:%M"),
                btc[i0][1],
                btc[i0 + 1][1],
                fact[1],
                discount_bps(fact[1], btc[i0][1]),
                eth[i0][1],
                eth[i0 + 1][1],
                fact[3],
                discount_bps(fact[3], eth[i0][1]),
            ),
            flush=True,
        )
        print(
            "BOOK %s pool %.6f stress %.6f btc %.6f eth %.6f p95 %.6f off %.6f"
            % (name, base["pool"], stress["pool"], base["btc"], base["eth"], p95, off["pool"]),
            flush=True,
        )
        kills[name + "_2025"] = row_out
        lines.append(
            "%s is %.1f bps over %d trips, edge-off %.1f, null p95 %.1f"
            % (name, row_out["pool_bps"], row_out["trips"], row_out["edge_off_bps"], row_out["null_p95_bps"])
        )
    summary = {
        "reached_preregistration": False,
        "inputs_sha256": inputs,
        "note": (
            "Each rule was hashed at 2026-09-25 16:19:22 UTC, before its own result. "
            "Pass 70's eight rules were not a price edge. "
            "rxust, rxbei, rxdxy, rxcpi, and rxdebt are one sentence: a macro number changed, so buy both books. "
            "rxdvol and rxdmed are one sentence: implied volatility is lower, so buy both books. "
            "Volatility points are not a price. "
            "rxfund is a funding percent and a sign bet, not a USD price. "
            "Pass 70's only control was a random long-both null, so the timing test was side selection. "
            "That family is not rerun. "
            "Pass 69 bought when the UK open was below another venue's close of the same coin. It is not rerun. "
            "Pass 68 priced the UK book's own opens. It is not rerun. "
            "Passes 62 through 67 are not rerun and their signs are not flipped. "
            "Every fill is a printed UK four-hour open to the next UK four-hour open. "
            "The books are BTC-USD and ETH-USD, region=UK, the same pull as pass 62. "
            "EEA candles are not read. No other pair is stood in. "
            "The UK open is the price paid. It is not the fair value. "
            "Fair value is USD per coin. discount_bps = (fair_usd / uk_open - 1) * 10000. "
            "Both books are bought only when both discounts are strictly positive. "
            "The inventory rule uses Strategy's 8-K average purchase price and the ETH cost line of Bitmine's table. "
            "The capitalization rule uses the common-share count, the coin count, and the common close. "
            "Class B, 19640250 shares, is included because it converts one for one. "
            "The two sets share no bar. Counts before any return were 964 and 15, out of 1,829 bars, indices 432 through 2260. "
            "The 15 capitalization bars sit inside the pass 70 CPI set of 1,405 and the debt set of 1,349. "
            "Jaccard is 0.011 and 0.011. Those sets are not this price, and those rules are not rerun. "
            "Two already-scored sets of 2 bars sit inside the 964. The 964 is not those sets. "
            "Coin Metrics realized price stays below every BTC open in this window, so both-below is not a rule. "
            "The latest lot price was not frozen. Option-implied spot and an ETF implied coin price were not frozen. "
            "No threshold, lag, tenor, or second issuer was added to make eight rules. "
            "The edge-off control is the same long-both fill with the cheapness filter turned off. "
            "It is not a ninth rule. The null remains 500 long-both draws from the 1,829-bar window, seed 20260925, index 474. "
            "Beating a negative edge-off pool or a negative null while the pool stays negative is not close to a pass. "
            "No rule here selects the same entry bars as one already scored, and none is a subset of one. "
            "No pair has Jaccard at or above 0.75. "
            "The 60-trip gate is not lowered. "
            + " ".join(lines)
            + ". No testing row is opened. A numeric clear on these UK opens is still not paper testing, "
            "because no order of this account was shown crossing the book. "
            "The five earlier numeric clears and the confirmation-time fall after a higher day stay void. "
            "The pass 67 result of +263.2 bps over 17 trips stays not close to a pass. "
            "Pass 72 is not opened. No further published USD price was left that is not a rewrite of a banned sentence."
        ),
        "rules": {name + "_rule_sha256": found[name] for name in ORDER},
        "kills": kills,
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass71.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
