// GBP/USD and EUR/USD at second resolution, RECORDED beside Yahoo's minute bar. Davies, 2026-10-29: "并行记录秒级汇率
// 并研究下最佳数据源并且要有fallback" — record a second-level rate in parallel, find the best source, with a fallback.
//
// WHAT IT IS FOR. Every stablecoin quote row prices its fair on Yahoo's one-minute GBPUSD=X / EURUSD=X bar, and the
// Coinbase/OKX fair-price study (docs/agents/reviews/2026-10-29-cb-okx-fair-price-study.md §2.6, §5) found about 40 % of a
// minute's move reaching Yahoo a bar late. Before anything is decided about a faster rate, 2–4 weeks of one are recorded
// here and compared with Yahoo and with the books (docs/agents/reviews/2026-10-29-fx-second-sources.md, its plan). This file
// imports nothing of any engine. SINCE 2026-10-29 (0173) EVERY COINBASE ARM PRICES ITS RATE ON THIS TABLE (cb_fx.ts: TrueFX's
// reads, and Kraken's only where marked `fallback`, by when each ARRIVED): a change to what is kept, marked or when is a
// change to those arms' input, and goes through their pre-registrations.
//
// THE SOURCES (chosen in that review, measured from a container 2026-10-29). Both are keyless public reads:
//   truefx   the PRIMARY: TrueFX's unauthenticated snapshot (`webrates.truefx.com/rates/connect.html?f=csv`), both pairs in
//            one answer, each with its own millisecond timestamp and a bid and ask. Read every second while the market is
//            open. The 2026-09-28 study measured it 0.5–0.6 s behind Dukascopy's ticks at one read a second.
//   kraken   the FALLBACK: Kraken's spot GBP/USD and EUR/USD books (`/0/public/Ticker?pair=GBPUSD,EURUSD`), both pairs in one
//            answer, a bid and an ask, no timestamp of its own. Read every `FX_CHECK_EVERY_S` seconds always, so the study
//            has it beside TrueFX and its health is known before it is needed; every `FX_FALLBACK_EVERY_S` while TrueFX is
//            unhealthy, those reads marked `fallback`.
// Yahoo is not read here: PR5's live executor depends on Yahoo answering the same egress, and the minute bars it already
// stores (`agent_quote_inputs`, `cb_quote_inputs`) are what the study compares with.
//
// THE PRIMARY'S HEALTH. TrueFX is unhealthy after `FX_FAIL_READS` failed reads in a row, or while either pair's own
// timestamp is more than `FX_STALE_MS` behind the read with the market surely open (`fxMarketOpen`). It turns healthy at its
// first good read. Unhealthy for `FX_ALERT_MS` with the market open is a fault, as is the fallback failing every read of a
// minute while it is needed, and a write that fails: each goes to `ops_errors` as `agents.fx_rec` when it first appears
// and at most hourly while it lasts (`faultKey`, `reportDue`, as the book recorders do). A single failed read is not.
//
// THE ROW. One row per source, pair and minute (`fx_ticks`): the minute's first read and every later one that brought
// something new (a quote differing from the last one kept, or, for TrueFX, a new timestamp) as parallel arrays: when it arrived and the source's own timestamp,
// each in ms after the minute; bid, ask and mid in millionths; whether it was read as the fallback. With them, the reads
// and the failed reads of the minute. A run rewrites its rows every `FX_FLUSH_MS` and at its end, so a run cut short keeps
// what it had flushed. The view `fx_tick_reads` unnests them, a row per read, in prices.
//
// THE RUN. The one-minute job calls `agents?action=fxrec` at the top of the minute; it answers at once and the run goes on
// under `waitUntil` until `FX_LAST_READ_MS` into its minute (reads start every whole second, none after that, each
// abandoned after `FX_TIMEOUT_MS`), so the next minute's run starts as it ends and the minute is covered but for about a
// second. It holds nothing of the job's batch. The cost (the review's estimate): one call a minute, about 70 small GETs.

import type { Db } from "./db.ts";
import { faultKey, reportDue } from "./pm_book_rec.ts";

