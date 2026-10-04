// Mid-pool and the formula of 2026-10-04 (Addendum 2 of reviews/2026-10-02-polymarket-mid-pool-prereg.md): mid-pool runs
// the order path and its paper layer as mini-pool does, so the measurement fix reaches it through the shared code and
// nothing else of it moves. Here mid-pool runs through today's pm_live.ts and pm_prep.ts beside the code its
// pre-registration froze, byte for byte (`pm_live_mid_frozen.ts` and `pm_prep_mid_frozen.ts`, sha256 8ba7b915… and
// 8d7861ab…, held to that document's words by src/pm_mid_prereg.test.js), minute by minute over simulated days, dry-run
// and live, each world a database and a fake Polymarket of its own built the same way: every table, request, body and
// report is the frozen code's but for the fields the formula makes (pm_instance.test.ts names them for mini-pool), and
// those are asserted to be exactly that. So no decision of mid-pool changes: its selection (RW's exclusion recomputed
// from public data included), its quotes, its orders and cancels, its fills, its stops and its settlements.
//
// The frozen layer imports its book-keeping from today's pm_live.ts, as mini-pool's does (pm_instance.test.ts pins those
// functions to be the frozen path's own, text for text).

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import * as Frozen from "./pm_live_mid_frozen.ts";
import * as FrozenPrep from "./pm_prep_mid_frozen.ts";
import * as Path from "./pm_live.ts";
import * as Prep from "./pm_prep.ts";
import { PM_MID_INSTANCE, PREP_MID_INSTANCE } from "./pm_mid.ts";
import { PmOrderKey } from "../_shared/polymarket_orders.ts";
import { FakePolymarket, memDb, onlyTables, PM_TEST_FUNDER, PM_TEST_KEY, PM_TEST_SIGNER, type Row } from "./testing.ts";

const M = 60e3;
const iso = (ms: number) => new Date(ms).toISOString();
const at = (s: string) => Date.parse(s);
const cond = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const tok = (n: number, outcome: "yes" | "no") => `${9000000000000000000000000000000000000000000000000000000000000000000n + BigInt(n * 2 + (outcome === "no" ? 1 : 0))}`;
const T0 = at("2026-10-05T10:00:30Z");
/** Mid-pool's row as 0081 and 0084 leave it: dry-run, unarmed, the $400 sizes. */
const MID_CONFIG = {
  id: 1, dry_run: true, live_confirmed_at: null, ireland_attested_at: "2026-10-01T04:00:00.000Z", ireland_until: null,
  cap_total_usd: 320, cap_market_usd: 60, loss_day_usd: 25, loss_total_usd: 75, max_posts_day: 6000, gtd_lifetime_s: 600, max_markets: 8, select_budget_usd: 160,
  created_at: "2026-10-02T05:00:00.000Z", updated_at: "2026-10-02T05:00:00.000Z",
};

// deno-lint-ignore no-explicit-any
type Run = (d: any) => Promise<unknown>;

/**
 * Mid-pool's hand-worked market set (pm_mid.test.ts): every market the same book (0.45 / 0.47, 20 at each touch, minimum
 * 20, max spread 4.5 ¢). RW's $300 takes the thirteen $100 markets, R50 and M1 ($40, its last pick); the margin leaves
 * out M2 ($33) and M20 ($13.20); mid-pool takes M3 ($13.19), M4 ($12) and M5 ($10). S7, S8 and S9 are mini-pool's band.
 */
function markets(pm: FakePolymarket) {
  const add = (n: number, rate: number, extra: Record<string, unknown> = {}) =>
    pm.addMarket({ cond: cond(n), yes: tok(n, "yes"), no: tok(n, "no"), rate, sponsoredRate: null, minSize: 20, depth: [[0, 20]], ...extra });
  for (let k = 1; k <= 13; k++) add(100 + k, 100);
  const R50 = add(150, 50), M1 = add(201, 40), M2 = add(202, 33), M20 = add(220, 13.2), M3 = add(203, 13.19), M4 = add(204, 12), M5 = add(205, 10);
  const S7 = add(307, 7), S8 = add(308, 8), S9 = add(309, 9.99);
  return { R50, M1, M2, M20, M3, M4, M5, S7, S8, S9 };
}

