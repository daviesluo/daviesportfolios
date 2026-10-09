// Live-prep's capital follows its equity (`lpCapital`, pm_live.ts; migration 0106; its pre-registration's Addendum 8;
// Davies, 2026-10-09: "每天的rewards受益payout之后立马运用资金进策略…如果我补充资金的话也可以立马运用资金").
//
// What is pinned: the rule by hand-worked cases (off and dry-run keep the config's cap; equity = pUSD + held at cost +
// unredeemed; the cap is floor(equity − stop − $5) inside [0, ceiling]; down at once, up only on two agreeing readings a
// minute apart with no fill settling; an unread balance holds the last cap); and armed turns of the path on the fake
// venue: a payout raises the cap the turn after it is read, a deposit likewise, an unread or a once-read balance never
// raises it, a withdrawal lowers it at once and no buy is sent while what is held and resting is over it, while a sell of
// what is held still rests. Each of these fails on the code before Addendum 8, whose cap stayed the config's $320.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PM_LP_INSTANCE, PREP_LP_INSTANCE } from "./pm_lp.ts";
import { lpCapital, PM_LP_CAP_CEILING_USD, PM_LP_CAP_MARGIN_USD, PM_LP_EQUITY_FRESH_MS, pmLpDbTables, runPmLive, type LpCapitalInputs } from "./pm_live.ts";
import { PmOrderKey } from "../_shared/polymarket_orders.ts";
import { FakePolymarket, memDb, onlyTables, PM_TEST_FUNDER, PM_TEST_KEY, PM_TEST_SIGNER, type Row } from "./testing.ts";

const M = 60e3;
const iso = (ms: number) => new Date(ms).toISOString();
const cond = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const tok = (n: number, outcome: "yes" | "no") => `${9000000000000000000000000000000000000000000000000000000000000000000n + BigInt(n * 2 + (outcome === "no" ? 1 : 0))}`;

// ------------------------------------------------------------------ the rule, by hand

const NOW = Date.parse("2026-10-10T01:05:00Z");
const base: LpCapitalInputs = {
  mode: "live", reinvest: true, fixedCap: 320, ceiling: 1000, lossTotal: 75, pusd: 235.44, heldAtCostUsd: 166.59, unredeemedUsd: 0,
  unsettledFills: 0, inventoryReadable: true, prev: { equityUsd: 402.03, at: iso(NOW - M), capTotal: 320 }, now: NOW,
};

Deno.test("lpCapital: the constants; off or in dry-run the config's cap; equity = pUSD + held at cost + unredeemed", () => {
  assertEquals([PM_LP_CAP_CEILING_USD, PM_LP_CAP_MARGIN_USD, PM_LP_EQUITY_FRESH_MS], [1000, 5, 5 * M]);
  // 2026-10-09 14:50 UTC, by hand: 235.44 + 166.59 = 402.03; floor(402.03 − 75 − 5) = 322.
  const on = lpCapital(base);
  assertEquals([on.capTotal, on.equityUsd, on.targetUsd, on.basis], [322, 402.03, 322, "equity"]);
  const off = lpCapital({ ...base, reinvest: false });
  assertEquals([off.capTotal, off.equityUsd, off.targetUsd, off.basis], [320, 402.03, 322, "fixed"]);
  assertEquals(lpCapital({ ...base, mode: "dry_run" }).capTotal, 320);
  // A settled market's tokens not yet redeemed count at their payout: 235.44 + 166.59 + 50 − 80 = 372.03 → 372.
  assertEquals(lpCapital({ ...base, unredeemedUsd: 50, prev: { ...base.prev!, equityUsd: 452.03 } }).capTotal, 372);
});

Deno.test("lpCapital: a payout or a deposit raises the cap only on the second agreeing reading, by the lower of the two", () => {
  // The payout lands: pUSD +$40 (equity 442.03, target 362). The last turn read 402.03: the lower is 402.03, so 322.
  const first = lpCapital({ ...base, pusd: 275.44 });
  assertEquals([first.capTotal, first.targetUsd], [322, 362]);
  // The turn after reads it again: both 442.03, so floor(442.03 − 80) = 362.
  const second = lpCapital({ ...base, pusd: 275.44, prev: { equityUsd: 442.03, at: iso(NOW - M), capTotal: 322 } });
  assertEquals([second.capTotal, second.basis], [362, "equity"]);
  // A deposit of $500 is the same: 902.03 read twice → 822; with the ceiling at $600, 600; never past the code's $1,000.
  const dep = { ...base, pusd: 735.44, prev: { equityUsd: 902.03, at: iso(NOW - M), capTotal: 362 } };
  assertEquals(lpCapital(dep).capTotal, 822);
  assertEquals(lpCapital({ ...dep, ceiling: 600 }).capTotal, 600);
  assertEquals(lpCapital({ ...dep, pusd: 5000, prev: { equityUsd: 5166, at: iso(NOW - M), capTotal: 822 }, ceiling: 99999 }).capTotal, 1000);
  // No earlier reading, or one older than five minutes, or a fill still settling: the last cap holds.
  for (const x of [
    { ...base, pusd: 275.44, prev: null },
    { ...base, pusd: 275.44, prev: { equityUsd: 442.03, at: iso(NOW - 6 * M), capTotal: 322 } },
    { ...base, pusd: 275.44, prev: { equityUsd: 442.03, at: iso(NOW + M), capTotal: 322 } },
    { ...base, pusd: 275.44, unsettledFills: 1, prev: { equityUsd: 442.03, at: iso(NOW - M), capTotal: 322 } },
  ]) {
    const c = lpCapital(x);
    assertEquals([c.capTotal, c.basis], [x.prev ? 322 : 320, "held"]);
  }
});

