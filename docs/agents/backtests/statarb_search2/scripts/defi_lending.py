"""LEND: stablecoin lending and borrowing rates across DeFi (DefiLlama, keyless) against the US 3-month bill (FRED).

One snapshot. For USDC and USDT pools with at least $10 m supplied: the best BASE supply rate (rewards excluded: they are
paid in a token and priced by its market), the cheapest base borrow rate, and the borrow-here-lend-there spread on the
same coin. Also Ethena's sUSDe (the perpetual basis paid as a yield) and Sky's sUSDS, as reference carries. Writes
results/defi_lending_<date>.json; the raw pulls go to inputs/defi/.
"""
import csv, gzip, io, json, os, sys
import datetime as dt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netget import get

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INP = os.path.join(HERE, "inputs", "defi")
os.makedirs(INP, exist_ok=True)


def main():
    day = dt.datetime.utcnow().strftime("%Y-%m-%d")
    _, lb = get("https://yields.llama.fi/lendBorrow")
    _, pl = get("https://yields.llama.fi/pools")
    _, tb = get("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTB3")
    for n, b in (("lendborrow", lb), ("pools", pl), ("fred_dtb3", tb)):
        open(os.path.join(INP, f"{n}_{day}.gz"), "wb").write(gzip.compress(b, mtime=0))
    lend = {r["pool"]: r for r in json.loads(lb)}
    pools = {r["pool"]: r for r in json.loads(pl)["data"]}
    bill = [r for r in csv.DictReader(io.StringIO(tb.decode())) if r.get("DTB3") not in (None, "", ".")][-1]
    out = {"read": day, "us_3m_bill": {"date": bill["observation_date"] if "observation_date" in bill else bill.get("DATE"), "rate_pct": float(bill["DTB3"])}, "coins": {}}
    for coin in ("USDC", "USDT"):
        rows = []
        for pid, l in lend.items():
            p = pools.get(pid)
            if not p or p.get("symbol", "").upper() != coin:
                continue
            sup = l.get("totalSupplyUsd") or p.get("tvlUsd") or 0
            if sup < 10e6:
                continue
            rows.append({"project": p["project"], "chain": p["chain"], "supply_usd_m": round(sup / 1e6, 1),
                         "supply_base_pct": round(p.get("apyBase") or 0, 3),
                         "borrow_base_pct": (round(l["apyBaseBorrow"], 3) if l.get("apyBaseBorrow") is not None else None),
                         "utilisation": (round(l["totalBorrowUsd"] / sup, 3) if l.get("totalBorrowUsd") and sup else None)})
        sup = sorted(rows, key=lambda r: -r["supply_base_pct"])
        bor = sorted([r for r in rows if r["borrow_base_pct"]], key=lambda r: r["borrow_base_pct"])
        out["coins"][coin] = {"pools": len(rows), "best_supply": sup[:5], "cheapest_borrow": bor[:5],
                              "spread_best_supply_minus_cheapest_borrow_pct": round(sup[0]["supply_base_pct"] - bor[0]["borrow_base_pct"], 3) if sup and bor else None,
                              "median_supply_base_pct": sorted(r["supply_base_pct"] for r in rows)[len(rows) // 2] if rows else None}
    ref = []
    for p in pools.values():
        if p.get("symbol", "").upper() in ("SUSDE", "SUSDS", "SDAI") and (p.get("tvlUsd") or 0) > 50e6:
            ref.append({"project": p["project"], "chain": p["chain"], "symbol": p["symbol"], "tvl_usd_m": round(p["tvlUsd"] / 1e6),
                        "apy_base_pct": round(p.get("apyBase") or 0, 2), "apy_30d_mean_pct": p.get("apyMean30d")})
    out["reference_carries"] = sorted(ref, key=lambda r: -r["tvl_usd_m"])[:8]
    json.dump(out, open(os.path.join(HERE, "results", f"defi_lending_{day}.json"), "w"), indent=1, sort_keys=True)
    print(json.dumps(out, indent=1)[:4000])


if __name__ == "__main__":
    main()
