// CXBOT's engine (the audit §7; the prereg's §2-§5): the recorder, the context, the assigned questions, the paper book and
// the agent's actions. Every number it decides with comes from `rules.ts`; every price it fills at comes from the recorded
// tape or a book read at the request, never from the agent. Public reads only (`client.ts`).

import type { Db } from "../agents/db.ts";
import { type Book, type CoinCtx, makeReader, type Reader, tapeOf } from "./client.ts";
import { type Answer, type Decision, decisionOf, isObj } from "./ingest.ts";
import {
  assignedBracket, type BookItem, bracketOf, type Coin, COINS, costsOf, CXBOT_CALENDAR_UNTIL_MS, CXBOT_FEES, CXBOT_QUESTIONS,
  CXBOT_RELEASE_MS, CXBOT_RULES, decompose, type Dir, entryEvent, inBlackout, kellyRisk, leverageFor, liquidationPrice, type Minute,
  normCdf, openRefusals, type OpenRequest, positionEvent, type Refusal, resolveOnTape, riskOf, sizeMax, stopFill, type Venue, walkBook,
} from "./rules.ts";

const M = 60e3, H = 3600e3, DAY = 86400e3;
const iso = (t: number) => new Date(t).toISOString();
const ms = (s: unknown) => (s === null || s === undefined ? NaN : Date.parse(String(s)));
const n = (x: unknown): number | null => (x === null || x === undefined || x === "" ? null : Number.isFinite(Number(x)) ? Number(x) : null);
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const floorTo = (t: number, step: number) => Math.floor(t / step) * step;
const sgn = (d: Dir) => (d === "long" ? 1 : -1);

export type Config = {
  mode: "dry_run" | "paper"; venue: Venue; started_at: string | null; ended_at: string | null; budget_usd: number; day_stop_usd: number;
  total_stop_usd: number; max_orders_day: number;
};
export type Deps = { db: Db; now: number; reader: Reader; region?: string | null };
export const makeDeps = (db: Db, now: number, fetchImpl?: typeof fetch): Deps => ({ db, now, reader: makeReader(fetchImpl), region: null });

export async function readConfig(db: Db): Promise<Config> {
  const c = (await db.select<Record<string, unknown>>("cxbot_config", "id=eq.1&select=mode,venue,started_at,ended_at,budget_usd,day_stop_usd,total_stop_usd,max_orders_day"))[0];
  if (!c) throw new Error("cxbot_config has no row");
  return {
    mode: c.mode === "paper" ? "paper" : "dry_run", venue: (["hyperliquid", "binance", "okx"].includes(String(c.venue)) ? c.venue : "hyperliquid") as Venue,
    started_at: (c.started_at as string) ?? null, ended_at: (c.ended_at as string) ?? null, budget_usd: Number(c.budget_usd), day_stop_usd: Number(c.day_stop_usd),
    total_stop_usd: Number(c.total_stop_usd), max_orders_day: Number(c.max_orders_day),
  };
}

export async function globalPaused(db: Db): Promise<boolean> {
  const r = await db.select<{ global_pause: boolean }>("agent_risk", "id=eq.1&select=global_pause").catch(() => []);
  return !!r[0]?.global_pause;
}

type State = Record<string, unknown>;
export async function readState(db: Db): Promise<State> {
  return (await db.select<{ state: State | null }>("cxbot_exec_state", "id=eq.1&select=state"))[0]?.state ?? {};
}
export async function writeState(db: Db, state: State, now: number) {
  await db.update("cxbot_exec_state", "id=eq.1", { state, updated_at: iso(now) });
}

/** The 20-second lease two requests (the agent's and the minute's) take before deciding on one book. */
export async function takeLease(db: Db, owner: string, now: number, ttlMs = 20e3): Promise<boolean> {
  const got = await db.claim("cxbot_exec_state", `id=eq.1&or=(lease_until.is.null,lease_until.lt.${encodeURIComponent(iso(now))})`, { lease_until: iso(now + ttlMs), lease_owner: owner });
  return got.length === 1;
}
export async function dropLease(db: Db, owner: string) {
  await db.update("cxbot_exec_state", `id=eq.1&lease_owner=eq.${encodeURIComponent(owner)}`, { lease_until: null, lease_owner: null }).catch(() => {});
}

// ── the tape ────────────────────────────────────────────────────────────────────────────────────────────────────────

type TapeRow = { t: string; o: number | null; h: number | null; l: number | null; c: number | null; bid?: number | null; ask?: number | null; mark?: number | null; idx?: number | null; funding?: number | null; oi?: number | null; premium?: number | null; fetched_at?: string };

/** Complete minutes of a coin's tape in [from, to), ascending. */
export async function minutesOf(db: Db, venue: Venue, coin: Coin, from: number, to: number): Promise<Minute[]> {
  const rows = await db.selectAll<TapeRow>("cxbot_tape",
    `venue=eq.${venue}&coin=eq.${coin}&t=gte.${encodeURIComponent(iso(from))}&t=lt.${encodeURIComponent(iso(to))}&c=not.is.null&select=t,o,h,l,c&order=venue.asc,coin.asc,t.asc`);
  return rows.map((r) => ({ t: ms(r.t), o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c) })).filter((m) => [m.t, m.o, m.h, m.l, m.c].every(Number.isFinite));
}

/** The newest book read of a coin (the touch, mark, funding, read on the minute it was taken). */
export async function lastRead(db: Db, venue: Venue, coin: Coin): Promise<TapeRow | null> {
  return (await db.select<TapeRow>("cxbot_tape", `venue=eq.${venue}&coin=eq.${coin}&bid=not.is.null&select=t,o,h,l,c,bid,ask,mark,idx,funding,oi,premium,fetched_at&order=t.desc&limit=1`))[0] ?? null;
}

/** The recorder: each coin's complete minutes since the last one recorded (at most six hours back), then the book's touch,
 * mark, funding and open interest on the current minute. Upserts on (venue, coin, t): a second run writes the same rows. */