export const FX_PAIRS = ["GBPUSD", "EURUSD"] as const;
export type FxPair = typeof FX_PAIRS[number];
export const FX_SOURCES = ["truefx", "kraken"] as const;
export type FxSource = typeof FX_SOURCES[number];
export const FX_PRIMARY: FxSource = "truefx";
export const FX_FALLBACK: FxSource = "kraken";

export const TRUEFX_URL = "https://webrates.truefx.com/rates/connect.html?f=csv";
export const KRAKEN_URL = "https://api.kraken.com/0/public/Ticker?pair=GBPUSD,EURUSD";
export const FX_URLS: Record<FxSource, string> = { truefx: TRUEFX_URL, kraken: KRAKEN_URL };

/** No read starts later than this into the run's minute; with `FX_TIMEOUT_MS` the run is done before the next minute's starts. */
export const FX_LAST_READ_MS = 58_000;
export const FX_TIMEOUT_MS = 1_500;
export const FX_FLUSH_MS = 10_000;
/** The fallback's routine reads (seconds into the minute divisible by it), and its reads while the primary is unhealthy. */
export const FX_CHECK_EVERY_S = 5;
export const FX_FALLBACK_EVERY_S = 2;
/** While the market is closed: the primary every 10 s, the fallback every 30 s; nothing moves, and only changes are kept. */
export const FX_CLOSED_EVERY_S = 10;
export const FX_CLOSED_FALLBACK_EVERY_S = 30;
/** The primary is unhealthy after this many failed reads in a row, or while a pair's own timestamp is this far behind. */
export const FX_FAIL_READS = 3;
export const FX_STALE_MS = 120_000;
/** Unhealthy this long with the market open is a fault for `ops_errors`. */
export const FX_ALERT_MS = 5 * 60_000;
const UA = "daviesportfolios-fx-rec/1.0 (public data only)";

/** One pair as a source served it: its own timestamp (ms since the epoch) when it gives one, bid and ask. */
export type FxQuote = { pair: FxPair; srcMs: number | null; bid: number; ask: number };

/** A price is positive and finite, and an ask is not below its bid. */
function sane(bid: number, ask: number): boolean {
  return Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask >= bid && ask / bid < 1.01;
}

/**
 * TrueFX's CSV snapshot: `PAIR,ms,big,points,big,points,high,low,open` a line, the bid and the ask each split in two
 * fields that concatenate ("1.33", "156" → 1.33156). The two pairs' lines are kept; the other pairs are ignored. Throws
 * when neither pair can be read; a pair whose line is unreadable is left out.
 */
export function parseTrueFx(body: string): FxQuote[] {
  const out: FxQuote[] = [];
  for (const line of body.trim().split(/\r?\n/)) {
    const p = line.split(",");
    const pair = p[0]?.replace("/", "") as FxPair;
    if (!FX_PAIRS.includes(pair) || p.length < 6 || out.some((q) => q.pair === pair)) continue;
    const srcMs = Number(p[1]), bid = Number(p[2] + p[3]), ask = Number(p[4] + p[5]);
    if (!Number.isSafeInteger(srcMs) || srcMs <= 0 || !sane(bid, ask)) continue;
    out.push({ pair, srcMs, bid, ask });
  }
  if (!out.length) throw new Error(`no readable GBP/USD or EUR/USD line: ${body.slice(0, 60)}`);
  return out;
}

const KRAKEN_KEYS: Record<string, FxPair> = { ZGBPZUSD: "GBPUSD", ZEURZUSD: "EURUSD", GBPUSD: "GBPUSD", EURUSD: "EURUSD" };

