"""Keyless aggregates of Polymarket's reward universe (CLOB /rewards/markets/current, both sponsored flags), 2026-10-01.
Per-market rows are held in memory only and never written or printed (no-peek: they could reconstruct RW's selection).
Prints: counts and money by daily-rate band, and the distribution of the minimum qualifying size and max spread."""
import json, time, urllib.request, urllib.parse, statistics as st
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
            if c not in rows or rate > rows[c][0]:
                rows[c] = (rate, float(x.get("rewards_max_spread") or 0), float(x.get("rewards_min_size") or 0))
        cur = d.get("next_cursor") or ""
        if not cur or cur == "LTE=" or not data: break
        time.sleep(0.15)
vals = list(rows.values()); rows = None
tot = sum(v[0] for v in vals)
print(f"calls {calls}, rewarded markets {len(vals)}, total ${tot:,.0f} a day")
for lo, hi in ((0, 10), (10, 20), (20, 50), (50, 100), (100, 1e12)):
    b = [v for v in vals if lo <= v[0] < hi]
    print(f"  rate ${lo:g}-{hi if hi < 1e12 else 'inf'} a day: {len(b)} markets, ${sum(v[0] for v in b):,.0f} a day ({sum(v[0] for v in b)/tot*100:.1f} %)")
def pct(xs, p): xs = sorted(xs); return xs[min(len(xs) - 1, int(p * len(xs)))]
for name, sel in (("all", vals), ("rate >= $10 (RW's universe)", [v for v in vals if v[0] >= 10])):
    ms = [v[2] for v in sel]; vs = [v[1] for v in sel]
    print(f"  {name}: n {len(sel)}; min size p10/p50/p90 {pct(ms,.1):g}/{pct(ms,.5):g}/{pct(ms,.9):g} shares; share with min size <= 20: {sum(m <= 20 for m in ms)/len(ms)*100:.1f} %; <= 50: {sum(m <= 50 for m in ms)/len(ms)*100:.1f} %; max spread p10/p50/p90 {pct(vs,.1):g}/{pct(vs,.5):g}/{pct(vs,.9):g} c")
