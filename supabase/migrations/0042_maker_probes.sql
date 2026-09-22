-- 0042: the maker probe — measuring adverse selection, which is the one
-- thing standing between this account and a 0 % fee.
--
-- Revolut X charges 0 % maker and 0.09 % taker, and the loop takes the
-- touch on every order (§4.9): 18 bps a round trip on a rule that turns
-- over ~16.5× a year is ~3 points a year, against a sleeve that earns
-- 8–20. Davies asked the obvious question — why not rest every order and
-- pay nothing. §3.13 measured it and could not answer: resting wins on
-- both windows under the loop's own fill model, but decomposed, the FEE
-- is worth only +0.9/+1.2 points and the rest was a lower entry price
-- dodging a stop that has since been removed; on the corrected stop it is
-- a one-window win, and the whole result reverses if a filled bid needs
-- 20 bps of adverse move rather than 0. Break-even sits between +10 and
-- +20 bps through the bid.
--
-- That number cannot come from a backtest. The candles are Coinbase's and
-- the bid and ask are synthetic offsets, so the model says a resting bid
-- fills with a median delay of ZERO hours on every coin in both windows —
-- which is the model's limit, not a measurement. What it cannot see is
-- the thing that decides the question: on a breakout rule a resting bid
-- fills exactly when the breakout fails, so the fills you get are the bad
-- half of the distribution and the ones you miss are the good half.
--
-- This table measures that directly, on the real UK book, at no cost and
-- without resting anything. Every time the loop takes the touch it also
-- writes down where a resting order WOULD have sat, and then watches:
-- did the market come back to that price, how long did it take, and —
-- the number that settles it — where did the price go AFTER it did. A
-- probe never becomes an order, is never filled, is never counted in any
-- position, book, exposure or P&L. It is a notebook.
--
-- Read it with: fill rate by symbol; median `minutes_to_fill`; and the
-- follow-up marks against `maker_price`, which ARE the adverse selection
-- in bps. Compare that against §3.13's 10–20 bps break-even band.

create table if not exists public.agent_maker_probes (
  id               bigserial primary key,
  ts               timestamptz not null default now(),
  strategy_id      text not null references public.agent_strategies (id),
  -- The real order this probe shadows. Kept nullable and ON DELETE SET
  -- NULL so a probe can never hold an order row hostage.
  order_id         bigint references public.agent_orders (id) on delete set null,
  venue            text not null check (venue in ('revx', 'kraken')),
  symbol           text not null,
  side             text not null check (side in ('buy', 'sell')),
  mode             text not null check (mode in ('paper', 'live')),
  -- What the loop actually paid (the touch it crossed) and where a
  -- post-only order would have rested instead (the same side's touch).
  taker_price      numeric not null check (taker_price > 0),
  maker_price      numeric not null check (maker_price > 0),
  base_size        numeric not null check (base_size > 0),
  -- `resting` until the market trades through `maker_price` or the probe
  -- expires. `filled` and `expired` are terminal for the fill question;
  -- the follow-up marks keep being filled in afterwards.
  state            text not null default 'resting'
                   check (state in ('resting', 'filled', 'expired')),
  resolved_at      timestamptz,
  minutes_to_fill  integer,
  mark_at_resolve  numeric,
  -- {"m15": <mark>, "m60": <mark>} — where the market went after the
  -- probe resolved. Against `maker_price` this is the adverse selection.
  follow_up        jsonb not null default '{}'::jsonb,
  expires_at       timestamptz not null,
  -- One flag the tick reads, instead of a compound predicate over `state`
  -- and `follow_up`: true while this probe still has something to record
  -- (a fill to wait for, or a follow-up mark to take), false once it is
  -- finished. The tick's whole read is `watching=eq.true`, which is a
  -- handful of rows and one partial index.
  watching         boolean not null default true
);

-- The tick's only read, every minute: the probes still being watched.
create index if not exists agent_maker_probes_watching
  on public.agent_maker_probes (venue, symbol)
  where watching;

create index if not exists agent_maker_probes_strategy_ts
  on public.agent_maker_probes (strategy_id, ts desc);

alter table public.agent_maker_probes enable row level security;

-- Same posture as every other agents table (0037): no anon or authenticated
-- policy, so only the service role — the Edge Function — reaches it.
