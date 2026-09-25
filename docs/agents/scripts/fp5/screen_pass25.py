"""Eight frozen Revolut X screens. One fill is open to open. Closes can only kill.

Reads the eight rule texts hashed at 2026-09-25 06:04:25 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass25.json. Public market archives only.
Nothing here places an order or reads a key.

    python3 docs/agents/scripts/fp5/screen_pass25.py
    python3 docs/agents/scripts/fp5/screen_pass25.py --check
"""
import hashlib, json, os, random, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass25")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass25.json")
SHA = {
    "okxopen": "5fa2a16c94820ff0a93b7b04e30cb0d986afa1d1bf384f34b54c300fe3e26a92",
    "ltcpx": "84b88f5795e2fadffe8179d09ae6c883c6636d8fef3098e231dcd3e033a85abb",
    "xrppx": "3e0dba94d344e55bdd9dba9d4212ece33532282b68ded4a66e2b4830ca2114dd",
    "ethspotq": "3020cb889cf67068aa0dd556ce627f59f74fb79cbfa55686366364f11eea86d8",
    "solfund": "6cec9720967d8f4bcc0c80c3836c09c868d639c83517197e5563f5f22d113d0d",
    "solbasis": "12f54c722c681f85535fac717cb74fd436300c79590d68dd7471bff3d32f5215",
    "linkpx": "341e180b5a384c1671b03c7956928d7963830433a1303d5c2cdc37580c3f7d58",
    "adaq": "811ece9243a1f2fe3860f528bee45464a6e48b98004c29f3493c30c540a52fcf",
}
UA = {"User-Agent": "fp5-screen/1.0 (daviesluo@gmail.com)", "Accept": "application/json"}
OKX_FLOOR = 1515628800000  # 2018-01-11 00:00:00 UTC
OKX_AFTER = 1577836800000  # 2020-01-01 00:00:00 UTC


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def require_rules():
    found = {}
    for name, digest in SHA.items():
        have = sha256_file(os.path.join(RULES, name + "_rule.txt"))
        if have != digest:
            raise SystemExit("rule text moved after the freeze: %s %s" % (name, have))
        found[name] = have
    return found


def fetch_json(url, timeout=60):
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit("fetch failed %s: %s" % (url, last))


def agreed(pull, label):
    for _ in range(2):
        first, second = pull(), pull()
        if first == second:
            return first
    raise SystemExit("two pulls disagree: %s" % label)


def dump_levels(path, header, levels):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    lines = [header]
    for day in sorted(levels):
        lines.append("%s,%s" % (day, format(levels[day], ".17g")))
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


def load_levels(path, header, first_day, last_day=None, cover=None):
    lines = open(path).read().splitlines()
    if not lines or lines[0] != header:
        raise SystemExit("header %s" % header)
    levels = {}
    for line in lines[1:]:
        day, cell = line.split(",")
        if day in levels:
            raise SystemExit("duplicate day %s" % day)
        levels[day] = float(cell)
    if not levels or min(levels) != first_day:
        raise SystemExit("archive start %s: %s" % (path, min(levels) if levels else None))
    if last_day is not None and max(levels) != last_day:
        raise SystemExit("archive end %s: %s" % (path, max(levels)))
    if cover is not None and max(levels) < cover:
        raise SystemExit("archive %s does not cover %s" % (path, cover))
    return levels


def day_of_ms(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d")


def stamp_of(ts):
    ts = ts / 1_000_000 if ts > 10**14 else ts / 1000
    return datetime.fromtimestamp(ts, timezone.utc)


def iter_kline_rows(folder):
    if not os.path.isdir(folder):
        raise SystemExit("missing klines %s" % folder)
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".zip"):
            continue
        for line in p5.zip_text(os.path.join(folder, name)).splitlines():
            if not line or line.startswith("open"):
                continue
            yield line.split(",")


