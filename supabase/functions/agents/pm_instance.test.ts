// The order path and its paper layer as instances (2026-10-02): the default instance IS the code the live-prep
// pre-registration froze. `pm_live_frozen.ts` and `pm_prep_frozen.ts` are those two files byte for byte (sha256
// fbdaca34…b89 and 83fe596f…061, held to the pre-registration's own words by src/pm_prep_prereg.test.js); here they run
// beside today's default instance over the same simulated days, minute by minute, each pair in a database and against a
// fake Polymarket of its own built the same way, and after every turn every table, every request the fake received
// (method, URL with its query, body) and every report of the two are compared whole.
//
// The days go through what the path does: the selection by RW's ranking, RW's quotes, a re-price, the refreshes, a missed
// stretch whose orders expire, a one-sided book, a market that leaves the book, the geoblock failing (answered from
// memory for ten minutes, then closed and reported once), the pause, a balance that cannot be read, the next UTC day's
// selection and the readout; then live: the dry-run's rows giving way, posts, a fill read back by its hash with its trade
// CONFIRMED, a lost reply settled the next turn, a 425 restart, a cancel the venue carries out late and one it never
// carries out, the pause's cancel-all, the day's loss stop, the next day, a readout with earnings and rebates, and a held
// market settled at its payout. Beside every turn the paper layer decides the dry-run's minutes from prints through the
// quotes, fills, books and closes its days. Without the coverage this test also asserts, an equality would prove nothing.
//
// The frozen layer imports its book-keeping from today's pm_live.ts (its one import of that file, which a byte-for-byte
// copy cannot change): those functions are pinned below to be the frozen path's own, text for text.
//
// The day stop of 2026-10-07 (Davies: "只算当天变化"; Addendum 8 of the pre-registration) changes a decision, so the
// comparison runs today's default instances on the day stop the pre-registration froze (`dayStopOnCost`, set by no
// action), as Addendum 6 ran the default without mini-pool's book-quality rule; the last test runs the default as
// deployed beside that, over the same days, and finds the day stop the one difference, worked by hand.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import * as Frozen from "./pm_live_frozen.ts";
import * as FrozenPrep from "./pm_prep_frozen.ts";
import * as Path from "./pm_live.ts";
import * as Prep from "./pm_prep.ts";
import { PmOrderKey } from "../_shared/polymarket_orders.ts";
import { FakePolymarket, memDb, onlyTables, PM_TEST_FUNDER, PM_TEST_KEY, PM_TEST_SIGNER, type Row } from "./testing.ts";

const M = 60e3;
const iso = (ms: number) => new Date(ms).toISOString();
const at = (s: string) => Date.parse(s);
const cond = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const tok = (n: number, outcome: "yes" | "no") => `${7000000000000000000000000000000000000000000000000000000000000000000n + BigInt(n * 2 + (outcome === "no" ? 1 : 0))}`;
const T0 = at("2026-10-02T10:00:30Z");
const CONFIG = {
  id: 1, dry_run: true, live_confirmed_at: null, ireland_attested_at: "2026-10-01T04:00:00.000Z", ireland_until: null,
  cap_total_usd: 320, cap_market_usd: 60, loss_day_usd: 25, loss_total_usd: 75, max_posts_day: 6000, gtd_lifetime_s: 300, max_markets: 3, select_budget_usd: 60,
};

// deno-lint-ignore no-explicit-any
type RunLive = (d: any) => Promise<unknown>;
// deno-lint-ignore no-explicit-any
type RunPrep = (d: any) => Promise<unknown>;

/** One world: makeWorld's universe (pm_live.test.ts), the path's and the layer's tables, a fake with prints through the bids. */
/** An instance pair a world runs: none given, the code's own default (no `inst` passed at all). */
type Inst = { live: Path.PmLiveInstance; prep: Prep.PrepInstance };
/** Today's default instances on the day stop the pre-registration froze: every change but 2026-10-07's. */
const ON_COST: Inst = { live: { ...Path.PM_LIVE_INSTANCE, dayStopOnCost: true }, prep: { ...Prep.PREP_INSTANCE, dayStopOnCost: true } };
/** The default instances as deployed, named. */
const NAMED: Inst = { live: Path.PM_LIVE_INSTANCE, prep: Prep.PREP_INSTANCE };

