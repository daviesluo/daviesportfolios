"""Pull Yahoo Finance chart data (keyless, query1.finance.yahoo.com/v8/finance/chart) for the equity and FX studies.

Sets (each symbol's raw JSON kept gzipped under inputs/yahoo/<set>/<symbol>.json.gz):
  dual_d   daily, 10 y: US dual-class pairs (DCS)
  adr_5m   5-minute, 60 d: UK ordinaries, their US ADRs and GBPUSD=X (ADRX)
  pairs_d  daily, 11 y: the large-cap universe of the distance-method pairs test (PAIRS)
  fx_1h    hourly, 730 d: four FX pairs, FXW's cross-check on a second source
A re-run reads later data; the committed files are what the results were computed from. pairs_d is kept COMPACT (each
symbol's timestamps, close, adjusted close and volume in Yahoo's own structure; inputs/yahoo/pairs_d_raw_log.json holds
the sha256 and size of each payload as served), to keep 99 eleven-year payloads from adding 8 MB to the repository.
"""
import gzip, hashlib, json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netget import get

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DUAL = ["GOOG", "GOOGL", "FOX", "FOXA", "NWS", "NWSA", "LBRDA", "LBRDK", "BF-A", "BF-B", "UA", "UAA", "Z", "ZG",
        "LEN", "LEN-B", "HEI", "HEI-A", "MOG-A", "MOG-B", "BRK-B"]
ADR = ["SHEL", "SHEL.L", "BP", "BP.L", "HSBC", "HSBA.L", "GSK", "GSK.L", "UL", "ULVR.L", "RIO", "RIO.L", "BTI", "BATS.L",
       "DEO", "DGE.L", "NGG", "NG.L", "BCS", "BARC.L", "LYG", "LLOY.L", "VOD", "VOD.L", "GBPUSD=X"]
# the pairs universe: large US names in ten sectors, chosen by sector before any price was read (survivorship: today's
# names; the test reads the bias as an upper bound)
PAIRS = {
    "banks": ["JPM", "BAC", "C", "WFC", "USB", "PNC", "TFC", "GS", "MS", "SCHW"],
    "oil": ["XOM", "CVX", "COP", "EOG", "OXY", "DVN", "MPC", "VLO", "PSX", "HES"],
    "utilities": ["NEE", "DUK", "SO", "D", "AEP", "EXC", "XEL", "ED", "PEG", "WEC"],
    "staples": ["PG", "KO", "PEP", "CL", "KMB", "GIS", "K", "MDLZ", "HSY", "CPB"],
    "retail": ["WMT", "TGT", "COST", "HD", "LOW", "DG", "DLTR", "BBY", "TJX", "ROST"],
    "pharma": ["JNJ", "PFE", "MRK", "ABBV", "BMY", "LLY", "AMGN", "GILD", "ZTS", "VTRS"],
    "semis": ["INTC", "AMD", "NVDA", "TXN", "QCOM", "AVGO", "MU", "ADI", "MCHP", "AMAT"],
    "rails_trans": ["UNP", "CSX", "NSC", "FDX", "UPS", "JBHT", "ODFL", "CHRW", "EXPD", "LSTR"],
    "reits": ["PLD", "AMT", "CCI", "EQIX", "PSA", "O", "SPG", "WELL", "AVB", "EQR"],
    "insurers": ["CB", "TRV", "ALL", "PGR", "AIG", "MET", "PRU", "AFL", "HIG", "CINF"],
}
FXH = ["AUDUSD=X", "EURUSD=X", "GBPUSD=X", "JPY=X"]
SETS = {
    "fx_1h": (FXH, "1h", "730d"),
    "dual_d": (DUAL, "1d", "10y"),
    "adr_5m": (ADR, "5m", "60d"),
    # "max" returns quarterly bars, so this set names its dates: 2014-01-02 .. 2026-10-09 00:00 UTC
    "pairs_d": ([s for v in PAIRS.values() for s in v] + ["SPY"], "1d", "period1=1388620800&period2=1791504000"),
}


def compact(sym, body):
    """Keep what PAIRS reads, in the payload's own shape; log the raw payload's hash."""
    logp = os.path.join(HERE, "inputs", "yahoo", "pairs_d_raw_log.json")
    log = json.load(open(logp)) if os.path.exists(logp) else {}
    log[sym] = {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
    json.dump(log, open(logp, "w"), indent=1, sort_keys=True)
    r = json.loads(body)["chart"]["result"][0]
    q = r["indicators"]["quote"][0]
    keep = {"chart": {"result": [{"meta": {"symbol": r["meta"].get("symbol"), "dataGranularity": r["meta"].get("dataGranularity")},
                                  "timestamp": r["timestamp"],
                                  "indicators": {"quote": [{"close": q["close"], "volume": q["volume"]}],
                                                 "adjclose": r["indicators"]["adjclose"]}}]}}
    return json.dumps(keep, separators=(",", ":")).encode()


def main(which, only=None):
    for name in which:
        syms, interval, rng = SETS[name]
        d = os.path.join(HERE, "inputs", "yahoo", name)
        os.makedirs(d, exist_ok=True)
        for s in syms:
            if only and s not in only:
                continue
            span = rng if rng.startswith("period1") else f"range={rng}"
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{s}?{span}&interval={interval}&includePrePost=false&events=div%2Csplit"
            st, body = get(url, ua="Mozilla/5.0 (research; public market data)")
            ok = st == 200 and body and b'"timestamp"' in body
            print(name, s, st, len(body or b""), "ok" if ok else "MISSING", file=sys.stderr)
            if ok:
                if name == "pairs_d":
                    body = compact(s, body)
                open(os.path.join(d, s + ".json.gz"), "wb").write(gzip.compress(body, mtime=0))
            time.sleep(0.4)


if __name__ == "__main__":
    # python3 pull_yahoo.py [set ...] [--only SYM,SYM]: --only re-pulls the named symbols of the sets (a retry)
    args = sys.argv[1:]
    only = None
    if "--only" in args:
        i = args.index("--only")
        only = set(args[i + 1].split(","))
        args = args[:i] + args[i + 2:]
    main(args or list(SETS), only)