/** One world of mid-pool alone: its path run by `runLive`, its paper layer by `runPrep`, prints through its bids. */
function midWorld(runLive: Run, runPrep: Run) {
  const clock = { now: T0 };
  const pm = new FakePolymarket(() => clock.now);
  const m = markets(pm);
  const s0 = Math.floor(T0 / 1000);
  type P = [number, "BUY" | "SELL", number, number, number];
  pm.prints.set(m.M3.cond, Array.from({ length: 50 }, (_, k): P => [s0 + k * 60 + 10, "SELL", 0, 0.40, 2])
    .concat([[s0 + 7 * 60 + 20, "BUY", 1, 0.50, 3], [s0 + 19 * 60 + 40, "BUY", 1, 0.50, 4]]));
  pm.prints.set(m.M4.cond, Array.from({ length: 25 }, (_, k): P => [s0 + k * 120 + 45, "SELL", 0, 0.40, 20]));
  const MID_TABLES = Object.values(PM_MID_INSTANCE.tables), PREP_TABLES = Object.values(PREP_MID_INSTANCE.tables);
  const mem = memDb({
    agent_locks: [{ name: "pm-mid", lease_until: iso(0), holder: null }, { name: "pm-midprep", lease_until: iso(0), holder: null }],
    agent_risk: [{ id: 1, global_pause: false }],
    pm_mid_config: [{ ...MID_CONFIG }],
    ...Object.fromEntries([...MID_TABLES.filter((t) => t !== "pm_mid_config"), ...PREP_TABLES].map((t) => [t, []])),
  }, { now: () => clock.now });
  const db = onlyTables(mem.db, Path.pmLiveDbTables(PM_MID_INSTANCE), { lease: "pm-mid", readOnly: ["agent_risk"] });
  const prepDb = onlyTables(mem.db, Prep.prepDbTables(PREP_MID_INSTANCE), { lease: "pm-midprep", readOnly: Prep.prepReads(PREP_MID_INSTANCE) });
  const key = new PmOrderKey(PM_TEST_KEY);
  let salt = 1000;
  const w = {
    clock, pm, mem, ...m,
    async turn(t: number) {
      clock.now = t;
      const live = await runLive({
        db, now: t, holder: `h${t}`, venue: pm.venue(), sbRegion: "eu-west-1", sendsEnabled: true,
        account: { maker: PM_TEST_FUNDER, signer: PM_TEST_SIGNER }, signer: key, salt: () => String(salt++), pause: () => Promise.resolve(), clock: () => clock.now,
        inst: PM_MID_INSTANCE, pm: { fetchImpl: pm.publicFetch },
      });
      clock.now = t + 5e3;
      const prep = await runPrep({ db: prepDb, now: t + 5e3, holder: `p${t}`, inst: PREP_MID_INSTANCE, pm: { fetchImpl: pm.publicFetch, clock: () => clock.now } });
      return { live, prep };
    },
    open: () => (mem.tables.pm_mid_orders as Row[]).filter((o) => o.state === "pending" || o.state === "live"),
    setConfig(p: Record<string, unknown>) { Object.assign((mem.tables.pm_mid_config as Row[])[0], p); },
    setPause(on: boolean) { (mem.tables.agent_risk as Row[])[0].global_pause = on; },
  };
  return w;
}
type MidWorld = ReturnType<typeof midWorld>;

const yesBid = (w: MidWorld, c: string) => w.open().find((o) => o.mode === "live" && o.cond === c && o.outcome === "yes" && o.side === "BUY");
const LIVE_FROM = at("2026-10-06T01:05:30Z");

