// Polymarket's rewarded markets, RECORDED: their books, their reward programmes and their prints, for research only.
// Davies, 2026-10-04: "把polymarket的所有有reward的市场详细价格与order book等一切重要的信息也全和之前revolut stablecoins市场一样详细记录下来
// 吧？以后可以更好inform策略，随时可以调用研究，你觉得是个好主意的话就加上也加到watchdog上" — record every rewarded market's prices,
// books and everything important as fully as the Revolut X stablecoin books (`books.ts`), to inform the strategies later
// and to be read for research at any time; and add it to the watchdog.
//
// It trades nothing, reads no key and places nothing: every venue read is keyless, and it reads and writes only its own
// tables (`pm_rec_*`, migration 0092), its two leases, and, read-only, the Reward quotes paths' selections and minutes to
// know which markets they hold or quote. Nothing of a trading path reads it.
//
// WHAT IT RECORDS (measured 2026-10-04 before it was built, keyless: `docs/agents/backtests/pmrec/`):
//   books     every minute, the YES book (a market has one book: its NO book is the YES book's mirror, reference §2d) of
//             every market whose total daily reward rate is at least $10 (live-prep S2's universe: 2,856 of the 18,926
//             markets listed on 2026-10-04, with 92 % of the listing's daily rates; 2,810 books came in 29 POSTs of a
//             hundred in ~1.3 s), and of every market a Reward quotes path holds or quotes: each side's levels within
//             RW's 10 ¢ of its best, the book's own time, the size-cutoff touch under the market's minimum size and the
//             last trade price (the rest of RW's `summarize`, q1, q2 and the depth within the maximum spread, is the
//             universe line's, and a reader's from the ladder). Capped at `PM_REC_BOOKS_MAX` books a minute: past it the
//             held and quoted markets stay and the rest go by rate, and the frame says how many were cut and below what
//             rate.
//   universe  every rewarded market (18,926 on 2026-10-04) once every 15 minutes, a fifteenth of them each minute (the
//             market's id modulo 15 against the minute): one compact line of its reward programme (rate, maximum spread,
//             minimum size), its book's touch, size-cutoff touch, the others' scores, depth within the maximum spread
//             and within 10 ¢, the last trade price, and Gamma's 24-hour volume and liquidity as last read. Its static
//             metadata (question, end date, game start, fee type, category, neg-risk, tokens) is `pm_rec_markets`, dumped
//             whole once a day beside the frames.
//   prints    every taker print of the books set, from the data API's global tape (`/v2/trades`, paged by its cursor back
//             to the last print recorded): about 1,000–1,200 prints a minute across Polymarket, 100–300 in this set.
//             For ten markets compared over the same seconds the tape held exactly the prints their own feeds held (69
//             of 69, 2026-10-04).
//
// HOW IT IS STORED. One row per book per minute, levels as arrays, would be about 850 MB a day in Postgres (332 bytes a
// row with its key on PGlite, 2.55 million changed books a day: 62–65 % of the set changes within its window from one
// minute to the next), and the database is a 1 GB instance that thrashed on 2026-10-02. So each minute's kind is ONE
// row of `pm_rec_frames`: a gzip of JSON lines (a header, then a line per book, market or print), about 180 KB for the
// books, 41 KB for the universe's fifteenth and 1–3 KB of prints. Every five minutes the meta call moves each closed
// hour of frames to Supabase Storage (bucket `pm-rec`, private) as one object per hour and kind (the frames' gzip
// members concatenated: Python's gzip, zcat and Deno's `node:zlib` read every member; the Web DecompressionStream reads
// only the first), records it in `pm_rec_archive` with a signed URL a research session can download without a key, and
// clears the frames' data, keeping their counts for seven days. Frames the archive has not taken within six hours are
// dropped and marked `lost` (the migration's hourly job): the database's budget outranks the record.
//
// TWO CALLS, each its own row of `public.edge_calls`, lease and state row, each run again by the watchdog when its
// worker never started (0075): `agents?action=pmrec` every minute (the reads above, into frames) and
// `agents?action=pmrec-meta` every five minutes (the reward listing every 15 minutes through the order path's own
// `rewardListing`, new markets' tokens, Gamma's metadata 250 markets a run, the held and quoted markets, the archive,
// the daily dump, URLs re-signed before they expire). Each checks the other is running, and reports a fault to
// `ops_errors` at most once an hour while it lasts. Neither starts a read later than its deadline into its run.

import type { Db } from "./db.ts";
import { RW_LEVEL_WINDOW, summarize } from "./pmrw.ts";
import { pmTime, rewardListing, type PmDeadline, type PmRewardRow } from "./pm_live.ts";
import type { PmVenue } from "../_shared/polymarket_orders.ts";
import { PM_CLOB, PM_DATA, pmSimplifiedMarkets, type PmPublicOpts } from "../_shared/polymarket_public.ts";

const M = 60e3, H = 3600e3, DAY = 86400e3;

// ------------------------------------------------------------------------------------------------------- constants

/** The tables it owns (0092). It also holds two rows of `agent_locks` and reads the Reward quotes paths' tables. */
export const PM_REC_TABLES = ["pm_rec_markets", "pm_rec_frames", "pm_rec_archive", "pm_rec_state"] as const;
/** The books set's floor: a total daily reward rate of $10 (RW's universe, mid-pool's floor, live-prep S2's universe). */
export const PM_REC_MIN_RATE = 10;
/** Levels kept a side: within 10 ¢ of the side's best, as RW recorded them. */
export const PM_REC_WINDOW = RW_LEVEL_WINDOW;
/** The universe's cycle: a fifteenth of it each minute, so every rewarded market every 15 minutes. */
export const PM_REC_PHASES = 15;
/** The most books a minute (the set was 2,853 on 2026-10-04): past it, the held and quoted first, then by rate. */
export const PM_REC_BOOKS_MAX = 4000;
/** The most of the universe's fifteenth read beside them a minute (about 1,260 on 2026-10-04), by rate past it. */
export const PM_REC_SHARD_MAX = 3000;
export const PM_REC_LEASE_MS = 55e3;
/** No read starts later than this into the minute call's run, so it ends inside its cron call's 58 s. */
export const PM_REC_READS_UNTIL_MS = 40e3;
/** The CLOB's public POST /books, a hundred tokens a request (as `pmBooks`), six at once; one retry each. */
export const PM_REC_BOOK_CHUNK = 100;
export const PM_REC_BOOK_CONCURRENCY = 6;
export const PM_REC_TIMEOUT_MS = 10e3;
/** The global tape's pages: a thousand prints each (about 40–60 s of Polymarket), eight at most a run. */
export const PM_REC_PRINT_PAGE = 1000;
export const PM_REC_PRINT_PAGES = 8;
/** With no print recorded yet, the first run takes the last minute's. */
export const PM_REC_FIRST_PRINTS_S = 60;
/** A fault is reported to `ops_errors` when it first appears, then at most this often while it lasts. */
export const PM_REC_REPORT_EVERY_MS = H;
/** Each call's view of the other: stale past these. */
export const PM_REC_BOOKS_STALE_MS = 10 * M;
export const PM_REC_META_STALE_MS = 30 * M;
// The meta call.
/**
 * Each request of the meta call's keyless wire (the listing's pages, Gamma) gives up after this long: three times the
 * order path's 5 s, which nothing here needs to be quick for. Its first run's listing on 2026-10-04 lost one page of 46
 * to the 5 s timeout and recorded nothing; the listing's own deadline (35 s into the run) still bounds the whole read.
 */
export const PM_REC_VENUE_TIMEOUT_MS = 15e3;
export const PM_REC_META_LEASE_MS = 55e3;
export const PM_REC_META_UNTIL_MS = 45e3;
/** The reward listing, read whole every 15 minutes (7.2 s and 230 ms of CPU, 48 pages, on 2026-10-04). */
export const PM_REC_LISTING_EVERY_MS = 15 * M;
/** Gamma's metadata, refreshed 250 markets a run (five reads of fifty): each listed market about every six hours. */
export const PM_REC_GAMMA_PER_RUN = 250;
const GAMMA_CHUNK = 50;
/** More new markets than this take their tokens from the CLOB's short list (one read of ~19 pages) instead of Gamma. */
export const PM_REC_NEW_BY_GAMMA_MAX = 250;
/** A path's minutes since this long ago name what it holds or quotes; a market so named stays in the books set this long. */
export const PM_REC_OURS_SINCE_MS = 5 * M;
export const PM_REC_OURS_HOLD_MS = 12 * M;
/** A closed hour is archived from this long after it closes (a run that began at :59 has written by then). */
export const PM_REC_ARCHIVE_AFTER_MS = 2 * M;
/** At most this many (hour, kind) objects a run, and frames read twenty at a time (~7 MB of hex). */
export const PM_REC_ARCHIVE_PER_RUN = 4;
const ARCHIVE_READ_FRAMES = 20;
/** The private bucket; a signed URL lives a year and is signed again in its last thirty days. */
export const PM_REC_BUCKET = "pm-rec";
export const PM_REC_URL_DAYS = 365;
export const PM_REC_RESIGN_DAYS = 30;
/** The day's dump of `pm_rec_markets`, from this far into the UTC day. */
export const PM_REC_DUMP_AFTER_MS = 5 * M;
const UA = "daviesportfolios-pm-rec/1.0 (public data only)";

