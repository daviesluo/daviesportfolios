// "Stablecoin quotes OKX USDG" and "… OKX EURC" (okx_quotes.ts, 0150; docs/agents/reviews/2026-10-27-okx-paper-prereg.md).
// Pins, each worked by hand on a made-up world: (1) the books, fairs, sizes and pounds; (2) with PR5's grid and nothing
// filling, it places, re-prices and withdraws exactly as PR5's paper engine (`stepMinute`, quotes.ts) does; (3) LIVE's "at"
// fill rule, by the print's quantity, an entry's remainder withdrawn and its exit filled in parts; (4) a print shared best
// price first; (5) the post-only refusal against the recorded book, and the re-placement; (6) the 24-hour stop at the book's
// bid less the taker fee; (7) the weekend: a dark minute inside a closure takes the last EUR/USD, outside one it is dark;
// (8) the de-peg guard; (9) the daily loss stop; (10) the driver on the database and the page's read.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  newOkxBookState, OKX_CAPITAL_EUR, OKX_DEPEG, OKX_LOSS_STOP, OKX_MAKER, OKX_REPRICE, OKX_RUNG_EUR, OKX_RUNGS, OKX_SPEC, OKX_STOP_MS, OKX_TABLES, OKX_TAKER,
  okxAccountMinute, okxAccountTrips, okxBookView, okxCapitalGbp, okxExitTicks, okxFair, okxGbpPerQuote, okxNewState, okxQuoteTicks, okxRungQuote, okxUsdFactor,
  okxUsdPerQuote, type OkxMinuteInputs, type OkxTapePrint, OKX_BOOK_USD, OKX_RESIZE, OKX_RUNG_USD, readOkxQuotes, runOkxQuotes, stepOkxMinute,
} from "./okx_quotes.ts";
import { exitTicks, newBookState, QUOTE_REPRICE, QUOTE_RUNGS, quoteTicks, stepMinute } from "./quotes.ts";
import { memDb, type Row } from "./testing.ts";

const M = 60e3, H = 3600e3, DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();
const T0 = Date.parse("2026-10-27T10:00:00Z");     // a Tuesday
const EU = 1.1172, GU = 1.3337;
const lit = (prints: OkxTapePrint[] = [], extra: Partial<OkxMinuteInputs> = {}): OkxMinuteInputs => ({ eurusd: EU, gbpusd: GU, prints, touchStart: null, touchEnd: null, ...extra });
const pr = (ts: number, price: number, qty: number, side: "buy" | "sell", id: number, tick = 1e-4): OkxTapePrint => ({ ts, ticks: Math.round(price / tick), qty, side, id });

