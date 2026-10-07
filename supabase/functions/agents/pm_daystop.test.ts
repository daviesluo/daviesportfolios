// The day stop counts only the day's change (2026-10-07). Davies, asked whether mini-pool's and mid-pool's day stop
// should keep counting every holding's whole unrealised loss as the day's or count only the change since 00:00 UTC,
// chose "只算当天变化": today's value of the book less its value as the day began (each holding at its mark then, or its
// cost if bought today), plus today's realised trades. The total stop is unchanged and keeps counting the carried loss.
// Mid-pool's paper had tripped its −$25 day stop at 00:00 on 10-05, 10-06 and 10-07 on its carried inventory alone and
// quoted nothing for three days.
//
// Pinned here, worked by hand: the figure (`sinceOpenPnl`, `paperDayPnl`), the opening marks the path keeps
// (`dayOpenMarks`), and the stop on the order path and on its paper layer: a position carried from yesterday with a $40
// unrealised loss at the day's opening mark does not trip a $25 day stop at 00:00 or 00:01; a fresh $26 loss within the
// day does; the total stop still trips past −$75 on the carried loss. Each against the same run on the frozen rule
// (`dayStopOnCost`), which trips at 00:00 on the carried loss: the counterfactual. No deployed instance sets it.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  bookPnl, dayOpenMarks, PM_LIVE_DB_TABLES, PM_LIVE_INSTANCE, PM_MINI_INSTANCE, runPmLive, sinceOpenPnl, tokenBooks, type PmFill, type PmLiveInstance,
} from "./pm_live.ts";
import { paperDayPnl, paperPnl, PREP_DB_TABLES, PREP_INSTANCE, PREP_LOCK, PREP_READS, runPmPrep, type PrepFill, type PrepInstance, type PrepState } from "./pm_prep.ts";
import { PM_MID_INSTANCE, PREP_MID_INSTANCE } from "./pm_mid.ts";
import { PM_LP_INSTANCE, PREP_LP_INSTANCE } from "./pm_lp.ts";
import { PmOrderKey } from "../_shared/polymarket_orders.ts";
import { FakePolymarket, memDb, onlyTables, PM_TEST_FUNDER, PM_TEST_KEY, PM_TEST_SIGNER, type Row } from "./testing.ts";

const M = 60e3, DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();
const at = (s: string) => Date.parse(s);
const cond = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const tok = (n: number, outcome: "yes" | "no") => `${8000000000000000000000000000000000000000000000000000000000000000000n + BigInt(n * 2 + (outcome === "no" ? 1 : 0))}`;
const D2 = at("2026-10-03T00:00:00Z");

// ------------------------------------------------------------------ the figure

Deno.test("sinceOpenPnl, by hand: 100 YES carried at 0.80 and opened at 0.40 count 0 today, not −40; then −26 today and −66 in all; then −36 today and −76 in all", () => {
  const fills: PmFill[] = [{ token: "Y", side: "BUY", price: 0.80, size: 100, ts: D2 - 3600e3 }];
  const day = (m: number) => sinceOpenPnl(fills, D2, { Y: 0.40 }, { Y: m });
  const old = (m: number) => bookPnl(tokenBooks(fills, D2), { Y: m });
  assertEquals([day(0.40), old(0.40)], [0, { day: -40, total: -40 }]);
  assertEquals([day(0.14), old(0.14).total], [-26, -66]);
  assertEquals([day(0.04), old(0.04).total], [-36, -76]);
  // No opening mark: the token starts the day at its cost, the frozen figure.
  assertEquals(sinceOpenPnl(fills, D2, {}, { Y: 0.40 }), -40);
});

