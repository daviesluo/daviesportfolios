// Polymarket's view-count markets and the YouTube counters they resolve on, RECORDED. Nothing here trades, and nothing
// reads these tables but a study that is pre-registered before it reads them (Davies, 2026-09-26: "YOUTUBE_API_KEY
// 加好了"). Two things cannot be pulled after the fact: a video's view counter as it moved (the API returns only the
// current number) and the order books (no one keeps them). Prints and market records can be, from the data API and
// Gamma, so they are not stored here.
//
// Every minute: the open view markets (Gamma's YouTube tag, every fifth minute), the channels and uploads they name,
// each tracked video's counter, the channels' totals (every fifth minute) and the YES book of every open view market
// (a NO book is its mirror: measured 2026-09-27, each YES ask is a NO bid at one minus the price, size for size).
// Around each market's deadline (the video's posting time + the hours the market counts) that video's counter and its
// markets' books are read every second, the fastest a study may assume (Davies, 2026-09-26), from 15 minutes before
// to 3 after, and every 10 s in the 45 minutes before that. The probe found the API publishing a video's views in
// batches at least 30 s apart (reference §6): one-second reads place each batch, and the market's answer to it, to
// within a second.
//
// Quota: 10,000 units a Pacific day. The minute's reads cost about 2,300 units a day and a deadline's windows about
// 1,350; past `YT_WINDOW_BUDGET` units in the day the windows read books only, past `YT_DAY_BUDGET` nothing reads
// YouTube, and a quota refusal stops YouTube reads for the rest of the run.
//
// Storage is change-only, as `books.ts` does it: a row is a value first read at `ts` and read again, unchanged, until
// `seen_until` (`reads` reads in all). A counter that stood still is told apart from one nobody read, and the instant
// a batch landed lies between one row's `seen_until` and the next row's `ts`. A value last seen more than three
// minutes before is not extended across the gap: the next read starts a new row.

import type { Db } from "./db.ts";
import { ytGet, type YtEnv, type YtRead, type YtReply } from "./youtube.ts";
import { pmBooks, pmOpenEventsByTag, type PmBook, type PmPublicOpts } from "../_shared/polymarket_public.ts";

/** Gamma's YouTube tag, under which every view-count event is listed (2026-09-26: 6 open, 353 closed). */
export const VIEWS_TAG = "146";
export const VIEWS_DISCOVER_EVERY_MIN = 5;
export const VIEWS_CHANNEL_EVERY_MIN = 5;
/** A market the last three discoveries did not find open is left alone. */
export const VIEWS_MARKET_STALE_MS = 3 * VIEWS_DISCOVER_EVERY_MIN * 60e3;
/** Uploads read every minute: the longest market counts 7 days after posting, and a day's margin. */
export const VIEWS_TRACK_MS = 8 * 86_400e3;
/** A Short, which no market counts ("Shorts, previews, or other videos … will not be considered"); YouTube allows three minutes. */
export const SHORT_MAX_S = 180;
export const HOT_BEFORE_MS = 15 * 60e3;
export const HOT_AFTER_MS = 3 * 60e3;
export const WARM_BEFORE_MS = 60 * 60e3;
export const HOT_GAP_MS = 1_000;
export const WARM_GAP_MS = 10_000;
/** A run reads until this far into its minute (`runEnd`), so its reply reaches the cron call inside its 59 s. */
export const VIEWS_RUN_MS = 56_000;
export const VIEWS_LEASE_MS = 59_000;
export const VIEWS_FLUSH_MS = 10_000;
/** A value last seen longer ago than this is not extended: the next read starts a new row. */
export const VIEWS_OPEN_ROW_MS = 3 * 60e3;
/** Units in a Pacific day past which the windows stop reading YouTube, and past which nothing does. */
export const YT_WINDOW_BUDGET = 9_000;
export const YT_DAY_BUDGET = 9_800;
export const VIEW_BOOK_LEVELS = 5;
/** The window reads' own timeout: a slow read must not hold up the next second's. */
const WINDOW_TIMEOUT_MS = 5_000;

export type ViewMarketRow = {
  cond: string; yes: string; no: string; event_slug: string; event_start: string | null; label: string | null; question: string | null;
  handle: string | null; video_id: string | null; window_h: number | null; last_seen: string;
};
export type ChannelRow = { channel_id: string; handle: string | null; title: string | null; uploads: string | null };
export type VideoRow = { video_id: string; channel_id: string; title: string | null; published_at: string; duration_s: number | null; short: boolean };
export type Deadline = { video_id: string; at: number; tokens: string[] };

