// "Reward quotes mid-pool" (pm_mid.ts, 0081, 0084): the order path and its paper layer on mid-pool's instance, against
// the in-memory database held to 0081's and 0084's rules (a band of [$10, $50); since 0084 a config that may be live and
// armed, orders of either mode, and never both configs armed) and the fake Polymarket that answers the path, RW's public
// reads and the paper layer alike.
//
// What is pinned: the instance's names, band and switches; RW's selection recomputed from public data is RW's own
// selection (`runPmrwSelect`, run on the same fake) on 60 random worlds and on the hand-worked one; the exclusion's margin
// at its boundary, RW's Gamma loop carried into it, and only a count of it recorded (no excluded market's id anywhere in
// mid-pool's tables); mid-pool's picks inside its band and outside RW's top, in every random world; a selection without
// the exclusion is never made (a failed public read fails the day's try); its candidates' books read in one batch; its
// readout reads nothing of the account's payouts; it touches only its own tables (never small-pool's, RW's or RW-C's);
// and, since 0084, its action is mini-pool's: the key loaded only for the stored signer, the pUSD read every minute, the
// same keyed wire, its config row the lock (as deployed, a day sends nothing but GETs; armed, it sends; its kill switches
// reach the venue), and the double refuses arming it while mini-pool is armed, and the other way round.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { leftOut, PM_MID_BAND, PM_MID_EXCLUSION_MARGIN, PM_MID_INSTANCE, PREP_MID_INSTANCE, rwSelectionNow, type RwScored } from "./pm_mid.ts";
import { pmLiveDbTables, PM_LIVE_SELECT_UNTIL_MS, rewardListing, runPmLive } from "./pm_live.ts";
import { prepDbTables, prepReads, runPmPrep } from "./pm_prep.ts";
import { runPmrwSelect, RW_BUDGET_USD, RW_MIN_RATE } from "./pmrw.ts";
import { runPmMidAction } from "./index.ts";
import { PM_ORDER_SENDS_ENABLED, PmOrderKey } from "../_shared/polymarket_orders.ts";
import { FakePolymarket, memDb, onlyTables, PM_TEST_FUNDER, PM_TEST_KEY, PM_TEST_OWNER, PM_TEST_SIGNER, type Row } from "./testing.ts";

const M = 60e3;
const iso = (ms: number) => new Date(ms).toISOString();
const cond = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const tok = (n: number, outcome: "yes" | "no") => `${8000000000000000000000000000000000000000000000000000000000000000000n + BigInt(n * 2 + (outcome === "no" ? 1 : 0))}`;
const T0 = Date.parse("2026-10-02T10:00:30Z");
const MID_CONFIG = {
  id: 1, dry_run: true, live_confirmed_at: null, ireland_attested_at: "2026-10-01T04:00:00.000Z", ireland_until: null,
  cap_total_usd: 320, cap_market_usd: 60, loss_day_usd: 25, loss_total_usd: 75, max_posts_day: 6000, gtd_lifetime_s: 600, max_markets: 8, select_budget_usd: 160,
  created_at: "2026-10-02T03:00:00.000Z", updated_at: "2026-10-02T03:00:00.000Z",
};
/** Mini-pool's row beside it, as `0080` leaves it: the same sizes, no `created_at`. */
const MINI_CONFIG = (({ created_at: _c, ...rest }) => rest)(MID_CONFIG);
const MID_TABLES = Object.values(PM_MID_INSTANCE.tables), PREP_TABLES = Object.values(PREP_MID_INSTANCE.tables);

/**
 * The hand-worked world. Every market has the same book (0.45 / 0.47, 20 shares at each touch, minimum 20, max spread
 * 4.5 ¢), so RW's quote joins the touch (N 20, capital 20 × (0.45 + 1 − 0.47) = $19.60) and takes half of each pool:
 * a market's first-round reward per dollar is its rate × 0.5 / 1440 / 19.60, in the order of its rate. RW's $300 takes the
 * fifteen best (15 × 19.60 = 294): thirteen at $100 a day, one at $50 (RW's, not mid-pool's: its ceiling is under $50)
 * and M1 at $40 — the last it takes. 0.33 (1 − the margin, 0.67) of M1's score is a rate of $13.20, so the margin leaves
 * out M2 ($33) and M20 ($13.20, exactly at the bar), with M1; mid-pool takes M3 ($13.19, just under it), M4 ($12) and M5
 * ($10, its floor). Out of its band: $9.99, $50; out of its universe: M6 at $30 with a minimum of 25 (N over 20) and M7
 * at $30 with no spread to score.
 */