Deno.test("sinceOpenPnl, by hand: a buy today counts from its cost, a sell today realises against the day's basis, a settlement today at its payout", () => {
  // 100 YES carried at cost 0.80, opened at 0.40; today 50 more at 0.30, then 60 sold at 0.35, then the market resolves YES.
  const fills: PmFill[] = [
    { token: "Y", side: "BUY", price: 0.80, size: 100, ts: D2 - 3600e3 },
    { token: "Y", side: "BUY", price: 0.30, size: 50, ts: D2 + 3600e3 },
    { token: "Y", side: "SELL", price: 0.35, size: 60, ts: D2 + 2 * 3600e3 },
  ];
  // The day's basis: (100 × 0.40 + 50 × 0.30) / 150 = 0.3666…; the sale realises 60 × (0.35 − 0.3666…) = −1.00; the 90
  // left at a 0.36 mark: 90 × (0.36 − 0.3666…) = −0.60. In value terms: 60 × 0.35 + 90 × 0.36 − 100 × 0.40 − 50 × 0.30 = −1.60.
  assertAlmostEquals(sinceOpenPnl(fills, D2, { Y: 0.40 }, { Y: 0.36 }), -1.6, 1e-9);
  // Settled YES at 1 today (`settlementFills` sells all at the payout): 60 × 0.35 + 90 × 1 − 40 − 15 = 56.
  const settled = [...fills, { token: "Y", side: "SELL" as const, price: 1, size: 1e12, ts: D2 + 3 * 3600e3 }];
  assertAlmostEquals(sinceOpenPnl(settled, D2, { Y: 0.40 }, { Y: null }), 56, 1e-9);
  // A token bought today only is the frozen figure whatever the opening marks say.
  const today: PmFill[] = [{ token: "N", side: "BUY", price: 0.6, size: 10, ts: D2 + 60e3 }];
  assertEquals(sinceOpenPnl(today, D2, { N: 0.1 }, { N: 0.5 }), bookPnl(tokenBooks(today, D2), { N: 0.5 }).day);
});

Deno.test("sinceOpenPnl with no opening marks is the frozen bookPnl day, exactly, over random books", () => {
  let seed = 7;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 400; k++) {
    const fills: PmFill[] = Array.from({ length: 1 + Math.floor(r() * 12) }, () => ({
      token: r() < 0.5 ? "A" : "B", side: r() < 0.6 ? "BUY" as const : "SELL" as const, price: Math.round(r() * 98 + 1) / 100,
      size: Math.round(r() * 40 + 1), ts: D2 + Math.round((r() - 0.5) * 2 * DAY),
    }));
    const marks = { A: r() < 0.9 ? Math.round(r() * 100) / 100 : null, B: Math.round(r() * 100) / 100 };
    assertEquals(sinceOpenPnl(fills, D2, {}, marks), bookPnl(tokenBooks(fills, D2), marks).day, JSON.stringify(fills));
  }
});

Deno.test("dayOpenMarks: kept for the day once taken; at the day's first turn the last marks read before 00:00, else this turn's", () => {
  const now = { Y: 0.5, N: 0.5, Z: null };
  // The first turn of 10-03: the previous turn's marks were read on 10-02, so they are the day's opening marks.
  const first = dayOpenMarks({ marks: { Y: 0.4, N: 0.6 }, marksAt: "2026-10-02T23:59:30.000Z" }, "2026-10-03", D2, now, "2026-10-03T00:00:30.000Z");
  assertEquals(first, { day: "2026-10-03", at: "2026-10-03T00:00:30.000Z", marks: { Y: 0.4, N: 0.6 } });
  // A token the previous turn did not read takes this turn's mark; one with no mark at all is left out (its cost).
  const partial = dayOpenMarks({ marks: { Y: 0.4 }, marksAt: "2026-10-02T23:59:30.000Z" }, "2026-10-03", D2, { ...now, W: 0.2 }, "2026-10-03T00:00:30.000Z");
  assertEquals(partial.marks, { Y: 0.4, N: 0.5, W: 0.2 });
  // Later turns of the day keep what was taken, whatever they read.
  assertEquals(dayOpenMarks({ dayOpen: first, marks: { Y: 0.1 }, marksAt: "2026-10-03T00:00:30.000Z" }, "2026-10-03", D2, { Y: 0.1 }, "2026-10-03T00:01:30.000Z"), first);
  // A state that kept no marks (the first turn after the deploy, a new instance) says nothing of 00:00: no opening mark,
  // and the day counts from cost, as before, even with this turn's marks read.
  assertEquals(dayOpenMarks({}, "2026-10-03", D2, now, "2026-10-03T14:00:30.000Z"), { day: "2026-10-03", at: "2026-10-03T14:00:30.000Z", marks: {} });
  // Marks read today are not the day's opening marks.
  assertEquals(dayOpenMarks({ marks: { Y: 0.1 }, marksAt: "2026-10-03T00:00:30.000Z" }, "2026-10-03", D2, now, "2026-10-03T00:01:30.000Z").marks, {});
});