def load_field(folder, index, need):
    values = {}
    for parts in iter_kline_rows(folder):
        if len(parts) < need:
            raise SystemExit("kline gap: field %d absent (%d fields)" % (need, len(parts)))
        day = p5.ymd(stamp_of(int(parts[0])))
        if day in values:
            raise SystemExit("duplicate day %s" % day)
        values[day] = float(parts[index])
    return values


def level_changes(levels):
    changes = {}
    for day, level in levels.items():
        prev = p5.ymd(p5.parse_ymd(day) - timedelta(days=1))
        if prev in levels and levels[prev] > 0 and level > 0:
            changes[day] = level / levels[prev] - 1.0
    return changes


def level_diffs(levels):
    changes = {}
    for day, level in levels.items():
        prev = p5.ymd(p5.parse_ymd(day) - timedelta(days=1))
        if prev in levels:
            changes[day] = level - levels[prev]
    return changes


def basis_levels(other, binance):
    levels = {}
    for day, close in other.items():
        spot = binance.get(day)
        if close > 0 and spot is not None and spot > 0:
            levels[day] = close / spot - 1.0
    return levels


def okx_closes():
    closes = {}
    after = OKX_AFTER
    while True:
        url = (
            "https://www.okx.com/api/v5/market/history-candles?instId=BTC-USDT&bar=1Dutc&limit=100&after=%d" % after
        )
        data = fetch_json(url)
        if str(data.get("code")) != "0":
            raise SystemExit("okx %s" % data.get("msg"))
        batch = data.get("data") or []
        if not batch:
            break
        oldest = min(int(row[0]) for row in batch)
        if oldest >= after:
            raise SystemExit("okx pagination did not move")
        for row in batch:
            if len(row) < 9 or row[8] != "1":
                continue
            close = float(row[4])
            if close <= 0:
                continue
            day = day_of_ms(int(row[0]))
            if day in closes and closes[day] != close:
                raise SystemExit("okx duplicate %s" % day)
            closes[day] = close
        if oldest <= OKX_FLOOR:
            break
        after = oldest
        time.sleep(0.15)
    return closes


def open_returns(opens, start, end):
    out = {}
    for day in p5.daterange(start, end):
        nxt = p5.ymd(p5.parse_ymd(day) + timedelta(days=1))
        entry = opens.get(day)
        exit_px = opens.get(nxt)
        if entry is not None and exit_px is not None and entry > 0 and exit_px > 0:
            out[day] = (exit_px / entry - 1.0) * 10000.0
    return out


def score_open(entry_days, btc, eth, cost):
    """Each entry is its own trip: charge entry and exit, do not carry."""
    btc_pnl = 0.0
    eth_pnl = 0.0
    months = {}
    for day in entry_days:
        charge = cost + cost
        btc_pnl += btc[day] - charge
        eth_pnl += eth[day] - charge
        gross = (btc[day] + eth[day]) / 2.0
        month = day[:7]
        months[month] = months.get(month, 0.0) + gross - charge
    pool = (btc_pnl + eth_pnl) / 2.0
    n = len(entry_days)
    return {
        "pool": pool,
        "btc": btc_pnl,
        "eth": eth_pnl,
        "trips": n,
        "long_days": n,
        "months": months,
    }


def null_open(eligible, n_trips, btc, eth, cost):
    rng = random.Random(20260925)
    pools = []
    for _ in range(500):
        chosen = rng.sample(eligible, n_trips)
        pools.append(score_open(chosen, btc, eth, cost)["pool"])
    pools.sort()
    p95 = pools[int(0.95 * len(pools)) - 1]
    p50 = (pools[249] + pools[250]) / 2.0
    return p50, p95


