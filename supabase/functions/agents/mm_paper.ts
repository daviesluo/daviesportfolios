// "Crypto quotes XRP/GBP" (migration 0192; Davies, 2026-10-31 ~11:55 UTC: "好 再研究下确保策略一切最优后就开做然后上testing"): the XRP/GBP
// maker as a real-time paper test, pre-registered in docs/agents/reviews/2026-10-31-xrp-gbp-paper-prereg.md. The design is
// reviews/2026-10-31-one-second-loop-architecture.md §4.4: paper is one call a minute that replays the closed minutes second by
// second through the same rule a live loop would run (mm_core.ts, rule.py's port).
//
// EACH CALL (`agents?action=mm`, second 12 of its minute, 0192):
//   1. RECORDS, keyless and public, into its own tables:
//      - Binance's one-second XRPUSDT klines of every minute closed since its cursor (`MM_BN_MAX_S` seconds a call at most, so
//        an outage is caught up sixteen minutes a call), one row a minute (`agent_mm_inputs.bn`, the close of each second);
//      - Revolut X's UK XRP-GBP prints from `MM_PRINT_OVERLAP_MS` before what it last covered, `MM_PRINT_WINDOW_MS` a call at most,
//        each kept once by the venue's id (`agent_mm_prints`);
//      - Revolut X's XRP-GBP book, `MM_BOOK_LEVELS` levels a side, and Coinbase's USDT-USD price, once, into the row of the
//        minute it reads them in.
//      Revolut X's public endpoints allow one request a second an address (reference §2): its reads go `MM_RX_GAP_MS` apart.
//   2. DECIDES, for each arm, every minute from its last to `MM_LAG_MINUTES` behind the clock (and no further than Binance and
//      Revolut X's prints are recorded), `MM_MAX_MINUTES` at most a call: mm_core's rule on
//        F(s) = Binance's close of second s × USDT/USD ÷ GBP/USD, the rates of s's minute: USDT/USD the newest Coinbase read
//        made by the minute's start (`MM_USDT_FRESH_MS`), GBP/USD the FX recorder's newest TrueFX read, or marked Kraken
//        read, arrived by the minute's start (`fx_ticks`, 0172; `MM_FX_FRESH_MS`);
//      a second whose F, or the second before's, cannot be formed is stale: nothing rests (mm_core). The arms differ only in
//      money (`MM_ARMS`): £600 at £200 a quote is the one the pre-registration judges and the page shows; £120 and £1,200 are
//      recorded beside it. Each starts at the first minute recorded and quotes from `startAt`: the first 00:00 UTC at or after
//      `MM_PLANNED_START` with `MM_WARM_MS` of record before it (the basis is three hours of prints).
//   3. WRITES each arm's minutes, fills and round trips (first in, first out: each sale against the oldest coin), then its state.
//      Every row is upserted on its natural key and the state carries its last minute, so a call run twice in its minute changes
//      nothing (retry true).
// It holds no key, places nothing and reads nothing of LIVE. A fault goes to `ops_errors` as `agents.mm` when it first appears
// and at most hourly while it lasts (index.ts `runMmAction`; `faultKey`, `reportDue`).
//
// What the paper does not test (the pre-registration's §7): queue position beyond the tape's own (a print at our price is the
// queue ahead of us and never fills us), latency beyond one second, anyone's reaction to our quotes, and identical prints the
// replay's tape deduplicated (the paper keeps every id).

import type { Db } from "./db.ts";
import { MM_CARD, type MmParams, type MmPrint, type MmState, mmNew, mmRun, mmSortPrints } from "./mm_core.ts";
import { faultKey, reportDue } from "./pm_book_rec.ts";

