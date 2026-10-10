// The programme factor (0115): TESTING's Reward quotes rows priced on the reward programme the listing showed each 15
// minutes, not on the one their selection read at 00:00. Display only: nothing here is read by a decision, a stop, a
// replay or a pre-registered reading.
//
// Davies, 2026-10-10: "之前testing的每一个不都赚了很多吗" (didn't every one of the TESTING rows make a lot?). They priced every
// rewarded minute at the rate their selection read at 00:00, all day; LP-ALLOC found the 00:00 top ten off for 51 % of
// their minutes, and Polymarket pays the programme in force (lpcfg/results/rtrue.txt: R = 0.807 against the formula at
// the listing's rate then). So the page now shows each row's formula x its programme factor x the live R:
//
//   factor(row, day, market) = sum(formula x listing rate then / rate the row used) / sum(formula)
//
// Two parts. `runPmProg` (`agents?action=pmprog`, every 5 minutes) reads pm-rec's archived universe objects, four hours a
// run, through the signed URLs `pm_rec_archive` keeps, checks each against its sha256, and stores the listing's reading
// of every market a TESTING row selected that day or the next (`pm_prog_reads`); the database's `pm_prog_refresh` (0115,
// pg_cron every 15 minutes) turns those into `pm_prog_factors`. `atProgramme` applies them to a row's summary before
// `atLiveR` prices it (agents/index.ts).
//
// Can the Edge runtime read the archive as pm-rec writes it? An object is an hour's frames as concatenated gzip members
// (pm_book_rec.ts): node:zlib's `gunzipSync` reads every member (the Web DecompressionStream stops at the first). Checked
// on Deno 1.46.3, the Edge runtime's line, on the object of 2026-10-09 12:00 UTC: 2,795,681 bytes to 7,762,642 of text,
// all 60 frames, in 46 ms of gunzip and 22 ms to decode and scan for the wanted markets; four objects a run are about
// 0.3 s of CPU, inside an Edge request's 2 s.

import { gunzipSync } from "node:zlib";
import type { Db } from "./db.ts";

const M = 60e3, H = 3600e3, DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 240);

/** The sources a factor row names: RW-C's minutes and the three paper layers'. */
export const PM_PROG_SOURCES = ["rwc", "prep", "midprep", "lpprep"] as const;
export type PmProgSource = typeof PM_PROG_SOURCES[number];
/** Archived universe hours read a run: about 70 ms of CPU each (the header's measure). */
export const PM_PROG_HOURS_PER_RUN = 4;
/** An hour missing from the archive this long after it ended is lost (pm-rec drops frames it has not archived in 6 h). */
export const PM_PROG_LOST_AFTER_MS = 8 * H;
export const PM_PROG_LEASE_MS = 25e3;
export const PM_PROG_FETCH_TIMEOUT_MS = 10e3;
/** The tables each source's selected markets are read from, by day. */
export const PM_PROG_SELECTIONS: Record<PmProgSource, string> = { rwc: "pm_rwc_selection", prep: "pm_live_markets", midprep: "pm_mid_markets", lpprep: "pm_lp_markets" };

// ------------------------------------------------------------------------------------------------------ pure helpers

export type PmProgRead = { cond: string; minute: string; rate: number | null; max_spread: number | null; min_size: number | null };

/**
 * The listing's readings in one archived universe object (an hour's frames, as text): for each frame, every wanted market
 * whose pm-rec id is the frame's phase modulo its phases, with its rate, maximum spread and minimum where the frame lists
 * it, else a null rate (the listing no longer shows it: no programme). Only the wanted markets' lines are parsed.
 */
export function universeReads(text: string, wanted: Map<number, string>): PmProgRead[] {
  const out: PmProgRead[] = [];
  let header: { minute: string; phase: number; phases: number } | null = null;
  let got = new Map<number, unknown[]>();
  const flush = () => {
    if (!header) return;
    for (const [id, cond] of wanted) {
      if (id % header.phases !== header.phase) continue;
      const r = got.get(id);
      const num = (x: unknown) => (x === null || x === undefined || !Number.isFinite(Number(x)) ? null : Number(x));
      out.push(r ? { cond, minute: header.minute, rate: num(r[2]), max_spread: num(r[3]), min_size: num(r[4]) } : { cond, minute: header.minute, rate: null, max_spread: null, min_size: null });
    }
  };
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    if (end > start) {
      if (text.charCodeAt(start) === 123) {   // "{": a frame's header
        flush();
        const h = JSON.parse(text.slice(start, end));
        const phases = Number(h.phases), phase = Number(h.phase);
        header = h.kind === "universe" && Number.isInteger(phases) && phases > 0 && Number.isInteger(phase) ? { minute: iso(Date.parse(String(h.minute))), phase, phases } : null;
        got = new Map();
      } else if (header) {
        const comma = text.indexOf(",", start);
        const id = Number(text.slice(start + 1, comma));
        if (wanted.has(id)) got.set(id, JSON.parse(text.slice(start, end)));
      }
    }
    start = end + 1;
  }
  flush();
  return out;
}

