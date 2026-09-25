"""Three UK triangles cashed in the same minute.

Hashed at 2026-09-25 20:36:22 UTC. The exit is that minute's close on
the other book, not the next UK four-hour open.

    python3 docs/agents/scripts/fp5/screen_pass74.py
    python3 docs/agents/scripts/fp5/screen_pass74.py --check
"""
import hashlib, json, os, random, sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass74")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass74.json")
FROZEN = "2026-09-25 20:36:22 UTC"
ORDER = ("rxusdc", "rxgbp", "rxsgbp")
SHA = {
    "rxusdc": "d6f59a0d3ae5c06ddb0cfacb72bcd2ca231a13d974e86913c4259288cc5ea689",
    "rxgbp": "132bdf3a9336bcab7d58be25cced574719d344a352333d14f94744f6cf8d22c7",
    "rxsgbp": "15eff7020b2435febef76fc284ccda36aa2b787cf784646fff5ba3dda5a583aa",
}
COST = 20
STRESS_SIDE = 40
SYMBOLS = (
    "BTC-USD", "ETH-USD", "BTC-USDC", "ETH-USDC", "USDC-USD",
    "BTC-GBP", "ETH-GBP", "USDC-GBP",
)
NZ = {
    "BTC-USD": 10370,
    "ETH-USD": 7855,
    "BTC-USDC": 375,
    "ETH-USDC": 170,
    "USDC-USD": 810,
    "BTC-GBP": 16487,
    "ETH-GBP": 10715,
    "USDC-GBP": 1247,
}
N_ROWS = 41543
FIRST_MS = 1787875200000
LAST_MS = 1790367840000
GAP_BEFORE = 1788417540000
GAP_AFTER = 1788417720000
SPECS = {
    "rxusdc": {
        "orders": 3,
        "symbols": ("BTC-USD", "ETH-USD", "BTC-USDC", "ETH-USDC", "USDC-USD"),
    },
    "rxgbp": {
        "orders": 4,
        "symbols": ("BTC-USD", "ETH-USD", "BTC-GBP", "ETH-GBP", "USDC-USD", "USDC-GBP"),
    },
    "rxsgbp": {
        "orders": 5,
        "symbols": ("BTC-USDC", "ETH-USDC", "BTC-GBP", "ETH-GBP", "USDC-USD", "USDC-GBP"),
    },
}
# First eligible minute of each rule. None of the three fired, so the pin
# is that minute's gross, and the net is not positive on both coins.
PINS = {
    "rxusdc": {
        "kind": "elig",
        "ms": 1788525000000,
        "btc_dir": "buy_usd_sell_usdc",
        "eth_dir": "buy_usd_sell_usdc",
        "btc_gross": 47.06480426473148,
        "eth_gross": 66.06282997027479,
        "btc_net": -12.935195735268522,
        "eth_net": 6.062829970274791,
        "px": {
            "BTC_USD": 80190.71,
            "BTC_USDC": 80560.07,
            "ETH_USD": 2479.39,
            "ETH_USDC": 2495.52,
            "USDC_USD": 1.0001,
        },
    },
    "rxgbp": {
        "kind": "elig",
        "ms": 1788131820000,
        "btc_dir": "buy_gbp_sell_usd",
        "eth_dir": "buy_usd_sell_gbp",
        "btc_gross": 0.48572449705241993,
        "eth_gross": 5.764003033412735,
        "btc_net": -79.51427550294758,
        "eth_net": -74.23599696658727,
        "px": {
            "BTC_GBP": 57767.62,
            "BTC_USD": 78200.0,
            "ETH_GBP": 1815.0,
            "ETH_USD": 2455.43,
            "USDC_GBP": 0.7389,
            "USDC_USD": 1.0002,
        },
    },
    "rxsgbp": {
        "kind": "elig",
        "ms": 1788525000000,
        "btc_dir": "buy_gbp_sell_usdc",
        "eth_dir": "buy_gbp_sell_usdc",
        "btc_gross": 18.885795841845354,
        "eth_gross": 39.40143696929965,
        "btc_net": -81.11420415815465,
        "eth_net": -60.59856303070035,
        "px": {
            "BTC_GBP": 59429.71,
            "BTC_USDC": 80560.07,
            "ETH_GBP": 1837.2,
            "ETH_USDC": 2495.52,
            "USDC_GBP": 0.7391,
            "USDC_USD": 1.0001,
        },
    },
}


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


