"""Eight frozen Revolut X screens. Every fill is open to the next open.

Reads the eight rule texts hashed at 2026-09-25 06:18:00 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass27.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.

    python3 docs/agents/scripts/fp5/screen_pass27.py
    python3 docs/agents/scripts/fp5/screen_pass27.py --check
"""
import hashlib, json, os, random, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass27")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass27.json")
SHA = {
    "atompx": "aa84e9483b9369f9a0b5284c7a27dc51792086dbf055b09bb9b585af1d265f74",
    "avaxpx": "cb839626aa49dc5dca81515014570a3f23312065725790b8625794a3500ec992",
    "unipx": "73298931fa267587bf1076b8ca2de50caad450515c2da1bac884897288331c3e",
    "maticq": "233e95b0d8c6c847fe432312cf875580f11eb50d8c4678d335fdcc910bf1b7b8",
    "linkfund": "328a7da26bd6eb81faa3487fb8c55eebbe4d06a10f86d31354fb10fae747d280",
    "ltcfund": "aa05541a2c07f8dcf6c6864699c764ec7b27521ab5a6503cc214453f83a4c3fd",
    "bnbq": "50b7d2697ff18b06bd23635471fb7d60a744eab6e00ab60935dec6b1876a8a56",
    "dotbasis": "bfe1998c79375fe2e2867ec1015ae364c27723deadea21110e9cf443d2cba3b8",
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
        have = sha256_file(os.path.join(RULES, name + "_rule.txt"))
        if have != digest:
            raise SystemExit("rule text moved after the freeze: %s %s" % (name, have))
        found[name] = have
    return found


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


def basis_levels(other, spot):
    levels = {}
    for day, close in other.items():
        px = spot.get(day)
        if close > 0 and px is not None and px > 0:
            levels[day] = close / px - 1.0
    return levels


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
    n = len(entry_days)
    return {
        "pool": (btc_pnl + eth_pnl) / 2.0,
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


def parse_funding(symbol, first_calc):
    by_day = {}
    seen = None
    folder = os.path.join(INP, "funding")
    if not os.path.isdir(folder):
        raise SystemExit("missing funding")
    prefix = symbol + "-fundingRate-"
    names = sorted(name for name in os.listdir(folder) if name.startswith(prefix) and name.endswith(".zip"))
    if not names:
        raise SystemExit("missing %s funding" % symbol)
    for name in names:
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
            if seen is None or day < seen:
                seen = day
            by_day.setdefault(day, []).append(float(parts[ri]))
    if seen != first_calc:
        raise SystemExit("%s funding does not start %s: %s" % (symbol, first_calc, seen))
    sums = {}
    for day, rates in by_day.items():
        if len(rates) >= 3:
            sums[day] = sum(rates)
    return sums


def kline_jobs():
    jobs = []
    spans = {
        ("spot", "BTCUSDT"): ("2019-01", "2022-01"),
        ("spot", "ETHUSDT"): ("2019-01", "2022-01"),
        ("spot", "ATOMUSDT"): ("2019-04", "2020-12"),
        ("spot", "AVAXUSDT"): ("2020-09", "2021-12"),
        ("spot", "UNIUSDT"): ("2020-09", "2021-12"),
        ("spot", "MATICUSDT"): ("2019-04", "2020-12"),
        ("spot", "BNBUSDT"): ("2017-11", "2019-12"),
        ("spot", "DOTUSDT"): ("2020-08", "2021-12"),
    }
    for (market, sym), (start, end) in spans.items():
        for ym in p5.months(start, end):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "%s/monthly/klines/%s/1d/%s" % (market, sym, name)
            jobs.append((url, os.path.join(INP, "klines", market, sym, "1d", name)))
    for ym in p5.months("2020-08", "2021-12"):
        name = "DOTUSDT-1d-%s.zip" % ym
        url = p5.VISION + "futures/um/monthly/klines/DOTUSDT/1d/" + name
        jobs.append((url, os.path.join(INP, "klines", "um", "DOTUSDT", "1d", name)))
    funds = {"LINKUSDT": ("2020-01", "2021-12"), "LTCUSDT": ("2020-01", "2021-12")}
    for sym, (start, end) in funds.items():
        for ym in p5.months(start, end):
            name = "%s-fundingRate-%s.zip" % (sym, ym)
            url = p5.VISION + "futures/um/monthly/fundingRate/%s/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "funding", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda job: p5.fetch(*job), kline_jobs()))
    print("pass27 inputs ready", flush=True)


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
    p50, p95 = null_open(eligible, base["trips"], btc, eth, 20.0)
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
        "fill": "open_to_next_open",
        "pool_bps": round(base["pool"], 1),
        "stress_bps": round(base["stress"], 1),
        "trips": base["trips"],
        "long_days": base["long_days"],
        "execution_days": len(eligible),
        "signals_without_open": dropped,
        "btc_bps": round(base["btc"], 1),
        "eth_bps": round(base["eth"], 1),
        "null_p50_bps": round(p50, 1),
        "null_p95_bps": round(p95, 1),
        "month_share": None if share is None else round(share, 3),
        "top_month": month,
        "top_month_bps": None if month_pnl is None else round(month_pnl, 1),
        "candle_bar_clear": len(reasons) == 0,
        "why": "; ".join(reasons) if reasons else "open-to-open numeric bar is clear; a Binance daily open is not a Revolut print",
    }


def self_check():
    p5.self_check()
    series = {p5.ymd(p5.parse_ymd("2020-01-01") + timedelta(days=i)): float(i + 1) for i in range(100)}
    signal = p5.ymd(p5.parse_ymd("2020-01-01") + timedelta(days=90))
    if p5.trailing_threshold(series, signal, 90, 71) != 72.0:
        raise SystemExit("top-quintile index")
    btc_o = {"2020-01-01": 100.0, "2020-01-02": 110.0, "2020-01-03": 121.0}
    eth_o = {"2020-01-01": 10.0, "2020-01-02": 11.0, "2020-01-03": 9.0}
    btc_r = open_returns(btc_o, "2020-01-01", "2020-01-02")
    eth_r = open_returns(eth_o, "2020-01-01", "2020-01-02")
    if abs(btc_r["2020-01-01"] - 1000.0) > 1e-9:
        raise SystemExit("btc open return")
    eth_day2 = (9.0 / 11.0 - 1.0) * 10000.0
    if abs(eth_r["2020-01-02"] - eth_day2) > 1e-9:
        raise SystemExit("eth open return")
    one = score_open(["2020-01-01"], btc_r, eth_r, 20.0)
    if one["trips"] != 1 or abs(one["pool"] - 960.0) > 1e-9:
        raise SystemExit("one open trip")
    two = score_open(["2020-01-01", "2020-01-02"], btc_r, eth_r, 20.0)
    eth_hand = (1000.0 - 40.0) + (eth_day2 - 40.0)
    if two["trips"] != 2 or abs(two["btc"] - 1920.0) > 1e-6 or abs(two["eth"] - eth_hand) > 1e-6:
        raise SystemExit("two open trips are not two charges")
    stress = score_open(["2020-01-01", "2020-01-02"], btc_r, eth_r, 40.0)
    if abs((two["pool"] - stress["pool"]) - 80.0) > 1e-6:
        raise SystemExit("open stress gap")
    basis = basis_levels({"2018-01-01": 110.0}, {"2018-01-01": 100.0})
    if abs(basis["2018-01-01"] - 0.1) > 1e-12:
        raise SystemExit("basis")


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
    if not check:
        ensure_inputs()
    spot = os.path.join(INP, "klines", "spot")
    btc_opens = load_field(os.path.join(spot, "BTCUSDT", "1d"), 1, 2)
    eth_opens = load_field(os.path.join(spot, "ETHUSDT", "1d"), 1, 2)
    for day in ("2019-01-01", "2020-01-01", "2021-01-01", "2022-01-01"):
        if day not in btc_opens or day not in eth_opens:
            raise SystemExit("spot open does not cover %s" % day)
    atom = load_field(os.path.join(spot, "ATOMUSDT", "1d"), 4, 5)
    avax = load_field(os.path.join(spot, "AVAXUSDT", "1d"), 4, 5)
    uni = load_field(os.path.join(spot, "UNIUSDT", "1d"), 4, 5)
    matic = load_field(os.path.join(spot, "MATICUSDT", "1d"), 7, 8)
    bnb = load_field(os.path.join(spot, "BNBUSDT", "1d"), 7, 8)
    dot_spot = load_field(os.path.join(spot, "DOTUSDT", "1d"), 4, 5)
    dot_perp = load_field(os.path.join(INP, "klines", "um", "DOTUSDT", "1d"), 4, 5)
    require_span("atom", atom, "2019-04-29", "2020-12-31", "2020-01-04")
    require_span("avax", avax, "2020-09-22", "2021-12-31", "2021-01-02")
    require_span("uni", uni, "2020-09-17", "2021-12-31", "2021-01-02")
    require_span("maticq", matic, "2019-04-26", "2020-12-31", "2020-01-04")
    require_span("bnbq", bnb, "2017-11-06", "2019-12-31", "2019-01-05")
    require_span("dotspot", dot_spot, "2020-08-18", "2021-12-31", "2021-01-02")
    require_span("dotperp", dot_perp, "2020-08-22", "2021-12-31", "2021-01-02")
    dot_basis = basis_levels(dot_perp, dot_spot)
    require_span("dotbasis", dot_basis, "2020-08-22", "2021-12-31", "2021-01-02")
    link_fund = parse_funding("LINKUSDT", "2020-01-17")
    ltc_fund = parse_funding("LTCUSDT", "2020-01-09")
    for name, levels in (("linkfund", link_fund), ("ltcfund", ltc_fund)):
        if "2021-01-02" not in levels or "2021-12-31" not in levels:
            raise SystemExit("%s misses the screen" % name)
    btc_ret = open_returns(btc_opens, "2019-01-01", "2021-12-31")
    eth_ret = open_returns(eth_opens, "2019-01-01", "2021-12-31")
    for day in ("2019-12-31", "2020-12-31", "2021-12-31"):
        if day not in btc_ret or day not in eth_ret:
            raise SystemExit("%s has no next open" % day)
    specs = (
        ("atom_close_2020", level_changes(atom), "2020-01-01", "2020-12-31"),
        ("avax_close_2021", level_changes(avax), "2021-01-01", "2021-12-31"),
        ("uni_close_2021", level_changes(uni), "2021-01-01", "2021-12-31"),
        ("matic_quote_2020", level_changes(matic), "2020-01-01", "2020-12-31"),
        ("link_funding_2021", level_diffs(link_fund), "2021-01-01", "2021-12-31"),
        ("ltc_funding_2021", level_diffs(ltc_fund), "2021-01-01", "2021-12-31"),
        ("bnb_quote_2019", level_changes(bnb), "2019-01-01", "2019-12-31"),
        ("dot_basis_2021", level_diffs(dot_basis), "2021-01-01", "2021-12-31"),
    )
    kills = {}
    for name, changes, start, end in specs:
        require_history(name, changes, start)
        marked = p5.long_days_for(changes, start, end, 90, 71, False)
        kills[name] = run_open(name, marked, btc_ret, eth_ret, 400)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The OKX basis is not in this run. None is a testing row."
        ),
        "rules": {name + "_rule_sha256": digest for name, digest in found.items()},
        "kills": kills,
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass27.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
