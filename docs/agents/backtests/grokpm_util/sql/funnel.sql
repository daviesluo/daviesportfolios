-- GROKPM utilisation study (2026-10-28): the funnel by UTC day over every counted shadow row (and the agent's own opens):
-- rows with p and m, markets, rows clearing the category bar (A 8, B 12) on p - m, of those with a recorded book, with a
-- two-sided book of spread 5 points or under, category B among them, with the market's end 48 h or more away (D15's cut), and
-- with $500 of bids within 5 points (the ordinary path). Read-only. Run 2026-10-28 ~21:30 UTC.
with s as (select d.id, d.received_at, d.market_id, d.category, d.p, d.m, d.p - d.m e, mk.end_date, sm.book_bid bb, sm.book_ask ba,
                  sm.bid_depth_usd bd, d.action
             from grokpm_decisions d left join grokpm_markets mk on mk.cond = d.market_id
             left join grokpm_shadow_marks sm on sm.decision_id = d.id
            where d.p is not null and d.m is not null and d.received_at > '2026-10-20 17:30+00'),
t as (select *, (e >= case when category = 'A' then 0.08 else 0.12 end) clear_bar,
             (bb is not null and ba is not null) has_book, (bb is not null and ba is not null and ba - bb <= 0.05) tight,
             extract(epoch from end_date - received_at) / 3600 hrs_to_end from s)
select to_char(received_at, 'MM-DD') as d, count(*) nrows, count(distinct market_id) mkts,
       count(*) filter (where clear_bar) clear_rows, count(distinct market_id) filter (where clear_bar) clear_mkts,
       count(*) filter (where clear_bar and has_book) w_book, count(*) filter (where clear_bar and tight) tight_rows,
       count(*) filter (where clear_bar and tight and category = 'B') tight_b,
       count(*) filter (where clear_bar and tight and category = 'B' and hrs_to_end >= 48) tight_b_48h,
       count(*) filter (where clear_bar and tight and category = 'B' and hrs_to_end >= 48 and bd >= 500) deep,
       count(*) filter (where action = 'open') opens
  from t group by 1 order by 1;
