-- Mark the purchases Trading 212 has no record of, so the rebuild can't
-- take them.
--
-- The refresh tick now replaces a synced holding's ledger with the
-- broker's own executed fills (`applyFillLedgers` in `src/t212_fills.js`).
-- That is what puts real trades in front of the owner instead of the
-- averaged stand-ins the board carried — SPCX had ONE lot of 59 @ 144.31,
-- which is T212's average price and not a trade that ever happened, while
-- the twelve real fills ran 165.58 down to 115.48 over a month.
--
-- Three holdings are also held somewhere the broker cannot see, and those
-- rows must survive the replacement. `src: 'other'` is what says so:
--
--   SPCX   2026-04-19   50 @ 105.40
--   SPCX   2026-06-12   21 @ 135.00
--   RKLB   2025-11-07   11.5 @ 48.18
--   HOOD   2026-02-02   30 @ 81.09
--
-- These are the owner's own records for the other platform, and they are
-- exactly the excess over each broker slice: 130 − 59, 160 − 148.5,
-- 50 − 20. With them kept and the rest rebuilt from fills, every one of
-- the three nets back to the share count already on the board — which is
-- the condition the rebuild refuses to act without.
--
-- Everything NOT marked here is the broker's to replace, including the
-- averaged stand-ins above and the hand-typed rows that mirror real T212
-- fills. Nothing is lost: the fills are a strictly better record of the
-- same trades, with the real dates and the real prices.
--
-- Rows added later in the lot editor mark themselves (`addLot` stamps
-- `src: 'other'`), so this is a one-off for what predates that.
--
-- Idempotent: each statement fires only while the ticker carries no
-- marked row yet. Applied by `migrations.yml` on push to main — do NOT
-- also run it by hand.

update public.board_data
set data = jsonb_set(data, '{holdings,SPCX,lots}', (
      select jsonb_agg(
               case when l ->> 'date' in ('2026-04-19', '2026-06-12')
                    then l || '{"src":"other"}'::jsonb
                    else l end
               order by ord)
      from jsonb_array_elements(data -> 'holdings' -> 'SPCX' -> 'lots')
           with ordinality as t(l, ord)
    )),
    version = version + 1,
    updated_at = now()
where id = 1
  and data -> 'holdings' -> 'SPCX' -> 'lots' is not null
  and not exists (
    select 1 from jsonb_array_elements(data -> 'holdings' -> 'SPCX' -> 'lots') l
    where l ->> 'src' = 'other'
  );

update public.board_data
set data = jsonb_set(data, '{holdings,RKLB,lots}', (
      select jsonb_agg(
               case when l ->> 'date' = '2025-11-07'
                    then l || '{"src":"other"}'::jsonb
                    else l end
               order by ord)
      from jsonb_array_elements(data -> 'holdings' -> 'RKLB' -> 'lots')
           with ordinality as t(l, ord)
    )),
    updated_at = now()
where id = 1
  and data -> 'holdings' -> 'RKLB' -> 'lots' is not null
  and not exists (
    select 1 from jsonb_array_elements(data -> 'holdings' -> 'RKLB' -> 'lots') l
    where l ->> 'src' = 'other'
  );

update public.board_data
set data = jsonb_set(data, '{holdings,HOOD,lots}', (
      select jsonb_agg(
               case when l ->> 'date' = '2026-02-02'
                    then l || '{"src":"other"}'::jsonb
                    else l end
               order by ord)
      from jsonb_array_elements(data -> 'holdings' -> 'HOOD' -> 'lots')
           with ordinality as t(l, ord)
    )),
    updated_at = now()
where id = 1
  and data -> 'holdings' -> 'HOOD' -> 'lots' is not null
  and not exists (
    select 1 from jsonb_array_elements(data -> 'holdings' -> 'HOOD' -> 'lots') l
    where l ->> 'src' = 'other'
  );