/** The listing's rate in force at `t`: the last reading at or before it within a day, else the first within 30 minutes after; 0 for a reading with no programme; null where none covers it (0115's `pm_prog_rate_at`). */
export function rateAt(reads: Array<{ minute: string; rate: number | null }>, t: number): number | null {
  let before: { ms: number; rate: number | null } | null = null, after: { ms: number; rate: number | null } | null = null;
  for (const r of reads) {
    const ms = Date.parse(r.minute);
    if (ms <= t && ms > t - DAY && (!before || ms > before.ms)) before = { ms, rate: r.rate };
    if (ms > t && ms <= t + 30 * M && (!after || ms < after.ms)) after = { ms, rate: r.rate };
  }
  const x = before ?? after;
  return x ? x.rate ?? 0 : null;
}

/**
 * One market-day's factor from its rewarded minutes (the formula and the rate each was priced at) and the listing's
 * readings: sum(formula x rate then / rate used) / sum(formula); a minute no reading covers, or priced at no rate, keeps
 * its formula and is counted as uncovered. The reference 0115's `pm_prog_day` implements in SQL (pinned on one case).
 */
export function programmeFactor(minutes: Array<{ minute: string; reward: number; rateUsed: number }>, reads: Array<{ minute: string; rate: number | null }>) {
  let formula = 0, formulaTrue = 0, uncovered = 0;
  for (const m of minutes) {
    if (!(m.reward > 0)) continue;
    formula += m.reward;
    const r = rateAt(reads, Date.parse(m.minute));
    if (r === null || !(m.rateUsed > 0)) { formulaTrue += m.reward; uncovered++; } else formulaTrue += (m.reward * r) / m.rateUsed;
  }
  return { formula, formulaTrue, factor: formula > 0 ? formulaTrue / formula : 1, uncovered };
}

export type PmProgFactorRow = { source: string; day: string; cond: string; formula: number | string; formula_true: number | string; uncovered: number | string; read_through: string | null };
/** A source's factors as `atProgramme` takes them: by day, by market (over the days from `fromDay`), and the days uncovered. */
export type PmProgFx = { byDay: Map<string, { f: number; t: number; uncovered: number }>; byMarket: Map<string, { f: number; t: number }>; readThrough: string | null };