function world(runLive: RunLive, runPrep: RunPrep, inst?: Inst) {
  const clock = { now: T0 };
  const pm = new FakePolymarket(() => clock.now);
  const add = (n: number, extra: Record<string, unknown>) => pm.addMarket({ cond: cond(n), yes: tok(n, "yes"), no: tok(n, "no"), depth: [[0, 5]], ...extra });
  add(1, { rate: 50, bid: 0.30, ask: 0.32 });
  add(2, { rate: 10, bid: 0.60, ask: 0.62 });
  add(3, { rate: 8, sponsoredRate: 12, bid: 0.40, ask: 0.42 });
  add(4, { rate: 8, accepting: false, bid: 0.40, ask: 0.42 });
  const A = add(5, { rate: 8, bid: 0.45, ask: 0.47, minSize: 5 });
  const B = add(6, { rate: 7, negRisk: true, bid: 0.20, ask: 0.23, tick: "0.001", minSize: 20, depth: [[0, 20]] });
  const C = add(7, { rate: 8.5, bid: 0.50, ask: 0.52, minSize: 20, depth: [[0, 40]] });
  add(8, { rate: 5.9, bid: 0.45, ask: 0.47 });
  add(9, { rate: 9.9, bid: 0.45, ask: 0.47, minSize: 25, depth: [[0, 25]] });
  add(10, { rate: 9, bid: 0.45, ask: 0.47, endDate: iso(T0 + 86400e3) });
  add(11, { rate: 9, bid: 0.45, ask: 0.47, gameStartTime: "2026-10-03 18:00:00+00" });
  add(12, { rate: 9, bid: 0.45, ask: 0.47, depth: [[0, 15]] });
  // Prints through RW's bids every minute of the first day's dry-run, and a NO buy through A's ask now and then.
  const s0 = Math.floor(T0 / 1000);
  type P = [number, "BUY" | "SELL", number, number, number];
  pm.prints.set(A.cond, Array.from({ length: 50 }, (_, k): P => [s0 + k * 60 + 10, "SELL", 0, 0.40, 2])
    .concat([[s0 + 7 * 60 + 20, "BUY", 1, 0.50, 3], [s0 + 19 * 60 + 40, "BUY", 1, 0.50, 4]]));
  pm.prints.set(B.cond, Array.from({ length: 50 }, (_, k): P => [s0 + k * 60 + 30, "SELL", 0, 0.15, 6]));
  pm.prints.set(C.cond, Array.from({ length: 25 }, (_, k): P => [s0 + k * 120 + 45, "SELL", 0, 0.45, 20]));
  const mem = memDb({
    agent_locks: [{ name: "pm-live", lease_until: iso(0), holder: null }, { name: Prep.PREP_LOCK, lease_until: iso(0), holder: null }],
    agent_risk: [{ id: 1, global_pause: false }],
    pm_live_config: [{ ...CONFIG }],
    pm_live_markets: [], pm_live_orders: [], pm_live_fills: [], pm_live_events: [], pm_live_state: [], pm_live_minutes: [], pm_live_reward_days: [], pm_live_settlements: [],
    pm_prep_state: [], pm_prep_minutes: [], pm_prep_prints: [], pm_prep_fills: [], pm_prep_days: [], pm_prep_settlements: [], pm_prep_events: [],
  }, { now: () => clock.now });
  const liveDb = onlyTables(mem.db, Path.PM_LIVE_DB_TABLES, { lease: "pm-live", readOnly: ["agent_risk"] });
  const prepDb = onlyTables(mem.db, Prep.PREP_DB_TABLES, { lease: Prep.PREP_LOCK, readOnly: Prep.PREP_READS });
  const key = new PmOrderKey(PM_TEST_KEY);
  let salt = 1000;
  const w = {
    clock, pm, mem, A, B, C,
    async turn(t: number) {
      clock.now = t;
      const live = await runLive({
        db: liveDb, now: t, holder: `h${t}`, venue: pm.venue(), sbRegion: "eu-west-1", sendsEnabled: true,
        account: { maker: PM_TEST_FUNDER, signer: PM_TEST_SIGNER }, signer: key, salt: () => String(salt++), pause: () => Promise.resolve(), clock: () => clock.now,
        ...(inst ? { inst: inst.live } : {}),
      });
      clock.now = t + 5e3;
      const prep = await runPrep({
        db: prepDb, now: t + 5e3, holder: `p${t}`, pm: { fetchImpl: pm.publicFetch, clock: () => clock.now },
        ...(inst ? { inst: inst.prep } : {}),
      });
      return { live, prep };
    },
    open: () => (mem.tables.pm_live_orders as Row[]).filter((o) => o.state === "pending" || o.state === "live"),
    setConfig(p: Record<string, unknown>) { Object.assign((mem.tables.pm_live_config as Row[])[0], p); },
    setPause(on: boolean) { (mem.tables.agent_risk as Row[])[0].global_pause = on; },
  };
  return w;
}
type World = ReturnType<typeof world>;

