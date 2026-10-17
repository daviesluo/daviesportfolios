-- 0128: automatic redemption of the shared Polymarket account's resolved positions (Deviation D6 of
-- docs/agents/reviews/2026-10-15-grokpm-prereg.md; `grokpm/redeem.ts`).
--
-- On whose word. Davies, 2026-10-17: "加上吧 全部都自动化掉" (add it, automate all of it), on redeeming resolved positions
-- automatically: a resolved market's winning tokens become pUSD only once redeemed on chain, and GROKPM's book already
-- counts them as cash (D4), so unredeemed wins could leave its buys short of pUSD at the venue.
--
--   grokpm_config.redeem_enabled  false: the hourly run reads what is redeemable and records what it WOULD redeem
--                                 (`grokpm_exec_state.redeem_state`), and sends nothing. true: it sends one gasless relayed
--                                 transaction a run through Polymarket's relayer, at most five markets. It also needs the
--                                 Relayer API key's two secrets; without them it sends nothing and says so.
--   grokpm_redeems                one row a market an attempt redeems: its tokens and sizes, the payout it expects, the
--                                 relayer's transaction id, the transaction hash, and its status (pending → submitted →
--                                 confirmed / failed / expired), written before the relayer is called and settled by later
--                                 runs from the relayer and the receipt.
--   grokpm_exec_state.redeem_state  the last run's plan, skips and faults (a column of its own: the minute's sync writes the
--                                 row's other columns).
--   a call                        `grokpm?action=redeem&forceFunctionRegion=eu-west-1`, hourly (minute 0). Its beat is
--                                 written first, so the watchdog's retry finds it; `retry` true: a second run in its minute
--                                 finds the first one's attempt in flight and sends nothing.
--
-- The go step (NOT run here; the main session runs it after Davies confirms, once the two relayer secrets are set and a
-- dry run's plan has been read):
--   update public.grokpm_config set redeem_enabled = true where id = 1 and redeem_enabled = false returning redeem_enabled;
-- Its undo: update public.grokpm_config set redeem_enabled = false where id = 1;
--
-- No grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` out.
-- ⚠️  As 0075: the call's URL is the PRODUCTION project's Edge host.

set lock_timeout = '3s';

alter table public.grokpm_config add column if not exists redeem_enabled boolean not null default false;
alter table public.grokpm_exec_state add column if not exists redeem_state jsonb not null default '{}'::jsonb;

create table if not exists public.grokpm_redeems (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  cond        text not null check (cond ~ '^0x[0-9a-f]{64}$'),
  neg_risk    boolean not null,
  adapter     text not null check (adapter ~ '^0x[0-9a-fA-F]{40}$'),
  tokens      jsonb not null default '[]'::jsonb,
  size        numeric not null check (size >= 0),
  payout_usd  numeric not null check (payout_usd >= 0),
  relay_id    text,
  tx_hash     text check (tx_hash is null or tx_hash ~ '^0x[0-9a-f]{64}$'),
  status      text not null check (status in ('pending', 'submitted', 'confirmed', 'failed', 'expired')),
  error       text
);
create index if not exists grokpm_redeems_open on public.grokpm_redeems (status) where status in ('pending', 'submitted');
create index if not exists grokpm_redeems_cond on public.grokpm_redeems (cond, created_at);

alter table public.grokpm_redeems enable row level security;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('grokpm?action=redeem&forceFunctionRegion=eu-west-1', 30000, 60, 23, true) on conflict (path) do nothing;

reset lock_timeout;