export const MM_ID = "xrpgbp";
export const MM_NAME = "Crypto quotes XRP/GBP";
export const MM_BOOK = "XRP-GBP";
export const MM_BN_SYMBOL = "XRPUSDT";
/** The arms: their money and quote size, a third of it (the card's £200 on £600). `p600` is judged and on the page. */
export const MM_ARMS = [
  { arm: "p600", capGbp: 600, qGbp: 200 },
  { arm: "p120", capGbp: 120, qGbp: 40 },
  { arm: "p1200", capGbp: 1200, qGbp: 400 },
] as const;
export type MmArm = typeof MM_ARMS[number];
export type MmArmId = MmArm["arm"];
/** The earliest start: 2026-11-01 00:00 UTC. */
export const MM_PLANNED_START = Date.UTC(2026, 10, 1);
/** The record a start needs before it: the basis's three hours. */
export const MM_WARM_MS = 3 * 3600e3;
/** The minutes decided trail the clock by this many, so a print published late is in before its minute is stepped. */
export const MM_LAG_MINUTES = 2;
export const MM_MAX_MINUTES = 30;
export const MM_LEASE = "mm";
export const MM_LEASE_MS = 25e3;
export const MM_TABLES = {
  inputs: "agent_mm_inputs", prints: "agent_mm_prints", state: "agent_mm_state", minutes: "agent_mm_minutes", fills: "agent_mm_fills",
  trips: "agent_mm_trips", days: "agent_mm_days",
} as const;
export const MM_RX_HOST = "https://revx.revolut.com";
export const MM_BN_HOST = "https://data-api.binance.vision";
export const MM_CB_HOST = "https://api.exchange.coinbase.com";
export const MM_TIMEOUT_MS = 6_000;
export const MM_RX_GAP_MS = 1_100;
export const MM_BN_MAX_S = 960;
export const MM_PRINT_OVERLAP_MS = 120e3;
export const MM_PRINT_WINDOW_MS = 15 * 60e3;
export const MM_PRINT_PAGES = 5;
export const MM_BOOK_LEVELS = 5;
/** A first call starts its record this far back. */
export const MM_FIRST_BACK_MS = 10 * 60e3;
export const MM_USDT_FRESH_MS = 30 * 60e3;
export const MM_FX_FRESH_MS = 10 * 60e3;
/** Revolut X's taker fee, which only the stop pays (mm_core folds it into the stop's price). */
export const MM_STOP_FEE = 0.0009;

const M = 60e3;
const iso = (ms: number) => new Date(ms).toISOString();
const msOf = (v: unknown) => (typeof v === "number" ? v : Date.parse(String(v)));
const minuteOf = (ms: number) => Math.floor(ms / M) * M;
const enc = (ms: number) => encodeURIComponent(iso(ms));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** The parameters of an arm: the card with its money. */
export const mmParamsOf = (a: MmArm): MmParams => ({ ...MM_CARD, capGbp: a.capGbp, qGbp: a.qGbp });

/** When an arm whose record starts at `firstMinute` quotes from: the first 00:00 UTC at or after the planned start with the warm-up before it. */
export function mmStartFor(firstMinute: number): number {
  const need = Math.max(MM_PLANNED_START, firstMinute + MM_WARM_MS);
  const day = 86400e3;
  return Math.ceil(need / day) * day;
}

// ------------------------------------------------------------------------------------------------------------- record

export type RecState = { bnNext?: number; printsCovered?: number; firstMinute?: number; fault?: { key: string; at: number } };
export type InputRow = { book: string; minute: string; bn?: Array<number | null> | null; usdt?: number | null; usdt_at?: string | null;
  bids?: unknown; asks?: unknown; book_at?: string | null };
export type PrintRow = { book: string; id: string; ts: string; price: number; qty: number; side: "buy" | "sell" };

