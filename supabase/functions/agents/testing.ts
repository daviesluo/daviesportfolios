// Test doubles for the agents loop — imported by the tests only, never by the function.
//
// ONE implementation of each rule a double must honour. Twice on 2026-09-22 a double looser than the thing it stands
// in for certified what production rejects: the in-memory database ignored `agent_orders_mode_check`, so three tests
// passed a sell Postgres refused; and it paged without `db.ts`'s order guard, so 338 tests stayed green while the tick
// threw on every run for three hours. The rules below are the schema's (0037, 0041, 0042), checked on INSERT *and*
// UPDATE, because Postgres checks both — a settle whose fee is NaN goes over the wire as null and is refused by
// `fee_usd NOT NULL` exactly as a bad insert is.
import { assertPagedOrder, PAGE_ROWS, type Db } from "./db.ts";
import { stepDecimals } from "../_shared/agents_strategy.ts";
import { JEV_OPENROUTER_URL } from "../_shared/jev.ts";
import { cancelOrderBody, exchangeFor, orderHash, postOrderBody, recoverSigner, type PmReply, type PmVenue } from "../_shared/polymarket_orders.ts";
import { jevBandCheck } from "./jev_bands.ts";
import { crossesTouch, revxAveragePrice, revxHoldFor, revxHundredths, revxTakerFee, venueNumber } from "./revx_sim.ts";

export type Row = Record<string, unknown>;

const ORDER_STATES = ["pending", "new", "partially_filled", "filled", "cancelled", "rejected"];
const PROBE_STATES = ["resting", "filled", "expired"];
/** The paper quote test's tables as 0051 and 0055 create them: their columns, and the unique key each upsert names. */
const QUOTE_TABLES: Record<string, { columns: string[]; key: string }> = {
  agent_quote_state: { columns: ["id", "state", "last_minute", "updated_at", "last_error"], key: "id" },
  agent_quote_prints: { columns: ["id", "book", "ts", "price", "qty", "side"], key: "id" },
  agent_quote_inputs: { columns: ["kind", "t", "value"], key: "kind,t" },
  agent_quote_minutes: { columns: ["book", "minute", "x", "x_t", "fair_u", "hours_n", "prints_n", "recorded_at"], key: "book,minute" },
  agent_quote_events: { columns: ["book", "minute", "side", "k", "kind", "ticks", "detail"], key: "book,minute,side,k,kind" },
  agent_quote_trips: {
    columns: ["book", "side", "k", "t_entry", "fill_ts", "fill_print_id", "entry", "qty", "x_entry", "fair_entry", "entry_oid", "t_exit", "exit", "how",
      "exit_print_id", "exit_oid", "notional_usd", "pnl_usd"],
    key: "book,side,k,t_entry",
  },
};
const QUOTE_BOOKS_OK = ["USDC-GBP", "USDT-GBP"];
/**
 * The quote variant's tables as 0071 creates them (PR5V): their columns, the unique key each upsert names, and the column
 * Postgres fills from an identity when a row is new (the trips' `id`, which a paged read orders by).
 */
const VARIANT_TABLES: Record<string, { columns: string[]; key: string; identity?: string }> = {
  agent_quotev_state: { columns: ["id", "state", "last_minute", "updated_at", "last_error"], key: "id" },
  agent_quotev_minutes: {
    columns: ["book", "minute", "source", "x", "x_t", "fair_u", "hours_n", "prints_n", "pr5_prints_n", "recorded_at"], key: "book,minute",
  },
  agent_quotev_events: { columns: ["arm", "book", "minute", "side", "k", "kind", "what", "key", "ticks", "detail"], key: "arm,book,minute,side,k,kind" },
  agent_quotev_trips: {
    columns: ["id", "arm", "key", "book", "side", "k", "t_entry", "fill_ts", "fill_print_id", "entry", "qty", "x_entry", "fair_entry", "entry_oid", "t_exit",
      "exit", "how", "exit_print_id", "exit_oid", "notional_usd", "pnl_usd"],
    key: "arm,book,side,k,t_entry", identity: "id",
  },
};
const VARIANT_KEYS = ["USDC-GBP/bid", "USDC-GBP/ask", "USDT-GBP/bid", "USDT-GBP/ask"];
const VARIANT_ORDER_WHATS = ["place", "reprice", "replace", "exit", "exit_reprice", "exit_replace"];
/**
 * Rule D's tables as 0072 creates them: PR5V's shape, arms `v1` and `d`, and the X arm `d` decided on. Kept apart from
 * `VARIANT_TABLES` so PR5V's reset cannot wipe them, and this reset cannot wipe PR5V's.
 */
const RULED_TABLES: Record<string, { columns: string[]; key: string; identity?: string }> = {
  agent_quoted_state: { columns: ["id", "state", "last_minute", "updated_at", "last_error"], key: "id" },
  agent_quoted_minutes: {
    columns: ["book", "minute", "source", "x", "x_t", "fair_u", "hours_n", "prints_n", "pr5_prints_n", "x_d", "x_source", "x_d_t", "x_d_read", "recorded_at"],
    key: "book,minute",
  },
  agent_quoted_events: { columns: ["arm", "book", "minute", "side", "k", "kind", "what", "key", "ticks", "detail"], key: "arm,book,minute,side,k,kind" },
  agent_quoted_trips: {
    columns: ["id", "arm", "key", "book", "side", "k", "t_entry", "fill_ts", "fill_print_id", "entry", "qty", "x_entry", "fair_entry", "entry_oid", "t_exit",
      "exit", "how", "exit_print_id", "exit_oid", "notional_usd", "pnl_usd"],
    key: "arm,book,side,k,t_entry", identity: "id",
  },
};
/** The functions a migration creates that the loop calls through PostgREST's rpc endpoint, as the database runs them. */
const RPC: Record<string, (tables: Record<string, Row[]>) => void> = {
  // 0071: the quote variant's own rows, and nothing else.
  agent_quotev_reset: (tables) => { for (const t of Object.keys(VARIANT_TABLES)) (tables[t] ??= []).length = 0; },
  // 0072: rule D's own rows, and nothing else.
  agent_quoted_reset: (tables) => { for (const t of Object.keys(RULED_TABLES)) (tables[t] ??= []).length = 0; },
};
/**
 * The live quotes fixture's rows (src/e2e/quotes_live_fixture.json) as a realistic twin's tables, at the twin's capital
 * (its spec row's), beside the twin's own driver state: the rows the twins' fixture (src/e2e/quotes_twin_fixture.json,
 * made by docs/agents/backtests/twins/scripts/fixture.ts) is the dashboard's answer for.
 */
// deno-lint-ignore no-explicit-any
export function twinFixtureTables(live: any, spec: { id: string; capitalGbp: number }, sim: Row): Record<string, Row[]> {
  const t = (x: string) => `agent_quote_twin_${spec.id}_${x}`;
  return {
    [t("config")]: [{ id: 1, ...live.config, capital_gbp: spec.capitalGbp }],
    [t("state")]: [{ id: 1, ...live.state }],
    [t("orders")]: JSON.parse(JSON.stringify(live.orders)),
    [t("events")]: [],
    [t("paper")]: [{ id: 1, state: live.paper.state, last_minute: live.paper.last_minute, updated_at: live.paper.updated_at }],
    [t("sim")]: [sim],
  };
}

/** A value compared as PostgREST compares a column: as numbers when both are numbers, else as text. */
const cmpValue = (a: unknown, b: string) => {
  const x = Number(a), y = Number(b);
  return a != null && a !== "" && b !== "" && Number.isFinite(x) && Number.isFinite(y) ? x - y : String(a) < b ? -1 : String(a) > b ? 1 : 0;
};
/** The conditions of PostgREST's `or=(…)`, each `column.op.value` (eq, neq, gt, gte, lt, lte, in, is); anything else throws. */
export function orConditions(v: string): ((r: Row) => boolean)[] {
  const inner = decodeURIComponent(v);
  if (!inner.startsWith("(") || !inner.endsWith(")")) throw new Error(`stub db: unsupported or ${v}`);
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of inner.slice(1, -1)) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  parts.push(cur);
  return parts.map((part) => {
    const m = part.match(/^([a-z_][a-z0-9_]*)\.(eq|neq|gt|gte|lt|lte|in|is)\.(.*)$/);
    if (!m) throw new Error(`stub db: unsupported or condition ${part}`);
    const [, col, op, val] = m;
    if (op === "in") { if (!val.startsWith("(") || !val.endsWith(")")) throw new Error(`stub db: unsupported or condition ${part}`); const set = val.slice(1, -1).split(","); return (r: Row) => set.includes(String(r[col])); }
    if (op === "is") { if (val !== "null") throw new Error(`stub db: unsupported or condition ${part}`); return (r: Row) => r[col] == null; }
    // A null compares to nothing, as SQL's: it fails every comparison.
    return (r: Row) => {
      if (r[col] == null) return false;
      const c = cmpValue(r[col], val);
      return op === "eq" ? c === 0 : op === "neq" ? c !== 0 : op === "gt" ? c > 0 : op === "gte" ? c >= 0 : op === "lt" ? c < 0 : c <= 0;
    };
  });
}

/**
 * The live quote executor's tables as 0052 creates them: their columns, and the unique key each upsert names (the orders
 * table is only ever inserted and updated). The orders table's own unique indexes are enforced in `memDb` below.
 */
const LIVE_QUOTE_TABLES: Record<string, { columns: string[]; key: string | null }> = {
  agent_quote_live_config: { columns: ["id", "dry_run", "live_confirmed_at", "capital_gbp", "updated_at"], key: "id" },
  agent_quote_live_orders: {
    columns: ["id", "ts", "mode", "book", "rung_side", "k", "leg", "side", "price", "base_size", "client_order_id", "venue_order_id", "state",
      "filled_base", "avg_fill_price", "fee_gbp", "paper_oid", "paper_live", "fair", "request", "response", "book_seen", "cancel_requested_at",
      "cancel_reason", "filled_at", "cancelled_at", "updated_at"],
    key: null,
  },
  agent_quote_live_events: { columns: ["mode", "minute", "book", "rung_side", "k", "kind", "detail"], key: "mode,minute,book,rung_side,k,kind" },
  agent_quote_live_state: { columns: ["id", "state", "updated_at", "last_error"], key: "id" },
};
/**
 * The realistic twins' tables (0087's template, which 0088's `create_quote_twin_tables` makes for every twin of
 * `agent_quote_twin_specs`, whose id check is the pattern here): each twin's config, orders, events and state in 0052's
 * shapes under its own name, held to the live tables' rules; its orders upserted by their client id when a backfill is
 * loaded.
 */
const TWIN_SHAPE = /^agent_quote_twin_([a-z][a-z0-9]{0,15})_(config|orders|events|state)$/;
const liveQuoteShape = (table: string) => { const m = TWIN_SHAPE.exec(table); return m ? `agent_quote_live_${m[2]}` : table; };
const isLiveQuoteTable = (table: string) => liveQuoteShape(table) in LIVE_QUOTE_TABLES;
const liveQuoteKey = (table: string) => (TWIN_SHAPE.test(table) && liveQuoteShape(table) === "agent_quote_live_orders" ? "client_order_id" : LIVE_QUOTE_TABLES[liveQuoteShape(table)]?.key ?? null);
/** Each twin's replica of its paper engine and its simulated account: one row each (0087's template). */
const TWIN_SIDE_SHAPES: Record<string, { columns: string[]; key: string }> = {
  paper: { columns: ["id", "state", "last_minute", "updated_at"], key: "id" },
  sim: { columns: ["id", "state", "updated_at", "last_error"], key: "id" },
};
const twinSide = (table: string) => { const m = /^agent_quote_twin_[a-z][a-z0-9]{0,15}_(paper|sim)$/.exec(table); return m ? TWIN_SIDE_SHAPES[m[1]] : undefined; };
/** The twins' spec table as 0088 creates it: one row a twin, read by the call and the page, written by migrations only. */
const TWIN_SPECS_COLUMNS = ["id", "display_name", "display_order", "engine", "capital_gbp", "gov", "start", "table_prefix", "lease", "rules", "backfill", "prereg", "migration", "enabled"];
const LIVE_OPEN_STATES = ["pending", "new", "partially_filled"];
/** RW's paper test's tables as 0053 creates them: their columns, and the unique key each upsert names. */
const PMRW_TABLES: Record<string, { columns: string[]; key: string }> = {
  pm_rw_state: { columns: ["id", "state", "last_minute", "updated_at", "last_error"], key: "id" },
  pm_rw_selection: {
    columns: ["day", "cond", "rank", "yes", "tick", "v", "min_size", "rate", "per_dollar_day", "capital", "q", "cat", "end_date", "selected_at"],
    key: "day,cond",
  },
  pm_rw_minutes: {
    columns: ["cond", "minute", "quoting", "tick", "bb", "ba", "ab", "aa", "q1", "q2", "m", "b", "a", "ours", "others", "reward", "qb", "qa"],
    key: "cond,minute",
  },
  pm_rw_prints: { columns: ["id", "cond", "ts", "side", "oi", "price", "size"], key: "id" },
  pm_rw_fills: { columns: ["cond", "minute", "ts", "side", "price", "size", "print_id"], key: "cond,minute,print_id" },
  pm_rw_days: { columns: ["day", "total", "stress_total", "reward", "fills", "capital", "markets", "detail", "closed_at"], key: "day" },
  pm_rw_settlements: { columns: ["cond", "closed_time", "payout", "net", "cash", "settled_at"], key: "cond" },
  // RW-E's replay beside it (0056).
  pm_rw_e_state: { columns: ["id", "state", "last_minute", "updated_at", "last_error"], key: "id" },
  pm_rw_e_days: { columns: ["day", "arm", "total", "stress_total", "reward", "fills", "capital", "markets", "detail", "closed_at"], key: "day,arm" },
  // RW-E's variants beside it (0064).
  pm_rw_x_state: { columns: ["id", "state", "last_minute", "updated_at", "last_error"], key: "id" },
  pm_rw_x_days: { columns: ["day", "arm", "total", "stress_total", "reward", "fills", "capital", "markets", "detail", "closed_at"], key: "day,arm" },
  // The stablecoin books' record (0057).
  agent_book_levels: { columns: ["book", "ts", "bids", "asks", "seen_until", "reads"], key: "book,ts" },
  // 0078: the two GBP tickers, one row a book, the latest read.
  agent_quote_tickers: { columns: ["book", "index_price", "bid", "ask", "mid", "last_price", "ts"], key: "book" },
};
// RW-C's tables (0069): every one of RW's eleven, the same shape under the name `pm_rwc_…`, held to the same rules.
for (const t of Object.keys(PMRW_TABLES).filter((x) => x.startsWith("pm_rw_"))) PMRW_TABLES[t.replace(/^pm_rw_/, "pm_rwc_")] = PMRW_TABLES[t];
/** The RW table whose rules a table of RW's family follows: its own name, or RW's for one of RW-C's. */
const rwShape = (table: string) => table.replace(/^pm_rwc_/, "pm_rw_");
/** The view-count recorder's tables as 0062 creates them: their columns, the unique key each upsert names, and the defaults a proposed row takes. */
const VIEWS_TABLES: Record<string, { columns: string[]; key: string; defaults: Row }> = {
  yt_channels: { columns: ["channel_id", "handle", "title", "uploads", "first_seen"], key: "channel_id", defaults: {} },
  yt_videos: { columns: ["video_id", "channel_id", "title", "published_at", "duration_s", "short", "first_seen"], key: "video_id", defaults: { short: false } },
  yt_video_reads: { columns: ["video_id", "ts", "views", "likes", "comments", "seen_until", "reads"], key: "video_id,ts", defaults: { reads: 1 } },
  yt_channel_reads: { columns: ["channel_id", "ts", "subscribers", "views", "videos", "seen_until", "reads"], key: "channel_id,ts", defaults: { reads: 1 } },
  pm_view_markets: {
    columns: ["cond", "yes", "no", "event_slug", "event_start", "label", "question", "handle", "video_id", "window_h", "last_seen", "first_seen"],
    key: "cond", defaults: {},
  },
  pm_view_books: { columns: ["token", "ts", "bids", "asks", "seen_until", "reads"], key: "token,ts", defaults: { reads: 1 } },
  yt_quota: { columns: ["day", "units"], key: "day", defaults: { units: 0 } },
};
/**
 * The Polymarket order path's tables as 0074 creates them: their columns, and the unique key each upsert names (the
 * orders table is only inserted and updated). The orders table's unique indexes and the fills' foreign key are enforced
 * in `memDb` below.
 */