/** The days, as [when, what changes just before the turn]: the patch's and pm_instance.test.ts's, on mid-pool's markets. */
const STEPS: Array<[number, ((w: MidWorld) => void)?]> = [
  [T0],
  ...Array.from({ length: 30 }, (_, k): [number, ((w: MidWorld) => void)?] => {
    const acts: Record<number, (w: MidWorld) => void> = {
      2: (w) => { w.M3.bid = 0.46; },                                           // a re-price
      4: (w) => { w.M4.bid = 0.30; },                                           // M4's bid gone for a minute: our resting
      5: (w) => { w.M4.bid = 0.45; },                                           // quotes set the venue's midpoint
      6: (w) => { w.M4.bid = 0; },                                              // M4's book one-sided
      8: (w) => { w.M4.bid = 0.45; },
      9: (w) => { w.pm.down.geoblock = true; },                                 // answered from memory, then closed
      12: (w) => w.setPause(true),
      14: (w) => w.setPause(false),
      16: (w) => { w.pm.down.collateral = true; },
      17: (w) => { w.pm.down.collateral = false; },
      21: (w) => { w.pm.down.geoblock = false; },
      25: (w) => { w.M5.resolved = true; },                                     // M5 leaves the book
    };
    return [T0 + (k + 1) * M, acts[k + 1]];
  }),
  [T0 + 45 * M], [T0 + 46 * M],
  [at("2026-10-06T00:00:30Z")], [at("2026-10-06T00:01:30Z")], [at("2026-10-06T00:02:30Z")],
  [at("2026-10-06T01:00:30Z")],
  [LIVE_FROM, (w) => { w.setConfig({ dry_run: false, live_confirmed_at: "2026-10-06T01:05:00.000Z", loss_day_usd: 0.5 }); }],
  [at("2026-10-06T01:06:30Z"), (w) => { const o = yesBid(w, w.M3.cond); if (o) w.pm.settle(w.pm.fill(String(o.hash), 20), "CONFIRMED"); }],
  [at("2026-10-06T01:07:30Z"), (w) => { w.M4.bid = 0.44; w.pm.postMode = "lose-reply"; }],
  [at("2026-10-06T01:08:30Z"), (w) => { w.pm.postMode = "ok"; }],
  [at("2026-10-06T01:09:30Z"), (w) => { w.M4.bid = 0.45; w.pm.restart = true; }],
  [at("2026-10-06T01:10:30Z"), (w) => { w.pm.restart = false; }],
  [at("2026-10-06T01:11:30Z"), (w) => { w.M4.bid = 0.44; w.pm.cancelLagReads = 5; }],
  [at("2026-10-06T01:12:30Z"), (w) => { w.pm.cancelLagReads = 1; }],
  [at("2026-10-06T01:13:30Z"), (w) => { w.M4.bid = 0.45; w.pm.cancelMode = "lost"; }],
  [at("2026-10-06T01:14:30Z")],
  [at("2026-10-06T01:15:30Z"), (w) => { w.pm.cancelMode = "ok"; w.setPause(true); }],
  [at("2026-10-06T01:16:30Z"), (w) => w.setPause(false)],
  [at("2026-10-06T01:17:30Z"), (w) => { w.M3.bid = 0.30; w.M3.ask = 0.33; }],    // M3's 20 YES fall: the day's loss stop
  [at("2026-10-06T01:18:30Z")],
  [at("2026-10-07T00:01:30Z")],
  [at("2026-10-07T01:00:30Z")],
  [at("2026-10-07T06:00:30Z"), (w) => { Object.assign(w.M3, { resolved: true, payout: 0, closedTime: "2026-10-07 05:58:00+00" }); }],
  [at("2026-10-07T06:01:30Z")], [at("2026-10-07T06:02:30Z")],
];

