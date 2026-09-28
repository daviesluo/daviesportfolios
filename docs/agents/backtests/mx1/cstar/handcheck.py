# Three decisions recomputed by hand, independently of the Deno code: the rule's state at the decision bar AND at the
# bar before it, from the raw Coinbase / Kraken hourly candles (plain Python arithmetic, nothing imported from the
# repository), and the fill / chase from the raw Binance 1-minute rows. Every number used is printed.
#   python3 handcheck.py "trend-4h|BTC/USD|2026-07-23T16:00Z|exit" ...
import gzip, json, math, sys, datetime as dt

HOUR, D1 = 3600000, 86400000
HALF_SPREAD = {"BTC/USD": 0.75e-4, "ETH/USD": 1.05e-4, "SOL/USD": 1.55e-4}   # backtest.ts COSTS.revx, for the entry price
ms = lambda s: int(dt.datetime.strptime(s, "%Y-%m-%dT%H:%MZ").replace(tzinfo=dt.timezone.utc).timestamp() * 1000)
iso = lambda t: dt.datetime.fromtimestamp(t / 1000, dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
PAIR = {"BTC/USD": "BTCUSDT", "ETH/USD": "ETHUSDT", "SOL/USD": "SOLUSDT"}


def hourly(symbol):
    base = symbol.replace("/", "-")
    cb = json.load(open(f"data/cb/{base}_1h_3y.json"))
    kr = json.load(open(f"data/ext/{base}_1h_kraken.json"))
    return [[t * 1000, o, h, l, c] for t, o, h, l, c, v in [r for r in kr if r[0] < cb[0][0]] + cb]


def bucket(rows, span):
    out = []
    for t, o, h, l, c in rows:
        b = t - t % span
        if not out or out[-1][0] != b: out.append([b, o, h, l, c])
        else: out[-1][2] = max(out[-1][2], h); out[-1][3] = min(out[-1][3], l); out[-1][4] = c
    return out


def tests(bars, daily, i, span, hw=None):
    closes = [b[4] for b in bars]
    fast, slow = sum(closes[i - 19:i + 1]) / 20, sum(closes[i - 99:i + 1]) / 100
    gap = (fast - slow) / slow
    hi55 = max(b[2] for b in bars[i - 55:i]); lo20 = min(b[3] for b in bars[i - 20:i])
    t_close = bars[i][0] + span
    closed = [d for d in daily if d[0] + D1 <= t_close]
    ret30 = closed[-1][4] / closed[-31][4] - 1
    rets = [math.log(closes[k] / closes[k - 1]) for k in range(i - 41, i + 1)]
    m = sum(rets) / 42
    vol = math.sqrt(max(0.0, sum(r * r for r in rets) / 42 - m * m)) * math.sqrt(24 * 365 * HOUR / span)
    atr = sum(max(bars[k][2] - bars[k][3], abs(bars[k][2] - bars[k - 1][4]), abs(bars[k][3] - bars[k - 1][4])) for k in range(i - 13, i + 1)) / 14
    above, below = closes[i] > hi55, (not closes[i] > hi55) and closes[i] < lo20
    print(f"    bar {iso(bars[i][0])} close {closes[i]} (at {iso(t_close)}): SMA20 {fast:.4f} SMA100 {slow:.4f} gap {100 * gap:+.3f} %; "
          f"prior-55 high {hi55}; prior-20 low {lo20}; 30-day return {100 * ret30:+.2f} % ({iso(closed[-31][0])} close {closed[-31][4]} -> "
          f"{iso(closed[-1][0])} close {closed[-1][4]}); realised vol {vol:.3f}; ATR14 {atr:.4f}")
    print(f"      ENTRY conditions: trend up (gap > 0.2 %) {gap > 0.002} | close > prior-55 high {above} | 30-day return > 0 {ret30 > 0} | vol < 1.0 {vol < 1.0}"
          f"  => {'ENTER' if gap > 0.002 and above and ret30 > 0 and vol < 1.0 else 'no entry'}")
    ex = [gap < -0.002, below]
    msg = f"      EXIT conditions (if long): trend down (gap < -0.2 %) {ex[0]} | close below prior-20 low {ex[1]}"
    if hw is not None:
        ex.append(closes[i] < hw - 3 * atr)
        msg += f" | close < high-water {hw} - 3 x ATR = {hw - 3 * atr:.4f}: {ex[2]}"
    print(msg + f"  => {'EXIT' if any(ex) else 'hold'}")


def chase(symbol, t0, side, T, h=1e-4):
    rows = {}
    for f in [f"{PAIR[symbol]}_1m_2022-08-20_2023-08-21.json.gz", f"{PAIR[symbol]}_1m_2023-08-21_2026-07-01.json.gz", f"{PAIR[symbol]}_1m.json.gz"]:
        for r in json.load(gzip.open(f, "rt")):
            if t0 <= r[0] <= t0 + 60000 * T: rows[r[0]] = r
    mins = [rows[t0 + 60000 * k] for k in range(T + 1)]
    m0 = mins[0][1]
    if side == "buy":
        P, K = m0 * (1 - h), m0 * (1 + h)
        hit = [(iso(r[0]), r[3]) for r in mins[:T] if r[3] < P]; ext = min(r[3] for r in mins[:T]); word = "lowest low"
    else:
        P, K = m0 * (1 + h), m0 * (1 - h)
        hit = [(iso(r[0]), r[2]) for r in mins[:T] if r[2] > P]; ext = max(r[2] for r in mins[:T]); word = "highest high"
    oT = mins[T][1]
    print(f"    T={T}: m0 = {m0} (open of the {iso(mins[0][0])} minute); P = {P:.6f}; K = {K:.6f}; {word} over the {T} minutes from t0 = {ext}; "
          f"first minute through P: {hit[0] if hit else 'none'}; open at t0+{T} = {oT}")
    if hit:
        gap = (K - P) / P if side == "buy" else (P - K) / P
        print(f"      FILLED: saving = gap {gap * 1e4:.4f} + 9 = {gap * 1e4 + 9:.4f} bps")
    else:
        c = (oT * (1 + h) - K) / K * 1e4 if side == "buy" else (K - oT * (1 - h)) / K * 1e4
        print(f"      MISSED: chase = {c:.4f} bps  (check: {'open_T/m0 - 1' if side == 'buy' else '1 - open_T/m0'} = {((oT / m0 - 1) if side == 'buy' else (1 - oT / m0)) * 1e4:.4f} bps)")


dec = json.load(open("decisions.json"))["decisions"]
res = {(e["rule"], e["symbol"], e["decisionIso"], e["reason"]): e for e in json.load(open("results.json"))["events"]}
for arg in sys.argv[1:]:
    rule, symbol, when, reason = arg.split("|")
    t0 = ms(when)
    span = 4 * HOUR if rule == "trend-4h" else HOUR
    hrs = hourly(symbol)
    bars = bucket(hrs, span) if span == 4 * HOUR else hrs
    daily = bucket(hrs, D1)
    i = next(k for k, b in enumerate(bars) if b[0] + span == t0)
    mine = [d for d in dec if d["rule"] == rule and d["symbol"] == symbol]
    k = next(n for n, d in enumerate(mine) if d["decisionTs"] == t0 and d["reason"] == reason)
    print(f"\n{rule} {symbol} {reason} at the close {when} (window {mine[k]['window']}); the backtester's previous fill on this row and coin: "
          f"{(mine[k - 1]['reason'] + ' at ' + mine[k - 1]['decisionIso']) if k else 'none'}")
    hw = None
    if reason == "exit":
        ent = mine[k - 1]
        assert ent["reason"] == "entry"
        j = next(n for n, b in enumerate(bars) if b[0] == ent["fillTs"])          # the bar the entry filled at
        paid = bars[j][1] * (1 + HALF_SPREAD[symbol])
        hw_i = max([paid] + [b[2] for b in bars[j:i + 1]])
        hw_prev = max([paid] + [b[2] for b in bars[j:i]])
        print(f"    entry filled at the {iso(bars[j][0])} bar's open {bars[j][1]} x (1 + half-spread) = {paid:.4f}; high-water at the decision bar "
              f"{hw_i}, at the bar before {hw_prev}")
        print("  the bar before:"); tests(bars, daily, i - 1, span, hw_prev)
        print("  the decision bar:"); tests(bars, daily, i, span, hw_i)
    else:
        print("  the bar before:"); tests(bars, daily, i - 1, span)
        print("  the decision bar:"); tests(bars, daily, i, span)
    for T in (15, 60):
        chase(symbol, t0, "buy" if reason == "entry" else "sell", T)
    print(f"    cstar.py recorded: T15 {res[(rule, symbol, when, reason)]['T15']}, T60 {res[(rule, symbol, when, reason)]['T60']}")