Deno.test("the books: USDG-EUR and EURC-USDC are EUR/USD books, €50 a rung (€600 ÷ 12), their own grids, pounds through GBP/USD", () => {
  assertEquals([OKX_RUNGS, OKX_REPRICE, OKX_RUNG_EUR, OKX_CAPITAL_EUR, OKX_STOP_MS, OKX_DEPEG, OKX_LOSS_STOP, OKX_MAKER, OKX_TAKER],
    [[0.001, 0.002, 0.003], 0.0005, 50, 600, DAY, 0.005, 0.01, 0, 0.001]);
  assertEquals(okxRungQuote("USDG-EUR", EU), 50);                                     // €50
  assertAlmostEquals(okxRungQuote("EURC-USDC", EU), 55.86, 1e-9);                     // €50 in dollars at 1.1172
  assertEquals([OKX_RUNGS, OKX_REPRICE], [QUOTE_RUNGS, QUOTE_REPRICE]);           // PR5's rungs and re-price
  assertEquals([OKX_SPEC["USDG-EUR"].tick, OKX_SPEC["EURC-USDC"].tick, OKX_SPEC["USDG-EUR"].name, OKX_SPEC["EURC-USDC"].name],
    [1e-4, 1e-3, "Stablecoin quotes OKX USDG", "Stablecoin quotes OKX EURC"]);
  assertAlmostEquals(okxFair("USDG-EUR", EU), 1 / 1.1172, 1e-12);                   // euros a USDG
  assertEquals(okxFair("EURC-USDC", EU), 1.1172);                                     // dollars a EURC
  assertAlmostEquals(okxGbpPerQuote("USDG-EUR", EU, GU)!, 1.1172 / 1.3337, 1e-12);   // pounds a euro
  assertAlmostEquals(okxGbpPerQuote("EURC-USDC", EU, GU)!, 1 / 1.3337, 1e-12);       // pounds a dollar
  assertEquals([okxGbpPerQuote("USDG-EUR", null, GU), okxGbpPerQuote("EURC-USDC", EU, null)], [null, null]);
  assertEquals([okxCapitalGbp(0.8), okxCapitalGbp(0.8, 12)], [240, 480]);          // six rungs, or twelve, of €50 at £0.80 a euro
  // f = 0.89509488: the 0.1 % bid 0.8941 (down), ask 0.8960 (up); a long's exit 0.8951 (up), a short's 0.8950 (down).
  const f = okxFair("USDG-EUR", EU);
  assertEquals([okxQuoteTicks(f, 0.001, "bid", 1e-4), okxQuoteTicks(f, 0.001, "ask", 1e-4), okxExitTicks(f, "bid", 1e-4), okxExitTicks(f, "ask", 1e-4)], [8941, 8960, 8951, 8950]);
  // On PR5's grid the prices are PR5's own formulas.
  for (const g of [0.75, 0.8950948, 1.0, 1.1172]) for (const k of QUOTE_RUNGS) for (const s of ["bid", "ask"] as const) assertEquals(okxQuoteTicks(g, k, s, 1e-4), quoteTicks(g, k, s));
  for (const g of [0.75, 0.8950948, 1.1172]) for (const s of ["bid", "ask"] as const) assertEquals(okxExitTicks(g, s, 1e-4), exitTicks(g, s));
  // EURC-USDC's grid is 0.001: the 0.1 % bid at 1.1172 is 1.116, the ask 1.119.
  assertEquals([okxQuoteTicks(1.1172, 0.001, "bid", 1e-3), okxQuoteTicks(1.1172, 0.001, "ask", 1e-3)], [1116, 1119]);
});

Deno.test("with PR5's grid and nothing filling, it places, re-prices and withdraws as PR5's paper engine does, minute for minute", () => {
  // USDG-EUR's grid is PR5's (0.0001) and its fair 1 / EUR/USD: PR5's engine given X = EUR/USD and fairU = 1 decides on the same fair.
  const path: Array<number | null> = [1.1172, 1.1172, 1.1175, 1.1180, 1.1180, null, null, null, 1.1160, 1.1166, 1.1166, 1.1150, 1.1150, 1.1151];
  const ours = newOkxBookState("USDG-EUR"), pr5 = newBookState("USDC-GBP");
  const pick = (e: { minute: number; side: string; k: number; kind: string; ticks: number | null; detail: Record<string, unknown> }) =>
    ({ minute: e.minute, side: e.side, k: e.k, kind: e.kind, ticks: e.ticks, what: e.detail.what ?? null, leg: e.detail.leg ?? null });
  let ordersOurs = 0, ordersPr5 = 0;
  path.forEach((x, i) => {
    const t = T0 + i * M;
    const a = stepOkxMinute(ours, t, lit([], { eurusd: x }));
    const b = stepMinute(pr5, t, { x, fairU: 1, prints: [] });
    assertEquals(a.events.map(pick), b.events.map(pick), `minute ${i}`);
    ordersOurs += a.orders; ordersPr5 += b.orders;
  });
  assertEquals(ordersOurs, ordersPr5);
  assert(ordersOurs > 12);
});

