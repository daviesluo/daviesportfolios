// Regenerates vectors.json: Polymarket CLOB V2 orders built, hashed and signed by Polymarket's own TypeScript client,
// offline, with the published Hardhat test key #0. supabase/functions/agents/polymarket_orders.test.ts pins
// `_shared/polymarket_orders.ts` against every value here, byte for byte.
//
//   cd docs/agents/backtests/pmlive/vectors
//   npm ci --ignore-scripts          # the exact versions in package-lock.json; no install script runs
//   node gen_vectors.mjs > vectors.json
//
// Nothing here touches a network after the install: no request, no key but the published test key, no account.
// The client's two sources of variation are fixed for each case: `Date.now` (the order's millisecond timestamp, and a
// factor of its salt) and `Math.random` (the other factor: the client's salt is round(random × now)).
import { readFileSync } from "node:fs";
import { Wallet } from "@ethersproject/wallet";
import {
  createL2Headers, getContractConfig, OrderBuilder, orderToJsonV2, Side, SignatureTypeV2,
} from "@polymarket/clob-client-v2";
// Not exported from the package's entry point; the published dist files themselves, by path.
import { ExchangeOrderBuilderV2 } from "./node_modules/@polymarket/clob-client-v2/dist/order-utils/exchangeOrderBuilderV2.js";
import { getOrderRawAmounts } from "./node_modules/@polymarket/clob-client-v2/dist/order-builder/helpers/getOrderRawAmounts.js";
import { ROUNDING_CONFIG } from "./node_modules/@polymarket/clob-client-v2/dist/order-builder/helpers/roundingConfig.js";
import { domainSeparator, hashStruct, parseUnits, recoverAddress, recoverTypedDataAddress } from "viem";

/** The key the official clients' own tests call publicly known (Hardhat's account #0). Never an account's key. */
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
/** A stand-in proxy wallet (the funder, the order's maker), the address py-clob-client-v2's own tests use for a wallet. */
const PROXY = "0x1111111111111111111111111111111111111111";
/** Made-up L2 credentials: an API key id in the CLOB's UUID shape, a 32-byte secret, a passphrase. Not an account's. */
const CREDS = {
  key: "00000000-1111-4222-8333-444444444444",
  secret: Buffer.from("VECTOR-SECRET-32-BYTES-LONG-0001").toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
  passphrase: "vector-passphrase",
};
/** Token ids of uint256 size: the docs' example token (trading/manage-orders) and a second made-up one. */
const TOKEN_A = "107505882767731489358349912513945399560393482969656700824895970500493757150417";
const TOKEN_B = "71321045679252212594626385532706912750332728571942532289631379312455583992563";

const wallet = new Wallet(TEST_KEY);
const contracts = getContractConfig(137);
const realNow = Date.now, realRandom = Math.random;

/** Orders: BUY and SELL, both exchanges, all six tick sizes, GTD expirations, fractional sizes that round. */
const CASES = [
  { name: "buy-standard-0.01", tokenID: TOKEN_A, side: Side.BUY, price: 0.52, size: 10, tickSize: "0.01", negRisk: false, nowMs: 1790000000000, random: 0.25 },
  { name: "sell-standard-0.01", tokenID: TOKEN_A, side: Side.SELL, price: 0.48, size: 20, tickSize: "0.01", negRisk: false, nowMs: 1790000060000, random: 0.5 },
  { name: "buy-negrisk-0.001", tokenID: TOKEN_B, side: Side.BUY, price: 0.123, size: 15.555, tickSize: "0.001", negRisk: true, nowMs: 1790000120000, random: 0.75 },
  { name: "sell-negrisk-0.001", tokenID: TOKEN_B, side: Side.SELL, price: 0.987, size: 7.777, tickSize: "0.001", negRisk: true, nowMs: 1790000180000, random: 0.125 },
  { name: "buy-standard-0.1", tokenID: TOKEN_A, side: Side.BUY, price: 0.3, size: 33.33, tickSize: "0.1", negRisk: false, nowMs: 1790000240000, random: 0.375 },
  { name: "sell-negrisk-0.0001", tokenID: TOKEN_B, side: Side.SELL, price: 0.0123, size: 100.5, tickSize: "0.0001", negRisk: true, nowMs: 1790000300000, random: 0.625 },
  { name: "buy-standard-0.005", tokenID: TOKEN_A, side: Side.BUY, price: 0.055, size: 9.99, tickSize: "0.005", negRisk: false, nowMs: 1790000360000, random: 0.875 },
  { name: "buy-negrisk-0.0025", tokenID: TOKEN_B, side: Side.BUY, price: 0.9975, size: 5, tickSize: "0.0025", negRisk: true, nowMs: 1790000420000, random: 0.0625 },
];

