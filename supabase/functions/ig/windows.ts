// UK wall-clock time, the quote recorder's weekend windows, and the history pulls' frozen windows.
//
// The spec states every window in UK time (`SPEC-for-verification.md`, G2 and G4). The UK rule is fixed in law: British
// Summer Time from 01:00 UTC on the last Sunday of March to 01:00 UTC on the last Sunday of October. It is written out
// here rather than asked of the runtime's time-zone data, so the windows cannot move with an isolate's ICU build, and
// the Deno test checks it against `Intl` over three years.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** 01:00 UTC on the last Sunday of the month (0-based) of a year. */
function lastSunday0100Utc(year: number, month0: number): number {
  const last = new Date(Date.UTC(year, month0 + 1, 0));
  return Date.UTC(year, month0, last.getUTCDate() - last.getUTCDay(), 1, 0);
}

/** The UK's offset from UTC at an instant: one hour in summer time, none otherwise. */
export function ukOffsetMs(ms: number): number {
  const y = new Date(ms).getUTCFullYear();
  return ms >= lastSunday0100Utc(y, 2) && ms < lastSunday0100Utc(y, 9) ? HOUR : 0;
}

/** UK wall-clock reading of an instant: day of week (0 Sunday) and minutes after midnight, and the date. */
export function ukClock(ms: number): { dow: number; minutes: number; y: number; m: number; d: number } {
  const local = new Date(ms + ukOffsetMs(ms));
  return {
    dow: local.getUTCDay(), minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
    y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate(),
  };
}

/** The instant a UK wall-clock time names (a time in the skipped spring hour reads as summer time). */
export function ukToUtcMs(y: number, m: number, d: number, hh: number, mm: number): number {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const summer = wall - HOUR;
  return ukOffsetMs(summer) === HOUR ? summer : wall;
}

const hm = (h: number, m: number) => h * 60 + m;

/**
 * The recorder's windows (G4), UK time. Each names the roles it reads; a role is an epic `facts` chose for an account.
 *   FRI     Friday 21:50–22:05: the weekday markets' last quotes before the weekend (S1b freezes Friday's mid from it).
 *   WKND    Saturday 07:55 to Monday 01:00: IG's weekend markets, indices and FX.
 *   SUNIDX  Sunday 20:50 to Monday 01:00: the weekday counterparts of the four weekend indices, for the reopen S2 reads
 *           (the spec's window for weekend indices, applied to their weekday epics; deviation 2 in the review).
 *   SUN     Sunday 20:50 to Monday 22:05: AUD/USD and the weekday US 500 (S1b's first tradable quote and its +24 h).
 * Starts are inclusive and ends exclusive, by the minute.
 */
export const QUOTE_WINDOWS = [
  { id: "FRI", from: { dow: 5, at: hm(21, 50) }, to: { dow: 5, at: hm(22, 5) }, roles: ["fx_audusd", "us500", "wallst", "ustech", "uk100", "de40"] },
  {
    id: "WKND", from: { dow: 6, at: hm(7, 55) }, to: { dow: 1, at: hm(1, 0) },
    roles: ["wknd_wallst", "wknd_ustech", "wknd_uk100", "wknd_de40", "wknd_gbpusd", "wknd_eurusd", "wknd_usdjpy"],
  },
  { id: "SUNIDX", from: { dow: 0, at: hm(20, 50) }, to: { dow: 1, at: hm(1, 0) }, roles: ["wallst", "ustech", "uk100", "de40"] },
  { id: "SUN", from: { dow: 0, at: hm(20, 50) }, to: { dow: 1, at: hm(22, 5) }, roles: ["fx_audusd", "us500"] },
] as const;

/** Minutes since Friday 00:00 UK, counting Saturday, Sunday and Monday on from it (the windows all fall in Fri–Mon). */
function weekPos(dow: number, minutes: number): number | null {
  const order: Record<number, number> = { 5: 0, 6: 1, 0: 2, 1: 3 };
  return dow in order ? order[dow] * 1440 + minutes : null;
}

/** The windows an instant falls in, and the union of their roles. */
export function activeWindows(ms: number): { ids: string[]; roles: string[] } {
  const c = ukClock(ms);
  const pos = weekPos(c.dow, c.minutes);
  const ids: string[] = [];
  const roles = new Set<string>();
  if (pos === null) return { ids, roles: [] };
  for (const w of QUOTE_WINDOWS) {
    const a = weekPos(w.from.dow, w.from.at)!, b = weekPos(w.to.dow, w.to.at)!;
    if (pos >= a && pos < b) {
      ids.push(w.id);
      for (const r of w.roles) roles.add(r);
    }
  }
  return { ids, roles: [...roles] };
}

/**
 * The database's wider window (`public.ig_quotes_window`, migration 0122), which switches the call's row on and off
 * every five minutes: Friday 21:35–22:20, then Saturday 07:40 to Monday 22:20, UK time. Every recorder window lies
 * inside it with at least ten minutes to spare at each end (the Deno test checks every minute of a year).
 */