async function getJson(f: typeof fetch, url: string): Promise<unknown> {
  const res = await f(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(MM_TIMEOUT_MS) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}: ${text.slice(0, 120)}`);
  return JSON.parse(text);
}

/**
 * Binance's klines as the minute rows they fill: every minute of [fromS, toS] (whole minutes) with the close of each second
 * served, null where none was. A minute Binance served nothing of is still a row, all null: its seconds are stale, not waited for.
 */
export function bnRows(klines: unknown, fromS: number, toS: number): InputRow[] {
  const close = new Map<number, number>();
  for (const k of Array.isArray(klines) ? klines : []) {
    if (!Array.isArray(k)) continue;
    const s = Math.floor(Number(k[0]) / 1000), c = Number(k[4]);
    if (Number.isFinite(s) && c > 0) close.set(s, c);
  }
  const out: InputRow[] = [];
  for (let m = fromS; m <= toS; m += 60) out.push({ book: MM_BOOK, minute: iso(m * 1000), bn: Array.from({ length: 60 }, (_, i) => close.get(m + i) ?? null) });
  return out;
}

/** Revolut X's trades answer as print rows: the UK's only, of the book, each once by id. */
export function rxPrintRows(body: unknown): { rows: PrintRow[]; cursor: string } {
  const b = body as { data?: Array<Record<string, unknown>>; metadata?: { next_cursor?: string } };
  const rows: PrintRow[] = [];
  for (const r of b?.data ?? []) {
    if (r.region !== "UK") continue;
    const price = Number(r.price), qty = Number(r.quantity), ts = Number(r.timestamp);
    if (!(price > 0) || !(qty > 0) || !Number.isFinite(ts) || typeof r.id !== "string") continue;
    rows.push({ book: MM_BOOK, id: r.id, ts: iso(ts), price, qty, side: r.side === "buy" ? "buy" : "sell" });
  }
  return { rows, cursor: b?.metadata?.next_cursor ?? "" };
}

/** Revolut X's book answer as [price, coins] levels, the best first, `MM_BOOK_LEVELS` a side. */
export function rxBookLevels(body: unknown): { bids: Array<[number, number]>; asks: Array<[number, number]> } | null {
  const d = (body as { data?: { bids?: Array<Record<string, unknown>>; asks?: Array<Record<string, unknown>> } })?.data;
  if (!d) return null;
  const side = (xs: Array<Record<string, unknown>> | undefined) =>
    (xs ?? []).map((x) => [Number(x.price), Number(x.quantity)] as [number, number]).filter(([p, q]) => p > 0 && q > 0).slice(0, MM_BOOK_LEVELS);
  return { bids: side(d.bids), asks: side(d.asks) };
}

export type MmDeps = { db: Db; now: number; holder: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> };
export type MmReport = {
  recorded: { minutes: number; prints: number; book: boolean; usdt: boolean };
  decided: Record<string, { from: string | null; to: string | null; minutes: number; fills: number; trips: number }>;
  errors: string[]; report: boolean; skipped?: string;
};

async function record(d: MmDeps, rec: RecState, report: MmReport): Promise<void> {
  const f = d.fetchImpl ?? fetch, sleep = d.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = d.now, cur = minuteOf(now);
  const T = MM_TABLES;
  // Binance: whole minutes from the cursor to the last closed one.
  const bnJob = (async () => {
    const fromS = rec.bnNext ?? Math.floor((cur - MM_FIRST_BACK_MS) / 1000);
    const lastS = Math.floor(cur / 1000) - 1;
    const minutes = Math.min(Math.floor((lastS - fromS + 1) / 60), Math.floor(MM_BN_MAX_S / 60));
    if (minutes < 1) return;
    const toS = fromS + minutes * 60 - 1;
    const body = await getJson(f, `${MM_BN_HOST}/api/v3/klines?symbol=${MM_BN_SYMBOL}&interval=1s&startTime=${fromS * 1000}&endTime=${toS * 1000 + 999}&limit=1000`);
    const rows = bnRows(body, fromS, toS - 59);
    await d.db.upsert(T.inputs, rows, "book,minute");
    rec.firstMinute ??= fromS * 1000;
    rec.bnNext = toS + 1;
    report.recorded.minutes = rows.length;
  })().catch((e) => { report.errors.push(`binance: ${msg(e)}`); });
  // Coinbase's USDT-USD, into this minute's row.
  const cbJob = (async () => {
    const body = await getJson(f, `${MM_CB_HOST}/products/USDT-USD/ticker`) as { price?: string };
    const u = Number(body?.price);
    if (!(u > 0.5 && u < 1.5)) throw new Error(`USDT-USD price ${body?.price}`);
    await d.db.upsert(T.inputs, [{ book: MM_BOOK, minute: iso(cur), usdt: u, usdt_at: iso(now) }], "book,minute");
    report.recorded.usdt = true;
  })().catch((e) => { report.errors.push(`coinbase: ${msg(e)}`); });
  // Revolut X: the prints, then the book, a request every MM_RX_GAP_MS.
  const rxJob = (async () => {
    try {
      const start = rec.printsCovered != null ? rec.printsCovered - MM_PRINT_OVERLAP_MS : now - MM_FIRST_BACK_MS;
      const end = Math.min(now, start + MM_PRINT_WINDOW_MS);
      const byId = new Map<string, PrintRow>();
      let cursor = "", pages = 0;
      do {
        if (pages) await sleep(MM_RX_GAP_MS);
        const body = await getJson(f, `${MM_RX_HOST}/api/1.0/public/trades/all?symbol=${MM_BOOK}&start_date=${start}&end_date=${end}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        const r = rxPrintRows(body);
        for (const p of r.rows) byId.set(p.id, p);
        cursor = r.cursor;
        pages++;
      } while (cursor && pages < MM_PRINT_PAGES);
      if (cursor) report.errors.push(`revolut x prints: more than ${MM_PRINT_PAGES} pages in a window`);
      const rows = [...byId.values()];
      if (rows.length) await d.db.upsert(T.prints, rows, "book,id");
      rec.printsCovered = end;
      report.recorded.prints = rows.length;
    } catch (e) { report.errors.push(`revolut x prints: ${msg(e)}`); }
    try {
      await sleep(MM_RX_GAP_MS);
      const lv = rxBookLevels(await getJson(f, `${MM_RX_HOST}/api/2.0/public/order-book/${MM_BOOK}?region=UK&limit=${MM_BOOK_LEVELS}`));
      if (!lv) throw new Error("no book in the answer");
      await d.db.upsert(T.inputs, [{ book: MM_BOOK, minute: iso(cur), bids: lv.bids, asks: lv.asks, book_at: iso(d.now) }], "book,minute");
      report.recorded.book = true;
    } catch (e) { report.errors.push(`revolut x book: ${msg(e)}`); }
  })();
  await Promise.all([bnJob, cbJob, rxJob]);
}

