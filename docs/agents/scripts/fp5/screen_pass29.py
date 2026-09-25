"""Eight frozen Revolut X screens. Eight mechanisms, open to the next open.

Reads the eight rule texts hashed at 2026-09-25 06:33:55 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass29.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
The LINK quote-volume screen is not rerun, and its null is not loosened.
None of these rules is a trailing top quintile of a coin's own change.

    python3 docs/agents/scripts/fp5/screen_pass29.py
    python3 docs/agents/scripts/fp5/screen_pass29.py --check
"""
import hashlib, json, os, random, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass29")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass29.json")
SHA = {
    "btchigh": "75bcf956eadae19fb1f2dbaa8a9d4425bd3a6806657914daa64f87e48a6c2efa",
    "ethstreak": "4bdcd314fcf2219d5e02b976445751e5d4e84713caaea6d11427f16fadafb70c",
    "solvwap": "c82cbad72426a84745be42c1feac3fab45d4f7b7dbe95f1f4435fc980535cc0e",
    "atomvol": "002b2a7b1c098897bbcdfa6fc9bcef63f44c1f84850938dc1187e64c41c8a1cf",
    "dotfx": "80f07edb23bb5e14a48c7adc66b5565d6e09bdcb6c31a5f41e875b8523bfa302",
    "avaxrich": "277132fae244c3832b063a3d1e319c0bc73cff4fd19ac33d4f5a26c17ccccf0c",
    "unirev": "f8510eee01bb7f8e4addeda61b07df28e510dd7dada4fa19c3879f9fe69c82c3",
    "dogegap": "cb82ece21948052a3faab96c20023504bdbfc4210cc4314327660b23aeab6c54",
    "btcinside": "b9245c1c03ab10025b011919b93ed95c84a23daf8779fd6c1ff1b1d251202876",
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


def shift(day, n):
    return p5.ymd(p5.parse_ymd(day) + timedelta(days=n))


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


def open_returns(opens, start, end):
    out = {}
    for day in p5.daterange(start, end):
        nxt = shift(day, 1)
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
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
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
    return sums, set(by_day)


def high_signals(closes, window):
    out = set()
    for day, close in closes.items():
        if close <= 0:
            continue
        prior = []
        ok = True
        for k in range(1, window + 1):
            prev = shift(day, -k)
            px = closes.get(prev)
            if px is None or px <= 0:
                ok = False
                break
            prior.append(px)
        if ok and close > max(prior):
            out.add(day)
    return out


def streak_signals(closes):
    out = set()
    for day, close in closes.items():
        p1, p2 = shift(day, -1), shift(day, -2)
        a, b = closes.get(p1), closes.get(p2)
        if close > 0 and a is not None and b is not None and a > 0 and b > 0:
            if close > a and a > b:
                out.add(day)
    return out


def vwap_signals(closes, base, quote):
    out = set()
    for day, close in closes.items():
        b, q = base.get(day), quote.get(day)
        if close > 0 and b is not None and q is not None and b > 0 and q > 0 and close > q / b:
            out.add(day)
    return out


def double_signals(quote):
    out = set()
    for day, vol in quote.items():
        prev = quote.get(shift(day, -1))
        if vol > 0 and prev is not None and prev > 0 and vol > 2.0 * prev:
            out.add(day)
    return out


def cross_signals(sums):
    out = set()
    for day, level in sums.items():
        prev = sums.get(shift(day, -1))
        if prev is not None and prev <= 0 and level > 0:
            out.add(day)
    return out


def rich_signals(perp, spot):
    out = set()
    for day, pc in perp.items():
        sc = spot.get(day)
        if pc > 0 and sc is not None and sc > 0 and pc / sc - 1.0 > 0:
            out.add(day)
    return out


def reversal_signals(opens, closes):
    out = set()
    for day, close in closes.items():
        opened = opens.get(day)
        prev = shift(day, -1)
        pc, po = closes.get(prev), opens.get(prev)
        if None in (opened, pc, po):
            continue
        if close > 0 and opened > 0 and pc > 0 and po > 0 and close < opened and pc > po:
            out.add(day)
    return out


def inside_signals(highs, lows):
    out = set()
    for day, high in highs.items():
        low = lows.get(day)
        prev = shift(day, -1)
        ph, pl = highs.get(prev), lows.get(prev)
        if None in (low, ph, pl):
            continue
        if high > 0 and low > 0 and ph > 0 and pl > 0 and high < ph and low > pl:
            out.add(day)
    return out


def gap_signals(opens, closes, thresh):
    out = set()
    for day, opened in opens.items():
        prev = closes.get(shift(day, -1))
        if opened > 0 and prev is not None and prev > 0 and opened / prev - 1.0 > thresh:
            out.add(day)
    return out


def marked_for(signals, start, end):
    return [(day, shift(day, -1) in signals) for day in p5.daterange(start, end)]


def kline_jobs():
    jobs = []
    spans = {
        ("spot", "BTCUSDT"): ("2017-08", "2022-01"),
        ("spot", "ETHUSDT"): ("2017-08", "2022-01"),
        ("spot", "SOLUSDT"): ("2020-08", "2021-12"),
        ("spot", "ATOMUSDT"): ("2019-04", "2020-12"),
        ("spot", "DOGEUSDT"): ("2019-07", "2020-12"),
        ("spot", "UNIUSDT"): ("2020-09", "2021-12"),
        ("spot", "AVAXUSDT"): ("2020-09", "2021-12"),
    }
    for (market, sym), (start, end) in spans.items():
        for ym in p5.months(start, end):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "%s/monthly/klines/%s/1d/%s" % (market, sym, name)
            jobs.append((url, os.path.join(INP, "klines", market, sym, "1d", name)))
    for ym in p5.months("2020-09", "2021-12"):
        name = "AVAXUSDT-1d-%s.zip" % ym
        url = p5.VISION + "futures/um/monthly/klines/AVAXUSDT/1d/" + name
        jobs.append((url, os.path.join(INP, "klines", "um", "AVAXUSDT", "1d", name)))
    for ym in p5.months("2020-08", "2021-12"):
        name = "DOTUSDT-fundingRate-%s.zip" % ym
        url = p5.VISION + "futures/um/monthly/fundingRate/DOTUSDT/" + name
        jobs.append((url, os.path.join(INP, "funding", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda job: p5.fetch(*job), kline_jobs()))
    print("pass29 inputs ready", flush=True)


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
        "why": "; ".join(reasons) if reasons else "open-to-open numeric bar is clear",
    }


def self_check():
    p5.self_check()
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    btc_o = {"2020-01-01": 100.0, "2020-01-02": 110.0, "2020-01-03": 121.0}
    eth_o = {"2020-01-01": 10.0, "2020-01-02": 11.0, "2020-01-03": 9.0}
    btc_r = open_returns(btc_o, "2020-01-01", "2020-01-02")
    eth_r = open_returns(eth_o, "2020-01-01", "2020-01-02")
    one = score_open(["2020-01-01"], btc_r, eth_r, 20.0)
    if one["trips"] != 1 or abs(one["pool"] - 960.0) > 1e-9:
        raise SystemExit("one open trip")
    eth_day2 = (9.0 / 11.0 - 1.0) * 10000.0
    two = score_open(["2020-01-01", "2020-01-02"], btc_r, eth_r, 20.0)
    eth_hand = (1000.0 - 40.0) + (eth_day2 - 40.0)
    if two["trips"] != 2 or abs(two["btc"] - 1920.0) > 1e-6 or abs(two["eth"] - eth_hand) > 1e-6:
        raise SystemExit("two open trips are not two charges")
    stress = score_open(["2020-01-01", "2020-01-02"], btc_r, eth_r, 40.0)
    if abs((two["pool"] - stress["pool"]) - 80.0) > 1e-6:
        raise SystemExit("open stress gap")
    start = p5.parse_ymd("2020-01-01")
    flat = {p5.ymd(start + timedelta(days=i)): 100.0 for i in range(21)}
    last = p5.ymd(start + timedelta(days=20))
    if last in high_signals(flat, 20):
        raise SystemExit("a tie is not a 20-day high")
    flat[last] = 101.0
    if high_signals(flat, 20) != {last}:
        raise SystemExit("20-day high")
    streak = streak_signals({"2020-01-01": 1.0, "2020-01-02": 2.0, "2020-01-03": 3.0, "2020-01-04": 2.5})
    if streak != {"2020-01-03"}:
        raise SystemExit("streak")
    if vwap_signals({"2020-01-01": 10.0}, {"2020-01-01": 2.0}, {"2020-01-01": 16.0}) != {"2020-01-01"}:
        raise SystemExit("vwap above")
    if vwap_signals({"2020-01-01": 8.0}, {"2020-01-01": 2.0}, {"2020-01-01": 16.0}):
        raise SystemExit("vwap tie")
    if double_signals({"2020-01-01": 10.0, "2020-01-02": 21.0}) != {"2020-01-02"}:
        raise SystemExit("volume double")
    if double_signals({"2020-01-01": 10.0, "2020-01-02": 20.0}):
        raise SystemExit("volume double tie")
    crossed = cross_signals({"2020-01-01": 0.0, "2020-01-02": 0.001, "2020-01-03": 0.002})
    if crossed != {"2020-01-02"}:
        raise SystemExit("funding cross")
    if rich_signals({"2020-01-01": 101.0, "2020-01-02": 100.0}, {"2020-01-01": 100.0, "2020-01-02": 100.0}) != {"2020-01-01"}:
        raise SystemExit("basis level")
    rev = reversal_signals(
        {"2020-01-01": 1.0, "2020-01-02": 2.0},
        {"2020-01-01": 2.0, "2020-01-02": 1.0},
    )
    if rev != {"2020-01-02"}:
        raise SystemExit("reversal")
    gaps = gap_signals({"2020-01-02": 102.0, "2020-01-03": 100.5}, {"2020-01-01": 100.0, "2020-01-02": 100.0}, 0.01)
    if gaps != {"2020-01-02"}:
        raise SystemExit("gap")
    inside = inside_signals(
        {"2020-01-01": 10.0, "2020-01-02": 9.0, "2020-01-03": 11.0},
        {"2020-01-01": 1.0, "2020-01-02": 2.0, "2020-01-03": 2.0},
    )
    if inside != {"2020-01-02"}:
        raise SystemExit("inside day")


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
    btc_close = load_field(os.path.join(spot, "BTCUSDT", "1d"), 4, 5)
    btc_high = load_field(os.path.join(spot, "BTCUSDT", "1d"), 2, 3)
    btc_low = load_field(os.path.join(spot, "BTCUSDT", "1d"), 3, 4)
    eth_close = load_field(os.path.join(spot, "ETHUSDT", "1d"), 4, 5)
    for day in ("2018-01-01", "2019-01-01", "2020-01-01", "2021-01-01", "2022-01-01"):
        if day not in btc_opens or day not in eth_opens:
            raise SystemExit("spot open does not cover %s" % day)
    require_span("btc", btc_close, "2017-08-17", "2018-12-31", "2018-01-06")
    require_span("btchigh", btc_high, "2017-08-17", "2018-12-31", "2018-01-06")
    require_span("btclow", btc_low, "2017-08-17", "2018-12-31", "2018-01-06")
    require_span("eth", eth_close, "2017-08-17", "2018-12-31", "2018-01-06")
    sol_c = load_field(os.path.join(spot, "SOLUSDT", "1d"), 4, 5)
    sol_base = load_field(os.path.join(spot, "SOLUSDT", "1d"), 5, 6)
    sol_quote = load_field(os.path.join(spot, "SOLUSDT", "1d"), 7, 8)
    atom_q = load_field(os.path.join(spot, "ATOMUSDT", "1d"), 7, 8)
    doge_o = load_field(os.path.join(spot, "DOGEUSDT", "1d"), 1, 2)
    doge_c = load_field(os.path.join(spot, "DOGEUSDT", "1d"), 4, 5)
    uni_o = load_field(os.path.join(spot, "UNIUSDT", "1d"), 1, 2)
    uni_c = load_field(os.path.join(spot, "UNIUSDT", "1d"), 4, 5)
    avax_s = load_field(os.path.join(spot, "AVAXUSDT", "1d"), 4, 5)
    avax_p = load_field(os.path.join(INP, "klines", "um", "AVAXUSDT", "1d"), 4, 5)
    require_span("sol", sol_c, "2020-08-11", "2021-12-31", "2021-01-02")
    require_span("atomq", atom_q, "2019-04-29", "2020-12-31", "2020-01-04")
    require_span("doge", doge_c, "2019-07-05", "2020-12-31", "2020-01-04")
    require_span("uni", uni_c, "2020-09-17", "2021-12-31", "2021-01-02")
    require_span("avaxspot", avax_s, "2020-09-22", "2021-12-31", "2021-01-02")
    require_span("avaxperp", avax_p, "2020-09-23", "2021-12-31", "2021-01-02")
    dot_sums, dot_raw = parse_funding("DOTUSDT", "2020-08-20")
    if "2021-01-02" not in dot_raw or "2021-12-31" not in dot_raw:
        raise SystemExit("dot funding dropped a screen day")
    btc_ret = open_returns(btc_opens, "2018-01-01", "2021-12-31")
    eth_ret = open_returns(eth_opens, "2018-01-01", "2021-12-31")
    for day in ("2018-12-31", "2020-12-31", "2021-12-31"):
        if day not in btc_ret or day not in eth_ret:
            raise SystemExit("%s has no next open" % day)
    specs = (
        ("btc_high_2018", high_signals(btc_close, 20), "2018-01-01", "2018-12-31"),
        ("eth_streak_2018", streak_signals(eth_close), "2018-01-01", "2018-12-31"),
        ("sol_vwap_2021", vwap_signals(sol_c, sol_base, sol_quote), "2021-01-01", "2021-12-31"),
        ("atom_double_2020", double_signals(atom_q), "2020-01-01", "2020-12-31"),
        ("dot_funding_cross_2021", cross_signals(dot_sums), "2021-01-01", "2021-12-31"),
        ("avax_basis_level_2021", rich_signals(avax_p, avax_s), "2021-01-01", "2021-12-31"),
        ("uni_reversal_2021", reversal_signals(uni_o, uni_c), "2021-01-01", "2021-12-31"),
        ("btc_inside_2018", inside_signals(btc_high, btc_low), "2018-01-01", "2018-12-31"),
    )
    gap_set = gap_signals(doge_o, doge_c, 0.01)
    gap_exec = [day for day, take in marked_for(gap_set, "2020-01-01", "2020-12-31") if take]
    gap_max = None
    for day, opened in doge_o.items():
        prev = doge_c.get(shift(day, -1))
        if opened > 0 and prev is not None and prev > 0:
            ratio = opened / prev - 1.0
            if gap_max is None or ratio > gap_max:
                gap_max = ratio
    if gap_exec:
        raise SystemExit("doge gap was voided and then fired")
    kills = {}
    for name, signals, start, end in specs:
        marked = marked_for(signals, start, end)
        kills[name] = run_open(name, marked, btc_ret, eth_ret, 400)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed before its own result. "
            "Every fill is the execution-day open to the next open. "
            "None of these is a trailing top quintile of a coin's own change. "
            "The OKX basis is not in this run. "
            "The LINK quote-volume screen is not rerun and its null is not loosened. "
            "A numeric clear is the open-to-open arithmetic and is not adjusted for the venue."
        ),
        "rules": {name + "_rule_sha256": digest for name, digest in found.items()},
        "voids": {
            "doge_gap_2020": {
                "name": "doge_gap_2020",
                "signals": len(gap_exec),
                "max_open_over_prev_close": None if gap_max is None else round(gap_max, 8),
                "why": "hashed and not scored: a DOGE daily open never cleared 1% above the previous close, so the frozen rule has no entry",
            },
        },
        "kills": kills,
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass29.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