const num = (x: unknown): number | null => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));

/** How many hours after posting a market counts ("in the first 24 hours", "in the first 7 days"); null when it does not say. */
export function windowHoursOf(text: string): number | null {
  const m = /\bfirst\s+(\d+)\s+(hours?|days?|weeks?)\b/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]), u = m[2].toLowerCase();
  return u.startsWith("hour") ? n : u.startsWith("day") ? n * 24 : n * 168;
}

/** An event about a YouTube counter: views or subscribers in its slug or title, and a channel link in its rules. */
export function isViewEvent(ev: Record<string, unknown>): boolean {
  return /views|subscribers/i.test(`${ev.slug ?? ""} ${ev.title ?? ""}`) && /youtube\.com\/@/i.test(String(ev.description ?? ""));
}

/** The open markets of one Gamma event, with what its rules name: the channel's handle, the video when it names one, the hours counted. */
export function viewMarketsOf(ev: Record<string, unknown>, at: string): ViewMarketRow[] {
  if (!isViewEvent(ev)) return [];
  const desc = String(ev.description ?? "");
  const handle = /youtube\.com\/(@[A-Za-z0-9_.-]+)/i.exec(desc)?.[1]?.replace(/\.+$/, "") ?? null;   // a sentence's full stop is not the handle's
  const video = /youtube\.com\/watch\?(?:[^\s)"'<>]*&)?v=([A-Za-z0-9_-]{11})/i.exec(desc)?.[1] ?? /youtu\.be\/([A-Za-z0-9_-]{11})/i.exec(desc)?.[1] ?? null;
  const windowH = windowHoursOf(desc);
  const out: ViewMarketRow[] = [];
  for (const raw of Array.isArray(ev.markets) ? ev.markets : []) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    if (m.closed === true || m.enableOrderBook === false || typeof m.conditionId !== "string") continue;
    let toks: unknown = [];
    try { toks = JSON.parse(String(m.clobTokenIds ?? "[]")); } catch { toks = []; }
    if (!Array.isArray(toks) || toks.length !== 2) continue;
    out.push({
      cond: m.conditionId, yes: String(toks[0]), no: String(toks[1]), event_slug: String(ev.slug ?? ""),
      event_start: typeof ev.startDate === "string" ? ev.startDate : null,
      label: typeof m.groupItemTitle === "string" ? m.groupItemTitle.slice(0, 80) : null,
      question: typeof m.question === "string" ? m.question.slice(0, 200) : null,
      handle, video_id: video, window_h: windowH, last_seen: at,
    });
  }
  return out;
}

/** An ISO 8601 duration (`PT16M19S`) in seconds; null when it is not one. */
export function isoSeconds(d: unknown): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(d ?? ""));
  if (!m || String(d) === "P" || String(d).endsWith("T")) return null;
  return Number(m[1] ?? 0) * 86_400 + Number(m[2] ?? 0) * 3_600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

/** Google's quota day, which ends at midnight Pacific time. */
export function pacificDay(ms: number): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  } catch {
    return new Date(ms - 8 * 3_600e3).toISOString().slice(0, 10);
  }
}

/**
 * The video a market counts: the one its rules name, or else the channel's first upload that is not a Short posted at
 * or after the event was created ("the next YouTube video posted by MrBeast after this market's creation"). A market
 * that counts no hours after posting is about the channel's totals and has no video.
 */
export function marketVideo(m: ViewMarketRow, videos: VideoRow[], channels: ChannelRow[]): VideoRow | null {
  if (m.video_id) return videos.find((v) => v.video_id === m.video_id) ?? null;
  if (m.window_h == null || !m.handle || !m.event_start) return null;   // a channel's totals, not a video's views
  const handle = m.handle.toLowerCase();
  const ch = channels.find((c) => (c.handle ?? "").toLowerCase() === handle);
  const start = Date.parse(m.event_start);
  if (!ch || !Number.isFinite(start)) return null;
  return videos
    .filter((v) => v.channel_id === ch.channel_id && !v.short && Date.parse(v.published_at) >= start)
    .sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at))[0] ?? null;
}

