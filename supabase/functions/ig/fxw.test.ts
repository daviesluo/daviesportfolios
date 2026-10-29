// Pins for "FXW-AUD weekend" on paper (fxw.ts): every case's figures worked by hand in its comment.
// Run: deno test --allow-env supabase/functions/
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  FINAL, FXW, fundingGbp, fundingNights, fxwFridays, fxwWeekend, marginGbp, pnlGbp, positionValueGbp, type QuoteRow, runFxw, weekendTimes,
} from "./fxw.ts";
import type { Rest } from "./actions.ts";

// The first weekend: Friday 2026-10-30. The UK is on GMT from 2026-10-25, so UK time is UTC here.
const F = "2026-10-30";
const T = (s: string) => Date.parse(s);
const q = (ts: string, bid: number | null, offer: number | null, status = "TRADEABLE", until = ts): QuoteRow =>
  ({ ts: new Date(T(ts)).toISOString(), seen_until: new Date(T(until)).toISOString(), bid, offer, market_status: status });

/** Friday's last tradable quote (mid 0.66000), then the CLOSED quote the recorder holds to Sunday's open. */
const FRIDAY = [
  q("2026-10-30T21:50:00Z", 0.6601, 0.6603, "TRADEABLE", "2026-10-30T21:57:30Z"),
  q("2026-10-30T21:58:00Z", 0.6599, 0.6601, "TRADEABLE", "2026-10-30T21:59:30Z"),
  q("2026-10-30T22:00:10Z", 0.6599, 0.6601, "CLOSED", "2026-11-01T21:00:00Z"),
];

Deno.test("fxw: the constants are the recommendation's and the frozen rule's", () => {
  assertEquals([FXW.fundedGbp, FXW.stakeGbp, FXW.minStakeGbp, FXW.marginRate, FXW.closeOutShare, FXW.signalBps], [1000, 1.5, 0.5, 0.05, 0.5, 20]);
  assertEquals([FXW.horizonMs, FXW.fundingBpsNight, FXW.startFriday], [86_400_000, 0.22, "2026-10-30"]);
  // The weekend's instants, UK time (GMT that weekend).
  const w = weekendTimes(F);
  assertEquals([w.start, w.friClose, w.open, w.recEnd].map((x) => new Date(x).toISOString()), [
    "2026-10-30T21:35:00.000Z", "2026-10-30T22:00:00.000Z", "2026-11-01T21:00:00.000Z", "2026-11-02T22:05:00.000Z",
  ]);
  // In summer time the same wall clock is an hour earlier in UTC (Friday 2027-04-02).
  assertEquals(new Date(weekendTimes("2027-04-02").open).toISOString(), "2027-04-04T20:00:00.000Z");
  assertEquals(fxwFridays(T("2026-10-30T21:34:59Z")), []);
  assertEquals(fxwFridays(T("2026-10-30T21:35:00Z")), [F]);
  assertEquals(fxwFridays(T("2026-11-13T22:00:00Z")), [F, "2026-11-06", "2026-11-13"]);
});

Deno.test("fxw: the money arithmetic, by hand", () => {
  // GBP 1.50 a pip at 0.6580: the position is worth 1.5 x 6,580 pips = GBP 9,870; margin 5 % = GBP 493.50.
  assert(Math.abs(positionValueGbp(1.5, 0.658) - 9870) < 1e-6);
  assert(Math.abs(marginGbp(1.5, 0.658) - 493.5) < 1e-6);
  // Long 0.65800 to 0.66000 is +20 pips, x 1.5 = +GBP 30; short 0.66180 to 0.66100 is +8 pips, x 1.5 = +GBP 12.
  assert(Math.abs(pnlGbp(1, 0.658, 0.66, 1.5) - 30) < 1e-9);
  assert(Math.abs(pnlGbp(-1, 0.6618, 0.661, 1.5) - 12) < 1e-9);
  assert(Math.abs(pnlGbp(-1, 0.6618, 0.6625, 1.5) + 10.5) < 1e-9);
});