export const DB_WINDOW = { fri: [hm(21, 35), hm(22, 20)], satFrom: hm(7, 40), monTo: hm(22, 20) } as const;
export function inDbWindow(ms: number): boolean {
  const c = ukClock(ms);
  if (c.dow === 5) return c.minutes >= DB_WINDOW.fri[0] && c.minutes < DB_WINDOW.fri[1];
  if (c.dow === 6) return c.minutes >= DB_WINDOW.satFrom;
  if (c.dow === 0) return true;
  if (c.dow === 1) return c.minutes < DB_WINDOW.monTo;
  return false;
}

// ---------------------------------------------------------------------------------------------------------------------
// History (G2). The frozen windows: `docs/agents/backtests/ig_deepdive/params/g2_s1a_frozen.json`, mirrored here and
// compared with that file by the Deno test.

/** The latest complete weekend when the parameters were frozen (2026-10-15): Friday 2026-10-09 to Monday 2026-10-12. */
export const HISTORY_ANCHOR_FRIDAY = "2026-10-09";
export const HISTORY_WEEKENDS = 51;
/** Each request is padded this much either side in UTC, because IG does not say which zone `from`/`to` are read in. */
export const HISTORY_PAD_MS = 2 * HOUR;

/**
 * The frozen pull plans. `start`/`end` are UK wall clock relative to the weekend's Friday (day 0 Friday, 3 Monday).
 * `probe` is G2's first small request per role, on the latest frozen weekend only.
 */
export const HISTORY_PLANS = {
  probe: {
    roles: ["fx_audusd", "wknd_wallst"], weekends: 1, start: { day: 2, at: hm(21, 0) }, end: { day: 3, at: hm(0, 0) },
    byRole: { wknd_wallst: { start: { day: 1, at: hm(12, 0) }, end: { day: 1, at: hm(15, 0) } } },
  },
  fxw: { roles: ["fx_audusd"], weekends: HISTORY_WEEKENDS, start: { day: 0, at: hm(20, 0) }, end: { day: 3, at: hm(22, 0) } },
  wknd: {
    roles: ["wknd_wallst", "wknd_ustech", "wknd_uk100", "wknd_de40", "wallst", "ustech", "uk100", "de40"],
    weekends: HISTORY_WEEKENDS, start: { day: 1, at: hm(8, 0) }, end: { day: 2, at: hm(23, 10) },
  },
  esg: { roles: ["us500"], weekends: HISTORY_WEEKENDS, start: { day: 0, at: hm(20, 0) }, end: { day: 3, at: hm(22, 0) } },
} as const;
export type HistoryPlanId = keyof typeof HISTORY_PLANS;

/** The Fridays of the frozen weekends, newest first, as `YYYY-MM-DD`. */
export function historyFridays(n = HISTORY_WEEKENDS, anchor = HISTORY_ANCHOR_FRIDAY): string[] {
  const a = Date.parse(anchor + "T00:00:00Z");
  return Array.from({ length: n }, (_, i) => new Date(a - i * 7 * DAY).toISOString().slice(0, 10));
}

export type HistoryWindow = {
  plan: HistoryPlanId; role: string; friday: string; key: string;
  /** The frozen window, UTC. */
  startMs: number; endMs: number;
  /** What is asked of IG: the window padded either side, written `yyyy-MM-ddTHH:mm:ss` in UTC. */
  from: string; to: string;
  /** The most points it can cost: one an hour over the padded span. */
  maxPoints: number;
};

const igTime = (ms: number) => new Date(ms).toISOString().slice(0, 19);

/** Every window of a plan, newest weekend first, roles in the plan's order within each weekend. */
export function historyWindows(plan: HistoryPlanId, roles?: readonly string[]): HistoryWindow[] {
  const p = HISTORY_PLANS[plan];
  const out: HistoryWindow[] = [];
  for (const friday of historyFridays(p.weekends)) {
    const [y, m, d] = friday.split("-").map(Number);
    for (const role of p.roles) {
      if (roles && !roles.includes(role)) continue;
      const own = "byRole" in p ? (p.byRole as Record<string, { start: { day: number; at: number }; end: { day: number; at: number } }>)[role] : undefined;
      const s: { day: number; at: number } = own?.start ?? p.start, e: { day: number; at: number } = own?.end ?? p.end;
      const at = (x: { day: number; at: number }) => {
        const dd = new Date(Date.UTC(y, m - 1, d + x.day));
        return ukToUtcMs(dd.getUTCFullYear(), dd.getUTCMonth() + 1, dd.getUTCDate(), Math.floor(x.at / 60), x.at % 60);
      };
      const startMs = at(s), endMs = at(e);
      const from = startMs - HISTORY_PAD_MS, to = endMs + HISTORY_PAD_MS;
      out.push({
        plan, role, friday, key: `${plan}:${role}:${friday}`, startMs, endMs,
        from: igTime(from), to: igTime(to), maxPoints: Math.ceil((to - from) / HOUR) + 1,
      });
    }
  }
  return out;
}