const PM_LIVE_SCHEMA: Record<string, { columns: string[]; key: string | null }> = {
  pm_live_config: {
    columns: ["id", "dry_run", "live_confirmed_at", "ireland_attested_at", "ireland_until", "cap_total_usd", "cap_market_usd", "loss_day_usd",
      "loss_total_usd", "max_posts_day", "gtd_lifetime_s", "updated_at", "max_markets", "select_budget_usd"],
    key: "id",
  },
  // 0076 keyed the day's markets by market, and added RW's first-round reading.
  pm_live_markets: {
    columns: ["day", "kind", "cond", "yes_token", "no_token", "neg_risk", "tick", "min_size", "reward_rate", "rank", "question", "detail", "selected_at",
      "max_spread", "n_size", "per_dollar_day", "capital", "formula_day", "end_date", "game_start"],
    key: "day,cond",
  },
  pm_live_minutes: {
    columns: ["mode", "minute", "cond", "rate", "max_spread", "min_size", "tick", "bb", "ba", "ab", "aa", "q1", "q2", "bid_price", "bid_size", "ask_price", "ask_size",
      "bid_scoring", "ask_scoring", "ours", "others", "formula_usd", "pct", "detail"],
    key: "mode,minute,cond",
  },
  pm_live_reward_days: {
    columns: ["mode", "day", "cond", "minutes", "minutes_two_sided", "minutes_scored", "formula_usd", "formula_scored_usd", "rate", "actual_usd",
      "actual_sponsored_usd", "rebate_usd", "read_at", "detail"],
    key: "mode,day,cond",
  },
  pm_live_settlements: { columns: ["cond", "yes_token", "no_token", "payout", "closed_time", "settled_at", "detail"], key: "cond" },
  pm_live_orders: {
    columns: ["id", "ts", "mode", "cond", "token", "outcome", "side", "price", "size", "order_type", "post_only", "expiration", "neg_risk", "hash",
      "state", "size_matched", "gate", "reason", "book_seen", "request", "response", "cancel_requested_at", "cancel_gate", "cancel_reason",
      "filled_at", "cancelled_at", "updated_at"],
    key: null,
  },
  pm_live_fills: {
    columns: ["trade_id", "hash", "cond", "token", "side", "price", "size", "status", "match_time", "tx_hash", "detail", "updated_at"],
    key: "trade_id,hash",
  },
  pm_live_events: { columns: ["mode", "minute", "kind", "detail"], key: "mode,minute,kind" },
  pm_live_state: { columns: ["id", "state", "updated_at", "last_error"], key: "id" },
};
const PM_LIVE_OPEN = ["pending", "live"];
/**
 * "Reward quotes small-pool"'s tables as 0077 creates them: their columns, the unique key each upsert names, the NOT NULL
 * columns a proposed row must carry, and their CHECKs. Exported for its tests.
 */
export const PM_PREP_SCHEMA: Record<string, { columns: string[]; key: string; notNull: string[]; check?: (r: Row) => string | null }> = {
  pm_prep_state: { columns: ["id", "state", "last_minute", "updated_at", "last_error"], key: "id", notNull: ["id", "state"], check: (r) => (r.id === 1 ? null : "id") },
  pm_prep_prints: {
    columns: ["id", "cond", "ts", "side", "oi", "price", "size"], key: "id", notNull: ["id", "cond", "ts", "side", "oi", "price", "size"],
    check: (r) => (["BUY", "SELL"].includes(String(r.side)) ? null : "side"),
  },
  pm_prep_minutes: {
    columns: ["minute", "cond", "class", "bb", "ba", "b", "a", "n", "qb", "qa", "close_only", "reward", "fills", "yes_held", "no_held", "mark", "detail"],
    key: "minute,cond", notNull: ["minute", "cond", "class"],
    check: (r) => (!["matched", "dark", "diverged", "held"].includes(String(r.class)) ? "class" : r.reward != null && !(Number(r.reward) >= 0) ? "reward"
      : r.fills != null && !(Number(r.fills) >= 0) ? "fills" : null),
  },
  pm_prep_fills: {
    columns: ["cond", "minute", "print_id", "ts", "side", "price", "size", "token", "token_side", "token_price", "close_only"], key: "cond,minute,print_id",
    notNull: ["cond", "minute", "print_id", "ts", "side", "price", "size", "token", "token_side", "token_price"],
    check: (r) => (!["bid", "ask"].includes(String(r.side)) ? "side" : !(Number(r.size) > 0) ? "size" : !["BUY", "SELL"].includes(String(r.token_side)) ? "token_side"
      : !(Number(r.token_price) > 0 && Number(r.token_price) < 1) ? "token_price" : null),
  },
  pm_prep_days: {
    columns: ["day", "reward", "reward_r40", "fills_pnl_day", "fills_pnl_total", "pnl_day_r40", "held_value", "fills", "minutes_matched", "minutes_dark",
      "minutes_diverged", "minutes_missing", "stop_day", "stop_total", "markets", "detail", "closed_at"],
    key: "day", notNull: ["day"],
  },
  pm_prep_settlements: {
    columns: ["cond", "yes_token", "no_token", "payout", "closed_time", "settled_at", "detail"], key: "cond", notNull: ["cond", "yes_token", "no_token", "payout", "settled_at"],
    check: (r) => (Number(r.payout) >= 0 && Number(r.payout) <= 1 ? null : "payout"),
  },
  pm_prep_events: {
    columns: ["minute", "kind", "detail"], key: "minute,kind", notNull: ["minute", "kind"],
    check: (r) => (["loss_stop_day", "loss_stop_total", "settlement"].includes(String(r.kind)) ? null : "kind"),
  },
};
/**
 * Mid-pool's tables (0081, 0084): the order path's nine as `pm_mid_*` and the layer's seven as `pm_midprep_*`, each the
 * shape of its small-pool namesake, held to the same rules but one: a reward rate in [$10, $50) on the markets and the
 * minutes. Until 0084 its config also refused `dry_run` false and any `live_confirmed_at`, and its orders every mode but
 * `dry_run`; 0084 dropped those, as mid-pool became the same order path as mini-pool, and added a rule across the two
 * configs (`oneArmedRefusal`). Postgres names a constraint by its own table, so the double's refusals name the mid table.
 */