Deno.test("LIVE's \"at\" rule: a seller AT our bid fills it by its quantity; the rest of the entry is withdrawn; its exit fills in parts", () => {
  const s = newOkxBookState("USDG-EUR");
  const a = stepOkxMinute(s, T0, lit());
  assertEquals(a.events.filter((e) => e.kind === "order").length, 6);
  const bid1 = s.rungs.find((r) => r.side === "bid" && r.k === 0.001)!;
  assertEquals([bid1.o!.ticks, bid1.o!.qty, bid1.o!.state], [8941, 55.9221, "pending"]);    // €50 / 0.8941 in 0.0001 lots
  // A BUYER at our bid fills nothing (it lifted the ask); a SELLER at it fills 20 of the 55.9221.
  const b = stepOkxMinute(s, T0 + M, lit([pr(T0 + M + 5e3, 0.8941, 7, "buy", 1), pr(T0 + M + 9e3, 0.8941, 20, "sell", 2)]));
  assertEquals(b.events.filter((e) => e.kind === "fill").map((e) => [e.side, e.k, e.ticks, e.detail.qty, e.detail.of]), [["bid", 0.001, 8941, 20, 55.9221]]);
  assertEquals([bid1.mode, bid1.qty, bid1.entry, bid1.o], ["position", 20, 0.8941, null]);
  // The 0.2 % and 0.3 % bids sit below the print: untouched.
  assert(s.rungs.filter((r) => r.side === "bid" && r.k > 0.001).every((r) => r.mode === "quote"));
  // Its exit rests at fair rounded up, 0.8951, for the 20 held.
  const c = stepOkxMinute(s, T0 + 2 * M, lit());
  assertEquals(c.events.filter((e) => e.detail.leg === "exit").map((e) => [e.side, e.ticks, e.detail.qty]), [["bid", 8951, 20]]);
  // A buyer AT 0.8951 takes 5, a buyer through it the other 15: one trip at 0.8951, P&L 20 × 0.0010 = €0.02, in pounds at EUR/USD ÷ GBP/USD.
  const d = stepOkxMinute(s, T0 + 3 * M, lit([pr(T0 + 3 * M + 1e3, 0.8951, 5, "buy", 3), pr(T0 + 3 * M + 2e3, 0.8953, 100, "buy", 4)]));
  assertEquals(d.trips.length, 1);
  const t = d.trips[0];
  assertEquals([t.side, t.k, t.entry, t.qty, t.exit, t.how, t.tEntry, t.tExit, t.fillId], ["bid", 0.001, 0.8941, 20, 0.8951, "maker", T0 + M, T0 + 3 * M, 2]);
  assertAlmostEquals(t.pnlQuote, 0.02, 1e-9);
  assertAlmostEquals(t.pnlGbp, 0.02 * EU / GU, 1e-12);
  assertEquals(d.events.filter((e) => e.kind === "exit").map((e) => [e.detail.qty, e.detail.parts]), [[20, 2]]);
  assertEquals(bid1.mode, "idle");
  // The 0.1 % ask (0.8960) was not reached by a buyer at 0.8953.
  assertEquals(s.rungs.find((r) => r.side === "ask" && r.k === 0.001)!.mode, "quote");
});

Deno.test("a print is shared by the orders it fills, best price first", () => {
  const s = newOkxBookState("USDG-EUR");
  stepOkxMinute(s, T0, lit());
  // A seller of 70 through every bid (0.8941, 0.8933, 0.8924): the 0.1 % bid takes 55.9221, the 0.2 % the 14.0779 left, the 0.3 % none.
  const b = stepOkxMinute(s, T0 + M, lit([pr(T0 + M + 5e3, 0.8900, 70, "sell", 1)]));
  assertEquals(b.events.filter((e) => e.kind === "fill").map((e) => [e.k, e.detail.qty]), [[0.001, 55.9221], [0.002, 14.0779]]);
  assertEquals(s.rungs.find((r) => r.side === "bid" && r.k === 0.003)!.mode, "quote");
});

Deno.test("post-only against the recorded book: an order at or through the best ask is refused, and sent again when the book has left it", () => {
  const s = newOkxBookState("USDG-EUR");
  stepOkxMinute(s, T0, lit());
  // At T0 + 1 min the book read shows an ask of 0.8940: the 0.1 % bid (0.8941) would cross it; the 0.2 % (0.8933) would not.
  const b = stepOkxMinute(s, T0 + M, lit([], { touchStart: { bid: 0.8935, ask: 0.8940, at: T0 + M - 20e3 } }));
  assertEquals(b.events.filter((e) => e.kind === "refused").map((e) => [e.side, e.k, e.ticks]), [["bid", 0.001, 8941]]);
  // The next minute the book is back (ask 0.8952): it is sent again, live the minute after.
  const c = stepOkxMinute(s, T0 + 2 * M, lit([], { touchStart: { bid: 0.8944, ask: 0.8952, at: T0 + 2 * M - 20e3 } }));
  assertEquals(c.events.filter((e) => e.kind === "order").map((e) => [e.side, e.k, e.detail.what]), [["bid", 0.001, "replace"]]);
  stepOkxMinute(s, T0 + 3 * M, lit([], { touchStart: { bid: 0.8944, ask: 0.8952, at: T0 + 3 * M - 20e3 } }));
  assertEquals(s.rungs.find((r) => r.side === "bid" && r.k === 0.001)!.o!.state, "live");
  // A read older than two minutes is no book: the last print's touch decides, and with none, nothing is refused.
  const s2 = newOkxBookState("USDG-EUR");
  stepOkxMinute(s2, T0, lit());
  const stale = stepOkxMinute(s2, T0 + M, lit([], { touchStart: null }));
  assertEquals(stale.events.filter((e) => e.kind === "refused").length, 0);
});