function world(o: { gammaRefuses?: number; config?: Record<string, unknown>; key?: boolean; liveConfig?: Record<string, unknown> } = {}) {
  const clock = { now: T0 };
  const pm = new FakePolymarket(() => clock.now);
  const add = (n: number, rate: number, extra: Record<string, unknown> = {}) =>
    pm.addMarket({ cond: cond(n), yes: tok(n, "yes"), no: tok(n, "no"), rate, sponsoredRate: null, minSize: 20, depth: [[0, 20]], ...extra });
  for (let k = 1; k <= 13; k++) add(100 + k, 100, { accepting: o.gammaRefuses !== 100 + k });
  const R50 = add(150, 50), M1 = add(201, 40), M2 = add(202, 33), M20 = add(220, 13.2), M3 = add(203, 13.19), M4 = add(204, 12), M5 = add(205, 10);
  const S9 = add(209, 9.99), M6 = add(206, 30, { minSize: 25, depth: [[0, 25]] }), M7 = add(207, 30, { maxSpread: 0 });
  const mem = memDb({
    agent_locks: [{ name: "pm-mid", lease_until: iso(0), holder: null }, { name: "pm-midprep", lease_until: iso(0), holder: null }, { name: "pmrw-select", lease_until: iso(0), holder: null }],
    agent_risk: [{ id: 1, global_pause: false }],
    pm_mid_config: [{ ...MID_CONFIG, ...o.config }],
    ...Object.fromEntries([...MID_TABLES.filter((t) => t !== "pm_mid_config"), ...PREP_TABLES].map((t) => [t, []])),
    // Small-pool's, RW's and RW-C's tables beside them, as in production, each with a row: mid-pool must never touch them.
    pm_live_config: [{ ...MINI_CONFIG, ...o.liveConfig }], pm_live_markets: [{ day: "2026-10-02", cond: cond(1) }], pm_prep_state: [{ id: 1 }],
    pm_rw_selection: [], pm_rwc_selection: [{ day: "2026-10-02", cond: cond(201) }], pm_rw_minutes: [{ cond: cond(201), minute: iso(T0) }],
  }, { now: () => clock.now });
  const db = onlyTables(mem.db, pmLiveDbTables(PM_MID_INSTANCE), { lease: "pm-mid", readOnly: ["agent_risk"] });
  const prepDb = onlyTables(mem.db, prepDbTables(PREP_MID_INSTANCE), { lease: "pm-midprep", readOnly: prepReads(PREP_MID_INSTANCE) });
  let salt = 1;
  // The stored signer's key, as the action loads it since 0084 (`o.key` false: none, as before 0084).
  const key = o.key === false ? null : new PmOrderKey(PM_TEST_KEY);
  const w = {
    clock, pm, mem, db, R50, M1, M2, M20, M3, M4, M5, S9, M6, M7,
    async turn(at = clock.now, inst = PM_MID_INSTANCE) {
      clock.now = at;
      return await runPmLive({
        db, now: at, holder: `h${at}`, venue: pm.venue(), sbRegion: "eu-west-1", sendsEnabled: true, account: { maker: PM_TEST_FUNDER, signer: PM_TEST_SIGNER },
        signer: key, signerProblem: key ? null : "POLYMARKET_PRIVATE_KEY missing: no order can be signed", salt: () => String(salt++), pause: () => Promise.resolve(),
        clock: () => clock.now, inst, pm: { fetchImpl: pm.publicFetch },
      });
    },
    state: () => (mem.tables.pm_mid_state as Row[])[0]?.state as Record<string, any>,
    setConfig(p: Record<string, unknown>) { Object.assign((mem.tables.pm_mid_config as Row[])[0], p); },
    open: (mode?: string) => (mem.tables.pm_mid_orders as Row[]).filter((r) => (r.state === "pending" || r.state === "live") && (!mode || r.mode === mode)),
    /** Everything sent to the venue but its GETs and the exclusion's keyless batch read of the books. */
    writes: () => pm.calls.filter((c) => !c.startsWith("GET ") && c !== "POST clob.polymarket.com/books"),
    markets: () => mem.tables.pm_mid_markets as Row[],
    picks: (day = "2026-10-02") => (mem.tables.pm_mid_markets as Row[]).filter((m) => m.day === day).map((m) => String(m.cond)),
    /** RW's own selection, by RW's own code, on the same fake: into its table here, read back. */
    async rwOwn(at = clock.now) {
      const rw = memDb({ agent_locks: [{ name: "pmrw-select", lease_until: iso(0), holder: null }], pm_rw_selection: [] }, { now: () => at });
      const r = await runPmrwSelect({ db: rw.db, now: at, holder: "rw", pm: { fetchImpl: pm.publicFetch } });
      assertEquals(r.errors, []);
      return (rw.tables.pm_rw_selection as Row[]).map((s) => String(s.cond)).sort();
    },
  };
  return w;
}
const dl = (now: number) => ({ clock: () => now, until: now + PM_LIVE_SELECT_UNTIL_MS });

// ------------------------------------------------------------------ the instance

