// What Polymarket pays, told apart per path (2026-10-04; pm_live.ts's `readout` and the minute's share of the pool).
//
// Mini-pool and mid-pool quote from ONE Polymarket account, and Polymarket pays the account, not a path. Until this
// change mini-pool's readout booked every market the account was paid for as a live row of its own (a paid market its
// minutes did not show became a live row with no minutes), and mid-pool read no payout at all (`readsPayouts` false): a
// live mid-pool's rewards would have landed in mini-pool's R, and its own R would have read zero. Now a path books a
// payout only for a market its own minutes show it quoting live that day, and mid-pool, which reads nothing of what the
// account earns in dry-run, reads it once it is live: the share each live minute, the payouts of a day it quoted live.
//
// What is pinned:
//   0. The formula fix of 2026-10-04 (mid-pool's pre-registration, Addendum 2) is on main before this change: its fields
//      (each minute's figures, the readout's sums of them, the paper's reward) are taken out of both sides first
//      (`withoutFormula`, the list pm_mid_formula.test.ts states and pins), so what is compared is this change alone.
//   1. Mid-pool through today's pm_live.ts against mid-pool through the path its pre-registration froze
//      (`pm_live_mid_frozen.ts`, byte for byte `pm_live.ts` at sha256 8ba7b915…, held to the pre-registration's own words
//      by src/pm_mid_prereg.test.js), minute by minute over simulated days, each world a database and a fake Polymarket
//      of its own built the same way, with the paper layer beside every turn: in dry-run every table, request, body and
//      report the same; live, the same but for what reading the account's earnings adds (the share on its live minutes,
//      the payouts on its live reward days and their readout, and the reads that fetch them), which is then asserted to
//      be exactly that. So no dry-run decision of mid-pool changes, and no live one either.
//   2. Mini-pool: `pm_instance.test.ts` runs the default instance against the code its own pre-registration froze, through
//      dry-run and live with a paid readout, and still finds every table, request and report the same.
//   3. The two paths on one account: whichever is live books what was paid for its own live markets, the other books
//      nothing live, and a market neither quoted live is neither's; the account's day total stays visible on both.
//
// The day stop of 2026-10-07 (Davies: "只算当天变化"; mid-pool's deviation 4) is on main before this change and changes a
// decision once a holding is carried across 00:00, so in 1. today's path runs mid-pool's instance on the day stop the
// pre-registration froze (`dayStopOnCost`, which no action sets), as pm_mid_formula.test.ts runs it: what is compared is
// this change alone. pm_mid_formula.test.ts and pm_daystop.test.ts pin the day stop itself.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import * as Frozen from "./pm_live_mid_frozen.ts";
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
/** Mini-pool's beside it, as 0080 leaves it: the same sizes. */
const MINI_CONFIG = (({ created_at: _c, ...rest }) => rest)(MID_CONFIG);
/** The go-time statement's effect on a row, as the double holds it. */
const ARMED = { dry_run: false, live_confirmed_at: iso(T0 - M) };
/** Every read of what the account earns: its payouts, its day total, its share of each pool, its rebates. */
const EARNINGS_URL = /clob\.polymarket\.com\/(rewards\/user|rebates\/current)/;

// deno-lint-ignore no-explicit-any
type RunLive = (d: any) => Promise<unknown>;

/**
 * Mid-pool's hand-worked market set (pm_mid.test.ts): every market the same book (0.45 / 0.47, 20 at each touch, minimum
 * 20, max spread 4.5 ¢). RW's $300 takes the thirteen $100 markets, R50 and M1 ($40, its last pick); the margin leaves
 * out M2 ($33) and M20 ($13.20); mid-pool takes M3 ($13.19), M4 ($12) and M5 ($10). S7, S8 and S9 ($7, $8, $9.99) are
 * mini-pool's band.
 */