Deno.test("fxw: funding nights are the weekday 22:00s held through, Friday's three, Sunday's none (search.py's fxw)", () => {
  // Sunday 21:00 to Monday 21:00: no 22:00 that is a funding time (Sunday's is not). The research's case: no funding.
  assertEquals(fundingNights(T("2026-11-01T21:00:05Z"), T("2026-11-02T21:00:05Z")), 0);
  // Held through Monday 22:00 (inclusive at the instant): one night.
  assertEquals(fundingNights(T("2026-11-01T21:00:05Z"), T("2026-11-02T22:00:00Z")), 1);
  // Held through a Friday 22:00: three nights; Thursday 21:00 to Monday 23:00: Thursday 1 + Friday 3 + Monday 1 = 5.
  assertEquals(fundingNights(T("2026-10-30T21:00:00Z"), T("2026-11-02T21:00:00Z")), 3);
  assertEquals(fundingNights(T("2026-10-29T21:00:00Z"), T("2026-11-02T23:00:00Z")), 5);
  // In summer time 22:00 UK is 21:00 UTC: Monday 2027-04-05 21:00 UTC is the funding instant.
  assertEquals(fundingNights(T("2027-04-04T20:00:00Z"), T("2027-04-05T20:59:59Z")), 0);
  assertEquals(fundingNights(T("2027-04-04T20:00:00Z"), T("2027-04-05T21:00:00Z")), 1);
  // One night on GBP 1.50 a pip at 0.6600: 0.22 bps of 1.5 x 6,600 = 9,900 = GBP 0.2178.
  assert(Math.abs(fundingGbp(1, 1.5, 0.66) - 0.2178) < 1e-9);
});

Deno.test("fxw: a fall fills long at the decision quote's offer and exits at the first bid that reaches Friday's mid", () => {
  const quotes = [
    ...FRIDAY,
    // Sunday 21:00:05: bid 0.65780, offer 0.65800, mid 0.65790. Gap ln(0.6579 / 0.66) = -31.87 bps: long at 0.65800.
    q("2026-11-01T21:00:05Z", 0.6578, 0.658, "TRADEABLE", "2026-11-01T21:30:00Z"),
    // On the way: bid 0.65900 is under the mid 0.66000, no exit.
    q("2026-11-01T22:00:00Z", 0.659, 0.6592, "TRADEABLE", "2026-11-01T23:00:00Z"),
    // An EDITS_ONLY quote whose bid is above the mid is not a fill.
    q("2026-11-01T23:05:00Z", 0.6605, 0.6607, "EDITS_ONLY"),
    // Sunday 23:10: bid 0.66000 reaches the mid: exit at 0.66000. +20 pips x 1.5 = +GBP 30.00, no funding night.
    q("2026-11-01T23:10:00Z", 0.66, 0.6602),
    q("2026-11-01T23:20:00Z", 0.6605, 0.6607),
  ];
  const w = fxwWeekend({ friday: F, quotes, equityBefore: 1000, nowMs: T("2026-11-02T08:00:00Z") });
  assertEquals(w.status, "closed");
  assertEquals([w.fri_ts, w.fri_bid, w.fri_offer, w.fri_mid], ["2026-10-30T21:58:00.000Z", 0.6599, 0.6601, 0.66]);
  assertEquals([w.dec_ts, w.dec_bid, w.dec_offer, w.gap_bps], ["2026-11-01T21:00:05.000Z", 0.6578, 0.658, -31.87]);
  assertEquals([w.side, w.stake_gbp, w.entry_price, w.margin_gbp], ["long", 1.5, 0.658, 493.5]);
  assertEquals([w.exit_ts, w.exit_bid, w.exit_offer, w.exit_price, w.exit_reason], ["2026-11-01T23:10:00.000Z", 0.66, 0.6602, 0.66, "target: Friday's mid"]);
  assertEquals([w.pnl_gbp, w.funding_gbp, w.net_gbp, w.equity_before], [30, 0, 30, 1000]);
  // Closed on Sunday, read on Monday: no midnight mark (it closed before the midnight the page reads TODAY from).
  assertEquals(w.midnight_price, null);
});

