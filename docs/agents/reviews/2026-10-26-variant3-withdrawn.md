# Variant-3 (`take50wk`) withdrawn, 2026-10-26

**Withdrawn, not read.** The frozen pre-registration (`2026-10-18-revx-weekend-prereg.md`) is not edited. This note is its
withdrawal, and `reference.md` and the ledger point here. `0141` switches the twin off (`enabled` false): its call skips it from
the next minute. Its row, tables and every record stay.

## What it was

"Stablecoin quotes variant-3" was variant-2 (TAKE's twin, £50 a rung, through-only fills) with PR5-W's weekend rule from
2026-10-23 21:00 UTC: inside an FX closure, a dark minute is decided on the book's last X. Its reading, on or after 11-25 beside
PR5-W's, was to say whether that weekend rule earns forward on Revolut X.

## Why it is withdrawn

- **The question it asked is now answered by stronger evidence.** On 2026-10-18 Davies put the same weekend rule into LIVE
  (`weekend_mode` 'live' since 21:06 that day; first live closure 10-23 21:00). LIVE's own weekends are now the record.
- **From the closure of 2026-10-30 21:00, three twins on LIVE's own rules measure weekends beside LIVE:** £120, £300 and £600,
  with LIVE's fill rule (`0141`; `2026-10-26-live-size-twins-prereg.md`, and the £120 twin's deviation 1).
- **It is not LIVE's rule.** Its fills are through-only, the rule the 10-21 audit found misses about two in three of LIVE's fills,
  and it takes at £50 a rung, which LIVE does not.
- **Nothing reads it.** LIVE's weekend replica is its own table (`agent_quote_live_wkpaper`). PR5-W is an offline replay of PR5's
  stored record. The take shadow's check reads variant-2 (`take50`), not this twin.
- **What it showed, for the record** (not blind, from the review of 2026-10-26): its first weekend made 48 trips, 53 bps of its
  capital. Over 10-19 → 10-23 21:00 it made £0.081 per £100 a day on weekdays.

## On whose word

Davies, 2026-10-26: "variant-2和variant-3周末的策略已经都实现进live的rules了吧存在还有意义吗要不删了吧" (variant-2's and variant-3's weekend
rule is in LIVE's rules now, isn't it; is there a point keeping them; delete them). The review answered that variant-2 still
decides something and variant-3 does not; this is the second half.

## What is kept

- Its spec row (with `enabled` false), its six tables and every order, event, state and replica row.
- Its reading could still be run as frozen on the record to 10-26 (fewer weekends than its window, so it would say so).