def near(a, b):
    return abs(a - b) <= 1e-6 * max(1.0, abs(b))


def fee_of(name):
    spec = SPECS.get(name)
    if spec is None:
        raise SystemExit("unknown rule %s" % name)
    orders = spec["orders"]
    if orders * COST not in (60, 80, 100):
        raise SystemExit("fee moved %s" % name)
    return orders * COST, orders * STRESS_SIDE, orders


def bps(received, paid):
    return (received / paid - 1.0) * 10000.0


def pick(left, right, left_name, right_name):
    if left > 0 and right > 0:
        raise SystemExit("both directions positive")
    if left < 0 and right < 0:
        raise SystemExit("both directions negative")
    if left >= right:
        return left, left_name
    return right, right_name


def usdc_side(usd, usdc, fx):
    sold = usdc * fx
    sell_usdc = bps(sold, usd)
    sell_usd = bps(usd, sold)
    return pick(sell_usdc, sell_usd, "buy_usd_sell_usdc", "buy_usdc_sell_usd")


def gbp_side(usd, gbp, usdcusd, usdcgbp):
    implied = gbp * usdcusd / usdcgbp
    sell_gbp = bps(implied, usd)
    sell_usd = bps(usd, implied)
    return pick(sell_gbp, sell_usd, "buy_usd_sell_gbp", "buy_gbp_sell_usd")


def sgbp_side(usdc, gbp, usdcusd, usdcgbp):
    paid = usdc * usdcusd
    received = gbp / usdcgbp * usdcusd
    sell_gbp = bps(received, paid)
    sell_usdc = bps(paid, received)
    return pick(sell_gbp, sell_usdc, "buy_usdc_sell_gbp", "buy_gbp_sell_usdc")


def closes_at(name, books, ms):
    spec = SPECS.get(name)
    if spec is None:
        raise SystemExit("unknown rule %s" % name)
    out = {}
    for symbol in spec["symbols"]:
        row = books[symbol].get(ms)
        if row is None:
            return None
        close, vol = row
        if vol <= 0 or close <= 0:
            return None
        out[symbol] = close
    return out


def gross_at(name, px):
    if name == "rxusdc":
        btc_g, btc_d = usdc_side(px["BTC-USD"], px["BTC-USDC"], px["USDC-USD"])
        eth_g, eth_d = usdc_side(px["ETH-USD"], px["ETH-USDC"], px["USDC-USD"])
    elif name == "rxgbp":
        btc_g, btc_d = gbp_side(px["BTC-USD"], px["BTC-GBP"], px["USDC-USD"], px["USDC-GBP"])
        eth_g, eth_d = gbp_side(px["ETH-USD"], px["ETH-GBP"], px["USDC-USD"], px["USDC-GBP"])
    elif name == "rxsgbp":
        btc_g, btc_d = sgbp_side(px["BTC-USDC"], px["BTC-GBP"], px["USDC-USD"], px["USDC-GBP"])
        eth_g, eth_d = sgbp_side(px["ETH-USDC"], px["ETH-GBP"], px["USDC-USD"], px["USDC-GBP"])
    else:
        raise SystemExit("unknown rule %s" % name)
    return btc_g, eth_g, btc_d, eth_d


