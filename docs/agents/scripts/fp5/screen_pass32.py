"""Eight frozen Revolut X screens. Positioning, funding, and relative strength.

Reads the eight rule texts hashed at 2026-09-25 07:05:25 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass32.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
No moving average, breakout, or candlestick pattern is scored.
Liquidation snapshots are not scored.

    python3 docs/agents/scripts/fp5/screen_pass32.py
    python3 docs/agents/scripts/fp5/screen_pass32.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass32")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass32.json")
SHA = {
    "ttpos": "8984b13f8b70e165afee5696b17aa584ce77bfee8f12faf21bd08e2e65184f6e",
    "ttacct": "8e29269d85de9417393ffa1b77a75378be47a44161192e9fdf949bd1dbe1dc00",
    "ethfhi": "85c2702052ed62c3f015ee701c70334f110d0614afcadb8d9af9c6b05a14152e",
    "bnbtrough": "169b36589ef86dc2faa2a424f75bfb69d4cf0fa2415aa55bcee3810d85796e2a",
    "fundsplit": "0feaf89db11de4281ab17c643618a11f401a31f16546dc2435f901db23136b35",
    "solxs": "c24c0511dea9e904dec588c08de25787cce7c088a1d8e7becee0c0f9a22f0921",
    "linkdiv": "30feb5e8ffcb284145ebd439267df42a9754b5b3ff146445a0d59914419a656f",
    "bnbrank": "7f4508db12586f97abbbcb52273ca1675987ad39739830e636f6469031609ed7",
}
POS_COL = "sum_toptrader_long_short_ratio"
ACCT_COL = "count_toptrader_long_short_ratio"


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


def cell_float(text):
    text = text.strip().strip('"')
    if text == "":
        return None
    return float(text)


def pos_level(levels):
    out = set()
    for day, value in levels.items():
        if value * 100.0 > 130.0:
            out.add(day)
    return out


def acct_cross(levels):
    out = set()
    for day, value in levels.items():
        prev = levels.get(p30.shift(day, -1))
        if prev is not None and prev <= 1.0 and value > 1.0:
            out.add(day)
    return out


def fund_hi(sums):
    out = set()
    for day, value in sums.items():
        if value * 1000.0 > 1.0:
            out.add(day)
    return out


def trough(sums):
    out = set()
    for day, value in sums.items():
        if not value < 0:
            continue
        ok = True
        for k in range(1, 6):
            prev = sums.get(p30.shift(day, -k))
            if prev is None or not value < prev:
                ok = False
                break
        if ok:
            out.add(day)
    return out


def fund_split(eth, bnb):
    out = set()
    for day, value in eth.items():
        other = bnb.get(day)
        if other is not None and value > 0 and other < 0:
            out.add(day)
    return out


def excess(alt, base, n):
    out = set()
    for day, px in alt.items():
        prev = p30.shift(day, -n)
        ap, bp, bpp = alt.get(prev), base.get(day), base.get(prev)
        if ap is None or bp is None or bpp is None:
            continue
        if min(px, ap, bp, bpp) <= 0:
            continue
        if 10.0 * (px * bpp - bp * ap) > ap * bpp:
            out.add(day)
    return out


def diverge(alt, base):
    out = set()
    for day, px in alt.items():
        prev = p30.shift(day, -1)
        ap, bp, bpp = alt.get(prev), base.get(day), base.get(prev)
        if ap is None or bp is None or bpp is None:
            continue
        if min(px, ap, bp, bpp) <= 0:
            continue
        if px > ap and bp < bpp:
            out.add(day)
    return out


def rank(lead, left, right, n):
    out = set()
    for day, px in lead.items():
        prev = p30.shift(day, -n)
        lp = lead.get(prev)
        av, ap = left.get(day), left.get(prev)
        bv, bp = right.get(day), right.get(prev)
        if None in (lp, av, ap, bv, bp):
            continue
        if min(px, lp, av, ap, bv, bp) <= 0:
            continue
        if px * ap > av * lp and px * bp > bv * lp:
            out.add(day)
    return out


def input_jobs():
    jobs = []
    spans = {
        "BTCUSDT": ("2017-08", "2022-01"),
        "ETHUSDT": ("2017-08", "2022-01"),
        "SOLUSDT": ("2020-08", "2021-12"),
        "LINKUSDT": ("2019-01", "2020-12"),
        "BNBUSDT": ("2017-11", "2018-12"),
    }
    for sym, (start, end) in spans.items():
        for ym in p5.months(start, end):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1d", name)))
    for sym in ("ETHUSDT", "BNBUSDT"):
        for ym in p5.months("2020-12", "2021-12"):
            name = "%s-fundingRate-%s.zip" % (sym, ym)
            url = p5.VISION + "futures/um/monthly/fundingRate/%s/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "funding", name)))
    for day in p5.daterange("2020-12-01", "2021-12-31"):
        name = "BTCUSDT-metrics-%s.zip" % day
        url = p5.VISION + "futures/um/daily/metrics/BTCUSDT/" + name
        jobs.append((url, os.path.join(INP, "metrics", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), input_jobs()))
    print("pass32 inputs ready", flush=True)


def load_metric_last(folder, col):
    last = {}
    names = sorted(n for n in os.listdir(folder) if n.endswith(".zip"))
    if not names:
        raise SystemExit("metrics gap: no files")
    for name in names:
        lines = p5.zip_text(os.path.join(folder, name)).splitlines()
        header = lines[0].split(",")
        if col not in header or "create_time" not in header:
            raise SystemExit("metrics gap: locked column %s absent" % col)
        ci, vi = header.index("create_time"), header.index(col)
        for line in lines[1:]:
            if not line:
                continue
            parts = line.split(",")
            day = parts[ci][:10]
            last[day] = cell_float(parts[vi])
    return {day: value for day, value in last.items() if value is not None}


def load_funding_sums(folder, prefix):
    by_day = {}
    names = sorted(n for n in os.listdir(folder) if n.startswith(prefix) and n.endswith(".zip"))
    if not names:
        raise SystemExit("funding gap: no %s files" % prefix)
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
            ts = int(parts[ti])
            ts = ts / 1_000_000 if ts > 10**14 else ts / 1000
            day = p5.ymd(datetime.fromtimestamp(ts, timezone.utc))
            by_day.setdefault(day, []).append(float(parts[ri]))
    return {day: sum(rates) for day, rates in by_day.items() if len(rates) >= 3}


def self_check():
    p30.self_check()
    if 1.30 * 100.0 > 130.0 or not (1.31 * 100.0 > 130.0):
        raise SystemExit("position scale")
    if pos_level({"2021-01-01": 1.31}) != {"2021-01-01"}:
        raise SystemExit("position level")
    if pos_level({"2021-01-01": 1.30}):
        raise SystemExit("position tie")
    if acct_cross({"2021-01-01": 1.0, "2021-01-02": 1.01}) != {"2021-01-02"}:
        raise SystemExit("account cross")
    if acct_cross({"2021-01-01": 1.0, "2021-01-02": 1.0}):
        raise SystemExit("account tie")
    if acct_cross({"2021-01-01": 1.2, "2021-01-02": 1.3}):
        raise SystemExit("account already long")
    if 0.001 * 1000.0 > 1.0 or not (0.0011 * 1000.0 > 1.0):
        raise SystemExit("funding scale")
    if fund_hi({"2021-01-01": 0.0011}) != {"2021-01-01"}:
        raise SystemExit("funding high")
    if fund_hi({"2021-01-01": 0.001}):
        raise SystemExit("funding tie")
    sums = {
        "2021-01-01": -0.0005,
        "2021-01-02": 0.0,
        "2021-01-03": 0.001,
        "2021-01-04": 0.002,
        "2021-01-05": -0.0002,
        "2021-01-06": -0.003,
    }
    if trough(sums) != {"2021-01-06"}:
        raise SystemExit("trough")
    sums["2021-01-06"] = -0.0002
    if trough(sums):
        raise SystemExit("trough tie")
    sums["2021-01-06"] = 0.001
    if trough(sums):
        raise SystemExit("trough positive")
    if fund_split({"2021-01-01": 0.0001}, {"2021-01-01": -0.0001}) != {"2021-01-01"}:
        raise SystemExit("funding split")
    if fund_split({"2021-01-01": 0.0}, {"2021-01-01": -0.0001}):
        raise SystemExit("funding split eth zero")
    if fund_split({"2021-01-01": 0.0001}, {"2021-01-01": 0.0}):
        raise SystemExit("funding split bnb zero")
    sol = {"2021-01-01": 100.0, "2021-01-06": 110.0}
    btc = {"2021-01-01": 100.0, "2021-01-06": 100.0}
    if excess(sol, btc, 5):
        raise SystemExit("excess tie")
    sol["2021-01-06"] = 111.0
    if excess(sol, btc, 5) != {"2021-01-06"}:
        raise SystemExit("excess")
    link = {"2020-01-01": 10.0, "2020-01-02": 11.0}
    btc = {"2020-01-01": 10.0, "2020-01-02": 9.0}
    if diverge(link, btc) != {"2020-01-02"}:
        raise SystemExit("diverge")
    btc["2020-01-02"] = 10.0
    if diverge(link, btc):
        raise SystemExit("diverge flat")
    bnb = {"2018-01-01": 10.0, "2018-01-04": 12.0}
    btc = {"2018-01-01": 10.0, "2018-01-04": 11.0}
    eth = {"2018-01-01": 10.0, "2018-01-04": 10.5}
    if rank(bnb, btc, eth, 3) != {"2018-01-04"}:
        raise SystemExit("rank")
    btc["2018-01-04"] = 12.0
    if rank(bnb, btc, eth, 3):
        raise SystemExit("rank tie")


def ret_text(closes, day, n):
    prev = closes[p30.shift(day, -n)]
    return (closes[day] / prev - 1.0) * 100.0


def describe(name, signal, btc_opens, series):
    entry, exit_px, move = p30.btc_open_text(btc_opens, p30.shift(signal, 1))
    if name == "btc_ttpos_2021":
        detail = "position ratio %.8f" % series["pos"][signal]
    elif name == "btc_ttacct_2021":
        detail = "account ratio %.8f then %.8f" % (
            series["acct"][p30.shift(signal, -1)], series["acct"][signal])
    elif name == "eth_fund_hi_2021":
        detail = "ETH funding sum %.8f" % series["eth_f"][signal]
    elif name == "bnb_trough_2021":
        prior = [series["bnb_f"][p30.shift(signal, -k)] for k in range(1, 6)]
        detail = "BNB funding sum %.8f vs prior five max %.8f" % (series["bnb_f"][signal], max(prior))
    elif name == "eth_bnb_fund_2021":
        detail = "ETH funding %.8f BNB funding %.8f" % (series["eth_f"][signal], series["bnb_f"][signal])
    elif name == "sol_excess_2021":
        detail = "SOL 5d %+.4f%% BTC 5d %+.4f%%" % (
            ret_text(series["sol_c"], signal, 5), ret_text(series["btc_c"], signal, 5))
    elif name == "link_div_2020":
        detail = "LINK 1d %+.4f%% BTC 1d %+.4f%%" % (
            ret_text(series["link_c"], signal, 1), ret_text(series["btc_c"], signal, 1))
    elif name == "bnb_rank_2018":
        detail = "BNB 3d %+.4f%% BTC 3d %+.4f%% ETH 3d %+.4f%%" % (
            ret_text(series["bnb_c"], signal, 3),
            ret_text(series["btc_c"], signal, 3),
            ret_text(series["eth_c"], signal, 3))
    else:
        raise SystemExit("no description for %s" % name)
    print("FIRST %s signal %s exec %s %s BTC open %.2f -> %.2f %+.2f" % (
        name, signal, p30.shift(signal, 1), detail, entry, exit_px, move), flush=True)


def main():
    check = "--check" in sys.argv
    found = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    spot = os.path.join(INP, "klines", "spot")
    btc_opens = p30.load_field(os.path.join(spot, "BTCUSDT", "1d"), 1, 2)
    eth_opens = p30.load_field(os.path.join(spot, "ETHUSDT", "1d"), 1, 2)
    btc_c = p30.load_field(os.path.join(spot, "BTCUSDT", "1d"), 4, 5)
    eth_c = p30.load_field(os.path.join(spot, "ETHUSDT", "1d"), 4, 5)
    sol_c = p30.load_field(os.path.join(spot, "SOLUSDT", "1d"), 4, 5)
    link_c = p30.load_field(os.path.join(spot, "LINKUSDT", "1d"), 4, 5)
    bnb_c = p30.load_field(os.path.join(spot, "BNBUSDT", "1d"), 4, 5)
    for day in ("2018-01-01", "2019-01-01", "2020-01-01", "2021-01-01", "2022-01-01"):
        if day not in btc_opens or day not in eth_opens:
            raise SystemExit("spot open does not cover %s" % day)
    p30.require_span("btc", btc_c, "2017-08-17", "2022-01-01", "2021-01-02")
    p30.require_span("eth", eth_c, "2017-08-17", "2022-01-01", "2021-01-02")
    p30.require_span("sol", sol_c, "2020-08-11", "2021-12-31", "2021-01-02")
    p30.require_span("link", link_c, "2019-01-16", "2020-12-31", "2020-01-04")
    p30.require_span("bnb", bnb_c, "2017-11-06", "2018-12-31", "2018-01-06")
    metrics = os.path.join(INP, "metrics")
    pos = load_metric_last(metrics, POS_COL)
    acct = load_metric_last(metrics, ACCT_COL)
    if p5.parse_ymd("2021-01-02").weekday() != 5:
        raise SystemExit("saturday")
    for day in ("2020-12-01", "2020-12-31", "2021-01-02", "2021-12-29"):
        if day not in pos or day not in acct:
            raise SystemExit("metrics missing %s" % day)
    for day in ("2021-12-30", "2021-12-31"):
        path = os.path.join(metrics, "BTCUSDT-metrics-%s.zip" % day)
        if not os.path.exists(path) or day in pos or day in acct:
            raise SystemExit("empty last-row ratio was not dropped %s" % day)
    funding = os.path.join(INP, "funding")
    eth_f = load_funding_sums(funding, "ETHUSDT")
    bnb_f = load_funding_sums(funding, "BNBUSDT")
    for day in ("2020-12-01", "2020-12-31", "2021-01-02", "2021-12-31"):
        if day not in eth_f or day not in bnb_f:
            raise SystemExit("funding missing %s" % day)
    btc_ret = p30.open_returns(btc_opens, "2018-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2018-01-01", "2021-12-31")
    for day in ("2018-12-31", "2020-12-31", "2021-12-31"):
        if day not in btc_ret or day not in eth_ret:
            raise SystemExit("%s has no next open" % day)
    series = {
        "pos": pos, "acct": acct, "eth_f": eth_f, "bnb_f": bnb_f,
        "sol_c": sol_c, "link_c": link_c, "bnb_c": bnb_c, "btc_c": btc_c, "eth_c": eth_c,
    }
    specs = (
        ("btc_ttpos_2021", pos_level(pos), "2021-01-01", "2021-12-31"),
        ("btc_ttacct_2021", acct_cross(acct), "2021-01-01", "2021-12-31"),
        ("eth_fund_hi_2021", fund_hi(eth_f), "2021-01-01", "2021-12-31"),
        ("bnb_trough_2021", trough(bnb_f), "2021-01-01", "2021-12-31"),
        ("eth_bnb_fund_2021", fund_split(eth_f, bnb_f), "2021-01-01", "2021-12-31"),
        ("sol_excess_2021", excess(sol_c, btc_c, 5), "2021-01-01", "2021-12-31"),
        ("link_div_2020", diverge(link_c, btc_c), "2020-01-01", "2020-12-31"),
        ("bnb_rank_2018", rank(bnb_c, btc_c, eth_c, 3), "2018-01-01", "2018-12-31"),
    )
    kills = {}
    for name, signals, start, end in specs:
        row = p30.run_open(name, p30.marked_for(signals, start, end), btc_ret, eth_ret, 400)
        entries = row.pop("_entries")
        raw_pool = row.pop("_pool")
        hand, n = p30.hand_sum(entries, btc_opens, eth_opens)
        if n != row["trips"] or abs(hand - raw_pool) > 0.1 or abs(hand - row["pool_bps"]) > 0.1:
            raise SystemExit("hand sum mismatch %s %s %s %s" % (name, hand, raw_pool, row["pool_bps"]))
        if row["long_days"] != row["trips"]:
            raise SystemExit("open trip was carried %s" % name)
        kills[name] = row
        describe(name, p30.shift(entries[0], -1), btc_opens, series)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 07:05:25 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "None of these is a moving average, a breakout, or a candlestick pattern. "
            "None is a trailing top quintile of a coin's own change. "
            "The OKX basis is not in this run. "
            "Liquidation snapshots are not in this run. "
            "The LINK quote-volume screen is not rerun and its null is not loosened. "
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
            raise SystemExit("summary_pass32.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