/** Kraken's ticker: `{ error: [], result: { ZGBPZUSD: { a: [ask, …], b: [bid, …] }, … } }`. Throws on an error or no pair. */
export function parseKraken(body: string): FxQuote[] {
  let j: { error?: unknown; result?: Record<string, { a?: unknown[]; b?: unknown[] }> };
  try { j = JSON.parse(body); } catch { throw new Error("unreadable JSON"); }
  if (Array.isArray(j.error) && j.error.length) throw new Error(String(j.error[0]).slice(0, 80));
  const out: FxQuote[] = [];
  for (const [k, v] of Object.entries(j.result ?? {})) {
    const pair = KRAKEN_KEYS[k];
    if (!pair || out.some((q) => q.pair === pair)) continue;
    const bid = Number(v?.b?.[0]), ask = Number(v?.a?.[0]);
    if (sane(bid, ask)) out.push({ pair, srcMs: null, bid, ask });
  }
  if (!out.length) throw new Error("no readable GBP/USD or EUR/USD");
  return out;
}

export const FX_PARSE: Record<FxSource, (body: string) => FxQuote[]> = { truefx: parseTrueFx, kraken: parseKraken };

/**
 * Whether the FX market may be open (`surely` false: the read cadence) or surely is (`surely` true: the staleness check and
 * the faults). The week closes at 17:00 New York: Friday 21:00 → Sunday 21:00 UTC in summer, 22:00 → 22:00 in winter. So it
 * may be open but for Friday 22:00 → Sunday 21:00, and surely is but for Friday 21:00 → Sunday 22:00: an hour of doubt reads
 * fast and alerts on nothing.
 */
export function fxMarketOpen(t: number, surely = false): boolean {
  const d = new Date(t), day = d.getUTCDay(), h = d.getUTCHours();
  if (day === 6) return false;
  if (day === 5 && h >= (surely ? 21 : 22)) return false;
  if (day === 0 && h < (surely ? 22 : 21)) return false;
  return true;
}

/** The sources a read starting `sec` seconds into the minute takes: the primary and, when due, the fallback. */
export function fxDue(sec: number, open: boolean, primaryHealthy: boolean): FxSource[] {
  const due: FxSource[] = [];
  if (sec % (open ? 1 : FX_CLOSED_EVERY_S) === 0) due.push(FX_PRIMARY);
  const every = !open ? FX_CLOSED_FALLBACK_EVERY_S : primaryHealthy ? FX_CHECK_EVERY_S : FX_FALLBACK_EVERY_S;
  if (sec % every === 0) due.push(FX_FALLBACK);
  return due;
}

/** A price in millionths, as the row keeps it (every source quotes five decimals or fewer). */
export const micros = (x: number) => Math.round(x * 1e6);

/** One source's reads of one pair in a minute, as the row's arrays. */
export type FxBuf = {
  recv: number[]; src: (number | null)[]; bid: number[]; ask: number[]; mid: number[]; fb: boolean[];
  reads: number; failed: number; lastError: string | null;
};
export const newBuf = (): FxBuf => ({ recv: [], src: [], bid: [], ask: [], mid: [], fb: [], reads: 0, failed: 0, lastError: null });

/** An offset in ms after the minute that fits the column (int4), else null. */
const offset = (ms: number, minute: number) => {
  const o = ms - minute;
  return Math.abs(o) < 2_000_000_000 ? o : null;
};

/**
 * Keep a read when it brings something new: a bid or ask differing from the last kept, or a new source timestamp.
 * Returns whether it was kept.
 */
export function keepRead(b: FxBuf, last: FxQuote | undefined, q: FxQuote, recvMs: number, minute: number, fallback: boolean): boolean {
  if (last && last.bid === q.bid && last.ask === q.ask && last.srcMs === q.srcMs) return false;
  const r = offset(recvMs, minute);
  if (r == null) return false;
  b.recv.push(r);
  b.src.push(q.srcMs == null ? null : offset(q.srcMs, minute));
  b.bid.push(micros(q.bid));
  b.ask.push(micros(q.ask));
  b.mid.push(micros((q.bid + q.ask) / 2));
  b.fb.push(fallback);
  return true;
}

/** A buffer as an `fx_ticks` row. A source with no timestamps of its own stores a null `src_ms`. */
export function fxRow(source: FxSource, pair: FxPair, minute: number, b: FxBuf) {
  return {
    source, pair, minute: new Date(minute).toISOString(),
    recv_ms: b.recv, src_ms: b.src.every((x) => x == null) ? null : b.src,
    bid: b.bid, ask: b.ask, mid: b.mid, fallback: b.fb,
    reads: b.reads, failed: b.failed, last_error: b.lastError,
  };
}

