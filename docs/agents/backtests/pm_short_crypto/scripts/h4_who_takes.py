"""H4: who takes the prints the model calls cheap. One 5m market in six of the test days (every sixth window by start),
its taker prints read again WITH the wallet (data-api /v2/trades?condition=); each print scored as in h2/h3 at a 3 s
lag; the wallets ranked by the shares they took at edge >= 5 c. Addresses are hashed (sha256, 10 hex) before writing.
Usage: h4_who_takes.py markets.json binance_1s.json.gz out.json"""
import json, sys, os, urllib.request, urllib.parse, hashlib, concurrent.futures as cf, collections
sys.path.insert(0, os.path.dirname(__file__)); import model
M = json.load(open(sys.argv[1])); B = model.load_binance(sys.argv[2])
sel = [m for m in M if "-5m-" in m["slug"] and 1791399600 <= int(m["slug"].rsplit("-", 1)[1]) < 1791572400 and (int(m["slug"].rsplit("-", 1)[1]) // 300) % 6 == 0]
def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 research"})
    for _ in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30) as r: return json.load(r)
        except Exception as e: err = e
    raise err
def pull(m):
    rows, cur = [], None
    while True:
        q = {"condition": m["cond"], "limit": 1000}
        if cur: q["cursor"] = cur
        d = get("https://data-api.polymarket.com/v2/trades?" + urllib.parse.urlencode(q)); data = d.get("data") or []
        rows += data; cur = (d.get("pagination") or {}).get("next_cursor")
        if not cur or not data: return m, rows
with cf.ThreadPoolExecutor(8) as ex: got = list(ex.map(pull, sel))
W = collections.defaultdict(lambda: [0.0, 0.0, 0.0, 0.0, 0])  # cheap shares, cheap pnl, all shares, all pnl, prints
tot_cheap = 0.0
for m, rows in got:
    s = int(m["slug"].rsplit("-", 1)[1]); e = s + 300
    for r in rows:
        ts = r["timestamp"]; p = float(r["price"]); sz = float(r["size"])
        if not (s < ts - 3 and ts < e) or not (0 < p < 1): continue
        x = r["outcome_index"] if r["side"] == "BUY" else 1 - r["outcome_index"]; P_ = p if r["side"] == "BUY" else 1 - p
        y = m["up_won"] if x == 0 else not m["up_won"]; f = model.fee(P_); pnl = (1 if y else 0) - P_ - f
        q = model.fair_up(B, s, e, ts - 3, 1.75); q = q if x == 0 else 1 - q
        h = hashlib.sha256(r["proxy_wallet"].encode()).hexdigest()[:10]
        a = W[h]; a[2] += sz; a[3] += sz * pnl; a[4] += 1
        if q - P_ - f >= 0.05: a[0] += sz; a[1] += sz * pnl; tot_cheap += sz
rank = sorted(W.items(), key=lambda kv: -kv[1][0])
cum = 0; top = []
for i, (h, a) in enumerate(rank[:20]):
    cum += a[0]
    top.append({"wallet_sha10": h, "cheap_shares": round(a[0]), "cheap_share_of_all_cheap": round(a[0] / tot_cheap, 4), "cumulative": round(cum / tot_cheap, 4),
                "cheap_pnl_usd": round(a[1]), "all_shares": round(a[2]), "all_pnl_usd": round(a[3]), "prints": a[4]})
out = {"markets": len(got), "taker_wallets": len(W), "wallets_with_any_cheap_print": sum(1 for a in W.values() if a[0] > 0),
       "cheap_shares_total": round(tot_cheap), "top20_by_cheap_shares": top}
json.dump(out, open(sys.argv[3], "w"), indent=1, sort_keys=True)
print(json.dumps({k: v for k, v in out.items() if k != "top20_by_cheap_shares"})); [print(t) for t in top[:12]]
