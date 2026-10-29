// IGBOT's tables as 0157 creates them and 0159 and 0165 extend them: each table's columns and the key a write conflicts on. The Deno test's database
// double refuses a write that names a column the table does not have, as PostgREST does, so a test cannot certify a write
// production would refuse (the lesson of 2026-09-22 in docs/agents/CLAUDE.md). `src/igbot.test.js` holds this list to the
// migration's text, column for column.

export const IGBOT_TABLES: Record<string, { key: string; columns: readonly string[] }> = {
  igbot_config: { key: "id", columns: ["id", "environment", "mode", "armed_at", "started_at", "budget_gbp", "day_stop_gbp", "total_stop_gbp", "max_orders_day", "created_at"] },
  igbot_instruments: { key: "epic", columns: ["epic", "name", "kind", "enabled", "added_at"] },
  igbot_decisions: {
    key: "id",
    columns: ["id", "received_at", "ts", "action", "category", "epic", "direction", "size", "level", "stop_level", "limit_level", "p_target", "m_base", "event_at", "deal_id", "sources", "reason", "invalidation", "raw"],
  },
  igbot_cycles: { key: "id", columns: ["id", "received_at", "ts", "kind", "equity_gbp", "open_positions", "open_risk_gbp", "actions", "notes", "raw"] },
  igbot_daily: { key: "id", columns: ["id", "received_at", "day", "equity_gbp", "pnl_day_gbp", "pnl_total_gbp", "trades", "summary", "lessons", "raw"] },
  igbot_requests: { key: "id", columns: ["id", "at", "status", "rows", "action", "error", "ig_calls"] },
  igbot_orders: {
    key: "id",
    columns: [
      "id", "created_at", "updated_at", "mode", "decision_id", "kind", "epic", "direction", "size", "level", "stop_level", "limit_level", "entry", "good_till",
      "deal_reference", "deal_id", "state", "reason", "request", "confirm", "checks",
    ],
  },
  igbot_positions: {
    key: "deal_id",
    columns: [
      "deal_id", "epic", "direction", "size", "open_level", "stop_level", "limit_level", "guaranteed", "premium", "opened_at", "order_id", "decision_id", "state",
      "closed_at", "close_level", "close_how", "pnl_gbp", "updated_at",
    ],
  },
  igbot_snapshots: {
    key: "slot",
    columns: ["slot", "at", "ok", "equity_gbp", "balance_gbp", "upl_gbp", "margin_gbp", "available_gbp", "open_risk_gbp", "positions", "working", "error"],
  },
  // 0165: the IG session every isolate shares, sealed, and the claim that lets one isolate at a time log in.
  igbot_exec_state: { key: "id", columns: ["id", "state", "lease_until", "lease_owner", "updated_at", "last_error", "session_box", "login_until"] },
  // 0159 (the 2026-10-29 audit): IG's HOUR bars for the reading, keyed on the market and the hour.
  igbot_bars: {
    key: "epic,hour",
    columns: ["epic", "hour", "fetched_at", "bid_open", "bid_high", "bid_low", "bid_close", "ask_open", "ask_high", "ask_low", "ask_close"],
  },
};
