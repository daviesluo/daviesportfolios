// LP-SKEW-FT (docs/agents/reviews/2026-10-11-lp-skew-ft-prereg.md): a paper forward test of three quoting arms replayed
// on live-prep's own recorded minutes (`pm_lp_minutes`), read-only, written to its own two tables (0117). Pinned here:
// the arms' quotes (the skew shifts both prices by k·q, the cap stops the side that adds), the touch fill rule, the
// reward formula, a settlement, the kill, the lease, and that the module touches no table but its own and the reads.
import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { LPSKEW_ARMS, LPSKEW_KILL_USD, LPSKEW_START, armQuote, nextFills, runLpSkew, type LpSkewRow } from "./lpskew.ts";
import { memDb, onlyTables, type Row } from "./testing.ts";

const C = "0x" + "a".repeat(64);
const row = (minute: string, o: Partial<LpSkewRow> = {}): LpSkewRow => ({
  minute, cond: C, rate: 100, max_spread: 3.5, min_size: 20, tick: 0.01,
  bb: 0.48, ba: 0.52, ab: 0.48, aa: 0.52, q1: 100, q2: 100, bid_price: 0.49, ask_price: 0.51, ...o,
});

Deno.test("the arms are the pre-registration's: base 5N, cap40, skew k=0.001 with cap40; start and kill frozen", () => {
  assertEquals(LPSKEW_ARMS.map((a) => [a.id, a.capShares, a.k]), [["base", null, 0], ["cap40", 40, 0], ["skew", 40, 0.001]]);
  assertEquals(LPSKEW_START, "2026-10-12T00:00:00.000Z");
  assertEquals(LPSKEW_KILL_USD, 50);
});

Deno.test("armQuote: base quotes RW's prices at N; skew shifts both by k·q (rounded to the tick); the cap stops the adding side", () => {
  const r = row("2026-10-12T00:00:00Z");
  const base = armQuote(LPSKEW_ARMS[0], r, 0)!;
  assertEquals([base.b, base.a, base.nb, base.na], [0.49, 0.51, 20, 20]);
  const sk = armQuote(LPSKEW_ARMS[2], r, 20)!;            // 20 YES held: shift 2¢ down
  assertAlmostEquals(sk.b, 0.47, 1e-9); assertAlmostEquals(sk.a, 0.49, 1e-9);
  const skS = armQuote(LPSKEW_ARMS[2], r, -20)!;          // short 20: shift 2¢ up, never through the touch
  assertAlmostEquals(skS.b, 0.51, 1e-9); assertAlmostEquals(skS.a, 0.53, 1e-9);
  assertEquals(armQuote(LPSKEW_ARMS[1], r, 40)!.nb, 0);   // cap40 at +40: no buy
  assertEquals(armQuote(LPSKEW_ARMS[1], r, 40)!.na, 20);  // the sell stays
  assertEquals(armQuote(LPSKEW_ARMS[0], r, 40)!.nb, 20);  // base's cap is 5N = 100
  assertEquals(armQuote(LPSKEW_ARMS[0], r, 100)!.nb, 0);
  assertEquals(armQuote(LPSKEW_ARMS[0], row("t", { ab: null, aa: null }), 0), null);
});

Deno.test("nextFills: a bid fills when the next minute's ask or mid reaches it, an ask when the bid or mid does", () => {
  const q = { m: 0.5, b: 0.49, a: 0.51, nb: 20, na: 20 };
  assertEquals(nextFills(q, row("t")), { buy: 0, sell: 0 });
  assertEquals(nextFills(q, row("t", { bb: 0.45, ba: 0.49, ab: 0.45, aa: 0.49 })), { buy: 20, sell: 0 });
  assertEquals(nextFills(q, row("t", { bb: 0.51, ba: 0.55, ab: 0.51, aa: 0.55 })), { buy: 0, sell: 20 });
});

const seed = (rows: LpSkewRow[], extra: Record<string, Row[]> = {}) => memDb({
  agent_locks: [{ name: "pm-lpskew", lease_until: "2026-01-01T00:00:00.000Z", holder: null }],
  pm_lp_minutes: rows.map((r) => ({ mode: "live", ...r })), pm_lp_settlements: [], pm_lpskew_state: [], pm_lpskew_days: [], ...extra,
}, { now: () => Date.parse("2026-10-12T00:10:00Z") });