export function progFx(rows: PmProgFactorRow[], source: PmProgSource, fromDay: string | null): PmProgFx {
  const byDay = new Map<string, { f: number; t: number; uncovered: number }>(), byMarket = new Map<string, { f: number; t: number }>();
  let readThrough: string | null = null;
  for (const r of rows) {
    const day = String(r.day).slice(0, 10);
    if (r.source !== source || (fromDay && day < fromDay)) continue;
    const f = Number(r.formula), t = Number(r.formula_true);
    if (!Number.isFinite(f) || !Number.isFinite(t)) continue;
    const d = byDay.get(day) ?? { f: 0, t: 0, uncovered: 0 };
    d.f += f; d.t += t; d.uncovered += Number(r.uncovered) || 0; byDay.set(day, d);
    const m = byMarket.get(r.cond) ?? { f: 0, t: 0 };
    m.f += f; m.t += t; byMarket.set(r.cond, m);
    if (r.read_through && (!readThrough || r.read_through > readThrough)) readThrough = r.read_through;
  }
  return { byDay, byMarket, readThrough };
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const k = (x: { f: number; t: number } | undefined) => (x && x.f > 0 ? x.t / x.f : 1);

/**
 * A paper Reward quotes summary with its formula rescaled to the programme as read (the same fields `atLiveR` prices:
 * the total, today, realised and stress, each day, each market): a closed day's rewards x its day factor; today's x
 * today's; a market's x its factor over the days counted; the total is the days' and today's, so they add up. A day
 * with no factor rows keeps its rewards (factor 1) and is listed in `programmePricing.uncoveredDays`. Fills, holdings
 * and capital do not move. `atLiveR` then prices the result at the live R. `today` is the UTC day the summary's
 * `todayUsd` covers.
 */
// deno-lint-ignore no-explicit-any
export function atProgramme<T extends Record<string, any> | null | undefined>(s: T, fx: PmProgFx, today: string): T {
  if (!s || typeof s !== "object") return s;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const F = n(s.rewardUsd);
  if (F === null) return s;
  const days = Array.isArray(s.days) ? s.days as Array<Record<string, unknown>> : [];
  const closed = days.reduce((a, d) => a + (n(d.rewardUsd) ?? 0), 0);
  const todayF = F - closed;
  const uncoveredDays: string[] = [];
  const dayK = (day: string) => {
    const x = fx.byDay.get(day);
    if (!x) { uncoveredDays.push(day); return 1; }
    return k(x);
  };
  let Fnew = 0;
  // deno-lint-ignore no-explicit-any
  const out: Record<string, any> = { ...s };
  out.days = Array.isArray(s.days) ? days.map((d) => {
    const f = n(d.rewardUsd) ?? 0, kd = dayK(String(d.day ?? "").slice(0, 10)), cut = (1 - kd) * f;
    Fnew += kd * f;
    return {
      ...d, rewardUsd: n(d.rewardUsd) === null ? d.rewardUsd : r6(kd * f),
      totalUsd: n(d.totalUsd) === null ? d.totalUsd : r6(Number(d.totalUsd) - cut),
      stressUsd: n(d.stressUsd) === null ? d.stressUsd : r6(Number(d.stressUsd) - 0.5 * cut),
      programmeFactor: r6(kd),
    };
  }) : s.days;
  const kt = dayK(today), todayCut = (1 - kt) * todayF;
  Fnew += kt * todayF;
  // The running sums: each closed day's cut added oldest first.
  if (Array.isArray(out.days) && out.days.some((d: Record<string, unknown>) => "runningUsd" in d)) {
    const order = out.days.map((d: Record<string, unknown>, i: number) => [String(d.day ?? ""), i] as const).sort((a: readonly [string, number], b: readonly [string, number]) => a[0].localeCompare(b[0]));
    let run = 0;
    for (const [, i] of order) {
      const d = out.days[i], f = n(days[i].rewardUsd) ?? 0;
      run += (1 - Number(d.programmeFactor)) * f;
      if (n(d.runningUsd) !== null) d.runningUsd = r6(Number(d.runningUsd) - run);
    }
  }
  const cut = F - Fnew;
  out.rewardUsd = r6(Fnew);
  for (const key of ["totalUsd", "realisedUsd"]) if (n(s[key]) !== null) out[key] = r6(Number(s[key]) - cut);
  if (n(s.stressUsd) !== null) out.stressUsd = r6(Number(s.stressUsd) - 0.5 * cut);
  if (n(s.todayUsd) !== null) out.todayUsd = r6(Number(s.todayUsd) - todayCut);
  if ("todayStressUsd" in s && n(s.todayStressUsd) !== null) out.todayStressUsd = r6(Number(s.todayStressUsd) - 0.5 * todayCut);
  if (Array.isArray(s.markets)) {
    out.markets = (s.markets as Array<Record<string, unknown>>).map((m) => {
      const f = n(m.rewardUsd);
      if (f === null) return m;
      const km = k(fx.byMarket.get(String(m.cond)));
      return { ...m, rewardUsd: r6(km * f), totalUsd: n(m.totalUsd) === null ? m.totalUsd : r6(Number(m.totalUsd) - (1 - km) * f), programmeFactor: r6(km) };
    });
    const best = out.markets.map((m: Record<string, unknown>) => n(m.totalUsd)).filter((x: number | null): x is number => x !== null);
    if (best.length && n(s.bestMarketUsd) !== null) out.bestMarketUsd = r6(Math.max(...best));
  }
  out.programmePricing = { factor: F > 0 ? r6(Fnew / F) : 1, formulaUsd: r6(F), uncoveredDays: [...new Set(uncoveredDays)].sort(), readThrough: fx.readThrough };
  return out as T;
}

// -------------------------------------------------------------------------------------------------------- the job

type ArchiveRow = { hour: string; url: string | null; sha256: string; bytes: number | string };
export type PmProgDeps = { db: Db; now: number; holder: string; fetchImpl?: typeof fetch; clock?: () => number; hoursPerRun?: number };
export type PmProgReport = { hours: string[]; reads: number; lost: string[]; cursor: string | null; errors: string[]; skipped?: string; report: boolean };

const sha256Hex = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * One run: under its lease, the next archived universe hours after the cursor (at most `PM_PROG_HOURS_PER_RUN`, in order;
 * a gap is stepped over only once it is `PM_PROG_LOST_AFTER_MS` old), each read for the markets the TESTING rows selected
 * that day or the next, its readings upserted on (cond, minute); then the cursor. A fault stops at the hour it met, keeps
 * the cursor before it, and is reported once an hour while it lasts. The signed URLs are never written anywhere.
 */
export async function runPmProg(d: PmProgDeps): Promise<PmProgReport> {
  const clock = d.clock ?? (() => Date.now());
  const f = d.fetchImpl ?? fetch;
  const report: PmProgReport = { hours: [], reads: 0, lost: [], cursor: null, errors: [], report: false };
  const held = await d.db.claim("agent_locks", `name=eq.pm-prog&lease_until=lt.${encodeURIComponent(iso(d.now))}`, { lease_until: iso(d.now + PM_PROG_LEASE_MS), holder: d.holder });
  if (!held.length) return { ...report, skipped: "another run holds the pm-prog lease" };
  // deno-lint-ignore no-explicit-any
  let state: Record<string, any> = {};
  try {
    const [row] = await d.db.select<{ state: Record<string, unknown> }>("pm_prog_state", "id=eq.1&select=state");
    state = { ...(row?.state ?? {}) };
    let cursor = Date.parse(String(state.cursor ?? "2026-10-04T18:00:00.000Z"));
    const rows = await d.db.select<ArchiveRow>("pm_rec_archive", `kind=eq.universe&hour=gt.${encodeURIComponent(iso(cursor))}&select=hour,url,sha256,bytes&order=hour.asc&limit=${d.hoursPerRun ?? PM_PROG_HOURS_PER_RUN}`);
    const ids = new Map<string, number>();   // cond -> pm-rec id, read once a run
    for (const a of rows) {
      const hour = Date.parse(a.hour);
      if (hour > cursor + H) {
        // A gap: an hour not archived. Wait for it unless it is past being archived.
        if (d.now - (cursor + 2 * H) < PM_PROG_LOST_AFTER_MS) break;
        for (let h = cursor + H; h < hour; h += H) report.lost.push(iso(h));
      }
      if (!a.url) { report.errors.push(`${iso(hour)}: no signed URL`); break; }
      // The markets wanted: every TESTING row's selection of the hour's day and the next.
      const day = iso(Math.floor(hour / DAY) * DAY).slice(0, 10), next = iso(Math.floor(hour / DAY) * DAY + DAY).slice(0, 10);
      const conds = new Set<string>();
      for (const t of Object.values(PM_PROG_SELECTIONS)) {
        for (const r of await d.db.select<{ cond: string }>(t, `day=in.(${day},${next})&select=cond`)) conds.add(r.cond);
      }
      const missing = [...conds].filter((c) => !ids.has(c));
      for (let i = 0; i < missing.length; i += 40) {
        for (const r of await d.db.select<{ id: number; cond: string }>("pm_rec_markets", `cond=in.(${missing.slice(i, i + 40).join(",")})&select=id,cond`)) ids.set(r.cond, Number(r.id));
      }
      const wanted = new Map<number, string>();
      for (const c of conds) if (ids.has(c)) wanted.set(ids.get(c)!, c);
      let bytes: Uint8Array;
      try {
        const res = await f(a.url, { signal: AbortSignal.timeout(PM_PROG_FETCH_TIMEOUT_MS) });
        if (!res.ok) { await res.body?.cancel(); report.errors.push(`${iso(hour)}: archive answered ${res.status}`); break; }
        bytes = new Uint8Array(await res.arrayBuffer());
      } catch (e) { report.errors.push(`${iso(hour)}: archive read failed (${msg(e).replace(/https?:\/\/\S+/g, "<url>")})`); break; }
      if ((await sha256Hex(bytes)) !== a.sha256) { report.errors.push(`${iso(hour)}: sha256 differs from the archive row`); break; }
      const reads = universeReads(new TextDecoder().decode(gunzipSync(bytes)), wanted);
      for (let i = 0; i < reads.length; i += 500) await d.db.upsert("pm_prog_reads", reads.slice(i, i + 500).map((r) => ({ ...r, ingested_at: iso(clock()) })), "cond,minute");
      report.hours.push(iso(hour)); report.reads += reads.length;
      cursor = hour;
    }
    state.cursor = iso(cursor);
    if (report.lost.length) state.lost = [...(Array.isArray(state.lost) ? state.lost : []), ...report.lost].slice(-200);
    report.cursor = state.cursor;
  } catch (e) {
    report.errors.push(msg(e).replace(/https?:\/\/\S+/g, "<url>"));
  }
  // Report a fault when it first appears and at most hourly while it lasts.
  const lastAt = Date.parse(String(state.reportedAt ?? "")) || 0;
  if (report.errors.length && d.now - lastAt >= H) { report.report = true; state.reportedAt = iso(d.now); }
  if (!report.errors.length) delete state.reportedAt;
  state.report = { at: iso(d.now), hours: report.hours, reads: report.reads, lost: report.lost.length, errors: report.errors };
  try {
    await d.db.update("pm_prog_state", "id=eq.1", { state, updated_at: iso(clock()), last_error: report.errors.length ? report.errors.join(" | ").slice(0, 1000) : null });
  } finally {
    try { await d.db.update("agent_locks", `name=eq.pm-prog&holder=eq.${encodeURIComponent(d.holder)}`, { lease_until: iso(clock()), holder: null }); } catch { /* the lease expires */ }
  }
  return report;
}