/** Each instant a market's count is taken, with the YES tokens of every open market on that video. */
export function deadlinesOf(markets: ViewMarketRow[], videos: VideoRow[], channels: ChannelRow[]): Deadline[] {
  const tokensOf = new Map<string, string[]>();
  const pairs: { m: ViewMarketRow; v: VideoRow }[] = [];
  for (const m of markets) {
    const v = marketVideo(m, videos, channels);
    if (!v) continue;
    pairs.push({ m, v });
    const t = tokensOf.get(v.video_id) ?? [];
    if (!t.includes(m.yes)) t.push(m.yes);
    tokensOf.set(v.video_id, t);
  }
  const out = new Map<string, Deadline>();
  for (const { m, v } of pairs) {
    if (m.window_h == null) continue;
    const at = Date.parse(v.published_at) + m.window_h * 3_600e3;
    if (!Number.isFinite(at)) continue;
    out.set(`${v.video_id}|${at}`, { video_id: v.video_id, at, tokens: tokensOf.get(v.video_id) ?? [] });
  }
  return [...out.values()].sort((a, b) => a.at - b.at || a.video_id.localeCompare(b.video_id));
}

/** When a run's window reads stop: `VIEWS_RUN_MS` into the minute it began in. */
export function runEnd(t0: number): number {
  return Math.floor(t0 / 60e3) * 60e3 + VIEWS_RUN_MS;
}

/** Where `t` falls against a deadline: read every second (`hot`), every 10 s (`warm`), or not specially. */
export function phaseAt(at: number, t: number): "hot" | "warm" | null {
  if (t >= at - HOT_BEFORE_MS && t <= at + HOT_AFTER_MS) return "hot";
  if (t >= at - WARM_BEFORE_MS && t < at - HOT_BEFORE_MS) return "warm";
  return null;
}

/** A book as stored: the best `VIEW_BOOK_LEVELS` levels a side, [price, size]. */
export function bookSides(b: PmBook): { bids: [number, number][]; asks: [number, number][] } {
  return { bids: b.bids.slice(0, VIEW_BOOK_LEVELS), asks: b.asks.slice(0, VIEW_BOOK_LEVELS) };
}

type Row = Record<string, unknown>;
type Open = { row: Row; value: string; lastSeen: number; dirty: boolean };

/**
 * One table's change-only record, held in memory for a run and written in batches: a read equal to the key's open
 * row extends it, anything else starts a new row. `take` hands over every row changed since the last write, one per
 * key and first-read instant (an upsert may not touch a row twice).
 */
export class ChangeLog {
  private open = new Map<string, Open>();
  private closed: Row[] = [];
  constructor(readonly table: string, readonly keyCol: string, readonly valueCols: string[]) {}

  private valueOf(r: Row): string {
    return JSON.stringify(this.valueCols.map((c) => r[c] ?? null));
  }

  /** The rows a run finds still open, newest first per key (older ones for a key are ignored). */
  seed(rows: Row[]): void {
    for (const r of rows) {
      const k = String(r[this.keyCol]);
      const seen = Date.parse(String(r.seen_until));
      if (this.open.has(k) || !Number.isFinite(seen)) continue;
      this.open.set(k, { row: { ...r }, value: this.valueOf(r), lastSeen: seen, dirty: false });
    }
  }

  observe(key: string, at: number, values: Row): "new" | "same" {
    const ts = new Date(at).toISOString();
    const cur = this.open.get(key);
    const v = this.valueOf(values);
    if (cur && cur.value === v && at >= cur.lastSeen && at - cur.lastSeen <= VIEWS_OPEN_ROW_MS) {
      cur.row.seen_until = ts;
      cur.row.reads = Number(cur.row.reads ?? 1) + 1;
      cur.lastSeen = at;
      cur.dirty = true;
      return "same";
    }
    if (cur?.dirty) this.closed.push({ ...cur.row });
    this.open.set(key, { row: { [this.keyCol]: key, ts, ...values, seen_until: ts, reads: 1 }, value: v, lastSeen: at, dirty: true });
    return "new";
  }

  take(): Row[] {
    const rows = [...this.closed, ...[...this.open.values()].filter((o) => o.dirty).map((o) => ({ ...o.row }))];
    this.closed = [];
    for (const o of this.open.values()) o.dirty = false;
    const byKey = new Map<string, Row>();
    for (const r of rows) byKey.set(`${r[this.keyCol]}|${r.ts}`, r);   // the later copy of a row carries its newer seen_until
    return [...byKey.values()];
  }

  /** Rows a write failed to store, to be offered again with the next batch. */
  giveBack(rows: Row[]): void {
    this.closed.unshift(...rows);
  }
}

export type ViewsDeps = {
  db: Db; holder: string; yt: YtEnv | null; pm?: PmPublicOpts;
  clock?: () => number; sleep?: (ms: number) => Promise<void>;
};

