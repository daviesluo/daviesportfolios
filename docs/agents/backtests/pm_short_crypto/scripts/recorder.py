"""Keyless recorder of public feeds; nothing is placed, no key is read. Usage: recorder.py out.jsonl seconds clob|ref
  clob: Polymarket's market WebSocket for the current and next BTC 5m and 15m windows: a top-3 record of the Up book
        when its best bid or ask price moves, and at most once a second otherwise (the Down book is its mirror), and
        every last_trade_price event of either token (ms server stamp; the side is the taker's).
  ref:  Polymarket's RTDS (Chainlink BTC/USD and Binance BTCUSDT, a value a second), Coinbase's ticker and Kraken's
        best bid/offer over their public WebSockets.
Every record carries "t", this machine's receive time in ms. The CLOB and the price feeds run as two processes: one
Python process reading all of them fell behind the CLOB's ~2,000 messages a second ("slow consumer")."""
import asyncio, json, sys, time, datetime, urllib.request, websockets, heapq, orjson
OUT = open(sys.argv[1], "a", buffering=1)
END = time.time() + float(sys.argv[2])
def now_ms(): return int(time.time() * 1000)
def w(rec): OUT.write(json.dumps(rec, separators=(",", ":")) + "\n")
def gamma(slug):
    try:
        with urllib.request.urlopen(urllib.request.Request(f"https://gamma-api.polymarket.com/events?slug={slug}", headers={"User-Agent": "Mozilla/5.0 research"}), timeout=10) as r:
            d = json.load(r)
        m = d[0]["markets"][0]
        toks = json.loads(m["clobTokenIds"]); outs = json.loads(m["outcomes"])
        return {"slug": slug, "cond": m["conditionId"], "start": m.get("eventStartTime"), "end": m["endDate"],
                "tok": dict(zip(outs, toks)), "fee": m.get("feeSchedule"), "tick": m.get("orderPriceMinTickSize"),
                "rewardsMinSize": m.get("rewardsMinSize"), "rewardsMaxSpread": m.get("rewardsMaxSpread")}
    except Exception as e:
        return None
MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"]
def hourly_slug(start):
    et = datetime.datetime.utcfromtimestamp(start) - datetime.timedelta(hours=4)  # EDT in October
    h = et.hour % 12 or 12; ap = "am" if et.hour < 12 else "pm"
    return f"bitcoin-up-or-down-{MONTHS[et.month-1]}-{et.day}-{et.year}-{h}{ap}-et"
META = {}
def wanted():
    n = int(time.time()); out = []
    for dur, fmt in ((300, "btc-updown-5m-{}"), (900, "btc-updown-15m-{}")):  # the hourly books cost the consumer its speed
        s = n - n % dur
        for st in (s, s + dur):
            slug = fmt.format(st) if fmt else hourly_slug(st)
            out.append((slug, st, dur))
    return out
async def clob_loop():
    while time.time() < END:
        want = wanted(); assets = {}
        for slug, st, dur in want:
            if slug not in META:
                m = await asyncio.to_thread(gamma, slug)
                if m:
                    m["dur"] = dur; m["st"] = st; META[slug] = m
                    w({"k": "mk", "t": now_ms(), **m})
            m = META.get(slug)
            if m:
                for o, tok in m["tok"].items(): assets[tok] = (slug, o)
        key = tuple(sorted(assets))
        books = {}
        try:
            async with websockets.connect("wss://ws-subscriptions-clob.polymarket.com/ws/market", open_timeout=15, max_size=2**24, max_queue=8192) as ws:
                await ws.send(json.dumps({"assets_ids": list(assets), "type": "market"}))
                async def keeper():
                    # PING every 8 s; close the socket when the wanted set of windows changes (the loop then resubscribes)
                    n = 0
                    while time.time() < END:
                        await asyncio.sleep(1); n += 1
                        if n % 8 == 0: await ws.send("PING")
                        if tuple(sorted(a for s_, _, _ in wanted() if s_ in META for a in META[s_]["tok"].values())) != key:
                            await ws.close(); return
                    await ws.close()
                kt = asyncio.create_task(keeper())
                async for raw in ws:
                    t = now_ms()
                    if raw == "PONG": continue
                    try: msgs = orjson.loads(raw)
                    except Exception: continue
                    if isinstance(msgs, dict): msgs = [msgs]
                    for msg in msgs:
                        et = msg.get("event_type")
                        if et == "book" or ("bids" in msg and "asks" in msg):
                            a = msg["asset_id"]
                            books[a] = ({float(x["price"]): float(x["size"]) for x in msg["bids"]},
                                        {float(x["price"]): float(x["size"]) for x in msg["asks"]})
                            emit(books, a, t, msg.get("timestamp"), assets)
                        elif "price_changes" in msg:
                            touched = set()
                            for pc in msg["price_changes"]:
                                a = pc["asset_id"]
                                if a not in books or assets.get(a, ("", ""))[1] != "Up": continue
                                side = books[a][0] if pc["side"] == "BUY" else books[a][1]
                                p = float(pc["price"]); s = float(pc["size"])
                                if s == 0: side.pop(p, None)
                                else: side[p] = s
                                touched.add(a)
                            for a in touched: emit(books, a, t, msg.get("timestamp"), assets)
                        elif et == "last_trade_price":
                            a = msg.get("asset_id")
                            w({"k": "tr", "t": t, "ts": msg.get("timestamp"), "a": assets.get(a, ("?", "?"))[1],
                               "m": assets.get(a, ("?", "?"))[0], "p": float(msg["price"]), "s": float(msg["size"]), "sd": msg.get("side")})
                kt.cancel()
        except Exception as e:
            w({"k": "err", "t": now_ms(), "src": "clob", "e": repr(e)[:200]}); await asyncio.sleep(1)