// ------------------------------------------------------------------------------------------------------------- decide

export type Lot = { qty: number; price: number; sec: number };
export type ArmState = { core: MmState; lots: Lot[]; lastMinute: number; startAt: number; lastFair: number | null; fault?: { key: string; at: number } };
export type MinuteRow = {
  arm: MmArmId; minute: string; fair: number | null; basis_bps: number | null; usdt: number | null; gbpusd: number | null; bid: number | null; ask: number | null;
  cash: number; coin: number; cost: number; equity: number; placed: number; cancels: number; fills: number; stale_s: number;
};
export type FillRow = { arm: MmArmId; ts: string; seq: number; side: "bid" | "ask"; kind: "taker" | "arb" | "stop"; qty: number; price: number; fair: number | null };
export type TripRow = { arm: MmArmId; t_exit: string; seq: number; t_entry: string; qty: number; entry: number; exit: number; fee_gbp: number; pnl_gbp: number; how: "maker" | "arb" | "stop" };

/** A stored `fx_ticks` row (0172): the minute, and per read when it arrived (ms after the minute), its mid in millionths, marked or not. */
export type FxTickRow = { source: string; pair: string; minute: string; recv_ms: number[]; mid: number[]; fallback: boolean[] };
/** One GBP/USD read: when it arrived, its mid. */
export type FxRead = { at: number; mid: number };