Deno.test("fxw: a rise fills short at the bid and, never reaching the mid, exits at the first offer at or after +24 h", () => {
  const quotes = [
    ...FRIDAY,
    // Bid 0.66180, offer 0.66200, mid 0.66190: gap ln(0.6619 / 0.66) = +28.75 bps: short at 0.66180, margin 0.075 x 6,618 = 496.35.
    q("2026-11-01T21:00:05Z", 0.6618, 0.662),
    // Sunday 23:30, the mark at Monday's midnight: offer 0.66170.
    q("2026-11-01T23:30:00Z", 0.6615, 0.6617),
    // Monday 10:00: offer 0.66120 is above the mid 0.66000, no exit.
    q("2026-11-02T10:00:00Z", 0.661, 0.6612),
    // Monday 21:00:05, +24 h exactly: exit at the offer 0.66100. +8 pips x 1.5 = +GBP 12.00; no 22:00 crossed, no funding.
    q("2026-11-02T21:00:05Z", 0.6608, 0.661),
  ];
  const w = fxwWeekend({ friday: F, quotes, equityBefore: 1030, nowMs: T("2026-11-02T21:05:00Z") });
  assertEquals([w.status, w.side, w.entry_price, w.margin_gbp, w.gap_bps], ["closed", "short", 0.6618, 496.35, 28.75]);
  assertEquals([w.exit_price, w.exit_reason, w.pnl_gbp, w.funding_gbp, w.net_gbp, w.equity_before], [0.661, "24 h", 12, 0, 12, 1030]);
  // Closed today (Monday), opened before its midnight: the midnight mark is Sunday 23:30's offer, 0.66170.
  assertEquals([w.midnight_ts, w.midnight_price], ["2026-11-01T23:30:00.000Z", 0.6617]);
  // With no quote between the entry and midnight, the mark at midnight is the decision quote's own exit side, its offer 0.66200.
  const bare = fxwWeekend({ friday: F, quotes: quotes.filter((r) => !r.ts.startsWith("2026-11-01T23:30")), equityBefore: 1030, nowMs: T("2026-11-02T21:05:00Z") });
  assertEquals([bare.midnight_ts, bare.midnight_price], ["2026-11-01T21:00:05.000Z", 0.662]);
});

Deno.test("fxw: an open position is marked at its last tradable quote's exit side; a gap under 20 bps trades nothing", () => {
  const quotes = [...FRIDAY, q("2026-11-01T21:00:05Z", 0.6578, 0.658), q("2026-11-01T22:00:00Z", 0.659, 0.6592)];
  // Sunday 22:30: long from 0.65800, marked at the bid 0.65900: +10 pips x 1.5 = +GBP 15.
  const w = fxwWeekend({ friday: F, quotes, equityBefore: 1000, nowMs: T("2026-11-01T22:30:00Z") });
  assertEquals([w.status, w.mark_ts, w.mark_price, w.pnl_gbp, w.funding_gbp, w.net_gbp], ["open", "2026-11-01T22:00:00.000Z", 0.659, 15, 0, 15]);
  // Mid 0.65950: ln(0.6595 / 0.66) = -7.58 bps: no trade.
  const small = fxwWeekend({ friday: F, quotes: [...FRIDAY, q("2026-11-01T21:00:05Z", 0.6594, 0.6596)], equityBefore: 1000, nowMs: T("2026-11-02T08:00:00Z") });
  assertEquals([small.status, small.reason, small.gap_bps, small.entry_price], ["no_trade", "the gap was -7.6 bps, under 20", -7.58, null]);
});

Deno.test("fxw: a minute after the open with no recorded quote makes the entry MISSED, not filled late", () => {
  // The recorder's last quote before the open was seen at 20:55; the next quote is at 21:06. At 21:00 the newest quote is
  // five minutes old (Deviation 1 allows two): missed, whatever comes at 21:06.
  const gap = [
    ...FRIDAY.slice(0, 2), q("2026-10-30T22:00:10Z", 0.6599, 0.6601, "CLOSED", "2026-11-01T20:55:00Z"),
    q("2026-11-01T21:06:00Z", 0.6578, 0.658),
  ];
  const w = fxwWeekend({ friday: F, quotes: gap, equityBefore: 1000, nowMs: T("2026-11-02T08:00:00Z") });
  assertEquals([w.status, w.entry_price, w.side], ["missed", null, null]);
  assertEquals(w.reason, "missed: no quote was recorded at 21:00 UK, so the first tradable quote after the open is not known");
  // Covered to 20:58 (two minutes before 21:00) and the first tradable quote at 21:00:05: filled.
  const ok = [...FRIDAY.slice(0, 2), q("2026-10-30T22:00:10Z", 0.6599, 0.6601, "CLOSED", "2026-11-01T20:58:00Z"), q("2026-11-01T21:00:05Z", 0.6578, 0.658)];
  assertEquals(fxwWeekend({ friday: F, quotes: ok, equityBefore: 1000, nowMs: T("2026-11-01T21:30:00Z") }).status, "open");
  // A market that opens late is not a gap while the recorder holds its CLOSED quote: covered every minute to 21:20.
  const late = [...FRIDAY.slice(0, 2), q("2026-10-30T22:00:10Z", 0.6599, 0.6601, "CLOSED", "2026-11-01T21:20:00Z"), q("2026-11-01T21:20:30Z", 0.6578, 0.658)];
  const l = fxwWeekend({ friday: F, quotes: late, equityBefore: 1000, nowMs: T("2026-11-01T21:30:00Z") });
  assertEquals([l.status, l.dec_ts], ["open", "2026-11-01T21:20:30.000Z"]);
});