Deno.test("the instance: mid-pool's own tables, leases and band; RW's exclusion and a batch book read; no payouts read; and the paper layer on its tables", () => {
  assert(MID_TABLES.every((t) => t.startsWith("pm_mid_")) && MID_TABLES.length === 9, MID_TABLES.join());
  assert(PREP_TABLES.every((t) => t.startsWith("pm_midprep_")) && PREP_TABLES.length === 7, PREP_TABLES.join());
  assertEquals([PM_MID_INSTANCE.lock, PREP_MID_INSTANCE.lock, PM_MID_INSTANCE.band, PM_MID_BAND.floor], ["pm-mid", "pm-midprep", { floor: 10, ceiling: 50 }, RW_MIN_RATE]);
  assertEquals([PM_MID_INSTANCE.readsPayouts, typeof PM_MID_INSTANCE.exclusion, typeof PM_MID_INSTANCE.bookBatch], [false, "function", "function"]);
  assertEquals(prepReads(PREP_MID_INSTANCE), ["pm_mid_config", "pm_mid_markets", "pm_mid_minutes", "pm_mid_orders"]);
  assertEquals([PM_MID_INSTANCE.action, PM_MID_INSTANCE.path, PM_MID_INSTANCE.errorKind], ["pmmid", "agents?action=pmmid&forceFunctionRegion=eu-west-1", "agents.pm_mid"]);
  // Nothing of small-pool's, RW's or RW-C's among what either may touch.
  for (const t of [...pmLiveDbTables(PM_MID_INSTANCE), ...prepDbTables(PREP_MID_INSTANCE)]) assert(!/^pm_(live|prep|rw|rwc)_/.test(t), t);
  assertEquals(PM_MID_EXCLUSION_MARGIN, 0.67);
});

// ------------------------------------------------------------------ RW's selection, recomputed

Deno.test("RW's selection recomputed from public data is RW's own selection, by RW's own code on the same reads: the hand-worked world", async () => {
  const w = world();
  const l = await rewardListing(w.pm.venue());
  const r = await rwSelectionNow(l.rows, { dl: dl(T0), nowMs: T0, pm: { fetchImpl: w.pm.publicFetch } });
  if ("error" in r) throw new Error(r.error);
  const taken = r.taken.map((x) => x.cond).sort();
  assertEquals(taken, await w.rwOwn(T0));
  assertEquals(taken.length, 15);
  assert(taken.includes(w.M1.cond) && taken.includes(w.R50.cond) && !taken.includes(w.M2.cond));
  // RW's universe is $10 and over with a spread: the $9.99 market is not in it; the $10 one is.
  assertEquals([r.universe, r.scored.some((x) => x.cond === w.S9.cond), r.scored.some((x) => x.cond === w.M5.cond)], [21, false, true]);
});

Deno.test("RW's selection recomputed is RW's own, on 60 random worlds: rates, books, minimum sizes, spreads, refusals and markets the short list lacks", async () => {
  let seed = 20261002;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let compared = 0, nonEmpty = 0;
  for (let k = 0; k < 60; k++) {
    const clock = { now: T0 };
    const pm = new FakePolymarket(() => clock.now);
    pm.simplifiedPageSize = 1 + Math.floor(rnd() * 5);
    pm.rewardsPageSize = 2 + Math.floor(rnd() * 6);
    const n = 5 + Math.floor(rnd() * 25);
    for (let i = 0; i < n; i++) {
      const bid = Math.round((0.05 + rnd() * 0.85) * 100) / 100, wide = Math.floor(rnd() * 4) + 1;
      const minSize = [5, 20, 20, 50, 100][Math.floor(rnd() * 5)];
      pm.addMarket({
        cond: cond(1000 + i), yes: tok(1000 + i, "yes"), no: tok(1000 + i, "no"), bid, ask: Math.round((bid + wide * 0.01) * 100) / 100,
        rate: Math.round(rnd() * 12000) / 100, sponsoredRate: rnd() < 0.2 ? Math.round(rnd() * 8000) / 100 : null, minSize,
        depth: [[0, minSize * (1 + Math.floor(rnd() * 3))], [1, 50 * Math.floor(rnd() * 4)]], maxSpread: rnd() < 0.1 ? 0 : [3, 4.5, 6][Math.floor(rnd() * 3)],
        accepting: rnd() > 0.15,
      });
    }
    const l = await rewardListing(pm.venue());
    const r = await rwSelectionNow(l.rows, { dl: dl(T0), nowMs: T0, pm: { fetchImpl: pm.publicFetch } });
    if ("error" in r) throw new Error(r.error);
    const rw = memDb({ agent_locks: [{ name: "pmrw-select", lease_until: iso(0), holder: null }], pm_rw_selection: [] }, { now: () => T0 });
    const own = await runPmrwSelect({ db: rw.db, now: T0, holder: "rw", pm: { fetchImpl: pm.publicFetch } });
    const ownPicks = (rw.tables.pm_rw_selection as Row[]).map((s) => String(s.cond)).sort();
    assertEquals(r.taken.map((x) => x.cond).sort(), ownPicks, `world ${k}: ${own.errors.join(" | ")}`);
    // RW's budget, whole markets.
    assert(r.taken.reduce((s, x) => s + x.cap, 0) <= RW_BUDGET_USD + 1e-9);
    compared++;
    if (ownPicks.length) nonEmpty++;
  }
  assertEquals(compared, 60);
  assert(nonEmpty >= 50, `${nonEmpty} worlds where RW took something`);
});