const pmLiveShape = (table: string) => table.replace(/^pm_mid_/, "pm_live_");
const pmPrepShape = (table: string) => table.replace(/^pm_midprep_/, "pm_prep_");
const isMidTable = (table: string) => table.startsWith("pm_mid_");
const isPmLiveTable = (table: string) => pmLiveShape(table) in PM_LIVE_SCHEMA;
const isPmPrepTable = (table: string) => pmPrepShape(table) in PM_PREP_SCHEMA;
/** The orders table a fills table's foreign key references: `pm_live_orders`, or mid-pool's `pm_mid_orders`. */
const ordersOfFills = (table: string) => table.replace(/_fills$/, "_orders");
/** `agent_maker_probes`' columns as 0042 and 0050 leave them: PostgREST refuses a write naming any other. */
const PROBE_COLUMNS = ["id", "ts", "strategy_id", "order_id", "venue", "symbol", "side", "mode", "taker_price", "maker_price", "base_size",
  "state", "resolved_at", "minutes_to_fill", "mark_at_resolve", "follow_up", "expires_at", "watching", "fill_minute"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The venues the `*_venue_check` constraints admit, as migration 0049 leaves them: Binance joined for its paper rows. */
const VENUES = ["revx", "kraken", "binance"];

/**
 * What Postgres would refuse in this row, or null: the CHECK and NOT NULL constraints a write from the loop can break.
 * Called on the row AS IT WOULD BE STORED — the inserted row with its defaults, or the updated row with the patch merged.
 */
export function schemaRefusal(table: string, r: Row): string | null {
  const check = (name: string, ok: boolean) => (ok ? null : `new row for relation "${table}" violates check constraint "${table}_${name}_check"`);
  const notNull = (cols: string[]) => {
    for (const c of cols) if (r[c] === null || r[c] === undefined) return `null value in column "${c}" of relation "${table}" violates not-null constraint`;
    return null;
  };
  if (table === "agent_orders") {
    return notNull(["strategy_id", "venue", "symbol", "mode", "side", "price", "base_size", "client_order_id", "state", "filled_base", "fee_usd", "requotes"])
      ?? check("mode", ["paper", "live"].includes(String(r.mode)))
      ?? check("side", ["buy", "sell"].includes(String(r.side)))
      ?? check("venue", VENUES.includes(String(r.venue)))
      ?? check("state", ORDER_STATES.includes(String(r.state)))
      ?? check("price", Number(r.price) > 0)
      ?? check("base_size", Number(r.base_size) > 0);
  }
  if (table === "agent_maker_probes") {
    const unknown = Object.keys(r).find((c) => !PROBE_COLUMNS.includes(c));
    if (unknown) return `Could not find the '${unknown}' column of '${table}' in the schema cache`;
    return notNull(["strategy_id", "venue", "symbol", "side", "mode", "taker_price", "maker_price", "base_size", "state", "expires_at", "watching"])
      ?? check("mode", ["paper", "live"].includes(String(r.mode)))
      ?? check("side", ["buy", "sell"].includes(String(r.side)))
      ?? check("venue", VENUES.includes(String(r.venue)))
      ?? check("state", PROBE_STATES.includes(String(r.state)))
      ?? check("taker_price", Number(r.taker_price) > 0)
      ?? check("maker_price", Number(r.maker_price) > 0)
      ?? check("base_size", Number(r.base_size) > 0);
  }
  if (table in QUOTE_TABLES) {
    const unknown = Object.keys(r).find((c) => !QUOTE_TABLES[table].columns.includes(c));
    if (unknown) return `Could not find the '${unknown}' column of '${table}' in the schema cache`;
    if (table === "agent_quote_state") return check("id", r.id === 1) ?? notNull(["state"]);
    if (table === "agent_quote_prints") {
      return notNull(["id", "book", "ts", "price", "qty", "side"]) ?? check("book", QUOTE_BOOKS_OK.includes(String(r.book)))
        ?? check("price", Number(r.price) > 0) ?? check("qty", Number(r.qty) > 0) ?? check("side", ["buy", "sell"].includes(String(r.side)));
    }
    if (table === "agent_quote_inputs") {
      return notNull(["kind", "t", "value"]) ?? check("kind", ["fx", "fair:USDC-USD", "fair:USDT-USD"].includes(String(r.kind))) ?? check("value", Number(r.value) > 0);
    }
    if (table === "agent_quote_minutes") {
      return notNull(["book", "minute", "hours_n", "prints_n"]) ?? check("book", QUOTE_BOOKS_OK.includes(String(r.book)))
        ?? check("x", r.x === null || r.x === undefined || Number(r.x) > 0)
        ?? check("fair_u", r.fair_u === null || r.fair_u === undefined || Number(r.fair_u) > 0)
        ?? check("hours_n", Number.isInteger(Number(r.hours_n)) && Number(r.hours_n) >= 0)
        ?? check("prints_n", Number.isInteger(Number(r.prints_n)) && Number(r.prints_n) >= 0);
    }
    if (table === "agent_quote_events") {
      return notNull(["book", "minute", "side", "k", "kind", "detail"]) ?? check("book", QUOTE_BOOKS_OK.includes(String(r.book)))
        ?? check("side", ["bid", "ask", "-"].includes(String(r.side)))
        ?? check("kind", ["order", "refused", "withdraw", "fill", "exit", "stop", "book"].includes(String(r.kind)));
    }
    return notNull(["book", "side", "k", "t_entry", "fill_ts", "fill_print_id", "entry", "qty", "t_exit", "exit", "how", "notional_usd", "pnl_usd"])
      ?? check("book", QUOTE_BOOKS_OK.includes(String(r.book))) ?? check("side", ["bid", "ask"].includes(String(r.side)))
      ?? check("how", ["maker", "taker"].includes(String(r.how))) ?? check("entry", Number(r.entry) > 0) ?? check("qty", Number(r.qty) > 0)
      ?? check("exit", Number(r.exit) > 0);
  }
  if (table in VARIANT_TABLES) {
    const unknown = Object.keys(r).find((c) => !VARIANT_TABLES[table].columns.includes(c));
    if (unknown) return `Could not find the '${unknown}' column of '${table}' in the schema cache`;
    if (table === "agent_quotev_state") return check("id", r.id === 1) ?? notNull(["state"]);
    if (table === "agent_quotev_minutes") {
      return notNull(["book", "minute", "source", "hours_n", "prints_n"]) ?? check("book", QUOTE_BOOKS_OK.includes(String(r.book)))
        ?? check("source", ["minutes", "rebuilt"].includes(String(r.source)))
        ?? check("x", r.x == null || Number(r.x) > 0) ?? check("fair_u", r.fair_u == null || Number(r.fair_u) > 0)
        ?? check("hours_n", Number.isInteger(Number(r.hours_n)) && Number(r.hours_n) >= 0)
        ?? check("prints_n", Number.isInteger(Number(r.prints_n)) && Number(r.prints_n) >= 0);
    }
    if (table === "agent_quotev_events") {
      return notNull(["arm", "book", "minute", "side", "k", "kind", "detail"]) ?? check("arm", ["main", "top5"].includes(String(r.arm)))
        ?? check("book", QUOTE_BOOKS_OK.includes(String(r.book))) ?? check("side", ["bid", "ask", "-"].includes(String(r.side)))
        ?? check("kind", ["order", "refused", "withdraw", "fill", "exit", "stop"].includes(String(r.kind)))
        ?? check("key", r.key == null || VARIANT_KEYS.includes(String(r.key)))
        // A POST says what it was, and nothing else does: an order one of the six, a stop "stop".
        ?? check("what", r.kind === "order" ? VARIANT_ORDER_WHATS.includes(String(r.what)) : r.kind === "stop" ? r.what === "stop" : r.what == null);
    }
    return notNull(["arm", "key", "book", "side", "k", "t_entry", "fill_ts", "fill_print_id", "entry", "qty", "t_exit", "exit", "how", "notional_usd", "pnl_usd"])
      ?? check("arm", ["main", "top5"].includes(String(r.arm))) ?? check("key", VARIANT_KEYS.includes(String(r.key)))
      ?? check("book", QUOTE_BOOKS_OK.includes(String(r.book))) ?? check("side", ["bid", "ask"].includes(String(r.side)))
      ?? check("how", ["maker", "taker"].includes(String(r.how))) ?? check("entry", Number(r.entry) > 0) ?? check("qty", Number(r.qty) > 0)
      ?? check("exit", Number(r.exit) > 0);
  }
  if (table in RULED_TABLES) {
    const unknown = Object.keys(r).find((c) => !RULED_TABLES[table].columns.includes(c));
    if (unknown) return `Could not find the '${unknown}' column of '${table}' in the schema cache`;
    if (table === "agent_quoted_state") return check("id", r.id === 1) ?? notNull(["state"]);
    if (table === "agent_quoted_minutes") {
      return notNull(["book", "minute", "source", "hours_n", "prints_n", "x_source"]) ?? check("book", QUOTE_BOOKS_OK.includes(String(r.book)))
        ?? check("source", ["minutes", "rebuilt"].includes(String(r.source)))
        ?? check("x", r.x == null || Number(r.x) > 0) ?? check("fair_u", r.fair_u == null || Number(r.fair_u) > 0)
        ?? check("x_d", r.x_d == null || Number(r.x_d) > 0) ?? check("x_source", r.x_source === "yahoo" || r.x_source === "truefx")
        // 0073: a TrueFX minute's snapshot was read before the minute began (agent_quoted_minutes_truefx_before_turn).
        ?? check("truefx_before_turn", r.x_source !== "truefx" || (r.x_d_read != null && Date.parse(String(r.x_d_read)) < Date.parse(String(r.minute))))
        ?? check("hours_n", Number.isInteger(Number(r.hours_n)) && Number(r.hours_n) >= 0)
        ?? check("prints_n", Number.isInteger(Number(r.prints_n)) && Number(r.prints_n) >= 0);
    }
    if (table === "agent_quoted_events") {
      return notNull(["arm", "book", "minute", "side", "k", "kind", "detail"]) ?? check("arm", ["v1", "d"].includes(String(r.arm)))
        ?? check("book", QUOTE_BOOKS_OK.includes(String(r.book))) ?? check("side", ["bid", "ask", "-"].includes(String(r.side)))
        ?? check("kind", ["order", "refused", "withdraw", "fill", "exit", "stop"].includes(String(r.kind)))
        ?? check("key", r.key == null || VARIANT_KEYS.includes(String(r.key)))
        ?? check("what", r.kind === "order" ? VARIANT_ORDER_WHATS.includes(String(r.what)) : r.kind === "stop" ? r.what === "stop" : r.what == null);
    }
    return notNull(["arm", "key", "book", "side", "k", "t_entry", "fill_ts", "fill_print_id", "entry", "qty", "t_exit", "exit", "how", "notional_usd", "pnl_usd"])
      ?? check("arm", ["v1", "d"].includes(String(r.arm))) ?? check("key", VARIANT_KEYS.includes(String(r.key)))
      ?? check("book", QUOTE_BOOKS_OK.includes(String(r.book))) ?? check("side", ["bid", "ask"].includes(String(r.side)))
      ?? check("how", ["maker", "taker"].includes(String(r.how))) ?? check("entry", Number(r.entry) > 0) ?? check("qty", Number(r.qty) > 0)
      ?? check("exit", Number(r.exit) > 0);
  }
  if (table in PMRW_TABLES) {
    const unknown = Object.keys(r).find((c) => !PMRW_TABLES[table].columns.includes(c));
    if (unknown) return `Could not find the '${unknown}' column of '${table}' in the schema cache`;
    const shape = rwShape(table);
    if (shape === "pm_rw_state" || shape === "pm_rw_e_state" || shape === "pm_rw_x_state") return check("id", r.id === 1) ?? notNull(["state"]);
    if (table === "agent_book_levels") {
      return notNull(["book", "ts", "bids", "asks"]) ?? check("book", ["USDC-USD", "USDT-USD", "USDC-GBP", "USDT-GBP"].includes(String(r.book)))
        ?? check("reads", r.reads == null || Number(r.reads) >= 1);
    }
    // 0078's checks: one of the two GBP books, an index price above zero.
    if (table === "agent_quote_tickers") {
      return notNull(["book", "index_price", "ts"]) ?? check("book", ["USDC-GBP", "USDT-GBP"].includes(String(r.book))) ?? check("index_price", Number(r.index_price) > 0);
    }
    if (shape === "pm_rw_e_days" || shape === "pm_rw_x_days") {
      // 0085 added x4 and x5 to both variants' day tables (RW's and RW-C's).
      const arms = shape === "pm_rw_e_days" ? ["rw", "e"] : ["rw", "e", "x1", "x2", "x3", "x4", "x5"];
      return notNull(["day", "arm", "total", "stress_total", "reward", "fills", "capital", "markets", "detail"]) ?? check("arm", arms.includes(String(r.arm)))
        ?? check("fills", Number(r.fills) >= 0) ?? check("capital", Number(r.capital) >= 0) ?? check("markets", Number(r.markets) >= 0);
    }
    if (shape === "pm_rw_selection") {
      return notNull(["day", "cond", "rank", "yes", "tick", "v", "min_size", "rate", "per_dollar_day", "capital"])
        ?? check("rank", Number(r.rank) > 0) ?? check("tick", Number(r.tick) > 0) ?? check("v", Number(r.v) > 0)
        ?? check("min_size", Number(r.min_size) >= 0) ?? check("rate", Number(r.rate) >= 0) ?? check("capital", Number(r.capital) > 0);
    }
    if (shape === "pm_rw_minutes") return notNull(["cond", "minute", "quoting", "tick"]) ?? check("tick", Number(r.tick) > 0);
    if (shape === "pm_rw_prints") {
      return notNull(["id", "cond", "ts", "side", "oi", "price", "size"]) ?? check("side", ["BUY", "SELL"].includes(String(r.side)))
        ?? check("price", Number(r.price) >= 0 && Number(r.price) <= 1) ?? check("size", Number(r.size) > 0);
    }
    if (shape === "pm_rw_fills") {
      return notNull(["cond", "minute", "ts", "side", "price", "size", "print_id"]) ?? check("side", ["bid", "ask"].includes(String(r.side)))
        ?? check("price", Number(r.price) > 0 && Number(r.price) < 1) ?? check("size", Number(r.size) > 0);
    }
    if (shape === "pm_rw_days") {
      return notNull(["day", "total", "stress_total", "reward", "fills", "capital", "markets", "detail"])
        ?? check("fills", Number(r.fills) >= 0) ?? check("capital", Number(r.capital) >= 0) ?? check("markets", Number(r.markets) >= 0);
    }
    return notNull(["cond", "payout", "net", "cash"]) ?? check("payout", Number(r.payout) >= 0 && Number(r.payout) <= 1);
  }
  if (table in VIEWS_TABLES) {
    const unknown = Object.keys(r).find((c) => !VIEWS_TABLES[table].columns.includes(c));
    if (unknown) return `Could not find the '${unknown}' column of '${table}' in the schema cache`;
    if (table === "yt_channels") return notNull(["channel_id"]);
    if (table === "yt_videos") return notNull(["video_id", "channel_id", "published_at", "short"]);
    if (table === "yt_video_reads") return notNull(["video_id", "ts", "views", "seen_until", "reads"]) ?? check("views", Number(r.views) >= 0) ?? check("reads", Number(r.reads) >= 1);
    if (table === "yt_channel_reads") return notNull(["channel_id", "ts", "seen_until", "reads"]) ?? check("reads", Number(r.reads) >= 1);
    if (table === "pm_view_markets") return notNull(["cond", "yes", "no", "event_slug", "last_seen"]) ?? check("window_h", r.window_h == null || Number(r.window_h) > 0);
    if (table === "pm_view_books") return notNull(["token", "ts", "bids", "asks", "seen_until", "reads"]) ?? check("reads", Number(r.reads) >= 1);
    return notNull(["day", "units"]) ?? check("units", Number(r.units) >= 0);
  }
  if (table === "agent_decisions") {
    return notNull(["strategy_id", "venue", "symbol", "mode", "bar_start", "state", "numbers", "provider", "rule_action", "rule_reason", "final_action", "final_reason", "risk_allowed", "risk_reason"])
      ?? check("venue", VENUES.includes(String(r.venue)));
  }
  const side = twinSide(table);
  if (side) {
    const unknown = Object.keys(r).find((c) => !side.columns.includes(c));
    if (unknown) return `Could not find the '${unknown}' column of '${table}' in the schema cache`;
    return check("id", r.id === 1) ?? notNull(["state"]);
  }
  if (table === "agent_quote_twin_specs") {
    const unknown = Object.keys(r).find((c) => !TWIN_SPECS_COLUMNS.includes(c));
    if (unknown) return `Could not find the '${unknown}' column of '${table}' in the schema cache`;
    const id = String(r.id);
    return notNull(["id", "display_name", "display_order", "engine", "capital_gbp", "gov", "start", "table_prefix", "lease", "prereg", "migration", "enabled"])
      ?? check("id", /^[a-z][a-z0-9]{0,15}$/.test(id))
      ?? check("engine", ["pr5", "ruled-d"].includes(String(r.engine)))
      ?? check("capital_gbp", Number(r.capital_gbp) > 0)
      ?? check("gov", ["account", "variant-keys"].includes(String(r.gov)))
      ?? check("rules", r.rules == null || (typeof r.rules === "object" && !Array.isArray(r.rules)))
      ?? check("backfill", r.backfill == null || ["file", "sha256", "until"].every((k) => k in (r.backfill as Row)))
      // Its two two-column checks are unnamed in 0088, so Postgres calls them `…_check` and `…_check1`.
      ?? (r.table_prefix === `agent_quote_twin_${id}` ? null : `new row for relation "${table}" violates check constraint "${table}_check"`)
      ?? (r.lease === `quotes-twin-${id}` ? null : `new row for relation "${table}" violates check constraint "${table}_check1"`);
  }
  if (isLiveQuoteTable(table)) {
    const shape = liveQuoteShape(table);
    const unknown = Object.keys(r).find((c) => !LIVE_QUOTE_TABLES[shape].columns.includes(c));
    if (unknown) return `Could not find the '${unknown}' column of '${table}' in the schema cache`;
    if (shape === "agent_quote_live_config") {
      return check("id", r.id === 1) ?? notNull(["dry_run", "capital_gbp"]) ?? check("capital_gbp", Number(r.capital_gbp) > 0);
    }
    if (shape === "agent_quote_live_state") return check("id", r.id === 1) ?? notNull(["state"]);
    if (shape === "agent_quote_live_events") {
      // `deadman` since 0086 (the live table) and 0087 (the twins'): the dead-man's cancel of every resting order.
      return notNull(["mode", "minute", "book", "rung_side", "k", "kind", "detail"])
        ?? check("mode", ["dry_run", "live"].includes(String(r.mode)))
        ?? check("book", [...QUOTE_BOOKS_OK, "-"].includes(String(r.book)))
        ?? check("rung_side", ["bid", "ask", "-"].includes(String(r.rung_side)))
        ?? check("kind", ["skip", "guard", "stop_unfilled", "loss_stop", "deadman"].includes(String(r.kind)));
    }
    // agent_quote_live_orders. Its two table-level checks are unnamed in 0052, so Postgres calls them `…_check` and `…_check1`.
    return notNull(["mode", "book", "leg", "side", "price", "base_size", "client_order_id", "state", "filled_base", "fee_gbp"])
      ?? check("mode", ["dry_run", "live"].includes(String(r.mode)))
      ?? check("book", QUOTE_BOOKS_OK.includes(String(r.book)))
      ?? check("rung_side", r.rung_side == null || ["bid", "ask"].includes(String(r.rung_side)))
      ?? check("leg", ["entry", "exit", "stop", "convert"].includes(String(r.leg)))
      ?? check("side", ["buy", "sell"].includes(String(r.side)))
      ?? check("state", ORDER_STATES.includes(String(r.state)))
      ?? check("price", Number(r.price) > 0)
      ?? check("base_size", Number(r.base_size) > 0)
      ?? check("filled_base", Number(r.filled_base) >= 0)
      ?? (((r.leg === "convert") === (r.rung_side == null)) ? null : `new row for relation "${table}" violates check constraint "${table}_check"`)
      ?? (((r.rung_side == null) === (r.k == null)) ? null : `new row for relation "${table}" violates check constraint "${table}_check1"`);
  }
  if (isPmPrepTable(table)) {
    const sc = PM_PREP_SCHEMA[pmPrepShape(table)];
    const unknown = Object.keys(r).find((c) => !sc.columns.includes(c));
    if (unknown) return `Could not find the '${unknown}' column of '${table}' in the schema cache`;
    const nn = notNull(sc.notNull);
    if (nn) return nn;
    const bad = sc.check?.(r) ?? null;
    return bad ? `new row for relation "${table}" violates check constraint "${table}_${bad}_check"` : null;
  }
  if (isPmLiveTable(table)) {
    const shape = pmLiveShape(table), mid = isMidTable(table);
    const unknown = Object.keys(r).find((c) => !PM_LIVE_SCHEMA[shape].columns.includes(c) && !(mid && shape === "pm_live_config" && c === "created_at"));
    if (unknown) return `Could not find the '${unknown}' column of '${table}' in the schema cache`;
    // A CHECK passes on NULL, as Postgres's does; NOT NULL is what refuses a missing value.
    const ok = (c: string, f: (v: unknown) => boolean) => r[c] == null || f(r[c]);
    const MODES = ["dry_run", "live"];
    // Mid-pool's band (0081): [$10, $50), where small-pool's is [$0, $10) (RW's universe is $10 and over).
    const inBand = (v: unknown) => (mid ? Number(v) >= 10 && Number(v) < 50 : Number(v) >= 0 && Number(v) < 10);
    if (shape === "pm_live_config") {
      const within = (c: string, lo: number, hi: number, loOpen = true) => ok(c, (v) => (loOpen ? Number(v) > lo : Number(v) >= lo) && Number(v) <= hi);
      return check("id", r.id === 1)
        ?? notNull(["dry_run", "cap_total_usd", "cap_market_usd", "loss_day_usd", "loss_total_usd", "max_posts_day", "gtd_lifetime_s"])
        ?? check("cap_total_usd", within("cap_total_usd", 0, 320)) ?? check("cap_market_usd", within("cap_market_usd", 0, 60))
        ?? check("loss_day_usd", within("loss_day_usd", 0, 25)) ?? check("loss_total_usd", within("loss_total_usd", 0, 75))
        ?? check("max_posts_day", within("max_posts_day", 0, 6000, false)) ?? check("gtd_lifetime_s", within("gtd_lifetime_s", 180, 600, false))
        ?? check("max_markets", within("max_markets", 0, 12, false)) ?? check("select_budget_usd", within("select_budget_usd", 0, 320))
        ?? (r.ireland_until == null || r.ireland_attested_at != null ? null : `new row for relation "${table}" violates check constraint "${table}_check"`);
    }
    if (shape === "pm_live_minutes") {
      return notNull(["mode", "minute", "cond", "rate", "max_spread", "min_size", "tick", "ours", "others", "formula_usd", "detail"])
        ?? check("mode", MODES.includes(String(r.mode))) ?? check("rate", inBand(r.rate))
        ?? check("max_spread", Number(r.max_spread) >= 0) ?? check("min_size", Number(r.min_size) >= 0) ?? check("tick", Number(r.tick) > 0)
        ?? check("ours", Number(r.ours) >= 0) ?? check("others", Number(r.others) >= 0) ?? check("formula_usd", Number(r.formula_usd) >= 0);
    }
    if (shape === "pm_live_settlements") {
      return notNull(["cond", "yes_token", "no_token", "payout", "settled_at", "detail"]) ?? check("payout", Number(r.payout) >= 0 && Number(r.payout) <= 1);
    }
    if (shape === "pm_live_reward_days") {
      return notNull(["mode", "day", "cond", "minutes", "minutes_two_sided", "minutes_scored", "formula_usd", "formula_scored_usd", "read_at", "detail"])
        ?? check("mode", MODES.includes(String(r.mode)))
        ?? check("minutes", Number(r.minutes) >= 0) ?? check("minutes_two_sided", Number(r.minutes_two_sided) >= 0) ?? check("minutes_scored", Number(r.minutes_scored) >= 0)
        ?? check("formula_usd", Number(r.formula_usd) >= 0) ?? check("formula_scored_usd", Number(r.formula_scored_usd) >= 0)
        ?? (r.mode === "live" || (r.actual_usd == null && r.actual_sponsored_usd == null && r.rebate_usd == null) ? null : `new row for relation "${table}" violates check constraint "${table}_check"`);
    }
    if (shape === "pm_live_markets") {
      return notNull(["day", "kind", "cond", "yes_token", "no_token", "neg_risk", "tick", "min_size", "rank", ...(mid ? ["reward_rate"] : [])])
        ?? check("kind", ["standard", "neg_risk"].includes(String(r.kind))) ?? check("tick", Number(r.tick) > 0) ?? check("min_size", Number(r.min_size) > 0)
        ?? check("reward_rate", ok("reward_rate", inBand)) ?? check("rank", Number(r.rank) > 0)
        ?? ((r.kind === "neg_risk") === (r.neg_risk === true) ? null : `new row for relation "${table}" violates check constraint "${table}_check"`);
    }
    if (shape === "pm_live_orders") {
      return notNull(["mode", "cond", "token", "outcome", "side", "price", "size", "order_type", "post_only", "expiration", "neg_risk", "hash", "state", "size_matched", "gate"])
        ?? check("mode", MODES.includes(String(r.mode))) ?? check("outcome", ["yes", "no"].includes(String(r.outcome)))
        ?? check("side", ["BUY", "SELL"].includes(String(r.side))) ?? check("price", Number(r.price) > 0 && Number(r.price) < 1)
        ?? check("size", Number(r.size) > 0) ?? check("order_type", r.order_type === "GTD") ?? check("post_only", r.post_only === true)
        ?? check("expiration", Number(r.expiration) > 0) ?? check("hash", /^0x[0-9a-f]{64}$/.test(String(r.hash)))
        ?? check("state", ["pending", "live", "filled", "cancelled", "expired", "rejected"].includes(String(r.state)))
        ?? check("size_matched", Number(r.size_matched) >= 0) ?? check("gate", ["open", "reduce"].includes(String(r.gate)));
    }
    if (shape === "pm_live_fills") {
      return notNull(["trade_id", "hash", "cond", "token", "side", "price", "size", "status"])
        ?? check("side", ["BUY", "SELL"].includes(String(r.side))) ?? check("price", Number(r.price) > 0 && Number(r.price) < 1)
        ?? check("size", Number(r.size) > 0) ?? check("status", ["MATCHED", "MINED", "CONFIRMED", "RETRYING", "FAILED"].includes(String(r.status)));
    }
    if (shape === "pm_live_events") {
      return notNull(["mode", "minute", "kind", "detail"]) ?? check("mode", MODES.includes(String(r.mode)))
        ?? check("kind", ["gates", "selection", "loss_stop_day", "loss_stop_total", "governor", "alert", "condition", "readout"].includes(String(r.kind)));
    }
    return check("id", r.id === 1) ?? notNull(["state"]);
  }
  return null;
}

/** The two configs of the one Polymarket account the order path's instances trade (0084's trigger reads both). */
const PM_ONE_ACCOUNT_CONFIGS = ["pm_live_config", "pm_mid_config"];
/**
 * 0084's trigger `pm_one_account_one_armed`, on both configs: a row written armed (`live_confirmed_at` not null) is refused
 * while the other config's row is armed, in Postgres's words (the exception it raises, as a check violation). Applied to
 * the row as stored, on INSERT, UPDATE and an upsert's merge, after the row's own checks, as an AFTER trigger fires.
 */
function oneArmedRefusal(tables: Record<string, Row[]>, table: string, r: Row): string | null {
  if (!PM_ONE_ACCOUNT_CONFIGS.includes(table) || r.live_confirmed_at == null) return null;
  const other = table === "pm_live_config" ? "pm_mid_config" : "pm_live_config";
  return (tables[other] ?? []).some((x) => x.live_confirmed_at != null)
    ? `${table} cannot be armed while ${other} is armed: mini-pool and mid-pool trade one Polymarket account` : null;
}

/**
 * 0074's unique constraints on `pm_live_orders`, as Postgres applies them to the row as stored (on INSERT and UPDATE):
 * `hash text not null unique`, and never two OPEN rows (pending or live) on one market, token and side of one mode —
 * the partial index `pm_live_orders_one_open_per_slot`.
 */
function pmLiveOrderConflict(rows: Row[], r: Row, self: Row | null, table = "pm_live_orders"): string | null {
  const others = rows.filter((x) => x !== self);
  if (others.some((x) => x.hash === r.hash)) return `409: duplicate key value violates unique constraint "${table}_hash_key"`;
  const open = (x: Row) => PM_LIVE_OPEN.includes(String(x.state));
  if (open(r) && others.some((x) => open(x) && x.mode === r.mode && x.cond === r.cond && x.token === r.token && x.side === r.side)) {
    return `409: duplicate key value violates unique constraint "${table}_one_open_per_slot"`;
  }
  return null;
}

/**
 * 0052's two unique indexes on `agent_quote_live_orders`, as Postgres applies them to the row as stored (on INSERT and on
 * UPDATE): `client_order_id uuid unique`, and never two OPEN rows on one rung of one mode — the partial index
 * `agent_quote_live_orders_one_open_per_rung`. A conversion (no rung) is outside the second.
 */
function liveQuoteOrderConflict(rows: Row[], r: Row, self: Row | null, table = "agent_quote_live_orders"): string | null {
  if (!UUID.test(String(r.client_order_id))) return `400: invalid input syntax for type uuid: "${r.client_order_id}"`;
  const others = rows.filter((x) => x !== self);
  if (others.some((x) => x.client_order_id === r.client_order_id)) {
    return `409: duplicate key value violates unique constraint "${table}_client_order_id_key"`;
  }
  const open = (x: Row) => LIVE_OPEN_STATES.includes(String(x.state)) && x.rung_side != null;
  if (open(r) && others.some((x) => open(x) && x.mode === r.mode && x.book === r.book && x.rung_side === r.rung_side && Number(x.k) === Number(r.k))) {
    return `409: duplicate key value violates unique constraint "${table}_one_open_per_rung"`;
  }
  return null;
}

/**
 * Postgres's column defaults for the rows the loop inserts (0037, 0042): what a real INSERT stores when a column is left
 * out — a nullable column included, which reads back as `null`, never as a missing key.
 */
function withDefaults(table: string, r: Row): Row {
  if (table === "agent_orders") {
    return {
      state: "new", filled_base: 0, fee_usd: 0, requotes: 0, order_type: "limit",
      decision_id: null, venue_order_id: null, request: null, response: null, avg_fill_price: null, filled_at: null, cancelled_at: null, ...r,
    };
  }
  if (table === "agent_maker_probes") return { state: "resting", follow_up: {}, watching: true, fill_minute: null, ...r };
  if (liveQuoteShape(table) === "agent_quote_live_orders") {
    return {
      rung_side: null, k: null, venue_order_id: null, state: "pending", filled_base: 0, avg_fill_price: null, fee_gbp: 0, paper_oid: null, paper_live: null,
      fair: null, request: null, response: null, book_seen: null, cancel_requested_at: null, cancel_reason: null, filled_at: null, cancelled_at: null, ...r,
    };
  }
  if (pmLiveShape(table) === "pm_live_orders") {
    return {
      state: "pending", size_matched: 0, reason: null, book_seen: null, request: null, response: null, cancel_requested_at: null, cancel_gate: null,
      cancel_reason: null, filled_at: null, cancelled_at: null, ...r,
    };
  }
  return r;
}

/** What JSON does to a value on its way to PostgREST: NaN and ±Infinity become null, undefined keys vanish. */
const overTheWire = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export type MemDbHooks = {
  beforeDecisionInsert?: (tables: Record<string, Row[]>, row: Row) => void;
  beforeOrderInsert?: (tables: Record<string, Row[]>, row: Row) => void;
};

/** One item of a PostgREST select list: the name it answers under, its column, and the JSON path into it, if any. */
export type SelectItem = { name: string; base: string; keys: string[]; text: boolean };
/**
 * PostgREST's select list: a column, `alias:column`, or a JSON path, `column->key` (JSON) or `column->>key` (text), named
 * by its alias or else by its last key. The double and the tests that read as the dashboard reads both parse it here.
 */
export function selectItems(select: string[]): SelectItem[] {
  return select.map((item) => {
    const colon = item.indexOf(":");
    const alias = colon > 0 ? item.slice(0, colon) : null, expr = colon > 0 ? item.slice(colon + 1) : item;
    const parts = expr.split(/->>?/), base = parts[0], keys = parts.slice(1), text = /->>[^>]*$/.test(expr);
    return { name: alias ?? (keys.length ? keys[keys.length - 1] : base), base, keys, text };
  });
}
/** A row as PostgREST answers a select list: each item under its name; a path that leads nowhere is null. */
export function pickRow(items: SelectItem[], r: Row): Row {
  return Object.fromEntries(items.map(({ name, base, keys, text }) => {
    let v: unknown = r[base];
    for (const k of keys) v = v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>)[k] ?? null : null;
    return [name, keys.length && text && v != null ? (typeof v === "object" ? JSON.stringify(v) : String(v)) : v];
  }));
}