function markets(pm: FakePolymarket) {
  const add = (n: number, rate: number, extra: Record<string, unknown> = {}) =>
    pm.addMarket({ cond: cond(n), yes: tok(n, "yes"), no: tok(n, "no"), rate, sponsoredRate: null, minSize: 20, depth: [[0, 20]], ...extra });
  for (let k = 1; k <= 13; k++) add(100 + k, 100);
  const R50 = add(150, 50), M1 = add(201, 40), M2 = add(202, 33), M20 = add(220, 13.2), M3 = add(203, 13.19), M4 = add(204, 12), M5 = add(205, 10);
  const S7 = add(307, 7), S8 = add(308, 8), S9 = add(309, 9.99);
  return { R50, M1, M2, M20, M3, M4, M5, S7, S8, S9 };
}

// ------------------------------------------------------------------ 1. mid-pool against the code it froze

/** One world of mid-pool alone: its path run by `runLive`, its paper layer by today's pm_prep.ts, prints through its bids. */
function midWorld(runLive: RunLive, onCost = false) {
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
        inst: onCost ? { ...PM_MID_INSTANCE, dayStopOnCost: true } : PM_MID_INSTANCE, pm: { fetchImpl: pm.publicFetch },
      });
      clock.now = t + 5e3;
      const prep = await Prep.runPmPrep({ db: prepDb, now: t + 5e3, holder: `p${t}`, inst: PREP_MID_INSTANCE, pm: { fetchImpl: pm.publicFetch, clock: () => clock.now } });
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

