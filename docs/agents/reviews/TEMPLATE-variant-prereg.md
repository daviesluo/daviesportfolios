# Pre-registration template: a twin variant that is a row

For a realistic twin that differs from another only in what its spec row holds (`agent_quote_twin_specs`, 0088): its
capital (so its rung size), its start, its governed keys, a rule extension the code already has. Copy this page to
`docs/agents/reviews/YYYY-MM-DD-<slug>-prereg.md`, fill every part, and commit it with the migration that adds the row,
before the variant's first turn. Keep it to a page: what is the same as its base is the base's pre-registration and is
not repeated. A variant that needs new code (a new engine, or a rule extension the code does not have) is not this
template's: it needs a design of its own first. `2026-10-03-pr5-size-twin-prereg.md` (p50) is written from it.

## 0. On whose word

Davies' words, quoted and dated; or his standing approval of recommended variants and the study that recommends this one
(its file and figures).

## 1. What differs from its base

A table of the fields that differ, its base's beside its own (engine, capital and the rung size it gives, governed keys,
rules, start), and its page name. Then its spec row exactly as the migration inserts it. Its id names no variant number
(a page name can change, its tables cannot); its `display_order` places it among the twins on the page.

## 2. Why

What it measures that its base does not, in a sentence or two, and the numbers that suggested it.

## 3. Window, reading and bar

- **Window**: from a stated UTC instant after this freeze; what closes before it is reported apart.
- **Reading**: its date, and which other reading it is read beside (a variant of a rule under its own verdict is never
  read before that verdict).
- **Bar**: one rule fixed now, with the figures it is computed from and what passing means; or **descriptive**: no bar,
  it measures, and a bar set later is a new pre-registration.
- **Until the reading, health only**, daily: its `_sim` row's `last_error`, its `paperCheck` mismatches, its mode, its
  state's `updated_at` against PR5's call, the call's beats, no `ops_errors` `agents.quotes_twins`. Its trips and P&L are
  not read before the reading.

## 4. Its record before now

None (it starts at the migration's minute), or a backfill: `docs/agents/backtests/twins/scripts/backfill.ts <id>` on the
named inputs, to a named minute, built twice to the same bytes; its sha256 is in its row. What that record shows is in
sample: it is the expectation, not evidence.

## 5. Frozen files

| file | sha256 |
|---|---|
| the migration that adds its row and its tables | … |
| its backfill, the builder and its inputs, when it has one | … |
| `supabase/functions/agents/quotes_twin.ts` and `revx_sim.ts` as they stand | … |

A change to a frozen file after the freeze is a deviation: reported here, in an addendum, and in the ledger.

## 6. Disclosures before the freeze

Any figure of a twin, a paper test or a readout seen before the freeze that the reading will use, or "none".

## The migration: two statements

Its row first (the function reads it, so the config's capital and start cannot disagree with it), then its tables:

```sql
insert into public.agent_quote_twin_specs
select * from jsonb_populate_recordset(null::public.agent_quote_twin_specs, $json$[
  { "id": "<id>", "display_name": "Stablecoin quotes variant-N", "display_order": <n>, "engine": "pr5", "capital_gbp": <£>, "gov": "account", "start": "<UTC>", "table_prefix": "agent_quote_twin_<id>", "lease": "quotes-twin-<id>", "rules": null, "backfill": null, "prereg": "docs/agents/reviews/<this file>", "migration": "<NNNN>", "enabled": true }
]$json$::jsonb)
on conflict (id) do nothing;
select public.create_quote_twin_tables('<id>');
```

No code changes. With it: `backfill.ts <id>` when it starts in the past (and its `backfill` field filled), the browser
test's fixture made again (`scripts/fixture.ts`), a row of the "Twin variants" table in docs/agents/reference.md, and a
ledger line. `src/twin_specs.test.js` holds the row to the conventions and the fixture to the rows.