def parse_sol_funding():
    by_day = {}
    first_calc = None
    folder = os.path.join(INP, "funding")
    if not os.path.isdir(folder):
        raise SystemExit("missing funding")
    names = sorted(name for name in os.listdir(folder) if name.endswith(".zip"))
    if not names:
        raise SystemExit("missing SOL funding zips")
    for name in names:
        if not name.startswith("SOLUSDT-fundingRate-"):
            raise SystemExit("funding file is not SOLUSDT: %s" % name)
        lines = p5.zip_text(os.path.join(folder, name)).splitlines()
        header = lines[0].split(",")
        if "last_funding_rate" not in header or "calc_time" not in header:
            raise SystemExit("funding header is not the locked columns: %s" % header)
        ti, ri = header.index("calc_time"), header.index("last_funding_rate")
        for line in lines[1:]:
            if not line:
                continue
            parts = line.split(",")
            day = p5.ymd(datetime.fromtimestamp(int(parts[ti]) / 1000, timezone.utc))
            if first_calc is None or day < first_calc:
                first_calc = day
            by_day.setdefault(day, []).append(float(parts[ri]))
    if first_calc != "2020-09-13":
        raise SystemExit("SOL funding does not start 2020-09-13: %s" % first_calc)
    sums = {}
    for day, rates in by_day.items():
        if len(rates) >= 3:
            sums[day] = sum(rates)
    return sums


def kline_jobs():
    jobs = []
    spans = {
        ("spot", "BTCUSDT"): ("2017-08", "2021-12"),
        ("spot", "ETHUSDT"): ("2017-08", "2021-12"),
        ("spot", "LTCUSDT"): ("2017-12", "2019-12"),
        ("spot", "XRPUSDT"): ("2018-05", "2019-12"),
        ("spot", "ADAUSDT"): ("2018-04", "2019-12"),
        ("spot", "LINKUSDT"): ("2019-01", "2020-12"),
        ("spot", "SOLUSDT"): ("2020-08", "2021-12"),
    }
    for (market, sym), (start, end) in spans.items():
        for ym in p5.months(start, end):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "%s/monthly/klines/%s/1d/%s" % (market, sym, name)
            jobs.append((url, os.path.join(INP, "klines", market, sym, "1d", name)))
    for ym in p5.months("2020-09", "2021-12"):
        name = "SOLUSDT-1d-%s.zip" % ym
        url = p5.VISION + "futures/um/monthly/klines/SOLUSDT/1d/" + name
        jobs.append((url, os.path.join(INP, "klines", "um", "SOLUSDT", "1d", name)))
        fname = "SOLUSDT-fundingRate-%s.zip" % ym
        furl = p5.VISION + "futures/um/monthly/fundingRate/SOLUSDT/" + fname
        jobs.append((furl, os.path.join(INP, "funding", fname)))
    return jobs


def ensure_inputs(btc_closes):
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda job: p5.fetch(*job), kline_jobs()))
    path = os.path.join(INP, "okxbasis.csv")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        print("pass25 keep okxbasis.csv", flush=True)
    else:
        print("pass25 fetch okxbasis.csv", flush=True)
        dump_levels(path, "day,basis", basis_levels(agreed(okx_closes, "okx"), btc_closes))
    print("pass25 inputs ready", flush=True)


def gate(name, base, p50, p95, floor, why_clear, fill):
    reasons = []
    share, month, month_pnl = p5.month_share(base)
    if not base["pool"] > 0:
        reasons.append("pooled P&L is not positive")
    if not base["stress"] > 0:
        reasons.append("doubled cost is not positive")
    if base["trips"] < 60:
        reasons.append("fewer than 60 round trips")
    if not (base["btc"] > 0 and base["eth"] > 0):
        reasons.append("one book is not positive")
    if not base["pool"] > p95:
        reasons.append("does not beat the random-day null")
    if share is not None and share > 0.40:
        reasons.append("one month is more than 40% of P&L")
    if not base["pool"] > floor:
        reasons.append("pooled P&L does not exceed %d bps" % floor)
    return {
        "name": name,
        "fill": fill,
        "pool_bps": round(base["pool"], 1),
        "stress_bps": round(base["stress"], 1),
        "trips": base["trips"],
        "long_days": base["long_days"],
        "execution_days": base["execution_days"],
        "btc_bps": round(base["btc"], 1),
        "eth_bps": round(base["eth"], 1),
        "null_p50_bps": round(p50, 1),
        "null_p95_bps": round(p95, 1),
        "month_share": None if share is None else round(share, 3),
        "top_month": month,
        "top_month_bps": None if month_pnl is None else round(month_pnl, 1),
        "candle_bar_clear": len(reasons) == 0,
        "why": "; ".join(reasons) if reasons else why_clear,
    }


