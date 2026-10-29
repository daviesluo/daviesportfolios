// CXBOT's tables as 0163 creates them (and 0164 adds `cxbot_positions.funded_through`): each table's columns and the key a write conflicts on. The Deno test's database
// double refuses a write naming a column the table does not have, as PostgREST does (docs/agents/CLAUDE.md: a test double
// at least as strict as what it stands in for); `src/cxbot.test.js` holds this list to the migration, column for column.

export const CXBOT_TABLES: Record<string, { key: string; columns: readonly string[] }> = {
  cxbot_config: { key: "id", columns: ["id", "mode", "venue", "started_at", "ended_at", "budget_usd", "day_stop_usd", "total_stop_usd", "max_orders_day", "created_at"] },
  cxbot_tape: { key: "venue,coin,t", columns: ["venue", "coin", "t", "o", "h", "l", "c", "v", "n", "bid", "ask", "mark", "idx", "funding", "oi", "premium", "fetched_at"] },
  cxbot_ctx: { key: "kind,at", columns: ["kind", "at", "data"] },
  cxbot_questions: {
    key: "id",
    columns: [
      "id", "layer", "issued_at", "deadline", "coin", "direction", "sd24", "stop_frac", "limit_frac", "hold_ms", "start_at", "entry", "stop", "limit_px", "m",
      "pm_slug", "pm_market", "pm_strike", "pm_question", "pm_end", "pm_mid", "pm_last", "deribit_p", "numbers", "state", "y", "y_alt", "how", "resolved_at",
    ],
  },
  cxbot_forecasts: { key: "question_id", columns: ["question_id", "received_at", "p", "reason", "sources", "raw"] },
  cxbot_decisions: {
    key: "id",
    columns: ["id", "received_at", "ts", "action", "category", "coin", "direction", "size", "entry", "stop", "limit_px", "p", "m_base", "event_at", "position_id", "sources", "reason", "invalidation", "raw"],
  },
  cxbot_cycles: { key: "id", columns: ["id", "received_at", "ts", "kind", "equity_usd", "open_positions", "open_risk_usd", "answered", "actions", "notes", "raw"] },
  cxbot_daily: { key: "id", columns: ["id", "received_at", "day", "equity_usd", "pnl_day_usd", "pnl_total_usd", "trades", "summary", "lessons", "raw"] },
  cxbot_requests: { key: "id", columns: ["id", "at", "status", "rows", "action", "error"] },
  cxbot_orders: {
    key: "id",
    columns: [
      "id", "created_at", "updated_at", "mode", "decision_id", "kind", "coin", "direction", "entry_type", "size", "entry", "stop", "limit_px", "p", "good_till",
      "position_id", "state", "fill_price", "filled_at", "fee_usd", "leverage", "checks",
    ],
  },
  cxbot_positions: {
    key: "id",
    columns: [
      "id", "order_id", "decision_id", "coin", "direction", "size", "entry", "stop", "limit_px", "stop0", "limit0", "p", "leverage", "liq_price", "opened_at",
      "fee_open_usd", "funding_usd", "state", "closed_at", "close_price", "close_how", "fee_close_usd", "pnl_usd", "updated_at", "funded_through",
    ],
  },
  cxbot_snapshots: { key: "slot", columns: ["slot", "at", "equity_usd", "realised_usd", "unrealised_usd", "fees_usd", "funding_usd", "open_risk_usd", "positions"] },
  cxbot_reach: { key: "id", columns: ["id", "at", "region", "target", "url", "status", "ms", "ok", "note"] },
  cxbot_exec_state: { key: "id", columns: ["id", "state", "lease_until", "lease_owner", "updated_at", "last_error"] },
};
