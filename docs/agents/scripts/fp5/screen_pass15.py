"""Two frozen Revolut X screens. Candles can kill a rule. They cannot pass one.

Reads pidx_rule.txt and wiki_rule.txt, checks the sha256 frozen before any
series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass15.json. Public Binance and Wikimedia
archives only. Nothing here places an order or reads a key.

The pageview file is kept only when two pulls return the same bytes.

    python3 docs/agents/scripts/fp5/screen_pass15.py
    python3 docs/agents/scripts/fp5/screen_pass15.py --check
"""
import hashlib, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass15")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass15.json")
PIDX_SHA = "7add4493fd78e7975a8441cc12cfd7b1be794a087300ffae6822f659964c529d"
WIKI_SHA = "f8eab2a18cf94601a5195ea498b81de7d2f1ef0efcd51fa815e9ee8abbfb8794"
WIKI_URL = ("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
            "en.wikipedia/all-access/user/Bitcoin/daily/2015070100/2018123100")
UA = {"User-Agent": "fp5-screen/1.0 (daviesportfolios research)"}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def require_rules():
    pidx = sha256_file(os.path.join(RULES, "pidx_rule.txt"))
    wiki = sha256_file(os.path.join(RULES, "wiki_rule.txt"))
    if pidx != PIDX_SHA or wiki != WIKI_SHA:
        raise SystemExit("rule text moved after the freeze: pidx %s wiki %s" % (pidx, wiki))
    return pidx, wiki


def read_bytes(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


def day_of(ts):
    ts = ts / 1_000_000 if ts > 10**14 else ts / 1000
    return p5.ymd(datetime.fromtimestamp(ts, timezone.utc))


def load_closes(folder):
    out = {}
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".zip"):
            continue
        for line in p5.zip_text(os.path.join(folder, name)).splitlines():
            if not line or line.startswith("open"):
                continue
            parts = line.split(",")
            if len(parts) < 5:
                raise SystemExit("kline gap: field 5 absent (%d fields)" % len(parts))
            out[day_of(int(parts[0]))] = float(parts[4])
    return out


def load_premium(folder):
    out = {}
    names = sorted(n for n in os.listdir(folder) if n.endswith(".zip"))
    if not names:
        raise SystemExit("premium archive is empty")
    first = None
    for name in names:
        for line in p5.zip_text(os.path.join(folder, name)).splitlines():
            if not line or line.startswith("open"):
                continue
            parts = line.split(",")
            if len(parts) < 5:
                raise SystemExit("premium gap: field 5 absent (%d fields)" % len(parts))
            day = day_of(int(parts[0]))
            out[day] = float(parts[4])
            if first is None or day < first:
                first = day
    if first != "2020-01-01":
        raise SystemExit("premium archive does not start 2020-01-01")
    if "2021-12-31" not in out:
        raise SystemExit("premium archive does not cover 2021-12-31")
    return out


def level_changes(levels):
    changes = {}
    for day, level in levels.items():
        prev = p5.ymd(p5.parse_ymd(day) - timedelta(days=1))
        if prev in levels and levels[prev] > 0:
            changes[day] = level / levels[prev] - 1.0
    return changes


def level_diffs(levels):
    changes = {}
    for day, level in levels.items():
        prev = p5.ymd(p5.parse_ymd(day) - timedelta(days=1))
        if prev in levels:
            changes[day] = level - levels[prev]
    return changes


def fetch_wiki(dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    first = read_bytes(WIKI_URL)
    second = read_bytes(WIKI_URL)
    if first != second:
        raise SystemExit("wikipedia pulls do not match; not scored")
    payload = json.loads(first.decode())
    items = payload.get("items") or []
    if not items or items[0].get("article") != "Bitcoin" or items[0].get("project") != "en.wikipedia":
        raise SystemExit("wikipedia article is not en Bitcoin")
    if "views" not in items[0] or "timestamp" not in items[0]:
        raise SystemExit("wikipedia columns absent")
    rows = ["day,views"]
    for item in items:
        if item.get("article") != "Bitcoin":
            raise SystemExit("wikipedia row is not Bitcoin")
        stamp = item["timestamp"]
        if len(stamp) != 10 or not stamp.endswith("00"):
            raise SystemExit("wikipedia timestamp")
        day = "%s-%s-%s" % (stamp[0:4], stamp[4:6], stamp[6:8])
        rows.append("%s,%d" % (day, int(item["views"])))
    if rows[1].split(",")[0] != "2015-07-01":
        raise SystemExit("wikipedia archive does not start 2015-07-01")
    if not any(line.startswith("2018-12-31,") for line in rows):
        raise SystemExit("wikipedia archive does not cover 2018-12-31")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    with open(tmp, "w") as f:
        f.write("\n".join(rows) + "\n")
    os.replace(tmp, dest)


def ensure_inputs():
    jobs = []
    for sym, start, end in (("BTCUSDT", "2017-12", "2018-12"), ("ETHUSDT", "2017-12", "2018-12"),
                            ("BTCUSDT", "2020-12", "2021-12"), ("ETHUSDT", "2020-12", "2021-12")):
        for ym in p5.months(start, end):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", sym, name)))
    for ym in p5.months("2020-01", "2021-12"):
        name = "BTCUSDT-1d-%s.zip" % ym
        url = p5.VISION + "futures/um/monthly/premiumIndexKlines/BTCUSDT/1d/%s" % name
        jobs.append((url, os.path.join(INP, "premium", name)))
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), jobs))
    fetch_wiki(os.path.join(INP, "wiki.csv"))


