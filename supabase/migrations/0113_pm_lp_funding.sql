-- 0113: live-prep's FUNDED is the money put in, and each deposit or withdrawal is an event (the pre-registration's
-- Addendum 10, 2026-10-10).
--
-- Why. Davies, verbatim: "子页面中的FUNDED得显示我实际真实投入的钱（应该是402左右）" (the page's FUNDED must show the money he
-- actually put in, about 402). It showed the path's total cap. The path now reads, every live turn, pUSD + what its
-- CONFIRMED fills spent net − what redeemed settlements paid in − what Polymarket paid (rewards and maker rebates): the
-- money put in, to the cent ($402.028365 on 2026-10-10 at 01:17 UTC). A move of it of $1 or more, read twice alike with
-- no fill settling, after 03:10 UTC and once yesterday's payout is read, is booked as a deposit or a withdrawal
-- (`lpFunding`, agents/pm_live.ts), and each booking is a row of `pm_lp_events` of kind `funding`.
--
-- What this does, and nothing else: `pm_lp_events`' CHECK on `kind` also allows 'funding'. Until it runs, a booking's
-- event is refused, nothing is booked, and the turn says so and tries again.

alter table public.pm_lp_events drop constraint if exists pm_lp_events_kind_check;
alter table public.pm_lp_events add constraint pm_lp_events_kind_check
  check (kind in ('gates', 'selection', 'loss_stop_day', 'loss_stop_total', 'governor', 'alert', 'condition', 'readout', 'funding'));
