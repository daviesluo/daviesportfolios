"""How far back does the UK tape of each USD stablecoin book go? Counts per sampled day only; never prints a price."""
import json, time, urllib.request, urllib.error, collections, datetime

UA = {"User-Agent": "daviesportfolios-research/1.0 (public market data)"}
BASE = "https://revx.revolut.com/api/1.0/public/trades/all"
DAY = 86400000


def get(url):
    time.sleep(1.2)
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=60) as f:
            return f.status, json.loads(f.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:300]


def ms(day):
    return int(datetime.datetime.fromisoformat(day + "T00:00").replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)


def day_count(sym, day, region):
    """Rows and pages for one UTC day (region filter server-side when given), following the cursor."""
    a = ms(day)
    cursor, rows, pages, regs = "", 0, 0, collections.Counter()
    while True:
        url = f"{BASE}?symbol={sym}&start_date={a}&end_date={a + DAY - 1}&limit=100" + (f"&region={region}" if region else "") + (f"&cursor={cursor}" if cursor else "")
        st, d = get(url)
        if st != 200:
            return f"status {st}"
        data = d.get("data", [])
        rows += len(data); pages += 1
        regs.update(r.get("region") for r in data)
        cursor = (d.get("metadata") or {}).get("next_cursor") or ""
        if not cursor or pages >= 30:
            return rows, pages, dict(regs)


for day in ("2025-09-26", "2025-10-15", "2025-11-10", "2025-11-24", "2025-11-27", "2025-12-10", "2025-12-17", "2026-01-15"):
    for sym in ("USDC-USD", "USDT-USD"):
        print(day, sym, "UK-filter", day_count(sym, day, "UK"), flush=True)