/** The primary's health between reads and between runs (kept in the state row). */
export type FxHealth = { failsInRow: number; badSince: number | null };

/**
 * The primary's health after one read: a failure counts toward `FX_FAIL_READS`; a good read is unhealthy only while the
 * market is open and a pair's own timestamp is more than `FX_STALE_MS` behind it, or a pair is missing.
 */
export function nextHealth(h: FxHealth, at: number, read: { ok: false } | { ok: true; quotes: FxQuote[] }, open: boolean): FxHealth {
  let bad: boolean, fails = 0;
  if (!read.ok) {
    fails = h.failsInRow + 1;
    bad = fails >= FX_FAIL_READS;
  } else {
    bad = open && FX_PAIRS.some((p) => {
      const q = read.quotes.find((x) => x.pair === p);
      return !q || q.srcMs == null || at - q.srcMs > FX_STALE_MS;
    });
  }
  if (!bad) return { failsInRow: fails, badSince: null };
  return { failsInRow: fails, badSince: h.badSince ?? at };
}

export const fxHealthy = (h: FxHealth) => h.badSince == null;

export type FxRecState = { health?: FxHealth; fault?: { key: string; at: number } };
export type FxRecReport = {
  at: string; minute: string; ms: number; reads: Record<FxSource, number>; failed: Record<FxSource, number>; kept: number;
  fallbackReads: number; primaryHealthy: boolean; errors: string[]; report: boolean;
};

