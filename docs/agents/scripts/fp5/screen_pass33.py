"""Eight frozen Revolut X screens. New positioning, funding, and relative strength.

Reads the eight rule texts hashed at 2026-09-25 07:14:03 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass33.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
No moving average, breakout, or candlestick pattern is scored.
Liquidation snapshots are not scored and are not replaced.

    python3 docs/agents/scripts/fp5/screen_pass33.py
    python3 docs/agents/scripts/fp5/screen_pass33.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass33")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass33.json")
SHA = {
    "ttdecline": "494f6cf5f34aa402ca097bed18a13db651e6cf6fbab66ec1355a1971ed887aa7",
    "ttspread": "c885ca6865606c9f4f9575810d609b5fa3c4b87fb570d3bce51fa52a24d9fbc9",
    "ttsplit": "66ec9ec42199f2309627e9a4e76c55a41fb2c4c5f586157ce35899426b9f375f",
    "fundboth": "d5f00f2632b10f9e723c3ab32afffa0458751f2cc95f3bdca8298af2cf781882",
    "ethpeak": "58e09028c3ad91b5ec22579e6cb05f1bd60daa2268f13b7351d4d2bba094486c",
    "fundord": "8778c4fb9b676f72e10bc42beaf6c0c8972e394813a3155ab9c131233f49314d",
    "rschain": "8be64ec2152d4105eb17b3f1e90cbd39de91d59ec282cd38540925362bc8b70f",
    "rsdouble": "dadbfb6e5935277a88694966368a84f39959fd4b79e933af6c45d5ac04b7b37b",
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


def decline(levels):
    out = set()
    for day, value in levels.items():
        prev = levels.get(p30.shift(day, -1))
        older = levels.get(p30.shift(day, -2))
        if prev is None or older is None:
            continue
        if value < prev < older and value > 1.0:
            out.add(day)
    return out


def spread(pos, acct):
    out = set()
    for day, position in pos.items():
        account = acct.get(day)
        if account is None:
            continue
        if (account - position) * 100.0 > 200.0:
            out.add(day)
    return out


def split_dir(pos, acct):
    out = set()
    for day, position in pos.items():
        prev = p30.shift(day, -1)
        account = acct.get(day)
        ppos = pos.get(prev)
        pacc = acct.get(prev)
        if None in (account, ppos, pacc):
            continue
        if position > ppos and account < pacc:
            out.add(day)
    return out


def both_neg(eth, bnb):
    out = set()
    for day, value in eth.items():
        other = bnb.get(day)
        if other is not None and value < 0 and other < 0:
            out.add(day)
    return out


def peak(maxes):
    out = set()
    for day, value in maxes.items():
        if value * 10000.0 > 5.0:
            out.add(day)
    return out


def fund_order(ltc, ada):
    out = set()
    for day, lead in ltc.items():
        other = ada.get(day)
        if other is not None and lead > other and other > 0:
            out.add(day)
    return out


def chain(sol, eth, btc):
    out = set()
    for day, sol_px in sol.items():
        prev = p30.shift(day, -1)
        sp, ep, eprev = sol.get(prev), eth.get(day), eth.get(prev)
        bp, bprev = btc.get(day), btc.get(prev)
        if None in (sp, ep, eprev, bp, bprev):
            continue
        if min(sol_px, sp, ep, eprev, bp, bprev) <= 0:
            continue
        if sol_px * eprev > ep * sp and ep * bprev > bp * eprev:
            out.add(day)
    return out


def double(eth, btc):
    out = set()
    for day, eth_px in eth.items():
        prev = p30.shift(day, -1)
        eprev, bp, bprev = eth.get(prev), btc.get(day), btc.get(prev)
        if None in (eprev, bp, bprev):
            continue
        if min(eth_px, eprev, bp, bprev) <= 0:
            continue
        if eth_px > eprev and bp > bprev and bprev * (eth_px + eprev) > 2.0 * eprev * bp:
            out.add(day)
    return out


def input_jobs():
    jobs = []
    spans = {
        "BTCUSDT": ("2017-08", "2022-01"),
        "ETHUSDT": ("2017-08", "2022-01"),
        "SOLUSDT": ("2020-08", "2021-12"),
    }
    for sym, (start, end) in spans.items():
        for ym in p5.months(start, end):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1d", name)))
    for sym in ("ETHUSDT", "BNBUSDT", "LTCUSDT", "ADAUSDT"):
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
    print("pass33 inputs ready", flush=True)


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


def _funding_rows(folder, prefix):
    names = sorted(n for n in os.listdir(folder) if n.startswith(prefix) and n.endswith(".zip"))
    if not names:
        raise SystemExit("funding gap: no %s files" % prefix)
    by_day = {}
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
    return by_day


def load_funding_sums(folder, prefix):
    return {day: sum(rates) for day, rates in _funding_rows(folder, prefix).items() if len(rates) >= 3}


def load_funding_max(folder, prefix):
    return {day: max(rates) for day, rates in _funding_rows(folder, prefix).items() if len(rates) >= 3}


def self_check():
    p30.self_check()
    levels = {"2021-01-01": 1.3, "2021-01-02": 1.2, "2021-01-03": 1.1}
    if decline(levels) != {"2021-01-03"}:
        raise SystemExit("decline")
    levels["2021-01-03"] = 1.2
    if decline(levels):
        raise SystemExit("decline tie")
    levels["2021-01-03"] = 1.0
    if decline(levels):
        raise SystemExit("decline at one")
    if (3.0 - 1.0) * 100.0 > 200.0 or not (3.01 - 1.0) * 100.0 > 200.0:
        raise SystemExit("spread scale")
    pos = {"2021-01-01": 1.0}
    acct = {"2021-01-01": 3.0}
    if spread(pos, acct):
        raise SystemExit("spread tie")
    acct["2021-01-01"] = 3.01
    if spread(pos, acct) != {"2021-01-01"}:
        raise SystemExit("spread")
    pos = {"2021-01-01": 1.1, "2021-01-02": 1.2}
    acct = {"2021-01-01": 2.0, "2021-01-02": 1.5}
    if split_dir(pos, acct) != {"2021-01-02"}:
        raise SystemExit("split")
    pos["2021-01-02"] = 1.1
    if split_dir(pos, acct):
        raise SystemExit("split position tie")
    if both_neg({"2021-01-01": -0.0001}, {"2021-01-01": -0.0001}) != {"2021-01-01"}:
        raise SystemExit("both negative")
    if both_neg({"2021-01-01": 0.0}, {"2021-01-01": -0.0001}):
        raise SystemExit("both negative zero")
    if 0.0005 * 10000.0 > 5.0 or not (0.00051 * 10000.0 > 5.0):
        raise SystemExit("peak scale")
    if peak({"2021-01-01": 0.0005}):
        raise SystemExit("peak tie")
    if peak({"2021-01-01": 0.00051}) != {"2021-01-01"}:
        raise SystemExit("peak")
    if fund_order({"2021-01-01": 0.002}, {"2021-01-01": 0.001}) != {"2021-01-01"}:
        raise SystemExit("fund order")
    if fund_order({"2021-01-01": 0.001}, {"2021-01-01": 0.001}):
        raise SystemExit("fund order tie")
    if fund_order({"2021-01-01": 0.001}, {"2021-01-01": 0.0}):
        raise SystemExit("fund order ada zero")
    sol = {"2021-01-01": 100.0, "2021-01-02": 120.0}
    eth = {"2021-01-01": 100.0, "2021-01-02": 110.0}
    btc = {"2021-01-01": 100.0, "2021-01-02": 100.0}
    if chain(sol, eth, btc) != {"2021-01-02"}:
        raise SystemExit("chain")
    sol["2021-01-02"] = 110.0
    if chain(sol, eth, btc):
        raise SystemExit("chain tie")
    btc = {"2018-01-01": 100.0, "2018-01-02": 110.0}
    eth = {"2018-01-01": 100.0, "2018-01-02": 120.0}
    if double(eth, btc):
        raise SystemExit("double tie")
    eth["2018-01-02"] = 121.0
    if double(eth, btc) != {"2018-01-02"}:
        raise SystemExit("double")
    btc["2018-01-02"] = 100.0
    if double(eth, btc):
        raise SystemExit("double btc flat")


def ret_text(closes, day):
    prev = closes[p30.shift(day, -1)]
    return (closes[day] / prev - 1.0) * 100.0


def describe(name, signal, btc_opens, series):
    entry, exit_px, move = p30.btc_open_text(btc_opens, p30.shift(signal, 1))
    if name == "btc_ttdecline_2021":
        detail = "position %.8f < %.8f < %.8f" % (
            series["pos"][signal],
            series["pos"][p30.shift(signal, -1)],
            series["pos"][p30.shift(signal, -2)])
    elif name == "btc_ttspread_2021":
        account = series["acct"][signal]
        position = series["pos"][signal]
        detail = "account %.8f position %.8f gap %.8f" % (account, position, account - position)
    elif name == "btc_ttsplit_2021":
        prev = p30.shift(signal, -1)
        detail = "position %.8f to %.8f, account %.8f to %.8f" % (
            series["pos"][prev], series["pos"][signal], series["acct"][prev], series["acct"][signal])
    elif name == "eth_bnb_both_2021":
        detail = "ETH funding %.8f BNB funding %.8f" % (series["eth_f"][signal], series["bnb_f"][signal])
    elif name == "eth_peak_2021":
        detail = "ETH max funding print %.8f" % series["eth_max"][signal]
    elif name == "ltc_ada_fund_2021":
        detail = "LTC funding %.8f ADA funding %.8f" % (series["ltc_f"][signal], series["ada_f"][signal])
    elif name == "sol_chain_2021":
        detail = "SOL %+.4f%% ETH %+.4f%% BTC %+.4f%%" % (
            ret_text(series["sol_c"], signal), ret_text(series["eth_c"], signal), ret_text(series["btc_c"], signal))
    elif name == "eth_double_2018":
        detail = "ETH %+.4f%% BTC %+.4f%%" % (ret_text(series["eth_c"], signal), ret_text(series["btc_c"], signal))
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
    for day in ("2018-01-01", "2019-01-01", "2021-01-01", "2022-01-01"):
        if day not in btc_opens or day not in eth_opens:
            raise SystemExit("spot open does not cover %s" % day)
    p30.require_span("btc", btc_c, "2017-08-17", "2022-01-01", "2021-01-02")
    p30.require_span("eth", eth_c, "2017-08-17", "2022-01-01", "2018-01-06")
    p30.require_span("sol", sol_c, "2020-08-11", "2021-12-31", "2021-01-02")
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
    ltc_f = load_funding_sums(funding, "LTCUSDT")
    ada_f = load_funding_sums(funding, "ADAUSDT")
    eth_max = load_funding_max(funding, "ETHUSDT")
    for day in ("2020-12-01", "2020-12-31", "2021-01-02", "2021-12-31"):
        if day not in eth_f or day not in bnb_f or day not in ltc_f or day not in ada_f or day not in eth_max:
            raise SystemExit("funding missing %s" % day)
    btc_ret = p30.open_returns(btc_opens, "2018-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2018-01-01", "2021-12-31")
    for day in ("2018-12-31", "2021-12-31"):
        if day not in btc_ret or day not in eth_ret:
            raise SystemExit("%s has no next open" % day)
    series = {
        "pos": pos, "acct": acct, "eth_f": eth_f, "bnb_f": bnb_f,
        "ltc_f": ltc_f, "ada_f": ada_f, "eth_max": eth_max,
        "sol_c": sol_c, "btc_c": btc_c, "eth_c": eth_c,
    }
    specs = (
        ("btc_ttdecline_2021", decline(pos), "2021-01-01", "2021-12-31"),
        ("btc_ttspread_2021", spread(pos, acct), "2021-01-01", "2021-12-31"),
        ("btc_ttsplit_2021", split_dir(pos, acct), "2021-01-01", "2021-12-31"),
        ("eth_bnb_both_2021", both_neg(eth_f, bnb_f), "2021-01-01", "2021-12-31"),
        ("eth_peak_2021", peak(eth_max), "2021-01-01", "2021-12-31"),
        ("ltc_ada_fund_2021", fund_order(ltc_f, ada_f), "2021-01-01", "2021-12-31"),
        ("sol_chain_2021", chain(sol_c, eth_c, btc_c), "2021-01-01", "2021-12-31"),
        ("eth_double_2018", double(eth_c, btc_c), "2018-01-01", "2018-12-31"),
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
            "Each rule was hashed at 2026-09-25 07:14:03 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "None of these is a moving average, a breakout, or a candlestick pattern. "
            "None lowers 1.30, 0.001, the five-day funding window, or the 10% SOL excess. "
            "The OKX basis is not in this run. "
            "Liquidation snapshots are not in this run and are not replaced. "
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
            raise SystemExit("summary_pass33.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
