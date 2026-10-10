-- LP-ALLOC: adverse selection by market type, read-only. Every paper fill of RW (pm_rw_fills, 09-24 -> 10-08), RW-C
-- (pm_rwc_fills, 10-08 ->), live-prep's paper layer (pm_lpprep_fills, 10-04 -> 10-09) and live-prep's live fills
-- (pm_lp_fills, CONFIRMED, from 10-09), marked at the path's own recorded mid 5, 30 and 120 minutes later (RW / RW-C: the
-- minute's adjusted mid `m`; live-prep: (ab + aa) / 2 of its minutes, dry-run for the paper layer, live for live): the
-- markout of a bid fill (bought YES) is mid later - price, of an ask fill (sold YES / bought NO) price - mid later, times
-- the shares. Beside it, the formula reward each path's minutes credit the same markets (RW / RW-C `reward`, live-prep
-- `formula_usd`, all at the programme its selection read). The type is a pattern on the market's question
-- (the first of pm_rec_markets, pm_rw_selection, pm_rwc_selection and pm_lp_markets that names it). The reply is one JSON row per path and type.
with qs as (select cond, question qq from public.pm_rec_markets union select cond, q from public.pm_rw_selection union select cond, q from public.pm_rwc_selection union select cond, question from public.pm_lp_markets),
q as (select cond, lower(max(qq)) q from qs group by cond),
ty as (select cond, case
  when q ~ '(highest temperature|lowest temperature|rain |rain\?|precipitation|wind gust|drought|earthquake|water level|peak at category|°)' then 'weather/nature'
  when q ~ '(mtv|video music)' then 'entertainment/sports'
  when q ~ '(views|video|posts? |tweets|truth social|monthly listeners|streams|first week sales|spotify|song this week|netflix show|tokens the week|market share|deaths)' then 'counts'
  when q ~ '(box office|rotten tomatoes|tomatometer)' then 'box office/reviews'
  when q ~ '(ai model|anthropic|openai|gemini|gpt|grok|claude|deepseek|mistral|llm|arena|livebench|meta muse|fable model)' then 'AI'
  when q ~ '(inflation|cpi|pce|gdp|jobs|jolts|pmi|fed |bps|s&p|spx|spy|wti|crude|etf|\(low\)|\(high\)|closes above|up or down|home value|net worth|diesel|committed to|combined ratio)' then 'macro/markets'
  when q ~ '(election|presidential|mayor|senate|parliament|nomination|votes|trump|xi jinping|iran|saudi|yemen|houthi|hormuz|russia|ukraine|israel|military|troops|sanaa|bab el|ships|summit|white house|vatican|zelensky|khamenei|moratorium|plague|ubs|lula|bolsonaro|centcom)' then 'politics/geo'
  when q ~ '(mtv|video music|coachella|dancing with the stars|award|mlb|nba|nfl|nhl|lcs|major|grand prix|game|bruins|minecraft|messi)' then 'entertainment/sports'
  else 'other' end t from q),
f as (
  select 'RW' p, cond, minute, side, price, size from public.pm_rw_fills
  union all select 'RW-C', cond, minute, side, price, size from public.pm_rwc_fills
  union all select 'LP paper', cond, minute, side, price, size from public.pm_lpprep_fills),
mk as (
  select f.*, coalesce(ty.t, 'unknown') t,
   (select m from public.pm_rw_minutes x where f.p = 'RW' and x.cond = f.cond and x.minute between f.minute + interval '5 min' and f.minute + interval '20 min' and x.m is not null order by x.minute limit 1) rw5,
   (select m from public.pm_rw_minutes x where f.p = 'RW' and x.cond = f.cond and x.minute between f.minute + interval '30 min' and f.minute + interval '45 min' and x.m is not null order by x.minute limit 1) rw30,
   (select m from public.pm_rw_minutes x where f.p = 'RW' and x.cond = f.cond and x.minute between f.minute + interval '120 min' and f.minute + interval '135 min' and x.m is not null order by x.minute limit 1) rw120,
   (select m from public.pm_rwc_minutes x where f.p = 'RW-C' and x.cond = f.cond and x.minute between f.minute + interval '5 min' and f.minute + interval '20 min' and x.m is not null order by x.minute limit 1) c5,
   (select m from public.pm_rwc_minutes x where f.p = 'RW-C' and x.cond = f.cond and x.minute between f.minute + interval '30 min' and f.minute + interval '45 min' and x.m is not null order by x.minute limit 1) c30,
   (select m from public.pm_rwc_minutes x where f.p = 'RW-C' and x.cond = f.cond and x.minute between f.minute + interval '120 min' and f.minute + interval '135 min' and x.m is not null order by x.minute limit 1) c120,
   (select (ab + aa) / 2 from public.pm_lp_minutes x where f.p = 'LP paper' and x.mode = 'dry_run' and x.cond = f.cond and x.minute between f.minute + interval '5 min' and f.minute + interval '20 min' and x.ab is not null and x.aa is not null order by x.minute limit 1) l5,
   (select (ab + aa) / 2 from public.pm_lp_minutes x where f.p = 'LP paper' and x.mode = 'dry_run' and x.cond = f.cond and x.minute between f.minute + interval '30 min' and f.minute + interval '45 min' and x.ab is not null and x.aa is not null order by x.minute limit 1) l30,
   (select (ab + aa) / 2 from public.pm_lp_minutes x where f.p = 'LP paper' and x.mode = 'dry_run' and x.cond = f.cond and x.minute between f.minute + interval '120 min' and f.minute + interval '135 min' and x.ab is not null and x.aa is not null order by x.minute limit 1) l120
  from f left join ty on ty.cond = f.cond),
m2 as (select p, cond, t, side, price, size, coalesce(rw5, c5, l5) m5, coalesce(rw30, c30, l30) m30, coalesce(rw120, c120, l120) m120 from mk),
sg as (select *, case when side = 'bid' then 1 else -1 end s from m2),
rew as (
  select 'RW' p, cond, sum(reward) r from public.pm_rw_minutes group by cond
  union all select 'RW-C', cond, sum(reward) from public.pm_rwc_minutes group by cond
  union all select 'LP paper', cond, sum(formula_usd) from public.pm_lp_minutes where mode = 'dry_run' group by cond),
bym as (select p, cond, t, count(*) n, sum(size) sh,
   sum(case when m5 is not null then s * (m5 - price) * size end) mo5, sum(case when m5 is not null then size end) sh5,
   sum(case when m30 is not null then s * (m30 - price) * size end) mo30, sum(case when m30 is not null then size end) sh30,
   sum(case when m120 is not null then s * (m120 - price) * size end) mo120, sum(case when m120 is not null then size end) sh120
  from sg group by p, cond, t)
select jsonb_build_object('pad', repeat('x', 60000), 'rows', (select jsonb_agg(jsonb_build_object('p', b.p, 'cond', left(b.cond, 10), 't', b.t, 'n', b.n, 'sh', b.sh, 'mo5', b.mo5, 'sh5', b.sh5, 'mo30', b.mo30, 'sh30', b.sh30, 'mo120', b.mo120, 'sh120', b.sh120, 'reward', r.r)) from bym b left join rew r on r.p = b.p and r.cond = b.cond),
  'rewardByType', (select jsonb_agg(jsonb_build_object('p', r.p, 't', coalesce(ty.t, 'unknown'), 'reward', r.r, 'cond', left(r.cond, 10))) from rew r left join ty on ty.cond = r.cond where r.r > 0)) payload