/**
 * Where a Reward quotes path names the markets it holds or quotes: its day's selection, and the markets of its minutes
 * since `PM_REC_OURS_SINCE_MS` (a path's minutes carry the markets it holds as well as those it quotes). A source that
 * cannot be read is skipped and named. A new path is one line here.
 */
export const PM_REC_OURS_SOURCES: ReadonlyArray<{ name: string; table: string; query: (since: string, day: string) => string }> = [
  { name: "RW", table: "pm_rw_minutes", query: (since) => `minute=gte.${since}&select=cond&limit=1000` },
  { name: "RW selection", table: "pm_rw_selection", query: (_, day) => `day=eq.${day}&select=cond&limit=1000` },
  { name: "RW-C", table: "pm_rwc_minutes", query: (since) => `minute=gte.${since}&select=cond&limit=1000` },
  { name: "RW-C selection", table: "pm_rwc_selection", query: (_, day) => `day=eq.${day}&select=cond&limit=1000` },
  { name: "mini-pool", table: "pm_live_minutes", query: (since) => `mode=in.(dry_run,live)&minute=gte.${since}&select=cond&limit=1000` },
  { name: "mini-pool selection", table: "pm_live_markets", query: (_, day) => `day=eq.${day}&select=cond&limit=1000` },
  { name: "mini-pool paper", table: "pm_prep_minutes", query: (since) => `minute=gte.${since}&select=cond&limit=1000` },
  { name: "mid-pool", table: "pm_mid_minutes", query: (since) => `mode=in.(dry_run,live)&minute=gte.${since}&select=cond&limit=1000` },
  { name: "mid-pool selection", table: "pm_mid_markets", query: (_, day) => `day=eq.${day}&select=cond&limit=1000` },
  { name: "mid-pool paper", table: "pm_midprep_minutes", query: (since) => `minute=gte.${since}&select=cond&limit=1000` },
  { name: "live-prep", table: "pm_lp_minutes", query: (since) => `mode=in.(dry_run,live)&minute=gte.${since}&select=cond&limit=1000` },
  { name: "live-prep selection", table: "pm_lp_markets", query: (_, day) => `day=eq.${day}&select=cond&limit=1000` },
  { name: "live-prep paper", table: "pm_lpprep_minutes", query: (since) => `minute=gte.${since}&select=cond&limit=1000` },
];

/**
 * Each frame's line, field by field, as its header names them (`fields`). A books line carries the ladder, the
 * size-cutoff touch and the last trade; the others' scores and the depth within the maximum spread are RW's `summarize`
 * of that ladder under the market's programme (the universe lines and the day's dump carry it), so a reader recomputes
 * them: they would add 23 % to every minute's books (216 KB against 176 KB of gzip for 2,810 books, 2026-10-04).
 */
export const PM_REC_FIELDS = {
  books: ["id", "dt", "tick", "bid_px", "bid_sz", "ask_px", "ask_sz", "ab", "aa", "ltp"],
  universe: ["id", "dt", "rate", "v", "min_size", "tick", "bb", "ba", "ab", "aa", "q1", "q2", "dv_bid", "dv_ask", "d10_bid", "d10_ask", "n_bid", "n_ask", "ltp", "min_order", "vol24h", "liquidity"],
  prints: ["id", "ts", "side", "oi", "price", "size"],
} as const;
export type PmRecKind = keyof typeof PM_REC_FIELDS;
/**
 * The fields recorded as whole numbers, and what a reader multiplies each by for dollars or shares; each frame's header
 * carries its kind's as `scale`. The ladder's and the touches' prices are in 0.0001 and the ladder's sizes in hundredths;
 * every field not named is as served or computed (the last trade price, the programme, the scores and depths, the prints'
 * price and size).
 */
export const PM_REC_SCALE: Record<PmRecKind, Readonly<Record<string, number>>> = {
  books: { tick: 1e-4, bid_px: 1e-4, bid_sz: 0.01, ask_px: 1e-4, ask_sz: 0.01, ab: 1e-4, aa: 1e-4 },
  universe: { tick: 1e-4, bb: 1e-4, ba: 1e-4, ab: 1e-4, aa: 1e-4 },
  prints: {},
};

// ---------------------------------------------------------------------------------------------------- pure helpers

const iso = (ms: number) => new Date(ms).toISOString();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 240);
const enc = encodeURIComponent;
const num = (x: unknown): number | null => {
  if (x === null || x === undefined || x === "") return null;
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
};
const round2 = (x: number) => Math.round(x * 100) / 100;
export const minuteOf = (ms: number) => Math.floor(ms / M) * M;
export const hourOf = (ms: number) => Math.floor(ms / H) * H;
export const dayOf = (ms: number) => iso(Math.floor(ms / DAY) * DAY).slice(0, 10);

/** A price in the frames' unit, 0.0001: every tick Polymarket uses (0.1 to 0.0001, 0.005 and 0.0025 too) is whole in it. */
export const p4 = (p: number) => Math.round(p * 1e4);
/** A size in hundredths of a share: every size the CLOB served on 2026-10-04 (37,068 levels) was whole in it. */
export const s100 = (s: number) => Math.round(s * 100);
/** The universe's fifteenth a minute reads: the minute's index modulo `PM_REC_PHASES` (a market's is its id's). */
export const phaseOf = (minuteMs: number) => Math.floor(minuteMs / M) % PM_REC_PHASES;

export type Lv = [price: number, size: number];
/** One /books answer as served: levels as strings, the best not first (bids low to high, asks high to low). */
export type PmRecBookReply = {
  asset_id?: string; timestamp?: string; hash?: string; bids?: Array<{ price?: string; size?: string }>; asks?: Array<{ price?: string; size?: string }>;
  min_order_size?: string; tick_size?: string; neg_risk?: boolean; last_trade_price?: string;
};
/** A book as recorded: each side best first, only the levels within `PM_REC_WINDOW` of the side's best. */
export type PmRecLadder = { tick: number | null; ts: number | null; ltp: number | null; minOrder: number | null; bids: Lv[]; asks: Lv[]; allBids: number; allAsks: number };

/** The book's levels within 10 ¢ of each side's best, best first; a level outside (0, 1) or of no size is not a level. */
export function windowLadder(b: PmRecBookReply): PmRecLadder {
  const lv = (xs: unknown): Lv[] => (Array.isArray(xs) ? xs : [])
    .map((l) => [Number((l as Record<string, unknown>)?.price), Number((l as Record<string, unknown>)?.size)] as Lv)
    .filter(([p, s]) => Number.isFinite(p) && Number.isFinite(s) && p > 0 && p < 1 && s > 0);
  const bids = lv(b.bids).sort((x, y) => y[0] - x[0]), asks = lv(b.asks).sort((x, y) => x[0] - y[0]);
  const wb = bids.length ? bids.filter(([p]) => p >= bids[0][0] - PM_REC_WINDOW - 1e-9) : [];
  const wa = asks.length ? asks.filter(([p]) => p <= asks[0][0] + PM_REC_WINDOW + 1e-9) : [];
  const tick = num(b.tick_size), ts = num(b.timestamp);
  return {
    tick: tick !== null && tick > 0 ? tick : null, ts: ts !== null && ts > 0 ? ts : null, ltp: num(b.last_trade_price), minOrder: num(b.min_order_size),
    bids: wb, asks: wa, allBids: bids.length, allAsks: asks.length,
  };
}

/** A market's reward programme as the listing gives it. */
export type PmRecParams = { rate: number; v: number; minSize: number };
/**
 * A book's summary under its reward programme: RW's own `summarize` (the touch, the size-cutoff touch, the others'
 * scores q1 and q2 at the size-cutoff midpoint), the shares within the maximum spread `v` of that midpoint on each side
 * (every level, of any size), and the shares and levels within 10 ¢ of each side's best. One-sided, the size-cutoff
 * fields and the scores are null.
 */