export async function record(x: Deps, cfg: Config) {
  const tape = tapeOf(cfg.venue, x.reader);
  const now = x.now, cur = floorTo(now, M);
  const did = { minutes: 0, reads: 0 };
  for (const coin of COINS) {
    const last = (await x.db.select<{ t: string }>("cxbot_tape", `venue=eq.${cfg.venue}&coin=eq.${coin}&c=not.is.null&select=t&order=t.desc&limit=1`))[0];
    const from = Math.max(last ? ms(last.t) + M : 0, cur - 6 * H);
    if (from < cur) {
      const bars = (await tape.candles(coin, from, now)).filter((b) => b.t >= from && b.t + M <= now);
      if (bars.length) {
        await x.db.upsert("cxbot_tape", bars.map((b) => ({ venue: cfg.venue, coin, t: iso(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: b.n === null ? null : Math.round(b.n), fetched_at: iso(now) })), "venue,coin,t");
        did.minutes += bars.length;
      }
    }
  }
  const ctx = await tape.ctx();
  const books = await Promise.all(COINS.map((c) => tape.book(c).catch(() => null)));
  const rows = COINS.map((coin, i) => {
    const b = books[i], c: CoinCtx | undefined = ctx[coin];
    return {
      venue: cfg.venue, coin, t: iso(cur), bid: b?.bids[0]?.[0] ?? null, ask: b?.asks[0]?.[0] ?? null, mark: c?.mark ?? null, idx: c?.index ?? null,
      funding: c?.funding ?? null, oi: c?.oi ?? null, premium: c?.premium ?? null, fetched_at: iso(now),
    };
  }).filter((r) => r.bid !== null && r.ask !== null);
  if (rows.length) await x.db.upsert("cxbot_tape", rows, "venue,coin,t");
  did.reads = rows.length;
  return { did, ctx, books: Object.fromEntries(COINS.map((c, i) => [c, books[i]])) as Record<Coin, Book | null> };
}

// ── the context (audit §6.2) ──────────────────────────────────────────────────────────────────────────────────────────

export async function latestCtx<T = Record<string, unknown>>(db: Db, kind: string): Promise<{ at: string; data: T } | null> {
  return (await db.select<{ at: string; data: T }>("cxbot_ctx", `kind=eq.${kind}&select=at,data&order=at.desc&limit=1`))[0] ?? null;
}

/** The standard deviation of hourly log returns × √24: the coin's one-day volatility, from the last `hours` closes. */
export function sd24Of(closes: number[]): number | null {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) if (closes[i] > 0 && closes[i - 1] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
  if (r.length < 24) return null;
  const mean = r.reduce((s, v) => s + v, 0) / r.length;
  const v = r.reduce((s, x) => s + (x - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v * 24);
}

type Smile = { exp: string; t_days: number; F: number; atm_iv: number; strikes: number[]; ivs: number[] };
export type DeribitCcy = { index: number | null; dvol: number | null; expiries: Smile[] };

/** Deribit's options, compacted: per expiry the forward, the ATM vol and the calls' mark vol within ±20 % of the forward. */
export async function readDeribit(r: Reader, ccy: "BTC" | "ETH", now: number): Promise<DeribitCcy> {
  const base = "https://www.deribit.com/api/v2/public";
  const [idx, dv, bs, ins] = await Promise.all([
    r.get(`${base}/get_index_price?index_name=${ccy.toLowerCase()}_usd`),
    r.get(`${base}/get_volatility_index_data?currency=${ccy}&start_timestamp=${now - 3 * H}&end_timestamp=${now}&resolution=3600`),
    r.get(`${base}/get_book_summary_by_currency?currency=${ccy}&kind=option`),
    r.get(`${base}/get_instruments?currency=${ccy}&kind=option&expired=false`),
  ]);
  const res = (o: unknown) => (isObj(o) ? o.result : null);
  const index = isObj(res(idx)) ? n((res(idx) as Record<string, unknown>).index_price) : null;
  const dd = isObj(res(dv)) && Array.isArray((res(dv) as Record<string, unknown>).data) ? (res(dv) as { data: unknown[][] }).data : [];
  const dvol = dd.length ? n(dd[dd.length - 1][4]) : null;
  const meta = new Map<string, { exp: number; strike: number; type: string }>();
  for (const i of Array.isArray(res(ins)) ? res(ins) as unknown[] : []) if (isObj(i)) meta.set(String(i.instrument_name), { exp: Number(i.expiration_timestamp), strike: Number(i.strike), type: String(i.option_type) });
  const by = new Map<number, { F: number; pts: Array<[number, number]> }>();
  for (const b of Array.isArray(res(bs)) ? res(bs) as unknown[] : []) {
    if (!isObj(b)) continue;
    const m = meta.get(String(b.instrument_name));
    const iv = n(b.mark_iv), F = n(b.underlying_price);
    if (!m || m.type !== "call" || iv === null || F === null || m.exp <= now) continue;
    const e = by.get(m.exp) ?? { F, pts: [] };
    e.pts.push([m.strike, iv / 100]);
    by.set(m.exp, e);
  }
  const expiries = [...by.entries()].sort((a, b) => a[0] - b[0]).slice(0, 8).map(([exp, e]) => {
    const pts = e.pts.filter(([k]) => Math.abs(Math.log(k / e.F)) < 0.2).sort((a, b) => a[0] - b[0]);
    const atm = pts.reduce((best, p) => (Math.abs(p[0] - e.F) < Math.abs(best[0] - e.F) ? p : best), pts[0] ?? [e.F, NaN]);
    return { exp: iso(exp), t_days: r4((exp - now) / DAY), F: e.F, atm_iv: r4(atm[1]), strikes: pts.map((p) => p[0]), ivs: pts.map((p) => r4(p[1])) };
  }).filter((s) => s.strikes.length >= 3 && Number.isFinite(s.atm_iv));
  return { index, dvol, expiries };
}

const ivAt = (s: Smile, K: number) => {
  const k = s.strikes, v = s.ivs;
  if (K <= k[0]) return v[0];
  if (K >= k[k.length - 1]) return v[v.length - 1];
  for (let i = 1; i < k.length; i++) if (K <= k[i]) return v[i - 1] + ((v[i] - v[i - 1]) * (K - k[i - 1])) / (k[i] - k[i - 1]);
  return v[v.length - 1];
};

/** The implied vol for a horizon and strike: total variance interpolated between the expiries around it (Deribit's smile). */
export function impliedAt(d: DeribitCcy, now: number, tEnd: number, K: number | null): { iv: number; T: number; F: number } | null {
  const ex = d.expiries.map((s) => ({ s, t: ms(s.exp) })).filter((e) => e.t > now).sort((a, b) => a.t - b.t);
  if (!ex.length) return null;
  const T = (tEnd - now) / (365 * DAY);
  if (T <= 0) return null;
  const a = [...ex].reverse().find((e) => e.t <= tEnd) ?? ex[0];
  const b = ex.find((e) => e.t >= tEnd) ?? ex[ex.length - 1];
  const vol = (e: typeof a) => (K === null ? e.s.atm_iv : ivAt(e.s, K));
  const Ta = (a.t - now) / (365 * DAY), Tb = (b.t - now) / (365 * DAY);
  const va = vol(a) ** 2 * Ta, vb = vol(b) ** 2 * Tb;
  const w = b.t === a.t ? 0 : Math.min(1, Math.max(0, (tEnd - a.t) / (b.t - a.t)));
  const F = a.s.F + (b.s.F - a.s.F) * w;
  const v = (va + (vb - va) * w) / T;
  return v > 0 ? { iv: Math.sqrt(v), T, F } : null;
}

/** P(price above K at tEnd) from the smile: N(d2) less the skew's term (the digital is −dC/dK); `scale` moves the forward to another quote (USDT). */
export function digitalAbove(d: DeribitCcy, now: number, tEnd: number, K: number, scale = 1): number | null {
  const a = impliedAt(d, now, tEnd, K), up = impliedAt(d, now, tEnd, K * 1.002), dn = impliedAt(d, now, tEnd, K * 0.998);
  if (!a || !up || !dn) return null;
  const F = a.F * scale, s = a.iv, T = a.T;
  const d2 = (Math.log(F / K) - 0.5 * s * s * T) / (s * Math.sqrt(T));
  const dsdk = (up.iv - dn.iv) / (K * 0.004);
  const nd2 = Math.exp(-d2 * d2 / 2) / Math.sqrt(2 * Math.PI);
  return Math.min(1, Math.max(0, normCdf(d2) - K * nd2 * Math.sqrt(T) * dsdk));
}

/** The forward vol between consecutive expiries: where the options market prices a release's move. */
export function forwardVols(d: DeribitCcy): Array<{ from: string; to: string; vol: number; day_sd: number }> {
  const out = [];
  for (let i = 1; i < d.expiries.length; i++) {
    const a = d.expiries[i - 1], b = d.expiries[i];
    const v = (b.atm_iv ** 2 * b.t_days - a.atm_iv ** 2 * a.t_days) / (b.t_days - a.t_days);
    if (v > 0) out.push({ from: a.exp, to: b.exp, vol: r4(Math.sqrt(v)), day_sd: r4(Math.sqrt(v / 365)) });
  }
  return out;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** Polymarket's daily slug for a coin and a UTC date: "bitcoin-above-on-october-30-2026". */
export const pmSlug = (coin: "BTC" | "ETH", day: number) => {
  const d = new Date(day);
  return `${coin === "BTC" ? "bitcoin" : "ethereum"}-above-on-${MONTHS[d.getUTCMonth()]}-${d.getUTCDate()}-${d.getUTCFullYear()}`;
};
export type PmMarket = { id: string; strike: number; question: string; bid: number | null; ask: number | null; last: number | null; mid: number | null; closed: boolean; yes: number | null };
export type PmEvent = { slug: string; coin: "BTC" | "ETH"; end: string; markets: PmMarket[] };

/** One daily "above" event from Gamma: its markets' strike, touch, last trade and, once resolved, the outcome. */
export async function readPmEvent(r: Reader, slug: string, coin: "BTC" | "ETH"): Promise<PmEvent | null> {
  const a = await r.get(`https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`);
  const e = Array.isArray(a) && isObj(a[0]) ? a[0] : null;
  if (!e || !Array.isArray(e.markets)) return null;
  const markets = (e.markets as unknown[]).filter(isObj).map((m) => {
    const bid = n(m.bestBid), ask = n(m.bestAsk);
    let yes: number | null = null;
    try { const op = JSON.parse(String(m.outcomePrices)); yes = m.closed ? n(op[0]) : null; } catch { yes = null; }
    return {
      id: String(m.id), strike: Number(String(m.groupItemTitle ?? "").replace(/[^0-9.]/g, "")), question: String(m.question ?? "").slice(0, 200),
      bid, ask, last: n(m.lastTradePrice), mid: bid !== null && ask !== null ? r4((bid + ask) / 2) : null, closed: !!m.closed, yes: yes === 1 || yes === 0 ? yes : null,
    };
  }).filter((m) => Number.isFinite(m.strike) && m.strike > 0).sort((a, b) => a.strike - b.strike);
  return { slug, coin, end: String(e.endDate), markets };
}

/** Refresh what is due: Deribit, Polymarket's daily events and Binance's spot every 5 minutes; volatility, predicted
 * funding and liquidations hourly; flows and stablecoins daily. Each kind its own row (kind, slot). */
export async function refreshCtx(x: Deps, cfg: Config, state: State) {
  const now = x.now, at = (state.ctxAt ?? {}) as Record<string, number>;
  const due = (kind: string, every: number) => !(at[kind] && floorTo(at[kind], every) === floorTo(now, every));
  const errors: string[] = [];
  const put = async (kind: string, data: unknown, every: number) => {
    await x.db.upsert("cxbot_ctx", [{ kind, at: iso(floorTo(now, every)), data }], "kind,at");
    at[kind] = now;
  };
  const tryDo = async (kind: string, f: () => Promise<void>) => { try { await f(); } catch (e) { errors.push(`${kind}: ${(e as Error).message.slice(0, 120)}`); } };
  if (due("deribit", 5 * M)) await tryDo("deribit", async () => put("deribit", { BTC: await readDeribit(x.reader, "BTC", now), ETH: await readDeribit(x.reader, "ETH", now) }, 5 * M));
  if (due("polymarket", 5 * M)) await tryDo("polymarket", async () => {
    const events: PmEvent[] = [];
    for (const coin of ["BTC", "ETH"] as const) {
      for (let d = 0; d <= 2; d++) {
        const ev = await readPmEvent(x.reader, pmSlug(coin, now + d * DAY), coin).catch(() => null);
        if (ev && ms(ev.end) > now) events.push(ev);
      }
    }
    await put("polymarket", { events }, 5 * M);
  });
  if (due("spot", 5 * M)) await tryDo("spot", async () => {
    const out: Record<string, unknown> = {};
    for (const [coin, sym] of [["BTC", "BTCUSDT"], ["ETH", "ETHUSDT"], ["SOL", "SOLUSDT"]]) {
      const b = await x.reader.get(`https://data-api.binance.vision/api/v3/ticker/bookTicker?symbol=${sym}`);
      if (isObj(b)) { const bid = n(b.bidPrice), ask = n(b.askPrice); out[coin] = { bid, ask, mid: bid !== null && ask !== null ? (bid + ask) / 2 : null }; }
    }
    await put("spot", out, 5 * M);
  });
  if (due("vol", H)) await tryDo("vol", async () => {
    const tape = tapeOf(cfg.venue, x.reader);
    const sd: Record<string, number | null> = {}, sd1h: Record<string, number | null> = {};
    for (const coin of COINS) {
      const closes = await tape.hourCloses(coin, 168);
      const v = sd24Of(closes);
      sd[coin] = v === null ? null : r4(v);
      sd1h[coin] = v === null ? null : r4(v / Math.sqrt(24));
    }
    let predicted: Record<string, unknown> = {};
    try {
      const pf = await x.reader.hl({ type: "predictedFundings" });
      for (const row of Array.isArray(pf) ? pf : []) {
        if (!Array.isArray(row) || !(COINS as readonly string[]).includes(String(row[0])) || !Array.isArray(row[1])) continue;
        const per: Record<string, number | null> = {};
        for (const v of row[1] as unknown[]) {
          if (!Array.isArray(v) || !isObj(v[1])) continue;
          const f = n(v[1].fundingRate), h = n(v[1].fundingIntervalHours) ?? 8;
          per[String(v[0])] = f === null ? null : f / h;
        }
        predicted[String(row[0])] = per;
      }
    } catch { predicted = {}; }
    await put("vol", { sd24: sd, sd1h, hours: 168, predicted_per_hour: predicted }, H);
  });
  if (due("liquidations", H)) await tryDo("liquidations", async () => {
    const out: Record<string, { long_usd: number; short_usd: number }> = {};
    const ct: Record<string, number> = { BTC: 0.01, ETH: 0.1, SOL: 1 };
    for (const coin of COINS) {
      const a = await x.reader.get(`https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&uly=${coin}-USDT&state=filled&limit=100`);
      const rows = isObj(a) && Array.isArray(a.data) && isObj(a.data[0]) && Array.isArray(a.data[0].details) ? a.data[0].details as unknown[] : [];
      let lu = 0, su = 0;
      for (const d of rows) {
        if (!isObj(d) || Number(d.ts) < now - H) continue;
        const usd = Number(d.sz) * ct[coin] * Number(d.bkPx);
        if (d.posSide === "long") lu += usd; else su += usd;
      }
      out[coin] = { long_usd: Math.round(lu), short_usd: Math.round(su) };
    }
    await put("liquidations", { venue: "okx", last_hour: out }, H);
  });
  if (due("flows", DAY)) await tryDo("flows", async () => {
    const a = await x.reader.get("https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc,eth&metrics=FlowInExUSD,FlowOutExUSD&frequency=1d&page_size=6");
    const rows = isObj(a) && Array.isArray(a.data) ? (a.data as unknown[]).filter(isObj).map((d) => ({ asset: d.asset, day: String(d.time).slice(0, 10), in_usd: n(d.FlowInExUSD), out_usd: n(d.FlowOutExUSD) })) : [];
    await put("flows", { source: "coinmetrics community", rows }, DAY);
  });
  if (due("stablecoins", DAY)) await tryDo("stablecoins", async () => {
    const a = await x.reader.get("https://stablecoins.llama.fi/stablecoincharts/all?stablecoin=1");
    const rows = Array.isArray(a) ? a.slice(-8).filter(isObj).map((d) => ({ day: new Date(Number(d.date) * 1000).toISOString().slice(0, 10), usdt_usd: n(isObj(d.totalCirculatingUSD) ? d.totalCirculatingUSD.peggedUSD : null) })) : [];
    await put("stablecoins", { source: "defillama (USDT)", rows }, DAY);
  });
  state.ctxAt = at;
  return errors;
}

// ── the paper book ────────────────────────────────────────────────────────────────────────────────────────────────────

export type Position = {
  id: number; order_id: number; decision_id: string; coin: Coin; direction: Dir; size: number; entry: number; stop: number; limit_px: number;
  stop0: number; limit0: number; p: number | null; leverage: number; liq_price: number; opened_at: string; fee_open_usd: number; funding_usd: number;
  state: "open" | "closed"; closed_at: string | null; close_price: number | null; close_how: string | null; fee_close_usd: number | null; pnl_usd: number | null;
};
export type Order = {
  id: number; created_at: string; mode: string; decision_id: string; kind: string; coin: Coin; direction: Dir | null; entry_type: string | null; size: number | null;
  entry: number | null; stop: number | null; limit_px: number | null; p: number | null; good_till: string | null; state: string; leverage: number | null;
};
const POS_COLS = "id,order_id,decision_id,coin,direction,size,entry,stop,limit_px,stop0,limit0,p,leverage,liq_price,opened_at,fee_open_usd,funding_usd,state,closed_at,close_price,close_how,fee_close_usd,pnl_usd";
const ORD_COLS = "id,created_at,mode,decision_id,kind,coin,direction,entry_type,size,entry,stop,limit_px,p,good_till,state,leverage";
const numPos = (p: Record<string, unknown>): Position => ({
  ...(p as unknown as Position), size: Number(p.size), entry: Number(p.entry), stop: Number(p.stop), limit_px: Number(p.limit_px), stop0: Number(p.stop0),
  limit0: Number(p.limit0), p: n(p.p), leverage: Number(p.leverage), liq_price: Number(p.liq_price), fee_open_usd: Number(p.fee_open_usd), funding_usd: Number(p.funding_usd),
  close_price: n(p.close_price), fee_close_usd: n(p.fee_close_usd), pnl_usd: n(p.pnl_usd),
});
const numOrd = (o: Record<string, unknown>): Order => ({ ...(o as unknown as Order), size: n(o.size), entry: n(o.entry), stop: n(o.stop), limit_px: n(o.limit_px), p: n(o.p), leverage: n(o.leverage) });

export const openPositions = async (db: Db) => (await db.select<Record<string, unknown>>("cxbot_positions", `state=eq.open&select=${POS_COLS}&order=id.asc`)).map(numPos);
export const closedPositions = async (db: Db) => (await db.selectAll<Record<string, unknown>>("cxbot_positions", `state=eq.closed&select=${POS_COLS}&order=id.asc`)).map(numPos);
export const restingOrders = async (db: Db) => (await db.select<Record<string, unknown>>("cxbot_orders", `state=eq.resting&select=${ORD_COLS}&order=id.asc`)).map(numOrd);

/** The rules' view of the book: open positions at their stops and resting orders at theirs. */
export const bookOf = (pos: Position[], rest: Order[]): BookItem[] => [
  ...pos.map((p) => ({ coin: p.coin, dir: p.direction, size: p.size, entry: p.entry, stop: p.stop })),
  ...rest.filter((o) => o.kind === "open").map((o) => ({ coin: o.coin, dir: o.direction as Dir, size: o.size ?? 0, entry: o.entry ?? 0, stop: o.stop ?? 0, pending: true })),
];

/** A position's P&L at a price, fees and funding included. */
export const pnlAt = (p: Position, price: number, feeClose: number) => sgn(p.direction) * (price - p.entry) * p.size - p.fee_open_usd - feeClose - p.funding_usd;

/** The paper equity: the budget, every closed position's P&L, and the open ones' at the latest prices (their exit fee not yet paid). */
export function equityOf(budget: number, closed: Position[], open: Position[], prices: Partial<Record<Coin, number>>) {
  const realised = closed.reduce((s, p) => s + (p.pnl_usd ?? 0), 0);
  const unrealised = open.reduce((s, p) => s + pnlAt(p, prices[p.coin] ?? p.entry, 0), 0);
  const fees = [...closed, ...open].reduce((s, p) => s + p.fee_open_usd + (p.fee_close_usd ?? 0), 0);
  const funding = [...closed, ...open].reduce((s, p) => s + p.funding_usd, 0);
  return { equity: budget + realised + unrealised, realised, unrealised, fees, funding };
}

async function closePos(db: Db, p: Position, price: number, how: string, at: number, venue: Venue, maker: boolean) {
  const fee = p.size * price * (maker ? CXBOT_FEES[venue].maker : CXBOT_FEES[venue].taker);
  const pnl = pnlAt(p, price, fee);
  await db.update("cxbot_positions", `id=eq.${p.id}&state=eq.open`, {
    state: "closed", closed_at: iso(at), close_price: price, close_how: how, fee_close_usd: r4(fee), pnl_usd: r4(pnl), updated_at: iso(at),
  });
  return pnl;
}

async function openPos(db: Db, o: Order, price: number, at: number, venue: Venue, maker: boolean) {
  const dir = o.direction as Dir, size = o.size ?? 0;
  const br = bracketOf(dir, price, o.stop ?? 0, o.limit_px ?? 0);
  const lev = o.leverage ?? (br.ok ? leverageFor(o.coin, dir, br.dStop) : null) ?? 1;
  const fee = size * price * (maker ? CXBOT_FEES[venue].maker : CXBOT_FEES[venue].taker);
  const [row] = await db.insert<Record<string, unknown>>("cxbot_positions", [{
    order_id: o.id, decision_id: o.decision_id, coin: o.coin, direction: dir, size, entry: price, stop: o.stop, limit_px: o.limit_px, stop0: o.stop, limit0: o.limit_px,
    p: o.p, leverage: lev, liq_price: r4(liquidationPrice(o.coin, dir, price, lev)), opened_at: iso(at), fee_open_usd: r4(fee), funding_usd: 0, state: "open", updated_at: iso(at),
  }]);
  await db.update("cxbot_orders", `id=eq.${o.id}`, { state: "filled", fill_price: price, filled_at: iso(at), fee_usd: r4(fee), position_id: row?.id ?? null, updated_at: iso(at) });
  return row;
}

/**
 * The paper engine, minute by minute from the one it last decided to the last complete minute that has a recorded minute
 * after it (a stop's fill needs the next open): resting entries fill or expire; positions meet their stop (first, when a
 * minute reaches both), their limit (strictly through), liquidation, or the 7-day close; funding is paid on each hour.
 */
export async function stepBook(x: Deps, cfg: Config, state: State) {
  const now = x.now, last = floorTo(now, M) - 2 * M; // the last minute that has a complete minute after it
  let from = Number(state.engineMinute ?? NaN);
  if (!Number.isFinite(from)) from = last; // the first run decides from now on
  const did = { minutes: 0, filled: 0, closed: 0, expired: 0, funded: 0 };
  if (from >= last) { state.engineMinute = from; return did; }
  const pos = await openPositions(x.db), rest = await restingOrders(x.db);
  const tapes: Partial<Record<Coin, Minute[]>> = {};
  const fundingRows: Partial<Record<Coin, TapeRow[]>> = {};
  for (const coin of COINS) {
    if (!pos.some((p) => p.coin === coin) && !rest.some((o) => o.coin === coin)) continue;
    tapes[coin] = await minutesOf(x.db, cfg.venue, coin, from + M, last + 2 * M);
    fundingRows[coin] = await x.db.select<TapeRow>("cxbot_tape", `venue=eq.${cfg.venue}&coin=eq.${coin}&t=gt.${encodeURIComponent(iso(from - H))}&t=lte.${encodeURIComponent(iso(last))}&funding=not.is.null&select=t,funding,idx,mark&order=t.asc`);
  }
  const at = (coin: Coin, t: number) => (tapes[coin] ?? []).find((m) => m.t === t) ?? null;
  for (let t = from + M; t <= last; t += M) {
    for (const coin of COINS) {
      const mi = at(coin, t);
      if (!mi) continue;
      const next = at(coin, t + M);
      if (!next) continue;
      for (const o of rest.filter((o) => o.coin === coin && o.state === "resting")) {
        if (ms(o.created_at) >= t + M) continue; // only minutes that began after it was written count (reference §4 item 41)
        if (o.good_till && ms(o.good_till) <= t) {
          await x.db.update("cxbot_orders", `id=eq.${o.id}&state=eq.resting`, { state: "expired", updated_at: iso(now) });
          o.state = "expired"; did.expired++;
          continue;
        }
        if (ms(o.created_at) >= t) continue;
        const type = o.entry_type === "stop" ? "stop" : "limit";
        if (!entryEvent(o.direction as Dir, type, o.entry ?? 0, mi)) continue;
        const price = type === "limit" ? (o.entry ?? 0) : (o.direction === "long" ? Math.max((o.entry ?? 0) * (1 + CXBOT_RULES.stopSlippage), next.o) : Math.min((o.entry ?? 0) * (1 - CXBOT_RULES.stopSlippage), next.o));
        const row = await openPos(x.db, o, price, t + M, cfg.venue, type === "limit");
        o.state = "filled"; did.filled++;
        if (row) pos.push(numPos(row));
      }
      for (const p of pos.filter((p) => p.coin === coin && p.state === "open")) {
        if (ms(p.opened_at) >= t + M) continue;
        if (ms(p.opened_at) > t) continue; // a fill inside minute t is judged from the next minute
        if (t % H === 0) {
          const f = [...(fundingRows[coin] ?? [])].reverse().find((r) => ms(r.t) <= t && ms(r.t) > t - H);
          const rate = f ? n(f.funding) : null, px = f ? (n(f.idx) ?? n(f.mark) ?? mi.o) : mi.o;
          if (rate !== null) {
            const pay = sgn(p.direction) * rate * p.size * px;
            p.funding_usd = r4(p.funding_usd + pay);
            await x.db.update("cxbot_positions", `id=eq.${p.id}`, { funding_usd: p.funding_usd, updated_at: iso(now) });
            did.funded++;
          }
        }
        const liqHit = p.direction === "long" ? mi.l <= p.liq_price : mi.h >= p.liq_price;
        const ev = positionEvent(p.direction, p.stop, p.limit_px, mi);
        if (ev === "stop") {
          const fill = stopFill(p.direction, p.stop, next.o);
          const beyond = p.direction === "long" ? fill <= p.liq_price : fill >= p.liq_price;
          await closePos(x.db, p, beyond ? p.liq_price : fill, beyond ? "liquidation" : "stop", t + M, cfg.venue, false);
          p.state = "closed"; did.closed++;
        } else if (liqHit) {
          await closePos(x.db, p, p.liq_price, "liquidation", t + M, cfg.venue, false);
          p.state = "closed"; did.closed++;
        } else if (ev === "limit") {
          await closePos(x.db, p, p.limit_px, "limit", t + M, cfg.venue, true);
          p.state = "closed"; did.closed++;
        } else if (t + M - ms(p.opened_at) >= CXBOT_RULES.maxHoldMs) {
          await closePos(x.db, p, next.o, "server", t + M, cfg.venue, false);
          p.state = "closed"; did.closed++;
        }
      }
    }
    did.minutes++;
  }
  state.engineMinute = last;
  return did;
}

/** The five-minute snapshot and the stops: the day's first equity, −$20 a day and −$100 in all, each latched. */
export async function snapshot(x: Deps, cfg: Config, state: State) {
  const now = x.now, slot = floorTo(now, 5 * M);
  const open = await openPositions(x.db), closed = await closedPositions(x.db);
  const prices: Partial<Record<Coin, number>> = {};
  for (const coin of COINS) {
    const r = await lastRead(x.db, cfg.venue, coin);
    if (r?.bid != null && r?.ask != null) prices[coin] = (Number(r.bid) + Number(r.ask)) / 2;
  }
  const e = equityOf(cfg.budget_usd, closed, open, prices);
  const openRisk = open.reduce((s, p) => s + riskOf({ coin: p.coin, dir: p.direction, size: p.size, entry: p.entry, stop: p.stop }), 0);
  await x.db.upsert("cxbot_snapshots", [{
    slot: iso(slot), at: iso(now), equity_usd: r4(e.equity), realised_usd: r4(e.realised), unrealised_usd: r4(e.unrealised), fees_usd: r4(e.fees), funding_usd: r4(e.funding),
    open_risk_usd: r4(openRisk), positions: open.length,
  }], "slot");
  const day = iso(floorTo(now, DAY)).slice(0, 10);
  const dayOpen = state.dayOpen as { day: string; equity: number } | undefined;
  if (!dayOpen || dayOpen.day !== day) state.dayOpen = { day, equity: r4(e.equity) };
  const dOpen = (state.dayOpen as { equity: number }).equity;
  if (e.equity - dOpen <= -cfg.day_stop_usd) state.dayStop = state.dayStop && (state.dayStop as { day: string }).day === day ? state.dayStop : { day, at: iso(now) };
  if (e.equity - cfg.budget_usd <= -cfg.total_stop_usd && !state.totalStop) state.totalStop = { at: iso(now) };
  return e;
}

export const stopsOf = (state: State, now: number) => {
  const day = iso(floorTo(now, DAY)).slice(0, 10);
  return { dayStopHit: !!state.dayStop && (state.dayStop as { day: string }).day === day, totalStopHit: !!state.totalStop };
};

// ── the questions (prereg §5) ─────────────────────────────────────────────────────────────────────────────────────────

export type QuestionRow = Record<string, unknown> & { id: string; layer: "A" | "B"; coin: Coin; direction: Dir | null; deadline: string; state: string };
const Q_COLS = "id,layer,issued_at,deadline,coin,direction,sd24,stop_frac,limit_frac,hold_ms,start_at,entry,stop,limit_px,m,pm_slug,pm_market,pm_strike,pm_question,pm_end,pm_mid,pm_last,deribit_p,numbers,state,y,y_alt,how,resolved_at";

/** The server's numbers for a bracket (audit §6.2): m, costs, p*, the bar, and the outcome under the implied and the realised vol. */
export function bracketNumbers(o: {
  venue: Venue; coin: Coin; dir: Dir; entry: number; stop: number; limit: number; holdMs: number; entryType: "market" | "limit" | "stop";
  fundingPerHour: number | null; predictedPerHour: number | null; iv: number | null; rv: number | null;
}) {
  const br = bracketOf(o.dir, o.entry, o.stop, o.limit);
  if (!br.ok) return { error: br.why };
  const costs = costsOf({ venue: o.venue, dir: o.dir, entryType: o.entryType, dStop: br.dStop, dLimit: br.dLimit, m: br.m, fundingPerHour: o.fundingPerHour, predictedPerHour: o.predictedPerHour, holdMs: o.holdMs });
  const lev = leverageFor(o.coin, o.dir, br.dStop);
  return {
    m: r4(br.m), reward_risk: r4(br.rewardRisk), d_stop_pct: r4(br.dStop * 100), d_limit_pct: r4(br.dLimit * 100),
    costs_bps: { fee_in: costs.fee_in_bps, exit: costs.exit_bps, funding: costs.funding_bps, total: costs.total_bps }, p_star: costs.p_star, bar: costs.bar,
    iv: o.iv === null ? null : { vol: r4(o.iv), ...decompose(o.dir, o.entry, o.stop, o.limit, o.iv, o.holdMs) },
    rv: o.rv === null ? null : { vol: r4(o.rv), ...decompose(o.dir, o.entry, o.stop, o.limit, o.rv, o.holdMs) },
    leverage: lev, liq_price: lev === null ? null : r4(liquidationPrice(o.coin, o.dir, o.entry, lev)),
  };
}

type VolCtx = { sd24: Record<string, number | null>; predicted_per_hour?: Record<string, Record<string, number | null>> };
async function volCtx(db: Db): Promise<VolCtx | null> { return (await latestCtx<VolCtx>(db, "vol"))?.data ?? null; }
async function deribitCtx(db: Db): Promise<Record<"BTC" | "ETH", DeribitCcy> | null> { return (await latestCtx<Record<"BTC" | "ETH", DeribitCcy>>(db, "deribit"))?.data ?? null; }

/** Issue layer A at each four-hour boundary (paper mode only): both directions of each coin, the geometry from the one-day vol. */
export async function issueA(x: Deps, cfg: Config) {
  const now = x.now, q = CXBOT_QUESTIONS, b = floorTo(now, q.everyHours * H);
  if (cfg.mode !== "paper" || now >= b + q.answerMs) return 0;
  const vol = await volCtx(x.db), der = await deribitCtx(x.db);
  const rows = [];
  for (const coin of COINS) {
    const sd = n(vol?.sd24?.[coin]);
    const r = await lastRead(x.db, cfg.venue, coin);
    if (sd === null || !r || r.bid == null || r.ask == null) continue;
    const mid = (Number(r.bid) + Number(r.ask)) / 2;
    for (const dir of ["long", "short"] as Dir[]) {
      const g = assignedBracket(dir, mid, sd);
      const iv = coin === "SOL" || !der ? null : impliedAt(der[coin], now, now + q.answerMs + q.holdMs, null)?.iv ?? null;
      const numbers = bracketNumbers({ venue: cfg.venue, coin, dir, entry: mid, stop: g.stop, limit: g.limit, holdMs: q.holdMs, entryType: "market", fundingPerHour: n(r.funding), predictedPerHour: n(vol?.predicted_per_hour?.[coin]?.HlPerp), iv, rv: sd * Math.sqrt(365) });
      rows.push({
        id: `A-${iso(b).slice(0, 16)}-${coin}-${dir}`, layer: "A", issued_at: iso(now), deadline: iso(b + q.answerMs), coin, direction: dir, sd24: r4(sd),
        stop_frac: r4(g.dStop), limit_frac: r4(g.dLimit), hold_ms: q.holdMs, m: r4(g.m), numbers: { ...numbers, mid_at_issue: mid, note: "the bracket starts at the deadline, re-centred on that minute's open; its distances stay" }, state: "open",
      });
    }
  }
  if (!rows.length) return 0;
  const have = new Set((await x.db.select<{ id: string }>("cxbot_questions", `id=in.(${rows.map((r) => `"${r.id}"`).join(",")})&select=id`)).map((r) => r.id));
  const fresh = rows.filter((r) => !have.has(r.id));
  if (fresh.length) await x.db.insert("cxbot_questions", fresh, false);
  return fresh.length;
}

/** Issue layer B: at 24, 8 and 2 hours before each daily "above" question, the three strikes nearest 0.25, 0.50, 0.75. */
export async function issueB(x: Deps, cfg: Config) {
  const now = x.now, q = CXBOT_QUESTIONS;
  if (cfg.mode !== "paper") return 0;
  const pm = (await latestCtx<{ events: PmEvent[] }>(x.db, "polymarket"))?.data?.events ?? [];
  const rows = [];
  for (const ev of pm) {
    const end = ms(ev.end);
    for (const h of q.pmHorizonsH) {
      const t = end - h * H;
      if (!(now >= t && now < t + 10 * M)) continue;
      const used = new Set<string>();
      for (const target of q.pmTargets) {
        const pick = ev.markets.filter((m) => m.mid !== null && !used.has(m.id) && !m.closed).sort((a, b) => Math.abs((a.mid ?? 0) - target) - Math.abs((b.mid ?? 0) - target))[0];
        if (!pick) continue;
        used.add(pick.id);
        rows.push({
          id: `B-${ev.slug}-${h}h-${pick.strike}`.slice(0, 96), layer: "B", issued_at: iso(now), deadline: iso(now + q.pmAnswerMs), coin: ev.coin, pm_slug: ev.slug,
          pm_market: pick.id, pm_strike: pick.strike, pm_question: pick.question, pm_end: iso(end), numbers: { mid_at_issue: pick.mid, horizon_h: h, target }, state: "open",
        });
      }
    }
  }
  if (!rows.length) return 0;
  const have = new Set((await x.db.select<{ id: string }>("cxbot_questions", `id=in.(${rows.map((r) => `"${r.id}"`).join(",")})&select=id`)).map((r) => r.id));
  const fresh = rows.filter((r) => !have.has(r.id));
  if (fresh.length) await x.db.insert("cxbot_questions", fresh, false);
  return fresh.length;
}

/** At the deadline: a layer-A bracket starts from that minute's open; a layer-B strike records the market's mid, last trade and Deribit's digital. */
export async function startQuestions(x: Deps, cfg: Config) {
  const now = x.now;
  const due = await x.db.select<QuestionRow>("cxbot_questions", `state=eq.open&deadline=lte.${encodeURIComponent(iso(now))}&select=${Q_COLS}&order=deadline.asc&limit=100`);
  let started = 0;
  const pmCache = new Map<string, PmEvent | null>();
  for (const q of due) {
    if (q.layer === "A") {
      const t = floorTo(ms(q.deadline), M);
      const mi = (await minutesOf(x.db, cfg.venue, q.coin, t, t + M))[0];
      if (!mi) { if (now - t > 30 * M) await x.db.update("cxbot_questions", `id=eq.${q.id}&state=eq.open`, { state: "void", how: "no tape at the deadline" }); continue; }
      const dir = q.direction as Dir, d = Number(q.stop_frac), l = Number(q.limit_frac);
      const stop = dir === "long" ? mi.o * (1 - d) : mi.o * (1 + d), limit = dir === "long" ? mi.o * (1 + l) : mi.o * (1 - l);
      await x.db.update("cxbot_questions", `id=eq.${q.id}&state=eq.open`, { start_at: iso(t), entry: mi.o, stop: r4(stop), limit_px: r4(limit), state: "scoring" });
      started++;
    } else {
      const slug = String(q.pm_slug);
      if (!pmCache.has(slug)) pmCache.set(slug, await readPmEvent(x.reader, slug, q.coin as "BTC" | "ETH").catch(() => null));
      const ev = pmCache.get(slug);
      const m = ev?.markets.find((k) => k.id === q.pm_market);
      const der = await deribitCtx(x.db);
      const spot = (await latestCtx<Record<string, { mid: number | null }>>(x.db, "spot"))?.data;
      const scale = der && spot?.[q.coin]?.mid && der[q.coin as "BTC" | "ETH"]?.index ? Number(spot[q.coin].mid) / Number(der[q.coin as "BTC" | "ETH"].index) : 1;
      const dp = der ? digitalAbove(der[q.coin as "BTC" | "ETH"], now, ms(q.pm_end), Number(q.pm_strike), scale) : null;
      await x.db.update("cxbot_questions", `id=eq.${q.id}&state=eq.open`, { pm_mid: m?.mid ?? null, pm_last: m?.last ?? null, deribit_p: dp === null ? null : r4(dp), start_at: iso(now), state: "scoring" });
      started++;
    }
  }
  return started;
}

/** Resolve what can be: layer A on the tape (prereg §5's y), layer B on Polymarket's resolution. */
export async function resolveQuestions(x: Deps, cfg: Config) {
  const now = x.now;
  const open = await x.db.select<QuestionRow>("cxbot_questions", `state=eq.scoring&select=${Q_COLS}&order=deadline.asc&limit=200`);
  let resolved = 0;
  const pmCache = new Map<string, PmEvent | null>();
  for (const q of open) {
    if (q.layer === "A") {
      const start = ms(q.start_at), hold = Number(q.hold_ms);
      const mins = await minutesOf(x.db, cfg.venue, q.coin, start, Math.min(start + hold, floorTo(now, M)));
      const r = resolveOnTape({ dir: q.direction as Dir, start, stop: Number(q.stop), limit: Number(q.limit_px), holdMs: hold }, mins);
      if ("pending" in r) continue;
      await x.db.update("cxbot_questions", `id=eq.${q.id}&state=eq.scoring`, { y: r4(r.y), y_alt: r.yAlt ?? null, how: r.how, resolved_at: iso(now), state: "resolved" });
      resolved++;
    } else if (now > ms(q.pm_end) + 10 * M) {
      const slug = String(q.pm_slug);
      if (!pmCache.has(slug)) pmCache.set(slug, await readPmEvent(x.reader, slug, q.coin as "BTC" | "ETH").catch(() => null));
      const m = pmCache.get(slug)?.markets.find((k) => k.id === q.pm_market);
      if (!m || m.yes === null) continue;
      await x.db.update("cxbot_questions", `id=eq.${q.id}&state=eq.scoring`, { y: m.yes, how: "resolved", resolved_at: iso(now), state: "resolved" });
      resolved++;
    }
  }
  return resolved;
}

/** The minute: record, context, the book, the questions, the snapshot. Each part's fault is collected, never fatal to the rest. */
export async function tick(x: Deps, owner: string) {
  const errors: string[] = [];
  const cfg = await readConfig(x.db);
  const did: Record<string, unknown> = { mode: cfg.mode, venue: cfg.venue };
  try { did.record = (await record(x, cfg)).did; } catch (e) { errors.push(`record: ${(e as Error).message.slice(0, 160)}`); }
  if (!(await takeLease(x.db, owner, x.now, 45e3))) return { did, errors, busy: true };
  try {
    const state = await readState(x.db);
    errors.push(...await refreshCtx(x, cfg, state));
    const parts: Array<[string, () => Promise<unknown>]> = [
      ["book", () => cfg.mode === "paper" ? stepBook(x, cfg, state) : Promise.resolve(null)],
      ["issueA", () => issueA(x, cfg)], ["issueB", () => issueB(x, cfg)],
      ["start", () => startQuestions(x, cfg)], ["resolve", () => resolveQuestions(x, cfg)],
      ["snapshot", () => cfg.mode === "paper" ? snapshot(x, cfg, state) : Promise.resolve(null)],
    ];
    for (const [k, f] of parts) {
      try { did[k] = await f(); } catch (e) { errors.push(`${k}: ${(e as Error).message.slice(0, 160)}`); }
    }
    if (cfg.mode !== "paper") state.engineMinute = floorTo(x.now, M) - 2 * M;
    await writeState(x.db, state, x.now);
  } finally {
    await dropLease(x.db, owner);
  }
  return { did, errors, busy: false };
}

// ── the agent's actions ───────────────────────────────────────────────────────────────────────────────────────────────

type Out = { status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown>): Out => ({ status: 200, body });

/** A coin's market state for the rules: a fresh book read when given, else the recorder's newest. */
export async function marketState(x: Deps, cfg: Config, coin: Coin, book: Book | null) {
  const r = await lastRead(x.db, cfg.venue, coin);
  const vol = await volCtx(x.db);
  const bid = book?.bids[0]?.[0] ?? n(r?.bid), ask = book?.asks[0]?.[0] ?? n(r?.ask);
  if (bid === null || ask === null) return null;
  const mid = (bid + ask) / 2;
  const readAt = book ? x.now : ms(r?.fetched_at);
  return {
    bid, ask, mid, spreadBps: ((ask - bid) / mid) * 1e4, tapeAgeMs: Number.isFinite(readAt) ? x.now - readAt : Infinity,
    sd24: n(vol?.sd24?.[coin]), fundingPerHour: n(r?.funding), predictedPerHour: n(vol?.predicted_per_hour?.[coin]?.HlPerp) ?? n(r?.funding),
    mark: n(r?.mark), index: n(r?.idx), oi: n(r?.oi), premium: n(r?.premium), recordedAt: r?.t ?? null,
  };
}

const depthBands = (b: Book | null, mid: number) => {
  if (!b) return null;
  const band = (w: number) => ({
    bid_usd: Math.round(b.bids.filter(([p]) => p >= mid * (1 - w / 1e4)).reduce((s, [p, q]) => s + p * q, 0)),
    ask_usd: Math.round(b.asks.filter(([p]) => p <= mid * (1 + w / 1e4)).reduce((s, [p, q]) => s + p * q, 0)),
  });
  return { within_5bps: band(5), within_10bps: band(10), within_20bps: band(20) };
};

export async function accountView(x: Deps) {
  const cfg = await readConfig(x.db), state = await readState(x.db);
  const open = await openPositions(x.db), closed = await closedPositions(x.db), rest = await restingOrders(x.db);
  const prices: Partial<Record<Coin, number>> = {};
  for (const coin of COINS) { const r = await lastRead(x.db, cfg.venue, coin); if (r?.bid != null && r?.ask != null) prices[coin] = (Number(r.bid) + Number(r.ask)) / 2; }
  const e = equityOf(cfg.budget_usd, closed, open, prices);
  const stops = stopsOf(state, x.now);
  const book = bookOf(open, rest);
  const today = iso(floorTo(x.now, DAY));
  const ordersToday = (await x.db.select<{ id: number }>("cxbot_orders", `kind=eq.open&created_at=gte.${encodeURIComponent(today)}&select=id`)).length;
  const dayOpen = (state.dayOpen as { day: string; equity: number } | undefined);
  return {
    now: iso(x.now), mode: cfg.mode, venue: cfg.venue, started_at: cfg.started_at,
    gates: { global_pause: await globalPaused(x.db), day_stop: stops.dayStopHit, total_stop: stops.totalStopHit, calendar_ends: "2026-12-31" },
    budget: {
      budget_usd: cfg.budget_usd, equity_usd: r2(e.equity), pnl_total_usd: r2(e.equity - cfg.budget_usd),
      pnl_today_usd: dayOpen && dayOpen.day === today.slice(0, 10) ? r2(e.equity - dayOpen.equity) : null,
      realised_usd: r2(e.realised), unrealised_usd: r2(e.unrealised), fees_usd: r2(e.fees), funding_usd: r2(e.funding),
      risk_per_trade_usd: CXBOT_RULES.riskPerTradeFrac * cfg.budget_usd, open_risk_usd: r2(book.reduce((s, b) => s + riskOf(b), 0)),
      open_risk_long_usd: r2(book.filter((b) => b.dir === "long").reduce((s, b) => s + riskOf(b), 0)),
      open_risk_short_usd: r2(book.filter((b) => b.dir === "short").reduce((s, b) => s + riskOf(b), 0)),
      day_stop_usd: -cfg.day_stop_usd, total_stop_usd: -cfg.total_stop_usd, orders_today: ordersToday, max_orders_day: cfg.max_orders_day,
      can_open: cfg.mode === "paper" && !stops.dayStopHit && !stops.totalStopHit,
    },
    positions: open.map((p) => ({
      position_id: p.id, coin: p.coin, direction: p.direction, size: p.size, entry: p.entry, stop: p.stop, limit: p.limit_px, leverage: p.leverage, liq_price: p.liq_price,
      opened_at: p.opened_at, server_closes_at: iso(ms(p.opened_at) + CXBOT_RULES.maxHoldMs), funding_usd: p.funding_usd, fees_usd: p.fee_open_usd,
      pnl_usd: prices[p.coin] ? r2(pnlAt(p, prices[p.coin]!, 0)) : null,
    })),
    resting: rest.map((o) => ({ order_id: o.id, coin: o.coin, direction: o.direction, entry_type: o.entry_type, entry: o.entry, stop: o.stop, limit: o.limit_px, size: o.size, good_till: o.good_till })),
    next_releases: CXBOT_RELEASE_MS.filter((t) => t > x.now - CXBOT_RULES.blackoutTrailMs).slice(0, 6).map((t) => ({ at: iso(t), no_open_from: iso(t - CXBOT_RULES.blackoutLeadMs), no_open_until: iso(t + CXBOT_RULES.blackoutTrailMs) })),
  };
}

export async function marketsView(x: Deps) {
  const cfg = await readConfig(x.db);
  const tape = tapeOf(cfg.venue, x.reader);
  const vol = await volCtx(x.db);
  const out = [];
  for (const coin of COINS) {
    const book = await tape.book(coin).catch(() => null);
    const s = await marketState(x, cfg, coin, book);
    const last = (await x.db.select<TapeRow>("cxbot_tape", `venue=eq.${cfg.venue}&coin=eq.${coin}&c=not.is.null&select=t,o,h,l,c&order=t.desc&limit=1`))[0] ?? null;
    out.push({
      coin, venue: cfg.venue, bid: s?.bid ?? null, ask: s?.ask ?? null, mid: s?.mid ?? null, spread_bps: s ? r4(s.spreadBps) : null, depth: s ? depthBands(book, s.mid) : null,
      last_minute: last, mark: s?.mark ?? null, index: s?.index ?? null, sd24: s?.sd24 ?? null, sd1h: n(vol?.sd24?.[coin]) === null ? null : r4(Number(vol!.sd24[coin]) / Math.sqrt(24)),
      funding_per_hour: s?.fundingPerHour ?? null, predicted_per_hour: vol?.predicted_per_hour?.[coin] ?? null, open_interest: s?.oi ?? null, premium: s?.premium ?? null,
      tape_age_s: s ? Math.round(s.tapeAgeMs / 1000) : null,
      open_blocked_by: s ? [inBlackout(x.now) ? "blackout" : null, s.spreadBps > CXBOT_RULES.maxSpreadBps[coin] ? "wide_book" : null, s.sd24 === null ? "stale_tape" : null].filter(Boolean) : ["stale_tape"],
    });
  }
  return { now: iso(x.now), markets: out };
}

export async function contextView(x: Deps) {
  const kinds = ["deribit", "polymarket", "spot", "vol", "liquidations", "flows", "stablecoins"];
  const out: Record<string, unknown> = { now: iso(x.now) };
  for (const k of kinds) out[k] = await latestCtx(x.db, k);
  const der = (out.deribit as { data: Record<string, DeribitCcy> } | null)?.data;
  if (der) out.deribit_forward = Object.fromEntries(Object.entries(der).map(([c, d]) => [c, forwardVols(d)]));
  out.calendar = CXBOT_RELEASE_MS.filter((t) => t > x.now - DAY).map((t) => iso(t));
  return out;
}

/** `?action=quote`: the server's numbers for any bracket (audit §6.2), and every rule it would break as a market open. */
export async function quoteView(x: Deps, q: URLSearchParams): Promise<Out> {
  const errs: string[] = [];
  const coin = q.get("coin"), dir = q.get("direction");
  const num = (k: string) => { const v = Number(q.get(k)); if (!Number.isFinite(v) || v <= 0) errs.push(`${k}: a positive number`); return v; };
  if (!coin || !(COINS as readonly string[]).includes(coin)) errs.push("coin: BTC, ETH or SOL");
  if (dir !== "long" && dir !== "short") errs.push("direction: long or short");
  const entry = num("entry"), stop = num("stop"), limit = num("limit");
  const holdH = q.get("hold_h") === null ? 72 : Number(q.get("hold_h"));
  if (!(holdH > 0 && holdH <= 168)) errs.push("hold_h: 1 to 168 hours (default 72)");
  const p = q.get("p") === null ? null : Number(q.get("p"));
  if (p !== null && !(p > 0 && p < 1)) errs.push("p: strictly between 0 and 1 (optional)");
  if (errs.length) return { status: 422, body: { error: "invalid", errors: errs } };
  const cfg = await readConfig(x.db);
  const c = coin as Coin, d = dir as Dir;
  const s = await marketState(x, cfg, c, await tapeOf(cfg.venue, x.reader).book(c).catch(() => null));
  const der = await deribitCtx(x.db);
  const holdMs = holdH * H;
  const iv = c === "SOL" || !der ? null : impliedAt(der[c], x.now, x.now + holdMs, null)?.iv ?? null;
  const numbers = bracketNumbers({ venue: cfg.venue, coin: c, dir: d, entry, stop, limit, holdMs, entryType: "market", fundingPerHour: s?.fundingPerHour ?? null, predictedPerHour: s?.predictedPerHour ?? null, iv, rv: s?.sd24 ? s.sd24 * Math.sqrt(365) : null });
  if ("error" in numbers) return { status: 422, body: { error: "invalid", errors: [String(numbers.error)] } };
  const pm = (await latestCtx<{ events: PmEvent[] }>(x.db, "polymarket"))?.data?.events ?? [];
  const near = pm.filter((e) => e.coin === c).flatMap((e) => e.markets.filter((m) => [stop, limit].some((lv) => Math.abs(m.strike / lv - 1) <= 0.005)).map((m) => ({ slug: e.slug, end: e.end, strike: m.strike, mid: m.mid, last: m.last })));
  const spot = (await latestCtx<Record<string, { mid: number | null }>>(x.db, "spot"))?.data;
  const scale = der && c !== "SOL" && spot?.[c]?.mid && der[c]?.index ? Number(spot[c].mid) / Number(der[c].index) : 1;
  const digitals = der && c !== "SOL" ? [stop, limit].map((K) => ({ level: K, p_above_at_hold_end: (() => { const v = digitalAbove(der[c], x.now, x.now + holdMs, K, scale); return v === null ? null : r4(v); })() })) : null;
  const state = await readState(x.db), stops = stopsOf(state, x.now);
  const open = await openPositions(x.db), rest = await restingOrders(x.db), closed = await closedPositions(x.db);
  const eq = equityOf(cfg.budget_usd, closed, open, {}).equity;
  const br = bracketOf(d, entry, stop, limit);
  const size = br.ok && p !== null ? sizeMax({ coin: c, entry, dStop: br.dStop, costs: Number(numbers.costs_bps.total) / 1e4, p, rr: br.rewardRisk, budget: cfg.budget_usd, equity: eq }) : null;
  const rules = s && p !== null && size !== null && size > 0 ? openRefusals({ coin: c, dir: d, entryType: "market", entry, stop, limit, size, p, category: "N", eventAt: null, goodTill: null }, {
    nowMs: x.now, venue: cfg.venue, market: s, book: bookOf(open, rest), budget: cfg.budget_usd, equity: eq, ordersToday: 0, ordersLastMinute: 0, maxOrdersDay: cfg.max_orders_day, ...stops,
  }).refusals.filter((r) => r.rule !== "level" && r.rule !== "slippage") : null;
  return ok({
    now: iso(x.now), coin: c, direction: d, entry, stop, limit, hold_h: holdH, ...numbers, polymarket_near: near, deribit_digitals: digitals,
    size_max: size, kelly_risk_usd: p !== null && br.ok ? r2(kellyRisk(p, br.rewardRisk, eq)) : null, market: s ? { bid: s.bid, ask: s.ask, sd24: s.sd24, funding_per_hour: s.fundingPerHour } : null,
    refusals_as_market_open: rules, note: "m is the market's own expected outcome; p must reach `bar` for an own open",
  });
}

export async function questionsView(x: Deps) {
  const rows = await x.db.select<QuestionRow>("cxbot_questions", `state=eq.open&deadline=gt.${encodeURIComponent(iso(x.now))}&select=${Q_COLS}&order=deadline.asc&limit=50`);
  const ans = rows.length ? new Set((await x.db.select<{ question_id: string }>("cxbot_forecasts", `question_id=in.(${rows.map((r) => `"${r.id}"`).join(",")})&select=question_id`)).map((r) => r.question_id)) : new Set<string>();
  return {
    now: iso(x.now),
    questions: rows.map((q) => q.layer === "A"
      ? { question_id: q.id, layer: "A", coin: q.coin, direction: q.direction, deadline: q.deadline, answered: ans.has(q.id), stop_pct: r4(Number(q.stop_frac) * 100), limit_pct: r4(Number(q.limit_frac) * 100), hold_h: Number(q.hold_ms) / H, m: n(q.m), numbers: q.numbers }
      : { question_id: q.id, layer: "B", coin: q.coin, deadline: q.deadline, answered: ans.has(q.id), question: q.pm_question, strike: n(q.pm_strike), resolves_at: q.pm_end, slug: q.pm_slug, numbers: q.numbers }),
  };
}

export async function forecast(x: Deps, answers: Answer[], raw: unknown[]): Promise<Out> {
  const ids = answers.map((a) => a.question_id);
  const qs = await x.db.select<QuestionRow>("cxbot_questions", `id=in.(${ids.map((i) => `"${i}"`).join(",")})&select=id,deadline,state`);
  const have = new Set((await x.db.select<{ question_id: string }>("cxbot_forecasts", `question_id=in.(${ids.map((i) => `"${i}"`).join(",")})&select=question_id`)).map((r) => r.question_id));
  const refusals: Refusal[] = [];
  const rows: Array<Record<string, unknown>> = [];
  answers.forEach((a, i) => {
    const q = qs.find((k) => k.id === a.question_id);
    if (!q) { refusals.push({ rule: "forecast_unknown", why: `${a.question_id}: no such question` }); return; }
    if (have.has(a.question_id)) { refusals.push({ rule: "forecast_duplicate", why: `${a.question_id}: already answered` }); return; }
    if (ms(q.deadline) <= x.now || q.state !== "open") { refusals.push({ rule: "forecast_window", why: `${a.question_id}: its deadline ${q.deadline} has passed` }); return; }
    rows.push({ question_id: a.question_id, p: a.p, reason: a.reason, sources: a.sources, raw: raw[i] });
  });
  if (refusals.length) return { status: 422, body: { error: "refused", refusals } };
  await x.db.insert("cxbot_forecasts", rows, false);
  return ok({ ok: true, stored: rows.length });
}

const decisionRow = (d: Decision, mBase: number | null, raw: unknown) => ({
  id: d.id, ts: d.ts, action: d.action, category: d.category, coin: d.coin, direction: d.direction, size: d.size, entry: d.entry, stop: d.stop, limit_px: d.limit, p: d.p,
  m_base: mBase, event_at: d.event_at, position_id: d.position_id, sources: d.sources, reason: d.reason, invalidation: d.invalidation, raw,
});

async function duplicateOf(db: Db, id: string): Promise<Out | null> {
  const o = (await db.select<Record<string, unknown>>("cxbot_orders", `decision_id=eq.${encodeURIComponent(id)}&select=id,state,fill_price,position_id`))[0];
  if (o) return ok({ duplicate: true, order: o });
  if ((await db.select("cxbot_decisions", `id=eq.${encodeURIComponent(id)}&select=id`)).length) return { status: 409, body: { error: "that decision id is a journal row already; use a new id" } };
  return null;
}

/** `?action=order`: an open, from its decision; checked, journalled, then filled on paper (or, in dry-run, answered with the fill it would get). */
export async function placeOrder(x: Deps, body: unknown, owner: string, ordersLastMinute: number): Promise<Out> {
  if (!isObj(body) || !isObj(body.decision)) return { status: 422, body: { error: "invalid", errors: ["body: {decision, entry_type, good_till?}"] } };
  for (const k of Object.keys(body)) if (!["decision", "entry_type", "good_till"].includes(k)) return { status: 422, body: { error: "invalid", errors: [`${k}: unknown field`] } };
  const errors: string[] = [];
  const d = decisionOf(body.decision, "decision", x.now, errors);
  const et = body.entry_type ?? "market";
  if (!["market", "limit", "stop"].includes(String(et))) errors.push("entry_type: market, limit or stop");
  const gt = body.good_till === undefined || body.good_till === null ? null : Date.parse(String(body.good_till));
  if (gt !== null && !Number.isFinite(gt)) errors.push("good_till: an ISO time");
  if (d && d.action !== "open") errors.push("decision.action: open");
  if (errors.length || !d) return { status: 422, body: { error: "invalid", errors } };
  const dup = await duplicateOf(x.db, d.id);
  if (dup) return dup;
  if (!(await takeLease(x.db, owner, x.now))) return { status: 409, body: { error: "busy", detail: "the minute's engine holds the book; send the same body again in 5–10 seconds" } };
  try {
    const cfg = await readConfig(x.db), state = await readState(x.db);
    const coin = d.coin!, dir = d.direction!;
    const book = await tapeOf(cfg.venue, x.reader).book(coin).catch(() => null);
    const s = await marketState(x, cfg, coin, book);
    if (!s) return { status: 503, body: { error: "tape_stale", detail: "the market could not be read" } };
    const open = await openPositions(x.db), rest = await restingOrders(x.db), closed = await closedPositions(x.db);
    const prices = { [coin]: s.mid } as Partial<Record<Coin, number>>;
    const eq = equityOf(cfg.budget_usd, closed, open, prices).equity;
    const today = iso(floorTo(x.now, DAY));
    const ordersToday = (await x.db.select<{ id: number }>("cxbot_orders", `kind=eq.open&created_at=gte.${encodeURIComponent(today)}&select=id`)).length;
    const req: OpenRequest = { coin, dir, entryType: et as OpenRequest["entryType"], entry: d.entry!, stop: d.stop!, limit: d.limit!, size: d.size!, p: d.p!, category: d.category as "E" | "R" | "N", eventAt: d.event_at ? Date.parse(d.event_at) : null, goodTill: gt };
    const v = openRefusals(req, { nowMs: x.now, venue: cfg.venue, market: s, book: bookOf(open, rest), budget: cfg.budget_usd, equity: eq, ordersToday, ordersLastMinute, maxOrdersDay: cfg.max_orders_day, ...stopsOf(state, x.now) });
    if (await globalPaused(x.db)) v.refusals.unshift({ rule: "global_pause", why: "the project's global pause is on" });
    if (v.refusals.length) return { status: 422, body: { error: "refused", refusals: v.refusals, checks: v.checks } };
    // A market fill walks the book read now, at the far side, plus a tick (§7.3).
    const levels = dir === "long" ? (book?.asks ?? []) : (book?.bids ?? []);
    const fill = et === "market" ? walkBook(levels, req.size, book?.tick ?? 0, dir === "long") : null;
    if (et === "market" && (fill === null || (dir === "long" ? fill > req.entry : fill < req.entry))) {
      return { status: 422, body: { error: "refused", refusals: [{ rule: "slippage", why: `the book would fill at ${fill ?? "nothing"}, past your worst price ${req.entry}` }], checks: v.checks } };
    }
    await x.db.insert("cxbot_decisions", [decisionRow(d, n(v.checks.m), body.decision)], false);
    const lev = n(v.checks.leverage);
    const [o] = await x.db.insert<Record<string, unknown>>("cxbot_orders", [{
      mode: cfg.mode, decision_id: d.id, kind: "open", coin, direction: dir, entry_type: et, size: req.size, entry: req.entry, stop: req.stop, limit_px: req.limit, p: req.p,
      good_till: gt === null ? null : iso(gt), state: cfg.mode === "dry_run" ? "dry_run" : et === "market" ? "filled" : "resting", leverage: lev, checks: { ...v.checks, bid: s.bid, ask: s.ask, would_fill: fill },
    }]);
    if (cfg.mode === "dry_run") return ok({ sent: false, would_fill: fill, state: "dry_run", checks: v.checks, order_id: o?.id ?? null });
    if (et === "market" && o) {
      const pos = await openPos(x.db, numOrd(o), fill!, x.now, cfg.venue, false);
      return ok({ sent: true, state: "filled", fill_price: fill, position_id: pos?.id ?? null, leverage: lev, liq_price: v.checks.liq_price, checks: v.checks });
    }
    return ok({ sent: true, state: "resting", order_id: o?.id ?? null, checks: v.checks });
  } finally {
    await dropLease(x.db, owner);
  }
}

/** `?action=close`: a position of the bot's, at the touch through the book now, a taker. */
export async function closePosition(x: Deps, body: unknown, owner: string): Promise<Out> {
  if (!isObj(body) || !isObj(body.decision)) return { status: 422, body: { error: "invalid", errors: ["body: {decision}"] } };
  const errors: string[] = [];
  const d = decisionOf(body.decision, "decision", x.now, errors);
  if (d && d.action !== "close") errors.push("decision.action: close");
  if (errors.length || !d) return { status: 422, body: { error: "invalid", errors } };
  const dup = await duplicateOf(x.db, d.id);
  if (dup) return dup;
  if (!(await takeLease(x.db, owner, x.now))) return { status: 409, body: { error: "busy" } };
  try {
    const cfg = await readConfig(x.db);
    const p = (await openPositions(x.db)).find((k) => k.id === d.position_id);
    if (!p) return { status: 422, body: { error: "refused", refusals: [{ rule: "not_held", why: "no open position of yours has that id" }] } };
    const book = await tapeOf(cfg.venue, x.reader).book(p.coin).catch(() => null);
    const price = book ? walkBook(p.direction === "long" ? book.bids : book.asks, p.size, book.tick, p.direction !== "long") : null;
    if (price === null) return { status: 503, body: { error: "tape_stale", detail: "the book could not be read; the stop and limit stand" } };
    await x.db.insert("cxbot_decisions", [decisionRow({ ...d, coin: p.coin, direction: p.direction }, null, body.decision)], false);
    await x.db.insert("cxbot_orders", [{ mode: cfg.mode, decision_id: d.id, kind: "close", coin: p.coin, direction: p.direction, size: p.size, position_id: p.id, state: "done", fill_price: price, filled_at: iso(x.now) }], false);
    const pnl = await closePos(x.db, p, price, "agent", x.now, cfg.venue, false);
    return ok({ state: "closed", close_price: price, pnl_usd: r2(pnl) });
  } finally {
    await dropLease(x.db, owner);
  }
}

/** `?action=amend`: a stop only toward the price (never through it), a limit on the profit side. */
export async function amendPosition(x: Deps, body: unknown, owner: string): Promise<Out> {
  if (!isObj(body) || !isObj(body.decision)) return { status: 422, body: { error: "invalid", errors: ["body: {decision}"] } };
  const errors: string[] = [];
  const d = decisionOf(body.decision, "decision", x.now, errors);
  if (d && d.action !== "amend") errors.push("decision.action: amend");
  if (errors.length || !d) return { status: 422, body: { error: "invalid", errors } };
  const dup = await duplicateOf(x.db, d.id);
  if (dup) return dup;
  if (!(await takeLease(x.db, owner, x.now))) return { status: 409, body: { error: "busy" } };
  try {
    const cfg = await readConfig(x.db);
    const p = (await openPositions(x.db)).find((k) => k.id === d.position_id);
    if (!p) return { status: 422, body: { error: "refused", refusals: [{ rule: "not_held", why: "no open position of yours has that id" }] } };
    const s = await marketState(x, cfg, p.coin, null);
    const refusals: Refusal[] = [];
    const up = p.direction === "long";
    if (d.stop !== null) {
      if (up ? d.stop < p.stop : d.stop > p.stop) refusals.push({ rule: "stop_wider", why: "a stop may only move toward the price" });
      if (s && (up ? d.stop >= s.bid : d.stop <= s.ask)) refusals.push({ rule: "stop_through", why: "the stop would already be through the price" });
    }
    if (d.limit !== null && s && (up ? d.limit <= s.ask : d.limit >= s.bid)) refusals.push({ rule: "limit_through", why: "the limit stays on the profit side of the price" });
    if (refusals.length) return { status: 422, body: { error: "refused", refusals } };
    await x.db.insert("cxbot_decisions", [decisionRow({ ...d, coin: p.coin, direction: p.direction }, null, body.decision)], false);
    await x.db.insert("cxbot_orders", [{ mode: cfg.mode, decision_id: d.id, kind: "amend", coin: p.coin, direction: p.direction, stop: d.stop, limit_px: d.limit, position_id: p.id, state: "done" }], false);
    await x.db.update("cxbot_positions", `id=eq.${p.id}&state=eq.open`, { ...(d.stop !== null ? { stop: d.stop } : {}), ...(d.limit !== null ? { limit_px: d.limit } : {}), updated_at: iso(x.now) });
    return ok({ state: "amended", position_id: p.id, stop: d.stop ?? p.stop, limit: d.limit ?? p.limit_px });
  } finally {
    await dropLease(x.db, owner);
  }
}

/** `?action=cancel` (`order_id`) or `?action=cancel_all`: the bot's resting orders. */
export async function cancelOrders(x: Deps, body: unknown, all: boolean, owner: string): Promise<Out> {
  const b = isObj(body) ? body : {};
  const errors: string[] = [];
  const d = isObj(b.decision) ? decisionOf(b.decision, "decision", x.now, errors) : null;
  if (d && d.action !== "cancel") errors.push("decision.action: cancel");
  const id = Number(b.order_id);
  if (!all && !(Number.isInteger(id) && id > 0)) errors.push("order_id: a resting order's id");
  if (errors.length) return { status: 422, body: { error: "invalid", errors } };
  if (!(await takeLease(x.db, owner, x.now))) return { status: 409, body: { error: "busy" } };
  try {
    const rest = (await restingOrders(x.db)).filter((o) => all || o.id === id);
    if (!all && !rest.length) return { status: 422, body: { error: "refused", refusals: [{ rule: "not_held", why: "no resting order of yours has that id" }] } };
    if (d && !(await x.db.select("cxbot_decisions", `id=eq.${encodeURIComponent(d.id)}&select=id`)).length) await x.db.insert("cxbot_decisions", [decisionRow(d, null, b.decision)], false);
    for (const o of rest) await x.db.update("cxbot_orders", `id=eq.${o.id}&state=eq.resting`, { state: "cancelled", updated_at: iso(x.now) });
    return ok({ cancelled: rest.map((o) => o.id) });
  } finally {
    await dropLease(x.db, owner);
  }
}

export const calendarView = (now: number) => ({
  now: iso(now), listed_until: "2026-12-31", calendar_ends_ms: CXBOT_CALENDAR_UNTIL_MS,
  releases: CXBOT_RELEASE_MS.filter((t) => t > now - CXBOT_RULES.blackoutTrailMs).map((t) => ({ at: iso(t), no_open_from: iso(t - CXBOT_RULES.blackoutLeadMs), no_open_until: iso(t + CXBOT_RULES.blackoutTrailMs) })),
});

