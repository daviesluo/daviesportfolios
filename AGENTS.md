# AGENTS.md

## Cursor Cloud specific instructions

Overview: this repo is a Vite + React (JSDoc/`checkJs`, not TSX) client
bundled to static files, plus Supabase Edge Functions written in Deno
(`supabase/functions/*`). There is no local backend by default — the
client and CI both talk to the **deployed production** Supabase project
hard-coded in `src/supabase_config.js`.

Standard commands are already documented — see the `scripts` block in
`package.json`, the "Local development" section of `README.md`, and the
CI workflows (`.github/workflows/check.yml`, `edge-functions.yml`).
Client: `npm run dev` (Vite on `http://localhost:5173`), `npm test`
(vitest), `npm run typecheck`, `npm run lint`, `npm run build`. Edge
Functions: `deno check supabase/functions/` and
`deno test --allow-env --no-check supabase/functions/`.

Non-obvious caveats:

- **Deno is required for the Edge Function tests** and is preinstalled at
  `/usr/local/bin/deno` (v1.x, to match Supabase's Deno-1 Edge Runtime —
  do not run those tests on Deno 2). It is not managed by the `npm`
  update script; if it is ever missing, reinstall with
  `curl -fsSL https://deno.land/install.sh | sudo DENO_INSTALL=/usr/local sh -s v1.46.3`.
- **The app is password-gated against production.** The React shell
  renders a login form; every Edge call (`auth`, `prices`, `data`,
  `chart`, `fundamentals`, `trading212`, …) requires an app token
  derived from the password (`?pwd=<APP_ADMIN_PWD|APP_RO_PWD>` in the
  URL, e.g. `http://localhost:5173/?pwd=<value>`). Without it, `auth`
  returns `401` and the data functions return `401 {"error":"invalid
  token"}`. To exercise the board, live prices, or any data flow you
  need one of these passwords; there is no dev bypass and pointing at a
  local Supabase would require editing `src/supabase_config.js` + running
  the full local stack.
- **Do not brute-force the password.** The `auth` Edge Function has an
  IP-keyed lockout (3 wrong attempts → escalating 24 h lockout), so a
  handful of bad guesses will lock the whole VM's egress IP out of
  production auth.
- **`npm run build` writes the bundle to the repo ROOT** (`assets/`,
  `index.html`, `sw.js`), and that committed bundle is served as-is by
  Cloudflare Pages. Running a build dirties the working tree; if you did
  not intend to ship a bundle, restore with
  `git checkout -- assets index.html sw.js` and `git clean -fd`. Per the
  CI "bundle freshness" gate, any change to `src/*.{js,jsx,css}` MUST be
  committed together with a rebuilt bundle or CI goes red.

## How the owner works

Mechanical gates live in `CLAUDE.md`. The working agreement — Chinese
replies, push-when-done, what counts as evidence, two-numbers-on-one-
screen is a bug, settled chart/ledger/T212 rules, and the mistakes
already paid for — is always-on at
`.cursor/rules/working-with-davies.mdc` (same text as
`.cursor/skills/working-with-davies/SKILL.md`). The 67-turn Claude Code
session it was distilled from is `handover.md` at the repo root; that
file has live balances, so do not copy numbers out of it.