export function bookSummary(l: Pick<PmRecLadder, "bids" | "asks">, p: Pick<PmRecParams, "v" | "minSize">) {
  const row = l.bids.length && l.asks.length ? summarize(l.bids, l.asks, p.v, p.minSize) : null;
  const ab = row ? row[2] : null, aa = row ? row[3] : null;
  const m = ab !== null && aa !== null ? (ab + aa) / 2 : null;
  const within = (xs: Lv[], side: 1 | -1) => (m === null ? null : round2(xs.reduce((s, [px, sz]) => {
    const d = side * (m - px) * 100;
    return 0 <= d && d < p.v ? s + sz : s;
  }, 0)));
  return {
    bb: l.bids[0]?.[0] ?? null, ba: l.asks[0]?.[0] ?? null, ab, aa, q1: row && ab !== null ? row[4] : null, q2: row && aa !== null ? row[5] : null,
    dvBid: within(l.bids, 1), dvAsk: within(l.asks, -1),
    d10Bid: round2(l.bids.reduce((s, [, sz]) => s + sz, 0)), d10Ask: round2(l.asks.reduce((s, [, sz]) => s + sz, 0)), nBid: l.bids.length, nAsk: l.asks.length,
  };
}

const opt4 = (p: number | null) => (p === null ? null : p4(p));
/**
 * One market's line of a minute's books frame (`PM_REC_FIELDS.books`): `dt` is the book's own time (the CLOB's
 * `timestamp`, its last update) less the minute, in ms; `ab` and `aa` the size-cutoff touch under the market's minimum
 * size, RW's. The timestamp is not a change marker: every book that changed from one minute to the next had moved it,
 * and so had 161 and 212 of the 640 and 725 whose every level came back the same, their `hash` with it (2026-10-04).
 */
export function bookLine(id: number, minuteMs: number, l: PmRecLadder, p: Pick<PmRecParams, "minSize">): unknown[] {
  const ab = l.bids.find(([, s]) => s >= p.minSize)?.[0] ?? null, aa = l.asks.find(([, s]) => s >= p.minSize)?.[0] ?? null;
  return [
    id, l.ts === null ? null : l.ts - minuteMs, opt4(l.tick), l.bids.map(([x]) => p4(x)), l.bids.map(([, y]) => s100(y)), l.asks.map(([x]) => p4(x)), l.asks.map(([, y]) => s100(y)),
    opt4(ab), opt4(aa), l.ltp,
  ];
}
/** One market's line of the universe's frame (`PM_REC_FIELDS.universe`): its programme, its book summarised, Gamma's last read. */
export function universeLine(id: number, minuteMs: number, l: PmRecLadder, p: PmRecParams, meta: { vol24h: number | null; liquidity: number | null }): unknown[] {
  const s = bookSummary(l, p);
  const usd = (x: number | null) => (x === null ? null : round2(x));
  return [
    id, l.ts === null ? null : l.ts - minuteMs, p.rate, p.v, p.minSize, opt4(l.tick), opt4(s.bb), opt4(s.ba), opt4(s.ab), opt4(s.aa), s.q1, s.q2, s.dvBid, s.dvAsk,
    s.d10Bid, s.d10Ask, s.nBid, s.nAsk, l.ltp, l.minOrder, usd(meta.vol24h), usd(meta.liquidity),
  ];
}

/** A frame's text: its header line, then one JSON line each. */
export const frameText = (header: Record<string, unknown>, lines: unknown[]) => [JSON.stringify(header), ...lines.map((x) => JSON.stringify(x))].join("\n") + "\n";

export type PmRecFrame = { header: Record<string, unknown>; rows: Array<Record<string, unknown>> };
/**
 * An archive object's text (gunzipped whole: its gzip members are its frames), or one frame's, as a study reads it: each
 * frame's header and its lines, every line named by the header's `fields` and multiplied back by its `scale` (prices in
 * dollars, sizes in shares). A header is the one kind of line that is an object with a version and a kind; a day's dump
 * of the markets is one header and an object a market, returned as they are. A line before any header is refused.
 */
export function readFrames(text: string): PmRecFrame[] {
  const out: PmRecFrame[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const x = JSON.parse(line);
    if (x && !Array.isArray(x) && typeof x === "object" && typeof x.v === "number" && typeof x.kind === "string") { out.push({ header: x, rows: [] }); continue; }
    const frame = out[out.length - 1];
    if (!frame) throw new Error("a line before any header");
    if (!Array.isArray(x)) { frame.rows.push(x); continue; }
    const fields = Array.isArray(frame.header.fields) ? frame.header.fields as string[] : [];
    const scale = (frame.header.scale ?? {}) as Record<string, number>;
    // toFixed(6): 0.0001 and 0.01 are not exact in binary, and every recorded value is whole in them.
    const back = (f: string, v: unknown): unknown => {
      const k = Number(scale[f] ?? 1);
      if (v === null || v === undefined || k === 1) return v ?? null;
      const one = (n: unknown) => (n === null ? null : Number((Number(n) * k).toFixed(6)));
      return Array.isArray(v) ? v.map(one) : one(v);
    };
    frame.rows.push(Object.fromEntries(fields.map((f, i) => [f, back(f, x[i])])));
  }
  return out;
}

export async function gzip(text: string): Promise<Uint8Array> {
  const s = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
/** Bytes as PostgREST writes a bytea: `\x` and hex. */
export function byteaHex(b: Uint8Array): string {
  const out = new Array<string>(b.length);
  for (let i = 0; i < b.length; i++) out[i] = HEX[b[i]];
  return "\\x" + out.join("");
}
/** Each character code's value as a hex digit, 255 for anything else. */
const HEX_VALUE = (() => {
  const t = new Uint8Array(128).fill(255);
  for (let i = 0; i < 16; i++) { t["0123456789abcdef".charCodeAt(i)] = i; t["0123456789ABCDEF".charCodeAt(i)] = i; }
  return t;
})();
/**
 * A bytea as PostgREST reads it back (`\x` and hex) as bytes; anything else is refused. By character code, not
 * `parseInt`: an hour of book frames is ~11 MB, and a parse a byte costs over a second of the run's CPU.
 */
export function byteaBytes(h: string): Uint8Array {
  if (typeof h !== "string" || !h.startsWith("\\x") || (h.length - 2) % 2) throw new Error("not a bytea in hex");
  const out = new Uint8Array((h.length - 2) / 2);
  for (let i = 0, j = 2; i < out.length; i++, j += 2) {
    const a = h.charCodeAt(j), b = h.charCodeAt(j + 1);
    const hi = a < 128 ? HEX_VALUE[a] : 255, lo = b < 128 ? HEX_VALUE[b] : 255;
    if (hi === 255 || lo === 255) throw new Error("not a bytea in hex");
    out[i] = (hi << 4) | lo;
  }
  return out;
}
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
export async function sha256Hex(b: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => HEX[x]).join("");
}

/** A market as the minute call reads it from `pm_rec_markets` (aliased short: it reads about 4,000 of them a minute). */
export type PmRecRow = {
  i: number; c: string; y: string; r: number | string; v: number | string; m: number | string; u: number | string | null; l: number | string | null; o: string | null;
};
export const PM_REC_ROW_SELECT = "i:id,c:cond,y:yes,r:rate,v:max_spread,m:min_size,u:volume24hr,l:liquidity,o:ours_until";
/** The minute's two reads of `pm_rec_markets`: the listed markets of the books set or the minute's fifteenth, and the held and quoted. */
export function minuteQueries(phase: number, nowIso: string): { listed: string; ours: string } {
  return {
    listed: `select=${PM_REC_ROW_SELECT}&delisted_at=is.null&or=(rate.gte.${PM_REC_MIN_RATE},phase.eq.${phase})&order=id.asc`,
    ours: `select=${PM_REC_ROW_SELECT}&ours_until=gt.${enc(nowIso)}&order=id.asc`,
  };
}
const rowParams = (r: PmRecRow): PmRecParams => ({ rate: Number(r.r) || 0, v: Number(r.v) || 0, minSize: Number(r.m) || 0 });

/**
 * The minute's two sets from its reads: the books set (every listed market of at least $10, and every held or quoted
 * one, listed or not) and the universe's fifteenth (the listed markets whose id is the minute's phase). Each is capped:
 * the books set keeps the held and quoted first, then the highest rates (ties by id); the fifteenth the highest rates.
 * What a cap cuts is counted, with the rate below which it cut.
 */