Deno.test("the 24-hour stop closes what is held as a taker: a long sells at the recorded best bid less 0.10 %", () => {
  const s = newOkxBookState("USDG-EUR");
  stepOkxMinute(s, T0, lit());
  stepOkxMinute(s, T0 + M, lit([pr(T0 + M + 5e3, 0.8941, 20, "sell", 1)]));
  stepOkxMinute(s, T0 + 2 * M, lit());
  // A day on, nothing has bought at fair: at the end of minute T0 + 1 min + 24 h it sells at the book's bid, 0.8930, less the fee.
  const t = T0 + M + DAY;
  const out = stepOkxMinute(s, t, lit([], { touchEnd: { bid: 0.8930, ask: 0.8960, at: t + 30e3 } }));
  assertEquals(out.trips.length, 1);
  const x = out.trips[0];
  assertEquals([x.how, x.qty, x.tExit], ["taker", 20, t]);
  assertAlmostEquals(x.exit, 0.8930 * (1 - OKX_TAKER), 1e-9);
  assertAlmostEquals(x.pnlQuote, 20 * (0.8930 * 0.999 - 0.8941), 1e-9);
  assertEquals(out.events.filter((e) => e.kind === "stop").map((e) => [e.ticks, e.detail.from]), [[8930, "book"]]);
  // A minute short of a day is not a stop.
  const s2 = newOkxBookState("USDG-EUR");
  stepOkxMinute(s2, T0, lit());
  stepOkxMinute(s2, T0 + M, lit([pr(T0 + M + 5e3, 0.8941, 20, "sell", 1)]));
  assertEquals(stepOkxMinute(s2, T0 + DAY, lit([], { touchEnd: { bid: 0.8930, ask: 0.8960, at: T0 + DAY } })).trips.length, 0);
});

Deno.test("the weekend: inside a closure a dark minute takes the book's last EUR/USD and quotes on it; outside one it is dark", () => {
  const fri = Date.parse("2026-10-30T20:58:00Z"), sat = Date.parse("2026-10-31T12:00:00Z"), tue = Date.parse("2026-11-03T10:00:00Z");
  const s = newOkxBookState("EURC-USDC");
  stepOkxMinute(s, fri, lit());                       // the last live EUR/USD, 1.1172
  const w = stepOkxMinute(s, sat, lit([], { eurusd: null }));
  assertEquals([w.x, w.held, w.guard], [1.1172, true, null]);
  assertEquals(s.rungs.filter((r) => r.mode === "quote").length, 6);
  // A weekday minute with no EUR/USD is dark: every entry is withdrawn, and nothing is placed.
  const d = stepOkxMinute(s, tue, lit([], { eurusd: null }));
  assertEquals([d.x, d.guard, d.events.filter((e) => e.kind === "withdraw").length, d.orders], [null, "dark", 6, 0]);
});

Deno.test("the de-peg guard: a last print more than 50 bps from fair withdraws every entry; exits are not touched", () => {
  const s = newOkxBookState("USDG-EUR");
  stepOkxMinute(s, T0, lit());
  stepOkxMinute(s, T0 + M, lit([pr(T0 + M + 5e3, 0.8941, 20, "sell", 1)]));
  const g = stepOkxMinute(s, T0 + 2 * M, lit());
  assertEquals(g.guard, null);
  // The book's last print 55 bps over fair (0.9000 against 0.89509): the next turn's guard.
  s.lastPrint = pr(T0 + 2 * M + 1e3, 0.9000, 1, "buy", 2);
  const h = stepOkxMinute(s, T0 + 3 * M, lit());
  assertEquals(h.guard, "de-peg");
  assertEquals(h.events.filter((e) => e.kind === "withdraw").length, 5);
  assertEquals(s.rungs.find((r) => r.side === "bid" && r.k === 0.001)!.mode, "position");
});