Deno.test("the deploy's own day counts as before: a path whose state kept no marks takes no opening mark until the next 00:00", async () => {
  const w = pathWorld(PM_LIVE_INSTANCE);
  // Its first turn is on 10-03 (the 10-02 turn is skipped): the 100 YES count from cost all day, −40, as the frozen rule.
  const r = await w.turn(at("2026-10-03T00:00:30Z"));
  assertEquals([r.pnl, r.gates?.openBlockedBy], [{ day: -40, total: -40 }, "loss_day"]);
  // The next day's first turn has the 10-03 marks: from cost no more.
  const n = await w.turn(at("2026-10-04T00:00:30Z"));
  assertEquals([n.pnl, n.gates?.open], [{ day: 0, total: -40 }, true]);
});

Deno.test("no deployed instance runs the frozen day stop: it is the comparisons' alone", () => {
  for (const i of [PM_LIVE_INSTANCE, PM_MINI_INSTANCE, PM_MID_INSTANCE, PM_LP_INSTANCE] as PmLiveInstance[]) assertEquals(i.dayStopOnCost, undefined, i.name);
  for (const i of [PREP_INSTANCE, PREP_MID_INSTANCE, PREP_LP_INSTANCE] as PrepInstance[]) assertEquals(i.dayStopOnCost, undefined, i.name);
});

// ------------------------------------------------------------------ the order path

const CONFIG = {
  id: 1, dry_run: false, live_confirmed_at: "2026-10-01T00:00:00.000Z", ireland_attested_at: "2026-09-30T04:00:00.000Z", ireland_until: null,
  cap_total_usd: 320, cap_market_usd: 60, loss_day_usd: 25, loss_total_usd: 75, max_posts_day: 6000, gtd_lifetime_s: 600, max_markets: 2, select_budget_usd: 40,
};

/**
 * A live path holding 100 YES of X, bought at 0.80 on 10-02 (CONFIRMED), not selected again (X pays no reward): read,
 * marked and never quoted. A ($8 a day, 0.45 / 0.47) is the day's market.
 */
function pathWorld(inst: PmLiveInstance) {
  const clock = { now: at("2026-10-02T23:59:30Z") };
  const pm = new FakePolymarket(() => clock.now);
  const A = pm.addMarket({ cond: cond(1), yes: tok(1, "yes"), no: tok(1, "no"), rate: 8, bid: 0.45, ask: 0.47, minSize: 5, depth: [[0, 5]] });
  const X = pm.addMarket({ cond: cond(2), yes: tok(2, "yes"), no: tok(2, "no"), rate: null, bid: 0.39, ask: 0.41, minSize: 5, depth: [[0, 50]] });
  pm.tokens.set(X.yes, 100);
  pm.pusd = 300;
  const hash = `0x${"ab".repeat(32)}`;
  const mem = memDb({
    agent_locks: [{ name: "pm-live", lease_until: iso(0), holder: null }],
    agent_risk: [{ id: 1, global_pause: false }],
    pm_live_config: [{ ...CONFIG }],
    pm_live_markets: [{
      day: "2026-10-02", kind: "standard", cond: X.cond, yes_token: X.yes, no_token: X.no, neg_risk: false, tick: 0.01, min_size: 5, reward_rate: 8, rank: 1,
      question: null, detail: {}, selected_at: "2026-10-02T00:00:30.000Z", max_spread: 4.5, n_size: 5, per_dollar_day: null, capital: null, formula_day: null,
      end_date: null, game_start: null,
    }],
    pm_live_orders: [{
      id: 1, ts: "2026-10-02T12:00:00.000Z", mode: "live", cond: X.cond, token: X.yes, outcome: "yes", side: "BUY", price: 0.8, size: 100, order_type: "GTD",
      post_only: true, expiration: 1, neg_risk: false, hash, state: "filled", size_matched: 100, gate: "open", reason: "new", book_seen: null, request: null,
      response: null, cancel_requested_at: null, cancel_gate: null, cancel_reason: null, filled_at: "2026-10-02T12:00:05.000Z", cancelled_at: null, updated_at: "2026-10-02T12:00:05.000Z",
    }],
    pm_live_fills: [{
      trade_id: "t-1", hash, cond: X.cond, token: X.yes, side: "BUY", price: 0.8, size: 100, status: "CONFIRMED", match_time: "2026-10-02T12:00:05.000Z",
      tx_hash: null, detail: {}, updated_at: "2026-10-02T12:00:05.000Z",
    }],
    pm_live_events: [], pm_live_state: [], pm_live_minutes: [], pm_live_reward_days: [], pm_live_settlements: [],
  }, { now: () => clock.now });
  const db = onlyTables(mem.db, PM_LIVE_DB_TABLES, { lease: "pm-live", readOnly: ["agent_risk"] });
  const key = new PmOrderKey(PM_TEST_KEY);
  let salt = 1;
  return {
    pm, mem, A, X,
    turn: (t: number) => {
      clock.now = t;
      return runPmLive({
        db, now: t, holder: `h${t}`, venue: pm.venue(), sbRegion: "eu-west-1", sendsEnabled: true, account: { maker: PM_TEST_FUNDER, signer: PM_TEST_SIGNER },
        signer: key, salt: () => String(salt++), pause: () => Promise.resolve(), clock: () => clock.now, inst,
      });
    },
    stops: () => (mem.tables.pm_live_events as Row[]).filter((e) => String(e.kind).startsWith("loss_stop")).map((e) => [e.kind, e.minute, e.detail]),
  };
}

