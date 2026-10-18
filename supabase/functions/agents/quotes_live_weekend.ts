// The live account's weekend replica (0131; Davies, 2026-10-18: "…然后加上周末的挂单，一定验证好没问题再推上实盘部署"): PR5's rule,
// stepped minute by minute on PR5's own stored minutes and prints with PR5-W's weekend rule (quotes_weekend.ts), the same
// replica the twins step (`stepTwinPaper`, quotes_twin.ts), into `agent_quote_live_wkpaper`. It runs in PR5's call, after
// the paper engine and before the live executor, and only while `agent_quote_live_config.weekend_mode` is not 'off'.
//
// What it is for. PR5's engine is dark from Friday's last GBP/USD bar to Sunday's first, so LIVE, which carries out its
// decisions, quotes nothing at weekends. With `weekend_mode` 'shadow' the executor records, inside an FX closure, the
// entries this replica would have it rest (`weekend_shadow` events); with 'live' it carries them out, at fair on the held X
// (quotes_live.ts `paperView`). Outside a closure the executor reads PR5's engine, as before, in every mode.
//
// How it is kept. On weekdays PR5's engine is the rule and the replica is not needed, so it is not stepped: in the hour before
// a closure opens (`LIVE_WK_SYNC_MS`) each call copies PR5's engine's state as it stands (its books, its paper positions, its
// last decided minute), so the replica is PR5's engine itself at the closure's first minute, not a copy rebuilt from the record
// that could differ from it. Inside a closure it is stepped minute by minute from that state on PR5's own stored minutes and
// prints with the weekend rule (`stepTwinPaper`, at most `LIVE_WK_MAX_MINUTES` a call), and its state is its own. At the
// closure's end the executor goes back to PR5's engine; the replica's paper positions then are dropped at the next copy (the
// live account's own holdings exit by its own rule, step 5, whatever the paper holds). Switched on inside a closure, or after
// a missed copy, it starts there from PR5's engine's state as it stands (`late`): the minutes before were dark for it.

import type { Db } from "./db.ts";
import { stepTwinPaper, type TwinPaper } from "./quotes_twin.ts";
import { MISSING_COLUMN, switchMode } from "./quotes_live.ts";
import { inQuoteClosure, type WeekendRule } from "./quotes_weekend.ts";

const M = 60e3, H = 3600e3;
const iso = (ms: number) => new Date(ms).toISOString();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Its table (0131): one row. */
export const LIVE_WK_PAPER = "agent_quote_live_wkpaper";
/** How long before a closure opens the replica is PR5's engine's state, copied each call. */
export const LIVE_WK_SYNC_MS = H;
/** Minutes stepped in one call at most. */
export const LIVE_WK_MAX_MINUTES = 720;
/** Every closure minute is decided on the book's last X: the replica is stepped only inside closures. */
const RULE: WeekendRule = { from: 0 };

/** The replica as its row keeps it: the twins' replica, the PR5 minute it was last copied at, and whether that was late. */
export type LiveWeekendPaper = TwinPaper & { syncedAt: number; late: boolean };
export type LiveWeekendReport = { skipped?: string; synced?: boolean; late?: boolean; minutes?: number; lastMinute?: string; error?: string };
type Pr5State = { lastMinute: number; books: TwinPaper["books"]; fetchedTo?: Record<string, number>; hourFetchedFor?: number };

/** The first minute after `t` that opens a closure: a minute inside one whose minute before is not. */
export function nextClosureStart(t: number): number {
  for (let m = Math.floor(t / M) * M + M, n = 0; n < 9 * 1440; m += M, n++) if (inQuoteClosure(m) && !inQuoteClosure(m - M)) return m;
  throw new Error(`no closure begins within nine days of ${iso(t)}`);
}
/** The minute that opened the closure `t` is in. */
export function closureStartOf(t: number): number {
  let m = Math.floor(t / M) * M;
  for (let n = 0; inQuoteClosure(m - M) && n < 9 * 1440; n++) m -= M;
  return m;
}

/** PR5's engine's state, as the replica: the same books and minute, nothing to check. */
export function replicaOf(s: Pr5State, late: boolean): LiveWeekendPaper {
  return { engine: "pr5", lastMinute: s.lastMinute, books: structuredClone(s.books), gov: null, fetchedTo: { ...(s.fetchedTo ?? {}) }, hourFetchedFor: s.hourFetchedFor ?? 0, unchecked: [], syncedAt: s.lastMinute, late };
}

/** One call: the replica copied from PR5's engine before a closure, stepped inside one, saved. It never throws: a fault is `error`. */
export async function stepLiveWeekendPaper(db: Db, now: number): Promise<LiveWeekendReport> {
  try {
    const cfg = (await db.select<{ weekend_mode?: string }>("agent_quote_live_config", "id=eq.1&select=weekend_mode"))[0];
    if (switchMode(cfg?.weekend_mode) === "off") return { skipped: "weekend_mode is off" };
    const pr5 = (await db.select<{ state: Pr5State | Record<string, never>; last_minute: string | null }>("agent_quote_state", "id=eq.1&select=state,last_minute"))[0];
    if (!pr5?.last_minute || !pr5.state || !("books" in pr5.state)) return { skipped: "PR5's engine has decided no minute yet" };
    const T = Date.parse(pr5.last_minute), s = { ...(pr5.state as Pr5State), lastMinute: T };
    const save = async (p: LiveWeekendPaper) =>
      await db.upsert(LIVE_WK_PAPER, [{ id: 1, state: p, last_minute: iso(p.lastMinute), updated_at: iso(now), last_error: null }], "id");
    if (!inQuoteClosure(T)) {
      if (nextClosureStart(T) - T > LIVE_WK_SYNC_MS) return { skipped: "a weekday: PR5's engine is the rule" };
      const p = replicaOf(s, false);
      await save(p);
      return { synced: true, late: false, minutes: 0, lastMinute: iso(T) };
    }
    const row = (await db.select<{ state: LiveWeekendPaper | Record<string, never> }>(LIVE_WK_PAPER, "id=eq.1&select=state"))[0];
    const held = row?.state && "books" in row.state ? row.state as LiveWeekendPaper : null;
    // Copied in the hour before this closure, or stepped inside it since: go on from it. Otherwise start late, from PR5 now.
    if (!held || held.lastMinute < closureStartOf(T) - LIVE_WK_SYNC_MS || held.lastMinute > T) {
      const p = replicaOf(s, true);
      await save(p);
      return { synced: true, late: true, minutes: 0, lastMinute: iso(T) };
    }
    const stepped = await stepTwinPaper(db, held, T, LIVE_WK_MAX_MINUTES, RULE);
    held.unchecked = [];
    await save(held);
    return { synced: false, late: held.late, minutes: stepped.minutes, lastMinute: iso(held.lastMinute) };
  } catch (e) {
    const error = msg(e);
    // Deployed before 0131 has run: its column or table is not there yet, which is "not yet", not an error every minute.
    if (MISSING_COLUMN.test(error) || /PGRST205|42P01|Could not find the table|relation .* does not exist/i.test(error)) return { skipped: "migration 0131 has not run" };
    try { await db.update(LIVE_WK_PAPER, "id=eq.1", { last_error: error, updated_at: iso(now) }); } catch { /* the next call reads the last saved state */ }
    return { error };
  }
}