def load_book(symbol):
    path = os.path.join(INP, symbol + "_1m.json")
    with open(path) as f:
        rows = json.load(f)
    if len(rows) != N_ROWS:
        raise SystemExit("length %s %d" % (symbol, len(rows)))
    out = {}
    prev = None
    nz = 0
    for row in rows:
        if len(row) != 3:
            raise SystemExit("shape %s" % symbol)
        start = int(row[0])
        close = float(row[1])
        vol = float(row[2])
        if start % 60000 != 0:
            raise SystemExit("not a minute %s %s" % (symbol, start))
        if close <= 0 or vol < 0:
            raise SystemExit("price %s %s" % (symbol, start))
        if prev is None:
            if start != FIRST_MS:
                raise SystemExit("first %s" % symbol)
        else:
            gap = start - prev
            if gap == 180000 and prev == GAP_BEFORE and start == GAP_AFTER:
                pass
            elif gap != 60000:
                raise SystemExit("gap %s %s %s" % (symbol, prev, start))
        if start in out:
            raise SystemExit("duplicate %s %s" % (symbol, start))
        prev = start
        if vol > 0:
            nz += 1
        out[start] = (close, vol)
    if prev != LAST_MS:
        raise SystemExit("last %s" % symbol)
    if nz != NZ[symbol]:
        raise SystemExit("traded minutes %s %d" % (symbol, nz))
    return out


def build(name, books):
    fee, _stress, _orders = fee_of(name)
    symbols = SPECS[name]["symbols"]
    times = None
    for symbol in symbols:
        traded = {ms for ms, (close, vol) in books[symbol].items() if vol > 0 and close > 0}
        times = traded if times is None else times & traded
    eligible = []
    fires = []
    one_btc = 0
    one_eth = 0
    max_btc = None
    max_eth = None
    max_joint = None
    for ms in sorted(times):
        px = closes_at(name, books, ms)
        if px is None:
            raise SystemExit("eligible minute dropped %s %s" % (name, ms))
        btc_g, eth_g, btc_d, eth_d = gross_at(name, px)
        btc_n = btc_g - fee
        eth_n = eth_g - fee
        row = {
            "ms": ms,
            "btc_gross": btc_g,
            "eth_gross": eth_g,
            "btc_net": btc_n,
            "eth_net": eth_n,
            "btc_dir": btc_d,
            "eth_dir": eth_d,
            "px": px,
        }
        eligible.append(row)
        if max_btc is None or btc_g > max_btc:
            max_btc = btc_g
        if max_eth is None or eth_g > max_eth:
            max_eth = eth_g
        joint = btc_g if btc_g < eth_g else eth_g
        if max_joint is None or joint > max_joint:
            max_joint = joint
        btc_fire = btc_n > 0
        eth_fire = eth_n > 0
        if btc_fire and eth_fire:
            fires.append(row)
        elif btc_fire:
            one_btc += 1
        elif eth_fire:
            one_eth += 1
    return {
        "eligible": eligible,
        "fires": fires,
        "one_btc": one_btc,
        "one_eth": one_eth,
        "max_btc": 0.0 if max_btc is None else max_btc,
        "max_eth": 0.0 if max_eth is None else max_eth,
        "max_joint": 0.0 if max_joint is None else max_joint,
    }


def pin_view(row):
    px = row["px"]
    flat = {key.replace("-", "_"): px[key] for key in sorted(px)}
    return {
        "ms": row["ms"],
        "btc_gross": row["btc_gross"],
        "eth_gross": row["eth_gross"],
        "btc_net": row["btc_net"],
        "eth_net": row["eth_net"],
        "btc_dir": row["btc_dir"],
        "eth_dir": row["eth_dir"],
        "px": flat,
    }