const orders = [];
for (const c of CASES) {
  // GTD: the docs' rule, `now + 60 + lifetime` (an order expires a minute before its stated expiration), lifetime 300 s.
  const expiration = Math.floor(c.nowMs / 1000) + 60 + 300;
  Date.now = () => c.nowMs;
  Math.random = () => c.random;
  let signed;
  try {
    signed = await new OrderBuilder(wallet, 137, SignatureTypeV2.POLY_PROXY, PROXY).buildOrder(
      { tokenID: c.tokenID, price: c.price, size: c.size, side: c.side, expiration },
      { tickSize: c.tickSize, negRisk: c.negRisk },
      2,
    );
  } finally {
    Date.now = realNow;
    Math.random = realRandom;
  }
  const exchange = c.negRisk ? contracts.negRiskExchangeV2 : contracts.exchangeV2;
  const builder = new ExchangeOrderBuilderV2(exchange, 137, wallet);
  const typed = builder.buildOrderTypedData(signed);
  const hash = builder.buildOrderHash(typed);
  const domain = domainSeparator({ domain: typed.domain });
  const structHash = hashStruct({ data: typed.message, primaryType: "Order", types: typed.types });
  const recovered = await recoverTypedDataAddress({ ...typed, signature: signed.signature });
  const recoveredFromHash = await recoverAddress({ hash, signature: signed.signature });
  const body = JSON.stringify(orderToJsonV2(signed, CREDS.key, "GTD", true, false));
  const l2 = await createL2Headers(wallet, CREDS, { method: "POST", requestPath: "/order", body }, Math.floor(c.nowMs / 1000));
  orders.push({
    name: c.name,
    input: { tokenId: c.tokenID, side: c.side, price: c.price, size: c.size, tickSize: c.tickSize, negRisk: c.negRisk, nowMs: c.nowMs, random: c.random, expiration },
    exchange,
    order: {
      salt: signed.salt, maker: signed.maker, signer: signed.signer, tokenId: signed.tokenId, makerAmount: signed.makerAmount,
      takerAmount: signed.takerAmount, side: signed.side, signatureType: signed.signatureType, timestamp: signed.timestamp,
      metadata: signed.metadata, builder: signed.builder, expiration: signed.expiration,
    },
    domainSeparator: domain,
    structHash,
    hash,
    signature: signed.signature,
    recovered,
    recoveredFromHash,
    body,
    l2: { timestamp: Math.floor(c.nowMs / 1000), POLY_ADDRESS: l2.POLY_ADDRESS, POLY_SIGNATURE: l2.POLY_SIGNATURE },
  });
}

// The two cancels the order path can send, as the client signs them (`JSON.stringify` of its payload; the kill switch
// has no body), with their L2 signatures.
const ts = 1790000500;
const cancels = [];
for (const [method, path, payload] of [
  ["DELETE", "/order", { orderID: orders[0].hash }],
  ["DELETE", "/cancel-all", undefined],
]) {
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  const h = await createL2Headers(wallet, CREDS, { method, requestPath: path, body }, ts);
  cancels.push({ method, path, body: body ?? null, timestamp: ts, POLY_SIGNATURE: h.POLY_SIGNATURE });
}

// The rounding alone, through the client's own functions: each user order to its two base-unit amounts. Several are
// chosen where a binary float lands off the decimal (0.1 × 3, 0.07 × 3, 0.57 × 19.99) or a size or price carries more
// decimals than the tick's table allows.
const ROUNDING = [
  ["BUY", 0.52, 10, "0.01"], ["SELL", 0.52, 10, "0.01"], ["BUY", 0.1, 3, "0.1"], ["SELL", 0.1, 3, "0.1"],
  ["BUY", 0.07, 3, "0.01"], ["SELL", 0.07, 3, "0.01"], ["BUY", 0.57, 19.99, "0.01"], ["SELL", 0.57, 19.99, "0.01"],
  ["BUY", 0.123, 15.555, "0.001"], ["SELL", 0.987, 7.777, "0.001"], ["BUY", 0.0123, 333.333, "0.0001"],
  ["SELL", 0.9999, 12.345, "0.0001"], ["BUY", 0.333, 3.33, "0.001"], ["BUY", 0.055, 9.99, "0.005"], ["SELL", 0.995, 0.29, "0.005"],
  ["BUY", 0.9975, 5, "0.0025"], ["SELL", 0.0025, 1234.56, "0.0025"], ["BUY", 0.523, 10, "0.01"], ["BUY", 0.29, 7.13, "0.01"],
  ["SELL", 0.29, 7.13, "0.01"], ["BUY", 0.01, 100, "0.01"], ["SELL", 0.99, 5.5, "0.01"], ["BUY", 0.47, 21.42, "0.01"],
  ["BUY", 0.6, 0.01, "0.1"],
];
const rounding = ROUNDING.map(([side, price, size, tick]) => {
  const r = getOrderRawAmounts(side === "BUY" ? Side.BUY : Side.SELL, size, price, ROUNDING_CONFIG[tick]);
  return {
    side, price, size, tickSize: tick,
    rawMakerAmt: r.rawMakerAmt, rawTakerAmt: r.rawTakerAmt,
    makerAmount: parseUnits(r.rawMakerAmt.toString(), 6).toString(), takerAmount: parseUnits(r.rawTakerAmt.toString(), 6).toString(),
  };
});

const lock = JSON.parse(readFileSync(new URL("./package-lock.json", import.meta.url), "utf8"));
const v = (name) => lock.packages[`node_modules/${name}`]?.version ?? null;
process.stdout.write(`${JSON.stringify({
  about: "Polymarket CLOB V2 orders by the official TypeScript client, offline, with Hardhat's published test key #0. Regenerate: npm ci --ignore-scripts && node gen_vectors.mjs > vectors.json",
  client: { "@polymarket/clob-client-v2": v("@polymarket/clob-client-v2"), viem: v("viem"), "@ethersproject/wallet": v("@ethersproject/wallet") },
  chainId: 137,
  signerAddress: await wallet.getAddress(),
  maker: PROXY,
  owner: CREDS.key,
  l2Secret: CREDS.secret,
  l2Passphrase: CREDS.passphrase,
  orders,
  cancels,
  rounding,
}, null, 1)}\n`);