/** The resting live BUY of YES in a market, as both worlds hold it (the same hash in each, or the worlds differ). */
const yesBid = (w: World, c: string) => w.open().find((o) => o.mode === "live" && o.cond === c && o.outcome === "yes" && o.side === "BUY");

/** The days, as [when, what changes just before the turn]. Everything a step does it does to the one world it is given. */
const STEPS: Array<[number, ((w: World) => void)?]> = [
  // Day 1, a dry-run: the selection, the quotes, then a minute at a time.
  [T0],
  ...Array.from({ length: 30 }, (_, k): [number, ((w: World) => void)?] => {
    const t = T0 + (k + 1) * M;
    const acts: Record<number, (w: World) => void> = {
      2: (w) => { w.A.bid = 0.46; },                                            // a re-price
      4: (w) => { w.C.bid = 0.30; },                                            // C's bid gone for a minute: our resting
      5: (w) => { w.C.bid = 0.50; },                                            // quotes set the venue's midpoint (2026-10-04)
      6: (w) => { w.B.bid = 0; },                                               // B's book one-sided
      8: (w) => { w.B.bid = 0.20; },
      9: (w) => { w.pm.down.geoblock = true; },                                 // answered from memory, then closed
      12: (w) => w.setPause(true),
      14: (w) => w.setPause(false),
      16: (w) => { w.pm.down.collateral = true; },
      17: (w) => { w.pm.down.collateral = false; },
      21: (w) => { w.pm.down.geoblock = false; },
      25: (w) => { w.A.resolved = true; },                                       // A leaves the book
    };
    return [t, acts[k + 1]];
  }),
  // A stretch the loop missed: the dry-run's orders expire.
  [T0 + 45 * M], [T0 + 46 * M],
  // Day 2: its own selection, the readout, then live.
  [at("2026-10-03T00:00:30Z")], [at("2026-10-03T00:01:30Z")], [at("2026-10-03T00:02:30Z")],
  [at("2026-10-03T01:00:30Z")],
  [at("2026-10-03T01:05:30Z"), (w) => w.setConfig({ dry_run: false, live_confirmed_at: "2026-10-03T01:05:00.000Z", loss_day_usd: 0.5 })],
  [at("2026-10-03T01:06:30Z"), (w) => { const o = yesBid(w, w.B.cond); if (o) w.pm.settle(w.pm.fill(String(o.hash), 20), "CONFIRMED"); }],
  [at("2026-10-03T01:07:30Z"), (w) => { w.C.bid = 0.49; w.pm.postMode = "lose-reply"; }],
  [at("2026-10-03T01:08:30Z"), (w) => { w.pm.postMode = "ok"; }],
  [at("2026-10-03T01:09:30Z"), (w) => { w.C.bid = 0.50; w.pm.restart = true; }],
  [at("2026-10-03T01:10:30Z"), (w) => { w.pm.restart = false; }],
  [at("2026-10-03T01:11:30Z"), (w) => { w.C.bid = 0.49; w.pm.cancelLagReads = 5; }],
  [at("2026-10-03T01:12:30Z"), (w) => { w.pm.cancelLagReads = 1; }],
  [at("2026-10-03T01:13:30Z"), (w) => { w.C.bid = 0.50; w.pm.cancelMode = "lost"; }],
  [at("2026-10-03T01:14:30Z")],
  [at("2026-10-03T01:15:30Z"), (w) => { w.pm.cancelMode = "ok"; w.setPause(true); }],
  [at("2026-10-03T01:16:30Z"), (w) => w.setPause(false)],
  [at("2026-10-03T01:17:30Z"), (w) => { w.B.bid = 0.10; w.B.ask = 0.13; }],     // B's 20 YES fall: the day's loss stop
  [at("2026-10-03T01:18:30Z")],
  // Day 3: a new selection, the readout of day 2 with what the venue paid, and B held and settled.
  [at("2026-10-04T00:01:30Z"), (w) => {
    w.pm.earnings["2026-10-03"] = { native: [{ cond: w.B.cond, usd: 0.37 }], sponsored: [{ cond: w.C.cond, usd: 0.05 }] };
    w.pm.rebatesByDay["2026-10-03"] = [{ cond: w.B.cond, usdc: "0.002" }];
  }],
  [at("2026-10-04T01:00:30Z")],
  [at("2026-10-04T06:00:30Z"), (w) => { Object.assign(w.B, { resolved: true, payout: 0, closedTime: "2026-10-04 05:58:00+00" }); }],
  [at("2026-10-04T06:01:30Z")], [at("2026-10-04T06:02:30Z")],
];

