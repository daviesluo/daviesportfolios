// The paper layers' worst case at the start of each UTC day (migration 0094): what lets "Reward quotes mini-pool",
// "mid-pool" and "live-prep" show a WORST CASE for each day of their DAYS table, today's live, as RW's rows do (Davies,
// 2026-10-07: "Reward quotes列表里后三个点开之后DAYS里worst case里没数据", then "WORST CASE目前是当天实时都可以显示吧？…之前的问题只是
// mini-pool、mid-pool、live-prep 展开后 WORST CASE 列为空").
//
// WHAT IT RECORDS. A layer's worst case is RW's (`accStress`) on its account per market (`PrepState.acc`), summed: the
// running figure its page shows. RW's engine stores that sum at each day's close; the paper layer (`pm_prep.ts`, frozen,
// its hash pinned in three pre-registrations) keeps none. So this module, called after each turn of a layer by its
// action in index.ts, keeps one row a layer and a day in `pm_prep_stress_days`: the cumulative worst case at the day's
// 00:00 UTC (`stress`) and the accounts it is the sum of (`parts`, the fields of RW's `Acc` that `accStress` reads). A
// closed day's worst case is then the next day's row less its own, and today's is the running figure less today's row.
// It writes nothing of the layer's and changes nothing the layer reads.
//
// THREE SOURCES, each exact:
//   recorded  the layer's own state, read after a turn whose last decided minute is 23:59 UTC (the state at rest at the
//             day's end: `restBaseline`). This is how every day is recorded in the normal run of things.
//   start     the layer's first day, 0: its accounts begin empty (`newState`), so before its first minute it has nothing.
//   replay    a day whose turn at rest was missed (a catch-up that decided 23:59 and 00:00 in one run) or that came before
//             this module: the day before's row with the day's records applied (`replayParts`). Each field of an account
//             is either summed or last-written by the layer, so its records reproduce it: the rewards are the sum of its
//             minutes' (`reward`, the figure each decided minute adds to its account), each fill is applied by RW-E's
//             `applyFill` (stepRw's, stepSides' and the close-only path's own book-keeping) with the tick of the path's
//             minute, the touch is the last minute of the day the path recorded with a two-sided book and both adjusted
//             touches (the layer sets `lastAb`/`lastAa` from every such minute it decides), and a settlement counts once
//             the run that recorded it is the one at rest (`settled_at` before the day's 00:00 plus the two-minute lag).
//             On 2026-10-07 21:23 UTC the same reconstruction over every record reproduced all three layers' stored
//             accounts, 52, 48 and 39 markets, to 2e-13 (the read-only checks in the ledger's history of that day).
//
// One row a run at most past the first: a layer's backfill runs a day a turn, oldest first, each from the row before.

import { accStress, newAcc, RW_DECIDE_LAG_MS, type Acc } from "./pmrw.ts";
import { applyFill } from "./pmrw_e.ts";
import type { PrepInstance, PrepState } from "./pm_prep.ts";
import type { Db } from "./db.ts";