Deno.test("fxw: margin: no entry the equity cannot margin; IG's close-out at half the margin, at that quote", () => {
  const quotes = [...FRIDAY, q("2026-11-01T21:00:05Z", 0.6578, 0.658)];
  // Margin GBP 493.50 on GBP 400 of equity: no entry.
  const poor = fxwWeekend({ friday: F, quotes, equityBefore: 400, nowMs: T("2026-11-01T21:30:00Z") });
  assertEquals([poor.status, poor.reason], ["no_trade", "the equity, £400.00, cannot margin £493.50"]);
  // GBP 600 of equity: close-out when 600 + P&L < 246.75. Bid 0.63500: -230 pips x 1.5 = -345, equity 255, not yet.
  // Bid 0.63400: -240 pips x 1.5 = -360, equity 240 < 246.75: closed out at 0.63400.
  const fall = [...quotes, q("2026-11-02T02:00:00Z", 0.635, 0.6352), q("2026-11-02T03:00:00Z", 0.634, 0.6342), q("2026-11-02T04:00:00Z", 0.66, 0.6602)];
  const w = fxwWeekend({ friday: F, quotes: fall, equityBefore: 600, nowMs: T("2026-11-02T08:00:00Z") });
  assertEquals([w.status, w.exit_ts, w.exit_price, w.exit_reason, w.net_gbp], ["closed", "2026-11-02T03:00:00.000Z", 0.634, "margin close-out", -360]);
});

Deno.test("fxw: before Friday's close it is pending, before Sunday's open waiting; under IG's minimum stake it refuses", () => {
  assertEquals(fxwWeekend({ friday: F, quotes: FRIDAY, equityBefore: 1000, nowMs: T("2026-10-30T21:59:00Z") }).status, "pending");
  const w = fxwWeekend({ friday: F, quotes: FRIDAY, equityBefore: 1000, nowMs: T("2026-10-31T12:00:00Z") });
  assertEquals([w.status, w.fri_mid], ["waiting", 0.66]);
  // No tradable Friday quote from 21:35 UK (a quote from 21:30 does not count): no trade.
  const early = fxwWeekend({ friday: F, quotes: [q("2026-10-30T21:30:00Z", 0.6599, 0.6601)], equityBefore: 1000, nowMs: T("2026-10-31T12:00:00Z") });
  assertEquals(early.status, "no_trade");
  assertThrows(() => fxwWeekend({ friday: F, quotes: FRIDAY, equityBefore: 1000, nowMs: T("2026-10-31T12:00:00Z"), stake: 0.4 }), Error, "minimum");
  assert(FINAL.has("closed") && FINAL.has("missed") && FINAL.has("no_trade") && !FINAL.has("open") && !FINAL.has("waiting"));
});

Deno.test("fxw: a position the recorder never saw reach an exit closes at its last recorded quote when the window ends", () => {
  // The market opens at 22:30 Sunday (covered by the CLOSED quote): +24 h is Monday 22:30, after the recorder stops at 22:05.
  const quotes = [
    ...FRIDAY.slice(0, 2), q("2026-10-30T22:00:10Z", 0.6599, 0.6601, "CLOSED", "2026-11-01T22:30:00Z"),
    q("2026-11-01T22:30:10Z", 0.6578, 0.658), q("2026-11-02T22:04:30Z", 0.659, 0.6592),
  ];
  const w = fxwWeekend({ friday: F, quotes, equityBefore: 1000, nowMs: T("2026-11-02T22:10:00Z") });
  // Long 0.65800 to 0.65900: +GBP 15; held through Monday 22:00, one night: 0.22 bps of 1.5 x 6,580 = GBP 0.21714, 0.22.
  assertEquals([w.status, w.exit_price, w.exit_reason, w.pnl_gbp, w.funding_gbp, w.net_gbp], [
    "closed", 0.659, "the recorder's window ended: its last recorded quote", 15, 0.22, 14.78,
  ]);
});

