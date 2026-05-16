# Security policy

## Reporting a vulnerability

Please **don't** open a public GitHub issue for security reports.
Instead, use GitHub's private vulnerability reporting:

  https://github.com/daviesluo/daviesportfolios/security/advisories/new

…or email the repo owner directly (see the GitHub profile at
[@daviesluo](https://github.com/daviesluo)).

I'll acknowledge within a week and aim to ship a fix on `main` (which
auto-deploys to Cloudflare Pages) within two weeks for confirmed
issues. If the fix needs a coordinated disclosure window, we'll
arrange that in the advisory thread.

## Scope

The live site is one Cloudflare-Pages deployment fed by a single
Supabase project. In-scope:

  - The React client in `src/` and the static `_headers` it serves
    under.
  - The seven Supabase Edge Functions in `supabase/functions/`.
  - The Postgres migrations in `supabase/migrations/` (RLS policies,
    `security definer` RPCs, etc.).
  - The GitHub Actions workflows in `.github/workflows/` (build
    pipeline, deploy posture).

Out of scope:

  - Upstream provider issues (Yahoo Finance, Alpha Vantage, Finnhub,
    Trading 212, Eastmoney, Danjuanapp, Xueqiu) — report to those
    services directly.
  - The five public CORS proxies (`api.cors.lol`, `corsproxy.io`,
    `api.allorigins.win`, `api.codetabs.com`, `cors.eu.org`) — same.
  - Cloudflare Pages and Supabase platform issues — report to the
    platform vendors.

## What's already hardened

  - All HMAC signature compares are constant-time
    (`constantTimeEqual` helpers in `data`, `trading212`, `ops-error`).
  - `auth` uses escalating-window lockouts (24 h → 48 h → 96 h …
    capped at 30 days, migration `0011`) plus a 500 ms wrong-password
    delay; per-IP key derived from gateway-trusted headers only
    (`x-real-ip` then last entry of `x-forwarded-for`,
    NOT client-supplied `cf-connecting-ip`).
  - `trading212` requires the HMAC `x-app-token` (admin or ro) — the
    function URL alone is not a credential.
  - `prices`, `chart`, `fundamentals` require Supabase platform JWT
    verification (anon key) so the function URL alone can't be used
    as a free Yahoo / Finnhub / Alpha Vantage proxy.
  - CSP / HSTS / Permissions-Policy headers in `_headers`.
  - `security definer` RPCs (`bump_auth_attempt`,
    `try_claim_t212_refresh`) lock `search_path` to
    `public, pg_temp` so schema-shadow attacks can't redirect them.
  - Source maps are emitted as `'hidden'` and `.gitignore`d so prod
    JS doesn't ship debug references to the source.

If you find a gap in any of the above I want to know about it.