Deno.test("the path: 100 YES carried at a $40 loss at the day's opening mark do not trip the $25 day stop at 00:00 or 00:01; a fresh $26 loss does; the total trips past −$75 on the carried loss", async () => {
  const w = pathWorld(PM_LIVE_INSTANCE);
  // 10-02 23:59: X at 0.39 / 0.41, the 100 YES −40 from their cost of 0.80. Bought that day: −40 today too, its stop trips.
  let r = await w.turn(at("2026-10-02T23:59:30Z"));
  assertEquals([r.pnl, r.gates?.openBlockedBy], [{ day: -40, total: -40 }, "loss_day"]);
  // 10-03 00:00 and 00:01: the same book. The day began at 0.40, so the day is 0; the path opens.
  for (const t of ["2026-10-03T00:00:30Z", "2026-10-03T00:01:30Z"]) {
    r = await w.turn(at(t));
    assertEquals([r.pnl, r.gates?.open], [{ day: 0, total: -40 }, true], t);
  }
  assertEquals(w.stops().filter(([, m]) => String(m) >= "2026-10-03").length, 0);
  assert(w.pm.calls.some((c) => c.startsWith("POST clob.polymarket.com/order")), "it quotes A on 10-03");
  // 10:00: X falls to 0.13 / 0.15: 100 × (0.14 − 0.40) = −26 today, past −25; −66 in all.
  w.X.bid = 0.13; w.X.ask = 0.15;
  r = await w.turn(at("2026-10-03T10:00:30Z"));
  assertEquals([r.pnl, r.gates?.openBlockedBy], [{ day: -26, total: -66 }, "loss_day"]);
  // 10:01: 0.03 / 0.05: −36 today, −76 in all, past −75.
  w.X.bid = 0.03; w.X.ask = 0.05;
  r = await w.turn(at("2026-10-03T10:01:30Z"));
  assertEquals([r.pnl, r.gates?.openBlockedBy], [{ day: -36, total: -76 }, "loss_day"]);
  assertEquals(w.stops(), [
    ["loss_stop_day", "2026-10-02T23:59:00.000Z", { dayPnl: -40, limit: -25, since: "2026-10-02T23:59:30.000Z", onCost: -40 }],
    ["loss_stop_day", "2026-10-03T10:00:00.000Z", { dayPnl: -26, limit: -25, since: "2026-10-03T00:00:30.000Z", onCost: -66 }],
    ["loss_stop_total", "2026-10-03T10:01:00.000Z", { totalPnl: -76, limit: -75 }],
  ]);
  // The opening marks it kept: the 23:59 turn's, the last read before 00:00.
  const st = (w.mem.tables.pm_live_state as Row[])[0].state as { dayOpen: { day: string; marks: Record<string, number> } };
  assertEquals(st.dayOpen.day, "2026-10-03");
  assertAlmostEquals(st.dayOpen.marks[w.X.yes], 0.40, 1e-12);

  // The counterfactual, the frozen rule on the same turns: the carried −40 trips the day stop at 00:00.
  const old = pathWorld({ ...PM_LIVE_INSTANCE, dayStopOnCost: true });
  await old.turn(at("2026-10-02T23:59:30Z"));
  const o = await old.turn(at("2026-10-03T00:00:30Z"));
  assertEquals([o.pnl, o.gates?.openBlockedBy], [{ day: -40, total: -40 }, "loss_day"]);
  assertEquals(old.stops().filter(([, m]) => String(m) >= "2026-10-03"), [["loss_stop_day", "2026-10-03T00:00:00.000Z", { dayPnl: -40, limit: -25 }]]);
});

