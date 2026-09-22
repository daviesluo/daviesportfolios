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
  - The eleven Supabase Edge Functions in `supabase/functions/`.
  - The Postgres migrations in `supabase/migrations/` (RLS policies,
    `security definer` RPCs, etc.).
  - The GitHub Actions workflows in `.github/workflows/` (build
    pipeline, deploy posture).

Out of scope:

  - Upstream provider issues (Yahoo Finance, Alpha Vantage, Finnhub,
    Trading 212, Eastmoney, Danjuanapp, Xueqiu, Revolut X, Kraken,
    OpenRouter, TypeSafe) — report to those services directly.
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
  - `prices`, `chart`, `fundamentals` require the HMAC `x-app-token`
    (same check as `data` / `trading212`), verified BEFORE any upstream
    call so a rejected request costs nothing. They previously relied on
    Supabase platform JWT verification alone, but that anon key ships
    inside the public JS bundle — anyone could read it out and run these
    as a free Yahoo / Finnhub / Alpha Vantage proxy on this project's
    egress and invocation quota. CORS is deliberately NOT the control
    here: `Access-Control-Allow-Origin` only constrains browsers, so it
    does nothing against curl or a server-side scraper.
  - CSP / HSTS / Permissions-Policy headers in `_headers`.
  - Every `security definer` RPC (`bump_auth_attempt`,
    `try_claim_t212_refresh`, `try_claim_av_call`, `save_board_data`)
    locks an explicit `search_path` so schema-shadow attacks can't
    redirect them, `revoke`s execute from `public`, and grants it only
    to `service_role` (the auth-lockout RPC's `revoke` was added in
    migration `0017` — the others had it from the start).
  - Source maps are emitted as `'hidden'` and `.gitignore`d so prod
    JS doesn't ship debug references to the source.

If you find a gap in any of the above I want to know about it.