/**
 * What the measurement fix of 2026-10-04 changes (Addendum 6 of the live-prep pre-registration), and nothing else: the
 * formula of a minute scores the quotes against the venue's book with them in it, so its figures (`ours`, `others`,
 * `formula_usd`, the midpoint and the per-side scores in `detail`, which also gains `mRw` and `after`), the readout's
 * sums of them and its count of the minutes we scored in (`minutes_two_sided`), the state's copy of the minutes, and
 * the paper layer's reward of a matched minute (its minutes' `reward` and `detail`, its days' `reward`, `reward_r40` and
 * `pnl_day_r40`, its accounts' and day's running reward). Every other field of every table, every request, every body
 * and every other field of every report must be the frozen code's.
 */
function masked(tables: Record<string, Row[]>): Record<string, Row[]> {
  const t = structuredClone(tables) as Record<string, Row[]>;
  for (const r of t.pm_live_minutes ?? []) { delete r.ours; delete r.others; delete r.formula_usd; delete r.detail; }
  for (const r of t.pm_live_reward_days ?? []) { delete r.formula_usd; delete r.formula_scored_usd; delete r.minutes_two_sided; }
  for (const e of t.pm_live_events ?? []) {
    if (e.kind === "readout") for (const d of ((e.detail as { days?: Row[] })?.days ?? [])) { delete d.formula; delete d.formulaScored; }
  }
  for (const r of t.pm_live_state ?? []) {
    for (const m of ((r.state as { minutes?: Row[] })?.minutes ?? [])) { delete m.formula; delete m.ours; delete m.others; }
  }
  for (const r of t.pm_prep_minutes ?? []) { delete r.reward; delete r.detail; }
  for (const r of t.pm_prep_days ?? []) { delete r.reward; delete r.reward_r40; delete r.pnl_day_r40; }
  for (const r of t.pm_prep_state ?? []) {
    const st = r.state as PrepStateShape;
    if (st?.acc) for (const a of Object.values(st.acc)) delete (a as Row).reward;
    if (st?.day) delete (st.day as Row).reward;
  }
  return t;
}
type PrepStateShape = { acc?: Record<string, unknown>; day?: Record<string, unknown> };
// deno-lint-ignore no-explicit-any
function maskedReport(r: any): unknown {
  const x = structuredClone(r);
  for (const m of x.live?.minutes ?? []) { delete m.formula; delete m.ours; delete m.others; }
  for (const d of x.live?.readout ?? []) delete d.formula;
  if (x.prep) delete x.prep.reward;
  return x;
}

