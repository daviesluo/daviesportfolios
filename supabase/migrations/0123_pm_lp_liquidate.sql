-- 0123: "Reward quotes live-prep" sells what it still holds, at the bid, now.
--
-- Why. Davies, 2026-10-15 ~16:05 UTC, verbatim: "那目前的单都尽快卖出掉吧，还剩多少" (sell the remaining positions as fast as
-- possible; how much is left?). Live-prep has been close-only since 2026-10-15 00:08 UTC (`restarted_at` null, its total
-- stop latched, still armed so its exits work), and its exits rest at the ask, one N at a time; a separate experiment
-- needs the account clean, with live-prep's TOTAL and stop no longer moving. The rule is live-prep's pre-registration,
-- Addendum 24 (docs/agents/reviews/2026-10-04-polymarket-lp-prereg.md).
--
-- What this does, and nothing else.
--   1. `pm_lp_config.liquidate_at` (timestamptz, null): the liquidation. Set, the deployed path (`PmLpOptions.liquidate`,
--      agents/pm_live.ts `lpLiquidateOf`, `lpLiquidation`) opens nothing (gate `liquidate`) and sells each token held at
--      the venue's minimum or more whole at the best bid, a taker order, once a turn, re-priced to the bid the next; never
--      under 0.001 a share or where the worst taker fee would leave under that; a token with no such bid keeps its exit at
--      the ask. Dust under the minimum is left to settle. Null, everything is as before.
--   2. A CHECK on the config: a liquidation and a restart never both set (`liquidate_at is null or restarted_at is null`),
--      so the switch below cannot apply while Q2 is restarted, and a restart cannot be set while it liquidates.
--   3. live-prep's orders may be not post-only only as a SELL (`post_only or side = 'SELL'`, in place of 0091's
--      `check (post_only)`): no buy can ever be sent as a taker. Mini-pool's and mid-pool's orders keep 0074's and 0081's
--      `check (post_only)` untouched.
--   4. The switch, one statement: `liquidate_at = now()` on live-prep's config, only where no restart is set and no
--      liquidation is set already (applied twice it changes nothing more). A refusal leaves the column null; read back
--      with `select liquidate_at, restarted_at from public.pm_lp_config;`. To stop it: `update public.pm_lp_config set
--      liquidate_at = null where id = 1;` (the exits then rest at the ask again, close-only).
--
-- Deploy order. Applied before the function: the deployed code does not read `liquidate_at`, so nothing changes until
-- the function that does is live; it then liquidates from its first turn. The function before this: it reads the column
-- through `select=*`, finds none, and runs as before. The arming trigger (0091) is untouched; the update below does not
-- arm anything, and the trigger passes it while no other config is armed.
--
-- Safe while the path runs. One nullable column and two CHECKs: the orders' new CHECK is validated against every row
-- (all post-only today, so it holds), taking the table's lock for milliseconds; `lock_timeout` stops it waiting behind a
-- long reader.

set lock_timeout = '3s';

alter table public.pm_lp_config add column if not exists liquidate_at timestamptz;
alter table public.pm_lp_config drop constraint if exists pm_lp_config_liquidate_check;
alter table public.pm_lp_config add constraint pm_lp_config_liquidate_check check (liquidate_at is null or restarted_at is null);

alter table public.pm_lp_orders drop constraint if exists pm_lp_orders_post_only_check;
alter table public.pm_lp_orders add constraint pm_lp_orders_post_only_check check (post_only or side = 'SELL');

update public.pm_lp_config set liquidate_at = now(), updated_at = now() where id = 1 and restarted_at is null and liquidate_at is null;

reset lock_timeout;
