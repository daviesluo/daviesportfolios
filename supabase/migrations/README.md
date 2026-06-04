# Migrations — application & state notes

These `NNNN_*.sql` files are the schema history. Read this before
enabling / relying on the `migrations.yml` auto-`db push` workflow,
because the historical "paste into the Supabase SQL Editor" habit and
`supabase db push` track migration state in two different ways.

## The state-tracking gotcha (read first)

Migrations applied by **pasting into the dashboard SQL Editor** do **not**
record a row in `supabase_migrations.schema_migrations`. `supabase db
push --include-all` reads that table to decide what's already applied —
so against a DB whose migrations were all hand-applied, the first push
sees *zero* recorded migrations and tries to **replay all of them**.

Most files are `if not exists`-guarded and survive a replay. The two
that need care:

- **`0015`** creates a policy. `CREATE POLICY` has no `IF NOT EXISTS`,
  so a naive replay errors `policy ... already exists` and fails the
  whole push. `0015` is now guarded with a `drop policy if exists`
  first, so it's replay-safe.
- Ordering: README §2 historically told you to apply some files **out of
  numeric order** (e.g. `0011` before `0009`/`0010`) and to skip the
  retired `0005`/`0006`. `db push --include-all` applies in strict
  ascending order, so it does *not* reproduce that hand-ordered state.
  The files are individually idempotent / order-independent in practice,
  but don't assume "push == the prose recipe."

## One-time reconciliation (before trusting `db push` on the live DB)

Tell Supabase that the migrations **already run in prod** are "applied",
so the next push only runs genuinely-new files. Mark ONLY what actually
ran — `migration repair --status applied <v>` records a version as done
**without executing its SQL**, so marking one that never ran silently
skips it forever.

```sh
# Adjust this list to what's actually been applied in prod. Do NOT
# include a migration whose SQL hasn't run yet — see the security note
# below for 0017 / 0018.
supabase migration repair --status applied \
  0001 0002 0003 0004 0005 0006 0007 0008 0009 0010 \
  0011 0012 0013 0014 0015 0016
```

…or insert the rows directly (same caveat — list only what actually ran):

```sql
insert into supabase_migrations.schema_migrations (version) values
  ('0001'),('0002'),('0003'),('0004'),('0005'),('0006'),('0007'),
  ('0008'),('0009'),('0010'),('0011'),('0012'),('0013'),('0014'),
  ('0015'),('0016')
on conflict do nothing;
```

**Security migrations 0017 + 0018 — RUN them, don't mark them.** Both
carry `revoke … from public` hardening (0017: `bump_auth_attempt`; 0018:
the `overnight_intraday_points` anon read). If you mark them "applied"
without running them, the revoke never happens and the anonymous surface
stays open. So leave them OUT of the repair list (let `db push` run them)
or apply their SQL by hand — then verify:

```sql
-- bump_auth_attempt must NOT be PUBLIC/anon-executable:
select has_function_privilege('anon',
  'public.bump_auth_attempt(text,int,bigint)', 'execute');   -- expect: false
-- the anon overnight-read policy must be gone:
select count(*) from pg_policies
  where tablename = 'overnight_intraday_points'
    and policyname = 'anon_select_overnight_points';          -- expect: 0
```

## Going forward — pick ONE application path

To stop the two mechanisms diverging again:

- **Preferred:** let `migrations.yml` run `supabase db push` on merge to
  `main` (needs `SUPABASE_DB_PASSWORD` in the workflow's environment),
  after the one-time reconciliation above. Don't also hand-apply.
- **Fallback only:** paste into the SQL Editor when the workflow can't
  run (missing secret) — and then `migration repair --status applied
  <version>` so state stays consistent.

## Environment-specific values

`0016` hardcodes the **production** Edge Function host in its cron body
(see the warning in that file) and depends on the `app.cron_secret` DB
setting. Applying the migration set to a fork / staging / reset DB
requires editing that URL and setting `app.cron_secret` for that project
first — otherwise the clone's cron fires at production.

There is no committed `supabase/config.toml` or `schema.sql` snapshot
yet; the ordered SQL files are the only schema source of truth. A
periodic `supabase db dump --schema public > schema.sql` would give a
human-readable snapshot if you want one.