Deno.test("the path as mini-pool's action runs it (PM_MINI_INSTANCE) keeps the same day stop; mid-pool's is pinned in pm_mid_formula.test.ts", async () => {
  // Mini-pool's instance is the default with its book-quality rule; mid-pool's names other tables, so its pin is
  // pm_mid_formula.test.ts's deviation 4, on its own simulated days.
  const w = pathWorld(PM_MINI_INSTANCE);
  await w.turn(at("2026-10-02T23:59:30Z"));
  const r = await w.turn(at("2026-10-03T00:00:30Z"));
  assertEquals(r.pnl, { day: 0, total: -40 });
  assertEquals(w.stops().filter(([, m]) => String(m) >= "2026-10-03"), []);
});

// ------------------------------------------------------------------ the paper layer

const PCONFIG = { ...CONFIG, dry_run: true, live_confirmed_at: null };
const c = cond(9);
/** A row of the path's dry-run record (`pm_live_minutes`) with book `row`: [bb, ba, ab, aa, q1, q2]. */
const minute = (t: number, row: [number, number, number, number, number, number]): Row => ({
  mode: "dry_run", minute: iso(t), cond: c, rate: 8, max_spread: 4.5, min_size: 50, tick: 0.01, bb: row[0], ba: row[1], ab: row[2], aa: row[3], q1: row[4], q2: row[5],
  bid_price: null, bid_size: null, ask_price: null, ask_size: null, bid_scoring: null, ask_scoring: null, ours: 0, others: 0, formula_usd: 0, pct: null, detail: {},
});
let orderId = 1;
const order = (outcome: "yes" | "no", price: number, placed: number, ended: number): Row => ({
  id: orderId++, ts: iso(placed + 2500), mode: "dry_run", cond: c, token: `${c}-${outcome === "yes" ? "Y" : "N"}`, outcome, side: "BUY", price, size: 50, order_type: "GTD",
  post_only: true, expiration: Math.floor(placed / 1000) + 660, neg_risk: false, hash: `0x${String(orderId).padStart(64, "0")}`, state: "cancelled", size_matched: 0,
  gate: "open", reason: "new", book_seen: { minSize: 50 }, request: { timestamp: String(placed + 1500) }, response: { dryRun: true },
  cancel_requested_at: iso(ended + 1200), cancel_gate: "reprice", cancel_reason: null, filled_at: null, cancelled_at: iso(ended + 1200), updated_at: iso(placed),
});
const market = (day: string): Row => ({
  day, kind: "standard", cond: c, yes_token: `${c}-Y`, no_token: `${c}-N`, neg_risk: false, tick: 0.01, min_size: 50, reward_rate: 8, rank: 1, question: null, detail: {},
  selected_at: `${day}T00:00:30.000Z`, max_spread: 4.5, n_size: 50, per_dollar_day: null, capital: null, formula_day: null, end_date: null, game_start: null,
});
/** Polymarket's public prints of `c`, as the data API lists them; every other read answers nothing. */
function prints(list: Array<[number, "BUY" | "SELL", number, number]>): typeof fetch {
  return (input: string | URL | Request) => {
    const u = new URL(String(input));
    if (u.host === "data-api.polymarket.com" && u.pathname === "/v2/trades") {
      const rows = u.searchParams.get("condition") === c ? list.slice().sort((a, b) => b[0] - a[0]).map(([ts, side, price, size], i) => ({
        timestamp: ts, side, outcome_index: 0, price, size, token_id: `${c.slice(-6)}0`, transaction_hash: `0x${ts}${i}`, proxy_wallet: "0xabc",
      })) : [];
      return Promise.resolve(new Response(JSON.stringify({ data: rows, pagination: { next_cursor: "" } }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ markets: [] }), { status: 200 }));
  };
}