export function planMinute(listed: PmRecRow[], ours: PmRecRow[], phase: number, caps = { books: PM_REC_BOOKS_MAX, shard: PM_REC_SHARD_MAX }) {
  const oursIds = new Set(ours.map((r) => r.i)), listedIds = new Set(listed.map((r) => r.i));
  const byId = new Map<number, PmRecRow>();
  for (const r of [...listed, ...ours]) if (r.y) byId.set(r.i, r);
  const rank = (a: PmRecRow, b: PmRecRow) => (Number(b.r) - Number(a.r)) || (a.i - b.i);
  const booksAll = [...byId.values()].filter((r) => oursIds.has(r.i) || (listedIds.has(r.i) && Number(r.r) >= PM_REC_MIN_RATE))
    .sort((a, b) => (Number(oursIds.has(b.i)) - Number(oursIds.has(a.i))) || rank(a, b));
  const shardAll = [...byId.values()].filter((r) => listedIds.has(r.i) && r.i % PM_REC_PHASES === phase).sort(rank);
  const cut = (xs: PmRecRow[], n: number) => {
    const keep = xs.slice(0, Math.max(0, n)), gone = xs.slice(keep.length);
    return { keep, cut: gone.length, below: gone.length ? Number(gone[0].r) : null };
  };
  const books = cut(booksAll, caps.books), shard = cut(shardAll, caps.shard);
  return {
    books: books.keep, shard: shard.keep, ours: [...byId.keys()].filter((i) => oursIds.has(i)).length,
    cut: { books: books.cut, booksBelowRate: books.below, shard: shard.cut, shardBelowRate: shard.below },
  };
}

/** A print of the global tape as the recorder keeps it, with its identity (RW's: `pmPrints`' id) for the boundary. */
export type TapeRow = { cond: string; token: string; side: "BUY" | "SELL"; price: number; size: number; ts: number; key: string };
/** The tape's row (`/v2/trades`), or null when it is not a print. */
export function tapeRow(r: Record<string, unknown>): TapeRow | null {
  const side = r.side === "BUY" ? "BUY" : r.side === "SELL" ? "SELL" : null;
  const ts = num(r.timestamp), price = num(r.price), size = num(r.size);
  const cond = String(r.condition_id ?? "").toLowerCase(), token = String(r.token_id ?? "");
  if (!side || ts === null || price === null || size === null || !cond) return null;
  return { cond, token, side, price, size, ts, key: [r.transaction_hash, r.proxy_wallet, token.slice(-10), side, r.price, r.size, ts].join("|") };
}
/** Where the last run's prints ended: the newest second it read, and the prints of that second it had. */
export type PrintBoundary = { ts: number; keys: string[] };
/**
 * The prints of the books set the last run did not have: newer than its boundary, or of its boundary second and not
 * among that second's prints. The next boundary is the newest second read (of any market) and every print of it.
 * Lines are `PM_REC_FIELDS.prints`, oldest first: `oi` 0 for the YES token, 1 for the other.
 */
export function newPrints(rows: TapeRow[], boundary: PrintBoundary | null, sinceSec: number, books: Map<string, { id: number; yes: string }>) {
  const fresh = rows.filter((r) => (boundary ? r.ts > boundary.ts || (r.ts === boundary.ts && !boundary.keys.includes(r.key)) : r.ts >= sinceSec));
  const seen = new Set<string>();
  const kept = fresh.filter((r) => books.has(r.cond) && !seen.has(r.key) && seen.add(r.key))
    .sort((a, b) => a.ts - b.ts || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const lines = kept.map((r) => { const b = books.get(r.cond)!; return [b.id, r.ts, r.side, r.token === b.yes ? 0 : 1, r.price, r.size]; });
  const newest = rows.reduce((t, r) => Math.max(t, r.ts), -Infinity);
  const next: PrintBoundary | null = !rows.length ? boundary
    : boundary && boundary.ts > newest ? boundary
    : { ts: newest, keys: [...new Set([...(boundary?.ts === newest ? boundary.keys : []), ...rows.filter((r) => r.ts === newest).map((r) => r.key)])] };
  return { lines, next, newest: rows.length ? newest : null };
}

/** A fault reported at most once an hour while it lasts, and at once when it changes. Digits do not make a fault new. */
export function faultKey(errors: string[]): string {
  return errors.map((e) => e.replace(/\d+(\.\d+)?/g, "#")).sort().join(" | ").slice(0, 400);
}
export function reportDue(prev: { key: string; at: number } | null | undefined, key: string, now: number): boolean {
  if (!key) return false;
  return !prev || prev.key !== key || now - prev.at >= PM_REC_REPORT_EVERY_MS;
}

/** The archive's object for an hour of one kind's frames, and for a day's dump of the markets. */
export const archivePath = (kind: PmRecKind, hourMs: number) => `${kind}/${dayOf(hourMs)}/${iso(hourMs).slice(11, 13)}.jsonl.gz`;
export const dumpPath = (dayMs: number) => `markets/${dayOf(dayMs)}.jsonl.gz`;

/** The table's row of a market as the listing read, compared with the listing: what changed, and what the listing no longer has. */
export type PmRecTableRow = { id: number; cond: string; rate: number | string; max_spread: number | string; min_size: number | string; delisted_at: string | null };
/**
 * The listing against the table: markets new to it, markets whose programme changed or that are listed again (grouped
 * by what they become, so each group is one PATCH by id), and listed markets the listing no longer has.
 */
export function listingDiff(listing: Map<string, PmRewardRow>, table: PmRecTableRow[]) {
  const known = new Map(table.map((r) => [r.cond, r]));
  const newConds: string[] = [];
  const groups = new Map<string, { patch: { rate: number; max_spread: number; min_size: number; relist: boolean }; ids: number[] }>();
  const same = (a: number | string, b: number) => Math.abs(Number(a) - b) < 1e-9;
  for (const [cond, r] of listing) {
    const t = known.get(cond);
    if (!t) { newConds.push(cond); continue; }
    const relist = t.delisted_at !== null;
    if (!relist && same(t.rate, r.rate) && same(t.max_spread, r.v) && same(t.min_size, r.minSize)) continue;
    const k = JSON.stringify([r.rate, r.v, r.minSize, relist]);
    const g = groups.get(k) ?? { patch: { rate: r.rate, max_spread: r.v, min_size: r.minSize, relist }, ids: [] };
    g.ids.push(t.id);
    groups.set(k, g);
  }
  const delist = table.filter((t) => t.delisted_at === null && !listing.has(t.cond)).map((t) => t.id);
  return { newConds: newConds.sort(), changes: [...groups.values()], delist };
}

/** Gamma's market as a row of `pm_rec_markets` (its metadata), or null without a condition id and two tokens. */
export function gammaRow(m: Record<string, unknown>, now: number) {
  const cond = String(m.conditionId ?? "").toLowerCase();
  let toks: unknown = [];
  try { toks = typeof m.clobTokenIds === "string" ? JSON.parse(m.clobTokenIds) : m.clobTokenIds; } catch { toks = []; }
  if (!/^0x[0-9a-f]{64}$/.test(cond) || !Array.isArray(toks) || toks.length !== 2 || toks.some((t) => !/^\d+$/.test(String(t)))) return null;
  const ev = Array.isArray(m.events) && m.events.length && typeof m.events[0] === "object" ? m.events[0] as Record<string, unknown> : {};
  const text = (x: unknown, n = 200) => (typeof x === "string" && x ? x.slice(0, n) : null);
  const time = (x: unknown) => { const t = pmTime(x); return t === null ? null : iso(t); };
  return {
    cond, yes: String(toks[0]), no: String(toks[1]), question: text(m.question), slug: text(m.slug), event_slug: text(ev.slug), category: text(m.category ?? ev.category, 80),
    fee_type: text(m.feeType, 80), neg_risk: m.negRisk === true, end_date: time(m.endDate), game_start: time(m.gameStartTime),
    volume24hr: num(m.volume24hr), volume: num(m.volumeNum ?? m.volume), liquidity: num(m.liquidityNum ?? m.liquidity), competitive: num(m.competitive),
    accepting: m.enableOrderBook === true && m.acceptingOrders === true && m.closed !== true, closed: m.closed === true, gamma_at: iso(now),
  };
}

// ------------------------------------------------------------------------------------------------- the venue reads

type Fetch = typeof fetch;
const HOSTS = new Set([new URL(PM_CLOB).host, new URL(PM_DATA).host]);
async function venueCall(f: Fetch, method: "GET" | "POST", url: string, body: unknown, timeoutMs: number): Promise<{ ok: boolean; status: number; text: string }> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !HOSTS.has(u.host)) throw new Error(`pm-rec: host not allowed: ${u.host}`);
  if (method === "POST" && !(u.host === new URL(PM_CLOB).host && u.pathname === "/books")) throw new Error("pm-rec: POST only to /books");
  const res = await f(u.href, {
    method, redirect: "manual", signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: "application/json", "User-Agent": UA, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

/**
 * Every token's book, a hundred a POST, six at once, each POST tried twice; `onBook` sees each answer as it arrives (the
 * raw answer is dropped after it, so a minute never holds 4 MB of parsed books). A POST that fails twice skips its
 * hundred and says so; none starts once `late()` says the run's deadline passed.
 */
export async function readBooks(tokens: string[], o: { fetchImpl?: Fetch; timeoutMs?: number; late?: () => boolean; pause?: (ms: number) => Promise<void> }, onBook: (b: PmRecBookReply) => void) {
  const f = o.fetchImpl ?? fetch, pause = o.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const chunks: string[][] = [];
  for (let i = 0; i < tokens.length; i += PM_REC_BOOK_CHUNK) chunks.push(tokens.slice(i, i + PM_REC_BOOK_CHUNK));
  const out = { requests: 0, failed: 0, skipped: 0, books: 0, errors: [] as string[] };
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const chunk = chunks[next++];
      if (o.late?.()) { out.skipped += chunk.length; continue; }
      let rows: unknown = null, last = "";
      for (let attempt = 0; attempt < 2 && rows === null; attempt++) {
        if (attempt) await pause(500);
        out.requests++;
        try {
          const r = await venueCall(f, "POST", `${PM_CLOB}/books`, chunk.map((t) => ({ token_id: t })), o.timeoutMs ?? PM_REC_TIMEOUT_MS);
          if (!r.ok) { last = `${r.status} ${r.text.slice(0, 120)}`; continue; }
          rows = JSON.parse(r.text);
        } catch (e) { last = msg(e); }
      }
      if (!Array.isArray(rows)) { out.failed += chunk.length; if (out.errors.length < 5) out.errors.push(`books: ${last || "not a list"}`); continue; }
      for (const b of rows as PmRecBookReply[]) if (b && typeof b.asset_id === "string") { out.books++; onBook(b); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PM_REC_BOOK_CONCURRENCY, chunks.length) }, worker));
  return out;
}

