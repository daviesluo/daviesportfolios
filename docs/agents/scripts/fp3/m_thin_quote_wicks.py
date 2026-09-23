"""Descriptive (kill) measurement for idea B13: book-specific wicks on Binance's secondary-quote books of liquid
coins (FDUSD, EUR, USDC, U quotes) relative to the same coin's USDT book, 2026-07-01 -> 2026-08-31, 1-minute klines.
dislocation(m) = low_thin(m) * rate(m) / low_USDT(m) - 1, rate = the quote asset's USDT price at the minute's close
(FDUSDUSDT, EURUSDT, USDCUSDT; U taken as 1.0). Counts minutes with dislocation below -k and the thin book's quote
volume in them. Writes results/m_thin_quote_wicks.json."""
import json, os
S = os.environ.get("FP_ROOT", ".") + "/research_fp3"
D = os.path.join(S, "data", "bn_1m_thin"); E = os.path.join(S, "data", "bn_1m_eur", "EURUSDT.json")
def load(s, path=None):
    rows = json.load(open(path or os.path.join(D, f"{s}.json")))
    return {r[0]: r for r in rows}
rates = {"FDUSD": load("FDUSDUSDT"), "USDC": load("USDCUSDT"), "EUR": load(None, E)}
out = {}
for thin, base, q in [("SOLFDUSD","SOL","FDUSD"),("XRPFDUSD","XRP","FDUSD"),("DOGEFDUSD","DOGE","FDUSD"),("BNBFDUSD","BNB","FDUSD"),
                      ("SOLEUR","SOL","EUR"),("XRPEUR","XRP","EUR"),("ADAEUR","ADA","EUR"),("DOGEEUR","DOGE","EUR"),
                      ("NEARUSDC","NEAR","USDC"),("SOLUSDC","SOL","USDC"),("DOGEU","DOGE","U"),("XRPU","XRP","U"),("ETHU","ETH","U")]:
    a = load(thin); b = load(base + "USDT")
    cnt = {"0.005": 0, "0.01": 0, "0.02": 0}; vol = {"0.005": 0.0, "0.01": 0.0, "0.02": 0.0}; n = 0; worst = 0.0
    for t, r in a.items():
        if t not in b or r[5] == 0: continue
        rate = 1.0 if q == "U" else (rates[q].get(t, [0,0,0,0,0])[4] or None)
        if not rate: continue
        d = r[3] * rate / b[t][3] - 1  # thin price in USDT = thin price x (USDT per quote unit)
        n += 1; worst = min(worst, d)
        for k in (0.005, 0.01, 0.02):
            if d < -k: cnt[str(k)] += 1; vol[str(k)] += r[6] if len(r) > 6 else 0.0
    out[thin] = {"traded_minutes": n, "minutes_below": cnt, "thin_quote_volume_in_them": {k: round(v) for k, v in vol.items()}, "worst": round(worst, 4)}
json.dump(out, open(os.path.join(S, "results", "m_thin_quote_wicks.json"), "w"), indent=1)
for k, v in out.items(): print(k, v)