const iso = (ms: number) => new Date(ms).toISOString();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** One read of one source: the parsed quotes, or why not. Never throws. */
async function readSource(f: typeof fetch, s: FxSource): Promise<{ ok: true; quotes: FxQuote[] } | { ok: false; error: string }> {
  try {
    const res = await f(FX_URLS[s], { headers: { "user-agent": UA }, signal: AbortSignal.timeout(FX_TIMEOUT_MS) });
    const body = await res.text();
    if (!res.ok) return { ok: false, error: `${res.status} ${body.slice(0, 60)}` };
    return { ok: true, quotes: FX_PARSE[s](body) };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/**
 * One minute's run: a read at every whole second from the run's start to `FX_LAST_READ_MS` into its minute, each taking
 * the sources `fxDue` names, at once; what each brings that is new appended to its source and pair's buffer, rows flushed
 * every `FX_FLUSH_MS` and at the end; then the state row (the primary's health and the fault last reported).
 * A second run of a minute rewrites that minute's rows with its own reads.
 */
export async function runFxRec(d: {
  db: Db; now: number; clock?: () => number; fetchImpl?: typeof fetch; pause?: (ms: number) => Promise<void>;
}): Promise<FxRecReport> {
  const clock = d.clock ?? (() => Date.now());
  const f = d.fetchImpl ?? fetch;
  const pause = d.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const t0 = clock();
  const minute = Math.floor(d.now / 60e3) * 60e3;
  const errors: string[] = [];
  let state: FxRecState = {};
  try {
    const [st] = await d.db.select<{ state: FxRecState | null }>("fx_rec_state", "id=eq.1&select=state");
    state = st?.state ?? {};
  } catch (e) { errors.push(`state read: ${msg(e)}`); }
  let health: FxHealth = state.health ?? { failsInRow: 0, badSince: null };
  // The last quote kept, by source and pair: a minute's row starts with its first read, so each row stands alone.
  const last: Record<FxSource, Partial<Record<FxPair, FxQuote>>> = { truefx: {}, kraken: {} };
  const bufs = new Map<string, FxBuf>();
  const buf = (s: FxSource, p: FxPair) => {
    const k = `${s}|${p}`;
    if (!bufs.has(k)) bufs.set(k, newBuf());
    return bufs.get(k)!;
  };
  const report: FxRecReport = {
    at: iso(d.now), minute: iso(minute), ms: 0, reads: { truefx: 0, kraken: 0 }, failed: { truefx: 0, kraken: 0 }, kept: 0,
    fallbackReads: 0, primaryHealthy: fxHealthy(health), errors, report: false,
  };
  let fallbackNeeded = false, fallbackGood = false, writeError: string | null = null;
  const flush = async () => {
    const rows = [...bufs.entries()].map(([k, b]) => {
      const [s, p] = k.split("|") as [FxSource, FxPair];
      return fxRow(s, p, minute, b);
    });
    if (!rows.length) return;
    try { await d.db.upsert("fx_ticks", rows, "source,pair,minute"); } catch (e) { writeError = `write: ${msg(e)}`; }
  };
  let lastFlush = clock();
  // The first read at once, as the second the run started in; then at each whole second of the minute; none past FX_LAST_READ_MS.
  for (let sec = Math.floor((d.now + (clock() - t0) - minute) / 1000); sec * 1000 <= FX_LAST_READ_MS; sec++) {
    const wait = minute + sec * 1000 - (d.now + (clock() - t0));
    if (wait > 0) await pause(wait);
    const open = fxMarketOpen(minute + sec * 1000), surely = fxMarketOpen(minute + sec * 1000, true);
    const healthy = fxHealthy(health);
    const due = fxDue(sec, open, healthy);
    const results = await Promise.all(due.map(async (s) => ({ s, r: await readSource(f, s), at: d.now + (clock() - t0) })));
    for (const { s, r, at } of results) {
      const asFallback = s === FX_FALLBACK && !healthy && open;
      report.reads[s]++;
      for (const p of FX_PAIRS) buf(s, p).reads++;
      if (asFallback) { fallbackNeeded = true; report.fallbackReads++; }
      if (!r.ok) {
        report.failed[s]++;
        for (const p of FX_PAIRS) { buf(s, p).failed++; buf(s, p).lastError = r.error.slice(0, 200); }
      } else {
        if (asFallback) fallbackGood = true;
        for (const q of r.quotes) {
          if (keepRead(buf(s, q.pair), last[s][q.pair], q, at, minute, asFallback)) { report.kept++; last[s][q.pair] = q; }
        }
      }
      if (s === FX_PRIMARY) health = nextHealth(health, at, r.ok ? r : { ok: false }, surely);
    }
    if (clock() - lastFlush >= FX_FLUSH_MS) { await flush(); lastFlush = clock(); }
  }
  await flush();
  report.primaryHealthy = fxHealthy(health);
  const end = d.now + (clock() - t0);
  // The faults: what lasts, never a single read.
  if (health.badSince != null && fxMarketOpen(end, true) && end - health.badSince >= FX_ALERT_MS) {
    errors.push(`${FX_PRIMARY}: unhealthy for ${Math.round((end - health.badSince) / 60e3)} min (last error: ${buf(FX_PRIMARY, "GBPUSD").lastError ?? "stale"})`);
  }
  if (fallbackNeeded && !fallbackGood) errors.push(`${FX_FALLBACK}: every fallback read of the minute failed (${buf(FX_FALLBACK, "GBPUSD").lastError ?? "?"})`);
  if (writeError) errors.push(writeError);
  errors.sort();
  const key = faultKey(errors);
  const prev = state.fault ?? null;
  report.report = reportDue(prev, key, d.now);
  const fault = !key ? undefined : report.report ? { key, at: d.now } : prev ?? undefined;
  report.ms = clock() - t0;
  try {
    await d.db.upsert("fx_rec_state", [{
      id: 1, state: { health, ...(fault ? { fault } : {}) }, updated_at: iso(end), last_error: errors.join(" | ").slice(0, 1000) || null,
      last_report: { minute: report.minute, ms: report.ms, reads: report.reads, failed: report.failed, kept: report.kept, fallbackReads: report.fallbackReads, primaryHealthy: report.primaryHealthy },
    }], "id");
  } catch (e) {
    errors.push(`state: ${msg(e)}`);
    report.report = true;
  }
  return report;
}