/**
 * The paper's day, by hand. N 50. 10-02 23:56–23:57: the book 0.80 / 0.82; the path rests RW's quote (BUY YES 0.80 and
 * BUY NO 0.18, 50 each) and a SELL of YES at 0.79 × 50 each minute fills the bid: 100 YES at 0.80. 23:58: the book falls
 * to 0.39 / 0.41; the path rests nothing more (dark); at the 0.40 mid the 100 are −40 from cost, bought that day, so
 * 10-02's day stop trips at 23:58. 10-03 00:00, 00:01: 0.40 still, the day's opening mark: 0 today. 00:02: 0.14,
 * 100 × (0.14 − 0.40) = −26 today, past −25 (−66 in all). 00:03: 0.04, −76 in all, past −75.
 */
function paperWorld(inst?: PrepInstance) {
  const t = (s: string) => at(s);
  const hi: [number, number, number, number, number, number] = [0.80, 0.82, 0.80, 0.82, 100, 100];
  const book = (m: number): [number, number, number, number, number, number] => [m - 0.01, m + 0.01, m - 0.01, m + 0.01, 100, 100];
  const minutes = [
    minute(t("2026-10-02T23:56:00Z"), hi), minute(t("2026-10-02T23:57:00Z"), hi),
    minute(t("2026-10-02T23:58:00Z"), book(0.40)), minute(t("2026-10-02T23:59:00Z"), book(0.40)),
    minute(t("2026-10-03T00:00:00Z"), book(0.40)), minute(t("2026-10-03T00:01:00Z"), book(0.40)),
    minute(t("2026-10-03T00:02:00Z"), book(0.14)), minute(t("2026-10-03T00:03:00Z"), book(0.04)),
  ];
  const orders = [order("yes", 0.80, t("2026-10-02T23:56:00Z"), t("2026-10-02T23:58:00Z")), order("no", 0.18, t("2026-10-02T23:56:00Z"), t("2026-10-02T23:58:00Z"))];
  const s = (x: string) => Math.floor(t(x) / 1000);
  const fetchImpl = prints([[s("2026-10-02T23:56:05Z"), "SELL", 0.79, 50], [s("2026-10-02T23:57:05Z"), "SELL", 0.79, 50]]);
  const from = t("2026-10-02T23:56:00Z");
  const start: PrepState = {
    version: 1, startedAt: iso(from), lastDecided: from - M, dayOf: Math.floor(from / DAY) * DAY, statusAt: 0, acc: {}, tokens: {}, marks: {},
    stopDay: null, stopTotal: null, day: { reward: 0, fills: 0, matched: 0, dark: 0, diverged: 0, missing: 0, markets: [] }, pnl: null,
  };
  const mem = memDb({
    agent_locks: [{ name: PREP_LOCK, lease_until: iso(0), holder: null }],
    pm_live_config: [{ ...PCONFIG }], pm_live_markets: [market("2026-10-02"), market("2026-10-03")], pm_live_minutes: minutes, pm_live_orders: orders,
    pm_prep_state: [{ id: 1, state: start, last_minute: null, updated_at: iso(0), last_error: null }],
    pm_prep_minutes: [], pm_prep_prints: [], pm_prep_fills: [], pm_prep_days: [], pm_prep_settlements: [], pm_prep_events: [],
  }, { now: () => 0 });
  const db = onlyTables(mem.db, PREP_DB_TABLES, { lease: PREP_LOCK, readOnly: PREP_READS });
  return {
    mem,
    run: (now: number, holder: string) => runPmPrep({ db, now, holder, pm: { fetchImpl }, ...(inst ? { inst } : {}) }),
    events: () => (mem.tables.pm_prep_events as Row[]).map((e) => [e.kind, e.minute, e.detail]),
    state: () => (mem.tables.pm_prep_state as Row[])[0].state as PrepState,
  };
}

