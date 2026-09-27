// SPEED step 3: round trips to Polymarket's public REST endpoints from this machine, as a proxy for order latency.
//
// Sequential GETs (keyless; nothing is posted) on a kept-alive connection ("warm", what an always-on worker or a warm
// isolate sees) and on a new connection each time ("cold": a new tunnel, TCP and TLS, what a fresh process sees):
// CLOB /time, /book, /price, /midpoint; the data API's /trades; Gamma's /markets. Also where the request lands
// (Cloudflare's `cf-ray` colo) and this machine's own egress (Cloudflare's /cdn-cgi/trace). This machine reaches the
// internet through an HTTPS proxy, so its numbers are an upper bound for a server in the same region.
//
// usage: node pm_rest_rtt.mjs <tokens json> <out json>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(process.env.SPEED_NODE_MODULES ? path.join(process.env.SPEED_NODE_MODULES, "x.js") : import.meta.url);
const { ProxyAgent, Agent, fetch: ufetch } = require("undici");

const [tokFile, outFile] = process.argv.slice(2);
const toks = JSON.parse(fs.readFileSync(tokFile, "utf8"));
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const UA = "daviesportfolios-speed-study/1.0 (research; public data only)";
const mk = () => (proxy ? new ProxyAgent({ uri: proxy, keepAliveTimeout: 30_000 }) : new Agent({ keepAliveTimeout: 30_000 }));
// the first market (busiest first) whose book the CLOB still serves: a finished game's book answers 404
let token = null, cond = null;
for (const m of [...toks.busy, ...toks.temperature]) {
  const r = await ufetch(`https://clob.polymarket.com/book?token_id=${m.tokens[0]}`, { dispatcher: mk(), headers: { "User-Agent": UA } });
  await r.arrayBuffer();
  if (r.status === 200) { token = m.tokens[0]; cond = m.cond; break; }
}

function q(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function one(url, dispatcher) {
  const t0 = performance.now();
  const r = await ufetch(url, { dispatcher, headers: { "User-Agent": UA } });
  const tHead = performance.now();
  await r.arrayBuffer();
  const t1 = performance.now();
  return { status: r.status, head_ms: tHead - t0, total_ms: t1 - t0, ray: r.headers.get("cf-ray"), cache: r.headers.get("cf-cache-status") };
}

const targets = {
  clob_time: "https://clob.polymarket.com/time",
  clob_book: `https://clob.polymarket.com/book?token_id=${token}`,
  clob_price: `https://clob.polymarket.com/price?token_id=${token}&side=buy`,
  clob_midpoint: `https://clob.polymarket.com/midpoint?token_id=${token}`,
  data_trades: `https://data-api.polymarket.com/trades?market=${cond}&limit=1`,
  gamma_markets: "https://gamma-api.polymarket.com/markets?limit=1",
};

const out = { at: new Date().toISOString(), proxy: Boolean(proxy), token, results: {} };
for (const [name, url] of Object.entries(targets)) {
  const warm = mk();
  const w = [], c = [], statuses = {}, rays = new Set();
  await one(url, warm);                                  // open the connection
  for (let i = 0; i < 30; i++) {
    const r = await one(url, warm);
    w.push(r.total_ms); statuses[r.status] = (statuses[r.status] || 0) + 1;
    if (r.ray) rays.add(r.ray.split("-").pop());
    await sleep(250);
  }
  for (let i = 0; i < 8; i++) {
    const a = mk();
    const r = await one(url, a);
    c.push(r.total_ms);
    await a.close();
    await sleep(250);
  }
  await warm.close();
  out.results[name] = { warm_ms: { n: w.length, p10: q(w, 0.1), p50: q(w, 0.5), p90: q(w, 0.9) },
                        cold_ms: { n: c.length, p50: q(c, 0.5), p90: q(c, 0.9) }, statuses, cf_colo: [...rays] };
  console.log(name, JSON.stringify(out.results[name]));
}
try {
  const r = await ufetch("https://www.cloudflare.com/cdn-cgi/trace", { dispatcher: mk() });
  const t = await r.text();
  out.egress = Object.fromEntries(t.trim().split("\n").map((l) => l.split("=")).filter(([k]) => ["colo", "loc"].includes(k)));
} catch (e) { out.egress = { error: String(e) }; }
fs.writeFileSync(outFile, JSON.stringify(out, null, 1) + "\n");
console.log("egress", JSON.stringify(out.egress));
process.exit(0);