export type ViewsReport = {
  at: string;
  skipped?: string;
  discovered: { events: number; markets: number; channels: number; videos: number } | null;
  tracked: { markets: number; channels: number; videos: number; deadlines: number; windows: number };
  windowReads: number;
  units: number;
  unitsToday: number;
  written: { videos: number; channels: number; books: number };
  errors: string[];
};

/**
 * One minute of the recorder: take the lease; every fifth minute find the open view markets and what they name; read
 * the tracked counters and books; then, while a deadline's window is open, read that video and its markets' books
 * every second (every 10 s in the warm hour) until `VIEWS_RUN_MS`. Writes every `VIEWS_FLUSH_MS` and at the end.
 */
export async function runViews(d: ViewsDeps): Promise<ViewsReport> {
  const clock = d.clock ?? Date.now;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const t0 = clock();
  const iso = (ms: number) => new Date(ms).toISOString();
  const enc = encodeURIComponent;
  const report: ViewsReport = {
    at: iso(t0), discovered: null, tracked: { markets: 0, channels: 0, videos: 0, deadlines: 0, windows: 0 }, windowReads: 0,
    units: 0, unitsToday: 0, written: { videos: 0, channels: 0, books: 0 }, errors: [],
  };
  const err = (where: string, e: unknown) => {
    if (report.errors.length < 20) report.errors.push(`${where}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 240));
  };

  const held = await d.db.claim("agent_locks", `name=eq.views&lease_until=lt.${enc(iso(t0))}`, { lease_until: iso(t0 + VIEWS_LEASE_MS), holder: d.holder });
  if (!held.length) return { ...report, skipped: "another run holds the views lease" };

  const vlog = new ChangeLog("yt_video_reads", "video_id", ["views", "likes", "comments"]);
  const clog = new ChangeLog("yt_channel_reads", "channel_id", ["subscribers", "views", "videos"]);
  const blog = new ChangeLog("pm_view_books", "token", ["bids", "asks"]);
  const day = pacificDay(t0);
  let unitsToday = 0, unitsWritten = 0, quotaRefused = false;
  const ytOk = (budget: number) => !!d.yt && !quotaRefused && unitsToday + report.units < budget;
  const yt = async (m: YtRead, p: Record<string, string>): Promise<YtReply> => {
    report.units++;
    const r = await ytGet(d.yt!, m, p);
    if (!r.ok && /quota|ratelimit/i.test(String(r.reason ?? ""))) quotaRefused = true;
    return r;
  };

  const flush = async () => {
    const logs: [ChangeLog, string, keyof ViewsReport["written"]][] = [[vlog, "video_id,ts", "videos"], [clog, "channel_id,ts", "channels"], [blog, "token,ts", "books"]];
    for (const [log, key, name] of logs) {
      const rows = log.take();
      if (!rows.length) continue;
      try {
        await d.db.upsert(log.table, rows, key);
        report.written[name] += rows.length;
      } catch (e) {
        log.giveBack(rows);
        err(`write ${log.table}`, e);
      }
    }
    if (report.units > unitsWritten) {
      try {
        await d.db.upsert("yt_quota", [{ day, units: unitsToday + report.units }], "day");
        unitsWritten = report.units;
      } catch (e) { err("write yt_quota", e); }
    }
  };

  try {
    try {
      const [q] = await d.db.select<{ units: number }>("yt_quota", `day=eq.${day}&select=units`);
      unitsToday = Number(q?.units ?? 0);
    } catch (e) { err("read yt_quota", e); }

    // --- What is open: the stored markets, refreshed from Gamma every fifth minute (or when none is stored).
    let channels = await d.db.select<ChannelRow>("yt_channels", "select=channel_id,handle,title,uploads");
    let markets = await d.db.select<ViewMarketRow>("pm_view_markets", `last_seen=gte.${enc(iso(t0 - VIEWS_MARKET_STALE_MS))}&select=*`);
    const uploads = new Set<string>();
    if (Math.floor(t0 / 60e3) % VIEWS_DISCOVER_EVERY_MIN === 0 || !markets.length) {
      try {
        const events = await pmOpenEventsByTag(VIEWS_TAG, d.pm);
        const fresh = events.flatMap((e) => viewMarketsOf(e, iso(t0)));
        if (fresh.length) await d.db.upsert("pm_view_markets", fresh, "cond");
        markets = fresh;
        report.discovered = { events: events.filter(isViewEvent).length, markets: fresh.length, channels: 0, videos: 0 };
        const handles = [...new Set(fresh.map((m) => m.handle).filter((h): h is string => !!h))];
        for (const h of handles) {
          if (channels.some((c) => (c.handle ?? "").toLowerCase() === h.toLowerCase())) continue;
          if (!ytOk(YT_DAY_BUDGET)) break;
          const r = await yt("channels", { part: "snippet,contentDetails", forHandle: h });
          const c = r.ok ? r.data?.items?.[0] : null;
          if (!c?.id) { err(`channel ${h}`, r.error ?? "no channel has this handle"); continue; }
          const row: ChannelRow = { channel_id: String(c.id), handle: h, title: c.snippet?.title ?? null, uploads: c.contentDetails?.relatedPlaylists?.uploads ?? null };
          await d.db.upsert("yt_channels", [row], "channel_id");
          channels = [...channels.filter((x) => x.channel_id !== row.channel_id), row];
          report.discovered.channels++;
        }
        const named = new Set(handles.map((h) => h.toLowerCase()));
        for (const c of channels) {
          if (!c.uploads || !named.has((c.handle ?? "").toLowerCase()) || !ytOk(YT_DAY_BUDGET)) continue;
          const r = await yt("playlistItems", { part: "contentDetails", playlistId: c.uploads, maxResults: "5" });
          if (!r.ok) { err(`uploads ${c.handle}`, r.error ?? r.status); continue; }
          for (const it of (r.data?.items ?? []) as any[]) if (typeof it?.contentDetails?.videoId === "string") uploads.add(it.contentDetails.videoId);
        }
        for (const m of fresh) if (m.video_id) uploads.add(m.video_id);
      } catch (e) { err("discover", e); }
    }

    // --- The videos: recent uploads and every video an open market names; a new one's record read once, for 1 unit.
    const videos = await d.db.select<VideoRow>("yt_videos", `published_at=gte.${enc(iso(t0 - VIEWS_TRACK_MS))}&select=*`);
    const want = new Set([...uploads, ...markets.map((m) => m.video_id).filter((x): x is string => !!x)]);
    const outside = [...want].filter((id) => !videos.some((v) => v.video_id === id));
    if (outside.length) videos.push(...await d.db.select<VideoRow>("yt_videos", `video_id=in.(${outside.join(",")})&select=*`));
    const unknown = [...want].filter((id) => !videos.some((v) => v.video_id === id)).slice(0, 50);
    if (unknown.length && ytOk(YT_DAY_BUDGET)) {
      const r = await yt("videos", { part: "snippet,contentDetails", id: unknown.join(",") });
      if (!r.ok) err("new videos", r.error ?? r.status);
      const rows: VideoRow[] = [];
      for (const it of (r.ok ? r.data?.items ?? [] : []) as any[]) {
        if (typeof it?.id !== "string" || typeof it?.snippet?.channelId !== "string" || typeof it?.snippet?.publishedAt !== "string") continue;
        const s = isoSeconds(it.contentDetails?.duration);
        rows.push({ video_id: it.id, channel_id: it.snippet.channelId, title: String(it.snippet.title ?? "").slice(0, 200), published_at: it.snippet.publishedAt, duration_s: s, short: s != null && s <= SHORT_MAX_S });
      }
      if (rows.length) {
        try { await d.db.upsert("yt_videos", rows, "video_id"); videos.push(...rows); if (report.discovered) report.discovered.videos += rows.length; }
        catch (e) { err("write yt_videos", e); }
      }
    }

    const dl = deadlinesOf(markets, videos, channels);
    const named = new Set(markets.map((m) => m.video_id).filter((x): x is string => !!x));
    const readIds = [...new Set(videos.filter((v) => Date.parse(v.published_at) >= t0 - VIEWS_TRACK_MS || named.has(v.video_id)).map((v) => v.video_id))].slice(0, 50);
    const tokens = [...new Set(markets.map((m) => m.yes))];
    const live = channels.filter((c) => markets.some((m) => (m.handle ?? "").toLowerCase() === (c.handle ?? "").toLowerCase()));
    report.tracked = { markets: markets.length, channels: live.length, videos: readIds.length, deadlines: dl.length, windows: 0 };

    // --- Continue the rows still open, then the minute's reads. Every page of them: a book read every second for three
    // minutes leaves up to 180 rows a token in that span, more than PostgREST's 1,000-row page holds for thirty tokens.
    const since = enc(iso(t0 - VIEWS_OPEN_ROW_MS));
    try {
      vlog.seed(await d.db.selectAll<Row>("yt_video_reads", `seen_until=gte.${since}&select=*&order=video_id.asc,ts.desc`));
      clog.seed(await d.db.selectAll<Row>("yt_channel_reads", `seen_until=gte.${since}&select=*&order=channel_id.asc,ts.desc`));
      blog.seed(await d.db.selectAll<Row>("pm_view_books", `seen_until=gte.${since}&select=*&order=token.asc,ts.desc`));
    } catch (e) { err("read open rows", e); }

    const readVideos = async (ids: string[], budget: number) => {
      if (!ids.length || !ytOk(budget)) return;
      const r = await yt("videos", { part: "statistics", id: ids.join(",") });
      const at = clock();
      if (!r.ok) { err("videos", r.error ?? r.status); return; }
      for (const it of (r.data?.items ?? []) as any[]) {
        const views = num(it?.statistics?.viewCount);
        if (typeof it?.id !== "string" || views == null) continue;
        vlog.observe(it.id, at, { views, likes: num(it.statistics.likeCount), comments: num(it.statistics.commentCount) });
      }
    };
    const readBooks = async (toks: string[], opts: PmPublicOpts | undefined) => {
      if (!toks.length) return;
      try {
        const got = await pmBooks(toks, opts);
        const at = clock();
        for (const t of toks) { const b = got.get(t); if (b) blog.observe(t, at, bookSides(b)); }
      } catch (e) { err("books", e); }
    };
    const readChannels = async () => {
      if (!live.length || !ytOk(YT_DAY_BUDGET)) return;
      const r = await yt("channels", { part: "statistics", id: live.map((c) => c.channel_id).join(",") });
      const at = clock();
      if (!r.ok) { err("channels", r.error ?? r.status); return; }
      for (const it of (r.data?.items ?? []) as any[]) {
        if (typeof it?.id !== "string") continue;
        clog.observe(it.id, at, { subscribers: num(it.statistics?.subscriberCount), views: num(it.statistics?.viewCount), videos: num(it.statistics?.videoCount) });
      }
    };

    await Promise.all([
      readVideos(readIds, YT_DAY_BUDGET),
      readBooks(tokens, d.pm),
      Math.floor(t0 / 60e3) % VIEWS_CHANNEL_EVERY_MIN === 0 ? readChannels() : Promise.resolve(),
    ]);
    await flush();
    let lastFlush = clock();

    // --- The windows: every second while a deadline is hot, every 10 s while it is warm, until the run's budget.
    const active = dl.filter((x) => x.at - WARM_BEFORE_MS <= runEnd(t0) && x.at + HOT_AFTER_MS >= t0);
    report.tracked.windows = active.length;
    const windowPm: PmPublicOpts = { ...d.pm, timeoutMs: WINDOW_TIMEOUT_MS };
    const everyWarm = Math.round(WARM_GAP_MS / HOT_GAP_MS);
    // Reads stop 56 s into the MINUTE, not 56 s after the run began: a run that started late (a cold start) still
    // answers inside the cron call's 59 s, and gives the lease back before the next minute's run.
    const end = runEnd(t0);
    for (let k = 1; active.length; k++) {
      const due = t0 + k * HOT_GAP_MS;
      if (due >= end) break;
      const wait = due - clock();
      if (wait > 0) await sleep(wait);
      else if (-wait >= HOT_GAP_MS) continue;          // a slow read made this second late: skip it rather than burst
      const t = clock();
      const now = active.filter((x) => phaseAt(x.at, t) === "hot" || (k % everyWarm === 0 && phaseAt(x.at, t) === "warm"));
      if (now.length) {
        const ids = [...new Set(now.map((x) => x.video_id))];
        const toks = [...new Set(now.flatMap((x) => x.tokens))];
        await Promise.all([readVideos(ids, YT_WINDOW_BUDGET), readBooks(toks, windowPm)]);
        report.windowReads++;
      }
      if (clock() - lastFlush >= VIEWS_FLUSH_MS) { await flush(); lastFlush = clock(); }
    }
    await flush();
  } catch (e) {
    err("run", e);
    try { await flush(); } catch { /* the rows are lost with the run; the next run starts new ones */ }
  } finally {
    report.unitsToday = unitsToday + report.units;
    try { await d.db.update("agent_locks", `name=eq.views&holder=eq.${enc(d.holder)}`, { lease_until: iso(clock()), holder: null }); }
    catch { /* the lease expires on its own */ }
  }
  return report;
}