Deno.test("the daily loss stop is the account's: both books' closed trips that day reaching −1 % of the €600 stop every entry until the next UTC day", () => {
  const cap = okxCapitalGbp(EU / GU, 12);                                             // £502.6
  let a = okxAccountMinute({ day: null, dayGbp: 0, stopped: false }, T0);
  a = okxAccountTrips(a, [{ pnlGbp: -3 }], cap);
  assertEquals(a.stopped, false);                                                     // −£3.00 of a £5.03 stop
  a = okxAccountTrips(a, [{ pnlGbp: 1 }, { pnlGbp: -3.1 }], cap);
  assertEquals([a.stopped, Number(a.dayGbp.toFixed(2))], [true, -5.1]);
  assertEquals(okxAccountMinute(a, T0 + 5 * M), a);                                   // the same day: still stopped
  assertEquals(okxAccountMinute(a, T0 + DAY), { day: "2026-10-28", dayGbp: 0, stopped: false });
  assert(cap * OKX_LOSS_STOP > 5 && cap * OKX_LOSS_STOP < 5.1);
  // A stopped account withdraws every entry; a held rung's exit stays.
  const s = newOkxBookState("USDG-EUR");
  stepOkxMinute(s, T0, lit());
  stepOkxMinute(s, T0 + M, lit([pr(T0 + M + 5e3, 0.8941, 20, "sell", 1)]));
  stepOkxMinute(s, T0 + 2 * M, lit());
  const out = stepOkxMinute(s, T0 + 3 * M, lit([], { stopped: true }));
  assertEquals([out.guard, out.events.filter((e) => e.kind === "withdraw").length, out.orders], ["loss stop", 5, 0]);
  assertEquals(s.rungs.find((r) => r.side === "bid" && r.k === 0.001)!.o!.state, "live");
});

Deno.test("Deviation 2: from usdFrom a rung is $100, six a book, $600; on USDG-EUR $100 in euros, on EURC-USDC 100 USDC", () => {
  assertEquals([OKX_RUNG_USD, OKX_BOOK_USD, OKX_RESIZE], [100, 600, 0.05]);
  assertAlmostEquals(okxUsdFactor(EU), 600 / (300 * 1.1172), 1e-12);               // 1.79019: $600 over €300 in dollars
  assertEquals([okxUsdPerQuote("USDG-EUR", EU), okxUsdPerQuote("EURC-USDC", EU)], [EU, 1]);
  const u = newOkxBookState("USDG-EUR"), e = newOkxBookState("EURC-USDC");
  stepOkxMinute(u, T0, lit([], { rungUsd: 100 }));
  stepOkxMinute(e, T0, lit([], { rungUsd: 100 }));
  // USDG-EUR's 0.1 % bid 0.8941: $100 = €89.5094 at 1.1172, 100.1112 USDG in 0.0001 lots; EURC-USDC's 1.116 bid: 89.605 EURC.
  assertEquals(u.rungs.find((r) => r.side === "bid" && r.k === 0.001)!.o!.qty, 100.1112);
  assertEquals(e.rungs.find((r) => r.side === "bid" && r.k === 0.001)!.o!.qty, 89.605);
  // Six rungs a book, and every one of them is worth $100 (within a lot).
  for (const st of [u, e]) {
    assertEquals(st.rungs.filter((r) => r.mode === "quote").length, 6);
    for (const r of st.rungs) assertAlmostEquals(r.o!.qty * r.o!.ticks * OKX_SPEC[st.book].tick * okxUsdPerQuote(st.book, EU)!, 100, 0.002);
  }
});