Deno.test("runLpSkew: replays the minutes in order, books a fill per arm, pays the formula, and touches only its tables", async () => {
  const rows = [
    row("2026-10-12T00:00:00.000Z"),
    row("2026-10-12T00:01:00.000Z", { bb: 0.45, ba: 0.49, ab: 0.45, aa: 0.49 }),   // our 0.49 bid fills
    row("2026-10-12T00:02:00.000Z", { bb: 0.45, ba: 0.49, ab: 0.45, aa: 0.49 }),
  ];
  const mem = seed(rows);
  const db = onlyTables(mem.db, ["agent_locks", "pm_lp_minutes", "pm_lp_settlements", "pm_lpskew_state", "pm_lpskew_days"],
    { lease: "pm-lpskew", readOnly: ["pm_lp_minutes", "pm_lp_settlements"] });
  const rep = await runLpSkew({ db, now: Date.parse("2026-10-12T00:10:00Z"), holder: "h" });
  assertEquals(rep.errors, []);
  assertEquals(rep.minutes, 2);                         // the last minute waits for its successor
  const days = await mem.db.select<Row>("pm_lpskew_days", "select=*");
  assertEquals(days.length, 3);
  const base = days.find((d) => d.arm === "base")!;
  assertEquals(base.day, "2026-10-12");
  assertEquals(base.fills, 1);
  assertAlmostEquals(Number(base.cash_usd), -9.8, 1e-9);  // bought 20 at 0.49
  assert(Number(base.formula_usd) > 0);
  const st = (await mem.db.select<Row>("pm_lpskew_state", "select=*"))[0];
  assertEquals((st.state as { cursor: string }).cursor, "2026-10-12T00:01:00.000Z");
  // A second run with nothing new does nothing more.
  const rep2 = await runLpSkew({ db, now: Date.parse("2026-10-12T00:11:00Z"), holder: "h2" });
  assertEquals(rep2.minutes, 0);
});

Deno.test("runLpSkew: nothing before the start; a settlement books the holding at its payout; the kill stops an arm", async () => {
  const pre = seed([row("2026-10-11T23:58:00.000Z"), row("2026-10-11T23:59:00.000Z")]);
  assertEquals((await runLpSkew({ db: pre.db, now: Date.parse("2026-10-12T00:10:00Z"), holder: "h" })).minutes, 0);

  const rows = [
    row("2026-10-12T00:00:00.000Z"),
    row("2026-10-12T00:01:00.000Z", { bb: 0.45, ba: 0.49, ab: 0.45, aa: 0.49 }),
    row("2026-10-12T00:02:00.000Z", { bb: 0.45, ba: 0.49, ab: 0.45, aa: 0.49 }),
  ];
  const mem = seed(rows, { pm_lp_settlements: [{ cond: C, payout: 0, settled_at: "2026-10-12T00:00:30.000Z" }] });
  await runLpSkew({ db: mem.db, now: Date.parse("2026-10-12T00:10:00Z"), holder: "h" });
  const base = (await mem.db.select<Row>("pm_lpskew_days", "arm=eq.base&select=*"))[0];
  assertEquals(base.settled, 1);
  assertEquals((base.held as Record<string, number>)[C] ?? 0, 0);

  // An arm marked at −50 or worse quotes nothing more.
  const k = seed(rows, { pm_lpskew_state: [{ id: 1, state: { cursor: null, day: "2026-10-12", arms: { base: { q: { [C]: 100 }, cash: { [C]: -99 }, mid: { [C]: 0.49 }, killed: null } } } }] });
  await runLpSkew({ db: k.db, now: Date.parse("2026-10-12T00:10:00Z"), holder: "h" });
  const ks = (await k.db.select<Row>("pm_lpskew_state", "select=*"))[0].state as { arms: Record<string, { killed: string | null }> };
  assert(ks.arms.base.killed !== null);
  assertEquals(ks.arms.cap40.killed, null);
});

Deno.test("runLpSkew: no lease, no run", async () => {
  const mem = seed([]);
  await mem.db.update("agent_locks", "name=eq.pm-lpskew", { lease_until: "2026-12-01T00:00:00.000Z", holder: "x" });
  const rep = await runLpSkew({ db: mem.db, now: Date.parse("2026-10-12T00:10:00Z"), holder: "h" });
  assert(rep.skipped?.includes("lease"));
});
