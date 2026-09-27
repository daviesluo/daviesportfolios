// SPEED step 3: Polymarket's public CLOB market WebSocket, measured from this machine (keyless, read-only).
//
// Connects to wss://ws-subscriptions-clob.polymarket.com/ws/market (the documented market channel; no auth), subscribes
// to the tokens in <tokens json> (the 20 busiest open markets and the 60 busiest open temperature buckets), sends the
// documented application heartbeat "PING" every 10 s, and records: the connect time, each PING→PONG round trip, and for
// every event that carries a `timestamp` (ms) the delay from that timestamp to this machine's receipt, corrected by the
// clock offset measured against data-api.binance.vision at the start. Trade events (`last_trade_price`) are written out
// so the data API's print times can be set against the socket's. Places nothing; reads nothing keyed.
//
// usage: node pm_ws_probe.mjs <tokens json> <out dir> <seconds>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(process.env.SPEED_NODE_MODULES ? path.join(process.env.SPEED_NODE_MODULES, "x.js") : import.meta.url);
const WebSocket = require("ws");
const { HttpsProxyAgent } = require("https-proxy-agent");

const [tokFile, outDir, secs] = process.argv.slice(2);
const toks = JSON.parse(fs.readFileSync(tokFile, "utf8"));
const assets = [...toks.busy.flatMap((m) => m.tokens), ...toks.temperature.slice(0, 60).flatMap((m) => m.tokens)];
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
const UA = "daviesportfolios-speed-study/1.0 (research; public data only)";
fs.mkdirSync(outDir, { recursive: true });
const trades = fs.createWriteStream(path.join(outDir, "ws_trades.jsonl"));

async function clockOffset() {
  const xs = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await fetch("https://data-api.binance.vision/api/v3/time");
    const j = await r.json();
    const t1 = Date.now();
    xs.push({ off: j.serverTime - (t0 + t1) / 2, rtt: t1 - t0 });
  }
  xs.sort((a, b) => a.rtt - b.rtt);
  return xs[0];
}

function q(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

const off = await clockOffset();
const lat = {};
const pongs = [];
let pingAt = null, msgs = 0, connectMs = null;
const t0 = Date.now();
const ws = new WebSocket("wss://ws-subscriptions-clob.polymarket.com/ws/market", { agent, headers: { "User-Agent": UA } });
ws.on("open", () => {
  connectMs = Date.now() - t0;
  ws.send(JSON.stringify({ assets_ids: assets, type: "market" }));
  setInterval(() => { pingAt = Date.now(); ws.send("PING"); }, 10_000);
});
ws.on("message", (buf) => {
  const recv = Date.now();
  const s = buf.toString();
  if (s === "PONG") { if (pingAt) pongs.push(recv - pingAt); return; }
  let d;
  try { d = JSON.parse(s); } catch { return; }
  for (const ev of Array.isArray(d) ? d : [d]) {
    msgs++;
    const et = ev.event_type || "?";
    const ts = Number(ev.timestamp);
    if (Number.isFinite(ts) && ts > 1e12) (lat[et] ||= []).push(recv + off.off - ts);
    if (et === "last_trade_price") trades.write(JSON.stringify({ recv, recv_corr: recv + off.off, ts, asset: ev.asset_id, market: ev.market, price: ev.price, size: ev.size, side: ev.side, fee: ev.fee_rate_bps }) + "\n");
  }
});
ws.on("error", (e) => { console.error("ws error", String(e)); });
setTimeout(() => {
  const res = {
    at: new Date(t0).toISOString(), seconds: Number(secs), assets: assets.length, proxy: Boolean(proxy),
    clock_offset_ms: Math.round(off.off), clock_rtt_ms: off.rtt, connect_ms: connectMs, messages: msgs,
    pong_rtt_ms: { n: pongs.length, p50: q(pongs, 0.5), p90: q(pongs, 0.9), min: q(pongs, 0) },
    event_delay_ms: Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, { n: v.length, p10: q(v, 0.1), p50: q(v, 0.5), p90: q(v, 0.9), p99: q(v, 0.99) }])),
  };
  fs.writeFileSync(path.join(outDir, "ws_probe.json"), JSON.stringify(res, null, 1) + "\n");
  console.log(JSON.stringify(res, null, 1));
  trades.end();
  ws.close();
  setTimeout(() => process.exit(0), 500);
}, Number(secs) * 1000);
