// GROKPM's tables as migration 0124 creates them: each table's columns in order and its primary key. The Edge tests run
// without file access, so their database doubles hold every write to this list, and `src/grokpm_prereg.test.js` holds the
// list to the migration's own text: a column renamed in one and not the other fails there.

export const GROKPM_TABLES: Readonly<Record<string, { columns: readonly string[]; key: string }>> = {
  grokpm_config: { columns: ["id", "wallet", "funded_usd", "daily_loss_usd", "total_stop_usd", "started_at", "created_at"], key: "id" },
  grokpm_decisions: {
    columns: ["id", "received_at", "ts", "action", "market_id", "token_id", "outcome", "side", "price", "size", "p", "m", "category", "sources", "reason", "invalidation", "order_id", "raw"],
    key: "id",
  },
  grokpm_cycles: { columns: ["id", "received_at", "ts", "kind", "cash_usd", "positions_value_usd", "pnl_usd", "open_positions", "actions", "notes", "raw"], key: "id" },
  grokpm_daily: {
    columns: ["id", "received_at", "day", "cash_usd", "positions_value_usd", "pnl_day_usd", "pnl_total_usd", "trades", "summary", "lessons", "raw"], key: "id",
  },
  grokpm_requests: { columns: ["id", "at", "status", "rows", "error"], key: "id" },
  grokpm_snapshots: {
    columns: ["slot", "at", "cash_pusd", "cash_usdce", "cash_usdc", "cash_usd", "positions_value_usd", "value_api_usd", "equity_usd", "positions"], key: "slot",
  },
  grokpm_activity: {
    columns: ["key", "ts", "type", "cond", "asset", "side", "size", "price", "usdc_size", "tx", "outcome_index", "title", "raw", "recorded_at"], key: "key",
  },
  grokpm_entries: { columns: ["asset", "cond", "outcome_index", "title", "first_seen_at", "first_fill_at", "mid", "mid_at", "avg_price"], key: "asset" },
  grokpm_resolutions: { columns: ["cond", "tokens", "payouts", "closed_at", "read_at"], key: "cond" },
  grokpm_rec_state: { columns: ["id", "state", "updated_at", "last_error", "last_report"], key: "id" },
};
