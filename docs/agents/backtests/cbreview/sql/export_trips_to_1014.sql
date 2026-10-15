-- The base paper test's own round trips, to 2026-10-15 00:00 UTC (inputs/trips_to_1014.json holds the result). Select only.
select book, side, k, how, t_entry, t_exit, qty, notional_gbp, pnl_gbp from public.cb_quote_trips order by t_entry;