LAST = {}
def emit(books, a, t, ts, assets):
    slug, o = assets.get(a, ("?", "?"))
    if o != "Up": return  # the Down book is the mirror of Up (one matching engine); only Up is kept
    b, k = books[a]
    bb = heapq.nlargest(3, b.items()); ba = heapq.nsmallest(3, k.items())
    # a record when the best bid or ask PRICE moves, plus a top-3 snapshot at most once a second per book
    px = (bb[0][0] if bb else None, ba[0][0] if ba else None)
    prev = LAST.get(a)
    if prev and prev[0] == px and t - prev[1] < 1000: return
    LAST[a] = (px, t if (not prev or t - prev[1] >= 1000) else prev[1])
    w({"k": "bk", "t": t, "ts": ts, "m": slug, "a": o, "bb": bb, "ba": ba})
async def rtds_loop():
    while time.time() < END:
        try:
            async with websockets.connect("wss://ws-live-data.polymarket.com", open_timeout=15, max_size=2**24) as ws:
                await ws.send(json.dumps({"action": "subscribe", "subscriptions": [
                    {"topic": "crypto_prices_chainlink", "type": "*", "filters": "{\"symbol\":\"btc/usd\"}"},
                    {"topic": "crypto_prices", "type": "update"}]}))
                last_ping = time.time()
                while time.time() < END:
                    if time.time() - last_ping > 5:
                        await ws.send("PING"); last_ping = time.time()
                    try: raw = await asyncio.wait_for(ws.recv(), 1.0)
                    except asyncio.TimeoutError: continue
                    t = now_ms()
                    try: msg = json.loads(raw)
                    except Exception: continue
                    if not isinstance(msg, dict): continue
                    top = msg.get("topic"); p = msg.get("payload") or {}
                    if msg.get("type") == "update" and "value" in p and p.get("symbol") in ("btc/usd", "btcusdt"):
                        w({"k": "cl" if top == "crypto_prices_chainlink" else "bn", "t": t, "ts": p.get("timestamp"), "p": p["value"], "sym": p.get("symbol")})
        except Exception as e:
            w({"k": "err", "t": now_ms(), "src": "rtds", "e": repr(e)[:200]}); await asyncio.sleep(1)
async def coinbase_loop():
    while time.time() < END:
        try:
            async with websockets.connect("wss://ws-feed.exchange.coinbase.com", open_timeout=15) as ws:
                await ws.send(json.dumps({"type": "subscribe", "product_ids": ["BTC-USD"], "channels": ["ticker"]}))
                while time.time() < END:
                    try: raw = await asyncio.wait_for(ws.recv(), 2.0)
                    except asyncio.TimeoutError: continue
                    m = json.loads(raw)
                    if m.get("type") == "ticker":
                        w({"k": "cb", "t": now_ms(), "ts": m.get("time"), "p": float(m["price"]), "b": float(m["best_bid"]), "a": float(m["best_ask"])})
        except Exception as e:
            w({"k": "err", "t": now_ms(), "src": "cb", "e": repr(e)[:200]}); await asyncio.sleep(1)
async def kraken_loop():
    while time.time() < END:
        try:
            async with websockets.connect("wss://ws.kraken.com/v2", open_timeout=15) as ws:
                await ws.send(json.dumps({"method": "subscribe", "params": {"channel": "ticker", "symbol": ["BTC/USD"], "event_trigger": "bbo"}}))
                while time.time() < END:
                    try: raw = await asyncio.wait_for(ws.recv(), 2.0)
                    except asyncio.TimeoutError: continue
                    m = json.loads(raw)
                    if m.get("channel") == "ticker":
                        for d in m.get("data", []):
                            w({"k": "kr", "t": now_ms(), "p": d.get("last"), "b": d.get("bid"), "a": d.get("ask")})
        except Exception as e:
            w({"k": "err", "t": now_ms(), "src": "kr", "e": repr(e)[:200]}); await asyncio.sleep(1)
async def main():
    # two processes: argv[3] "clob" records the Polymarket books alone, "ref" the price feeds
    if sys.argv[3] == "clob": await clob_loop()
    else: await asyncio.gather(rtds_loop(), coinbase_loop(), kraken_loop())
asyncio.run(main())
