-- LP-OBS-DEEP, item 3: what an exit SELL would have done in live-prep's paused minutes that held stock. Every live
-- minute the path recorded as 'paused' (detail.lp.state) while its market held tokens (detail.lp.held). For each:
--   class    carried (not one of the UTC day's markets), out (one of them, taken out: detail.lp.out), or selected;
--   exit     the sell the rule would have rested had the pause not emptied it:
--              carried / out: Addendum 16's exit (`lpExitQuotes` through `closeOnly`): min(N, held), if >= the minimum;
--              selected: `lpQuotes`' sell of what is held, only while held >= N (else that side is a BUY), and nothing
--              in a one-tick book (TB1's skip);
--            its price RW's `quote` on the minute's row: a YES sell at ceil(max(ba - tick, m + tick/2)), at least
--            bb + tick; a NO sell at 1 - floor(min(bb + tick, m - tick/2)), at most ba - tick (m = (ab + aa)/2);
--   through  the next live minute's book at or through that price (YES: bb >= ask; NO: ba <= bid). In the live record
--            (sql/fill_calibration.sql) 57 % of such minutes filled a resting quote, and they carry 17 % of the fills'
--            shares: the adverse part of what fills, which the counterfactual takes whole;
--   marks    the YES mid ((bb + ba)/2) at the first recorded minute at or after the pause's end, 60 minutes and
--            360 minutes on, and the latest (a settled market's payout).
-- Episode: a market's run of consecutive paused minutes. Through-fills are summed per episode and capped at what the
-- episode's first minute held. Read-only.
with mk as (select day, cond from pm_lp_markets),
p as (
  select l.cond, l.minute, l.tick, l.bb, l.ba, l.ab, l.aa, coalesce(l.min_size, 5) min_size,
    (l.detail->'lp'->>'n')::numeric n, coalesce((l.detail->'lp'->'held'->>'yes')::numeric, 0) hy,
    coalesce((l.detail->'lp'->'held'->>'no')::numeric, 0) hn, (l.detail->'lp'->>'pausedUntil')::timestamptz pu,
    case when not exists (select 1 from mk where mk.cond = l.cond and mk.day = (l.minute at time zone 'utc')::date) then 'carried'
         when l.detail->'lp' ? 'out' then 'out' else 'selected' end cls
  from pm_lp_minutes l
  where l.mode = 'live' and l.detail->'lp'->>'state' = 'paused'
    and (coalesce((l.detail->'lp'->'held'->>'yes')::numeric, 0) > 0 or coalesce((l.detail->'lp'->'held'->>'no')::numeric, 0) > 0)),
g as (select p.*, p.minute - (row_number() over (partition by cond order by minute)) * interval '1 minute' grp from p),
q as (
  select g.*, (ab + aa) / 2 mm, (ba - bb) <= tick + 1e-9 tight,
    case when hy >= hn then 'yes' else 'no' end tok, greatest(hy, hn) held
  from g),
x as (
  select q.*,
    case when ab is null or aa is null then null
         when tok = 'yes' then greatest(ceil(greatest(ba - tick, mm + tick / 2) / tick - 1e-9) * tick, bb + tick)
         else 1 - least(floor(least(bb + tick, mm - tick / 2) / tick + 1e-9) * tick, ba - tick) end px,
    case when cls = 'selected' then case when held >= n and not tight then n else 0 end
         else case when least(n, held) >= min_size then least(n, held) else 0 end end sz,
    (select row(n1.bb, n1.ba)::text from pm_lp_minutes n1 where n1.mode = 'live' and n1.cond = q.cond and n1.minute = q.minute + interval '1 min') nxt,
    (select (e.bb + e.ba) / 2 from pm_lp_minutes e where e.mode = 'live' and e.cond = q.cond and e.minute >= q.pu and e.bb is not null and e.ba is not null order by e.minute limit 1) v_end,
    (select (e.bb + e.ba) / 2 from pm_lp_minutes e where e.mode = 'live' and e.cond = q.cond and e.minute >= q.minute + interval '60 min' and e.bb is not null and e.ba is not null order by e.minute limit 1) v60,
    (select (e.bb + e.ba) / 2 from pm_lp_minutes e where e.mode = 'live' and e.cond = q.cond and e.minute >= q.minute + interval '360 min' and e.bb is not null and e.ba is not null order by e.minute limit 1) v360,
    coalesce((select s.payout from pm_lp_settlements s where s.cond = q.cond),
             (select (e.bb + e.ba) / 2 from pm_lp_minutes e where e.mode = 'live' and e.cond = q.cond and e.bb is not null and e.ba is not null order by e.minute desc limit 1)) v_last
  from q),
y as (
  select x.*, split_part(trim(both '()' from nxt), ',', 1)::numeric nbb, split_part(trim(both '()' from nxt), ',', 2)::numeric nba
  from x),
z as (
  select y.*,
    case when sz > 0 and px is not null and nxt is not null and
              ((tok = 'yes' and nbb >= px - 1e-9) or (tok = 'no' and nba <= 1 - px + 1e-9)) then sz else 0 end thru_sz,
    -- YES value of a share of the token held, at each mark
    case when tok = 'yes' then 1 else -1 end sgn
  from y),
e as (
  select z.*, sum(thru_sz) over (partition by cond, grp order by minute) cum,
    first_value(held) over (partition by cond, grp order by minute) held0
  from z),
f as (
  select e.*, greatest(0, least(thru_sz, held0 - (cum - thru_sz))) fill_sz,
    -- the token's own value at a mark: YES at the mid, NO at 1 - mid
    case when tok = 'yes' then 0 else 1 end base
  from e)
select cls, count(*) minutes, count(distinct cond || grp::text) episodes,
  round(avg(held), 1) avg_held_sh,
  count(*) filter (where sz > 0 and px is not null) exit_minutes,
  round(sum(fill_sz), 2) thru_fill_sh,
  round(sum(fill_sz * (px - (base + sgn * v_end))), 2) gain_vs_end_usd,
  round(sum(fill_sz * (px - (base + sgn * v60))), 2) gain_vs_60_usd,
  round(sum(fill_sz * (px - (base + sgn * v360))), 2) gain_vs_360_usd,
  round(sum(fill_sz * (px - (base + sgn * v_last))), 2) gain_vs_last_usd,
  round(avg(px - (base + sgn * v_end)) filter (where sz > 0 and px is not null), 4) edge_any_vs_end,
  round(avg(px - (base + sgn * v360)) filter (where sz > 0 and px is not null), 4) edge_any_vs_360,
  round(avg(px - (base + sgn * v_last)) filter (where sz > 0 and px is not null), 4) edge_any_vs_last
from f group by rollup (cls) order by cls nulls last;