/**
 * Enough of PostgREST for what the loop asks, with the schema's rules: CHECK and NOT NULL on every write
 * (`schemaRefusal`), the unique indexes the loop relies on (one decision per bar, one order per decision attempt, one
 * order per uuid `client_order_id`), Postgres's defaults, a merge-on-conflict upsert, multi-column `order=`, and
 * PostgREST's silent cap — a select with no `limit` returns at most `PAGE_ROWS` rows, exactly as Supabase's `max-rows`
 * does. `now` stamps `ts` on an insert, as the database's `now()` does.
 */
export function memDb(seed: Record<string, Row[]>, opts: { now: () => number; hooks?: MemDbHooks }) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const hooks = opts.hooks ?? {};
  let nextId = 1000;
  const cmp = (a: unknown, b: unknown) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0);
  const parse = (query: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let order: { col: string; dir: 1 | -1 }[] = [], limit = PAGE_ROWS, offset = 0, select: string[] | null = null;
    for (const part of query.split("&")) {
      const i = part.indexOf("=");
      const k = part.slice(0, i), v = part.slice(i + 1);
      if (k === "select") { select = v === "*" ? null : v.split(","); continue; }
      // Every column of `order=a.asc,b.desc`, each with its own direction (the first double read the first column only,
      // and turned `ts.desc,id.desc` into ascending).
      if (k === "order") { order = v.split(",").map((t) => { const [col, dir] = t.split("."); return { col, dir: dir === "desc" ? -1 : 1 }; }); continue; }
      if (k === "limit") { limit = Math.min(Number(v), PAGE_ROWS); continue; }
      if (k === "offset") { offset = Number(v); continue; }
      // PostgREST's `or=(a.op.v,b.op.v)`: a row passes when any of its conditions does (a realistic twin's page reads its
      // orders that filled or rest this way).
      if (k === "or") { const any = orConditions(v); filters.push((r) => any.some((f) => f(r))); continue; }
      const m = v.match(/^(eq|in|gte|lte|lt|is)\.(.*)$/);
      if (!m) throw new Error(`stub db: unsupported filter ${part}`);
      const val = decodeURIComponent(m[2]);
      if (m[1] === "is") { if (val !== "null" && val !== "not.null") throw new Error(`stub db: unsupported filter ${part}`); filters.push((r) => (r[k] == null) === (val === "null")); }
      if (m[1] === "eq") filters.push((r) => String(r[k]) === val);
      if (m[1] === "in") { const set = val.slice(1, -1).split(","); filters.push((r) => set.includes(String(r[k]))); }
      if (m[1] === "gte") filters.push((r) => String(r[k]) >= val);
      if (m[1] === "lt") filters.push((r) => String(r[k]) < val);
      if (m[1] === "lte") filters.push((r) => String(r[k]) <= val);
    }
    return { filters, order, limit, offset, select };
  };
  const refuse = (method: string, table: string, why: string) => Promise.reject(new Error(`db ${method} ${table} → 400: ${why}`));
  const db: Db = {
    select: (table, query) => {
      const { filters, order, limit, offset, select } = parse(query);
      let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (order.length) rows = rows.slice().sort((a, b) => { for (const o of order) { const c = cmp(a[o.col], b[o.col]) * o.dir; if (c) return c; } return 0; });
      rows = rows.slice(offset, offset + limit);
      // deno-lint-ignore no-explicit-any
      if (!select) return Promise.resolve(rows.map((r) => ({ ...r })) as any);
      const items = selectItems(select);
      // A path's base column must exist, as PostgREST refuses one that does not.
      const known = LIVE_QUOTE_TABLES[liveQuoteShape(table)]?.columns ?? twinSide(table)?.columns ?? (table === "agent_quote_twin_specs" ? TWIN_SPECS_COLUMNS : undefined);
      const missing = known && items.find((i) => i.keys.length && !known.includes(i.base));
      if (missing) return refuse("select", table, `column ${missing.base} does not exist`);
      // deno-lint-ignore no-explicit-any
      return Promise.resolve(rows.map((r) => pickRow(items, r)) as any);
    },
    insert: (table, rows, returning = true) => {
      // A POST to `rpc/<name>` runs a function, as PostgREST does; one no migration created is PostgREST's 404.
      if (table.startsWith("rpc/")) {
        const fn = RPC[table.slice(4)];
        if (!fn) return Promise.reject(new Error(`db POST ${table} → 404: {"code":"PGRST202","message":"Could not find the function public.${table.slice(4)} in the schema cache"}`));
        fn(tables);
        return Promise.resolve([]);
      }
      const list = (overTheWire(Array.isArray(rows) ? rows : [rows]) as Row[]).map((r) => withDefaults(table, r));
      for (const r of list) {
        const why = schemaRefusal(table, r) ?? oneArmedRefusal(tables, table, r);
        if (why) return refuse("POST", table, why);
      }
      if (table === "agent_decisions") {
        for (const r of list) {
          hooks.beforeDecisionInsert?.(tables, r);
          const dup = (tables[table] ?? []).some((x) => x.strategy_id === r.strategy_id && x.symbol === r.symbol && x.bar_start === r.bar_start);
          if (dup) return Promise.reject(new Error("db POST agent_decisions → 409: duplicate key value violates unique constraint \"agent_decisions_one_per_bar\""));
        }
      }
      if (table === "agent_orders") {
        for (const r of list) {
          hooks.beforeOrderInsert?.(tables, r);
          // `client_order_id uuid not null unique` (0037): the id the venue reconciles a lost reply by, so two orders must
          // never share one — the double used to take any string, and every order in a test world carried the same id.
          if (!UUID.test(String(r.client_order_id))) return refuse("POST", table, `invalid input syntax for type uuid: "${r.client_order_id}"`);
          if ((tables[table] ?? []).some((x) => x.client_order_id === r.client_order_id)) {
            return Promise.reject(new Error("db POST agent_orders → 409: duplicate key value violates unique constraint \"agent_orders_client_order_id_key\""));
          }
          if (r.decision_id == null) continue;
          const dup = (tables[table] ?? []).some((x) => x.decision_id === r.decision_id && Number(x.requotes ?? 0) === Number(r.requotes ?? 0));
          if (dup) return Promise.reject(new Error("db POST agent_orders → 409: duplicate key value violates unique constraint \"agent_orders_one_per_decision_attempt\""));
        }
      }
      if (liveQuoteShape(table) === "agent_quote_live_orders") {
        const seen: Row[] = [...(tables[table] ?? [])];
        for (const r of list) {
          const why = liveQuoteOrderConflict(seen, r, null, table);
          if (why) return Promise.reject(new Error(`db POST ${table} → ${why}`));
          seen.push(r);
        }
      }
      if (pmLiveShape(table) === "pm_live_orders") {
        const seen: Row[] = [...(tables[table] ?? [])];
        for (const r of list) {
          const why = pmLiveOrderConflict(seen, r, null, table);
          if (why) return Promise.reject(new Error(`db POST ${table} → ${why}`));
          seen.push(r);
        }
      }
      if (pmLiveShape(table) === "pm_live_fills") {
        for (const r of list) if (!(tables[ordersOfFills(table)] ?? []).some((o) => o.hash === r.hash)) return Promise.reject(new Error(`db POST ${table} → 409: insert or update on table "${table}" violates foreign key constraint "${table}_hash_fkey"`));
      }
      const out = list.map((r) => ({ id: nextId++, ts: new Date(opts.now()).toISOString(), ...r }));
      (tables[table] ??= []).push(...out);
      // deno-lint-ignore no-explicit-any
      return Promise.resolve((returning ? out : []) as any);
    },
    upsert: (table, rows, onConflict) => {
      // PostgREST's `resolution=merge-duplicates`: a row whose conflict key exists is merged, not appended. Postgres
      // checks the row as stored, and refuses an ON CONFLICT that names no unique key; so does this.
      const keys = onConflict.split(",");
      if ((table in QUOTE_TABLES && onConflict !== QUOTE_TABLES[table].key) || (isLiveQuoteTable(table) && onConflict !== liveQuoteKey(table))
        || (twinSide(table) && onConflict !== twinSide(table)?.key)
        || (table in PMRW_TABLES && onConflict !== PMRW_TABLES[table].key) || (table in VIEWS_TABLES && onConflict !== VIEWS_TABLES[table].key)
        || (table in VARIANT_TABLES && onConflict !== VARIANT_TABLES[table].key)
        || (table in RULED_TABLES && onConflict !== RULED_TABLES[table].key)
        || (isPmLiveTable(table) && onConflict !== PM_LIVE_SCHEMA[pmLiveShape(table)].key)
        || (isPmPrepTable(table) && onConflict !== PM_PREP_SCHEMA[pmPrepShape(table)].key)) {
        return refuse("POST", table, "there is no unique or exclusion constraint matching the ON CONFLICT specification");
      }
      const t = (tables[table] ??= []);
      const list = overTheWire(rows) as Row[];
      for (const r of list) {
        const cur = t.find((x) => keys.every((k) => String(x[k]) === String(r[k])));
        // Postgres checks NOT NULL on the row an upsert PROPOSES, before it looks for the conflict: an ON CONFLICT
        // update that leaves out a not-null column is refused even when the row exists. The paper RW tables are held
        // to that (their decisions are written as upserts onto rows recorded a minute earlier).
        // The recorder's tables (0062) likewise: the proposed row, with the defaults Postgres fills in. The order path's
        // (0074) too: every upsert it makes proposes whole rows.
        const twinOrders = TWIN_SHAPE.test(table) && liveQuoteShape(table) === "agent_quote_live_orders";
        const why = schemaRefusal(table, table in PMRW_TABLES || isPmLiveTable(table) || isPmPrepTable(table) ? r : table in VIEWS_TABLES ? { ...VIEWS_TABLES[table].defaults, ...r }
          : cur ? { ...cur, ...r } : twinOrders ? withDefaults(table, r) : r);
        if (why) return refuse("POST", table, why);        // the statement fails whole: nothing is written
        // A twin's orders, upserted by their client id when a backfill is loaded: the row as stored keeps 0052's indexes.
        if (twinOrders) {
          const clash = liveQuoteOrderConflict(t, cur ? { ...cur, ...r } : withDefaults(table, r), cur ?? null, table);
          if (clash) return Promise.reject(new Error(`db POST ${table} → ${clash}`));
        }
        const armed = oneArmedRefusal(tables, table, cur ? { ...cur, ...r } : r);
        if (armed) return refuse("POST", table, armed);
        if (pmLiveShape(table) === "pm_live_fills" && !(tables[ordersOfFills(table)] ?? []).some((o) => o.hash === r.hash)) {
          return Promise.reject(new Error(`db POST ${table} → 409: insert or update on table "${table}" violates foreign key constraint "${table}_hash_fkey"`));
        }
      }
      for (const r of list) {
        const i = t.findIndex((x) => keys.every((k) => String(x[k]) === String(r[k])));
        // A new row of a table with an identity column takes its next value, as Postgres fills it; a merged row keeps its own.
        const identity = VARIANT_TABLES[table]?.identity ?? RULED_TABLES[table]?.identity;
        const twinOrders = TWIN_SHAPE.test(table) && liveQuoteShape(table) === "agent_quote_live_orders";
        if (i >= 0) t[i] = { ...t[i], ...r };
        else if (twinOrders) t.push({ id: nextId++, ts: new Date(opts.now()).toISOString(), ...withDefaults(table, r) });
        else t.push(identity ? { [identity]: nextId++, ...r } : { ...r });
      }
      return Promise.resolve();
    },
    update: (table, query, patch) => {
      const { filters } = parse(query);
      const wire = overTheWire(patch) as Row;
      const hit = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      for (const r of hit) {
        const why = schemaRefusal(table, { ...r, ...wire }) ?? oneArmedRefusal(tables, table, { ...r, ...wire });
        if (why) return refuse("PATCH", table, why);     // Postgres refuses the statement: no row changes
        if (liveQuoteShape(table) === "agent_quote_live_orders") {
          const clash = liveQuoteOrderConflict(tables[table], { ...r, ...wire }, r, table);
          if (clash) return Promise.reject(new Error(`db PATCH ${table} → ${clash}`));
        }
        if (pmLiveShape(table) === "pm_live_orders") {
          const clash = pmLiveOrderConflict(tables[table], { ...r, ...wire }, r, table);
          if (clash) return Promise.reject(new Error(`db PATCH ${table} → ${clash}`));
        }
      }
      for (const r of hit) Object.assign(r, wire);
      return Promise.resolve();
    },
    claim: (table, query, patch) => {
      const { filters } = parse(query);
      const hit = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      for (const r of hit) Object.assign(r, overTheWire(patch) as Row);
      // deno-lint-ignore no-explicit-any
      return Promise.resolve(hit.map((r) => ({ ...r })) as any);
    },
    selectAll: async (table, query) => {
      assertPagedOrder(table, query);   // the real client's rule, not a copy of it — see db.ts
      const out: unknown[] = [];
      for (let offset = 0; ; offset += PAGE_ROWS) {
        const page = await db.select(table, `${query}&limit=${PAGE_ROWS}&offset=${offset}`);
        out.push(...page);
        if (page.length < PAGE_ROWS) break;
      }
      // deno-lint-ignore no-explicit-any
      return out as any;
    },
  };
  return { db, tables };
}