Deno.test("Deviation 2: an entry resting at €50 is re-sized to $100 once at the switch, and never for a small move of EUR/USD", () => {
  const s = newOkxBookState("EURC-USDC");
  stepOkxMinute(s, T0, lit());                                                        // €50 rungs: 55.86 USDC
  const bid = s.rungs.find((r) => r.side === "bid" && r.k === 0.001)!;
  assertEquals(bid.o!.qty, 50.053);                                                   // 55.86 / 1.116
  stepOkxMinute(s, T0 + M, lit());
  const sw = stepOkxMinute(s, T0 + 2 * M, lit([], { rungUsd: 100 }));
  assertEquals(sw.events.filter((x) => x.detail.what === "resize").length, 6);
  assertEquals([bid.o!.qty, bid.o!.state, bid.o!.live, bid.o!.ticks], [89.605, "pending", T0 + 3 * M, 1116]);
  // A minute later, EUR/USD 0.01 % higher: nothing is re-sized (EURC-USDC's rung is 100 USDC whatever EUR/USD does).
  const next = stepOkxMinute(s, T0 + 3 * M, lit([], { rungUsd: 100, eurusd: 1.1173 }));
  assertEquals(next.events.filter((x) => x.detail.what === "resize").length, 0);
  // On USDG-EUR the dollar rung is euros at EUR/USD: a 1 % move of EUR/USD is inside the 5 % band.
  const u = newOkxBookState("USDG-EUR");
  stepOkxMinute(u, T0, lit([], { rungUsd: 100 }));
  stepOkxMinute(u, T0 + M, lit([], { rungUsd: 100 }));
  const moved = stepOkxMinute(u, T0 + 2 * M, lit([], { rungUsd: 100, eurusd: 1.1172 * 1.0004 }));
  assertEquals(moved.events.filter((x) => x.detail.what === "resize").length, 0);
});

