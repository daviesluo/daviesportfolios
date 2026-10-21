-- 0135: Alphabet on the board is GOOGL, class A, the line Davies holds, not GOOG (class C).
--
-- On whose word. Davies, 2026-10-21 (relayed in English): "I've only just noticed that all the Google I hold is GOOGL,
-- not the GOOG the site shows. Please fix every place that relates to it." Every Trading 212 fill (36) and dividend
-- (15) of it is `GOOGL_US_EQ`; the shared map (`_shared/t212_tickers.ts`) carried it to the board as GOOG on purpose
-- until this change ("the board tracks class C"), so prices, the chart, earnings and Target price read the other line.
--
-- What it changes, all in one statement block, so all or nothing:
--   board_data (id 1)   the holding moves whole from key GOOG to key GOOGL (lots, sells, Trading 212 tags, cost, every
--                       field as stored), and each tactics-board slot listing GOOG lists GOOGL in its place. `version`
--                       goes up by one, so a tab still holding the old board meets a 412 on its next save instead of
--                       writing GOOG back. The version replaced is kept in `board_data_history` by 0098's trigger:
--                       the rename can be undone from there, by its version, as any save can.
--   t212_orders         the class A line's fills (`t212_ticker` GOOGL_US_EQ) say GOOGL, as the map now gives them.
--   t212_dividends      the same for its dividends.
--   analyst_targets     GOOG's snapshot goes; the targets job writes GOOGL's at its next slot.
-- Left as they are, being GOOG's own prices or caches: price_snapshots, overnight_intraday_points, the fundamentals
-- cache, and board_data_history's earlier versions (a version restored from before this is renamed by running the
-- block below again).
--
-- Safe to run twice: a board without GOOG is not touched, and the row updates match nothing the second time. A board
-- holding BOTH tickers stops the whole migration with an error, nothing changed: two positions are merged by a person.
-- The client renames its own stored copies at schema version 3 (`src/portfolio/ticker_rename.js`).

set lock_timeout = '3s';

do $$
declare
  old_data jsonb;
  new_data jsonb;
begin
  select data into old_data from public.board_data where id = 1 for update;
  if old_data is not null and jsonb_typeof(old_data->'holdings') = 'object' and old_data->'holdings' ? 'GOOG' then
    if old_data->'holdings' ? 'GOOGL' then
      raise exception '0135: the board holds both GOOG and GOOGL; nothing renamed (merge them by hand, then rerun)';
    end if;
    -- rename:begin (the dry run reads this expression as it stands)
    new_data := jsonb_set(old_data #- '{holdings,GOOG}', '{holdings,GOOGL}', old_data->'holdings'->'GOOG')
      || case when jsonb_typeof(old_data->'positions') = 'object' then jsonb_build_object('positions', (
           select coalesce(jsonb_object_agg(p.key,
             case when jsonb_typeof(p.value->'tickers') = 'array' then
               jsonb_set(p.value, '{tickers}', coalesce((
                 select jsonb_agg(to_jsonb(case when x.t = 'GOOG' then 'GOOGL' else x.t end) order by x.ord)
                 from jsonb_array_elements_text(p.value->'tickers') with ordinality as x(t, ord)
                 where not (x.t = 'GOOG' and p.value->'tickers' ? 'GOOGL')), '[]'::jsonb))
             else p.value end), '{}'::jsonb)
           from jsonb_each(old_data->'positions') as p)) else '{}'::jsonb end;
    -- rename:end
    update public.board_data set data = new_data, version = version + 1, updated_at = now() where id = 1;
  end if;

  update public.t212_orders set ticker = 'GOOGL' where ticker = 'GOOG' and t212_ticker = 'GOOGL_US_EQ';
  update public.t212_dividends set ticker = 'GOOGL' where ticker = 'GOOG' and t212_ticker = 'GOOGL_US_EQ';
  delete from public.analyst_targets where ticker = 'GOOG';
end $$;

reset lock_timeout;