Deno.test("leftOut: every market scoring at least (1 − margin) of RW's last pick, its picks among them; at the bar left out, just under it kept; nothing taken, nothing left out", () => {
  const s = (cond: string, perDollar: number): RwScored => ({ cond, perDollar, cap: 10 });
  const scored = [s("a", 4), s("b", 2), s("c", 1.5), s("d", 1), s("e", 0.9999999), s("f", 0.2)];
  const taken = [scored[0], scored[1]];                                              // RW's last pick scores 2
  assertEquals([...leftOut({ scored, taken }, 0.5)].sort(), ["a", "b", "c", "d"]);     // at 0.5 the bar is 1: d at it, e under
  assertEquals([...leftOut({ scored, taken }, 0)].sort(), ["a", "b"]);                 // no margin: RW's picks and what scores above the last
  assertEquals([...leftOut({ scored, taken }, 0.95)].sort(), ["a", "b", "c", "d", "e", "f"]);
  assertEquals(leftOut({ scored, taken: [] }).size, 0);
  // Mid-pool's margin, 0.67: the bar is 0.66. At it, left out; just under it, kept.
  const at = [...scored, s("g", 0.66), s("h", 0.6599)];
  assertEquals([...leftOut({ scored: at, taken })].sort(), ["a", "b", "c", "d", "e", "g"]);
  // A market RW passed over for not fitting, above its last pick, is left out with it.
  assertEquals([...leftOut({ scored: [s("big", 5), ...scored], taken })].includes("big"), true);
});

// ------------------------------------------------------------------ mid-pool's selection

Deno.test("mid-pool's selection: its band, and nothing RW's rule takes or scores within the margin of its last pick; only a count of it recorded", async () => {
  const w = world();
  const r = await w.turn();
  assertEquals(r.errors, []);
  assertEquals([r.mode, r.why], ["dry_run", "dry-run: pm_mid_config.dry_run is on"]);
  // M3 ($13.19, under 0.33 of M1's $40), M4 ($12) and M5 ($10, the floor): by RW's ranking, in its band, outside RW's top.
  assertEquals(w.picks(), [w.M3.cond, w.M4.cond, w.M5.cond]);
  assert(w.markets().every((m) => Number(m.reward_rate) >= 10 && Number(m.reward_rate) < 50));
  const note = (w.markets()[0].detail as { note: Record<string, any> }).note;
  // Three of its universe left out (M1, RW's last pick; M2 and M20, at or above 0.33 of its score), counted, not named.
  assertEquals(note.exclusion, { rule: "RW", margin: 0.67, universe: 21, scored: 21, ms: 0, excluded: 3 });
  assertEquals([note.universe, note.eligible], [3, 3]);
  // No market the exclusion left out, and none of RW's picks, is named anywhere in mid-pool's tables.
  const all = JSON.stringify(Object.fromEntries(MID_TABLES.map((t) => [t, w.mem.tables[t]])));
  for (const c of [w.M1, w.M2, w.M20, w.R50].map((m) => m.cond)) assert(!all.includes(c), c);
  for (let k = 1; k <= 13; k++) assert(!all.includes(cond(100 + k)), cond(100 + k));
  // Its candidates' books in one batch: the selection read no candidate's book one GET at a time.
  const selectionBooks = w.pm.calls.filter((c) => c === "GET clob.polymarket.com/book").length;
  assertEquals(selectionBooks, 3, "the minute's books of its three markets only");
  assert(w.pm.calls.includes("POST clob.polymarket.com/books"));
  // RW's reads, keyless: the short list, the books, Gamma for RW's picks; and no table of RW's or RW-C's.
  assert(w.pm.calls.includes("GET clob.polymarket.com/sampling-simplified-markets"));
  assertEquals([...w.db.touched].filter((t) => !MID_TABLES.includes(t) && t !== "agent_locks" && t !== "agent_risk"), []);
});

Deno.test("the exclusion is load-bearing: without it mid-pool takes RW's last pick and the markets within its margin", async () => {
  const w = world();
  await w.turn(T0, { ...PM_MID_INSTANCE, exclusion: undefined });
  const picks = w.picks();
  for (const m of [w.M1, w.M2, w.M20]) assert(picks.includes(m.cond), `${m.cond} would be mid-pool's without the exclusion`);
});

Deno.test("RW's Gamma loop is carried into the exclusion: a top market Gamma refuses moves RW's last pick down, and the margin with it", async () => {
  // RW drops the refused market and takes M2 ($33) as its fifteenth: 0.33 of $33 is $10.89, so M3 ($13.19) and M4 ($12)
  // are left out too, and mid-pool takes M5 ($10) alone.
  const w = world({ gammaRefuses: 101 });
  const own = await w.rwOwn(T0);
  assert(own.includes(w.M2.cond) && !own.includes(cond(101)));
  await w.turn();
  assertEquals(w.picks(), [w.M5.cond]);
  assertEquals((w.markets()[0].detail as { note: Record<string, any> }).note.exclusion.excluded, 5);
});