/**
 * The same database, for a module that may touch only its own tables: any call that names another table throws
 * before it reaches the rows, so a stray read of RW's or RW-C's tables fails the test that made it. `agent_locks` is
 * further held to the module's own lease row, and `agent_risk` to reads.
 */
export function onlyTables(db: Db, allowed: readonly string[], opts: { lease?: string; readOnly?: readonly string[] } = {}): Db & { touched: Set<string> } {
  const touched = new Set<string>();
  const guard = (method: string, table: string, query = "") => {
    if (!allowed.includes(table)) throw new Error(`stub db: this module may not touch ${table} (${method})`);
    if (table === "agent_locks" && opts.lease && !query.includes(`name=eq.${opts.lease}`)) throw new Error(`stub db: agent_locks only through its own lease row ${opts.lease}`);
    if (opts.readOnly?.includes(table) && method !== "select") throw new Error(`stub db: ${table} is read-only for this module (${method})`);
    touched.add(table);
  };
  return {
    touched,
    select: (t, q) => { guard("select", t, q); return db.select(t, q); },
    selectAll: (t, q) => { guard("select", t, q); return db.selectAll(t, q); },
    insert: (t, r, x) => { guard("insert", t); return db.insert(t, r, x); },
    upsert: (t, r, k) => { guard("upsert", t); return db.upsert(t, r, k); },
    update: (t, q, p) => { guard("update", t, q); return db.update(t, q, p); },
    claim: (t, q, p) => { guard("claim", t, q); return db.claim(t, q, p); },
  };
}

// ── a fake Polymarket, as strict as the CLOB the order path will meet ─────────────────────────────────

/** The published test key the official clients' own tests use (Hardhat's #0), its address, and a stand-in proxy wallet. */
export const PM_TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const PM_TEST_SIGNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const PM_TEST_FUNDER = "0x1111111111111111111111111111111111111111";
/** A made-up API key id: what the fake expects as a POST body's `owner`. */
export const PM_TEST_OWNER = "00000000-1111-4222-8333-444444444444";

/**
 * A market as the fake lists it: its touch, its tick and minimum, its daily reward rate in each listing (null: not listed
 * there), and its reward programme. `depth` is the book behind each touch, as (ticks from the touch, size) on both sides.
 */
type FakePmMarket = {
  cond: string; yes: string; no: string; bid: number; ask: number; tick: string; minSize: number; negRisk: boolean; rate: number | null; sponsoredRate: number | null;
  accepting: boolean;
  /** The reward programme's minimum size and maximum spread (cents), as `/rewards/markets/current` lists them. */
  rewardsMinSize: number; maxSpread: number;
  depth: Array<[number, number]>;
  /** Gamma's times, as Gamma writes them (`endDate` ISO, `gameStartTime` Postgres-style); absent when Gamma gives none. */
  endDate?: string | null; gameStartTime?: string | null;
  /** Closed or resolved: its book is gone (`/book` answers 404, as the CLOB does) and Gamma shows it closed. */
  resolved?: boolean;
  /** Gamma's `outcomePrices[0]` once resolved: YES's payout; and its `closedTime`, as Gamma writes it. */
  payout?: number;
  closedTime?: string;
};
type FakePmOrder = {
  hash: string; token: string; side: "BUY" | "SELL"; price: number; size: number; matched: number; status: string; expiration: number;
  orderType: string; trades: string[]; cond: string; at: number;
  /** A cancel taken and not yet carried out (`cancelLagReads`): when it was asked, and how many reads still show it resting. */
  cancelAsked?: number; cancelReadsLeft?: number;
};
type FakePmTrade = { id: string; hash: string; token: string; side: "BUY" | "SELL"; price: number; size: number; status: string; at: number };
type Answer = { status: number; body: unknown; retryAfter?: number };

/**
 * Polymarket's CLOB, Gamma and geoblock as the order path meets them, answering in the documented shapes (reference
 * §2d; docs.polymarket.com read 2026-10-01). As strict as the venue, and stricter where the venue's word is unknown:
 *   * POST /order refuses a price off the market's tick ("breaks minimum tick size rule"), a size under its minimum in
 *     shares, a GTD expiration under three minutes ahead ("invalid expiration"), a signature that does not recover to
 *     the API key's address over the right exchange's domain, a signer other than the key's ("the order signer address
 *     has to be the address of the API KEY"), a maker other than its proxy wallet ("the order owner has to be the owner
 *     of the API KEY"), an owner other than the key, a post-only order that would take — against everything resting,
 *     our own orders included ("invalid post-only order: order crosses book") —, an order the account cannot fund or
 *     hold ("not enough balance / allowance"), any buy while the account is in closed-only mode, an order from a country
 *     the geoblock blocks (a buy from a close-only one; the venue's wording is not documented, so this one is the
 *     double's), and a hash it has already seen ("Duplicated.").
 *   * Its book is the market's ONE book, as the CLOB's is (2026-10-01: NO's book is YES's mirror): our resting orders
 *     are in it, a BUY of NO at p as an ask at 1 − p. A rule that reads its own orders as the market's would chase them.
 *   * Its reward listing pages as the CLOB's does: in condition-id order, `limit` rows a page, the cursor base64 of the
 *     row offset ("LTE=" past the end, a 400 for one it cannot decode); `onRewardsPage` can move the listing between
 *     two reads, as the real one moves.
 *   * It answers 425 while `restart` is set, and can take an order and lose the reply, or lose a cancel.
 *   * A cancel it takes (one order, or all of them) is carried out a moment AFTER its reply: the order reads back LIVE,
 *     sits in the book and can still fill for `cancelLagReads` reads of it (1 by default), or until a second has passed.
 *     Polymarket's docs word a cancel's reply as its outcome, which suggests the CLOB carries a cancel out before it
 *     answers; nothing says when GET /data/order shows it, and Revolut X was measured a read behind on PR5's first live
 *     hour (2026-10-01). A double must not be looser than the venue, so this one is that read behind.
 *   * A taker fills a resting order only through `fill`, which writes a MATCHED trade; `settle` makes it final.
 *   * An order past its expiration less a minute reads back CANCELED (the docs do not say what an expired GTD order reads
 *     as: this is the double's assumption, and the path never relies on it, because it replaces an order before then).
 *   * An order is scoring (`/order-scoring`) when it rests, its remaining size is at least the reward minimum, it is
 *     inside the maximum spread of the market's midpoint, and it has rested `scoringDelayS` (the venue's "required
 *     duration" is not documented: 0 here unless a test sets it).
 */
export class FakePolymarket {
  calls: string[] = [];
  /** Every request URL, with its query, as sent. */
  urls: string[] = [];
  /** Every request body it received, as sent. */
  bodies: string[] = [];
  geo: { blocked: boolean; country: string; region: string; ip: string } = { blocked: true, country: "IE", region: "L", ip: "203.0.113.7" };
  closedOnlyFlag = false;
  pusd = 1000;
  tokens = new Map<string, number>();
  markets: FakePmMarket[] = [];
  orders = new Map<string, FakePmOrder>();
  trades = new Map<string, FakePmTrade>();
  restart = false;
  postMode: "ok" | "lose-reply" | "500-after-accept" | "500" | "429" | "503" = "ok";
  cancelMode: "ok" | "lost" | "throw" = "ok";
  /** Reads of an order that still show it resting after its cancel was taken (0: carried out at once). */
  cancelLagReads = 1;
  orderReadDown = false;
  down: Partial<Record<"geoblock" | "closedOnly" | "balance" | "collateral" | "book" | "rewards" | "gamma" | "scoring" | "earnings" | "rebates", boolean>> = {};
  /** The OpenAPI's spelling of a trade status (TRADE_STATUS_…) instead of the clients' (CONFIRMED …). */
  tradeStatusPrefix = "";
  /** The reward listing's page size (the CLOB's is 500). */
  rewardsPageSize = 4;
  /** Called before a page of the listing is answered, with its offset: a test moves the listing here. */
  onRewardsPage: ((offset: number, sponsored: boolean) => void) | null = null;
  /** How long an order must rest before it scores. */
  scoringDelayS = 0;
  /** The account's live share of each pool, in percent (GET /rewards/user/percentages). */
  percentages: Record<string, number> = {};
  /** What the account earned, by UTC day: native, and sponsored only (GET /rewards/user). */
  earnings: Record<string, { native: Array<{ cond: string; usd: number }>; sponsored: Array<{ cond: string; usd: number }> }> = {};
  /** Maker rebates, by UTC day (GET /rebates/current answers `null` for a day with none, as the real one does). */
  rebatesByDay: Record<string, Array<{ cond: string; usdc: string }>> = {};
  /** Each market's taker prints, as the data API's /v2/trades lists them: [ts (s), side, outcome index, price, size]. */
  prints = new Map<string, Array<[number, "BUY" | "SELL", number, number, number]>>();
  /** The CLOB's short list's page size (`/sampling-simplified-markets`; the CLOB's is 1,000). */
  simplifiedPageSize = 3;
  /** The keyless public reads that can be made to fail, as the venue's own (`down`). */
  publicDown: Partial<Record<"simplified" | "books" | "trades", boolean>> = {};
  private seq = 1;
  constructor(public now: () => number) {}

  addMarket(m: Partial<FakePmMarket> & { cond: string; yes: string; no: string }): FakePmMarket {
    const minSize = m.minSize ?? 5;
    const full: FakePmMarket = {
      bid: 0.45, ask: 0.47, tick: "0.01", negRisk: false, rate: null, accepting: true, maxSpread: 4.5, depth: [[0, 50], [1, 100]], ...m, minSize,
      rewardsMinSize: m.rewardsMinSize ?? minSize, sponsoredRate: m.sponsoredRate === undefined ? (m.rate == null ? null : m.rate / 2) : m.sponsoredRate,
    };
    this.markets.push(full);
    return full;
  }
  private marketOf(token: string): { m: FakePmMarket; outcome: "yes" | "no" } | null {
    for (const m of this.markets) {
      if (m.yes === token) return { m, outcome: "yes" };
      if (m.no === token) return { m, outcome: "no" };
    }
    return null;
  }
  /**
   * A market's one book in YES terms: its configured levels, and every order of ours resting in it (a YES bid or a NO
   * sell is a bid; a YES sell or a NO bid an ask, at 1 − p for NO).
   */
  yesBook(m: FakePmMarket): { bids: Array<[number, number]>; asks: Array<[number, number]> } {
    for (const o of this.orders.values()) this.landCancel(o);
    const step = Number(m.tick), r = (x: number) => Number(x.toFixed(6));
    const lv = new Map<string, number>(), la = new Map<string, number>();
    for (const [k, s] of m.depth) {
      const bp = r(m.bid - k * step), ap = r(m.ask + k * step);
      if (bp > 0) lv.set(String(bp), (lv.get(String(bp)) ?? 0) + s);
      if (ap < 1) la.set(String(ap), (la.get(String(ap)) ?? 0) + s);
    }
    for (const o of this.orders.values()) {
      if (o.status !== "LIVE" || o.cond !== m.cond) continue;
      const yes = o.token === m.yes, p = r(yes ? o.price : 1 - o.price), left = o.size - o.matched;
      const bid = yes === (o.side === "BUY");
      const map = bid ? lv : la;
      map.set(String(p), (map.get(String(p)) ?? 0) + left);
    }
    return {
      bids: [...lv].map(([p, s]): [number, number] => [Number(p), s]).sort((a, b) => b[0] - a[0]),
      asks: [...la].map(([p, s]): [number, number] => [Number(p), s]).sort((a, b) => a[0] - b[0]),
    };
  }
  /** A token's touch in the market's one book: the NO book is the YES book's mirror. */
  touch(token: string): { bid: number; ask: number } | null {
    const x = this.marketOf(token);
    if (!x) return null;
    const b = this.yesBook(x.m);
    const bid = b.bids[0]?.[0] ?? 0, ask = b.asks[0]?.[0] ?? 1;
    return x.outcome === "yes" ? { bid, ask } : { bid: Number((1 - ask).toFixed(6)), ask: Number((1 - bid).toFixed(6)) };
  }
  private expireDue() {
    const nowS = Math.floor(this.now() / 1000);
    for (const o of this.orders.values()) {
      this.landCancel(o);
      if (o.status === "LIVE" && o.orderType === "GTD" && nowS >= o.expiration - 60) o.status = "CANCELED";
    }
  }
  /**
   * A cancel taken lands once its reads are used up or a second has passed; until then the order rests as before. `read`
   * is a read of this order (GET /data/order/{id}); any other look only checks the clock.
   */
  private landCancel(o: FakePmOrder, read = false): void {
    if (o.cancelAsked == null) return;
    if (o.status !== "LIVE") { o.cancelAsked = o.cancelReadsLeft = undefined; return; }
    if (this.now() - o.cancelAsked >= 1_000 || (read && (o.cancelReadsLeft ?? 0) <= 0)) {
      o.status = "CANCELED"; o.cancelAsked = o.cancelReadsLeft = undefined;
      return;
    }
    if (read) o.cancelReadsLeft = (o.cancelReadsLeft ?? 0) - 1;
  }
  /** A cancel the venue has taken: carried out at once, or a moment later (`cancelLagReads`). */
  private takeCancel(o: FakePmOrder): void {
    if (this.cancelLagReads > 0) { o.cancelAsked ??= this.now(); o.cancelReadsLeft ??= this.cancelLagReads; }
    else o.status = "CANCELED";
  }
  private reserved(kind: "pusd" | string): number {
    let n = 0;
    for (const o of this.orders.values()) {
      if (o.status !== "LIVE") continue;
      const left = o.size - o.matched;
      if (kind === "pusd" && o.side === "BUY") n += left * o.price;
      if (kind !== "pusd" && o.side === "SELL" && o.token === kind) n += left;
    }
    return n;
  }
  private orderView(o: FakePmOrder) {
    return {
      id: o.hash, status: o.status, market: o.cond, asset_id: o.token, side: o.side, original_size: String(o.size), size_matched: String(o.matched),
      price: String(o.price), expiration: String(o.expiration), order_type: o.orderType, associate_trades: [...o.trades], created_at: Math.floor(o.at / 1000),
    };
  }
  /** The listing's rows, as `/rewards/markets/current` serves them, in condition-id order. */
  private listing(sponsored: boolean) {
    return this.markets.filter((m) => (sponsored ? m.sponsoredRate : m.rate) != null).slice().sort((a, b) => (a.cond < b.cond ? -1 : a.cond > b.cond ? 1 : 0))
      .map((m) => ({ condition_id: m.cond, total_daily_rate: sponsored ? m.sponsoredRate : m.rate, rewards_max_spread: m.maxSpread, rewards_min_size: m.rewardsMinSize }));
  }
  /** Is this resting order scoring now? Resting long enough, big enough, and inside the spread of the market's midpoint. */
  private scoring(o: FakePmOrder): boolean {
    const x = this.marketOf(o.token);
    if (!x || o.status !== "LIVE" || o.size - o.matched < x.m.rewardsMinSize) return false;
    if (this.now() - o.at < this.scoringDelayS * 1000) return false;
    const mid = (x.m.bid + x.m.ask) / 2, p = x.outcome === "yes" ? o.price : 1 - o.price;
    const bid = (x.outcome === "yes") === (o.side === "BUY");
    const d = (bid ? mid - p : p - mid) * 100;
    return d >= 0 && d < x.m.maxSpread;
  }