Deno.test("the default instance on the frozen day stop is the pre-registered path and layer but for the formula of 2026-10-04: every table, request and report the same, turn by turn, but the fields that formula makes", async () => {
  const frozen = world(Frozen.runPmLive, FrozenPrep.runPmPrep);
  const today = world(Path.runPmLive, Prep.runPmPrep, ON_COST);
  const bare = world(Path.runPmLive, Prep.runPmPrep);                          // the default as deployed, left out
  const named = world(Path.runPmLive, Prep.runPmPrep, NAMED);                   // the default named, not left out
  const states = new Set<string>();                                             // every order state seen after a turn
  for (const [t, act] of STEPS) {
    for (const w of [frozen, today, bare, named]) act?.(w);
    const a = await frozen.turn(t), b = await today.turn(t), c = await named.turn(t), e = await bare.turn(t);
    const label = iso(t);
    assertEquals(JSON.stringify(maskedReport(b)), JSON.stringify(maskedReport(a)), `reports at ${label}`);
    assertEquals(JSON.stringify(c), JSON.stringify(e), `reports at ${label} (named)`);
    assertEquals(JSON.stringify(masked(today.mem.tables as Record<string, Row[]>)), JSON.stringify(masked(frozen.mem.tables as Record<string, Row[]>)), `tables after ${label}`);
    assertEquals(JSON.stringify(named.mem.tables), JSON.stringify(bare.mem.tables), `tables after ${label} (named)`);
    assertEquals(today.pm.urls, frozen.pm.urls, `requests by ${label}`);
    assertEquals(named.pm.urls, bare.pm.urls, `requests by ${label} (named)`);
    assertEquals(today.pm.bodies, frozen.pm.bodies, `bodies by ${label}`);
    assertEquals(named.pm.bodies, bare.pm.bodies, `bodies by ${label} (named)`);
    for (const o of today.mem.tables.pm_live_orders as Row[]) states.add(`${o.mode}:${o.state}`);
  }
  // What the days went through, read from the record: an equality over a world that did nothing would prove nothing.
  const T = today.mem.tables as Record<string, Row[]>, F = frozen.mem.tables as Record<string, Row[]>;
  const kinds = new Set(T.pm_live_events.map((e) => `${e.mode}:${e.kind}`));
  for (const k of ["dry_run:selection", "dry_run:gates", "dry_run:condition", "dry_run:readout", "live:selection", "live:gates", "live:loss_stop_day", "live:readout"]) assert(kinds.has(k), k);
  for (const s of ["dry_run:live", "dry_run:cancelled", "dry_run:expired", "live:pending", "live:live", "live:cancelled", "live:filled", "live:rejected"]) {
    assert(states.has(s), `${s} in ${[...states]}`);
  }
  assert(T.pm_live_fills.some((f) => f.status === "CONFIRMED"), "a CONFIRMED fill");
  assert(T.pm_live_settlements.length >= 1, "a settlement");
  assert(T.pm_live_reward_days.some((r) => r.mode === "live" && Number(r.actual_usd) > 0), "a live readout with earnings");
  assert(T.pm_live_markets.length >= 6 && new Set(T.pm_live_markets.map((m) => m.day)).size === 3, "three days' selections");
  assert(T.pm_prep_fills.length >= 10 && T.pm_prep_days.length >= 1, `paper fills ${T.pm_prep_fills.length}, days ${T.pm_prep_days.length}`);
  assert(T.pm_prep_minutes.some((m) => m.class === "matched") && T.pm_prep_minutes.some((m) => m.class === "dark"), "matched and dark minutes");
  assert(today.pm.calls.some((c) => c.startsWith("POST clob.polymarket.com/order")) && today.pm.calls.some((c) => c.startsWith("DELETE clob.polymarket.com/cancel-all")), "live writes");

  // What the formula changed, minute by minute: RW's midpoint is the frozen code's own; where the venue's (with our quotes
  // in its book) is the same, every figure is the frozen one; where our resting quotes moved it, the figures are the
  // venue's. Both happen in these days, dry-run and live.
  const key = (r: Row) => `${r.mode}|${r.minute}|${r.cond}`;
  const old = new Map(F.pm_live_minutes.map((r) => [key(r), r]));
  const moved = { dry_run: 0, live: 0 }, same = { dry_run: 0, live: 0 };
  for (const r of T.pm_live_minutes) {
    const o = old.get(key(r))!, d = r.detail as Record<string, any>, od = o.detail as Record<string, any>;
    assertEquals(d.mRw, od.m, key(r));
    assertEquals(d.orders, od.orders, key(r));
    if (d.m === od.m || (d.m !== null && od.m !== null && Math.abs(d.m - od.m) < 1e-12)) {
      same[r.mode as "dry_run" | "live"]++;
      for (const f of ["ours", "others", "formula_usd"]) assertAlmostEquals(Number(r[f]), Number(o[f]), 1e-12, `${key(r)} ${f}`);
    } else moved[r.mode as "dry_run" | "live"]++;
    assert(d.after && typeof d.after.formula === "number" && d.after.formula >= 0, `${key(r)} after`);
  }
  assert(same.dry_run > 20 && same.live > 5 && moved.dry_run >= 1, JSON.stringify({ same, moved }));
  // The readout's counts and sums are of today's own minutes, as they were of the frozen code's.
  for (const d of T.pm_live_reward_days) {
    const mins = T.pm_live_minutes.filter((m) => m.mode === d.mode && m.cond === d.cond && String(m.minute).slice(0, 10) === d.day);
    if (!mins.length) continue;
    assertEquals(d.minutes_two_sided, mins.filter((m) => Number(m.ours) > 0).length, `${d.day} ${d.cond}`);
    assertAlmostEquals(Number(d.formula_usd), Math.round(mins.reduce((s, m) => s + Number(m.formula_usd), 0) * 1e6) / 1e6, 1e-6);
  }
  // The paper layer: a matched minute is paid the path's own figure of the quotes it rested (`after`), and keeps RW's
  // line beside it, which is what the frozen layer paid; its days' columns follow from its minutes as before.
  const after = new Map(T.pm_live_minutes.filter((r) => r.mode === "dry_run").map((r) => [`${r.minute}|${r.cond}`, (r.detail as Record<string, any>).after.formula]));
  const oldPrep = new Map(F.pm_prep_minutes.map((r) => [`${r.minute}|${r.cond}`, r]));
  let venuePaid = 0, differs = 0;
  for (const r of T.pm_prep_minutes.filter((x) => x.class === "matched")) {
    const d = r.detail as Record<string, any>, o = oldPrep.get(`${r.minute}|${r.cond}`)!;
    assertAlmostEquals(d.rw, Number(o.reward), 1e-12, `${r.minute} RW's line is the frozen layer's reward`);
    // Paid the path's figure when the paper quoted both sides; a side its own inventory stopped earns nothing, as RW's line.
    if (d.paid === "venue") { venuePaid++; assertAlmostEquals(Number(r.reward), r.qb && r.qa ? after.get(`${r.minute}|${r.cond}`) : 0, 1e-12, `${r.minute} paid the path's figure`); }
    if (Math.abs(Number(r.reward) - Number(o.reward)) > 1e-12) differs++;
  }
  assert(venuePaid > 10, `${venuePaid} matched minutes paid the path's figure`);
  for (const d of T.pm_prep_days) {
    assertAlmostEquals(Number(d.reward_r40), Math.round(Number(d.reward) * 0.4 * 1e6) / 1e6, 1e-6);
    assertAlmostEquals(Number(d.pnl_day_r40), Math.round((Number(d.fills_pnl_day) + Number(d.reward_r40)) * 1e6) / 1e6, 2e-6);
  }
  console.log(JSON.stringify({ minutesSame: same, minutesMoved: moved, prepMatchedPaidVenue: venuePaid, prepRewardDiffers: differs }));
});

