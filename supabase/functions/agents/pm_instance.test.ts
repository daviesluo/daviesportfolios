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

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
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
function world(runLive: RunLive, runPrep: RunPrep, explicit = false) {
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
        ...(explicit ? { inst: Path.PM_LIVE_INSTANCE } : {}),
      });
      clock.now = t + 5e3;
      const prep = await runPrep({
        db: prepDb, now: t + 5e3, holder: `p${t}`, pm: { fetchImpl: pm.publicFetch, clock: () => clock.now },
        ...(explicit ? { inst: Prep.PREP_INSTANCE } : {}),
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

Deno.test("the default instance is the pre-registered path and layer: every table, request and report the same, turn by turn", async () => {
  const frozen = world(Frozen.runPmLive, FrozenPrep.runPmPrep);
  const today = world(Path.runPmLive, Prep.runPmPrep);
  const named = world(Path.runPmLive, Prep.runPmPrep, true);                   // the default named, not left out
  const states = new Set<string>();                                             // every order state seen after a turn
  for (const [t, act] of STEPS) {
    for (const w of [frozen, today, named]) act?.(w);
    const a = await frozen.turn(t), b = await today.turn(t), c = await named.turn(t);
    const label = iso(t);
    assertEquals(JSON.stringify(b), JSON.stringify(a), `reports at ${label}`);
    assertEquals(JSON.stringify(c), JSON.stringify(a), `reports at ${label} (named)`);
    assertEquals(JSON.stringify(today.mem.tables), JSON.stringify(frozen.mem.tables), `tables after ${label}`);
    assertEquals(JSON.stringify(named.mem.tables), JSON.stringify(frozen.mem.tables), `tables after ${label} (named)`);
    assertEquals(today.pm.urls, frozen.pm.urls, `requests by ${label}`);
    assertEquals(named.pm.urls, frozen.pm.urls, `requests by ${label} (named)`);
    assertEquals(today.pm.bodies, frozen.pm.bodies, `bodies by ${label}`);
    for (const o of today.mem.tables.pm_live_orders as Row[]) states.add(`${o.mode}:${o.state}`);
  }
  // What the days went through, read from the record: an equality over a world that did nothing would prove nothing.
  const T = today.mem.tables as Record<string, Row[]>;
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
  // tables, lease and migrations.
  check(Frozen as Record<string, unknown>, Path as Record<string, unknown>, ["inUniverse", "candidateOf", "selectMarkets", "runPmLive"]);
  // The layer: its run takes the instance's tables and lease.
  check(FrozenPrep as Record<string, unknown>, Prep as Record<string, unknown>, ["runPmPrep"]);
  // The default instances are the names the code had: its tables, its lease, its band.
  assertEquals(Path.pmLiveDbTables(Path.PM_LIVE_INSTANCE), Path.PM_LIVE_DB_TABLES);
  assertEquals([Path.PM_LIVE_INSTANCE.lock, Path.PM_LIVE_INSTANCE.band, Path.PM_LIVE_INSTANCE.exclusion], ["pm-live", { floor: 6, ceiling: 10 }, undefined]);
  assertEquals([...Prep.prepDbTables(Prep.PREP_INSTANCE)].sort(), [...Prep.PREP_DB_TABLES].sort());
  // …which is the frozen layer's own list of what it may touch.
  assertEquals([...Prep.prepDbTables(Prep.PREP_INSTANCE)].sort(), [...FrozenPrep.PREP_DB_TABLES].sort());
  assertEquals([Prep.prepReads(Prep.PREP_INSTANCE), Prep.PREP_INSTANCE.lock], [[...Prep.PREP_READS], "pm-prep"]);
});
