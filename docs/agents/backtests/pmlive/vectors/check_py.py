"""Cross-checks vectors.json against Polymarket's official Python client (py-clob-client-v2, exact versions in
requirements.txt), offline: each order rebuilt from its fields and signed with the same published test key must give
the same EIP-712 digest (the order id) and the same signature, and each rounding case the same two base-unit amounts.

    python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python check_py.py > check_py_out.txt

It prints one line per check and a last line with the count of differences; the Python client's own rounding differs
from the TypeScript client's in its float helpers, so a rounding difference is reported, not hidden."""
import json
import sys

from eth_account.messages import encode_typed_data
from eth_utils import keccak

from py_clob_client_v2.order_builder.builder import OrderBuilder, ROUNDING_CONFIG
from py_clob_client_v2.order_utils.exchange_order_builder_v2 import ExchangeOrderBuilderV2
from py_clob_client_v2.order_utils.model.order_data_v2 import OrderDataV2
from py_clob_client_v2.order_utils.model.side import Side
from py_clob_client_v2.order_utils.model.signature_type_v2 import SignatureTypeV2
from py_clob_client_v2.signer import Signer

TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

v = json.load(open("vectors.json"))
signer = Signer(private_key=TEST_KEY, chain_id=v["chainId"])
diffs = 0
print(f"signer {signer.address()} {'==' if signer.address() == v['signerAddress'] else '!='} vectors' {v['signerAddress']}")
diffs += signer.address() != v["signerAddress"]

for o in v["orders"]:
    od = o["order"]
    b = ExchangeOrderBuilderV2(o["exchange"], v["chainId"], signer, generate_salt=lambda s=od["salt"]: s)
    order = b.build_order(OrderDataV2(
        maker=od["maker"], tokenId=od["tokenId"], makerAmount=od["makerAmount"], takerAmount=od["takerAmount"],
        side=Side.BUY if od["side"] == "BUY" else Side.SELL, signer=od["signer"], signatureType=SignatureTypeV2(od["signatureType"]),
        timestamp=od["timestamp"], metadata=od["metadata"], builder=od["builder"], expiration=od["expiration"],
    ))
    typed = b.build_order_typed_data(order)
    msg = encode_typed_data(full_message=typed)
    digest = "0x" + keccak(b"\x19" + msg.version + msg.header + msg.body).hex()
    sig = b.build_order_signature(typed)
    ok_h, ok_s = digest == o["hash"], sig == o["signature"]
    diffs += (not ok_h) + (not ok_s)
    print(f"{o['name']}: hash {'ok' if ok_h else 'DIFFERS ' + digest}, signature {'ok' if ok_s else 'DIFFERS ' + sig}")

ob = OrderBuilder(signer, SignatureTypeV2.POLY_PROXY, v["maker"])
for r in v["rounding"]:
    side, maker, taker = ob.get_order_amounts(r["side"], r["size"], r["price"], ROUNDING_CONFIG[r["tickSize"]])
    ts_maker, ts_taker = r["makerAmount"], r["takerAmount"]
    ok = str(maker) == ts_maker and str(taker) == ts_taker
    diffs += not ok
    verdict = "ok" if ok else f"DIFFERS python {maker}/{taker} typescript {ts_maker}/{ts_taker}"
    print(f"amounts {r['side']} {r['price']} x {r['size']} @ {r['tickSize']}: {verdict}")

print(f"differences: {diffs}")
sys.exit(0)