Deno.test("lpCapital: an unread balance never raises it; a withdrawal or a loss lowers it at once, to 0 at the least", () => {
  for (const x of [{ ...base, pusd: null }, { ...base, inventoryReadable: false, pusd: 9999 }]) {
    const c = lpCapital({ ...x, prev: { equityUsd: 9999, at: iso(NOW - M), capTotal: 322 } });
    assertEquals([c.capTotal, c.equityUsd, c.basis], [322, null, "held"]);
  }
  // A withdrawal of $200: 35.44 + 166.59 = 202.03 → 122, at once, whatever the last reading said.
  const w = lpCapital({ ...base, pusd: 35.44, prev: { equityUsd: 402.03, at: iso(NOW - M), capTotal: 322 } });
  assertEquals([w.capTotal, w.basis], [122, "equity"]);
  assertEquals(lpCapital({ ...base, pusd: 0, heldAtCostUsd: 50, unsettledFills: 3 }).capTotal, 0);   // under the stop: 0, and a settling fill does not hold a fall back
});

// ------------------------------------------------------------------ armed turns on the fake venue

const T0 = Date.parse("2026-10-05T10:00:30Z");
const LP_CONFIG = {
  id: 1, dry_run: false, live_confirmed_at: "2026-10-05T09:00:00.000Z", ireland_attested_at: "2026-10-01T04:00:00.000Z", ireland_until: null,
  cap_total_usd: 320, cap_market_usd: 100, loss_day_usd: null, loss_total_usd: 75, max_posts_day: 12000, gtd_lifetime_s: 600, max_markets: 10, select_budget_usd: 200,
  reinvest: true, cap_ceiling_usd: 1000, created_at: "2026-10-04T18:00:00.000Z", updated_at: "2026-10-04T18:00:00.000Z",
};

/** One market, L1 ($12 a day, 0.45 / 0.47, N 5, thin books), the account at `pusd`. */
function world(o: { pusd: number; config?: Record<string, unknown> }) {
  const clock = { now: T0 };
  const pm = new FakePolymarket(() => clock.now);
  pm.pusd = o.pusd;
  const L1 = pm.addMarket({ cond: cond(1), yes: tok(1, "yes"), no: tok(1, "no"), rate: 12, sponsoredRate: null, minSize: 5, depth: [[0, 5]] });
  const mem = memDb({
    agent_locks: [{ name: "pm-lp", lease_until: iso(0), holder: null }],
    agent_risk: [{ id: 1, global_pause: false }],
    pm_lp_config: [{ ...LP_CONFIG, ...o.config }],
    ...Object.fromEntries([...Object.values(PM_LP_INSTANCE.tables).filter((t) => t !== "pm_lp_config"), ...Object.values(PREP_LP_INSTANCE.tables)].map((t) => [t, []])),
    pm_live_config: [{ ...LP_CONFIG, reinvest: undefined, cap_ceiling_usd: undefined, live_confirmed_at: null, dry_run: true }],
    pm_mid_config: [{ ...LP_CONFIG, reinvest: undefined, cap_ceiling_usd: undefined, live_confirmed_at: null, dry_run: true }],
  }, { now: () => clock.now });
  const db = onlyTables(mem.db, pmLpDbTables(PM_LP_INSTANCE), { lease: "pm-lp", readOnly: ["agent_risk", ...Object.values(PM_LP_INSTANCE.lp!.paper)] });
  const key = new PmOrderKey(PM_TEST_KEY);
  let salt = 1;
  const w = {
    pm, mem, L1,
    async turn(t: number) {
      clock.now = t;
      return await runPmLive({
        db, now: t, holder: `h${t}`, venue: pm.venue(), sbRegion: "eu-west-1", sendsEnabled: true, account: { maker: PM_TEST_FUNDER, signer: PM_TEST_SIGNER },
        signer: key, salt: () => String(salt++), pause: () => Promise.resolve(), clock: () => clock.now, inst: PM_LP_INSTANCE, pm: { fetchImpl: pm.publicFetch },
      });
    },
    rows: (t: string) => mem.tables[t] as Row[],
    // deno-lint-ignore no-explicit-any
    state: () => w.rows("pm_lp_state")[0].state as any,
    cap: () => w.state().limits.capTotal as number,
  };
  return w;
}

