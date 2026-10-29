// The books a Stablecoin quotes instance quotes going forward (`quoteBooksTraded`, index.ts), which its page reads to drop its
// tables' Book column when it is one book (Davies, 2026-10-29: "如果这个策略只有一个币种，就把页面里的tables中的book列删了").
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { quoteBooksTraded } from "./index.ts";
import { QUOTE_LIVE_INSTANCE, QUOTE_LIVE_USDT_ONLY_FROM } from "./quotes_live.ts";
import { QUOTE_RUNGS } from "./quotes.ts";

Deno.test("LIVE quotes both books until its USDT-only switch, then USDT-GBP alone", () => {
  assertEquals(quoteBooksTraded(QUOTE_LIVE_INSTANCE, QUOTE_LIVE_USDT_ONLY_FROM - 1), ["USDC-GBP", "USDT-GBP"]);
  assertEquals(quoteBooksTraded(QUOTE_LIVE_INSTANCE, QUOTE_LIVE_USDT_ONLY_FROM), ["USDT-GBP"]);
});

Deno.test("no weights: every book; weights on both books (1:1) or by side: both; a book whose every rung weighs 0: not it", () => {
  const from = Date.parse("2026-10-29T22:30:00Z"), now = from + 1;
  assertEquals(quoteBooksTraded({ rungs: QUOTE_RUNGS }, now), ["USDC-GBP", "USDT-GBP"]);
  assertEquals(quoteBooksTraded({ rungs: QUOTE_RUNGS, weights: { from, book: { "USDC-GBP": 1, "USDT-GBP": 1 } } }, now), ["USDC-GBP", "USDT-GBP"]);
  assertEquals(quoteBooksTraded({ rungs: QUOTE_RUNGS, weights: { from, side: { ask: 0 } } }, now), ["USDC-GBP", "USDT-GBP"]);
  assertEquals(quoteBooksTraded({ rungs: QUOTE_RUNGS, weights: { from, book: { "USDT-GBP": 0 } } }, now), ["USDC-GBP"]);
});
