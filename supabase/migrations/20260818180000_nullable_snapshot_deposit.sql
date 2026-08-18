-- Value-only snapshots while T212 history is still walking.
--
-- snapshot-record can compute PORTFOLIO (and leftover closed lots)
-- before the fill backfill latches `complete`. Those ticks must still
-- write value_usd; deposit_usd stays NULL so the chart uses the
-- derived formula instead of treating an incomplete book as fills.
-- Applied automatically: `migrations.yml` runs `supabase db push` on
-- every push to main that touches this directory. Do NOT also apply
-- this by hand.

alter table public.portfolio_snapshots
  alter column deposit_usd drop not null;