Deno.test("the driver switches to $100 rungs at its first decided minute, and the page reads $600 a book with the record before × the factor", async () => {
  const NOW = T0 + 11 * M;
  const eur: Row[] = [], fx: Row[] = [];
  for (let t = T0 - 20 * M; t <= T0 + 12 * M; t += M) { eur.push({ kind: "fx:EURUSD", t: iso(t), value: EU }); fx.push({ kind: "fx", t: iso(t), value: GU }); }
  const trades = [
    { book: "USDG-EUR", trade_id: 7000001, ts: iso(T0 + 2 * M + 5e3), price: 0.8941, size: 100, side: "sell" },   // the 0.1 % bid at €50, before the switch
    { book: "USDG-EUR", trade_id: 7000002, ts: iso(T0 + 4 * M + 5e3), price: 0.8951, size: 100, side: "buy" },    // its exit at fair
    { book: "USDG-EUR", trade_id: 7000003, ts: iso(T0 + 6 * M + 5e3), price: 0.8941, size: 200, side: "sell" },   // the same rung at $100, after it
    { book: "USDG-EUR", trade_id: 7000004, ts: iso(T0 + 8 * M + 5e3), price: 0.8951, size: 200, side: "buy" },
    { book: "EURC-USDC", trade_id: 7000001, ts: iso(T0 + 5 * M + 5e3), price: 1.118, size: 3, side: "buy" },     // inside its quotes
  ];
  const books: Row[] = [];
  for (let t = T0; t <= T0 + 10 * M; t += M) {
    books.push({ book: "USDG-EUR", ts: iso(t + 40e3), bid: 0.8948, ask: 0.8958 });
    books.push({ book: "EURC-USDC", ts: iso(t + 40e3), bid: 1.117, ask: 1.119 });
  }
  // The switch at T0 + 3 min (`usdFrom`, as a first run of this code would have written it there): €50 rungs before, $100 after.
  const seed = { ...okxNewState(T0 + M, { "USDG-EUR": 0, "EURC-USDC": 0 }), usdFrom: T0 + 3 * M, usdEurusd: EU, usdFactor: okxUsdFactor(EU) };
  const { db, tables } = memDb({
    agent_locks: [{ name: "okx-quotes", lease_until: iso(0), holder: null }],
    agent_quote_inputs: fx, cb_quote_inputs: eur, okx_trades: trades, okx_books: books,
    okx_quote_state: [{ id: 1, state: seed, last_minute: iso(T0), updated_at: iso(0), last_error: null }],
    okx_quote_events: [], okx_quote_trips: [], okx_quote_minutes: [], okx_quote_days: [],
  }, { now: () => NOW });
  const cur = (coveredTo: number) => ({ from: 1, hi: 7000005, top: 7000005, topAt: coveredTo, hole: null, coveredTo });
  const r = await runOkxQuotes({ db, now: NOW, holder: "h", rec: { cursors: { "USDG-EUR": cur(T0 + 10 * M + 30e3), "EURC-USDC": cur(T0 + 10 * M + 30e3) } } });
  assertEquals([r.errors, r.from, r.to], [[], T0 + M, T0 + 9 * M]);
  const trips = [...tables.okx_quote_trips].sort((a, b) => String(a.t_entry).localeCompare(String(b.t_entry)));
  assertEquals(trips.map((t) => [t.t_entry, t.qty, t.entry, t.exit]), [[iso(T0 + 2 * M), 55.9221, 0.8941, 0.8951], [iso(T0 + 6 * M), 100.1112, 0.8941, 0.8951]]);
  // The resting entries met the switch at T0 + 3 min and were re-sized once; the next time a rung opens it is $100.
  const resized = tables.okx_quote_events.filter((e) => (e.detail as { what?: string }).what === "resize");
  assertEquals([resized.length, resized.every((e) => e.minute === iso(T0 + 3 * M))], [11, true]);   // USDG's 5 resting and EURC's 6
  // The page: $600 a book, in dollars; the €50 trip × the factor (2 × its euros, at 1.1172), the $100 one as it is.
  tables.okx_quote_days = [{ book: "USDG-EUR", day: "2026-10-27", orders: 20, fills: 2, trips: 2, won: 2, realised_gbp: 0 }];
  const views = await readOkxQuotes(db, NOW, Date.parse("2026-10-27T00:00:00Z"));
  assertEquals(views.map((v) => [v!.venue, v!.ccy, v!.twin.id, v!.capitalUsd, v!.detail.tripCount]), [["okx", "USD", "okxusdg", 600, 2], ["okx", "USD", "okxeurc", 600, 0]]);
  const before = 55.9221 * 0.001 * EU * okxUsdFactor(EU), after = 100.1112 * 0.001 * EU;
  assertAlmostEquals(before, 55.9221 * 0.001 * 2, 1e-9);
  assertAlmostEquals(views[0]!.realisedUsd, before + after, 1e-9);
  assertAlmostEquals(views[0]!.realisedGbp, (before + after) / GU, 1e-9);
  assertAlmostEquals(views[0]!.detail.days[0].realisedUsd, before + after, 1e-9);
  const shown = views[0]!.detail.trips;
  assertAlmostEquals(shown[1].pnlUsd, before, 1e-9);                                  // the older trip, listed second
  assertAlmostEquals(shown[1].qty, 55.9221 * okxUsdFactor(EU), 1e-9);                 // its size × the factor
  assertAlmostEquals(shown[0].pnlUsd, after, 1e-9);
  assertEquals([shown[0].qty, shown[0].entry, shown[0].exit], [100.1112, 0.8941, 0.8951]); // prices never scaled
  assertEquals(views[0]!.usdFrom, iso(T0 + 3 * M));
  assertEquals(OKX_TABLES.days, "okx_quote_days");
});

Deno.test("the driver's first run writes the switch: usdFrom its first decided minute, the EUR/USD there and the factor", async () => {
  const eur: Row[] = [], fx: Row[] = [];
  for (let t = T0 - 20 * M; t <= T0 + 5 * M; t += M) { eur.push({ kind: "fx:EURUSD", t: iso(t), value: EU }); fx.push({ kind: "fx", t: iso(t), value: GU }); }
  const { db, tables } = memDb({
    agent_locks: [{ name: "okx-quotes", lease_until: iso(0), holder: null }],
    agent_quote_inputs: fx, cb_quote_inputs: eur, okx_trades: [], okx_books: [],
    okx_quote_state: [{ id: 1, state: okxNewState(T0 + M, { "USDG-EUR": 0, "EURC-USDC": 0 }), last_minute: iso(T0), updated_at: iso(0), last_error: null }],
    okx_quote_events: [], okx_quote_trips: [], okx_quote_minutes: [], okx_quote_days: [],
  }, { now: () => T0 + 5 * M });
  const cur = { from: 1, hi: 1, top: 1, topAt: T0 + 4 * M, hole: null, coveredTo: T0 + 4 * M + 30e3 };
  const r = await runOkxQuotes({ db, now: T0 + 5 * M, holder: "h", rec: { cursors: { "USDG-EUR": cur, "EURC-USDC": cur } } });
  assertEquals([r.errors, r.from], [[], T0 + M]);
  const st = tables.okx_quote_state[0].state as { usdFrom: number; usdEurusd: number; usdFactor: number; books: Record<string, { rungs: Array<{ o: { qty: number } | null }> }> };
  assertEquals([st.usdFrom, st.usdEurusd], [T0 + M, EU]);
  assertAlmostEquals(st.usdFactor, 600 / (300 * 1.1172), 1e-12);
  assertEquals(st.books["EURC-USDC"].rungs[0].o!.qty, 89.605);                         // the 0.1 % bid at $100 from the first minute
});