Deno.test("armed, reinvest: a payout raises the cap the turn after it is read; a deposit likewise; off, the cap stays $320", async () => {
  const w = world({ pusd: 400 });
  await w.turn(T0);
  assertEquals(w.cap(), 320);                                                       // 400 − 80, the go's own figure
  // The day's payout lands as pUSD: $50.
  w.pm.pusd += 50;
  await w.turn(T0 + M);
  assertEquals(w.cap(), 320);                                                       // read once: not yet
  await w.turn(T0 + 2 * M);
  const afterPayout = w.cap();
  // 450 of equity (the resting buys spend no pUSD until they fill) less 80.
  assertEquals(afterPayout, 370);
  assertEquals(w.state().lp.capital.basis, "equity");
  // Davies adds $500.
  w.pm.pusd += 500;
  await w.turn(T0 + 3 * M);
  assertEquals(w.cap(), 370);
  await w.turn(T0 + 4 * M);
  assertEquals(w.cap(), 870);
  // The same account with reinvest off: $320 throughout.
  const off = world({ pusd: 400, config: { reinvest: false } });
  for (let k = 0; k < 3; k++) { if (k === 1) off.pm.pusd += 550; await off.turn(T0 + k * M); }
  assertEquals([off.cap(), off.state().lp.capital.basis], [320, "fixed"]);
});

Deno.test("armed, reinvest: an unread pUSD never raises the cap, nor does one high reading between two lower ones", async () => {
  const w = world({ pusd: 400 });
  await w.turn(T0);
  w.pm.pusd = 900;
  w.pm.down.collateral = true;
  await w.turn(T0 + M);
  await w.turn(T0 + 2 * M);
  assertEquals([w.cap(), w.state().lp.capital.basis], [320, "held"]);
  // Readable again, but the 900 is read once and gone the turn after (a read mid-settlement): it never raises the cap.
  w.pm.down.collateral = false;
  await w.turn(T0 + 3 * M);
  assertEquals(w.cap(), 320);
  w.pm.pusd = 400;
  await w.turn(T0 + 4 * M);
  assertEquals(w.cap(), 320);
});

Deno.test("armed, reinvest: a withdrawal lowers the cap at once; nothing is bought while holdings and resting buys are over it; a sell still rests", async () => {
  const w = world({ pusd: 400 });
  await w.turn(T0);
  const yesBuy = w.rows("pm_lp_orders").find((x) => x.mode === "live" && x.outcome === "yes" && x.side === "BUY" && x.state === "live");
  assert(yesBuy, "a live BUY of YES rests");
  w.pm.settle(w.pm.fill(String(yesBuy.hash), 5), "CONFIRMED");                     // 5 YES at 0.45: $2.25 at cost
  await w.turn(T0 + M);
  // Davies withdraws all but $82 of pUSD: equity 82 + 2.25 = 84.25 → a cap of 4, at once.
  w.pm.pusd = 82;
  const r = await w.turn(T0 + 2 * M);
  assertEquals(w.cap(), 4);
  // Held $2.25 at cost: a buy of NO (5 × 0.53 = $2.65) would take it to $4.90, over $4: withheld; the sell of YES rests.
  assert(r.withheld.some((x) => x.gate === "cap_total"), JSON.stringify(r.withheld));
  const live = w.rows("pm_lp_orders").filter((x) => x.mode === "live" && x.state === "live");
  assertEquals(live.filter((x) => x.side === "BUY").length, 0);
  assertEquals(live.filter((x) => x.side === "SELL").map((x) => [x.outcome, Number(x.price), Number(x.size)]), [["yes", 0.47, 5]]);
});

Deno.test("armed, reinvest: a fill still settling holds a raise until it is CONFIRMED", async () => {
  const w = world({ pusd: 400 });
  await w.turn(T0);
  const yesBuy = w.rows("pm_lp_orders").find((x) => x.mode === "live" && x.outcome === "yes" && x.side === "BUY" && x.state === "live")!;
  const trade = w.pm.fill(String(yesBuy.hash), 5);                                 // MATCHED: pUSD has moved, the holding is not booked
  w.pm.pusd += 100;
  await w.turn(T0 + M);
  await w.turn(T0 + 2 * M);
  assertEquals([w.cap(), w.state().lp.capital.basis], [320, "held"]);
  w.pm.settle(trade, "CONFIRMED");
  await w.turn(T0 + 3 * M);
  await w.turn(T0 + 4 * M);
  // 500 − 2.25 of pUSD + 2.25 held at cost = 500 of equity → 420.
  assertEquals(w.cap(), 420);
});