/** The usable GBP/USD reads of some `fx_ticks` rows, oldest first: every TrueFX read, and Kraken's reads marked as the fallback (as cb_fx.ts reads them). */
export function fxReadsOf(rows: FxTickRow[]): FxRead[] {
  const out: FxRead[] = [];
  for (const r of rows) {
    if (r.pair !== "GBPUSD" || (r.source !== "truefx" && r.source !== "kraken")) continue;
    const m = msOf(r.minute);
    for (let i = 0; i < (r.recv_ms ?? []).length; i++) {
      if (r.source === "kraken" && !r.fallback?.[i]) continue;
      const mid = Number(r.mid[i]) / 1e6;
      if (mid > 0) out.push({ at: m + Number(r.recv_ms[i]), mid });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The inputs of minutes [first − 1 min, to]: Binance's seconds, USDT/USD reads and GBP/USD reads, and the prints by second. */
export type Inputs = {
  bn: Map<number, Array<number | null>>; usdt: Array<{ at: number; v: number }>; gbp: FxRead[]; prints: Map<number, MmPrint[]>;
};

function newestAt<T extends { at: number }>(xs: T[], t: number): T | null {
  let lo = 0, hi = xs.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m].at <= t) lo = m + 1; else hi = m; }
  return lo > 0 ? xs[lo - 1] : null;
}

/** A minute's rates: USDT/USD and GBP/USD as known at its start, or null when either is missing or too old. */
export function ratesAt(inp: Inputs, m: number): { usdt: number | null; gbpusd: number | null } {
  const u = newestAt(inp.usdt, m), g = newestAt(inp.gbp, m);
  return { usdt: u && m - u.at <= MM_USDT_FRESH_MS ? u.v : null, gbpusd: g && m - g.at <= MM_FX_FRESH_MS ? g.mid : null };
}

/** F(s): Binance's close of second s × USDT/USD ÷ GBP/USD of its minute; null when any is missing. */
export function fairOf(inp: Inputs): (s: number) => number | null {
  const k = new Map<number, number | null>();
  return (s: number) => {
    const m = Math.floor(s / 60) * 60;
    const v = inp.bn.get(m * 1000)?.[s - m];
    if (v == null) return null;
    if (!k.has(m)) {
      const r = ratesAt(inp, m * 1000);
      k.set(m, r.usdt != null && r.gbpusd != null ? r.usdt / r.gbpusd : null);
    }
    const kk = k.get(m);
    return kk == null ? null : v * kk;
  };
}

async function readInputs(db: Db, first: number, to: number): Promise<Inputs> {
  const T = MM_TABLES;
  const [rows, usdt, fx, prints] = await Promise.all([
    db.selectAll<InputRow>(T.inputs, `book=eq.${MM_BOOK}&minute=gte.${enc(first - M)}&minute=lte.${enc(to)}&select=minute,bn&order=book.asc,minute.asc`),
    db.select<InputRow>(T.inputs, `book=eq.${MM_BOOK}&minute=gte.${enc(first - MM_USDT_FRESH_MS - M)}&minute=lte.${enc(to)}&select=usdt,usdt_at&order=minute.asc&limit=1000`),
    db.selectAll<FxTickRow>("fx_ticks", `pair=eq.GBPUSD&minute=gte.${enc(first - MM_FX_FRESH_MS - M)}&minute=lte.${enc(to)}&select=source,pair,minute,recv_ms,mid,fallback&order=source.asc,pair.asc,minute.asc`),
    db.selectAll<PrintRow>(T.prints, `book=eq.${MM_BOOK}&ts=gte.${enc(first)}&ts=lt.${enc(to + M)}&select=id,ts,price,qty,side&order=ts.asc,id.asc`),
  ]);
  const bn = new Map<number, Array<number | null>>();
  for (const r of rows) if (Array.isArray(r.bn)) bn.set(msOf(r.minute), r.bn.map((x) => (x == null ? null : Number(x))));
  const u = usdt.filter((r) => r.usdt != null && r.usdt_at != null).map((r) => ({ at: msOf(r.usdt_at), v: Number(r.usdt) })).sort((a, b) => a.at - b.at);
  const gbp = fxReadsOf(fx);
  const bySec = new Map<number, MmPrint[]>();
  for (const p of mmSortPrints(prints.map((r) => ({ ms: msOf(r.ts), price: Number(r.price), qty: Number(r.qty), side: r.side === "buy" ? 1 : -1 } as MmPrint)))) {
    const s = Math.floor(p.ms / 1000);
    const a = bySec.get(s);
    if (a) a.push(p); else bySec.set(s, [p]);
  }
  return { bn, usdt: u, gbp, prints: bySec };
}