def load_views(path):
    lines = open(path).read().splitlines()
    if not lines or lines[0] != "day,views":
        raise SystemExit("wiki header")
    if lines[1].split(",")[0] != "2015-07-01":
        raise SystemExit("wikipedia archive does not start 2015-07-01")
    levels = {}
    for line in lines[1:]:
        day, cell = line.split(",")
        levels[day] = float(cell)
    if "2018-12-31" not in levels:
        raise SystemExit("wikipedia archive does not cover 2018-12-31")
    return levels


def run_rule(name, marked, btc, eth, floor):
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
    p50, p95 = p5.null_band(exec_days, base["long_days"], btc, eth, 20.0)
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
        "pool_bps": round(base["pool"], 1),
        "stress_bps": round(base["stress"], 1),
        "trips": base["trips"],
        "long_days": base["long_days"],
        "execution_days": len(exec_days),
        "btc_bps": round(base["btc"], 1),
        "eth_bps": round(base["eth"], 1),
        "null_p50_bps": round(p50, 1),
        "null_p95_bps": round(p95, 1),
        "month_share": None if share is None else round(share, 3),
        "top_month": month,
        "top_month_bps": None if month_pnl is None else round(month_pnl, 1),
        "candle_bar_clear": len(reasons) == 0,
        "why": "; ".join(reasons) if reasons else "candle bar is clear; closes still cannot pass",
    }


def self_check():
    p5.self_check()
    series = {p5.ymd(p5.parse_ymd("2020-01-01") + timedelta(days=i)): float(i + 1) for i in range(100)}
    signal = p5.ymd(p5.parse_ymd("2020-01-01") + timedelta(days=90))
    if p5.trailing_threshold(series, signal, 90, 71) != 72.0:
        raise SystemExit("top-quintile index")
    diffs = level_diffs({"2020-01-01": -0.01, "2020-01-02": 0.02, "2020-01-04": 0.05})
    if abs(diffs.get("2020-01-02", 0) - 0.03) > 1e-12 or set(diffs) != {"2020-01-02"}:
        raise SystemExit("level diff: %s" % diffs)
    changes = level_changes({"2018-01-01": 10.0, "2018-01-02": 11.0, "2018-01-04": 12.0})
    if abs(changes.get("2018-01-02", 0) - 0.1) > 1e-12 or set(changes) != {"2018-01-02"}:
        raise SystemExit("level change: %s" % changes)
    us = datetime.fromtimestamp(1735689600000000 / 1_000_000, timezone.utc)
    ms = datetime.fromtimestamp(1606780800000 / 1000, timezone.utc)
    if p5.ymd(us) != "2025-01-01" or p5.ymd(ms) != "2020-12-01":
        raise SystemExit("kline timestamp unit")


def main():
    check = "--check" in sys.argv
    pidx_sha, wiki_sha = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    elif not os.path.isfile(os.path.join(INP, "wiki.csv")) or not os.path.isdir(os.path.join(INP, "premium")):
        raise SystemExit("missing frozen inputs; run without --check first")
    btc = load_closes(os.path.join(INP, "klines", "BTCUSDT"))
    eth = load_closes(os.path.join(INP, "klines", "ETHUSDT"))
    btc_p = p5.returns_between(btc, "2021-01-01", "2021-12-31")
    eth_p = p5.returns_between(eth, "2021-01-01", "2021-12-31")
    btc_w = p5.returns_between(btc, "2018-01-01", "2018-12-31")
    eth_w = p5.returns_between(eth, "2018-01-01", "2018-12-31")
    premium = level_diffs(load_premium(os.path.join(INP, "premium")))
    wiki = level_changes(load_views(os.path.join(INP, "wiki.csv")))
    premium_marked = p5.long_days_for(premium, "2021-01-01", "2021-12-31", 90, 71, False)
    wiki_marked = p5.long_days_for(wiki, "2018-01-01", "2018-12-31", 90, 71, False)
    summary = {
        "reached_preregistration": False,
        "note": "Each rule was hashed before its own result. Daily closes can kill a rule. Neither is a pass.",
        "rules": {"pidx_rule_sha256": pidx_sha, "wiki_rule_sha256": wiki_sha},
        "kills": {
            "premium_index_2021": run_rule("premium_index_2021", premium_marked, btc_p, eth_p, 400),
            "wiki_views_2018": run_rule("wiki_views_2018", wiki_marked, btc_w, eth_w, 400),
        },
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass15.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
