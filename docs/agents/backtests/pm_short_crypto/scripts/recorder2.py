"""Keyless recorder of Binance and Hyperliquid BTC prices over their public WebSockets; nothing is placed, no key is
read. Usage: recorder2.py out.jsonl seconds
  bs: Binance spot BTCUSDT bookTicker (data-stream.binance.vision; stream.binance.com resets this machine's connection)
  bf: Binance USD-M perp BTCUSDT bookTicker (fstream.binance.com; "T" the match time in ms)
  hb: Hyperliquid BTC perp best bid/offer ("time" ms)
  hc: Hyperliquid BTC perp context: mark, oracle, mid, funding, premium (as pushed)
A best-bid/offer record is written only when its mid changes. "t" is this machine's receive time in ms."""
import asyncio, json, sys, time, websockets, orjson
OUT = open(sys.argv[1], "a", buffering=1); END = time.time() + float(sys.argv[2])
def now_ms(): return int(time.time() * 1000)
def w(r): OUT.write(json.dumps(r, separators=(",", ":")) + "\n")
async def loop(name, url, sub, handle):
    while time.time() < END:
        try:
            async with websockets.connect(url, open_timeout=15, max_queue=8192) as ws:
                if sub: await ws.send(json.dumps(sub))
                async def keeper():
                    while time.time() < END:
                        await asyncio.sleep(30)
                        if name.startswith("h"): await ws.send(json.dumps({"method": "ping"}))
                    await ws.close()
                kt = asyncio.create_task(keeper())
                async for raw in ws: handle(now_ms(), orjson.loads(raw))
                kt.cancel()
        except Exception as e:
            w({"k": "err", "t": now_ms(), "src": name, "e": repr(e)[:200]}); await asyncio.sleep(1)
LAST = {}
def bbo(k, t, b, a, ts=None):
    mid = (b + a) / 2
    if LAST.get(k) == mid: return
    LAST[k] = mid; w({"k": k, "t": t, "ts": ts, "b": b, "a": a})
def h_bs(t, m): bbo("bs", t, float(m["b"]), float(m["a"]))
def h_bf(t, m): bbo("bf", t, float(m["b"]), float(m["a"]), m.get("T"))
def h_hb(t, m):
    if m.get("channel") == "bbo":
        d = m["data"]; bb, ba = d["bbo"]
        if bb and ba: bbo("hb", t, float(bb["px"]), float(ba["px"]), d.get("time"))
def h_hc(t, m):
    if m.get("channel") == "activeAssetCtx":
        c = m["data"]["ctx"]
        w({"k": "hc", "t": t, "mark": float(c["markPx"]), "oracle": float(c["oraclePx"]), "mid": float(c.get("midPx") or 0), "funding": float(c["funding"]), "premium": float(c.get("premium") or 0)})
async def main():
    await asyncio.gather(
        loop("bs", "wss://data-stream.binance.vision/ws/btcusdt@bookTicker", None, h_bs),
        loop("bf", "wss://fstream.binance.com/ws/btcusdt@bookTicker", None, h_bf),
        loop("hb", "wss://api.hyperliquid.xyz/ws", {"method": "subscribe", "subscription": {"type": "bbo", "coin": "BTC"}}, h_hb),
        loop("hc", "wss://api.hyperliquid.xyz/ws", {"method": "subscribe", "subscription": {"type": "activeAssetCtx", "coin": "BTC"}}, h_hc))
asyncio.run(main())
