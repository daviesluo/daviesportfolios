-- LP-CAPINV: what selling every carried holding at once would cost against the mid, at the books the newest live turn
-- read (pm_lp_state.state.markets: each market's best bid / ask and what it holds). A YES sell takes the YES best bid;
-- a NO sell takes the NO best bid, 1 − the YES best ask. The mid is the newest minute's adjusted mid (detail.m).
-- Top of book only: the depth behind it is not read, so this is a floor on the cost. Holdings under the market's
-- minimum size cannot be sold by an order at all (`closeOnly` drops them): shown apart. Read-only.
with s as (select jsonb_array_elements(state->'markets') x from pm_lp_state where id = 1),
h as (
  select x->>'cond' cond, (x->>'quoting')::boolean quoting, (x->'book'->>'bestBid')::numeric bb, (x->'book'->>'bestAsk')::numeric ba,
    (x->'book'->>'minSize')::numeric mins, (x->'held'->>'yes')::numeric hy, (x->'held'->>'no')::numeric hn
  from s
),
mid as (select distinct on (cond) cond, (detail->>'m')::numeric m from pm_lp_minutes where mode = 'live' and detail->>'m' is not null order by cond, minute desc),
t as (
  select h.cond, h.quoting, 'YES' tok, h.hy q, mid.m mk, h.bb bid, h.mins from h join mid using (cond) where h.hy > 0
  union all
  select h.cond, h.quoting, 'NO', h.hn, 1 - mid.m, 1 - h.ba, h.mins from h join mid using (cond) where h.hn > 0
)
select quoting, (q >= mins) sellable, count(*) tokens, round(sum(q), 1) shares, round(sum(q * mk), 2) at_mid,
  round(sum(q * greatest(mk - bid, 0)), 2) cross_cost, round(100 * sum(q * greatest(mk - bid, 0)) / nullif(sum(q * mk), 0), 1) cost_pct
from t group by rollup (quoting, (q >= mins)) order by 1, 2;
