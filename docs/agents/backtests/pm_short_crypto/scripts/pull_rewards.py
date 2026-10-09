"""Whether any BTC 5m/15m Up-or-Down market carries a liquidity-reward pool: every market in clob
/rewards/markets/current (keyless) against the condition ids of the windows the live recorder saw and the next 29 of
each series (Gamma). Usage: pull_rewards.py clob.jsonl out.json"""
import json, sys, time, urllib.request
def get(url):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 research"}), timeout=30))
rows, cur = [], ""
while True:
    d = get("https://clob.polymarket.com/rewards/markets/current" + (f"?next_cursor={cur}" if cur else ""))
    rows += d.get("data") or []; cur = d.get("next_cursor")
    if not cur or cur == "LTE=": break
ids = {r["condition_id"] for r in rows}
conds = set()
for line in open(sys.argv[1]):
    r = json.loads(line)
    if r["k"] == "mk": conds.add((r["slug"], r["cond"]))
n = int(time.time())
for i in range(1, 30):
    for dur, f in ((300, "btc-updown-5m-{}"), (900, "btc-updown-15m-{}")):
        s = n - n % dur + i * dur
        try:
            e = get(f"https://gamma-api.polymarket.com/events?slug={f.format(s)}")
            if e: conds.add((f.format(s), e[0]["markets"][0]["conditionId"]))
        except Exception:
            pass
hit = [(s, c) for s, c in conds if c in ids]
json.dump({"rewarded_markets_now": len(rows), "btc_updown_checked": len(conds), "btc_updown_with_pool": hit, "read_at_unix": n}, open(sys.argv[2], "w"), indent=1, sort_keys=True)
print(len(rows), len(conds), len(hit))