def run_close(name, marked, btc, eth, floor):
    exec_days, flags = [], []
    for day, take in marked:
        if day not in btc or day not in eth:
            continue
        exec_days.append(day)
        flags.append(take)
    if not exec_days:
        raise SystemExit("no execution days for %s" % name)
    base = p5.score(exec_days, flags, btc, eth, 20.0)
    stress = p5.score(exec_days, flags, btc, eth, 40.0)
    base["stress"] = stress["pool"]
    base["execution_days"] = len(exec_days)
    if base["trips"] < 1 or base["long_days"] < 1:
        raise SystemExit("no entries for %s" % name)
    p50, p95 = p5.null_band(exec_days, base["long_days"], btc, eth, 20.0)
    return gate(
        name,
        base,
        p50,
        p95,
        floor,
        "candle bar is clear; closes still cannot pass",
        "close_to_close",
    )


def run_open(name, marked, btc, eth, floor):
    eligible, entries = [], []
    dropped = 0
    for day, take in marked:
        if day not in btc or day not in eth:
            if take:
                dropped += 1
            continue
        eligible.append(day)
        if take:
            entries.append(day)
    if not entries:
        raise SystemExit("no entries for %s" % name)
    base = score_open(entries, btc, eth, 20.0)
    stress = score_open(entries, btc, eth, 40.0)
    base["stress"] = stress["pool"]
    base["execution_days"] = len(eligible)
    base["signals_without_open"] = dropped
    p50, p95 = null_open(eligible, base["trips"], btc, eth, 20.0)
    row = gate(
        name,
        base,
        p50,
        p95,
        floor,
        "open-to-open numeric bar is clear; a Binance daily open is not a Revolut print",
        "open_to_next_open",
    )
    row["signals_without_open"] = dropped
    return row


def self_check():
    p5.self_check()
    series = {p5.ymd(p5.parse_ymd("2020-01-01") + timedelta(days=i)): float(i + 1) for i in range(100)}
    signal = p5.ymd(p5.parse_ymd("2020-01-01") + timedelta(days=90))
    if p5.trailing_threshold(series, signal, 90, 71) != 72.0:
        raise SystemExit("top-quintile index")
    changes = level_changes({"2018-01-01": 10.0, "2018-01-02": 12.0, "2018-01-04": 15.0})
    if abs(changes.get("2018-01-02", 0) - 0.2) > 1e-9 or set(changes) != {"2018-01-02"}:
        raise SystemExit("level change")
    diffs = level_diffs({"2018-01-01": -1.0, "2018-01-02": 2.0})
    if abs(diffs.get("2018-01-02", 0) - 3.0) > 1e-9:
        raise SystemExit("level diff")
    basis = basis_levels({"2018-01-01": 110.0}, {"2018-01-01": 100.0})
    if abs(basis["2018-01-01"] - 0.1) > 1e-12:
        raise SystemExit("basis")
    btc_o = {"2020-01-01": 100.0, "2020-01-02": 110.0, "2020-01-03": 121.0}
    eth_o = {"2020-01-01": 10.0, "2020-01-02": 11.0, "2020-01-03": 9.0}
    btc_r = open_returns(btc_o, "2020-01-01", "2020-01-02")
    eth_r = open_returns(eth_o, "2020-01-01", "2020-01-02")
    if abs(btc_r["2020-01-01"] - 1000.0) > 1e-9 or abs(btc_r["2020-01-02"] - 1000.0) > 1e-9:
        raise SystemExit("btc open return")
    eth_day2 = (9.0 / 11.0 - 1.0) * 10000.0
    if abs(eth_r["2020-01-02"] - eth_day2) > 1e-9:
        raise SystemExit("eth open return")
    one = score_open(["2020-01-01"], btc_r, eth_r, 20.0)
    if one["trips"] != 1 or abs(one["btc"] - 960.0) > 1e-9 or abs(one["pool"] - 960.0) > 1e-9:
        raise SystemExit("one open trip")
    if abs(one["months"]["2020-01"] - 960.0) > 1e-9:
        raise SystemExit("open charges missed the entry month")
    two = score_open(["2020-01-01", "2020-01-02"], btc_r, eth_r, 20.0)
    eth_hand = (1000.0 - 40.0) + (eth_day2 - 40.0)
    if two["trips"] != 2 or abs(two["btc"] - 1920.0) > 1e-6 or abs(two["eth"] - eth_hand) > 1e-6:
        raise SystemExit("two open trips are not two charges")
    if abs(two["pool"] - (1920.0 + eth_hand) / 2.0) > 1e-6:
        raise SystemExit("open pool")
    stress = score_open(["2020-01-01", "2020-01-02"], btc_r, eth_r, 40.0)
    if abs((two["pool"] - stress["pool"]) - 80.0) > 1e-6:
        raise SystemExit("open stress gap")
    if day_of_ms(OKX_FLOOR) != "2018-01-11" or day_of_ms(OKX_AFTER) != "2020-01-01":
        raise SystemExit("okx bounds")