Deno.test("the frozen layer's book-keeping, taken from today's pm_live.ts, is the frozen path's own, text for text", () => {
  // pm_prep_frozen.ts's one import of pm_live.ts: these, and types.
  for (const name of ["bookPnl", "closeOnly", "effectiveLimits", "inYesBook", "onTick", "settlementFills", "tokenBooks"] as const) {
    assertEquals(String(Path[name]), String(Frozen[name]), name);
  }
});

Deno.test("every export of the frozen code is today's, text for text and value for value, but the ones the instance build took", () => {
  const check = (frozen: Record<string, unknown>, now: Record<string, unknown>, changed: string[]) => {
    for (const [k, v] of Object.entries(frozen)) {
      assert(k in now, `${k} is still exported`);
      if (typeof v === "function") {
        if (changed.includes(k)) assert(String(now[k]) !== String(v), `${k} is one the build changed`);
        else assertEquals(String(now[k]), String(v), k);
      } else assertEquals(now[k], v, k);
    }
  };
  // The path: the universe and the candidate take the instance's band, the selection its band and exclusion, the turn its
  // tables, lease and migrations; and (2026-10-04) the formula scores against the venue's book with our quotes in it, the
  // turn records what rests after it, and the selection ranks by an instance's book-quality rule (the default has none).
  // And (2026-10-09, the go-live audit) `gates` lists live-prep's approval gate only when its live turn gives one (F1), and
  // `bookNow` refuses a book that names a protocol (F4, a Polymarket Protocol V2 book; no CTF book does). Neither changes
  // a dry-run decision: the minute-by-minute comparisons below run today's code beside the frozen code and find them equal.
  check(Frozen as Record<string, unknown>, Path as Record<string, unknown>, ["inUniverse", "candidateOf", "selectMarkets", "runPmLive", "minuteFormula", "gates", "bookNow"]);
  // The layer: its run takes the instance's tables and lease; and (2026-10-04) a matched minute is paid the path's figure.
  check(FrozenPrep as Record<string, unknown>, Prep as Record<string, unknown>, ["runPmPrep", "decideMinute"]);
  // The default instances are the names the code had: its tables, its lease, its band.
  assertEquals(Path.pmLiveDbTables(Path.PM_LIVE_INSTANCE), Path.PM_LIVE_DB_TABLES);
  assertEquals([Path.PM_LIVE_INSTANCE.lock, Path.PM_LIVE_INSTANCE.band, Path.PM_LIVE_INSTANCE.exclusion], ["pm-live", { floor: 6, ceiling: 10 }, undefined]);
  assertEquals([...Prep.prepDbTables(Prep.PREP_INSTANCE)].sort(), [...Prep.PREP_DB_TABLES].sort());
  // …which is the frozen layer's own list of what it may touch.
  assertEquals([...Prep.prepDbTables(Prep.PREP_INSTANCE)].sort(), [...FrozenPrep.PREP_DB_TABLES].sort());
  assertEquals([Prep.prepReads(Prep.PREP_INSTANCE), Prep.PREP_INSTANCE.lock], [[...Prep.PREP_READS], "pm-prep"]);
  // Mini-pool from Addendum 6 is the default instance and its book-quality rule, nothing else; the default has none.
  const { bookQuality, ...rest } = Path.PM_MINI_INSTANCE;
  assertEquals(rest, Path.PM_LIVE_INSTANCE);
  assertEquals([bookQuality, Path.PM_LIVE_INSTANCE.bookQuality], [Path.PM_MINI_QUALITY, undefined]);
});