Deno.test("mid-pool's picks are never RW's, in every random world: by RW's own selection on the same reads", async () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let picked = 0;
  for (let k = 0; k < 25; k++) {
    const w = world();
    // Add a crowd of random markets around mid-pool's band and RW's universe.
    for (let i = 0; i < 25; i++) {
      const bid = Math.round((0.1 + rnd() * 0.7) * 100) / 100;
      w.pm.addMarket({
        cond: cond(5000 + i), yes: tok(5000 + i, "yes"), no: tok(5000 + i, "no"), bid, ask: Math.round((bid + (1 + Math.floor(rnd() * 3)) * 0.01) * 100) / 100,
        rate: Math.round((5 + rnd() * 90) * 100) / 100, sponsoredRate: null, minSize: [5, 20, 20][Math.floor(rnd() * 3)], depth: [[0, 20 + Math.floor(rnd() * 60)]],
      });
    }
    const own = await w.rwOwn(T0);
    await w.turn();
    const picks = w.picks();
    picked += picks.length;
    assert(picks.every((c) => !own.includes(c)), `world ${k}: a pick of RW's own`);
    assert(w.markets().every((m) => Number(m.reward_rate) >= 10 && Number(m.reward_rate) < 50), `world ${k}: a pick outside the band`);
  }
  assert(picked >= 50, `${picked} picks in all`);
});

Deno.test("no day is chosen without the exclusion: a public read that fails fails the try, and the next is five minutes later", async () => {
  const w = world();
  w.pm.publicDown.simplified = true;
  const r = await w.turn(T0);
  assertEquals(w.markets().length, 0);
  assert(r.errors.some((e) => e.startsWith("selection: exclusion: RW's selection could not be recomputed")), r.errors.join(" | "));
  w.pm.publicDown.simplified = false;
  await w.turn(T0 + M);
  assertEquals(w.markets().length, 0, "not tried again within five minutes");
  await w.turn(T0 + 5 * M);
  assertEquals(w.picks(), [w.M3.cond, w.M4.cond, w.M5.cond]);
  // A batch book read that fails fails the try as well.
  const b = world();
  b.pm.publicDown.books = true;
  const rb = await b.turn(T0);
  assertEquals(b.markets().length, 0);
  assert(rb.errors.some((e) => e.startsWith("selection: exclusion:") || e.startsWith("selection: books (batch)")), rb.errors.join(" | "));
});

// ------------------------------------------------------------------ the dry-run, the readout, the paper layer

Deno.test("its dry-run quotes RW's rule, records every minute's formula at its band's rates, and reads nothing of what the account earns", async () => {
  const w = world();
  w.pm.earnings["2026-10-02"] = { native: [{ cond: cond(1), usd: 5 }], sponsored: [] };     // small-pool's, were it live
  w.pm.percentages = { [cond(1)]: 12.5 };
  await w.turn(T0);
  await w.turn(T0 + M);
  // No live share of a pool read, and none recorded: the account's share is another instance's.
  assert((w.mem.tables.pm_mid_minutes as Row[]).every((m) => m.pct === null));
  const orders = w.mem.tables.pm_mid_orders as Row[];
  assert(orders.length === 6 && orders.every((o) => o.mode === "dry_run"), JSON.stringify(orders.map((o) => o.mode)));
  const mins = w.mem.tables.pm_mid_minutes as Row[];
  assert(mins.length === 6 && mins.every((m) => Number(m.rate) >= 10 && Number(m.rate) < 50));
  assert(mins.filter((m) => m.minute === iso(Math.floor((T0 + M) / M) * M)).every((m) => Number(m.formula_usd) > 0));
  // The next day after 01:00: the readout of its own minutes, no read of what the account was paid.
  await w.turn(Date.parse("2026-10-03T01:00:30Z"));
  assertEquals(w.pm.calls.filter((c) => /rewards\/user|rebates\/current/.test(c)), []);
  const days = w.mem.tables.pm_mid_reward_days as Row[];
  assert(days.length === 3 && days.every((d) => d.mode === "dry_run" && d.actual_usd == null && d.cond !== cond(1)), JSON.stringify(days));
});

