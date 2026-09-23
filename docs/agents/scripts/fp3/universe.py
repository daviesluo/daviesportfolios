"""Point-in-time universe of Binance USDT spot pairs (delisted included), from the
daily klines the xsmom pipeline pulled (scratchpad/binance_klines/daily, 734 series).
For each UTC day d: the N eligible pairs with the largest quote volume over the 30
days ENDING THE DAY BEFORE d (no look-ahead), a pair being eligible when its current
contiguous segment (no missing day) is >= 100 days old on d-1 and its base is not a
stablecoin / fiat / pegged / leveraged / tokenised-stock (the lists of backtest_xsmom.ts).
Writes data/universe_top{N}.json: {day_iso: [symbols ranked]} and a symbol-month list."""
import json, os, sys, datetime, glob
S = os.environ.get("FP_ROOT", ".") + "/research_fp3"
DAILY = os.environ.get("FP_ROOT", ".") + "/binance_klines/daily"
N = int(sys.argv[1]) if len(sys.argv) > 1 else 30
D0, D1 = datetime.date(2019, 12, 1), datetime.date(2026, 9, 23)
LEVERAGED = set("""1INCHDOWN 1INCHUP AAVEDOWN AAVEUP ADADOWN ADAUP BCHDOWN BCHUP BEAR BNBBEAR BNBBULL BNBDOWN BNBUP BTCDOWN BTCUP BULL DOTDOWN DOTUP EOSBEAR EOSBULL EOSDOWN EOSUP ETHBEAR ETHBULL ETHDOWN ETHUP FILDOWN FILUP LINKDOWN LINKUP LTCDOWN LTCUP SUSHIDOWN SUSHIUP SXPDOWN SXPUP TRXDOWN TRXUP UNIDOWN UNIUP XLMDOWN XLMUP XRPBEAR XRPBULL XRPDOWN XRPUP XTZDOWN XTZUP YFIDOWN YFIUP""".split())
PEGGED = set("AEUR AUD BFUSD BKRW BUSD DAI EUR EURI FDUSD GBP PAX RLUSD SUSD TUSD USD1 USDC USDE USDP USDS USDSB USDSOLD UST U XUSD PAXG XAUT WBTC WBETH BETH BNSOL".split())
STOCKS = set("""AAOIB AAPLB ALABB AMATB AMDB AMZNB ARMB ASMLB ASTSB AVGOB AXTIB BABAB BMNRB CBRSB COHRB COINB CRCLB CRDOB CRWVB DELLB DJTB DRAMB EWYB FLNCB GLWB GMEB GOOGLB HOODB IBMB INTCB INTWB IRENB KORUB LITEB METAB MRVLB MSFTB MSTRB MUB MUUB MVLLB NBISB NFLXB NOKB NVDAB ORCLB PLTRB PYPLB QCOMB QNTB QQQB RKLBB SKHYB SMCIB SMHB SNDKB SNXXB SOXLB SOXSB SPCXB SPYB TQQQB TSLAB TSMB USARB WDCB""".split())
def excluded(sym):
    b = sym[:-4]
    return b in LEVERAGED or b in PEGGED or b in STOCKS
series = {}
for f in sorted(glob.glob(DAILY + "/*.json")):
    sym = os.path.basename(f)[:-5]
    if not sym.endswith("USDT") or excluded(sym):
        continue
    rows = json.load(open(f))
    m = {}
    for r in rows:
        d = datetime.datetime.utcfromtimestamp(r[0]).date()
        m[d] = r[6]  # quote volume
    series[sym] = m
print("eligible series", len(series), file=sys.stderr)
# segment start per symbol per day: first day of the contiguous run containing d
seg_start = {}
for sym, m in series.items():
    ds = sorted(m)
    st = {}
    cur = None; prev = None
    for d in ds:
        if prev is None or (d - prev).days != 1:
            cur = d
        st[d] = cur; prev = d
    seg_start[sym] = st
out = {}
d = D0
while d < D1:
    y = d - datetime.timedelta(days=1)
    cands = []
    for sym, m in series.items():
        if y not in m: continue
        ss = seg_start[sym][y]
        if (y - ss).days + 1 < 100: continue
        qv = 0.0; ok = True
        for k in range(30):
            dd = y - datetime.timedelta(days=k)
            if dd not in m: ok = False; break
            qv += m[dd]
        if not ok: continue
        cands.append((-qv, sym))
    cands.sort()
    out[d.isoformat()] = [s for _, s in cands[:N]]
    d += datetime.timedelta(days=1)
json.dump(out, open(os.path.join(S, "data", f"universe_top{N}.json"), "w"))
months = {}
for day, syms in out.items():
    for s in syms:
        months.setdefault(s, set()).add(day[:7])
json.dump({s: sorted(v) for s, v in months.items()}, open(os.path.join(S, "data", f"universe_top{N}_symbol_months.json"), "w"), indent=0)
print("days", len(out), "symbols ever in", len(months), "symbol-months", sum(len(v) for v in months.values()), file=sys.stderr)