/** A fake database with what the run reads and writes: eq, gte and lt filters, order by ts, upsert on a key. */
function fakeDb(quotes: (QuoteRow & Record<string, unknown>)[]) {
  const tables: Record<string, Record<string, unknown>[]> = {
    ig_quotes: quotes, ig_fxw_weekends: [], ig_fxw_state: [],
    ig_facts: [{ id: 9, environment: "live", account_kind: "sb", account_id: "LIVESB", ok: true, selected: { fx_audusd: "CS.D.AUDUSD.TODAY.IP" } }],
  };
  const reads: string[] = [];
  const rest: Rest = {
    insert: () => Promise.resolve(),
    select<T>(table: string, query: string, limit?: number): Promise<T[]> {
      reads.push(`${table}?${query}`);
      let rows = [...(tables[table] ?? [])];
      for (const [k, v] of new URLSearchParams(query)) {
        if (v.startsWith("eq.")) rows = rows.filter((r) => String(r[k]) === v.slice(3));
        if (v.startsWith("gte.")) rows = rows.filter((r) => Date.parse(String(r[k])) >= Date.parse(v.slice(4)));
        if (v.startsWith("lt.")) rows = rows.filter((r) => Date.parse(String(r[k])) < Date.parse(v.slice(3)));
      }
      if (/order=id\.desc/.test(query)) rows.sort((a, b) => Number(b.id) - Number(a.id));
      return Promise.resolve((limit ? rows.slice(0, limit) : rows) as T[]);
    },
    rpc: () => Promise.resolve(0 as never),
    upsert(table, row, key) {
      const t = (tables[table] ??= []);
      const i = t.findIndex((r) => r[key] === row[key]);
      if (i >= 0) t[i] = { ...t[i], ...row };
      else t.push({ ...row });
      return Promise.resolve();
    },
  };
  return { rest, tables, reads };
}

Deno.test("fxw run: reads the live spread-bet AUD/USD quotes only, chains the equity, and never rewrites a final weekend", async () => {
  const live = (r: QuoteRow, extra: Record<string, unknown> = {}) => ({ ...r, environment: "live", account_kind: "sb", epic: "CS.D.AUDUSD.TODAY.IP", ...extra });
  const quotes = [
    ...FRIDAY.map((r) => live(r)),
    live(q("2026-11-01T21:00:05Z", 0.6578, 0.658)), live(q("2026-11-01T23:10:00Z", 0.66, 0.6602)),
    // A demo quote and a CFD quote that would fill at another price: never read.
    live(q("2026-11-01T21:00:01Z", 0.64, 0.6402), { environment: "demo" }), live(q("2026-11-01T21:00:02Z", 0.64, 0.6402), { account_kind: "cfd" }),
    // The second weekend (Friday 2026-11-06): mid 0.66000 again, the same long, exit +GBP 30 again.
    live(q("2026-11-06T21:58:00Z", 0.6599, 0.6601)), live(q("2026-11-06T22:00:10Z", 0.6599, 0.6601, "CLOSED", "2026-11-08T21:00:00Z")),
    live(q("2026-11-08T21:00:05Z", 0.6578, 0.658)), live(q("2026-11-09T01:00:00Z", 0.66, 0.6602)),
  ];
  const db = fakeDb(quotes);
  // Before the start: nothing to do, the state row says it ran.
  const before = await runFxw({ rest: db.rest, now: () => T("2026-10-30T12:00:00Z") });
  assertEquals([before.weekends, before.error, db.tables.ig_fxw_weekends.length, db.tables.ig_fxw_state.length], [{}, null, 0, 1]);
  const a = await runFxw({ rest: db.rest, now: () => T("2026-11-02T08:00:00Z") });
  assertEquals(a.weekends, { [F]: "closed" });
  const w1 = db.tables.ig_fxw_weekends[0];
  assertEquals([w1.entry_price, w1.exit_price, w1.net_gbp, w1.epic, w1.account_id], [0.658, 0.66, 30, "CS.D.AUDUSD.TODAY.IP", "LIVESB"]);
  assert(db.reads.filter((r) => r.startsWith("ig_quotes?")).every((r) => r.includes("environment=eq.live&account_kind=eq.sb&epic=eq.CS.D.AUDUSD.TODAY.IP")));
  // The second weekend starts from GBP 1,030; the first is final and not read again.
  db.reads.length = 0;
  const b = await runFxw({ rest: db.rest, now: () => T("2026-11-09T08:00:00Z") });
  assertEquals(b.weekends, { [F]: "closed", "2026-11-06": "closed" });
  assertEquals(db.reads.filter((r) => r.startsWith("ig_quotes?")).length, 1);
  const w2 = db.tables.ig_fxw_weekends[1];
  assertEquals([w2.friday, w2.equity_before, w2.net_gbp], ["2026-11-06", 1030, 30]);
  // A final row is left as it is, even if its quotes changed.
  db.tables.ig_quotes.push(live(q("2026-11-01T21:30:00Z", 0.7, 0.7002)));
  await runFxw({ rest: db.rest, now: () => T("2026-11-09T09:00:00Z") });
  assertEquals(db.tables.ig_fxw_weekends[0].exit_price, 0.66);
  assertEquals(db.tables.ig_fxw_state[0].last_run, "2026-11-09T09:00:00.000Z");
});