Deno.test("mid-pool's paper layer decides its dry-run's minutes on its own tables, reading the path's, writing only its own", async () => {
  const w = world();
  const s0 = Math.floor(T0 / 1000);
  w.pm.prints.set(w.M3.cond, Array.from({ length: 6 }, (_, k) => [s0 + k * 60 + 20, "SELL", 0, 0.40, 3] as [number, "SELL", number, number, number]));
  const prepDb = onlyTables(w.mem.db, prepDbTables(PREP_MID_INSTANCE), { lease: "pm-midprep", readOnly: prepReads(PREP_MID_INSTANCE) });
  for (let k = 0; k < 6; k++) await w.turn(T0 + k * M);
  const r = await runPmPrep({ db: prepDb, now: T0 + 6 * M + 5e3, holder: "p", inst: PREP_MID_INSTANCE, pm: { fetchImpl: w.pm.publicFetch, clock: () => T0 + 6 * M + 5e3 } });
  assertEquals(r.errors, []);
  assert(r.matched > 0 && r.fills > 0, JSON.stringify(r));
  assert((w.mem.tables.pm_midprep_fills as Row[]).length > 0 && (w.mem.tables.pm_prep_state as Row[]).length === 1);
  assertEquals([...prepDb.touched].filter((t) => !PREP_TABLES.includes(t) && !prepReads(PREP_MID_INSTANCE).includes(t) && t !== "agent_locks"), []);
});

// ------------------------------------------------------------------ the same real order path (0084), one account

/** The secrets as the action reads them: the stored signer's key and the account's L2 credentials, from eu-west-1. */
const ENV: Record<string, string> = {
  POLYMARKET_CLOB_API_KEY: PM_TEST_OWNER, POLYMARKET_CLOB_SECRET: btoa("TEST-L2-SECRET-32-BYTES-LONG-001"), POLYMARKET_CLOB_PASSPHRASE: "test-passphrase",
  POLYMARKET_SIGNER_ADDRESS: PM_TEST_SIGNER, POLYMARKET_FUNDER_ADDRESS: PM_TEST_FUNDER, POLYMARKET_SIG_TYPE: "1", SB_REGION: "eu-west-1",
  POLYMARKET_PRIVATE_KEY: PM_TEST_KEY,
};
/** One fetch for the action: the order path's client to the venue (L2 checked), the exclusion's keyless reads to the public routes. */
const actionFetch = (w: ReturnType<typeof world>): typeof fetch => (input, init) => {
  const u = new URL(String(input)), method = (init?.method ?? "GET").toUpperCase();
  return method === "POST" && u.pathname === "/books" || u.host !== "clob.polymarket.com" && u.host !== "polymarket.com" || u.pathname === "/sampling-simplified-markets"
    ? w.pm.publicFetch(input, init) : w.pm.fetch(input, init);
};
/** The runtime's region, for the wire's own check (it reads SB_REGION from the runtime, not from the action's reader). */
async function inRegion<T>(region: string, f: () => Promise<T>): Promise<T> {
  const prev = Deno.env.get("SB_REGION");
  Deno.env.set("SB_REGION", region);
  try { return await f(); } finally { if (prev === undefined) Deno.env.delete("SB_REGION"); else Deno.env.set("SB_REGION", prev); }
}
/** The go-time statement's effect on the row, as the double holds it. */
const ARMED = { dry_run: false, live_confirmed_at: iso(T0 - M) };
type Report = Awaited<ReturnType<typeof runPmLive>>;

