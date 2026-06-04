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

Tell Supabase that everything already in prod is "applied", so the next
push only runs genuinely-new files:

```sh
# Mark every existing migration as already applied (no SQL is run):
supabase migration repair --status applied \
  0001 0002 0003 0004 0005 0006 0007 0008 0009 0010 \
  0011 0012 0013 0014 0015 0016 0017
# (then a normal `supabase db push` will apply only 0018+ going forward)
```

…or insert the rows directly:

```sql
insert into supabase_migrations.schema_migrations (version) values
  ('0001'),('0002'),('0003'),('0004'),('0005'),('0006'),('0007'),
  ('0008'),('0009'),('0010'),('0011'),('0012'),('0013'),('0014'),
  ('0015'),('0016'),('0017')
on conflict do nothing;
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
