import json, re, urllib.request, urllib.parse
def get(u):
    req = urllib.request.Request(u, headers={"User-Agent": "research-probe", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

markets = {}
for q in ["Bitcoin reach", "Bitcoin dip", "Ethereum reach", "Ethereum dip", "Bitcoin above", "Bitcoin below", "Ethereum above", "Ethereum below"]:
    d = get("https://gamma-api.polymarket.com/public-search?" + urllib.parse.urlencode({"q": q, "limit_per_type": 30, "events_status": "active"}))
    for ev in d.get("events", []):
        for m in ev.get("markets", []):
            if not m.get("closed"):
                markets[m["conditionId"]] = m

MONTHS = {m: i+1 for i, m in enumerate(["January","February","March","April","May","June","July","August","September","October","November","December"])}
def title_date(q):
    m = re.search(r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?", q)
    if not m: return None
    return (MONTHS[m.group(1)], int(m.group(2)), int(m.group(3)) if m.group(3) else int(m.group(2)))
def strike_of(t):
    m = re.search(r"\$\s?([0-9][0-9,]*\.?[0-9]*)\s?([kKmM])?", t)
    if not m: return None
    v = float(m.group(1).replace(",", ""))
    if m.group(2) and m.group(2).lower() == "k": v *= 1000
    if m.group(2) and m.group(2).lower() == "m": v *= 1000000
    return v
def fnum(x):
    try: return float(x)
    except Exception: return None

rows = []
for m in markets.values():
    q = m.get("question") or ""; low = q.lower()
    asset = "BTC" if "bitcoin" in low else "ETH" if "ethereum" in low else None
    if not asset: continue
    kind = ("touch_up" if re.search(r"\b(reach|hit|hits|reaches)\b", low) else
            "touch_dn" if re.search(r"\b(dip|dips|fall|falls|drop|drops)\b", low) else
            "above" if "above" in low else "below" if "below" in low else None)
    td = title_date(q)
    rows.append({"asset": asset, "kind": kind, "strike": strike_of(q), "td": td, "q": q,
                 "bid": fnum(m.get("bestBid")), "ask": fnum(m.get("bestAsk")), "end": str(m.get("endDate"))[:16]})

fee = lambda p: 0.07 * p * (1 - p)
pairs = []
for t in rows:
    if t["kind"] not in ("touch_up", "touch_dn") or not t["strike"] or t["ask"] is None or not t["td"]: continue
    want = "above" if t["kind"] == "touch_up" else "below"
    tlo, thi = (t["td"][0], t["td"][1]), (t["td"][0], t["td"][2])
    for a in rows:
        if a["kind"] != want or a["asset"] != t["asset"] or a["strike"] != t["strike"] or a["bid"] is None or not a["td"]: continue
        ad = (a["td"][0], a["td"][1])
        if not (tlo <= ad <= thi): continue
        no_ask = 1 - a["bid"]
        cost = t["ask"] + fee(t["ask"]) + no_ask + fee(no_ask)
        tm = (t["bid"] + t["ask"]) / 2 if t["bid"] is not None else t["ask"]
        am = (a["bid"] + a["ask"]) / 2 if a["ask"] is not None else a["bid"]
        pairs.append({"asset": t["asset"], "strike": t["strike"], "touch": t["q"][:62], "term": a["q"][:62],
                      "touch_ask": t["ask"], "term_bid": a["bid"], "cost": round(cost, 4),
                      "mid_ratio": round(tm / am, 3) if am else None})
pairs.sort(key=lambda x: x["cost"])
print(f"SAME-WINDOW nested pairs: {len(pairs)}; cost<1: {sum(1 for p in pairs if p['cost']<1)}")
for p in pairs[:18]: print(p)
import statistics
ratios = [p["mid_ratio"] for p in pairs if p["mid_ratio"]]
if ratios: print("mid ratio touch/terminal: min", min(ratios), "median", round(statistics.median(ratios),3), "max", max(ratios), "n", len(ratios))
