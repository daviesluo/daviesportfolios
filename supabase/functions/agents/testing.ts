// Test doubles for the agents loop — imported by the tests only, never by the function.
//
// ONE implementation of each rule a double must honour. Twice on 2026-09-22 a double looser than the thing it stands
// in for certified what production rejects: the in-memory database ignored `agent_orders_mode_check`, so three tests
// passed a sell Postgres refused; and it paged without `db.ts`'s order guard, so 338 tests stayed green while the tick
// threw on every run for three hours. The rules below are the schema's (0037, 0041, 0042), checked on INSERT *and*
// UPDATE, because Postgres checks both — a settle whose fee is NaN goes over the wire as null and is refused by
// `fee_usd NOT NULL` exactly as a bad insert is.
import { assertPagedOrder, PAGE_ROWS, type Db } from "./db.ts";

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
  // The stablecoin books' record (0057).
  agent_book_levels: { columns: ["book", "ts", "bids", "asks"], key: "book,ts" },
};
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
  if (table in PMRW_TABLES) {
    const unknown = Object.keys(r).find((c) => !PMRW_TABLES[table].columns.includes(c));
    if (unknown) return `Could not find the '${unknown}' column of '${table}' in the schema cache`;
    if (table === "pm_rw_state" || table === "pm_rw_e_state") return check("id", r.id === 1) ?? notNull(["state"]);
    if (table === "agent_book_levels") {
      return notNull(["book", "ts", "bids", "asks"]) ?? check("book", ["USDC-USD", "USDT-USD", "USDC-GBP", "USDT-GBP"].includes(String(r.book)));
    }
    if (table === "pm_rw_e_days") {
      return notNull(["day", "arm", "total", "stress_total", "reward", "fills", "capital", "markets", "detail"]) ?? check("arm", ["rw", "e"].includes(String(r.arm)))
        ?? check("fills", Number(r.fills) >= 0) ?? check("capital", Number(r.capital) >= 0) ?? check("markets", Number(r.markets) >= 0);
    }
    if (table === "pm_rw_selection") {
      return notNull(["day", "cond", "rank", "yes", "tick", "v", "min_size", "rate", "per_dollar_day", "capital"])
        ?? check("rank", Number(r.rank) > 0) ?? check("tick", Number(r.tick) > 0) ?? check("v", Number(r.v) > 0)
        ?? check("min_size", Number(r.min_size) >= 0) ?? check("rate", Number(r.rate) >= 0) ?? check("capital", Number(r.capital) > 0);
    }
    if (table === "pm_rw_minutes") return notNull(["cond", "minute", "quoting", "tick"]) ?? check("tick", Number(r.tick) > 0);
    if (table === "pm_rw_prints") {
      return notNull(["id", "cond", "ts", "side", "oi", "price", "size"]) ?? check("side", ["BUY", "SELL"].includes(String(r.side)))
        ?? check("price", Number(r.price) >= 0 && Number(r.price) <= 1) ?? check("size", Number(r.size) > 0);
    }
    if (table === "pm_rw_fills") {
      return notNull(["cond", "minute", "ts", "side", "price", "size", "print_id"]) ?? check("side", ["bid", "ask"].includes(String(r.side)))
        ?? check("price", Number(r.price) > 0 && Number(r.price) < 1) ?? check("size", Number(r.size) > 0);
    }
    if (table === "pm_rw_days") {
      return notNull(["day", "total", "stress_total", "reward", "fills", "capital", "markets", "detail"])
        ?? check("fills", Number(r.fills) >= 0) ?? check("capital", Number(r.capital) >= 0) ?? check("markets", Number(r.markets) >= 0);
    }
    return notNull(["cond", "payout", "net", "cash"]) ?? check("payout", Number(r.payout) >= 0 && Number(r.payout) <= 1);
  }
  if (table === "agent_decisions") {
    return notNull(["strategy_id", "venue", "symbol", "mode", "bar_start", "state", "numbers", "provider", "rule_action", "rule_reason", "final_action", "final_reason", "risk_allowed", "risk_reason"])
      ?? check("venue", VENUES.includes(String(r.venue)));
  }
  if (table in LIVE_QUOTE_TABLES) {
    const unknown = Object.keys(r).find((c) => !LIVE_QUOTE_TABLES[table].columns.includes(c));
    if (unknown) return `Could not find the '${unknown}' column of '${table}' in the schema cache`;
    if (table === "agent_quote_live_config") {
      return check("id", r.id === 1) ?? notNull(["dry_run", "capital_gbp"]) ?? check("capital_gbp", Number(r.capital_gbp) > 0);
    }
    if (table === "agent_quote_live_state") return check("id", r.id === 1) ?? notNull(["state"]);
    if (table === "agent_quote_live_events") {
      return notNull(["mode", "minute", "book", "rung_side", "k", "kind", "detail"])
        ?? check("mode", ["dry_run", "live"].includes(String(r.mode)))
        ?? check("book", [...QUOTE_BOOKS_OK, "-"].includes(String(r.book)))
        ?? check("rung_side", ["bid", "ask", "-"].includes(String(r.rung_side)))
        ?? check("kind", ["skip", "guard", "stop_unfilled", "loss_stop"].includes(String(r.kind)));
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
  return null;
}

/**
 * 0052's two unique indexes on `agent_quote_live_orders`, as Postgres applies them to the row as stored (on INSERT and on
 * UPDATE): `client_order_id uuid unique`, and never two OPEN rows on one rung of one mode — the partial index
 * `agent_quote_live_orders_one_open_per_rung`. A conversion (no rung) is outside the second.
 */
function liveQuoteOrderConflict(rows: Row[], r: Row, self: Row | null): string | null {
  if (!UUID.test(String(r.client_order_id))) return `400: invalid input syntax for type uuid: "${r.client_order_id}"`;
  const others = rows.filter((x) => x !== self);
  if (others.some((x) => x.client_order_id === r.client_order_id)) {
    return "409: duplicate key value violates unique constraint \"agent_quote_live_orders_client_order_id_key\"";
  }
  const open = (x: Row) => LIVE_OPEN_STATES.includes(String(x.state)) && x.rung_side != null;
  if (open(r) && others.some((x) => open(x) && x.mode === r.mode && x.book === r.book && x.rung_side === r.rung_side && Number(x.k) === Number(r.k))) {
    return "409: duplicate key value violates unique constraint \"agent_quote_live_orders_one_open_per_rung\"";
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
  if (table === "agent_quote_live_orders") {
    return {
      rung_side: null, k: null, venue_order_id: null, state: "pending", filled_base: 0, avg_fill_price: null, fee_gbp: 0, paper_oid: null, paper_live: null,
      fair: null, request: null, response: null, book_seen: null, cancel_requested_at: null, cancel_reason: null, filled_at: null, cancelled_at: null, ...r,
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
      return Promise.resolve((select ? rows.map((r) => Object.fromEntries(select!.map((c) => [c, r[c]]))) : rows.map((r) => ({ ...r }))) as any);
    },
    insert: (table, rows, returning = true) => {
      const list = (overTheWire(Array.isArray(rows) ? rows : [rows]) as Row[]).map((r) => withDefaults(table, r));
      for (const r of list) {
        const why = schemaRefusal(table, r);
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
      if (table === "agent_quote_live_orders") {
        const seen: Row[] = [...(tables[table] ?? [])];
        for (const r of list) {
          const why = liveQuoteOrderConflict(seen, r, null);
          if (why) return Promise.reject(new Error(`db POST ${table} → ${why}`));
          seen.push(r);
        }
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
      if ((table in QUOTE_TABLES && onConflict !== QUOTE_TABLES[table].key) || (table in LIVE_QUOTE_TABLES && onConflict !== LIVE_QUOTE_TABLES[table].key)
        || (table in PMRW_TABLES && onConflict !== PMRW_TABLES[table].key)) {
        return refuse("POST", table, "there is no unique or exclusion constraint matching the ON CONFLICT specification");
      }
      const t = (tables[table] ??= []);
      const list = overTheWire(rows) as Row[];
      for (const r of list) {
        const cur = t.find((x) => keys.every((k) => String(x[k]) === String(r[k])));
        // Postgres checks NOT NULL on the row an upsert PROPOSES, before it looks for the conflict: an ON CONFLICT
        // update that leaves out a not-null column is refused even when the row exists. The paper RW tables are held
        // to that (their decisions are written as upserts onto rows recorded a minute earlier).
        const why = schemaRefusal(table, table in PMRW_TABLES ? r : cur ? { ...cur, ...r } : r);
        if (why) return refuse("POST", table, why);        // the statement fails whole: nothing is written
      }
      for (const r of list) {
        const i = t.findIndex((x) => keys.every((k) => String(x[k]) === String(r[k])));
        if (i >= 0) t[i] = { ...t[i], ...r }; else t.push({ ...r });
      }
      return Promise.resolve();
    },
    update: (table, query, patch) => {
      const { filters } = parse(query);
      const wire = overTheWire(patch) as Row;
      const hit = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      for (const r of hit) {
        const why = schemaRefusal(table, { ...r, ...wire });
        if (why) return refuse("PATCH", table, why);     // Postgres refuses the statement: no row changes
        if (table === "agent_quote_live_orders") {
          const clash = liveQuoteOrderConflict(tables[table], { ...r, ...wire }, r);
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

// ── fake venues over HTTP, for driving the REAL venue clients ─────────────────────────────────────────

/** A steady rise of 0.2 % a 4-hour bar: every closed bar breaks the prior 55-bar high and the averages stay stacked up. */
export const FAKE_EPOCH = Date.parse("2026-06-01T00:00:00Z");
export const fakePrice = (t: number) => 100 * Math.pow(1.002, (t - FAKE_EPOCH) / (4 * 3600e3));

type FakeOrder = {
  id: string; client_order_id: string; symbol: string; side: "buy" | "sell"; status: string; price: string; quantity: string;
  filled: number; avg: number | null; fee: number; tif: string; postOnly: boolean; created: number;
};

/** Revolut X's own configuration of PR5's two GBP books (public pair list, 2026-09-24 00:12 UTC; `backtests/pr5_live/inputs`). */
export const GBP_BOOK_PAIR = { base_step: "0.00001", quote_step: "0.0001", min_order_size: "0.00001", max_order_size: "4000000", min_order_size_quote: "0.1", max_order_size_quote: "1000000", status: "active" };

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
  /** What DELETE answers for an order that already finished: the reference documents only 204 for a cancel. */
  deleteFinished: 204 | 404 = 404;
  /** Endpoints answering 503, as a venue does for a minute now and then: a decision can then be allowed with no order behind it. */
  down: { pairs?: boolean; tickers?: boolean; balances?: boolean; history?: boolean } = {};
  /** The `state` a placement reply carries: the order's own ("status"), or always "new" — the word the documented example uses. */
  placementReply: "status" | "new" = "status";
  /** The venue takes the order and the reply never arrives (a timeout after the fact): the caller sees a thrown fetch. */
  loseReply = false;
  calls: string[] = [];
  onPost?: () => void;
  private seq = 1;
  constructor(public now: () => number) {}
  quote(sym: string) {
    if (this.gbpBooks[sym]) return { ...this.gbpBooks[sym] };
    const mid = fakePrice(this.now()) * (this.shock[sym] ?? 1);
    const half = (this.spreadBps[sym] ?? 2) / 2 / 1e4;
    return { bid: Math.round(mid * (1 - half) * 100) / 100, ask: Math.round(mid * (1 + half) * 100) / 100 };
  }
  /** What resting orders hold back of an asset: a resting buy its quote currency, a resting sell its coin. */
  reserved(asset: string): number {
    let n = 0;
    for (const o of this.orders.values()) {
      if (o.status !== "new" && o.status !== "partially_filled") continue;
      const [base, quote] = o.symbol.split("/"), left = Number(o.quantity) - o.filled;
      if (o.side === "buy" && quote === asset) n += left * Number(o.price);
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
    if (!o || (o.status !== "new" && o.status !== "partially_filled")) throw new Error(`fake revx: ${id} is not resting`);
    const [base, quote] = o.symbol.split("/"), px = Number(o.price);
    const q = Math.min(qty, Number(o.quantity) - o.filled);
    o.avg = o.filled > 0 && o.avg != null ? (o.avg * o.filled + px * q) / (o.filled + q) : px;
    o.filled = Math.round((o.filled + q) * 1e9) / 1e9;
    o.status = o.filled >= Number(o.quantity) - 1e-12 ? "filled" : "partially_filled";
    if (o.side === "buy") { this.balances[quote] = (this.balances[quote] ?? 0) - q * px; this.balances[base] = (this.balances[base] ?? 0) + q; }
    else { this.balances[base] = (this.balances[base] ?? 0) - q; this.balances[quote] = (this.balances[quote] ?? 0) + q * px; }
  }
  /** Every order still resting on `symbol` (slash form). */
  resting(symbol?: string): FakeOrder[] {
    return [...this.orders.values()].filter((o) => (o.status === "new" || o.status === "partially_filled") && (!symbol || o.symbol === symbol));
  }
  private view(o: FakeOrder): Record<string, unknown> {
    const body: Record<string, unknown> = {
      id: o.id, client_order_id: o.client_order_id, symbol: o.symbol, side: o.side, type: "limit", quantity: o.quantity,
      filled_quantity: String(o.filled), leaves_quantity: String(Number(o.quantity) - o.filled), price: o.price,
      average_fill_price: o.avg == null ? "0" : String(o.avg), total_fee: String(o.fee), fee_currency: o.symbol.split("/")[1],
      status: o.status, time_in_force: o.tif, execution_instructions: [o.postOnly ? "post_only" : "allow_taker"], created_date: o.created, updated_date: o.created,
    };
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
      const cfg = { base: "BTC", quote: "USD", base_step: "0.00000001", quote_step: "0.01", min_order_size: "0.00000001", max_order_size: "200", min_order_size_quote: "0.1", max_order_size_quote: "1000000", status: "active" };
      return json(200, { "BTC/USD": cfg, "USDC/GBP": { base: "USDC", quote: "GBP", ...GBP_BOOK_PAIR }, "USDT/GBP": { base: "USDT", quote: "GBP", ...GBP_BOOK_PAIR } });
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
      this.onPost?.();
      const req = JSON.parse(String(init!.body));
      const sym = String(req.symbol).replace("-", "/"), lim = req.order_configuration.limit;
      const q = this.quote(sym), price = Number(lim.price), size = Number(lim.base_size), asset = sym.split("/")[0], quoteAsset = sym.split("/")[1];
      // What the venue's own client and CLI accept at placement (see `PlaceTimeInForce` in _shared/revx.ts): gtc or ioc,
      // gtc when omitted, and never post_only with ioc. The double refuses the rest, as the stricter reading of the venue would.
      const tif = lim.time_in_force ?? "gtc";
      if (tif !== "gtc" && tif !== "ioc") return json(400, { error_id: "e", message: `time_in_force ${tif} is not accepted on placement`, timestamp: this.now() });
      if (tif === "ioc" && (lim.execution_instructions ?? []).includes("post_only")) return json(400, { error_id: "e", message: "post_only cannot be combined with ioc", timestamp: this.now() });
      const o: FakeOrder = { id: `rx-${this.seq++}`, client_order_id: req.client_order_id, symbol: sym, side: req.side, status: "new", price: lim.price, quantity: lim.base_size, filled: 0, avg: null, fee: 0, tif, postOnly: (lim.execution_instructions ?? []).includes("post_only"), created: this.now() };
      const crosses = req.side === "buy" ? price >= q.ask : price <= q.bid;
      if (crosses && !o.postOnly) {
        const px = req.side === "buy" ? q.ask : q.bid;
        if (req.side === "sell" && (this.balances[asset] ?? 0) - this.reserved(asset) + 1e-12 < size) return json(400, { error_id: "e", message: "Insufficient balance", timestamp: this.now() });
        if (req.side === "buy" && (this.balances[quoteAsset] ?? 0) - this.reserved(quoteAsset) + 1e-9 < size * px * 1.0009) return json(400, { error_id: "e", message: "Insufficient balance", timestamp: this.now() });
        o.filled = size; o.avg = px; o.fee = Math.round(size * px * 0.0009 * 1e8) / 1e8; o.status = "filled";
        if (req.side === "buy") { this.balances[quoteAsset] = (this.balances[quoteAsset] ?? 0) - (size * px + o.fee); this.balances[asset] = (this.balances[asset] ?? 0) + size; }
        else { this.balances[asset] -= size; this.balances[quoteAsset] = (this.balances[quoteAsset] ?? 0) + size * px - o.fee; }
      } else if (crosses) {
        if (this.postOnlyRefusal === "http-400") return json(400, { error_id: "e", message: "Post only order would be executed immediately", timestamp: this.now() });
        o.status = "rejected";
      } else if (o.tif === "ioc") o.status = "cancelled";
      else {
        // A resting order holds back what it could spend, and one the account cannot cover is refused at placement — the
        // stricter reading of an exchange that locks funds for its book (a double looser than that would let a quote
        // engine promise the same pound to two bids).
        const need = req.side === "buy" ? size * price : size, from = req.side === "buy" ? quoteAsset : asset;
        if ((this.balances[from] ?? 0) - this.reserved(from) + 1e-9 < need) return json(400, { error_id: "e", message: "Insufficient balance", timestamp: this.now() });
      }
      this.orders.set(o.id, o);
      if (this.loseReply) return Promise.reject(new DOMException("The signal has been aborted", "TimeoutError"));
      return json(200, { data: { venue_order_id: o.id, client_order_id: o.client_order_id, state: this.placementReply === "new" ? "new" : o.status } });
    }
    if (p === "/api/1.0/orders/active") return json(200, { data: [...this.orders.values()].filter((o) => o.status === "new" || o.status === "partially_filled").map((o) => this.view(o)), metadata: { timestamp: this.now() } });
    if (p === "/api/1.0/orders/historical") {
      if (this.down.history) return unavailable();
      // Finished orders in [start_date, end_date], as the venue documents the list: WITHOUT total_fee and fee_currency, which
      // only GET /orders/{id} carries (average_fill_price is optional on the list, so the double leaves it out too). A client
      // that settles a fill from this list fails here, as it would against the venue.
      const syms = (url.searchParams.get("symbols") ?? "").split(",").filter(Boolean).map((s) => s.replace("-", "/"));
      const start = Number(url.searchParams.get("start_date") ?? 0), end = Number(url.searchParams.get("end_date") ?? Number.MAX_SAFE_INTEGER);
      const done = [...this.orders.values()].filter((o) => o.status !== "new" && o.status !== "partially_filled" && (!syms.length || syms.includes(o.symbol)) && o.created >= start && o.created <= end);
      const listView = (o: FakeOrder) => { const v = this.view(o); delete v.total_fee; delete v.fee_currency; delete v.average_fill_price; return v; };
      return json(200, { data: done.map(listView), metadata: { timestamp: this.now() } });
    }
    if (p.startsWith("/api/1.0/orders/")) {
      const o = this.orders.get(p.split("/").at(-1)!);
      if (!o) return json(404, { message: "Order not found" });
      if (m === "DELETE") {
        if (o.status === "new" || o.status === "partially_filled") {
          if (this.cancelMode === "lost") return json(204, null);                 // said and not done
          o.status = "cancelled";
          if (this.cancelMode === "timeout") return Promise.reject(new DOMException("The signal has been aborted", "TimeoutError"));
          return json(204, null);
        }
        return this.deleteFinished === 204 ? json(204, null) : json(404, { message: "Order is not active" });
      }
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
 * `caution`, a choice echoes the state's symbol when it is one of the options. `fail` is a 503 on every transport.
 */
export function jevFetch(opts: { healthy?: number; caution?: number; fail?: boolean; log?: string[] } = {}): typeof fetch {
  return (_url, init) => {
    if (opts.fail) return Promise.resolve(new Response("down", { status: 503 }));
    const body = JSON.parse(String(init?.body)) as { state?: { symbol?: string }; questions?: Record<string, { type: string; criteria?: unknown }> };
    const sym = String(body.state?.symbol);
    opts.log?.push(sym);
    const answers: Record<string, unknown> = {};
    for (const [name, q] of Object.entries(body.questions ?? {})) {
      if (q.type === "noul") answers[name] = { type: "noul", noul: opts.healthy ?? 0.9 };
      else if (q.type === "score") answers[name] = { type: "score", score: opts.caution ?? 0.1, probabilities: { "0": 0.9, "1": 0.1, "2": 0 }, confidence: 0.85 };
      else if (q.type === "choice") {
        const options = Object.keys((q.criteria ?? {}) as Record<string, unknown>);
        const choice = options.includes(sym) ? sym : options[0];
        answers[name] = { type: "choice", choice, probabilities: { [choice]: 1 }, confidence: 1 };
      }
    }
    return Promise.resolve(new Response(JSON.stringify({ model: "typesafe/jev-1.13-test", answers, usage: { input_tokens: 400, output_tokens: 20, cost: 0.0000168 } })));
  };
}