Deno.test("0084's rules hold in the double: a config may leave dry-run and be armed, an order may be live; the band still holds; and never both configs armed", async () => {
  const refused = async (f: () => Promise<unknown>) => { try { await f(); return ""; } catch (e) { return String(e); } };
  const w = world();
  // 0081 refused these; 0084 dropped those checks (mini-pool's config never had them).
  assertEquals(await refused(() => w.mem.db.upsert("pm_mid_config", [{ ...MID_CONFIG, ...ARMED }], "id")), "");
  assertEquals(await refused(() => w.mem.db.update("pm_mid_config", "id=eq.1", { dry_run: true, live_confirmed_at: null })), "");
  await w.turn();
  const o = (w.mem.tables.pm_mid_orders as Row[])[0];
  assertEquals(await refused(() => w.mem.db.update("pm_mid_orders", `id=eq.${o.id}`, { mode: "live" })), "");
  assert((await refused(() => w.mem.db.update("pm_mid_orders", `id=eq.${o.id}`, { mode: "paper" }))).includes("pm_mid_orders_mode_check"));
  const row = { ...(w.mem.tables.pm_mid_markets as Row[])[0] };
  assert((await refused(() => w.mem.db.upsert("pm_mid_markets", [{ ...row, reward_rate: 9.99 }], "day,cond"))).includes("pm_mid_markets_reward_rate_check"));
  assert((await refused(() => w.mem.db.upsert("pm_mid_markets", [{ ...row, reward_rate: 50 }], "day,cond"))).includes("pm_mid_markets_reward_rate_check"));
  // Postgres's own words for each (PGlite 16, 0074 → 0081 applied): a mid market carries its rate, where small-pool's may not.
  assert((await refused(() => w.mem.db.upsert("pm_mid_markets", [{ ...row, reward_rate: null }], "day,cond")))
    .includes('null value in column "reward_rate" of relation "pm_mid_markets" violates not-null constraint'));
  assertEquals(await refused(() => w.mem.db.upsert("pm_mid_markets", [{ ...row, reward_rate: 10 }], "day,cond")), "");
  assertEquals(await refused(() => w.mem.db.upsert("pm_mid_markets", [{ ...row, reward_rate: 49.99 }], "day,cond")), "");
  const minute = { ...(w.mem.tables.pm_mid_minutes as Row[])[0] };
  assert((await refused(() => w.mem.db.upsert("pm_mid_minutes", [{ ...minute, rate: 50 }], "mode,minute,cond"))).includes("pm_mid_minutes_rate_check"));
  // Small-pool's tables keep their own band: a $10 minute is refused there.
  assert((await refused(() => w.mem.db.upsert("pm_live_minutes", [{ ...minute, rate: 10 }], "mode,minute,cond"))).includes("pm_live_minutes_rate_check"));
  // One account (0084's trigger, in Postgres's words as PGlite 16 gave them): with mini-pool armed, no write arms mid-pool,
  // and the other way round; unarmed writes pass, mid-pool out of dry-run but unarmed among them.
  const m = world({ liveConfig: { dry_run: false, live_confirmed_at: iso(T0 - 2 * M) } });
  const toMid = "pm_mid_config cannot be armed while pm_live_config is armed: mini-pool and mid-pool trade one Polymarket account";
  assert((await refused(() => m.mem.db.update("pm_mid_config", "id=eq.1", ARMED))).includes(toMid));
  assert((await refused(() => m.mem.db.upsert("pm_mid_config", [{ ...MID_CONFIG, ...ARMED }], "id"))).includes(toMid));
  assert((await refused(() => m.mem.db.insert("pm_mid_config", { ...MID_CONFIG, id: 1, ...ARMED }))).includes(toMid));
  assertEquals((m.mem.tables.pm_mid_config as Row[]).map((x) => x.live_confirmed_at), [null]);
  assertEquals(await refused(() => m.mem.db.update("pm_mid_config", "id=eq.1", { dry_run: false })), "");
  assertEquals(await refused(() => m.mem.db.update("pm_live_config", "id=eq.1", { max_markets: 8 })), "");
  // Mini-pool's kill switch clears its arm; then mid-pool may be armed, and mini-pool may not be armed again.
  assertEquals(await refused(() => m.mem.db.update("pm_live_config", "id=eq.1", { live_confirmed_at: null })), "");
  assertEquals(await refused(() => m.mem.db.update("pm_mid_config", "id=eq.1", ARMED)), "");
  assert((await refused(() => m.mem.db.update("pm_live_config", "id=eq.1", { live_confirmed_at: iso(T0) })))
    .includes("pm_live_config cannot be armed while pm_mid_config is armed: mini-pool and mid-pool trade one Polymarket account"));
  assertEquals((m.mem.tables.pm_live_config as Row[])[0].live_confirmed_at, null);
});

Deno.test("agents?action=pmmid is wired as pmlive is: the key loaded only for the stored signer, the pUSD read every minute, the same keyed wire; armed, it sends", async () => {
  assertEquals(PM_ORDER_SENDS_ENABLED, true);
  // As deployed: dry_run on, unarmed.
  const w = world();
  const asked: string[] = [];
  const read = (n: string) => { asked.push(n); return ENV[n]; };
  const r = await runPmMidAction({ db: w.db, fetchImpl: actionFetch(w), read, now: T0 }) as Report;
  assert(asked.includes("POLYMARKET_PRIVATE_KEY"), asked.join());
  assertEquals([r.mode, r.sbRegion, r.errors], ["dry_run", "eu-west-1", []]);
  assert(r.why.includes("pm_mid_config.dry_run is on"), r.why);
  assertEquals(w.writes(), []);
  assert((w.mem.tables.pm_mid_orders as Row[]).length === 6 && (w.mem.tables.pm_mid_orders as Row[]).every((o) => o.mode === "dry_run"));
  assert(!w.pm.calls.some((c) => c.endsWith("(401)")), "every account read carried the key's L2 headers");
  // Its state carries what the go-time statement reads: the key loaded for the stored signer, the pUSD, where and when.
  const st = w.state();
  assertEquals([st.keyed, st.signerProblem, st.pusd, st.sbRegion, st.dryRun, st.armed, st.at], [true, null, 1000, "eu-west-1", true, false, iso(T0)]);
  const out = JSON.stringify(r) + JSON.stringify(w.mem.tables);
  for (const s of ["test-passphrase", ENV.POLYMARKET_CLOB_SECRET, PM_TEST_KEY.slice(2, 22), PM_TEST_KEY.slice(30, 50).toUpperCase()]) assert(!out.includes(s), s);
  // Armed (the go-time statement's effect): the same action, through the same client, sends its orders from eu-west-1.
  const L = world({ config: ARMED });
  const rl = await inRegion("eu-west-1", () => runPmMidAction({ db: L.db, fetchImpl: actionFetch(L), read, now: T0 })) as Report;
  assertEquals([rl.mode, rl.errors], ["live", []]);
  assertEquals(L.writes(), Array(6).fill("POST clob.polymarket.com/order"));
  assertEquals(L.open("live").map((o) => o.state), Array(6).fill("live"));
  // From any other region the wire sends nothing, whatever the config: a POST leaves only from eu-west-1.
  const G = world({ config: ARMED });
  const rg = await inRegion("eu-west-2", () => runPmMidAction({ db: G.db, fetchImpl: actionFetch(G), read: (n) => (n === "SB_REGION" ? "eu-west-2" : ENV[n]), now: T0 })) as Report;
  assertEquals([rg.mode, rg.gates?.openBlockedBy, G.writes()], ["live", "region", []]);
  // A key that is not the stored signer's loads none: a dry-run whatever the config, and it says why.
  const K = world({ config: ARMED });
  const rk = await inRegion("eu-west-1", () => runPmMidAction({ db: K.db, fetchImpl: actionFetch(K), read: (n) => (n === "POLYMARKET_PRIVATE_KEY" ? `0x${"11".repeat(32)}` : ENV[n]), now: T0 })) as Report;
  assertEquals([rk.mode, K.writes()], ["dry_run", []]);
  assert(rk.why.includes("the private key's address is not POLYMARKET_SIGNER_ADDRESS"), rk.why);
  assert(rk.errors.some((e) => e.startsWith("secrets:")), rk.errors.join(" | "));
  assertEquals([K.state().keyed, K.state().signerProblem], [false, "the private key's address is not POLYMARKET_SIGNER_ADDRESS: no order can be signed"]);
  // A database that refuses everything: a report, not a throw.
  const broken = { ...w.db, claim: () => Promise.reject(new Error("db PATCH agent_locks → 503")) };
  const r2 = await runPmMidAction({ db: broken as typeof w.db, fetchImpl: actionFetch(w), read, now: T0 + M }) as Report;
  assert(r2.errors[0].startsWith("LEASE CLAIM FAILED"), JSON.stringify(r2));
});