/**
 * What the day stop of 2026-10-07 adds to the record and nothing else: the path's state keeps its opening marks and its
 * last marks (`dayOpen`, `marks`, `marksAt`), the layer's state its opening marks (`open`) and its day figure, a stop's
 * event the figure on cost beside its own and when its day began (`since`, `onCost`), and a closed paper day the stop's
 * figure (`detail.dayChange`).
 */
function stripDayStop(tables: Record<string, unknown>): Record<string, Row[]> {
  const t = structuredClone(tables) as Record<string, Row[]>;
  for (const r of t.pm_live_state ?? []) { const s = r.state as Row; delete s.dayOpen; delete s.marks; delete s.marksAt; }
  for (const r of t.pm_prep_state ?? []) { const s = r.state as Row; delete s.open; if (s.pnl) delete (s.pnl as Row).day; }
  for (const e of [...(t.pm_live_events ?? []), ...(t.pm_prep_events ?? [])]) if (String(e.kind) === "loss_stop_day") { const d = e.detail as Row; delete d.since; delete d.onCost; delete d.dayPnl; }
  for (const r of t.pm_prep_days ?? []) delete (r.detail as Row).dayChange;
  return t;
}

/**
 * The day stop counts only the day's change since 2026-10-07 (Davies: "只算当天变化"). By hand, on these days: live on
 * 10-03, B's YES bid fills 20 at 0.201 (01:06) and B falls to 0.10 / 0.13 (01:17): 20 × (0.115 − 0.201) = −1.72, past the
 * day's −0.50 on either rule (bought that day). The 20 are carried into 10-04 at 0.115, the mark the day began at. On the
 * frozen rule the whole −1.72 counts again on 10-04, and the stop trips at its first turn (00:01); counted from 00:00 the
 * day is 0, and the path opens. B resolves NO at 06:00: 20 × (0 − 0.115) = −2.30 today, which trips it then; −4.02 in all.
 */