/** One arm's minutes [first, to] in order (mutates `st`): the engine a minute at a time, its rows, and its round trips first in, first out. */
export function decideArm(arm: MmArm, st: ArmState, inp: Inputs, first: number, to: number) {
  const p = mmParamsOf(arm), F = fairOf(inp);
  const prints = (s: number) => inp.prints.get(s) ?? [];
  const minutes: MinuteRow[] = [], fills: FillRow[] = [], trips: TripRow[] = [];
  for (let t = first; t <= to; t += M) {
    const before = { placed: st.core.placed, cancels: st.core.cancels };
    const out = mmRun(st.core, p, t / 1000, t / 1000 + 60, F, prints, st.startAt / 1000);
    const seqOf = new Map<number, number>();
    for (const f of out.fills) {
      const seq = seqOf.get(f.sec) ?? 0;
      seqOf.set(f.sec, seq + 1);
      fills.push({ arm: arm.arm, ts: iso(f.sec * 1000), seq, side: f.side > 0 ? "bid" : "ask", kind: f.kind, qty: f.qty, price: f.price, fair: Number.isFinite(f.fair) ? f.fair : null });
      if (f.side > 0) { st.lots.push({ qty: f.qty, price: f.price, sec: f.sec }); continue; }
      let left = f.qty, cost = 0, tEntry: number | null = null;
      while (left > 1e-12 && st.lots.length) {
        const lot = st.lots[0], q = Math.min(lot.qty, left);
        tEntry ??= lot.sec;
        cost += q * lot.price;
        lot.qty -= q;
        left -= q;
        if (lot.qty <= 1e-12) st.lots.shift();
      }
      const sold = f.qty - Math.max(left, 0);
      if (sold <= 0) continue;
      trips.push({ arm: arm.arm, t_exit: iso(f.sec * 1000), seq, t_entry: iso((tEntry ?? f.sec) * 1000), qty: sold, entry: cost / sold, exit: f.price,
        fee_gbp: f.kind === "stop" ? sold * f.fair * MM_STOP_FEE : 0, pnl_gbp: sold * f.price - cost, how: f.kind === "taker" ? "maker" : f.kind });
    }
    const lit = out.seconds.filter((x) => x.fair != null);
    const fair = lit.length ? lit[lit.length - 1].fair : null;
    if (fair != null) st.lastFair = fair;
    const r = ratesAt(inp, t);
    const cost = st.lots.reduce((a, l) => a + l.qty * l.price, 0);
    minutes.push({
      arm: arm.arm, minute: iso(t), fair, basis_bps: st.core.c, usdt: r.usdt, gbpusd: r.gbpusd, bid: st.core.bid?.price ?? null, ask: st.core.ask?.price ?? null,
      cash: st.core.cash, coin: st.core.coin, cost, equity: st.core.cash + st.core.coin * (st.lastFair ?? 0),
      placed: st.core.placed - before.placed, cancels: st.core.cancels - before.cancels, fills: out.fills.length,
      stale_s: out.seconds.filter((x) => x.stale && x.sec * 1000 >= st.startAt).length,
    });
  }
  st.lastMinute = to;
  return { minutes, fills, trips };
}