/** The fields the formula of 2026-10-04 makes (pm_instance.test.ts's list, on mid-pool's tables), taken out. */
function masked(tables: Record<string, unknown>): Record<string, Row[]> {
  const t = structuredClone(tables) as Record<string, Row[]>;
  for (const r of t.pm_mid_minutes ?? []) { delete r.ours; delete r.others; delete r.formula_usd; delete r.detail; }
  for (const r of t.pm_mid_reward_days ?? []) { delete r.formula_usd; delete r.formula_scored_usd; delete r.minutes_two_sided; }
  for (const e of t.pm_mid_events ?? []) {
    if (e.kind === "readout") for (const d of ((e.detail as { days?: Row[] })?.days ?? [])) { delete d.formula; delete d.formulaScored; }
  }
  for (const r of t.pm_mid_state ?? []) for (const m of ((r.state as { minutes?: Row[] })?.minutes ?? [])) { delete m.formula; delete m.ours; delete m.others; }
  for (const r of t.pm_midprep_minutes ?? []) { delete r.reward; delete r.detail; }
  for (const r of t.pm_midprep_days ?? []) { delete r.reward; delete r.reward_r40; delete r.pnl_day_r40; }
  for (const r of t.pm_midprep_state ?? []) {
    const st = r.state as { acc?: Record<string, Row>; day?: Row };
    if (st?.acc) for (const a of Object.values(st.acc)) delete a.reward;
    if (st?.day) delete st.day.reward;
  }
  return t;
}
// deno-lint-ignore no-explicit-any
function maskedReport(r: any): unknown {
  const x = structuredClone(r);
  for (const m of x.live?.minutes ?? []) { delete m.formula; delete m.ours; delete m.others; }
  for (const d of x.live?.readout ?? []) delete d.formula;
  if (x.prep) delete x.prep.reward;
  return x;
}
/** Where two records first differ, table and row, so a failure says where; "" when they are the same. */
function firstDiff(a: Record<string, unknown>, b: Record<string, unknown>): string {
  for (const t of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = (a[t] ?? []) as unknown[], y = (b[t] ?? []) as unknown[];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (JSON.stringify(x[i]) !== JSON.stringify(y[i])) return `${t}[${i}]: ${JSON.stringify(x[i])} against ${JSON.stringify(y[i])}`;
    }
  }
  return "";
}

