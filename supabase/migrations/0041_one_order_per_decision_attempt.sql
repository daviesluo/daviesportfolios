-- 0041: one order per decision attempt.
--
-- The decision row is the tick's claim on a bar (0037): two turns cannot
-- both decide one bar. Until now a decision whose order never reached the
-- book — no pair config on the venue, a size under the venue minimum, the
-- live confirmation or the credentials missing at that moment — spent its
-- bar: the claim was taken and no order was placed, and an EXIT the rule
-- had called was lost until the next bar (four hours, or a day). The tick
-- now places such a decision on a later turn. Two turns overlapping on
-- that retry must not both place, so this index makes the order INSERT the
-- claim on the attempt, the way the decision insert is the claim on the
-- bar: the second insert fails and that turn skips. A re-quote of the same
-- decision carries its own attempt number (`requotes` 1…5), so each is
-- unique too. Checked against the live table before it was written: no
-- (decision_id, requotes) pair appeared twice.

create unique index if not exists agent_orders_one_per_decision_attempt
  on public.agent_orders (decision_id, requotes)
  where decision_id is not null;