def require_pin(name, built):
    fires = built["fires"]
    eligible = built["eligible"]
    if fires:
        kind = "fire"
        row = fires[0]
    elif eligible:
        kind = "elig"
        row = eligible[0]
    else:
        kind = "empty"
        row = None
    if name not in PINS:
        payload = {"kind": kind}
        if row is not None:
            payload.update(pin_view(row))
        print("PIN %s %s" % (name, json.dumps(payload, sort_keys=True)), flush=True)
        return False
    want = PINS[name]
    if want["kind"] != kind:
        raise SystemExit("pin kind %s %s" % (name, kind))
    if kind == "empty":
        return
    got = pin_view(row)
    if got["ms"] != want["ms"] or got["btc_dir"] != want["btc_dir"] or got["eth_dir"] != want["eth_dir"]:
        raise SystemExit("pin identity %s" % name)
    for key in ("btc_gross", "eth_gross", "btc_net", "eth_net"):
        if not near(got[key], want[key]):
            raise SystemExit("pin %s %s %.10f %.10f" % (name, key, got[key], want[key]))
    for key, price in got["px"].items():
        if not near(price, want["px"][key]):
            raise SystemExit("pin price %s %s" % (name, key))
    if kind == "fire":
        if not (got["btc_net"] > 0 and got["eth_net"] > 0):
            raise SystemExit("pinned fire is not a fire")
    if kind == "elig":
        if got["btc_net"] > 0 and got["eth_net"] > 0:
            raise SystemExit("pinned eligible minute is a fire")
    return True


def score(fires, fee):
    btc_pnl = 0.0
    eth_pnl = 0.0
    months = {}
    for row in fires:
        btc_n = row["btc_gross"] - fee
        eth_n = row["eth_gross"] - fee
        btc_pnl += btc_n
        eth_pnl += eth_n
        inc = (btc_n + eth_n) / 2.0
        month = stamp(row["ms"]).strftime("%Y-%m")
        months[month] = months.get(month, 0.0) + inc
    return {
        "pool": (btc_pnl + eth_pnl) / 2.0,
        "btc": btc_pnl,
        "eth": eth_pnl,
        "trips": len(fires),
        "months": months,
    }


def hand_sum(fires, fee):
    pool = 0.0
    for row in fires:
        pool += ((row["btc_gross"] - fee) + (row["eth_gross"] - fee)) / 2.0
    return pool, len(fires)


def edge_off(eligible, fee):
    pool = 0.0
    for row in eligible:
        pool += ((row["btc_gross"] - fee) + (row["eth_gross"] - fee)) / 2.0
    return pool


def null_long(eligible, n_trips, fee):
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    rng = random.Random(20260925)
    pools = []
    for _ in range(500):
        if n_trips == 0:
            pools.append(0.0)
            continue
        chosen = rng.sample(eligible, n_trips)
        pool = 0.0
        for row in chosen:
            pool += ((row["btc_gross"] - fee) + (row["eth_gross"] - fee)) / 2.0
        pools.append(pool)
    pools.sort()
    return (pools[249] + pools[250]) / 2.0, pools[474]


def month_share(scored):
    if scored["pool"] <= 0 or not scored["months"]:
        return None, None, None
    month, pnl = max(scored["months"].items(), key=lambda kv: kv[1])
    return pnl / scored["pool"], month, pnl


def jac(left, right):
    a, b = set(left), set(right)
    inter = len(a & b)
    union = len(a | b) or 1
    return inter / union