const M = 60e3, DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();
const dayStr = (ms: number) => iso(Math.floor(ms / DAY) * DAY).slice(0, 10);
const enc = encodeURIComponent;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Its table (0094): one row a layer (its lease's name) and a UTC day. */
export const PREP_STRESS_TABLE = "pm_prep_stress_days";
export type PrepStressSource = "start" | "recorded" | "replay";
/** The fields of RW's account that its worst case reads. */
export type StressPart = Pick<Acc, "reward" | "cash" | "net" | "tickCost" | "lastM" | "lastAb" | "lastAa" | "settled">;
export type StressParts = Record<string, StressPart>;
export type PrepStressRow = { layer: string; day: string; stress: number | string; parts: StressParts; source: PrepStressSource; detail?: unknown };
/** Replays past the first row in one run, at most. */
export const PREP_STRESS_REPLAYS_PER_RUN = 2;

/** A layer's key in the table: its lease's name, which is its own and never a display name. */
export const stressLayer = (inst: PrepInstance) => inst.lock;

export const partOf = (a: Acc): StressPart => ({
  reward: a.reward, cash: a.cash, net: a.net, tickCost: a.tickCost, lastM: a.lastM ?? null, lastAb: a.lastAb ?? null, lastAa: a.lastAa ?? null, settled: a.settled ?? null,
});
export function partsOf(acc: Record<string, Acc>): StressParts {
  const out: StressParts = {};
  for (const [c, a] of Object.entries(acc)) out[c] = partOf(a);
  return out;
}
/** The worst case of a set of accounts: RW's `accStress` on each, summed, as the page sums the layer's. */
export function stressOfParts(parts: StressParts): number {
  let s = 0;
  for (const p of Object.values(parts)) s += accStress({ ...newAcc(), ...p });
  return s;
}
/** The first minute a layer decides: its state starts the two-minute lag and a minute behind the run that made it. */
export const firstMinuteOf = (startedAt: string) => Math.floor(Date.parse(startedAt) / M) * M - RW_DECIDE_LAG_MS;

/** The state at rest at a day's end: its last decided minute is 23:59 UTC, so its accounts are the next day's start. */
export function restBaseline(st: PrepState): { day: string; stress: number; parts: StressParts } | null {
  const x = st.lastDecided + M;
  if (!Number.isFinite(x) || x % DAY !== 0) return null;
  const parts = partsOf(st.acc ?? {});
  return { day: dayStr(x), stress: stressOfParts(parts), parts };
}

export type ReplayInputs = {
  /** The layer's decided minutes with a reward, in the window. */
  rewards: Array<{ cond: string; minute: string; reward: number | string }>;
  /** The layer's fills, in the window. */
  fills: Array<{ cond: string; minute: string; ts: string; print_id: string; side: "bid" | "ask"; price: number | string; size: number | string }>;
  /** The path's minutes of the markets that matter (`tick` for each fill's minute, the touches for the last book). */
  minutes: Array<{ cond: string; minute: string; tick: number | string | null; bb: number | string | null; ba: number | string | null; ab: number | string | null; aa: number | string | null }>;
  /** The layer's settlements, all of them. */
  settlements: Array<{ cond: string; payout: number | string; settled_at: string }>;
};

/**
 * The accounts at `to` (a UTC midnight), from those at the window's start and the window's records: each minute's reward
 * added, each fill applied by `applyFill` at its minute's tick, the touch of the last minute with a full book, and every
 * settlement the turn at rest would have recorded. Throws if a fill has no tick: a figure that cannot be reproduced is
 * not written.
 */
export function replayParts(base: StressParts, to: number, inp: ReplayInputs): StressParts {
  const acc: Record<string, Acc> = {};
  for (const [c, p] of Object.entries(base)) acc[c] = { ...newAcc(), ...p };
  const of = (c: string) => (acc[c] ??= newAcc());
  const rewards = inp.rewards.slice().sort((a, b) => Date.parse(a.minute) - Date.parse(b.minute) || (a.cond < b.cond ? -1 : a.cond > b.cond ? 1 : 0));
  for (const r of rewards) of(r.cond).reward += Number(r.reward);
  const tick = new Map<string, number>();
  for (const m of inp.minutes) if (m.tick != null) tick.set(`${m.cond}|${Date.parse(m.minute)}`, Number(m.tick));
  // In the layer's order: by minute, the markets of a minute in turn, a market's fills by its prints' time.
  const fills = inp.fills.slice().sort((a, b) => Date.parse(a.minute) - Date.parse(b.minute) || (a.cond < b.cond ? -1 : a.cond > b.cond ? 1 : 0)
    || Date.parse(a.ts) - Date.parse(b.ts) || (a.print_id < b.print_id ? -1 : a.print_id > b.print_id ? 1 : 0));
  for (const f of fills) {
    const t = tick.get(`${f.cond}|${Date.parse(f.minute)}`);
    if (t === undefined) throw new Error(`no tick for the fill of ${f.cond.slice(0, 10)}… at ${f.minute}`);
    applyFill(of(f.cond), { side: f.side, price: Number(f.price), size: Number(f.size) }, t);
  }
  const last = new Map<string, { t: number; ab: number; aa: number }>();
  for (const m of inp.minutes) {
    if (m.bb == null || m.ba == null || m.ab == null || m.aa == null) continue;
    const t = Date.parse(m.minute), cur = last.get(m.cond);
    if (t < to && (!cur || t > cur.t)) last.set(m.cond, { t, ab: Number(m.ab), aa: Number(m.aa) });
  }
  for (const [c, b] of last) { const a = of(c); a.lastAb = b.ab; a.lastAa = b.aa; a.lastM = (b.ab + b.aa) / 2; }
  for (const s of inp.settlements) if (acc[s.cond] && Date.parse(s.settled_at) < to + RW_DECIDE_LAG_MS) acc[s.cond].settled = Number(s.payout);
  return partsOf(acc);
}

/**
 * The records of the window [from, to) a replay needs, from the layer's tables and the path's: its rewarded minutes, its
 * fills, its settlements, and the path's minutes of every market that holds something at `to` or filled in the window
 * (only those carry a touch the worst case reads: a market holding nothing adds its rewards and cash, at any touch).
 */
export async function readReplayInputs(db: Db, inst: PrepInstance, base: StressParts, from: number, to: number): Promise<ReplayInputs> {
  const T = inst.tables, R = inst.reads, w = `minute=gte.${enc(iso(from))}&minute=lt.${enc(iso(to))}`;
  const [rewards, fills, settlements] = await Promise.all([
    db.selectAll<ReplayInputs["rewards"][number]>(T.minutes, `${w}&reward=gt.0&select=cond,minute,reward&order=minute.asc,cond.asc`),
    db.selectAll<ReplayInputs["fills"][number]>(T.fills, `${w}&select=cond,minute,ts,print_id,side,price,size&order=cond.asc,minute.asc,print_id.asc`),
    db.selectAll<ReplayInputs["settlements"][number]>(T.settlements, "select=cond,payout,settled_at&order=cond.asc"),
  ]);
  // Which markets hold something at `to`: the base's inventory and the window's fills.
  const net = new Map<string, number>();
  for (const [c, p] of Object.entries(base)) net.set(c, p.net);
  for (const f of fills) net.set(f.cond, (net.get(f.cond) ?? 0) + (f.side === "bid" ? 1 : -1) * Number(f.size));
  const conds = [...new Set([...fills.map((f) => f.cond), ...[...net].filter(([, n]) => Math.abs(n) > 1e-12).map(([c]) => c)])].sort();
  const minutes: ReplayInputs["minutes"] = [];
  for (const c of conds) {
    minutes.push(...await db.selectAll<ReplayInputs["minutes"][number]>(R.minutes,
      `mode=eq.dry_run&cond=eq.${enc(c)}&${w}&select=cond,minute,tick,bb,ba,ab,aa&order=mode.asc,minute.asc,cond.asc`));
  }
  return { rewards, fills, minutes, settlements };
}

export type PrepStressReport = { layer: string; wrote: Array<{ day: string; source: PrepStressSource; stress: number }>; errors: string[] };

/**
 * After a turn of a layer: record its state at rest when its last decided minute is 23:59 UTC, write its first day's
 * row, and replay the oldest days it has no row for, from the row before each (`PREP_STRESS_REPLAYS_PER_RUN` a run).
 * Never throws: what fails is in `errors`.
 */
export async function recordPrepStress(db: Db, inst: PrepInstance, maxReplays = PREP_STRESS_REPLAYS_PER_RUN): Promise<PrepStressReport> {
  const layer = stressLayer(inst);
  const report: PrepStressReport = { layer, wrote: [], errors: [] };
  try {
    const st = (await db.select<{ state: PrepState }>(inst.tables.state, "id=eq.1&select=state"))[0]?.state;
    if (!st || st.version !== 1 || typeof st.startedAt !== "string" || !Number.isFinite(st.lastDecided)) return report;
    const rows = await db.selectAll<PrepStressRow>(PREP_STRESS_TABLE, `layer=eq.${enc(layer)}&select=layer,day,stress,parts,source&order=layer.asc,day.asc`);
    const have = new Map(rows.map((r) => [String(r.day).slice(0, 10), r]));
    const put = async (day: string, stress: number, parts: StressParts, source: PrepStressSource, detail: unknown = null) => {
      const row = { layer, day, stress, parts, source, detail, recorded_at: new Date().toISOString() };
      await db.upsert(PREP_STRESS_TABLE, [row], "layer,day");
      have.set(day, row);
      report.wrote.push({ day, source, stress });
    };
    // 1. At rest at a day's end: the layer's own accounts. A row a replay wrote is replaced, and its figure kept beside.
    const rest = restBaseline(st);
    if (rest && have.get(rest.day)?.source !== "recorded") {
      const prior = have.get(rest.day);
      await put(rest.day, rest.stress, rest.parts, "recorded", prior ? { replaced: { source: prior.source, stress: Number(prior.stress) } } : null);
    }
    // 2. Its first day: nothing before its first minute.
    const first = firstMinuteOf(st.startedAt), startDay = dayStr(first);
    if (!have.has(startDay)) await put(startDay, 0, {}, "start");
    // 3. The oldest missing days the layer has decided to the end of, each from the day before's row.
    const upTo = st.lastDecided + M;
    let replays = 0;
    for (let d = Math.floor(first / DAY) * DAY + DAY; d <= upTo && replays < maxReplays; d += DAY) {
      if (have.has(dayStr(d))) continue;
      const prev = have.get(dayStr(d - DAY));
      if (!prev) break;
      const from = Math.max(d - DAY, first);
      const inputs = await readReplayInputs(db, inst, prev.parts, from, d);
      const parts = replayParts(prev.parts, d, inputs);
      await put(dayStr(d), stressOfParts(parts), parts, "replay", { from: dayStr(d - DAY), rewards: inputs.rewards.length, fills: inputs.fills.length });
      replays++;
    }
  } catch (e) {
    report.errors.push(`stress days: ${msg(e)}`);
  }
  return report;
}