Deno.test("the day stop of 2026-10-07 is the one change from the frozen rule: the same record until a holding is carried across 00:00, then the carried loss no longer trips the next day's stop, and the day's own loss does", async () => {
  const prod = world(Path.runPmLive, Prep.runPmPrep), cost = world(Path.runPmLive, Prep.runPmPrep, ON_COST);
  const DIVERGE = at("2026-10-04T00:01:30Z");
  // deno-lint-ignore no-explicit-any
  const reports: Array<[number, any, any]> = [];
  for (const [t, act] of STEPS) {
    for (const w of [prod, cost]) act?.(w);
    const a = await prod.turn(t), b = await cost.turn(t);
    reports.push([t, a, b]);
    if (t >= DIVERGE) continue;
    const label = iso(t);
    assertEquals(JSON.stringify(a), JSON.stringify(b), `reports at ${label}`);
    assertEquals(JSON.stringify(stripDayStop(prod.mem.tables)), JSON.stringify(stripDayStop(cost.mem.tables)), `tables after ${label}`);
    assertEquals(prod.pm.urls, cost.pm.urls, `requests by ${label}`);
    assertEquals(prod.pm.bodies, cost.pm.bodies, `bodies by ${label}`);
  }
  const P = prod.mem.tables as Record<string, Row[]>, C = cost.mem.tables as Record<string, Row[]>;
  const stops = (T: Record<string, Row[]>) => T.pm_live_events.filter((e) => e.kind === "loss_stop_day").map((e) => [e.minute, (e.detail as Row).dayPnl]);
  // The fill the days rest on: 20 YES of B at 0.201, CONFIRMED, on 10-03.
  assertEquals(P.pm_live_fills.map((f) => [f.cond, f.side, Number(f.price), Number(f.size), f.status, String(f.match_time).slice(0, 10)]), [[cond(6), "BUY", 0.201, 20, "CONFIRMED", "2026-10-03"]]);
  // 10-03: both stop at 01:18 at −1.72. 10-04: the frozen rule stops at 00:01 on the carried −1.72; today's at 06:01 on
  // the settlement's −2.30 alone.
  assertEquals(stops(C), [["2026-10-03T01:18:00.000Z", -1.72], ["2026-10-04T00:01:00.000Z", -1.72]]);
  assertEquals(stops(P), [["2026-10-03T01:18:00.000Z", -1.72], ["2026-10-04T06:01:00.000Z", -2.3]]);
  const ev = P.pm_live_events.find((e) => e.kind === "loss_stop_day" && e.minute === "2026-10-04T06:01:00.000Z")!.detail as Row;
  assertEquals([ev.since, ev.onCost, ev.limit], ["2026-10-04T00:01:30.000Z", -4.02, -0.5]);
  const turn = (t: string) => reports.find(([x]) => x === at(t))!;
  // The first turn of 10-04: the path's day figure is 0 and it opens; the frozen rule's is −1.72 and it does not.
  const [, a0, b0] = turn("2026-10-04T00:01:30Z");
  assertEquals([a0.live.pnl, a0.live.gates.openBlockedBy], [{ day: 0, total: -1.72 }, null]);
  assertEquals([b0.live.pnl, b0.live.gates.openBlockedBy], [{ day: -1.72, total: -1.72 }, "loss_day"]);
  const opened = (T: Record<string, Row[]>) => T.pm_live_orders.filter((o) => o.mode === "live" && o.gate === "open" && String(o.ts) >= "2026-10-04" && String(o.ts) < "2026-10-04T06").length;
  assert(opened(P) > 0 && opened(C) === 0, `orders that open on 10-04 before the settlement: ${opened(P)} and ${opened(C)}`);
  // The mark the day began at is the last one read before 00:00 (10-03 01:18, B at 0.10 / 0.13), kept in the state.
  const open = (P.pm_live_state[0].state as Row).dayOpen as { day: string; at: string; marks: Record<string, number> };
  assertEquals([open.day, open.at], ["2026-10-04", "2026-10-04T00:01:30.000Z"]);
  assertAlmostEquals(open.marks[tok(6, "yes")], 0.115, 1e-12);
  assertAlmostEquals(open.marks[tok(6, "no")], 0.885, 1e-12);
  // After the settlement both read −4.02 in all; the day reads −2.30 today, −4.02 on cost.
  const [, a1, b1] = turn("2026-10-04T06:01:30Z");
  assertEquals([a1.live.pnl, b1.live.pnl], [{ day: -2.3, total: -4.02 }, { day: -4.02, total: -4.02 }]);
  // The paper layer: the same day stop minute on both rules (its inventory from 10-02 was marked above its cost as 10-03
  // began, so counted from 00:00 the day is worse, not better), and the figure on cost it keeps is the frozen rule's own.
  const pStop = P.pm_prep_events.filter((e) => e.kind === "loss_stop_day"), cStop = C.pm_prep_events.filter((e) => e.kind === "loss_stop_day");
  assertEquals([pStop.map((e) => e.minute), cStop.map((e) => e.minute)], [["2026-10-03T13:17:00.000Z"], ["2026-10-03T13:17:00.000Z"]]);
  assertEquals((pStop[0].detail as Row).onCost, (cStop[0].detail as Row).dayPnl);
  assertEquals((pStop[0].detail as Row).since, "2026-10-03T00:00:00.000Z");
});