def self_check():
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    try:
        fee_of("rxnope")
    except SystemExit as exc:
        if "unknown rule" not in str(exc):
            raise
    else:
        raise SystemExit("unknown rule did not raise")
    for name, orders, fee in (("rxusdc", 3, 60), ("rxgbp", 4, 80), ("rxsgbp", 5, 100)):
        got_fee, got_stress, got_orders = fee_of(name)
        if got_orders != orders or got_fee != orders * COST or got_fee != fee:
            raise SystemExit("cost %s" % name)
        if got_stress != orders * STRESS_SIDE:
            raise SystemExit("stress cost %s" % name)
    gross, direction = usdc_side(100.0, 100.0, 1.01)
    if direction != "buy_usd_sell_usdc" or not near(gross, 100.0) or not near(gross - 60.0, 40.0):
        raise SystemExit("usdc 100 bp fixture")
    gross, direction = usdc_side(100.0, 100.0, 1.001)
    if not near(gross, 10.0) or not near(gross - 60.0, -50.0):
        raise SystemExit("usdc 10 bp fixture")
    gross, direction = usdc_side(100.0, 100.0, 1.0)
    if gross != 0.0 or direction != "buy_usd_sell_usdc":
        raise SystemExit("equal prices fire")
    # One FX print is shared, so a one-coin split needs two different coin ratios.
    btc_g, _d = usdc_side(100.0, 100.0, 1.01)
    eth_g, _d = usdc_side(100.0, 100.0, 1.001)
    if not near(btc_g, 100.0) or not near(eth_g, 10.0):
        raise SystemExit("split fixture prices")
    if (btc_g - 60.0) > 0 and (eth_g - 60.0) > 0:
        raise SystemExit("one coin rich fired")
    both = {
        "BTC-USD": 100.0, "ETH-USD": 50.0, "BTC-USDC": 100.0, "ETH-USDC": 50.0, "USDC-USD": 1.01,
    }
    btc_g, eth_g, btc_d, eth_d = gross_at("rxusdc", both)
    if not (near(btc_g, 100.0) and near(eth_g, 100.0) and btc_d == eth_d == "buy_usd_sell_usdc"):
        raise SystemExit("both coins fixture")
    fires = [{
        "ms": FIRST_MS,
        "btc_gross": btc_g,
        "eth_gross": eth_g,
        "btc_dir": btc_d,
        "eth_dir": eth_d,
    }]
    scored = score(fires, 60.0)
    if scored["trips"] != 1 or not near(scored["pool"], 40.0) or not near(scored["btc"], 40.0):
        raise SystemExit("pool 40")
    hand, n_hand = hand_sum(fires, 60.0)
    if n_hand != 1 or abs(hand - scored["pool"]) > 0.1:
        raise SystemExit("hand sum fixture")
    quiet = [{
        "ms": FIRST_MS,
        "btc_gross": 10.0,
        "eth_gross": 100.0,
    }]
    if score(quiet, 60.0)["pool"] > 0 and (10.0 - 60.0) > 0:
        raise SystemExit("one coin path")
    # The screen fires only when both nets are positive. The quiet row is not a fire.
    if (10.0 - 60.0) > 0 or not (100.0 - 60.0) > 0:
        raise SystemExit("one coin threshold")
    gross, direction = gbp_side(100.0, 80.0, 1.01, 0.8)
    if direction != "buy_usd_sell_gbp" or not near(gross, 100.0) or not near(gross - 80.0, 20.0):
        raise SystemExit("gbp fixture")
    gross, _d = gbp_side(100.0, 80.0, 1.0, 0.8)
    if gross != 0.0:
        raise SystemExit("gbp equal")
    gross, direction = sgbp_side(100.0, 81.0, 1.0, 0.8)
    if direction != "buy_usdc_sell_gbp" or not near(gross, 125.0) or not near(gross - 100.0, 25.0):
        raise SystemExit("sgbp fixture")
    gross_hi, _d = sgbp_side(100.0, 81.0, 2.0, 0.8)
    if not near(gross_hi, gross):
        raise SystemExit("usdc-usd price cancels and the fee does not")
    if near(gross_hi - 60.0, 25.0):
        raise SystemExit("five-order fee was lowered")
    if closes_at("rxusdc", {
        "BTC-USD": {FIRST_MS: (100.0, 0.0)},
        "ETH-USD": {FIRST_MS: (50.0, 1.0)},
        "BTC-USDC": {FIRST_MS: (100.0, 1.0)},
        "ETH-USDC": {FIRST_MS: (50.0, 1.0)},
        "USDC-USD": {FIRST_MS: (1.01, 1.0)},
    }, FIRST_MS) is not None:
        raise SystemExit("zero volume counted")