Deno.test("mid-pool through today's path and layer is mid-pool through the code its pre-registration froze, turn by turn, dry-run and live, but the fields the formula of 2026-10-04 makes", async () => {
  const frozen = midWorld(Frozen.runPmLive, FrozenPrep.runPmPrep), today = midWorld(Path.runPmLive, Prep.runPmPrep);
  const states = new Set<string>();
  for (const [t, act] of STEPS) {
    for (const w of [frozen, today]) act?.(w);
    const a = await frozen.turn(t), b = await today.turn(t);
    const label = iso(t);
    assertEquals(JSON.stringify(maskedReport(b)), JSON.stringify(maskedReport(a)), `reports at ${label}`);
    assertEquals(firstDiff(masked(today.mem.tables), masked(frozen.mem.tables)), "", `tables after ${label}`);
    assertEquals(today.pm.urls, frozen.pm.urls, `requests by ${label}`);
    assertEquals(today.pm.bodies, frozen.pm.bodies, `bodies by ${label}`);
    for (const o of today.mem.tables.pm_mid_orders as Row[]) states.add(`${o.mode}:${o.state}`);
  }
  const T = today.mem.tables as Record<string, Row[]>, F = frozen.mem.tables as Record<string, Row[]>;
  // What the days went through: the decisions compared above are real ones.
  for (const s of ["dry_run:live", "dry_run:cancelled", "dry_run:expired", "live:live", "live:cancelled", "live:filled"]) assert(states.has(s), `${s} in ${[...states]}`);
  assert(T.pm_mid_events.some((e) => e.kind === "loss_stop_day") && T.pm_mid_settlements.length >= 1, "a stop and a settlement");
  assert(T.pm_midprep_fills.length >= 5 && T.pm_midprep_minutes.some((m) => m.class === "matched"), "paper fills and matched minutes");
  // The decisions, whole: orders, fills, selections, settlements and the paper's fills are the frozen code's.
  for (const k of ["pm_mid_orders", "pm_mid_fills", "pm_mid_markets", "pm_mid_settlements", "pm_midprep_fills", "pm_midprep_settlements", "pm_midprep_events"]) {
    assertEquals(JSON.stringify(T[k]), JSON.stringify(F[k]), k);
  }
  // The formula's fields: RW's midpoint is the frozen code's own; where the venue's is the same, so is every figure.
  const key = (r: Row) => `${r.mode}|${r.minute}|${r.cond}`;
  const old = new Map(F.pm_mid_minutes.map((r) => [key(r), r]));
  const same = { dry_run: 0, live: 0 }, moved = { dry_run: 0, live: 0 };
  for (const r of T.pm_mid_minutes) {
    const o = old.get(key(r))!, d = r.detail as Record<string, any>, od = o.detail as Record<string, any>;
    assertEquals(d.mRw, od.m, key(r));
    if (d.m === od.m || (d.m !== null && od.m !== null && Math.abs(d.m - od.m) < 1e-12)) {
      same[r.mode as "dry_run" | "live"]++;
      for (const f of ["ours", "others", "formula_usd"]) assertAlmostEquals(Number(r[f]), Number(o[f]), 1e-12, `${key(r)} ${f}`);
    } else moved[r.mode as "dry_run" | "live"]++;
  }
  assert(same.dry_run > 20 && moved.dry_run >= 1 && moved.live >= 1, JSON.stringify({ same, moved }));
  console.log(JSON.stringify({ midMinutesSame: same, midMinutesMoved: moved }));
});

Deno.test("every export of the code mid-pool froze is today's, text for text and value for value, but the formula, the selection's book-quality hook and the paper's reward", () => {
  const check = (frozen: Record<string, unknown>, now: Record<string, unknown>, changed: string[]) => {
    for (const [k, v] of Object.entries(frozen)) {
      assert(k in now, `${k} is still exported`);
      if (typeof v === "function") {
        if (changed.includes(k)) assert(String(now[k]) !== String(v), `${k} is one the fix changed`);
        else assertEquals(String(now[k]), String(v), k);
      } else assertEquals(now[k], v, k);
    }
  };
  // The path: the formula takes the venue's book (`minuteFormula`), and the selection an instance's book-quality rule
  // (`selectMarkets`; mid-pool's instance has none). The turn's record of `detail.after` is inside `runPmLive`'s turn.
  check(Frozen as Record<string, unknown>, Path as Record<string, unknown>, ["minuteFormula", "selectMarkets"]);
  // The layer: a matched minute is paid the path's figure (`decideMinute`).
  check(FrozenPrep as Record<string, unknown>, Prep as Record<string, unknown>, ["decideMinute"]);
  // The frozen layer's book-keeping, from today's pm_live.ts, is the frozen path's own.
  for (const name of ["bookPnl", "closeOnly", "effectiveLimits", "inYesBook", "onTick", "settlementFills", "tokenBooks"] as const) {
    assertEquals(String(Path[name]), String(Frozen[name]), name);
  }
  assertEquals(PM_MID_INSTANCE.bookQuality, undefined);
  // What each instance of the layer may touch and reads is the frozen layer's own.
  assertEquals([...Prep.PREP_DB_TABLES].sort(), [...FrozenPrep.PREP_DB_TABLES].sort());
  assertEquals([...Prep.prepDbTables(PREP_MID_INSTANCE)].sort(), [...FrozenPrep.prepDbTables(PREP_MID_INSTANCE)].sort());
  assertEquals(Prep.prepReads(PREP_MID_INSTANCE), FrozenPrep.prepReads(PREP_MID_INSTANCE));
});
