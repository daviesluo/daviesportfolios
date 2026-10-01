"""Power check for POOLAGE (2026-10-01): how many reward configs began on each recent UTC day, among the configs
active now, and the daily rate they carry. Aggregates only; no per-market row is written or printed."""
import json, time, urllib.request, urllib.parse, collections, datetime as dt
by_day, rate_day, n_cfg, lens = collections.Counter(), collections.Counter(), 0, []
for sponsored in ("false", "true"):
    cur = ""
    for page in range(400):
        q = {"sponsored": sponsored}
        if cur: q["next_cursor"] = cur
        d = json.loads(urllib.request.urlopen(urllib.request.Request(
            "https://clob.polymarket.com/rewards/markets/current?" + urllib.parse.urlencode(q),
            headers={"User-Agent": "research"}), timeout=30).read())
        for x in d.get("data") or []:
            for c in x.get("rewards_config") or []:
                s = str(c.get("start_date") or "")[:10]
                e = str(c.get("end_date") or "")[:10]
                n_cfg += 1
                by_day[s] += 1
                rate_day[s] += float(c.get("rate_per_day") or 0)
                try:
                    if e and not e.startswith("2500"):
                        lens.append((dt.date.fromisoformat(e) - dt.date.fromisoformat(s)).days)
                except Exception: pass
        cur = d.get("next_cursor") or ""
        if not cur or cur == "LTE=" or not d.get("data"): break
        time.sleep(0.15)
print("active reward configs", n_cfg)
for day in sorted(by_day)[-16:]:
    print(f"  started {day}: {by_day[day]:>5} configs, ${rate_day[day]:>9,.0f} a day")
old = sum(v for k, v in by_day.items() if k < "2026-09-17")
print(f"  started before 2026-09-17: {old} configs, ${sum(v for k, v in rate_day.items() if k < '2026-09-17'):,.0f} a day")
if lens:
    lens.sort(); print("  config length (days, where an end date is set): n", len(lens), "median", lens[len(lens)//2], "p10", lens[len(lens)//10], "p90", lens[9*len(lens)//10])