def cleared(scored, stress, p95, share):
    return bool(
        scored["pool"] > 0
        and stress > 0
        and scored["trips"] >= 60
        and scored["btc"] > 0
        and scored["eth"] > 0
        and scored["pool"] > p95
        and share is not None
        and share <= 0.40
        and scored["pool"] > 400.0
    )


def main():
    check = "--check" in sys.argv
    found = require_rules()
    self_check()
    books = {symbol: load_book(symbol) for symbol in SYMBOLS}
    inputs = {}
    for symbol in SYMBOLS:
        inputs[symbol + "_1m_sha256"] = sha256_file(os.path.join(INP, symbol + "_1m.json"))
    built = {}
    pinned = True
    for name in ORDER:
        built[name] = build(name, books)
        pinned = require_pin(name, built[name]) and pinned
    if not pinned:
        raise SystemExit("first row is not pinned")
    kills = {}
    lines = []
    sets = {}
    for name in ORDER:
        fee, stress_fee, orders = fee_of(name)
        pack = built[name]
        fires = pack["fires"]
        base = score(fires, fee)
        stress = score(fires, stress_fee)
        hand, n_hand = hand_sum(fires, fee)
        if n_hand != base["trips"] or abs(hand - base["pool"]) > 0.1:
            raise SystemExit("hand sum mismatch %s" % name)
        if base["trips"] > len(pack["eligible"]):
            raise SystemExit("trips outside the window %s" % name)
        p50, p95 = null_long(pack["eligible"], base["trips"], fee)
        off = edge_off(pack["eligible"], fee)
        share, month, month_pnl = month_share(base)
        ok = cleared(base, stress["pool"], p95, share)
        if ok:
            raise SystemExit("a clear is not a testing row")
        sets[name] = [row["ms"] for row in fires]
        row_out = {
            "btc_bps": base["btc"],
            "cleared": ok,
            "edge_off_bps": off,
            "eligible": len(pack["eligible"]),
            "eth_bps": base["eth"],
            "fee_bps": fee,
            "max_btc_gross_bps": pack["max_btc"],
            "max_eth_gross_bps": pack["max_eth"],
            "max_joint_gross_bps": pack["max_joint"],
            "month": month,
            "month_pnl_bps": month_pnl,
            "month_share": share,
            "null_p50_bps": p50,
            "null_p95_bps": p95,
            "one_sided_btc": pack["one_btc"],
            "one_sided_eth": pack["one_eth"],
            "orders": orders,
            "pool_bps": base["pool"],
            "stress_bps": stress["pool"],
            "trips": base["trips"],
        }
        if abs(hand - row_out["pool_bps"]) > 0.1:
            raise SystemExit("hand sum record %s" % name)
        kills[name] = row_out
        share_txt = "none" if share is None else "%.3f" % share
        print(
            "BOOK %s pool %.1f stress %.1f btc %.1f eth %.1f trips %d elig %d p95 %.1f off %.1f share %s"
            % (
                name, row_out["pool_bps"], row_out["stress_bps"], row_out["btc_bps"], row_out["eth_bps"],
                row_out["trips"], row_out["eligible"], row_out["null_p95_bps"], row_out["edge_off_bps"], share_txt,
            ),
            flush=True,
        )
        elig_word = "eligible minute" if row_out["eligible"] == 1 else "eligible minutes"
        lines.append(
            "%s is %.1f bps over %d trips, %d %s, stress %.1f, BTC %.1f, ETH %.1f, edge-off %.1f, null p95 %.1f, one-sided BTC %d, one-sided ETH %d, max joint gross %.1f"
            % (
                name, row_out["pool_bps"], row_out["trips"], row_out["eligible"], elig_word, row_out["stress_bps"],
                row_out["btc_bps"], row_out["eth_bps"], row_out["edge_off_bps"], row_out["null_p95_bps"],
                row_out["one_sided_btc"], row_out["one_sided_eth"], row_out["max_joint_gross_bps"],
            )
        )
    pairs = (
        ("rxusdc", "rxgbp"),
        ("rxusdc", "rxsgbp"),
        ("rxgbp", "rxsgbp"),
    )
    pair_txt = []
    overlap = {}
    for left, right in pairs:
        got = jac(sets[left], sets[right])
        overlap["%s_%s" % (left, right)] = got
        pair_txt.append("%s against %s is Jaccard %.3f" % (left, right, got))
    summary = {
        "inputs_sha256": inputs,
        "kills": kills,
        "note": (
            "Each rule was hashed at 2026-09-25 20:36:22 UTC, before any of these minute closes was joined to a P&L. "
            "Three triangles were scored. A threshold is not a second rule. "
            "Pass 72's six forwards are not rerun. Pass 73 hashed nothing. The sentence that pass 74 was not opened is the state at 20:18 UTC. "
            "The exit is the same minute. It is not the next UK four-hour open. The previous minute's open is not the fair value. "
            "The tape is one-minute UK closes, region=UK, pulled 2026-09-25 20:24:52 UTC through 20:34:26 UTC from https://revx.revolut.com/api/1.0/public/candles/{SYM}?interval=1&region=UK. "
            "Each file stores start, close, and volume. A minute counts only when every leg has volume strictly above zero. "
            "A zero-volume minute is the vendor's mid and is not a fill. "
            "Each book has 41,543 rows from 2026-08-28 00:00 UTC through 2026-09-25 20:24 UTC. "
            "2026-09-03 06:40 UTC and 06:41 UTC are absent on every book. They are not filled. "
            "The public tape does not store the historical bid or ask. The fill is that minute's close, the last trade. Two closes in one minute can be up to sixty seconds apart. "
            "rxusdc buys one coin book and sells the other, and sells or buys USDC-USD. Three taker orders, 60 bps. "
            "Dollars from selling the USDC book are the USDC close times the USDC-USD close. Dollars paid are the USD close. The other direction is the reciprocal. "
            "rxgbp turns sterling into dollars on USDC-USD and USDC-GBP. There is no GBP-USD book. Four taker orders, 80 bps. "
            "Dollars from selling the sterling book are the GBP close times the USDC-USD close divided by the USDC-GBP close. "
            "rxsgbp buys the USDC coin book and sells the sterling coin book, starting and ending in dollars. Five taker orders, 100 bps. "
            "The two USDC-USD orders use this tape's one close, so their prices cancel and their fees do not. "
            "The minute takes the direction with the larger gross. Both coins must clear. One coin does not fire the trip. "
            "The charge is 20 bps on each taker order. The 9 bp schedule is not used. Stress charges 40 bps on each order. "
            "The edge-off control is every eligible minute, both coins, the better direction, fee still charged, including a negative net. It is not an extra rule. "
            "The null is 500 draws of the same trip count from those eligible minutes, seed 20260925, index 474, summing that unfiltered net. "
            "A count below 60 is still scored. The gate is not lowered. A zero count is scored as zero. "
            + ". ".join(lines)
            + ". "
            + ". ".join(pair_txt)
            + ". "
            "Each fire set is empty, so that Jaccard is zero trips over an empty union. "
            "No eligible minute had both coins strictly above the fee. "
            "Different books are not the same sentence. "
            "Beating a negative edge-off pool or a negative null while the pool stays under the gates is not close to a pass. "
            "No testing row is opened. A numeric clear on these closes is still not paper testing, because no order of this account was shown crossing the book. "
            "The five earlier numeric clears and the confirmation-time fall after a higher day stay void. "
            "The pass 67 result of +263.2 bps over 17 trips stays not close to a pass. "
            "Pass 75 is not opened."
        ),
        "overlap_jaccard": overlap,
        "reached_preregistration": False,
        "rules": {name + "_rule_sha256": found[name] for name in ORDER},
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass74.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