Deno.test("the paper layer: the same carried $40 does not trip the $25 day stop at 00:00 or 00:01; a fresh $26 loss does; the total trips past −$75", async () => {
  const w = paperWorld();
  // Decide to 10-03 00:01 (two minutes behind the clock): the opening marks taken, no stop on 10-03.
  let r = await w.run(at("2026-10-03T00:03:30Z"), "a");
  assertEquals(r.errors, []);
  assertEquals(r.fills, 2);
  assertEquals([w.state().open, w.state().pnl], [{ day: "2026-10-03", marks: { [c]: 0.40 } }, { at: "2026-10-03T00:01:00.000Z", day: 0, total: -40 }]);
  assertEquals(w.events(), [["loss_stop_day", "2026-10-02T23:58:00.000Z", { dayPnl: -40, limit: -25 }]]);
  // Then 00:02 and 00:03.
  r = await w.run(at("2026-10-03T00:05:30Z"), "b");
  assertEquals(r.errors, []);
  assertEquals(w.events(), [
    ["loss_stop_day", "2026-10-02T23:58:00.000Z", { dayPnl: -40, limit: -25 }],
    ["loss_stop_day", "2026-10-03T00:02:00.000Z", { dayPnl: -26, limit: -25, since: "2026-10-03T00:00:00.000Z", onCost: -66 }],
    ["loss_stop_total", "2026-10-03T00:03:00.000Z", { totalPnl: -76, limit: -75 }],
  ]);
  assertEquals([w.state().stopDay, w.state().stopTotal, w.state().pnl], ["2026-10-03", "2026-10-03T00:03:00.000Z", { at: "2026-10-03T00:03:00.000Z", day: -36, total: -76 }]);
  // 10-02's row closed with the frozen columns; the layer had no opening marks for 10-02 (it began at 23:56), so no
  // `dayChange`. 10-03's row, closed by the runs past its end: −76 on cost (`fills_pnl_day`), −36 since 00:00.
  for (let k = 0; k < 8 && (w.mem.tables.pm_prep_days as Row[]).length < 2; k++) await w.run(at("2026-10-04T00:03:30Z") + k * 1e3, `c${k}`);
  const days = (w.mem.tables.pm_prep_days as Row[]).map((d) => [d.day, Number(d.fills_pnl_day), Number(d.fills_pnl_total), (d.detail as Row).dayChange, d.stop_day, d.stop_total]);
  assertEquals(days, [["2026-10-02", -40, -40, undefined, true, false], ["2026-10-03", -76, -76, -36, true, true]]);
  // The figure is paperDayPnl's, which is the path's sinceOpenPnl on the paper's fills.
  const fills = (w.mem.tables.pm_prep_fills as Row[]).map((f): PrepFill => ({
    cond: String(f.cond), minute: at(String(f.minute)), printId: String(f.print_id), ts: at(String(f.ts)), side: f.side as "bid", price: Number(f.price),
    size: Number(f.size), token: String(f.token), tokenSide: f.token_side as "BUY", tokenPrice: Number(f.token_price), closeOnly: !!f.close_only,
  }));
  const tokens = { [c]: { yes: `${c}-Y`, no: `${c}-N` } };
  assertEquals(paperDayPnl(fills, [], tokens, { [c]: 0.14 }, { [c]: 0.40 }, D2), -26);
  assertEquals(paperPnl(fills, [], tokens, { [c]: 0.14 }, D2).day, -66);
});

Deno.test("the paper layer, the counterfactual: on the frozen rule the carried −$40 trips the day stop at 10-03 00:00", async () => {
  const w = paperWorld({ ...PREP_INSTANCE, dayStopOnCost: true });
  const r = await w.run(at("2026-10-03T00:03:30Z"), "a");
  assertEquals(r.errors, []);
  assertEquals(w.events(), [
    ["loss_stop_day", "2026-10-02T23:58:00.000Z", { dayPnl: -40, limit: -25 }],
    ["loss_stop_day", "2026-10-03T00:00:00.000Z", { dayPnl: -40, limit: -25 }],
  ]);
  assertEquals(w.state().open, undefined);
});