/**
 * The global tape, newest first, page after page by its cursor, until a page reaches back past `sinceSec` (the last
 * run's boundary, or a minute back) or `PM_REC_PRINT_PAGES` are read. Each URL carries the read's own millisecond, so no
 * cached copy of an earlier read answers it (the data API is cached five minutes, `_shared/polymarket_public.ts`).
 */
export async function readTape(sinceSec: number, o: { fetchImpl?: Fetch; timeoutMs?: number; now: number; late?: () => boolean }) {
  const f = o.fetchImpl ?? fetch;
  const rows: TapeRow[] = [];
  let cursor = "", pages = 0, complete = false, error: string | null = null;
  while (pages < PM_REC_PRINT_PAGES && !o.late?.()) {
    const q = new URLSearchParams({ limit: String(PM_REC_PRINT_PAGE) });
    if (cursor) q.set("cursor", cursor);
    q.set("_", String(o.now + pages));
    let d: { data?: Array<Record<string, unknown>>; pagination?: { next_cursor?: string } };
    try {
      const r = await venueCall(f, "GET", `${PM_DATA}/v2/trades?${q}`, undefined, o.timeoutMs ?? PM_REC_TIMEOUT_MS);
      if (!r.ok) { error = `prints: ${r.status} ${r.text.slice(0, 120)}`; break; }
      d = JSON.parse(r.text);
    } catch (e) { error = `prints: ${msg(e)}`; break; }
    pages++;
    const page = (Array.isArray(d.data) ? d.data : []).map(tapeRow).filter((x): x is TapeRow => !!x);
    rows.push(...page);
    cursor = d.pagination?.next_cursor ?? "";
    const oldest = page.reduce((t, r) => Math.min(t, r.ts), Infinity);
    if (!page.length || oldest < sinceSec || !cursor) { complete = true; break; }
  }
  return { rows, pages, complete, error };
}

// --------------------------------------------------------------------------------------------- the minute call

export type PmRecDeps = {
  db: Db; now: number; holder: string; fetchImpl?: Fetch; clock?: () => number; pause?: (ms: number) => Promise<void>;
};
export type PmRecReport = {
  at: string; minute: string; skipped?: string; phase: number;
  books: { set: number; ours: number; cut: number; booksBelowRate: number | null; read: number; lines: number; levels: number; requests: number; failed: number };
  universe: { shard: number; cut: number; lines: number };
  prints: { pages: number; lines: number; complete: boolean };
  frames: Partial<Record<PmRecKind, number>>;
  ms: number; errors: string[]; report: boolean;
};
type StateRow = { id: number; state: Record<string, unknown> | null; updated_at: string | null };

/**
 * One minute: the lease, the minute's markets from `pm_rec_markets`, their books and the tape at once, then one frame
 * per kind (upserted on the minute and kind: a second run in the minute replaces the first's with a later read and
 * touches nothing else). With no market recorded yet it writes nothing: the meta call fills the table from the listing.
 */
export async function runPmRec(d: PmRecDeps): Promise<PmRecReport> {
  const clock = d.clock ?? (() => Date.now());
  const t0 = d.now, minute = minuteOf(t0), phase = phaseOf(minute);
  const report: PmRecReport = {
    at: iso(t0), minute: iso(minute), phase,
    books: { set: 0, ours: 0, cut: 0, booksBelowRate: null, read: 0, lines: 0, levels: 0, requests: 0, failed: 0 },
    universe: { shard: 0, cut: 0, lines: 0 }, prints: { pages: 0, lines: 0, complete: false }, frames: {}, ms: 0, errors: [], report: false,
  };
  const held = await d.db.claim("agent_locks", `name=eq.pm-rec&lease_until=lt.${enc(iso(t0))}`, { lease_until: iso(t0 + PM_REC_LEASE_MS), holder: d.holder });
  if (!held.length) return { ...report, skipped: "another run holds the pm-rec lease" };
  const late = () => clock() - t0 > PM_REC_READS_UNTIL_MS;
  let state: Record<string, unknown> = {};
  try {
    const states = await d.db.select<StateRow>("pm_rec_state", "id=in.(1,2)&select=id,state,updated_at");
    state = { ...(states.find((s) => s.id === 1)?.state ?? {}) };
    const meta = states.find((s) => s.id === 2);
    const metaAt = meta?.updated_at ? Date.parse(meta.updated_at) : NaN;

    // The meta call keeps the markets and the archive: past its limit it is reported (with this minute's faults).
    if (!(t0 - metaAt <= PM_REC_META_STALE_MS)) report.errors.push(`the meta call has not finished a run since ${Number.isFinite(metaAt) ? iso(metaAt) : "it began"}`);
    const q = minuteQueries(phase, iso(t0));
    const [listed, ours] = await Promise.all([d.db.selectAll<PmRecRow>("pm_rec_markets", q.listed), d.db.selectAll<PmRecRow>("pm_rec_markets", q.ours)]);
    if (!listed.length && !ours.length) {
      report.skipped = "no market recorded yet: the meta call fills pm_rec_markets from the reward listing";
      return report;
    }
    const plan = planMinute(listed, ours, phase);
    Object.assign(report.books, { set: plan.books.length, ours: plan.ours, cut: plan.cut.books, booksBelowRate: plan.cut.booksBelowRate });
    Object.assign(report.universe, { shard: plan.shard.length, cut: plan.cut.shard });

    // Which lines each token's book makes: a books line, a universe line, or both.
    const want = new Map<string, { a?: PmRecRow; b?: PmRecRow }>();
    for (const r of plan.books) want.set(r.y, { ...want.get(r.y), a: r });
    for (const r of plan.shard) want.set(r.y, { ...want.get(r.y), b: r });
    const bookLines: unknown[] = [], uniLines: unknown[] = [];
    let twoSided = 0;
    const onBook = (b: PmRecBookReply) => {
      const w = want.get(String(b.asset_id));
      if (!w) return;
      const l = windowLadder(b);
      if (w.a) {
        bookLines.push(bookLine(w.a.i, minute, l, { minSize: Number(w.a.m) || 0 }));
        report.books.levels += l.bids.length + l.asks.length;
        if (l.bids.length && l.asks.length) twoSided++;
      }
      if (w.b) uniLines.push(universeLine(w.b.i, minute, l, rowParams(w.b), { vol24h: num(w.b.u), liquidity: num(w.b.l) }));
      want.delete(String(b.asset_id));
    };

    // The tape, back to where the last run ended (or a minute), beside the books.
    const boundary = (state.prints && typeof state.prints === "object" ? state.prints : null) as PrintBoundary | null;
    const sinceSec = boundary ? boundary.ts : Math.floor(t0 / 1e3) - PM_REC_FIRST_PRINTS_S;
    const readT0 = clock();
    const [books, tape] = await Promise.all([
      readBooks([...want.keys()], { fetchImpl: d.fetchImpl, late, pause: d.pause }, onBook),
      readTape(sinceSec, { fetchImpl: d.fetchImpl, now: t0, late }),
    ]);
    const readMs = clock() - readT0;
    Object.assign(report.books, { read: books.books, requests: books.requests, failed: books.failed, lines: bookLines.length });
    report.universe.lines = uniLines.length;
    report.errors.push(...books.errors);
    if (tape.error) report.errors.push(tape.error);
    const bookOf = new Map(plan.books.map((r) => [String(r.c).toLowerCase(), { id: r.i, yes: r.y }]));
    const pr = newPrints(tape.rows, boundary, Math.floor(t0 / 1e3) - PM_REC_FIRST_PRINTS_S, bookOf);
    report.prints = { pages: tape.pages, lines: pr.lines.length, complete: tape.complete };

    // One frame per kind, its counts beside it in `detail`.
    const at = iso(clock());
    const read = { requests: books.requests, failed: books.failed, skipped: books.skipped, ms: readMs };
    const frames: Array<{ kind: PmRecKind; header: Record<string, unknown>; lines: unknown[]; detail: Record<string, unknown> }> = [
      {
        kind: "books", lines: bookLines,
        detail: { set: plan.books.length, ours: plan.ours, cut: plan.cut.books, booksBelowRate: plan.cut.booksBelowRate, read: bookLines.length, twoSided, levels: report.books.levels, ...read },
        header: { window: PM_REC_WINDOW, minRate: PM_REC_MIN_RATE },
      },
      { kind: "universe", lines: uniLines, detail: { phase, shard: plan.shard.length, cut: plan.cut.shard, read: uniLines.length, ...read }, header: { phase, phases: PM_REC_PHASES } },
      {
        kind: "prints", lines: pr.lines, detail: { pages: tape.pages, complete: tape.complete, since: sinceSec, newest: pr.newest, tape: tape.rows.length },
        header: { since: sinceSec, newest: pr.newest, complete: tape.complete },
      },
    ];
    const rows = [];
    for (const fr of frames) {
      const header = { v: 1, kind: fr.kind, minute: iso(minute), at, fields: PM_REC_FIELDS[fr.kind], scale: PM_REC_SCALE[fr.kind], n: fr.lines.length, ...fr.header };
      const data = await gzip(frameText(header, fr.lines));
      report.frames[fr.kind] = data.length;
      rows.push({ minute: iso(minute), kind: fr.kind, n: fr.lines.length, bytes: data.length, ms: readMs, detail: fr.detail, data: byteaHex(data), recorded_at: at, archived_at: null, lost: false });
    }
    await d.db.upsert("pm_rec_frames", rows, "minute,kind");
    if (pr.next) state.prints = pr.next;
  } catch (e) {
    report.errors.push(msg(e));
  } finally {
    report.ms = clock() - t0;
    const key = faultKey(report.errors);
    const prev = state.reported as { key: string; at: number } | undefined;
    if (reportDue(prev, key, clock())) { report.report = true; state.reported = { key, at: clock() }; }
    try {
      await d.db.upsert("pm_rec_state", [{
        id: 1, state, updated_at: iso(clock()), last_error: report.errors.length ? report.errors.join(" | ").slice(0, 1000) : null,
        ...(report.frames.books !== undefined ? { last_minute: iso(minute) } : {}),
      }], "id");
    } catch (e) { report.errors.push(`state: ${msg(e)}`); }
    try { await d.db.update("agent_locks", `name=eq.pm-rec&holder=eq.${enc(d.holder)}`, { lease_until: iso(clock()), holder: null }); }
    catch { /* the lease expires on its own */ }
  }
  return report;
}

