"""Keyless count of Polymarket's rewarded markets right now (CLOB /rewards/markets/current, both sponsored flags),
the same endpoint RW's selection reads. Writes only the aggregate; per-market rows stay in the gzipped sample."""
import json, gzip, time, urllib.request, urllib.parse
rows, calls = {}, 0
for sponsored in ("false", "true"):
    cur = ""
    for page in range(400):
        q = {"sponsored": sponsored}
        if cur: q["next_cursor"] = cur
        url = "https://clob.polymarket.com/rewards/markets/current?" + urllib.parse.urlencode(q)
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "research"}), timeout=30) as r:
            d = json.loads(r.read()); calls += 1
        data = d.get("data") or []
        for x in data:
            c = x.get("condition_id")
            if not c: continue
            rate = float(x.get("total_daily_rate") or 0) or (float(x.get("native_daily_rate") or 0) + float(x.get("sponsored_daily_rate") or 0))
            if c not in rows or rate > rows[c]["rate"]:
                rows[c] = {"rate": rate, "v": float(x.get("rewards_max_spread") or 0), "min": float(x.get("rewards_min_size") or 0)}
        cur = d.get("next_cursor") or ""
        if not cur or cur == "LTE=" or not data: break
        time.sleep(0.15)
# per-market rows are NOT kept (they would reconstruct RW's selection; no-peek until RW-C's verdict)
rates = sorted((r["rate"] for r in rows.values()), reverse=True)
tot = sum(rates)
print("calls", calls, "rewarded markets", len(rows), "total daily rate $%.0f" % tot)
for n in (10, 100, 1000):
    print(f"  top {n}: ${sum(rates[:n]):,.0f} a day ({sum(rates[:n])/tot*100:.1f} %)")
print("  median rate $%.2f, markets >= $100/day: %d, >= $20/day: %d" % (rates[len(rates)//2], sum(r >= 100 for r in rates), sum(r >= 20 for r in rates)))