  /** Every request, as the venue would see it. `body` is the exact string a POST or DELETE carries. */
  answer(method: string, url: URL, body: string | undefined): Answer {
    const path = `${url.host}${url.pathname}`;
    this.calls.push(`${method} ${path}`);
    this.urls.push(`${method} ${url.href}`);
    if (body !== undefined) this.bodies.push(body);
    this.expireDue();
    const q = url.searchParams;
    const err = (status: number, error: string, retryAfter?: number): Answer => ({ status, body: { error }, retryAfter });
    const DATE = /^\d{4}-\d{2}-\d{2}$/;
    if (method === "GET" && path === "polymarket.com/api/geoblock") return this.down.geoblock ? err(503, "down") : { status: 200, body: { ...this.geo } };
    if (method === "GET" && path === "clob.polymarket.com/book") {
      if (this.down.book) return err(503, "down");
      const x = this.marketOf(q.get("token_id") ?? "");
      if (!x || x.m.resolved) return err(404, "No orderbook exists for the requested token id");
      // Bids low to high and asks high to low, as measured (reference §2d).
      const b = this.yesBook(x.m);
      const side = x.outcome === "yes" ? b : { bids: b.asks.map(([p, s]): [number, number] => [Number((1 - p).toFixed(6)), s]), asks: b.bids.map(([p, s]): [number, number] => [Number((1 - p).toFixed(6)), s]) };
      const out = (xs: Array<[number, number]>) => xs.map(([p, s]) => ({ price: String(p), size: String(s) }));
      return {
        status: 200,
        body: {
          market: x.m.cond, asset_id: q.get("token_id"), timestamp: String(this.now()), hash: `h${this.seq++}`, tick_size: x.m.tick, min_order_size: String(x.m.minSize), neg_risk: x.m.negRisk,
          bids: out(side.bids.slice().sort((a, b2) => a[0] - b2[0])), asks: out(side.asks.slice().sort((a, b2) => b2[0] - a[0])),
        },
      };
    }
    if (method === "GET" && path === "clob.polymarket.com/rewards/markets/current") {
      if (this.down.rewards) return err(500, "Internal server error");
      const sponsored = q.get("sponsored") === "true";
      const cur = q.get("next_cursor");
      let at = 0;
      if (cur) {
        try { at = Number(atob(cur)); } catch { return err(400, "error decoding cursor: illegal base64 data at input byte 4"); }
        if (!Number.isInteger(at)) return err(400, "error decoding cursor");
      }
      this.onRewardsPage?.(at, sponsored);
      const rows = this.listing(sponsored), size = this.rewardsPageSize;
      const page = at < 0 ? [] : rows.slice(at, at + size);
      return { status: 200, body: { data: page, next_cursor: at >= 0 && at + size < rows.length ? btoa(String(at + size)) : "LTE=", limit: size, count: page.length } };
    }
    if (method === "GET" && path === "gamma-api.polymarket.com/markets/keyset") {
      if (this.down.gamma) return err(503, "down");
      const ids = q.getAll("condition_ids").map((c) => c.toLowerCase());
      if (!ids.length || ids.length > 50 || !["true", "false"].includes(q.get("closed") ?? "")) return err(422, "the order path asks for up to fifty markets by condition id, open or closed");
      const closed = q.get("closed") === "true";
      const markets = this.markets.filter((m) => ids.includes(m.cond.toLowerCase()) && !!m.resolved === closed).map((m) => ({
        conditionId: m.cond, question: `Q ${m.cond.slice(2, 8)}`, clobTokenIds: JSON.stringify([m.yes, m.no]), outcomes: '["Yes","No"]',
        enableOrderBook: true, acceptingOrders: m.accepting && !m.resolved, closed: !!m.resolved, negRisk: m.negRisk,
        ...(m.resolved && m.payout !== undefined ? { outcomePrices: JSON.stringify([String(m.payout), String(1 - m.payout)]) } : {}),
        ...(m.resolved && m.closedTime !== undefined ? { closedTime: m.closedTime } : {}),
        ...(m.endDate !== undefined ? { endDate: m.endDate } : {}), ...(m.gameStartTime !== undefined ? { gameStartTime: m.gameStartTime } : {}),
      }));
      return { status: 200, body: { markets } };
    }
    if (method === "GET" && path === "clob.polymarket.com/rebates/current") {
      if (this.down.rebates) return err(500, "Internal server error");
      const date = q.get("date") ?? "";
      if (!DATE.test(date)) return err(400, "Invalid date");
      if (!/^0x[0-9a-fA-F]{40}$/.test(q.get("maker_address") ?? "")) return err(400, "Invalid maker_address");
      const r = this.rebatesByDay[date];
      return { status: 200, body: r ? r.map((x) => ({ date, condition_id: x.cond, asset_address: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB", maker_address: q.get("maker_address"), rebated_fees_usdc: x.usdc })) : null };
    }
    if (method === "GET" && path === "clob.polymarket.com/auth/ban-status/closed-only") return this.down.closedOnly ? err(500, "Internal server error") : { status: 200, body: { closed_only: this.closedOnlyFlag } };
    if (method === "GET" && path === "clob.polymarket.com/balance-allowance") {
      if (q.get("signature_type") !== "1") return err(400, "Invalid signature type");
      // pUSD: the wallet's whole balance; what resting buys reserve is the CLOB's own book-keeping, not a transfer.
      if (q.get("asset_type") === "COLLATERAL") return this.down.collateral ? err(500, "Internal server error") : { status: 200, body: { balance: String(Math.round(this.pusd * 1e6)), allowances: {} } };
      if (this.down.balance) return err(500, "Internal server error");
      if (q.get("asset_type") !== "CONDITIONAL" || !q.get("token_id")) return err(400, "Invalid asset type");
      const shares = this.tokens.get(q.get("token_id") ?? "") ?? 0;
      return { status: 200, body: { balance: String(Math.round(shares * 1e6)), allowances: {} } };
    }
    if (method === "GET" && path.startsWith("clob.polymarket.com/data/order/")) {
      if (this.orderReadDown) return err(500, "Internal server error");
      const o = this.orders.get(path.split("/").at(-1)!);
      if (o) this.landCancel(o, true);
      return o ? { status: 200, body: this.orderView(o) } : err(404, "Order not found");
    }
    if (method === "GET" && path === "clob.polymarket.com/data/trades") {
      const t = this.trades.get(q.get("id") ?? "");
      const data = t ? [{
        id: t.id, taker_order_id: `0x${"ee".repeat(32)}`, market: this.orders.get(t.hash)?.cond, asset_id: t.token, side: t.side === "BUY" ? "SELL" : "BUY",
        size: String(t.size), price: String(t.price), status: `${this.tradeStatusPrefix}${t.status}`, match_time: String(Math.floor(t.at / 1000)),
        transaction_hash: t.status === "CONFIRMED" ? `0x${"ab".repeat(32)}` : undefined, trader_side: "TAKER",
        maker_orders: [{ order_id: t.hash, matched_amount: String(t.size), price: String(t.price), asset_id: t.token, side: t.side }],
      }] : [];
      return { status: 200, body: { limit: 100, count: data.length, next_cursor: "LTE=", data } };
    }
    if (method === "GET" && path === "clob.polymarket.com/order-scoring") {
      if (this.down.scoring) return err(500, "Internal server error");
      const id = q.get("order_id") ?? "";
      if (!/^0x[0-9a-f]{64}$/.test(id)) return err(400, "Invalid order_id");
      const o = this.orders.get(id);
      return o ? { status: 200, body: { scoring: this.scoring(o) } } : err(404, "market not found");
    }
    if (method === "GET" && path === "clob.polymarket.com/rewards/user/percentages") {
      if (q.get("signature_type") !== "1") return err(400, "Invalid signature_type");
      return { status: 200, body: { ...this.percentages } };
    }
    if (method === "GET" && (path === "clob.polymarket.com/rewards/user" || path === "clob.polymarket.com/rewards/user/total")) {
      if (this.down.earnings) return err(500, "Internal server error");
      const date = q.get("date") ?? "";
      if (!DATE.test(date)) return err(400, "Invalid date (format: YYYY-MM-DD)");
      if (q.get("signature_type") !== "1") return err(400, "Invalid signature_type");
      const sponsored = q.get("sponsored") === "true";
      const day = this.earnings[date] ?? { native: [], sponsored: [] };
      const row = (x: { cond: string; usd: number }) => ({ date: `${date}T00:00:00Z`, condition_id: x.cond, asset_address: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB", maker_address: PM_TEST_FUNDER, earnings: x.usd, asset_rate: 1 });
      if (path.endsWith("/total")) {
        // sponsored=true aggregates both, as the OpenAPI says; without it, native only.
        const all = [...day.native, ...(sponsored ? day.sponsored : [])];
        return { status: 200, body: all.length ? [{ date: `${date}T00:00:00Z`, asset_address: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB", maker_address: PM_TEST_FUNDER, earnings: all.reduce((s, x) => s + x.usd, 0), asset_rate: 1 }] : [] };
      }
      // Pages of two, from "MA==", as the clients page it.
      const rows = (sponsored ? day.sponsored : day.native).map(row);
      let at = 0;
      try { at = Number(atob(q.get("next_cursor") ?? "MA==")); } catch { return err(400, "Invalid next_cursor"); }
      const page = rows.slice(at, at + 2);
      return { status: 200, body: { limit: 2, count: page.length, next_cursor: at + 2 < rows.length ? btoa(String(at + 2)) : "LTE=", data: page } };
    }
    if (method === "POST" && path === "clob.polymarket.com/order") return this.post(body ?? "");
    if (method === "DELETE" && path === "clob.polymarket.com/order") {
      const id = String((JSON.parse(body ?? "{}") as { orderID?: string }).orderID ?? "");
      const o = this.orders.get(id);
      if (!o || o.status !== "LIVE") return { status: 200, body: { canceled: [], not_canceled: { [id]: o ? "order already matched" : "Order not found or already canceled" } } };
      if (this.cancelMode !== "lost") this.takeCancel(o);                       // "lost": said and not done
      return { status: 200, body: { canceled: [id], not_canceled: {} } };
    }
    if (method === "DELETE" && path === "clob.polymarket.com/cancel-all") {
      const canceled: string[] = [];
      for (const o of this.orders.values()) if (o.status === "LIVE") { if (this.cancelMode !== "lost") this.takeCancel(o); canceled.push(o.hash); }
      return { status: 200, body: { canceled, not_canceled: {} } };
    }
    // The keyless public reads (`publicFetch`, through `_shared/polymarket_public.ts`): the CLOB's short list of rewarded
    // markets, paged as its listing is; its books for many tokens in one POST, each as GET /book serves it, a token with
    // no book left out; and the data API's prints of one market, newest first, in one page.
    if (method === "GET" && path === "clob.polymarket.com/sampling-simplified-markets") {
      if (this.publicDown.simplified) return err(500, "Internal server error");
      const rows = this.markets.filter((m) => m.rate != null || m.sponsoredRate != null).slice().sort((a, b) => (a.cond < b.cond ? -1 : a.cond > b.cond ? 1 : 0))
        .map((m) => ({ condition_id: m.cond, tokens: [{ token_id: m.yes, outcome: "Yes", price: m.bid }, { token_id: m.no, outcome: "No", price: 1 - m.ask }], active: true, closed: !!m.resolved }));
      let at = 0;
      const cur = q.get("next_cursor");
      if (cur) {
        try { at = Number(atob(cur)); } catch { return err(400, "error decoding cursor"); }
        if (!Number.isInteger(at)) return err(400, "error decoding cursor");
      }
      const size = this.simplifiedPageSize, page = at < 0 ? [] : rows.slice(at, at + size);
      return { status: 200, body: { data: page, next_cursor: at >= 0 && at + size < rows.length ? btoa(String(at + size)) : "LTE=", limit: size, count: page.length } };
    }
    if (method === "POST" && path === "clob.polymarket.com/books") {
      if (this.publicDown.books) return err(500, "Internal server error");
      let want: unknown;
      try { want = JSON.parse(body ?? ""); } catch { return err(400, "Invalid payload"); }
      if (!Array.isArray(want) || want.length > 500) return err(400, "Invalid payload");
      const out: unknown[] = [];
      for (const w of want as Array<{ token_id?: unknown }>) {
        const one = this.answer("GET", new URL(`https://clob.polymarket.com/book?token_id=${encodeURIComponent(String(w?.token_id ?? ""))}`), undefined);
        this.calls.pop(); this.urls.pop();                                     // one POST, not a GET per token
        if (one.status === 200) out.push(one.body);
      }
      return { status: 200, body: out };
    }
    if (method === "GET" && path === "data-api.polymarket.com/v2/trades") {
      if (this.publicDown.trades) return err(503, "down");
      const c = q.get("condition") ?? "", m = this.markets.find((x) => x.cond === c);
      const rows = (this.prints.get(c) ?? []).slice().sort((a, b) => b[0] - a[0]).map(([ts, side, oi, price, size], i) => ({
        timestamp: ts, side, outcome_index: oi, price, size, token_id: m ? (oi === 0 ? m.yes : m.no) : "", transaction_hash: `0x${c.slice(-8)}${ts}${i}`, proxy_wallet: "0xabc",
      }));
      return { status: 200, body: { data: rows, pagination: { next_cursor: "" } } };
    }
    return err(404, `fake polymarket: no route ${method} ${path}`);
  }

  private post(raw: string): Answer {
    if (this.restart) return { status: 425, body: { error: "the matching engine is restarting" }, retryAfter: 1 };
    if (this.postMode === "429") return { status: 429, body: { error: "Too Many Requests" } };
    if (this.postMode === "503") return { status: 503, body: { error: "Trading is currently disabled. Check polymarket.com for updates" } };
    if (this.postMode === "500") return { status: 500, body: { error: "order timed out" } };
    let b: { order?: Record<string, unknown>; owner?: string; orderType?: string; postOnly?: boolean; deferExec?: boolean };
    try { b = JSON.parse(raw); } catch { return { status: 400, body: { error: "Invalid order payload" } }; }
    const o = b.order ?? {};
    const bad = (error: string): Answer => ({ status: 400, body: { error } });
    if (b.owner !== PM_TEST_OWNER) return bad("the order owner has to be the owner of the API KEY");
    if (b.orderType !== "GTD" && b.orderType !== "GTC") return bad("Invalid order payload");
    if (typeof o.salt !== "number" || !Number.isSafeInteger(o.salt) || typeof o.signature !== "string") return bad("Invalid order payload");
    if (o.signatureType !== 1) return bad("Invalid order payload");
    if (String(o.signer).toLowerCase() !== PM_TEST_SIGNER.toLowerCase()) return bad("the order signer address has to be the address of the API KEY");
    if (String(o.maker).toLowerCase() !== PM_TEST_FUNDER.toLowerCase()) return bad("the order owner has to be the owner of the API KEY");
    const token = String(o.tokenId), x = this.marketOf(token);
    if (!x) return bad("Invalid order payload");
    const struct = {
      salt: String(o.salt), maker: String(o.maker), signer: String(o.signer), tokenId: token, makerAmount: String(o.makerAmount), takerAmount: String(o.takerAmount),
      side: o.side as "BUY" | "SELL", signatureType: 1, timestamp: String(o.timestamp), metadata: String(o.metadata), builder: String(o.builder),
    };
    let hash: string;
    try { hash = orderHash(struct, exchangeFor(x.m.negRisk)); } catch { return bad("Invalid order payload"); }
    if (recoverSigner(hash, o.signature) !== PM_TEST_SIGNER) return bad("invalid signature");
    if (this.orders.has(hash)) return bad(`order ${hash} is invalid. Duplicated.`);
    const nowS = Math.floor(this.now() / 1000), exp = Number(o.expiration);
    if (b.orderType === "GTD" ? !(exp >= nowS + 180) : exp !== 0) return bad("invalid expiration");
    const maker = Number(o.makerAmount), taker = Number(o.takerAmount);
    const side = struct.side;
    const price = side === "BUY" ? maker / taker : taker / maker, size = (side === "BUY" ? taker : maker) / 1e6;
    const tick = Number(x.m.tick);
    if (!(Math.abs(price / tick - Math.round(price / tick)) < 1e-6) || price < tick - 1e-12 || price > 1 - tick + 1e-12) {
      return bad(`order ${hash} is invalid. Price (${price}) breaks minimum tick size rule: ${x.m.tick}`);
    }
    if (size < x.m.minSize) return bad(`order ${hash} is invalid. Size (${size}) lower than the minimum: ${x.m.minSize}`);
    const ofac = ["IR", "SY", "CU", "KP"].includes(this.geo.country);
    if (ofac || (side === "BUY" && this.geo.country !== "IE")) return { status: 403, body: { error: `trading restricted in ${this.geo.country}` } };
    if (this.closedOnlyFlag && (side === "BUY" || size > (this.tokens.get(token) ?? 0) - this.reserved(token) + 1e-9)) return bad(`'${PM_TEST_FUNDER}' address in closed only mode`);
    const t = this.touch(token)!;
    if (b.postOnly && (side === "BUY" ? price >= t.ask - 1e-9 : price <= t.bid + 1e-9)) return bad("invalid post-only order: order crosses book");
    if (side === "BUY" ? this.pusd - this.reserved("pusd") + 1e-9 < price * size : (this.tokens.get(token) ?? 0) - this.reserved(token) + 1e-9 < size) {
      return bad("not enough balance / allowance");
    }
    this.orders.set(hash, { hash, token, side, price, size, matched: 0, status: "LIVE", expiration: exp, orderType: String(b.orderType), trades: [], cond: x.m.cond, at: this.now() });
    if (this.postMode === "lose-reply") return { status: -1, body: null };
    if (this.postMode === "500-after-accept") return { status: 500, body: { error: "Internal server error" } };
    return { status: 200, body: { success: true, errorMsg: "", orderID: hash, status: "live", makingAmount: String(o.makerAmount), takingAmount: String(o.takerAmount) } };
  }

  /** A taker trades `size` against our resting order: a MATCHED trade, the account moved as the exchange will move it. */
  fill(hash: string, size: number): string {
    const o = this.orders.get(hash);
    if (o) this.landCancel(o);
    if (!o || o.status !== "LIVE") throw new Error(`fake polymarket: ${hash} is not resting`);
    const q = Math.min(size, o.size - o.matched);
    const id = `trade-${this.seq++}`;
    o.matched = Number((o.matched + q).toFixed(6));
    if (o.matched >= o.size - 1e-9) o.status = "MATCHED";
    o.trades.push(id);
    this.trades.set(id, { id, hash, token: o.token, side: o.side, price: o.price, size: q, status: "MATCHED", at: this.now() });
    if (o.side === "BUY") { this.pusd -= q * o.price; this.tokens.set(o.token, (this.tokens.get(o.token) ?? 0) + q); }
    else { this.tokens.set(o.token, (this.tokens.get(o.token) ?? 0) - q); this.pusd += q * o.price; }
    return id;
  }
  /** A trade's settlement on chain: CONFIRMED, or FAILED (and then the account is moved back). */
  settle(id: string, status: "MINED" | "CONFIRMED" | "FAILED") {
    const t = this.trades.get(id)!;
    t.status = status;
    if (status === "FAILED") {
      if (t.side === "BUY") { this.pusd += t.size * t.price; this.tokens.set(t.token, (this.tokens.get(t.token) ?? 0) - t.size); }
      else { this.tokens.set(t.token, (this.tokens.get(t.token) ?? 0) + t.size); this.pusd -= t.size * t.price; }
    }
  }

  /** The venue as the executor calls it, every answer through `answer`, with the order path's own body builders. */
  venue(): PmVenue {
    const C = "https://clob.polymarket.com";
    const call = (method: string, url: string, body?: string): Promise<PmReply> => {
      const a = this.answer(method, new URL(url), body);
      if (a.status === -1) return Promise.reject(new DOMException("The signal has been aborted", "TimeoutError"));
      const ok = a.status >= 200 && a.status < 300;
      const error = ok ? undefined : String((a.body as { error?: string } | null)?.error ?? a.status);
      return Promise.resolve({ ok, status: a.status, ms: 0, data: a.body as never, error, retryAfterS: a.retryAfter ?? null });
    };
    const qs = (q: Record<string, string>) => new URLSearchParams(q).toString();
    return {
      geoblock: () => call("GET", "https://polymarket.com/api/geoblock"),
      book: (t) => call("GET", `${C}/book?token_id=${t}`),
      rewardsPage: (s, c) => call("GET", `${C}/rewards/markets/current?sponsored=${s}${c ? `&next_cursor=${encodeURIComponent(c)}` : ""}`),
      gammaByConditions: (conds, closed) => call("GET", `https://gamma-api.polymarket.com/markets/keyset?limit=100&closed=${closed}${conds.map((c) => `&condition_ids=${c}`).join("")}`),
      closedOnly: () => call("GET", `${C}/auth/ban-status/closed-only`),
      collateral: () => call("GET", `${C}/balance-allowance?asset_type=COLLATERAL&signature_type=1`),
      conditionalBalance: (t) => call("GET", `${C}/balance-allowance?asset_type=CONDITIONAL&token_id=${t}&signature_type=1`),
      order: (id) => call("GET", `${C}/data/order/${id}`),
      trade: (id) => call("GET", `${C}/data/trades?id=${id}`),
      orderScoring: (id) => call("GET", `${C}/order-scoring?order_id=${id}`),
      rewardPercentages: () => call("GET", `${C}/rewards/user/percentages?signature_type=1`),
      userEarnings: (date, sponsored, cursor) => call("GET", `${C}/rewards/user?${qs({ date, signature_type: "1", ...(sponsored ? { sponsored: "true" } : {}), ...(cursor ? { next_cursor: cursor } : {}) })}`),
      userEarningsTotal: (date, sponsored) => call("GET", `${C}/rewards/user/total?${qs({ date, signature_type: "1", ...(sponsored ? { sponsored: "true" } : {}) })}`),
      rebates: (date, maker) => call("GET", `${C}/rebates/current?${qs({ date, maker_address: maker })}`),
      postOrder: (o, orderType, postOnly) => call("POST", `${C}/order`, postOrderBody(o, PM_TEST_OWNER, orderType, postOnly)),
      cancelOrder: (id) => {
        const p = call("DELETE", `${C}/order`, cancelOrderBody(id));
        return this.cancelMode === "throw" ? p.then(() => Promise.reject(new DOMException("The signal has been aborted", "TimeoutError"))) : p;
      },
      cancelAll: () => call("DELETE", `${C}/cancel-all`),
    };
  }

  /**
   * The same venue over HTTP, for the order path's REAL client (`pmVenue`): every request is answered by `answer`, and a
   * private one (closed-only, balances, orders, trades, scoring, the account's rewards, and every write) only with the
   * five L2 headers of the test key's address and API key — the CLOB's 401 otherwise. A redirect it never sends; a client
   * must not need one.
   */
  fetch: typeof fetch = async (input, init) => {
    const u = new URL(String(input)), method = (init?.method ?? "GET").toUpperCase();
    const l2 = u.host === "clob.polymarket.com" && (method !== "GET"
      || ["/auth/ban-status/closed-only", "/balance-allowance", "/data/trades", "/order-scoring", "/rewards/user", "/rewards/user/total", "/rewards/user/percentages"].includes(u.pathname)
      || u.pathname.startsWith("/data/order/"));
    const h = (init?.headers ?? {}) as Record<string, string>;
    if (l2 && (h.POLY_API_KEY !== PM_TEST_OWNER || String(h.POLY_ADDRESS).toLowerCase() !== PM_TEST_SIGNER.toLowerCase() || !h.POLY_SIGNATURE || !h.POLY_TIMESTAMP || !h.POLY_PASSPHRASE)) {
      this.calls.push(`${method} ${u.host}${u.pathname} (401)`);
      return new Response(JSON.stringify({ error: "Unauthorized/Invalid api key" }), { status: 401 });
    }
    if (!l2 && Object.keys(h).some((k) => k.startsWith("POLY_"))) throw new Error(`fake polymarket: L2 headers sent to ${u.host}${u.pathname}`);
    const a = this.answer(method, u, typeof init?.body === "string" ? init.body : undefined);
    if (a.status === -1) throw new DOMException("The signal has been aborted", "TimeoutError");
    return new Response(a.body === null ? null : JSON.stringify(a.body), { status: a.status, headers: a.retryAfter != null ? { "retry-after": String(a.retryAfter) } : {} });
  };

  /**
   * The same venue's keyless public reads, as `_shared/polymarket_public.ts` makes them (RW's client, which the paper
   * layers and mid-pool's exclusion read through): only its routes, never with an L2 header, every answer through
   * `answer` so it is in `calls` and `urls` beside the order path's.
   */
  publicFetch: typeof fetch = (input, init) => {
    const u = new URL(String(input)), method = (init?.method ?? "GET").toUpperCase(), path = `${u.host}${u.pathname}`;
    const h = (init?.headers ?? {}) as Record<string, string>;
    if (Object.keys(h).some((k) => k.startsWith("POLY_"))) return Promise.reject(new Error(`fake polymarket: L2 headers on a public read of ${path}`));
    const isPublic = method === "POST" ? path === "clob.polymarket.com/books"
      : ["clob.polymarket.com/sampling-simplified-markets", "clob.polymarket.com/rewards/markets/current", "gamma-api.polymarket.com/markets/keyset", "data-api.polymarket.com/v2/trades"].includes(path);
    if (!isPublic) return Promise.reject(new Error(`fake polymarket: ${method} ${path} is not one of the public reads`));
    const a = this.answer(method, u, typeof init?.body === "string" ? init.body : undefined);
    return Promise.resolve(new Response(JSON.stringify(a.body), { status: a.status }));
  };
}

// ── fake venues over HTTP, for driving the REAL venue clients ─────────────────────────────────────────

/** A steady rise of 0.2 % a 4-hour bar: every closed bar breaks the prior 55-bar high and the averages stay stacked up. */
export const FAKE_EPOCH = Date.parse("2026-06-01T00:00:00Z");
export const fakePrice = (t: number) => 100 * Math.pow(1.002, (t - FAKE_EPOCH) / (4 * 3600e3));

type FakeOrder = {
  id: string; client_order_id: string; symbol: string; side: "buy" | "sell"; status: string; price: string; quantity: string;
  filled: number; avg: number | null; fee: number; tif: string; postOnly: boolean; created: number;
  /** A DELETE taken and not yet carried out (`cancelLagReads`): when it was asked, and how many reads still show it open. */
  cancelAsked?: number; cancelReadsLeft?: number;
  /** `settlement: "venue"` only: the fills' notional at their prices, what the account moved for it, and the fee's currency. */
  notional?: number; moved?: number; feeCurrency?: string;
};

/** Revolut X's own configuration of PR5's two GBP books (public pair list, 2026-09-24 00:12 UTC; `backtests/pr5_live/inputs`). */
export const GBP_BOOK_PAIR = { base_step: "0.00001", quote_step: "0.0001", min_order_size: "0.00001", max_order_size: "4000000", min_order_size_quote: "0.1", max_order_size_quote: "1000000", status: "active" };
/** The double's BTC/USD, as its pairs route serves it. */
const BTC_USD_PAIR = { base: "BTC", quote: "USD", base_step: "0.00000001", quote_step: "0.01", min_order_size: "0.00000001", max_order_size: "200", min_order_size_quote: "0.1", max_order_size_quote: "1000000", status: "active" };

/**
 * Revolut X as its own reference documents it (revolut-x-api-for-llm.md; developer.revolut.com): the placement reply's
 * `data` is an object, an order reads back as `id` / `status` / `filled_quantity` / `average_fill_price` / `total_fee` +
 * `fee_currency`, a marketable IOC limit fills at the touch or dies, post-only never takes, and a sell for more than the
 * account holds is refused. `dialect` makes it answer the way a venue the client misreads would.
 */
export class FakeRevx {
  shock: Record<string, number> = {};                  // a multiplier on the UK touch, per symbol
  spreadBps: Record<string, number> = {};              // the width of the UK book, per symbol (2 bps by default)
  /** PR5's GBP stablecoin books: their own touch, not the crypto price path. A test moves them by assigning. */
  gbpBooks: Record<string, { bid: number; ask: number }> = { "USDC/GBP": { bid: 0.7548, ask: 0.7552 }, "USDT/GBP": { bid: 0.7546, ask: 0.7551 } };
  orders = new Map<string, FakeOrder>();
  balances: Record<string, number> = { USD: 100 };
  /**
   * What DELETE does to an order still resting: "ok" cancels it (204); "lost" answers 204 and the order stays live — the
   * cancel the design says must be read back before a replacement is sent; "timeout" cancels it and the reply never
   * arrives (the caller's fetch throws).
   */
  cancelMode: "ok" | "lost" | "timeout" = "ok";
  /**
   * A DELETE the venue takes is carried out a moment later, not before its 204: the order reads back `new` (and can still
   * fill) for this many reads of it, or until a second has passed, whichever comes first. Production, PR5's first live
   * hour (2026-10-01 16:37 and 16:41 UTC): the read-back straight after the DELETE still showed 3 of 11, then 7 of 11
   * orders `new`, and every one read back cancelled by the next turn. One read is the venue as measured; 0 cancels at once.
   */
  cancelLagReads = 1;
  /** How a post-only order that would cross is refused: taken and then `rejected` (the read-back says so), or a 400 at once. */
  postOnlyRefusal: "status" | "http-400" = "status";
  /**
   * How an order reads back: "documented" (the venue's own words); "no-fee" (a filled order with no `total_fee` /
   * `fee_currency`, which the venue shows "only when present" — settled since D8 with the fee its schedule charges);
   * "no-price" (a filled order with no `average_fill_price`, which the schema also marks optional — still refused); or
   * "foreign" — a vocabulary neither the documented nor the assumed names cover: the status in capitals and the fill under
   * other field names, so a reader that did not refuse what it cannot read would see "new, nothing filled".
   */
  dialect: "documented" | "no-fee" | "no-price" | "foreign" = "documented";
  /**
   * How a fill moves the account, and what its reply says of it. "exact" (the default): the quote currency moves by
   * quantity × price, a taker pays its 9 bps in the quote currency, and the reply carries no `filled_amount`. "venue":
   * Revolut X as every live fill to 2026-10-02 showed it (PR5's orders 1154–1314, the live row's 37 and 44): the quote
   * currency moves in whole hundredths — a sell's credit FLOORED, a buy's debit rounded UP — and the reply's
   * `filled_amount` is that amount; its `average_fill_price` is `filled_amount` ÷ `filled_quantity` rounded to the pair's
   * price step; a taker buy pays its 9 bps in the COIN, rounded up to the base step (the account receives the rest), a
   * taker sell in the quote currency, rounded up to the hundredth; a maker pays nothing; `fee_currency` names the coin on a
   * buy and the quote currency on a sell. A part-filled order is rounded on its whole amount so far (the venue's partial
   * fills are not measured yet).
   */
  settlement: "exact" | "venue" = "exact";
  /** What DELETE answers for an order that already finished: the reference documents only 204 for a cancel. */
  deleteFinished: 204 | 404 = 404;
  /** Endpoints answering 503, as a venue does for a minute now and then: a decision can then be allowed with no order behind it. */
  down: { pairs?: boolean; tickers?: boolean; balances?: boolean; history?: boolean } = {};
  /** The `state` a placement reply carries: the order's own ("status"), or always "new" — the word the documented example uses. */
  placementReply: "status" | "new" = "status";
  /** The venue takes the order and the reply never arrives (a timeout after the fact): the caller sees a thrown fetch. */
  loseReply = false;
  calls: string[] = [];
  /** Called as an order POST arrives, before the venue reads it, with the request it carries. */
  onPost?: (req?: { side?: string; symbol?: string; client_order_id?: string; order_configuration?: { limit?: { base_size?: string; price?: string } } }) => void;
  /**
   * The venue's per-second bucket on order POSTs: 10 a second on a key (reference §2). Over it a POST is answered 429 and
   * not taken, as the venue does; `null` switches the bucket off for a test that must.
   */
  postsPerSecond: number | null = 10;
  /** The next this-many order POSTs are answered 429 whatever the bucket holds (a burst from elsewhere on the key). */
  rateLimitNext = 0;
  /** When each order POST the double TOOK arrived: what the bucket counts. */
  postTimes: number[] = [];
  /** How many order POSTs it answered 429. */
  rateLimited = 0;
  private seq = 1;
  constructor(public now: () => number) {}
  /** A pair's steps, as the pairs route serves them. */
  private stepsOf(sym: string): { base: string; price: string } {
    return this.gbpBooks[sym] ? { base: GBP_BOOK_PAIR.base_step, price: GBP_BOOK_PAIR.quote_step } : { base: BTC_USD_PAIR.base_step, price: BTC_USD_PAIR.quote_step };
  }
  /** `settlement: "venue"`: what the account moves for a notional — a buy's debit rounded up to the hundredth, a sell's credit floored. */
  private hundredths(side: "buy" | "sell", notional: number): number {
    return revxHundredths(side, notional);          // the venue's rule, one function with the simulated account's (revx_sim.ts)
  }
  quote(sym: string) {
    if (this.gbpBooks[sym]) return { ...this.gbpBooks[sym] };
    const mid = fakePrice(this.now()) * (this.shock[sym] ?? 1);
    const half = (this.spreadBps[sym] ?? 2) / 2 / 1e4;
    return { bid: Math.round(mid * (1 - half) * 100) / 100, ask: Math.round(mid * (1 + half) * 100) / 100 };
  }
  /**
   * A cancel the venue took lands once its reads are used up or a second has passed: until then the order is open as before.
   * `read` is a read of this order (GET /orders/{id}); any other look (the active list, the balances, a trade) only checks
   * the clock.
   */
  private landCancel(o: FakeOrder, read = false): void {
    if (o.cancelAsked == null) return;
    if (o.status !== "new" && o.status !== "partially_filled") { o.cancelAsked = o.cancelReadsLeft = undefined; return; }
    if (this.now() - o.cancelAsked >= 1_000 || (read && (o.cancelReadsLeft ?? 0) <= 0)) {
      o.status = "cancelled"; o.cancelAsked = o.cancelReadsLeft = undefined;
      return;
    }
    if (read) o.cancelReadsLeft = (o.cancelReadsLeft ?? 0) - 1;
  }
  /** What resting orders hold back of an asset: a resting buy its quote currency, a resting sell its coin. */
  /**
   * The pounds a resting buy holds: its notional rounded UP to the penny, as Revolut X holds it. PR5's first automatic
   * top-up, 2026-10-02 17:56 UTC: two buys of £0.1503 each against £0.31 free, the second refused "Not enough funds!
   * Wanted £0.16 but has only £0.15". Other quote currencies are held as the notional (not measured).
   */
  static holdFor(quote: string, notional: number): number {
    return revxHoldFor(quote, notional);            // the venue's rule, one function with the simulated account's (revx_sim.ts)
  }
  reserved(asset: string): number {
    let n = 0;
    for (const o of this.orders.values()) {
      this.landCancel(o);
      if (o.status !== "new" && o.status !== "partially_filled") continue;
      const [base, quote] = o.symbol.split("/"), left = Number(o.quantity) - o.filled;
      if (o.side === "buy" && quote === asset) n += FakeRevx.holdFor(quote, left * Number(o.price));
      if (o.side === "sell" && base === asset) n += left;
    }
    return n;
  }
  /**
   * A taker trades against one of our RESTING orders: `qty` of it fills at its own price, a maker fill (0 % on this venue).
   * The account moves as the venue's would: a buy pays the quote currency and receives the coin, a sell the reverse.
   */
  fillResting(id: string, qty: number) {
    const o = this.orders.get(id);
    if (o) this.landCancel(o);
    if (!o || (o.status !== "new" && o.status !== "partially_filled")) throw new Error(`fake revx: ${id} is not resting`);
    const [base, quote] = o.symbol.split("/"), px = Number(o.price);
    const q = Math.min(qty, Number(o.quantity) - o.filled);
    o.avg = o.filled > 0 && o.avg != null ? (o.avg * o.filled + px * q) / (o.filled + q) : px;
    o.filled = Math.round((o.filled + q) * 1e9) / 1e9;
    o.status = o.filled >= Number(o.quantity) - 1e-12 ? "filled" : "partially_filled";
    // The quote currency this fill moves: its notional, or (as the venue moves it) the order's whole hundredths so far less
    // what earlier fills of it already moved. A maker pays nothing either way.
    let cash = q * px;
    if (this.settlement === "venue") {
      const before = o.moved ?? 0;
      o.notional = (o.notional ?? 0) + q * px;
      o.moved = this.hundredths(o.side, o.notional);
      o.feeCurrency = o.side === "buy" ? base : quote;
      cash = o.moved - before;
    }
    if (o.side === "buy") { this.balances[quote] = (this.balances[quote] ?? 0) - cash; this.balances[base] = (this.balances[base] ?? 0) + q; }
    else { this.balances[base] = (this.balances[base] ?? 0) - q; this.balances[quote] = (this.balances[quote] ?? 0) + cash; }
  }
  /** Every order still resting on `symbol` (slash form). */
  resting(symbol?: string): FakeOrder[] {
    for (const o of this.orders.values()) this.landCancel(o);
    return [...this.orders.values()].filter((o) => (o.status === "new" || o.status === "partially_filled") && (!symbol || o.symbol === symbol));
  }
  private view(o: FakeOrder): Record<string, unknown> {
    const body: Record<string, unknown> = {
      id: o.id, client_order_id: o.client_order_id, symbol: o.symbol, side: o.side, type: "limit", quantity: o.quantity,
      filled_quantity: String(o.filled), leaves_quantity: String(Number(o.quantity) - o.filled), price: o.price,
      average_fill_price: o.avg == null ? "0" : String(o.avg), total_fee: String(o.fee), fee_currency: o.symbol.split("/")[1],
      status: o.status, time_in_force: o.tif, execution_instructions: [o.postOnly ? "post_only" : "allow_taker"], created_date: o.created, updated_date: o.created,
    };
    if (this.settlement === "venue") {
      // What the account moved, and the venue's average derived from it at the pair's price step (1184: "9.99", "0.7576").
      const [base, quote] = o.symbol.split("/"), { base: baseStep, price: priceStep } = this.stepsOf(o.symbol);
      const moved = o.moved ?? 0;
      body.filled_amount = venueNumber(moved, 2);
      body.average_fill_price = revxAveragePrice(moved, o.filled, priceStep);
      body.total_fee = venueNumber(o.fee, (o.feeCurrency ?? (o.side === "buy" ? base : quote)) === base ? stepDecimals(baseStep) : 2);
      body.fee_currency = o.feeCurrency ?? (o.side === "buy" ? base : quote);
    }
    if (this.dialect === "no-fee") { delete body.total_fee; delete body.fee_currency; }
    if (this.dialect === "no-price") delete body.average_fill_price;
    if (this.dialect === "foreign") {
      for (const k of ["filled_quantity", "leaves_quantity", "average_fill_price", "total_fee", "fee_currency"]) delete body[k];
      Object.assign(body, { status: o.status.toUpperCase(), executed_quantity: String(o.filled), executed_price: o.avg == null ? null : String(o.avg), fee: String(o.fee) });
    }
    return body;
  }
  fetch: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    const p = url.pathname, m = (init?.method ?? "GET").toUpperCase();
    this.calls.push(`${m} ${p}`);
    const json = (status: number, body: unknown) => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status }));
    const unavailable = () => json(503, { message: "Service unavailable" });
    if (p === "/api/1.0/public/tickers") {
      if (this.down.tickers) return unavailable();
      const syms = (url.searchParams.get("symbols") ?? "").split(",").filter(Boolean).map((s) => s.replace("-", "/"));
      return json(200, { data: syms.map((s) => { const q = this.quote(s); return { symbol: s, bid: String(q.bid), ask: String(q.ask), mid: String((q.bid + q.ask) / 2), last_price: String(q.bid), region: "UK" }; }) });
    }
    if (p === "/api/1.0/public/configuration/pairs") {
      if (this.down.pairs) return unavailable();
      return json(200, { "BTC/USD": BTC_USD_PAIR, "USDC/GBP": { base: "USDC", quote: "GBP", ...GBP_BOOK_PAIR }, "USDT/GBP": { base: "USDT", quote: "GBP", ...GBP_BOOK_PAIR } });
    }
    if (p.startsWith("/api/2.0/public/order-book/")) {
      // The public book as the venue serves it (`backtests/pr5_live/inputs/revx_books.json.gz`): levels of price, quantity, count.
      const q = this.quote(p.split("/").at(-1)!.replace("-", "/"));
      return json(200, { data: { bids: [{ count: 1, price: q.bid.toFixed(4), quantity: "5000" }], asks: [{ count: 1, price: q.ask.toFixed(4), quantity: "5000" }] } });
    }
    if (p.startsWith("/api/1.0/public/candles/")) {
      const sym = p.split("/").at(-1)!.replace("-", "/"), iv = Number(url.searchParams.get("interval")) * 60e3;
      const since = Number(url.searchParams.get("since")), until = Number(url.searchParams.get("until"));
      const out = [];
      for (let s = Math.floor(since / iv) * iv; s < until; s += iv) { const q = this.quote(sym); out.push({ start: s, open: String(q.bid), high: String(q.ask), low: String(q.bid), close: String(q.bid), volume: "1" }); }
      return json(200, { data: out });
    }
    if (p === "/api/1.0/orders" && m === "POST") {
      if (this.onPost) { try { this.onPost(JSON.parse(String(init!.body))); } catch { this.onPost(); } }
      const at = this.now();
      const tooMany = { error_id: "e", message: "Too many requests", timestamp: at };
      if (this.rateLimitNext > 0) { this.rateLimitNext--; this.rateLimited++; return json(429, tooMany); }
      if (this.postsPerSecond != null && this.postTimes.filter((x) => x > at - 1000).length >= this.postsPerSecond) { this.rateLimited++; return json(429, tooMany); }
      this.postTimes.push(at);
      const req = JSON.parse(String(init!.body));
      const sym = String(req.symbol).replace("-", "/"), lim = req.order_configuration.limit;
      const q = this.quote(sym), price = Number(lim.price), size = Number(lim.base_size), asset = sym.split("/")[0], quoteAsset = sym.split("/")[1];
      // What the venue's own client and CLI accept at placement (see `PlaceTimeInForce` in _shared/revx.ts): gtc or ioc,
      // gtc when omitted, and never post_only with ioc. The double refuses the rest, as the stricter reading of the venue would.
      const tif = lim.time_in_force ?? "gtc";
      if (tif !== "gtc" && tif !== "ioc") return json(400, { error_id: "e", message: `time_in_force ${tif} is not accepted on placement`, timestamp: this.now() });
      if (tif === "ioc" && (lim.execution_instructions ?? []).includes("post_only")) return json(400, { error_id: "e", message: "post_only cannot be combined with ioc", timestamp: this.now() });
      const o: FakeOrder = { id: `rx-${this.seq++}`, client_order_id: req.client_order_id, symbol: sym, side: req.side, status: "new", price: lim.price, quantity: lim.base_size, filled: 0, avg: null, fee: 0, tif, postOnly: (lim.execution_instructions ?? []).includes("post_only"), created: this.now() };
      const crosses = crossesTouch(req.side, price, q.bid, q.ask);
      if (crosses && !o.postOnly) {
        const px = req.side === "buy" ? q.ask : q.bid;
        if (req.side === "sell" && (this.balances[asset] ?? 0) - this.reserved(asset) + 1e-12 < size) return json(400, { error_id: "e", message: "Insufficient balance", timestamp: this.now() });
        const venue = this.settlement === "venue";
        const need = venue ? this.hundredths("buy", size * px) : size * px * 1.0009;
        if (req.side === "buy" && (this.balances[quoteAsset] ?? 0) - this.reserved(quoteAsset) + 1e-9 < need) return json(400, { error_id: "e", message: "Insufficient balance", timestamp: this.now() });
        o.filled = size; o.avg = px; o.fee = Math.round(size * px * 0.0009 * 1e8) / 1e8; o.status = "filled";
        if (venue) {
          // The venue's way (`settlement`): whole hundredths of the quote currency; a buy's fee in the coin, a sell's in the quote.
          o.notional = size * px;
          o.moved = this.hundredths(req.side, o.notional);
          o.fee = revxTakerFee(req.side, size, o.moved, this.stepsOf(sym).base);
          o.feeCurrency = req.side === "buy" ? asset : quoteAsset;
          if (req.side === "buy") { this.balances[quoteAsset] = (this.balances[quoteAsset] ?? 0) - o.moved; this.balances[asset] = (this.balances[asset] ?? 0) + size - o.fee; }
          else { this.balances[asset] -= size; this.balances[quoteAsset] = (this.balances[quoteAsset] ?? 0) + o.moved - o.fee; }
        } else if (req.side === "buy") { this.balances[quoteAsset] = (this.balances[quoteAsset] ?? 0) - (size * px + o.fee); this.balances[asset] = (this.balances[asset] ?? 0) + size; }
        else { this.balances[asset] -= size; this.balances[quoteAsset] = (this.balances[quoteAsset] ?? 0) + size * px - o.fee; }
      } else if (crosses) {
        if (this.postOnlyRefusal === "http-400") return json(400, { error_id: "e", message: "Post only order would be executed immediately", timestamp: this.now() });
        o.status = "rejected";
      } else if (o.tif === "ioc") o.status = "cancelled";
      else {
        // A resting order holds back what it could spend, and one the account cannot cover is refused at placement — the
        // stricter reading of an exchange that locks funds for its book (a double looser than that would let a quote
        // engine promise the same pound to two bids).
        const need = req.side === "buy" ? FakeRevx.holdFor(quoteAsset, size * price) : size, from = req.side === "buy" ? quoteAsset : asset;
        if ((this.balances[from] ?? 0) - this.reserved(from) + 1e-9 < need) return json(400, { error_id: "e", message: "Insufficient balance", timestamp: this.now() });
      }
      this.orders.set(o.id, o);
      if (this.loseReply) return Promise.reject(new DOMException("The signal has been aborted", "TimeoutError"));
      return json(200, { data: { venue_order_id: o.id, client_order_id: o.client_order_id, state: this.placementReply === "new" ? "new" : o.status } });
    }
    if (p === "/api/1.0/orders/active") {
      for (const o of this.orders.values()) this.landCancel(o);
      return json(200, { data: [...this.orders.values()].filter((o) => o.status === "new" || o.status === "partially_filled").map((o) => this.view(o)), metadata: { timestamp: this.now() } });
    }
    if (p === "/api/1.0/orders/historical") {
      if (this.down.history) return unavailable();
      // Finished orders in [start_date, end_date], as the venue documents the list: WITHOUT total_fee and fee_currency, which
      // only GET /orders/{id} carries (average_fill_price is optional on the list, so the double leaves it out too). A client
      // that settles a fill from this list fails here, as it would against the venue.
      const syms = (url.searchParams.get("symbols") ?? "").split(",").filter(Boolean).map((s) => s.replace("-", "/"));
      const start = Number(url.searchParams.get("start_date") ?? 0), end = Number(url.searchParams.get("end_date") ?? Number.MAX_SAFE_INTEGER);
      const done = [...this.orders.values()].filter((o) => o.status !== "new" && o.status !== "partially_filled" && (!syms.length || syms.includes(o.symbol)) && o.created >= start && o.created <= end);
      // `filled_amount` (the "venue" settlement) is left out with them: a client that priced a fill from the list would find
      // nothing to price it with here, rather than a figure the order itself might not repeat.
      const listView = (o: FakeOrder) => { const v = this.view(o); delete v.total_fee; delete v.fee_currency; delete v.average_fill_price; delete v.filled_amount; return v; };
      return json(200, { data: done.map(listView), metadata: { timestamp: this.now() } });
    }
    if (p.startsWith("/api/1.0/orders/")) {
      const o = this.orders.get(p.split("/").at(-1)!);
      if (!o) return json(404, { message: "Order not found" });
      if (m === "DELETE") {
        this.landCancel(o);
        if (o.status === "new" || o.status === "partially_filled") {
          if (this.cancelMode === "lost") return json(204, null);                 // said and not done
          if (this.cancelLagReads > 0) { o.cancelAsked ??= this.now(); o.cancelReadsLeft ??= this.cancelLagReads; }   // taken: carried out a moment later
          else o.status = "cancelled";
          if (this.cancelMode === "timeout") return Promise.reject(new DOMException("The signal has been aborted", "TimeoutError"));
          return json(204, null);
        }
        return this.deleteFinished === 204 ? json(204, null) : json(404, { message: "Order is not active" });
      }
      this.landCancel(o, true);
      return json(200, { data: this.view(o) });
    }
    if (p === "/api/1.0/balances") {
      if (this.down.balances) return unavailable();
      return json(200, Object.entries(this.balances).map(([currency, v]) => ({ currency, available: String(v), reserved: "0", total: String(v) })));
    }
    return json(404, { message: `fake revx: no route ${m} ${p}` });
  };
}

/** Kraken's public OHLC and Ticker over the same price path: the signal venue. `down` makes OHLC fail as an outage does. */
export class FakeKraken {
  down = false;
  constructor(public now: () => number) {}
  fetch: typeof fetch = (input) => {
    const url = new URL(String(input));
    const method = url.pathname.split("/").at(-1), pair = url.searchParams.get("pair") ?? "";
    const key = (alt: string) => ({ XBTUSD: "XXBTZUSD" } as Record<string, string>)[alt] ?? alt;
    const ok = (result: unknown) => Promise.resolve(new Response(JSON.stringify({ error: [], result })));
    if (method === "OHLC") {
      if (this.down) return Promise.resolve(new Response(JSON.stringify({ error: ["EService:Unavailable"] })));
      const iv = Number(url.searchParams.get("interval")) * 60e3, last = Math.floor(this.now() / iv) * iv;
      const rows = [];
      for (let k = 719; k >= 0; k--) {
        const s = last - k * iv, o = fakePrice(s), c = fakePrice(Math.min(s + iv, this.now()));
        rows.push([s / 1000, String(o), String(Math.max(o, c) * 1.0005), String(Math.min(o, c) * 0.9995), String(c), String(c), "1", 1]);
      }
      return ok({ [key(pair)]: rows, last: last / 1000 });
    }
    if (method === "Ticker") {
      const out: Record<string, unknown> = {};
      for (const alt of pair.split(",")) { const mid = fakePrice(this.now()); out[key(alt)] = { a: [String(mid * 1.00005), "1", "1"], b: [String(mid * 0.99995), "1", "1"], c: [String(mid), "1"], v: ["1", "1"], p: ["1", "1"], t: [1, 1], l: ["1", "1"], h: ["1", "1"], o: "1" }; }
      return ok(out);
    }
    return Promise.resolve(new Response(JSON.stringify({ error: [`EGeneral:Unknown method ${method}`] })));
  };
}

// ── the decision model, over HTTP ───────────────────────────────────────────────────────────────────
/**
 * Jev as `askJev` reaches it: it answers EXACTLY the questions it was asked, each by its type, and nothing else — the
 * reader refuses a reply missing any asked question, so a double that answered a fixed set regardless would hide a
 * question the loop stopped asking, or started asking under another name. A noul answers `healthy`, a score answers
 * `caution`, a choice echoes the state's symbol when it is one of the options. `fail` is a 503 on every transport. The
 * model each transport names is the one it named when measured (reference §2): OpenRouter's snapshot, TypeSafe's version.
 */
/**
 * What the model answered for this state when it was measured: the middle of the state's band, for the row kind asked
 * (`jev_bands.ts`); 0.9 for a state or kind never measured. A stand-in that answered anything else would be looser than
 * the model it stands in for, and since JEV-DRIFT vetoes a flagged answer on a gated row, it would refuse every entry.
 */
export function measuredReply(kind: string, state: Record<string, unknown>): number {
  const b = jevBandCheck(kind, state, 0.5);
  return b && b.min != null && b.max != null ? Math.round(((b.min + b.max) / 2) * 100) / 100 : 0.9;
}

export function jevFetch(opts: { healthy?: number; caution?: number; fail?: boolean; log?: string[]; kind?: string } = {}): typeof fetch {
  return (url, init) => {
    if (opts.fail) return Promise.resolve(new Response("down", { status: 503 }));
    const body = JSON.parse(String(init?.body)) as { state?: Record<string, unknown> & { symbol?: string }; questions?: Record<string, { type: string; criteria?: unknown }> };
    const sym = String(body.state?.symbol);
    opts.log?.push(sym);
    const answers: Record<string, unknown> = {};
    for (const [name, q] of Object.entries(body.questions ?? {})) {
      if (q.type === "noul") answers[name] = { type: "noul", noul: opts.healthy ?? measuredReply(opts.kind ?? "trend-4h", body.state ?? {}) };
      else if (q.type === "score") answers[name] = { type: "score", score: opts.caution ?? 0.1, probabilities: { "0": 0.9, "1": 0.1, "2": 0 }, confidence: 0.85 };
      else if (q.type === "choice") {
        const options = Object.keys((q.criteria ?? {}) as Record<string, unknown>);
        const choice = options.includes(sym) ? sym : options[0];
        answers[name] = { type: "choice", choice, probabilities: { [choice]: 1 }, confidence: 1 };
      }
    }
    const model = String(url) === JEV_OPENROUTER_URL ? "typesafe/jev-1.13-20260917" : "jev-1.13.0";
    return Promise.resolve(new Response(JSON.stringify({ model, answers, usage: { input_tokens: 400, output_tokens: 20, cost: 0.0000168 } })));
  };
}