def require_history(name, changes, day):
    prior = sum(1 for item in changes if item < day)
    if prior < 90:
        raise SystemExit("%s has %d changes before %s" % (name, prior, day))


def require_span(name, levels, first, last, saturday):
    if not levels or min(levels) != first:
        raise SystemExit("%s start %s" % (name, min(levels) if levels else None))
    if last not in levels:
        raise SystemExit("%s missing %s" % (name, last))
    if saturday not in levels:
        raise SystemExit("%s dropped %s" % (name, saturday))


def main():
    check = "--check" in sys.argv
    found = require_rules()
    self_check()
    spot_btc = os.path.join(INP, "klines", "spot", "BTCUSDT", "1d")
    spot_eth = os.path.join(INP, "klines", "spot", "ETHUSDT", "1d")
    if not check:
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(lambda job: p5.fetch(*job), [job for job in kline_jobs() if "/klines/BTCUSDT/" in job[0]]))
        ensure_inputs(load_field(spot_btc, 4, 5))
    btc_closes = load_field(spot_btc, 4, 5)
    eth_closes = load_field(spot_eth, 4, 5)
    btc_opens = load_field(spot_btc, 1, 2)
    eth_opens = load_field(spot_eth, 1, 2)
    ltc = load_field(os.path.join(INP, "klines", "spot", "LTCUSDT", "1d"), 4, 5)
    xrp = load_field(os.path.join(INP, "klines", "spot", "XRPUSDT", "1d"), 4, 5)
    ada_quote = load_field(os.path.join(INP, "klines", "spot", "ADAUSDT", "1d"), 7, 8)
    link = load_field(os.path.join(INP, "klines", "spot", "LINKUSDT", "1d"), 4, 5)
    eth_quote = load_field(spot_eth, 7, 8)
    sol_spot = load_field(os.path.join(INP, "klines", "spot", "SOLUSDT", "1d"), 4, 5)
    sol_perp = load_field(os.path.join(INP, "klines", "um", "SOLUSDT", "1d"), 4, 5)
    for day in ("2017-12-31", "2018-12-31", "2019-12-31", "2020-01-01", "2020-12-31", "2021-12-31"):
        if day not in btc_closes or day not in eth_closes or day not in btc_opens or day not in eth_opens:
            raise SystemExit("spot does not cover %s" % day)
    require_span("ltc", ltc, "2017-12-13", "2019-12-31", "2019-01-05")
    require_span("xrp", xrp, "2018-05-04", "2019-12-31", "2019-01-05")
    require_span("adaq", ada_quote, "2018-04-17", "2019-12-31", "2019-01-05")
    require_span("link", link, "2019-01-16", "2020-12-31", "2020-01-04")
    require_span("ethspotq", eth_quote, "2017-08-17", "2021-12-31", "2018-01-06")
    require_span("solspot", sol_spot, "2020-08-11", "2021-12-31", "2021-01-02")
    require_span("solperp", sol_perp, "2020-09-14", "2021-12-31", "2021-01-02")
    okxbasis = load_levels(os.path.join(INP, "okxbasis.csv"), "day,basis", "2018-01-11", cover="2019-12-31")
    if "2019-01-05" not in okxbasis:
        raise SystemExit("okx basis dropped 2019-01-05")
    sol_basis = basis_levels(sol_perp, sol_spot)
    require_span("solbasis", sol_basis, "2020-09-14", "2021-12-31", "2021-01-02")
    sol_fund = parse_sol_funding()
    if "2021-01-02" not in sol_fund or "2021-12-31" not in sol_fund:
        raise SystemExit("SOL funding sum misses the screen")
    btc18 = p5.returns_between(btc_closes, "2018-01-01", "2018-12-31")
    eth18 = p5.returns_between(eth_closes, "2018-01-01", "2018-12-31")
    btc19 = p5.returns_between(btc_closes, "2019-01-01", "2019-12-31")
    eth19 = p5.returns_between(eth_closes, "2019-01-01", "2019-12-31")
    btc20 = p5.returns_between(btc_closes, "2020-01-01", "2020-12-31")
    eth20 = p5.returns_between(eth_closes, "2020-01-01", "2020-12-31")
    btc21 = p5.returns_between(btc_closes, "2021-01-01", "2021-12-31")
    eth21 = p5.returns_between(eth_closes, "2021-01-01", "2021-12-31")
    btc_open = open_returns(btc_opens, "2019-01-01", "2019-12-31")
    eth_open = open_returns(eth_opens, "2019-01-01", "2019-12-31")
    if "2019-12-31" not in btc_open or "2019-12-31" not in eth_open:
        raise SystemExit("2019-12-31 has no next open")
    specs = (
        ("ltc_close_2019", level_changes(ltc), "2019-01-01", "2019-12-31", btc19, eth19),
        ("xrp_close_2019", level_changes(xrp), "2019-01-01", "2019-12-31", btc19, eth19),
        ("eth_spot_quote_2018", level_changes(eth_quote), "2018-01-01", "2018-12-31", btc18, eth18),
        ("sol_funding_2021", level_diffs(sol_fund), "2021-01-01", "2021-12-31", btc21, eth21),
        ("sol_basis_2021", level_diffs(sol_basis), "2021-01-01", "2021-12-31", btc21, eth21),
        ("link_close_2020", level_changes(link), "2020-01-01", "2020-12-31", btc20, eth20),
        ("ada_quote_2019", level_changes(ada_quote), "2019-01-01", "2019-12-31", btc19, eth19),
    )
    kills = {}
    for name, changes, start, end, btc, eth in specs:
        require_history(name, changes, start)
        marked = p5.long_days_for(changes, start, end, 90, 71, False)
        kills[name] = run_close(name, marked, btc, eth, 400)
    okx_changes = level_diffs(okxbasis)
    require_history("okx_basis_open_2019", okx_changes, "2019-01-01")
    marked = p5.long_days_for(okx_changes, "2019-01-01", "2019-12-31", 90, 71, False)
    kills["okx_basis_open_2019"] = run_open("okx_basis_open_2019", marked, btc_open, eth_open, 400)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed before its own result. "
            "The OKX basis is filled open to the next open. "
            "Daily closes can kill a rule. None is a testing row."
        ),
        "rules": {name + "_rule_sha256": digest for name, digest in found.items()},
        "kills": kills,
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass25.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