Deno.test("Deviation 2's scale in the page: × the factor strictly before usdFrom, × 1 at and after it", () => {
  const from = T0 + 60 * M, factor = okxUsdFactor(EU);
  const state = { ...okxNewState(T0, { "USDG-EUR": 0, "EURC-USDC": 0 }), usdFrom: from, usdEurusd: EU, usdFactor: factor };
  const trip = (tEntry: number, pnlQuote: number) => ({ book: "EURC-USDC", side: "bid", k: 0.001, t_entry: iso(tEntry), t_exit: iso(tEntry + 5 * M), entry: 1.116, exit: 1.117,
    qty: 50, how: "maker", pnl_gbp: 0, pnl_quote: pnlQuote });
  const v = okxBookView({
    book: "EURC-USDC", st: { state, last_minute: iso(from + 30 * M), last_error: null },
    trips: [trip(from - M, 0.05), trip(from, 0.05), trip(from + M, 0.05)], days: [], events: [
      { book: "EURC-USDC", minute: iso(from - M), side: "bid", k: 0.001, kind: "order", ticks: 1116, detail: { leg: "entry", qty: 50 } },
      { book: "EURC-USDC", minute: iso(from), side: "bid", k: 0.001, kind: "order", ticks: 1116, detail: { leg: "entry", qty: 89.605 } },
    ], minute: null, nowMs: from + 31 * M, dayStartMs: Math.floor(from / DAY) * DAY, gbpusd: GU, eurusd: EU,
  })!;
  assertAlmostEquals(v.realisedUsd, 0.05 * factor + 0.05 + 0.05, 1e-12);             // USDC is dollars: only the factor
  assertEquals(v.detail.orders.map((o) => o.base), [50 * factor, 89.605]);
  assertEquals([v.capitalUsd, v.ccy, v.feesUsd], [600, "USD", 0]);
});

Deno.test("an empty record starts at the next 00:00 UTC, flat, from the newest trade id each book has", async () => {
  const NOW = T0 + 30 * 1e3;
  const { db, tables } = memDb({
    agent_locks: [{ name: "okx-quotes", lease_until: iso(0), holder: null }],
    agent_quote_inputs: [], cb_quote_inputs: [], okx_books: [],
    okx_trades: [{ book: "USDG-EUR", trade_id: 7000009, ts: iso(T0), price: 0.8941, size: 1, side: "sell" }],
    okx_quote_state: [], okx_quote_events: [], okx_quote_trips: [], okx_quote_minutes: [],
  }, { now: () => NOW });
  const cur = { from: 1, hi: 9, top: 9, topAt: NOW, hole: null, coveredTo: NOW };
  const r = await runOkxQuotes({ db, now: NOW, holder: "h", rec: { cursors: { "USDG-EUR": cur, "EURC-USDC": cur } } });
  assertEquals(r.skipped, "nothing new to decide");
  const st = tables.okx_quote_state[0].state as { startedAt: number; lastMinute: number; fed: Record<string, number> };
  assertEquals([st.startedAt, st.lastMinute, st.fed], [Date.parse("2026-10-28T00:00:00Z"), Date.parse("2026-10-28T00:00:00Z") - M, { "USDG-EUR": 7000009, "EURC-USDC": 0 }]);
  // Before the recorder has covered both books, nothing runs.
  const none = await runOkxQuotes({ db, now: NOW + M, holder: "h", rec: { cursors: { "USDG-EUR": cur } } });
  assertEquals(none.skipped, "the recorder has not covered every book yet");
  assertEquals(H, 3600e3);
});