/** The days, as [when, what changes just before the turn], pm_instance.test.ts's on mid-pool's markets. */
const STEPS: Array<[number, ((w: MidWorld) => void)?]> = [
  // Day 1, a dry-run: the selection (RW's exclusion recomputed), the quotes, then a minute at a time.
  [T0],
  ...Array.from({ length: 30 }, (_, k): [number, ((w: MidWorld) => void)?] => {
    const acts: Record<number, (w: MidWorld) => void> = {
      2: (w) => { w.M3.bid = 0.46; },                                           // a re-price
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
  // A stretch the loop missed: the dry-run's orders expire.
  [T0 + 45 * M], [T0 + 46 * M],
  // Day 2: its own selection, the readout of day 1, then live: the go-time statement's effect on the row.
  [at("2026-10-06T00:00:30Z")], [at("2026-10-06T00:01:30Z")], [at("2026-10-06T00:02:30Z")],
  [at("2026-10-06T01:00:30Z")],
  [LIVE_FROM, (w) => { w.setConfig({ dry_run: false, live_confirmed_at: "2026-10-06T01:05:00.000Z", loss_day_usd: 0.5 }); w.pm.percentages = { [w.M3.cond]: 12.5, [w.M4.cond]: 3 }; }],
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
  // Day 3: a new selection, the readout of day 2 with what the venue paid, and M3 held and settled.
  [at("2026-10-07T00:01:30Z"), (w) => {
    w.pm.earnings["2026-10-06"] = { native: [{ cond: w.M3.cond, usd: 0.37 }], sponsored: [{ cond: w.M4.cond, usd: 0.05 }] };
    w.pm.rebatesByDay["2026-10-06"] = [{ cond: w.M3.cond, usdc: "0.002" }];
  }],
  [at("2026-10-07T01:00:30Z")],
  [at("2026-10-07T06:00:30Z"), (w) => { Object.assign(w.M3, { resolved: true, payout: 0, closedTime: "2026-10-07 05:58:00+00" }); }],
  [at("2026-10-07T06:01:30Z")], [at("2026-10-07T06:02:30Z")],
];

/** The fields the formula of 2026-10-04 makes, taken out (pm_mid_formula.test.ts states and pins them). */
function withoutFormula(tables: Record<string, unknown>): Record<string, Row[]> {
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
function reportWithoutFormula(r: any): unknown {
  const x = structuredClone(r);
  for (const m of x.live?.minutes ?? []) { delete m.formula; delete m.ours; delete m.others; }
  for (const d of x.live?.readout ?? []) delete d.formula;
  if (x.prep) delete x.prep.reward;
  return x;
}

/**
 * Today's record with what reading the account's earnings adds taken back out: the live minutes' share, the payouts on
 * the live reward days, the account's day total on every row of a day it quoted live, and the readout's sums of those.
 * The frozen code reads none of them for mid-pool, so what is left must be the frozen code's record exactly.
 */
function withoutEarnings(tables: Record<string, unknown>): Record<string, Row[]> {
  const t = structuredClone(tables) as Record<string, Row[]>;
  for (const r of t.pm_mid_minutes) if (r.mode === "live") r.pct = null;
  // A day it quoted live is read whole: every row of that day carries the account's day total, its dry-run rows too.
  const paidDays = new Set(t.pm_mid_reward_days.filter((r) => r.mode === "live").map((r) => r.day));
  for (const r of t.pm_mid_reward_days) {
    if (r.mode === "live") Object.assign(r, { actual_usd: 0, actual_sponsored_usd: 0, rebate_usd: 0 });
    if (paidDays.has(r.day)) r.detail = { total: null, rebatesRead: null };
  }
  for (const e of t.pm_mid_events) {
    if (e.kind === "readout") for (const x of (e.detail as { days: Row[] }).days) Object.assign(x, { actual: 0, sponsored: 0, rebates: 0, total: null });
  }
  return t;
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
function reportWithoutEarnings(r: unknown): unknown {
  const x = structuredClone(r) as { live: { readout?: Array<Record<string, unknown>> } };
  for (const d of x.live.readout ?? []) d.actual = 0;
  return x;
}

Deno.test("mid-pool through today's path is mid-pool through the path its pre-registration froze: every dry-run table, request and report the same, and live the same but what it now reads of the account's earnings", async () => {
  const frozen = midWorld(Frozen.runPmLive), today = midWorld(Path.runPmLive, true);
  const states = new Set<string>();
  let dryTurns = 0, liveTurns = 0;
  for (const [t, act] of STEPS) {
    for (const w of [frozen, today]) act?.(w);
    const a = await frozen.turn(t), b = await today.turn(t);
    const label = iso(t);
    if (t < LIVE_FROM) {
      // The dry-run: byte for byte.
      dryTurns++;
      assertEquals(JSON.stringify(reportWithoutFormula(b)), JSON.stringify(reportWithoutFormula(a)), `reports at ${label}`);
      assertEquals(firstDiff(withoutFormula(today.mem.tables), withoutFormula(frozen.mem.tables)), "", `tables after ${label}`);
      assertEquals(today.pm.urls, frozen.pm.urls, `requests by ${label}`);
      assert(!today.pm.urls.some((u) => EARNINGS_URL.test(u)), `nothing of what the account earns read in dry-run, by ${label}`);
    } else {
      // Live: the same orders, fills, cancels, selections, settlements, minutes and events; what differs is only what is
      // read of the account's earnings, and the reads themselves.
      liveTurns++;
      assertEquals(JSON.stringify(reportWithoutFormula(reportWithoutEarnings(b))), JSON.stringify(reportWithoutFormula(a)), `reports at ${label}`);
      assertEquals(firstDiff(withoutFormula(withoutEarnings(today.mem.tables)), withoutFormula(frozen.mem.tables)), "", `tables after ${label}`);
      assertEquals(today.pm.urls.filter((u) => !EARNINGS_URL.test(u)), frozen.pm.urls, `requests by ${label}, less the earnings reads`);
    }
    assertEquals(today.pm.bodies, frozen.pm.bodies, `bodies by ${label}`);
    assert(!frozen.pm.urls.some((u) => EARNINGS_URL.test(u)), `the frozen path reads nothing of what the account earns for mid-pool, by ${label}`);
    for (const o of today.mem.tables.pm_mid_orders as Row[]) states.add(`${o.mode}:${o.state}`);
  }
  assert(dryTurns >= 37 && liveTurns >= 18, `${dryTurns} dry-run turns, ${liveTurns} live`);
  // What today's code adds, exactly: the live minutes' share of each pool, read once a live minute; and what the account
  // was paid on mid-pool's own live markets of 10-06, read once at the readout.
  const T = today.mem.tables as Record<string, Row[]>, F = frozen.mem.tables as Record<string, Row[]>;
  const liveMins = T.pm_mid_minutes.filter((r) => r.mode === "live");
  assert(liveMins.length > 20 && liveMins.every((r) => r.pct === (r.cond === today.M3.cond ? 12.5 : r.cond === today.M4.cond ? 3 : 0)), JSON.stringify(liveMins.map((r) => r.pct)));
  assert(T.pm_mid_minutes.filter((r) => r.mode === "dry_run").every((r) => r.pct === null));
  const paid = T.pm_mid_reward_days.filter((r) => r.mode === "live" && r.day === "2026-10-06");
  assertEquals(paid.map((r) => [r.cond === today.M3.cond ? "M3" : r.cond === today.M4.cond ? "M4" : r.cond, r.actual_usd, r.actual_sponsored_usd, r.rebate_usd]).sort(),
    [["M3", 0.37, 0, 0.002], ["M4", 0, 0.05, 0]]);
  assert(F.pm_mid_reward_days.filter((r) => r.mode === "live").every((r) => r.actual_usd === 0 && r.actual_sponsored_usd === 0 && r.rebate_usd === 0));
  const extra = today.pm.urls.filter((u) => EARNINGS_URL.test(u)).map((u) => u.replace(/\?.*$/, ""));
  assertEquals(extra.filter((u) => u.endsWith("/percentages")).length, liveTurns, "the share read once every live turn");
  assertEquals(extra.filter((u) => !u.endsWith("/percentages")).sort(), [
    "GET https://clob.polymarket.com/rebates/current", "GET https://clob.polymarket.com/rewards/user", "GET https://clob.polymarket.com/rewards/user",
    "GET https://clob.polymarket.com/rewards/user/total",
  ], "the payouts read once, for 10-06, the one day it quoted live");
  // What the days went through, read from the record: an equality over a world that did nothing would prove nothing.
  const kinds = new Set(T.pm_mid_events.map((e) => `${e.mode}:${e.kind}`));
  for (const k of ["dry_run:selection", "dry_run:gates", "dry_run:condition", "dry_run:readout", "live:selection", "live:gates", "live:loss_stop_day", "live:readout"]) assert(kinds.has(k), k);
  for (const s of ["dry_run:live", "dry_run:cancelled", "dry_run:expired", "live:pending", "live:live", "live:cancelled", "live:filled", "live:rejected"]) {
    assert(states.has(s), `${s} in ${[...states]}`);
  }
  assert(T.pm_mid_fills.some((f) => f.status === "CONFIRMED"), "a CONFIRMED fill");
  assert(T.pm_mid_settlements.length >= 1, "a settlement");
  assert(T.pm_mid_markets.length >= 6 && new Set(T.pm_mid_markets.map((m) => m.day)).size === 3, "three days' selections");
  const note = (T.pm_mid_markets[0].detail as { note: Record<string, any> }).note;
  assertEquals([note.exclusion.rule, note.exclusion.margin, note.exclusion.excluded], ["RW", 0.67, 3], "RW's exclusion applied");
  assert(T.pm_midprep_fills.length >= 5 && T.pm_midprep_days.length >= 1, `paper fills ${T.pm_midprep_fills.length}, days ${T.pm_midprep_days.length}`);
  assert(T.pm_midprep_minutes.some((m) => m.class === "matched") && T.pm_midprep_minutes.some((m) => m.class === "dark"), "matched and dark minutes");
  assert(today.pm.calls.some((c) => c.startsWith("POST clob.polymarket.com/order")) && today.pm.calls.some((c) => c.startsWith("DELETE clob.polymarket.com/cancel-all")), "live writes");
});

Deno.test("every export of the path mid-pool's pre-registration froze is today's, text for text and value for value, but the two the formula fix changed: this change is inside the turn and its readout", () => {
  // 2026-10-04 (pm_mid_formula.test.ts); and 2026-10-09, the go-live audit: `gates` (F1, live-prep's live turn only) and
  // `bookNow` (F4, a book that names a protocol).
  const fixed = ["minuteFormula", "selectMarkets", "gates", "bookNow"];
  for (const [k, v] of Object.entries(Frozen)) {
    const now = (Path as Record<string, unknown>)[k];
    assert(k in Path, `${k} is still exported`);
    if (typeof v === "function") (fixed.includes(k) ? assert(String(now) !== String(v), k) : assertEquals(String(now), String(v), k));
    else assertEquals(now, v, k);
  }
  // The paper layer's book-keeping comes from today's pm_live.ts: those functions are the frozen path's own.
  for (const name of ["bookPnl", "closeOnly", "effectiveLimits", "inYesBook", "onTick", "settlementFills", "tokenBooks"] as const) {
    assertEquals(String(Path[name]), String(Frozen[name]), name);
  }
});

// ------------------------------------------------------------------ 3. two paths, one account

/** Both paths on one database and one fake account, each through today's code with its own instance and tables. */
function shared(o: { mini?: Record<string, unknown>; mid?: Record<string, unknown> } = {}) {
  const clock = { now: T0 };
  const pm = new FakePolymarket(() => clock.now);
  const m = markets(pm);
  const tables = [...Object.values(Path.PM_LIVE_INSTANCE.tables), ...Object.values(PM_MID_INSTANCE.tables)].filter((t) => !t.endsWith("_config"));
  const mem = memDb({
    agent_locks: [{ name: "pm-live", lease_until: iso(0), holder: null }, { name: "pm-mid", lease_until: iso(0), holder: null }],
    agent_risk: [{ id: 1, global_pause: false }],
    pm_live_config: [{ ...MINI_CONFIG, ...o.mini }], pm_mid_config: [{ ...MID_CONFIG, ...o.mid }],
    ...Object.fromEntries(tables.map((t) => [t, []])),
  }, { now: () => clock.now });
  const dbs = {
    mini: onlyTables(mem.db, Path.pmLiveDbTables(Path.PM_LIVE_INSTANCE), { lease: "pm-live", readOnly: ["agent_risk"] }),
    mid: onlyTables(mem.db, Path.pmLiveDbTables(PM_MID_INSTANCE), { lease: "pm-mid", readOnly: ["agent_risk"] }),
  };
  const key = new PmOrderKey(PM_TEST_KEY);
  let salt = 1;
  /** Every request each path's turns sent, apart. */
  const calls = { mini: [] as string[], mid: [] as string[] };
  return {
    clock, pm, mem, ...m, calls,
    async turn(path: "mini" | "mid", t: number) {
      clock.now = t;
      const before = pm.urls.length;
      const r = await Path.runPmLive({
        db: dbs[path], now: t, holder: `${path}${t}`, venue: pm.venue(), sbRegion: "eu-west-1", sendsEnabled: true,
        account: { maker: PM_TEST_FUNDER, signer: PM_TEST_SIGNER }, signer: key, salt: () => String(salt++), pause: () => Promise.resolve(), clock: () => clock.now,
        ...(path === "mid" ? { inst: PM_MID_INSTANCE, pm: { fetchImpl: pm.publicFetch } } : {}),
      });
      calls[path].push(...pm.urls.slice(before));
      assertEquals(r.errors, [], `${path} at ${iso(t)}`);
      return r;
    },
    /** A day's readout rows of one path's table. */
    days: (table: "pm_live_reward_days" | "pm_mid_reward_days", day: string) => (mem.tables[table] as Row[]).filter((r) => r.day === day),
  };
}
const D = "2026-10-05", AFTER = at("2026-10-06T01:00:30Z");
/** R as the design doc's query reads it, over one path's own live rows: Σ actual / Σ formula, null with no formula. */
const R = (rows: Row[]) => {
  const live = rows.filter((r) => r.mode === "live"), f = live.reduce((s, r) => s + Number(r.formula_usd), 0);
  return f > 0 ? live.reduce((s, r) => s + Number(r.actual_usd) + Number(r.actual_sponsored_usd), 0) / f : null;
};
const named = (w: ReturnType<typeof shared>, c: unknown) =>
  (Object.entries(w).find(([k, v]) => /^(R50|M\d+|S\d)$/.test(k) && (v as { cond?: string })?.cond === c)?.[0]) ?? String(c);

Deno.test("one account, mid-pool live and mini-pool in dry-run: mid-pool books what was paid for its own live markets, mini-pool books nothing live, and a market neither quoted live is neither's", async () => {
  const w = shared({ mid: ARMED });
  w.pm.percentages = { [w.M3.cond]: 12.5, [w.M4.cond]: 3, [w.S9.cond]: 7 };
  for (let k = 0; k < 6; k++) { await w.turn("mini", T0 + k * M); await w.turn("mid", T0 + k * M); }
  assert((w.mem.tables.pm_mid_orders as Row[]).some((o) => o.mode === "live" && o.state === "live"), "mid-pool quotes live");
  assert((w.mem.tables.pm_live_orders as Row[]).every((o) => o.mode === "dry_run"), "mini-pool in dry-run");
  // The account is paid for mid-pool's M3 and M4, for S9 (a market of mini-pool's dry-run) and for R50 (RW's, neither's).
  w.pm.earnings[D] = { native: [{ cond: w.M3.cond, usd: 1.2 }, { cond: w.S9.cond, usd: 0.8 }, { cond: w.R50.cond, usd: 0.5 }], sponsored: [{ cond: w.M4.cond, usd: 0.1 }] };
  w.pm.rebatesByDay[D] = [{ cond: w.M3.cond, usdc: "0.002" }];
  await w.turn("mini", AFTER);
  await w.turn("mid", AFTER);
  const mid = w.days("pm_mid_reward_days", D), mini = w.days("pm_live_reward_days", D);
  // Mid-pool: a live row for each market its live minutes show, with what the account was paid for it.
  assertEquals(mid.map((r) => [r.mode, named(w, r.cond), r.minutes, r.actual_usd, r.actual_sponsored_usd, r.rebate_usd]).sort(),
    [["live", "M3", 5, 1.2, 0, 0.002], ["live", "M4", 5, 0, 0.1, 0], ["live", "M5", 5, 0, 0, 0]]);
  assert(mid.every((r) => Number(r.formula_usd) > 0), JSON.stringify(mid.map((r) => r.formula_usd)));
  // Mini-pool: its own dry-run rows and nothing live. Before 2026-10-04 it booked M3, M4, S9 and R50 as live rows of its own.
  assertEquals(mini.map((r) => [r.mode, named(w, r.cond), r.actual_usd]).sort(), [["dry_run", "S7", null], ["dry_run", "S8", null], ["dry_run", "S9", null]]);
  // R per path, as the design doc's query reads it.
  const f = mid.reduce((s, r) => s + Number(r.formula_usd), 0);
  assert(Math.abs(R(mid)! - 1.3 / f) < 1e-12, `${R(mid)} against ${1.3 / f}`);
  assertEquals(R(mini), null);
  // The account's day total stays on both paths' rows and readouts: 2.60, of which mid-pool's live rows hold 1.30.
  const total = (rows: Row[]) => rows.map((r) => ((r.detail as { total: Array<{ earnings: number }> | null }).total ?? []).reduce((s, x) => s + x.earnings, 0));
  assert([...total(mid), ...total(mini)].every((x) => Math.abs(x - 2.6) < 1e-9), JSON.stringify([...total(mid), ...total(mini)]));
  const readout = (t: string) => (w.mem.tables[t] as Row[]).filter((e) => e.kind === "readout")
    .flatMap((e) => (e.detail as { days: Array<Record<string, unknown>> }).days).find((x) => x.day === D)!;
  assertEquals([readout("pm_mid_events").actual, readout("pm_mid_events").total], [1.3, 2.6]);
  assertEquals([readout("pm_live_events").actual, readout("pm_live_events").total], [0, 2.6]);
  // Mid-pool read what the account earns because it was live: the share every live turn (its own markets' only), the
  // payouts once, for the one day it quoted live (10-04 has no minute of its, so nothing is read for it).
  const midMins = w.mem.tables.pm_mid_minutes as Row[];
  assertEquals([...new Set(midMins.map((r) => `${named(w, r.cond)} ${r.mode} ${r.pct}`))].sort(), ["M3 live 12.5", "M4 live 3", "M5 live 0"]);
  assertEquals([...new Set((w.mem.tables.pm_live_minutes as Row[]).map((r) => `${named(w, r.cond)} ${r.mode} ${r.pct}`))].sort(), ["S7 dry_run 0", "S8 dry_run 0", "S9 dry_run 7"]);
  const midPaid = w.calls.mid.filter((u) => EARNINGS_URL.test(u) && !u.includes("/percentages"));
  assert(midPaid.length === 5 && midPaid.every((u) => u.includes(`date=${D}`)), midPaid.join(" | "));
});

Deno.test("one account, mini-pool live and mid-pool in dry-run: mini-pool books only its own live markets, and mid-pool reads nothing of what the account earns", async () => {
  const w = shared({ mini: ARMED });
  w.pm.percentages = { [w.S9.cond]: 7, [w.M3.cond]: 4 };
  for (let k = 0; k < 6; k++) { await w.turn("mini", T0 + k * M); await w.turn("mid", T0 + k * M); }
  assert((w.mem.tables.pm_live_orders as Row[]).some((o) => o.mode === "live" && o.state === "live"), "mini-pool quotes live");
  assert((w.mem.tables.pm_mid_orders as Row[]).every((o) => o.mode === "dry_run"), "mid-pool in dry-run");
  w.pm.earnings[D] = { native: [{ cond: w.S9.cond, usd: 0.9 }, { cond: w.M3.cond, usd: 0.4 }, { cond: w.R50.cond, usd: 0.5 }], sponsored: [{ cond: w.S8.cond, usd: 0.05 }] };
  await w.turn("mini", AFTER);
  await w.turn("mid", AFTER);
  const mini = w.days("pm_live_reward_days", D), mid = w.days("pm_mid_reward_days", D);
  // Mini-pool: its live markets with what each was paid; M3 (mid-pool's dry-run) and R50 (neither's) are not its.
  assertEquals(mini.map((r) => [r.mode, named(w, r.cond), r.minutes, r.actual_usd, r.actual_sponsored_usd]).sort(),
    [["live", "S7", 5, 0, 0], ["live", "S8", 5, 0, 0.05], ["live", "S9", 5, 0.9, 0]]);
  // Mid-pool: its dry-run rows, no payout, no share, and not one read of what the account earns.
  assertEquals(mid.map((r) => [r.mode, named(w, r.cond), r.actual_usd]).sort(), [["dry_run", "M3", null], ["dry_run", "M4", null], ["dry_run", "M5", null]]);
  assert((w.mem.tables.pm_mid_minutes as Row[]).every((r) => r.pct === null));
  assertEquals(w.calls.mid.filter((u) => EARNINGS_URL.test(u)), []);
  assertEquals(R(mid), null);
  assert(R(mini)! > 0);
});