Deno.test("the config is the lock: as deployed (dry_run on, unarmed, the key loaded) a day of mid-pool's action sends nothing but GETs and its keyless batch read; nor does dry_run off but unarmed", async () => {
  await inRegion("eu-west-1", async () => {
    for (const variant of ["as deployed: dry_run on", "dry_run off but unarmed, nothing held"] as const) {
      const w = world({ config: variant === "as deployed: dry_run on" ? {} : { dry_run: false, live_confirmed_at: null } });
      for (let t = T0; t < T0 + 24 * 60 * M; t += M) {
        if ((t - T0) % (7 * M) === 0) w.M3.bid = w.M3.bid === 0.45 ? 0.44 : 0.45;
        const r = await runPmMidAction({ db: w.db, fetchImpl: actionFetch(w), read: (n) => ENV[n], now: t }) as Report;
        if (t === T0) assertEquals([r.mode, r.gates?.openBlockedBy ?? null], variant === "as deployed: dry_run on" ? ["dry_run", null] : ["live", "armed"]);
      }
      assertEquals(w.writes(), [], variant);
      const orders = w.mem.tables.pm_mid_orders as Row[];
      if (variant === "as deployed: dry_run on") assert(orders.length > 100 && orders.every((o) => o.mode === "dry_run"), `${orders.length} orders`);
      else assertEquals(orders.filter((o) => o.mode === "live"), []);
    }
  });
});

Deno.test("mid-pool's kill switches reach the venue through its wire: unarmed, its buys are withdrawn and a holding sold; back in dry-run, its live orders cancelled", async () => {
  await inRegion("eu-west-1", async () => {
    const w = world({ config: ARMED });
    const act = (t: number) => runPmMidAction({ db: w.db, fetchImpl: actionFetch(w), read: (n) => ENV[n], now: t }) as Promise<Report>;
    await act(T0);
    assertEquals(w.open("live").length, 6);
    // `live_confirmed_at = null`: nothing that opens; every buy withdrawn at the venue; the YES held in M3 sold at its ask.
    w.setConfig({ live_confirmed_at: null });
    w.pm.tokens.set(w.M3.yes, 20);
    const r1 = await act(T0 + M);
    assertEquals([r1.mode, r1.gates?.openBlockedBy], ["live", "armed"]);
    assertEquals(w.pm.calls.filter((c) => c === "DELETE clob.polymarket.com/order").length, 6);
    assertEquals(w.open("live").map((o) => `${o.cond === w.M3.cond ? "M3" : o.cond} ${o.outcome} ${o.side} ${o.gate}`), ["M3 yes SELL reduce"]);
    // `dry_run = true`: back to dry-run; the live order left is cancelled at the venue, and the dry-run quotes again.
    w.setConfig({ dry_run: true });
    const r2 = await act(T0 + 2 * M);
    assertEquals(r2.mode, "dry_run");
    assertEquals(w.pm.calls.filter((c) => c === "DELETE clob.polymarket.com/order").length, 7);
    assertEquals(w.open("live"), []);
    assert(w.open("dry_run").length > 0);
  });
});