/** The call: record, then decide each arm. Never throws for a venue: what failed is in `errors`. */
export async function runMm(d: MmDeps): Promise<MmReport> {
  const T = MM_TABLES;
  const report: MmReport = { recorded: { minutes: 0, prints: 0, book: false, usdt: false }, decided: {}, errors: [], report: false };
  const leased = await d.db.claim("agent_locks", `name=eq.${MM_LEASE}&lease_until=lt.${enc(d.now)}`, { lease_until: iso(d.now + MM_LEASE_MS), holder: d.holder });
  if (!leased.length) return { ...report, skipped: "another run holds the lease" };
  try {
    const rows = await d.db.select<{ arm: string; state: unknown }>(T.state, "select=arm,state");
    const rec = (rows.find((r) => r.arm === "rec")?.state ?? {}) as RecState;
    await record(d, rec, report);
    const recErrors = [...report.errors];
    await saveState(d, "rec", rec, rec.bnNext != null ? rec.bnNext * 1000 - M : null, recErrors, report);
    if (rec.bnNext == null || rec.firstMinute == null || rec.printsCovered == null) return { ...report, skipped: "nothing recorded yet" };
    // A minute is decided once Binance's seconds and Revolut X's prints are both recorded through its end.
    const horizon = Math.min(minuteOf(d.now) - MM_LAG_MINUTES * M, rec.bnNext * 1000 - M, minuteOf(rec.printsCovered) - M);
    const plan = MM_ARMS.map((arm) => {
      let st = rows.find((r) => r.arm === arm.arm)?.state as ArmState | undefined;
      if (!st || !("core" in st)) st = { core: mmNew(mmParamsOf(arm)), lots: [], lastMinute: rec.firstMinute! - M, startAt: mmStartFor(rec.firstMinute!), lastFair: null };
      const first = st.lastMinute + M, to = Math.min(horizon, st.lastMinute + MM_MAX_MINUTES * M);
      return { arm, st, first, to };
    });
    const due = plan.filter((x) => x.to >= x.first);
    if (!due.length) return { ...report, skipped: "nothing new to decide" };
    let inputs: Inputs | null = null;
    try {
      inputs = await readInputs(d.db, Math.min(...due.map((x) => x.first)), Math.max(...due.map((x) => x.to)));
    } catch (e) { report.errors.push(`inputs: ${msg(e)}`); }
    for (const x of plan) {
      if (x.to < x.first || !inputs) continue;
      const errs: string[] = [];
      const before = structuredClone(x.st);
      try {
        const out = decideArm(x.arm, x.st, inputs, x.first, x.to);
        if (out.fills.length) await d.db.upsert(T.fills, out.fills, "arm,ts,seq");
        if (out.trips.length) await d.db.upsert(T.trips, out.trips, "arm,t_exit,seq");
        if (out.minutes.length) await d.db.upsert(T.minutes, out.minutes, "arm,minute");
        report.decided[x.arm.arm] = { from: iso(x.first), to: iso(x.to), minutes: out.minutes.length, fills: out.fills.length, trips: out.trips.length };
      } catch (e) {
        x.st = before;
        errs.push(`${x.arm.arm}: ${msg(e)}`);
        report.errors.push(`${x.arm.arm}: ${msg(e)}`);
      }
      await saveState(d, x.arm.arm, x.st, x.st.lastMinute, errs, report);
    }
    return report;
  } catch (e) {
    report.errors.push(msg(e));
    report.report = true;
    return report;
  } finally {
    try { await d.db.update("agent_locks", `name=eq.${MM_LEASE}&holder=eq.${encodeURIComponent(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* it expires */ }
  }
}

async function saveState(d: MmDeps, arm: string, st: { fault?: { key: string; at: number } }, lastMinute: number | null, errors: string[], report: MmReport) {
  const key = faultKey(errors);
  const due = reportDue(st.fault ?? null, key, d.now);
  if (due) report.report = true;
  if (!key) delete st.fault; else if (due) st.fault = { key, at: d.now };
  await d.db.upsert(MM_TABLES.state, [{ arm, state: st, last_minute: lastMinute != null ? iso(lastMinute) : null, updated_at: iso(d.now),
    last_error: errors.length ? errors.join(" | ").slice(0, 500) : null }], "arm");
}