// ----------------------------------------------------------------------------------------------- the archive store

/** Supabase Storage, as the meta call uses it: the service key's private bucket. The tests' double implements the same. */
export type PmRecStorage = {
  upload(path: string, bytes: Uint8Array): Promise<{ ok: boolean; status: number; error?: string }>;
  /** Signed URLs (absolute) for `paths`, by path; a path the store could not sign is missing. */
  sign(paths: string[], expiresInS: number): Promise<Map<string, string>>;
  createBucket(): Promise<{ ok: boolean; status: number; error?: string }>;
};
/** The store over HTTP: `${sbUrl}/storage/v1`, the service key as bearer, the bucket private. */
export function pmRecStorage(sbUrl: string, key: string, f: Fetch = fetch, timeoutMs = 30e3): PmRecStorage {
  const base = `${sbUrl}/storage/v1`, auth = { Authorization: `Bearer ${key}`, apikey: key };
  const call = async (path: string, body: BodyInit, type: string, extra: Record<string, string> = {}) => {
    try {
      const res = await f(`${base}${path}`, { method: "POST", headers: { ...auth, "Content-Type": type, ...extra }, body, signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    } catch (e) { return { ok: false, status: 0, text: msg(e) }; }
  };
  return {
    upload: async (path, bytes) => {
      const r = await call(`/object/${PM_REC_BUCKET}/${path}`, bytes, "application/gzip", { "x-upsert": "true" });
      return r.ok ? { ok: true, status: r.status } : { ok: false, status: r.status, error: r.text.slice(0, 200) };
    },
    sign: async (paths, expiresInS) => {
      const out = new Map<string, string>();
      if (!paths.length) return out;
      const r = await call(`/object/sign/${PM_REC_BUCKET}`, JSON.stringify({ expiresIn: expiresInS, paths }), "application/json");
      if (!r.ok) return out;
      try {
        for (const x of JSON.parse(r.text) as Array<{ path?: string; signedURL?: string; error?: string | null }>) {
          if (x && typeof x.path === "string" && typeof x.signedURL === "string" && !x.error) out.set(x.path, `${base}${x.signedURL}`);
        }
      } catch { /* an unreadable answer signs nothing */ }
      return out;
    },
    createBucket: async () => {
      const r = await call("/bucket", JSON.stringify({ id: PM_REC_BUCKET, name: PM_REC_BUCKET, public: false }), "application/json");
      return r.ok || /already exists/i.test(r.text) ? { ok: true, status: r.status } : { ok: false, status: r.status, error: r.text.slice(0, 200) };
    },
  };
}
/** An upload refused because the bucket is not there yet (the first archive creates it). */
const noBucket = (r: { status: number; error?: string }) => r.status === 404 || /bucket not found/i.test(r.error ?? "");

// ----------------------------------------------------------------------------------------------- the meta call

export type PmRecMetaDeps = {
  db: Db; now: number; holder: string; clock?: () => number;
  /** The order path's keyless wire (`pmVenue` with no credentials and sends off): the reward listing and Gamma. */
  venue: PmVenue;
  /** The keyless public reads' options (the CLOB's short list of markets, for new markets' tokens). */
  pm?: PmPublicOpts;
  /** Supabase Storage; null when the function has no service key (nothing is archived, and that is reported). */
  storage: PmRecStorage | null;
};
export type PmRecMetaReport = {
  at: string; skipped?: string;
  ours: { conds: number; ids: number; added: number; sources: Record<string, number | string> };
  listing: { read: boolean; rows?: number; pages?: number; how?: string; added?: number; noTokens?: number; changed?: number; delisted?: number; tokensBy?: string };
  gamma: { asked: number; found: number };
  archive: Array<{ hour: string; kind: string; frames: number; bytes: number }>;
  dump: { day: string; rows: number; bytes: number } | null;
  resigned: number; ms: number; errors: string[]; report: boolean;
};
type FrameRow = { minute: string; kind: PmRecKind; n: number; bytes: number; data: string | null };

/**
 * Every five minutes: the held and quoted markets, the reward listing when 15 minutes old, Gamma's metadata for the 250
 * oldest-read markets, and, on a run that did not read the listing, the archive of each closed hour (oldest first), the
 * day's dump of the markets and the URLs about to expire. Each step is idempotent, so a second run in its minute changes
 * nothing a first did; none starts past `PM_REC_META_UNTIL_MS`.
 */
export async function runPmRecMeta(d: PmRecMetaDeps): Promise<PmRecMetaReport> {
  const clock = d.clock ?? (() => Date.now());
  const t0 = d.now;
  const report: PmRecMetaReport = {
    at: iso(t0), ours: { conds: 0, ids: 0, added: 0, sources: {} }, listing: { read: false }, gamma: { asked: 0, found: 0 }, archive: [], dump: null,
    resigned: 0, ms: 0, errors: [], report: false,
  };
  const held = await d.db.claim("agent_locks", `name=eq.pm-rec-meta&lease_until=lt.${enc(iso(t0))}`, { lease_until: iso(t0 + PM_REC_META_LEASE_MS), holder: d.holder });
  if (!held.length) return { ...report, skipped: "another run holds the pm-rec-meta lease" };
  const late = () => clock() - t0 > PM_REC_META_UNTIL_MS;
  const dl: PmDeadline = { clock, until: t0 + PM_REC_META_UNTIL_MS - 10e3 };
  let state: Record<string, unknown> = {};
  const err = (where: string, e: unknown) => { if (report.errors.length < 20) report.errors.push(`${where}: ${msg(e)}`); };
  try {
    const [st] = await d.db.select<StateRow>("pm_rec_state", "id=eq.2&select=id,state,updated_at");
    state = { ...(st?.state ?? {}) };

    // 1. The held and quoted markets: each source's conditions, their ids, and Gamma for any the table lacks.
    try { await refreshOurs(d, report, t0); } catch (e) { err("ours", e); }

    // 2. The reward listing, when it is due.
    const listingAt = Number(state.listingAt ?? 0);
    if (!late() && t0 - listingAt >= PM_REC_LISTING_EVERY_MS - 30e3) {
      try {
        const done = await refreshListing(d, report, t0, dl);
        if (done) { state.listingAt = t0; state.firstListingAt ??= t0; }
      } catch (e) { err("listing", e); }
    }

    // 3. Gamma's metadata, the oldest-read first.
    if (!late()) { try { await refreshGamma(d, report, t0); } catch (e) { err("gamma", e); } }

    // 4–6. The archive, the dump and the URLs: on a run that did not read the listing (its CPU is the run's).
    if (!report.listing.read) {
      if (!d.storage) report.errors.push("archive: no storage (the function has no service key): frames stay in the database until the hourly job drops them");
      else {
        try { await archiveHours(d, report, t0, late); } catch (e) { err("archive", e); }
        const dumpDay = String(state.dumpDay ?? "");
        if (!late() && dayOf(t0) !== dumpDay && t0 - Date.parse(`${dayOf(t0)}T00:00:00Z`) >= PM_REC_DUMP_AFTER_MS) {
          try { if (await dumpMarkets(d, report, t0)) state.dumpDay = dayOf(t0); } catch (e) { err("dump", e); }
        }
        if (!late()) { try { await resignUrls(d, report, t0); } catch (e) { err("resign", e); } }
      }
    }

    // 7. Is the minute call writing? Its newest books frame, once the table has had markets for longer than the limit.
    const since = Number(state.firstListingAt ?? NaN);
    if (t0 - since > PM_REC_BOOKS_STALE_MS) {
      try {
        const [f] = await d.db.select<{ minute: string }>("pm_rec_frames", "kind=eq.books&select=minute&order=minute.desc&limit=1");
        const at = f ? Date.parse(f.minute) : NaN;
        if (!(t0 - at <= PM_REC_BOOKS_STALE_MS)) report.errors.push(`the minute call has written no books frame since ${Number.isFinite(at) ? iso(at) : "it began"}`);
      } catch (e) { err("books check", e); }
    }
  } catch (e) {
    err("meta", e);
  } finally {
    report.ms = clock() - t0;
    const key = faultKey(report.errors);
    const prev = state.reported as { key: string; at: number } | undefined;
    if (reportDue(prev, key, clock())) { report.report = true; state.reported = { key, at: clock() }; }
    state.last = { listing: report.listing, gamma: report.gamma, archived: report.archive.length, ours: report.ours.ids };
    try {
      await d.db.upsert("pm_rec_state", [{ id: 2, state, updated_at: iso(clock()), last_error: report.errors.length ? report.errors.join(" | ").slice(0, 1000) : null }], "id");
    } catch (e) { report.errors.push(`state: ${msg(e)}`); }
    try { await d.db.update("agent_locks", `name=eq.pm-rec-meta&holder=eq.${enc(d.holder)}`, { lease_until: iso(clock()), holder: null }); }
    catch { /* the lease expires on its own */ }
  }
  return report;
}

/** Gamma's records of `conds`, fifty a read, open ones; and which of `conds` it did not return. */
async function gammaRecords(venue: PmVenue, conds: string[], now: number) {
  const rows: Array<NonNullable<ReturnType<typeof gammaRow>>> = [];
  for (let i = 0; i < conds.length; i += GAMMA_CHUNK) {
    const r = await venue.gammaByConditions(conds.slice(i, i + GAMMA_CHUNK), false);
    if (!r.ok) throw new Error(`gamma markets/keyset: ${r.status} ${r.error ?? ""}`.trim());
    for (const m of Array.isArray(r.data?.markets) ? r.data!.markets! : []) { const g = gammaRow(m, now); if (g) rows.push(g); }
  }
  const got = new Set(rows.map((r) => r.cond));
  return { rows, missing: conds.filter((c) => !got.has(c)) };
}

/** The held and quoted markets' ids, given `ours_until`; Gamma adds any the table lacks (listed or not: the listing tells). */
async function refreshOurs(d: PmRecMetaDeps, report: PmRecMetaReport, t0: number) {
  const conds = new Set<string>();
  const since = enc(iso(t0 - PM_REC_OURS_SINCE_MS)), day = dayOf(t0);
  await Promise.all(PM_REC_OURS_SOURCES.map(async (s) => {
    try {
      const rows = await d.db.select<{ cond: string }>(s.table, s.query(since, day));
      for (const r of rows) if (typeof r.cond === "string" && r.cond) conds.add(r.cond.toLowerCase());
      report.ours.sources[s.name] = rows.length;
    } catch (e) { report.ours.sources[s.name] = `unread: ${msg(e).slice(0, 80)}`; }
  }));
  report.ours.conds = conds.size;
  if (!conds.size) return;
  const list = [...conds].sort(), ids = new Map<string, number>();
  for (let i = 0; i < list.length; i += 40) {
    const rows = await d.db.select<{ id: number; cond: string }>("pm_rec_markets", `cond=in.(${list.slice(i, i + 40).join(",")})&select=id,cond`);
    for (const r of rows) ids.set(r.cond, r.id);
  }
  const absent = list.filter((c) => !ids.has(c)).slice(0, 2 * GAMMA_CHUNK);
  if (absent.length) {
    const g = await gammaRecords(d.venue, absent, t0);
    if (g.rows.length) {
      // Not known listed: the next listing lists it again with its programme, or leaves it delisted.
      await d.db.upsert("pm_rec_markets", g.rows.map((r) => ({ ...r, delisted_at: iso(t0) })), "cond");
      report.ours.added = g.rows.length;
      for (let i = 0; i < g.rows.length; i += 40) {
        const rows = await d.db.select<{ id: number; cond: string }>("pm_rec_markets", `cond=in.(${g.rows.slice(i, i + 40).map((r) => r.cond).join(",")})&select=id,cond`);
        for (const r of rows) ids.set(r.cond, r.id);
      }
    }
  }
  const idList = [...ids.values()].sort((a, b) => a - b);
  report.ours.ids = idList.length;
  for (let i = 0; i < idList.length; i += 500) {
    await d.db.update("pm_rec_markets", `id=in.(${idList.slice(i, i + 500).join(",")})`, { ours_until: iso(t0 + PM_REC_OURS_HOLD_MS) });
  }
}

/** The listing read whole (the order path's `rewardListing`) and applied to the table; false when it could not be read. */
async function refreshListing(d: PmRecMetaDeps, report: PmRecMetaReport, t0: number, dl: PmDeadline): Promise<boolean> {
  const l = await rewardListing(d.venue, dl);
  report.listing = { read: true, rows: l.rows.size, pages: l.pages, how: l.how };
  if (!l.ok) { report.errors.push(`listing: ${l.error ?? "not read whole"}`); return false; }
  const table = await d.db.selectAll<PmRecTableRow>("pm_rec_markets", "select=id,cond,rate,max_spread,min_size,delisted_at&order=id.asc");
  const diff = listingDiff(l.rows, table);
  // New markets: their tokens from Gamma (with its metadata), or from the CLOB's short list when there are many. One
  // that neither names is not added and is counted: it is new again at the next listing, and its tokens are looked for
  // again then. The short list is read page by page while it moves: it lacked 12 of 18,895 listed markets in the first
  // run measured and 219 of 18,926 in another read (2026-10-04, `measure_out.txt`, `design_out.txt`).
  let added = 0;
  if (diff.newConds.length) {
    const rowOf = (cond: string) => { const r = l.rows.get(cond)!; return { rate: r.rate, max_spread: r.v, min_size: r.minSize, params_at: iso(t0), delisted_at: null }; };
    if (diff.newConds.length > PM_REC_NEW_BY_GAMMA_MAX) {
      report.listing.tokensBy = "clob";
      const simple = new Map([...await pmSimplifiedMarkets(d.pm ?? {})].map(([c, t]) => [c.toLowerCase(), t]));
      const rows = diff.newConds.filter((c) => simple.has(c)).map((c) => ({ cond: c, yes: simple.get(c)!.yes, no: simple.get(c)!.no, ...rowOf(c) }));
      for (let i = 0; i < rows.length; i += 1000) await d.db.upsert("pm_rec_markets", rows.slice(i, i + 1000), "cond");
      added = rows.length;
    } else {
      report.listing.tokensBy = "gamma";
      const g = await gammaRecords(d.venue, diff.newConds, t0);
      const rows = g.rows.map((r) => ({ ...r, ...rowOf(r.cond) }));
      if (rows.length) await d.db.upsert("pm_rec_markets", rows, "cond");
      added = rows.length;
    }
  }
  for (const c of diff.changes) {
    const { relist, ...p } = c.patch;
    for (let i = 0; i < c.ids.length; i += 500) {
      await d.db.update("pm_rec_markets", `id=in.(${c.ids.slice(i, i + 500).join(",")})`, { ...p, params_at: iso(t0), ...(relist ? { delisted_at: null } : {}) });
    }
  }
  for (let i = 0; i < diff.delist.length; i += 500) {
    await d.db.update("pm_rec_markets", `id=in.(${diff.delist.slice(i, i + 500).join(",")})`, { delisted_at: iso(t0) });
  }
  Object.assign(report.listing, { added, noTokens: diff.newConds.length - added, changed: diff.changes.reduce((s, c) => s + c.ids.length, 0), delisted: diff.delist.length });
  return true;
}

/**
 * Gamma's metadata for the listed markets read longest ago (a market never read carries `gamma_at` 'epoch', so it comes
 * first). A held or quoted market the listing no longer has keeps what Gamma said when it was added.
 */
async function refreshGamma(d: PmRecMetaDeps, report: PmRecMetaReport, t0: number) {
  const due = await d.db.select<{ id: number; cond: string }>("pm_rec_markets",
    `select=id,cond&delisted_at=is.null&order=gamma_at.asc,id.asc&limit=${PM_REC_GAMMA_PER_RUN}`);
  report.gamma.asked = due.length;
  if (!due.length) return;
  const g = await gammaRecords(d.venue, due.map((r) => r.cond), t0);
  report.gamma.found = g.rows.length;
  if (g.rows.length) await d.db.upsert("pm_rec_markets", g.rows, "cond");
  // Not among Gamma's open markets: read now, and not accepting orders.
  const gone = new Set(g.missing), ids = due.filter((r) => gone.has(r.cond)).map((r) => r.id);
  if (ids.length) await d.db.update("pm_rec_markets", `id=in.(${ids.join(",")})`, { gamma_at: iso(t0), accepting: false });
}

/** An upload, creating the bucket the first time. */
async function upload(storage: PmRecStorage, path: string, bytes: Uint8Array) {
  let r = await storage.upload(path, bytes);
  if (!r.ok && noBucket(r)) {
    const b = await storage.createBucket();
    if (!b.ok) throw new Error(`bucket ${PM_REC_BUCKET}: ${b.status} ${b.error ?? ""}`.trim());
    r = await storage.upload(path, bytes);
  }
  if (!r.ok) throw new Error(`upload ${path}: ${r.status} ${r.error ?? ""}`.trim());
}

/**
 * Each closed hour's frames still holding data, oldest first, one kind at a time: concatenated into one object, uploaded,
 * signed, recorded in `pm_rec_archive`, and only then cleared (data null, `archived_at` set). A failure leaves the frames
 * as they were; the next run does it again, the same object replaced.
 */
async function archiveHours(d: PmRecMetaDeps, report: PmRecMetaReport, t0: number, late: () => boolean) {
  const closedBefore = hourOf(t0 - PM_REC_ARCHIVE_AFTER_MS);
  for (let k = 0; k < PM_REC_ARCHIVE_PER_RUN && !late(); k++) {
    // A frame holds its data until it is archived (`archived_at`) or dropped by the hourly job (`lost`).
    const [oldest] = await d.db.select<{ minute: string; kind: PmRecKind }>("pm_rec_frames",
      `archived_at=is.null&lost=eq.false&minute=lt.${enc(iso(closedBefore))}&select=minute,kind&order=minute.asc,kind.asc&limit=1`);
    if (!oldest) return;
    const hour = hourOf(Date.parse(oldest.minute)), kind = oldest.kind;
    // Twenty frames a read, each decoded as it arrives: an hour of book frames is ~10 MB, ~20 MB more as hex.
    const held: Array<{ minute: string; n: number; bytes: Uint8Array }> = [], empty: string[] = [];
    let after = "";
    for (;;) {
      const page = await d.db.select<FrameRow>("pm_rec_frames",
        `kind=eq.${kind}&minute=gte.${enc(iso(hour))}&minute=lt.${enc(iso(hour + H))}${after}&archived_at=is.null&lost=eq.false&select=minute,kind,n,bytes,data&order=minute.asc&limit=${ARCHIVE_READ_FRAMES}`);
      for (const f of page) {
        if (typeof f.data === "string" && f.data.length > 2) held.push({ minute: f.minute, n: Number(f.n || 0), bytes: byteaBytes(f.data) });
        else empty.push(f.minute);
      }
      if (page.length < ARCHIVE_READ_FRAMES) break;
      after = `&minute=gt.${enc(page[page.length - 1].minute)}`;
    }
    // A frame with no data to archive (none is written so) is marked lost, so it never holds the archive at its hour.
    for (const m of empty) await d.db.update("pm_rec_frames", `kind=eq.${kind}&minute=eq.${enc(m)}`, { lost: true });
    if (!held.length) continue;
    const bytes = concatBytes(held.map((f) => f.bytes));
    const path = archivePath(kind, hour);
    await upload(d.storage!, path, bytes);
    const urls = await d.storage!.sign([path], PM_REC_URL_DAYS * 86400);
    const url = urls.get(path) ?? null;
    if (!url) report.errors.push(`archive: ${path} uploaded but not signed (signed again on a later run)`);
    const first = held[0].minute, last = held[held.length - 1].minute;
    await d.db.upsert("pm_rec_archive", [{
      hour: iso(hour), kind, path, frames: held.length, lines: held.reduce((s, f) => s + Number(f.n || 0), 0), bytes: bytes.length,
      first_minute: first, last_minute: last, sha256: await sha256Hex(bytes), url, url_expires: url ? iso(t0 + PM_REC_URL_DAYS * DAY) : iso(t0), archived_at: iso(t0),
    }], "hour,kind");
    // Only then are the frames cleared: the hour is closed, so the range holds exactly the frames just read.
    await d.db.update("pm_rec_frames", `kind=eq.${kind}&minute=gte.${enc(first)}&minute=lte.${enc(last)}&archived_at=is.null`, { data: null, archived_at: iso(t0) });
    report.archive.push({ hour: iso(hour), kind, frames: held.length, bytes: bytes.length });
  }
}

/** The day's dump of `pm_rec_markets` (every column, a line a market): the ids the day's frames name, and their metadata. */
async function dumpMarkets(d: PmRecMetaDeps, report: PmRecMetaReport, t0: number): Promise<boolean> {
  const rows = await d.db.selectAll<Record<string, unknown>>("pm_rec_markets", "select=*&order=id.asc");
  if (!rows.length) return false;
  const day = Date.parse(`${dayOf(t0)}T00:00:00Z`);
  const bytes = await gzip(frameText({ v: 1, kind: "markets", day: dayOf(t0), at: iso(t0), n: rows.length }, rows));
  const path = dumpPath(day);
  await upload(d.storage!, path, bytes);
  const url = (await d.storage!.sign([path], PM_REC_URL_DAYS * 86400)).get(path) ?? null;
  await d.db.upsert("pm_rec_archive", [{
    hour: iso(day), kind: "markets", path, frames: 1, lines: rows.length, bytes: bytes.length, first_minute: iso(t0), last_minute: iso(t0),
    sha256: await sha256Hex(bytes), url, url_expires: url ? iso(t0 + PM_REC_URL_DAYS * DAY) : iso(t0), archived_at: iso(t0),
  }], "hour,kind");
  report.dump = { day: dayOf(t0), rows: rows.length, bytes: bytes.length };
  return true;
}

/** Archive URLs that expire within `PM_REC_RESIGN_DAYS` (or were never signed), signed again for a year. */
async function resignUrls(d: PmRecMetaDeps, report: PmRecMetaReport, t0: number) {
  const due = await d.db.select<{ hour: string; kind: string; path: string }>("pm_rec_archive",
    `url_expires=lt.${enc(iso(t0 + PM_REC_RESIGN_DAYS * DAY))}&select=hour,kind,path&order=url_expires.asc&limit=100`);
  if (!due.length) return;
  const urls = await d.storage!.sign(due.map((r) => r.path), PM_REC_URL_DAYS * 86400);
  for (const r of due) {
    const url = urls.get(r.path);
    if (!url) continue;
    await d.db.update("pm_rec_archive", `hour=eq.${enc(r.hour)}&kind=eq.${r.kind}`, { url, url_expires: iso(t0 + PM_REC_URL_DAYS * DAY) });
    report.resigned++;
  }
}
