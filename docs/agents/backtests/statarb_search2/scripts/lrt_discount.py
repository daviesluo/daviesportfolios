"""LRT: liquid staking and restaking tokens against their own redemption rate (snapshot, keyless).

For each token: the contract's own rate (ETH per token) read by eth_call on a public RPC, and what ParaSwap pays in ETH
for selling 10 and 100 tokens. Discount = 1 - paid / (amount x rate), in bps. The rate is the anchor only when the
issuer redeems at it; each token's queue is named in the write-up, not here. Writes results/lrt_discount_<UTC>.json.
"""
import json, os, sys
import datetime as dt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netget import get

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RPC = "https://ethereum-rpc.publicnode.com"
ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
# token, address, rate selector (returns ETH per token, 1e18)
TOKENS = [
    ("wstETH", "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0", "0x035faf82"),  # stEthPerToken()
    ("rETH", "0xae78736Cd615f374D3085123A210448E74Fc6393", "0xe6aa216c"),    # getExchangeRate()
    ("cbETH", "0xBe9895146f7AF43049ca1c1AE358B0541Ea49704", "0x3ba0b9a9"),   # exchangeRate()
    ("weETH", "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee", "0x679aefce"),   # getRate()
]


def call(to, data):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [{"to": to, "data": data}, "latest"]}).encode()
    st, b = get(RPC, data=body, headers={"content-type": "application/json"})
    return int(json.loads(b)["result"], 16) / 1e18 if st == 200 else None


def main():
    stamp = dt.datetime.utcnow().strftime("%Y-%m-%dT%H%MZ")
    out = {"read_at": stamp, "tokens": {}}
    for name, addr, sel in TOKENS:
        rate = call(addr, sel)
        r = {"rate_eth_per_token": rate}
        for amt in (10, 100):
            url = (f"https://api.paraswap.io/prices?srcToken={addr}&destToken={ETH}&amount={amt}{'0'*18}&srcDecimals=18"
                   f"&destDecimals=18&side=SELL&network=1&version=6.2")
            st, b = get(url)
            try:
                pr = json.loads(b)["priceRoute"]
                paid = int(pr["destAmount"]) / 1e18
                r[f"sell_{amt}"] = {"paid_eth": paid, "discount_bps": round(1e4 * (1 - paid / (amt * rate)), 2) if rate else None,
                                    "gas_usd": pr.get("gasCostUSD")}
            except Exception:
                r[f"sell_{amt}"] = {"status": st}
        out["tokens"][name] = r
        print(name, r)
    json.dump(out, open(os.path.join(HERE, "results", f"lrt_discount_{stamp}.json"), "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
