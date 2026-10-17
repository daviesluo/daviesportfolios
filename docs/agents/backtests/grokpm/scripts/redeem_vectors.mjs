// GROKPM's redemption vectors (Deviation D6): computed by viem 2.21.54, independently of grokpm/redeem.ts, which
// redeem.test.ts holds to them. The relay hash follows builder-relayer-client's createStructHash (src/builder/proxy.ts,
// commit 9fe0514) and its signer's signMessage({ raw }). Run: npm i viem@2.21.54 && node redeem_vectors.mjs > ../redeem_vectors.json
import { encodeFunctionData, keccak256, concat, toHex, getCreate2Address, encodePacked, hashMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
const PUSD = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";
const ADAPTER = "0xAdA100Db00Ca00073811820692005400218FcE1f", NEG = "0xadA2005600Dec949baf300f4C6120000bDB6eAab";
const FACTORY = "0xaB45c5A4B0c941a2F231C04C3f49182e1A254052", HUB = "0xD216153c06E857cD7f72665E0aF1d7D82172F494";
const C1 = "0x" + "c1".repeat(32), C2 = "0x3f1c0e5b0a7d2c9e8f6b4a3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b";
const redeemAbi = [{ type: "function", name: "redeemPositions", stateMutability: "nonpayable", inputs: [
  { name: "collateralToken", type: "address" }, { name: "parentCollectionId", type: "bytes32" }, { name: "conditionId", type: "bytes32" }, { name: "indexSets", type: "uint256[]" }], outputs: [] }];
const proxyAbi = [{ type: "function", name: "proxy", stateMutability: "payable", inputs: [{ name: "calls", type: "tuple[]", components: [
  { name: "typeCode", type: "uint8" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }] }], outputs: [{ name: "returnValues", type: "bytes[]" }] }];
const balAbi = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }, { name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] }];
const r1 = encodeFunctionData({ abi: redeemAbi, functionName: "redeemPositions", args: [PUSD, "0x" + "00".repeat(32), C1, [1n, 2n]] });
const r2 = encodeFunctionData({ abi: redeemAbi, functionName: "redeemPositions", args: [PUSD, "0x" + "00".repeat(32), C2, [1n, 2n]] });
const p = encodeFunctionData({ abi: proxyAbi, functionName: "proxy", args: [[{ typeCode: 1, to: ADAPTER, value: 0n, data: r1 }, { typeCode: 1, to: NEG, value: 0n, data: r2 }]] });
const p1 = encodeFunctionData({ abi: proxyAbi, functionName: "proxy", args: [[{ typeCode: 1, to: ADAPTER, value: 0n, data: r1 }]] });
const acct = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const relay = "0x" + "77".repeat(20);
// as builder-relayer-client's createStructHash (src/builder/proxy.ts)
const h = keccak256(concat([toHex("rlx:"), acct.address, FACTORY, p, toHex(0n, { size: 32 }), toHex(0n, { size: 32 }), toHex(412345n, { size: 32 }), toHex(17n, { size: 32 }), HUB, relay]));
const sig = await acct.signMessage({ message: { raw: h } });
const proxyW = getCreate2Address({ bytecodeHash: "0xd21df8dc65880a8606f09fe0ce3df9b8869287ab0b058be05aa9e8af6330a00b", from: FACTORY, salt: keccak256(encodePacked(["address"], [acct.address])) });
const tok = 71321045679252212594626385532706912750332728571942532289631379312455583992563n;
const bal = encodeFunctionData({ abi: balAbi, functionName: "balanceOf", args: ["0x1111111111111111111111111111111111111111", tok] });
console.log(JSON.stringify({ C1, C2, signer: acct.address, relay, redeemC1: r1, redeemC2: r2, proxyTwo: p, proxyOne: p1, gasLimit: "412345", nonce: "17",
  structHash: h, personalDigest: hashMessage({ raw: h }), signature: sig, proxyWallet: proxyW, balanceOfCall: bal, token: tok.toString() }, null, 1));
