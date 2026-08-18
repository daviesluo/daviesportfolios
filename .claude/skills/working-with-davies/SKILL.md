---
name: working-with-davies
description: How the owner of this repo works, what he means by "done", and the specific ways past sessions have got it wrong. Load this at the start of any session on daviesportfolios — before touching chart maths, the Investment Performance / vs-S&P panels, the lot ledger, the Trading 212 sync, or anything that puts a number on screen. Also load it before pushing anything, and whenever he says a number "不对" (wrong), asks for verification, or brings back a review from another AI.
---

# Working with Davies on daviesportfolios

`CLAUDE.md` has the mechanical rules — git identity, gates, README, Edge
Function deploys. This is the part that isn't mechanical: what he
actually asks for, what he accepts as an answer, and the mistakes that
have already cost a round trip.

## Language

He writes in Chinese. Reply in Chinese. Code, comments, commit messages
and everything committed to the repo stay in English.

## What "done" means to him

**Push it.** "直接改好直接推main" — fix it and push to main, don't come
back for permission. He is not looking for a plan or a set of options; he
is looking for the thing to be fixed. Ask only when two readings of his
request lead to genuinely different work, and then ask once, with the
consequences of each spelled out.

**All gates green, every time.** `npm test`, `npm run typecheck`,
`npm run build`, plus `npm run lint`, `npx knip` and `npx size-limit`
(all three are hard CI gates), plus `npx deno test --allow-env
supabase/functions/` when an Edge Function changed. Green means green —
he will notice a red main.

**The README is part of the change**, not a follow-up.

**A pin test for every bug fixed.** He has said this repeatedly and the
repo is built around it. A fix without a test that fails on the old code
is not finished.

## What he accepts as evidence

This is the single biggest thing. **Reasoning is not evidence.** Several
rounds were lost to confident, wrong diagnoses stated before anything was
measured (a service-worker cache; network blocking; both wrong). What
works:

1. **Closed-form arithmetic.** Build a fixture whose right answer you can
   compute by hand, then compare what the app renders against the
   arithmetic — not against another part of the app.
2. **Counterfactual runs.** Revert the fix, re-run the harness, show it
   fails. A harness that passes both before and after proves nothing. He
   responded well to "the same fixture reads +247% with the carry
   removed".
3. **Browser harnesses against the production bundle.** Playwright +
   `page.route` interception, serving the built `index.html`. Read values
   back out of the DOM — including inverting the SVG y-axis from the
   printed tick labels to recover a line in dollars. Several bugs were
   only visible this way.
4. **A matrix, not one case.** Ranges × scenarios × data states. He asks
   for "大量真机测试" and "深度全面验证" and means it.

Harnesses from past sessions worth rebuilding: a flat-book test (a
portfolio that doesn't move must draw a flat line and read 0.00% on every
range), a shape comparison (two charts of the same quantity must have the
same point count and the same normalised shape), a preload test (the
panel must paint within ~120 ms of opening, never an empty state), and a
weekend/Monday fixture (the previous close is three days back).

**Watch your own fixtures.** More than once a "bug" turned out to be a
mock whose snapshot values described a different portfolio than its mock
ledger. If a result looks wild, check the fixture is internally
consistent before believing it.

## What he counts as a bug

**Two numbers for the same thing on one screen.** This is his most
consistent complaint and it is always worth treating as a defect, even
when each number is defensible on its own:

- The vs-S&P chart's PORTFOLIO must equal the scoreboard's DAY CHANGE.
- Its S&P line must equal the Market Conditions card.
- The Investment chart's Value must equal the scoreboard's PORTFOLIO.
- With deposits flat, the Investment value line and the vs-S&P portfolio
  line must have the same shape and the same reading.

The structural lesson, in his words: the Investment chart's value "就是
现成的vs 500图中portfolio的数据". Don't write a second implementation of
a quantity that already exists — call the same function on the same grid.
Two independent reconstructions drift, and did.

**A number that is not what a person would mean.** Money paid in is not a
gain. A reconstruction is not a record. A holding whose price is unknown
is not a holding worth zero.

## Domain rules already settled

Changing any of these means re-opening a decision he has already made.

**Baselines**
- Every range rebases both lines to 0% at the window's first point —
  **except 1D**, which measures from the previous close, so the chart
  agrees with the scoreboard and the MC cards. A `DAY` / `24H` button in
  the range row switches 1D to a genuine trailing day.
- `computeAt` is handed `prevCloseBasis` on 1D, so its series already IS
  the day change. Don't rebase it again.

**Pricing history**
- A missing bar carries the series' **first known close backwards**.
  Never interpolate from lot cost — that invents a move the stock never
  made.
- A holding with no price history at all counts **flat**, in both value
  and basis. Dropping it removes it from the portfolio entirely.
- A holding with no lots is "owned, date unknown", not "not owned".

**Provenance**
- Recorded 5-minute snapshots progressively replace the derived history;
  the derived stretch is drawn faded with a dotted rule at the handover
  and a `~` on the crosshair. He asked for this explicitly.
- Never record a snapshot while an FX pair is missing — `fxRateToUSD`
  falls back to 1:1 and a CNY position lands at seven times its size,
  permanently, in a table.
- Deposits are steps, not spikes. A one-sample jump that reverts is a bad
  reading.

**Trading 212**
- The positions endpoint has no dates; `/equity/history/orders` does.
  Real fills beat the synthetic lot. Never re-date a lot to today.
- The API key is scope-limited — a 403 on history means the key needs
  regenerating with the History scope, and retrying will never fix it.

## Mistakes that have already happened here

Read these as a checklist before pushing.

- **Rewiring a callback and dropping an argument.** A 5-argument call
  landed on a 4-parameter handler and `buyDate` vanished. Verify the full
  signature at every call site — `grep` for them — when you change one.
- **Not asking where the default path lands.** Cancel and Esc were mapped
  to the destructive branch of a three-way confirm.
- **Bypassing the shared helper.** A `replace` path recomputed totals
  itself instead of going through `netPosition`.
- **A CSS class collision restyling another component.** New rules for
  the Investment legend reused `perf-` names, sat later in the cascade,
  and silently changed the vs-S&P legend's dots. Prefix new component
  styles.
- **Two implementations of one number.** See above. This one cost the
  most rounds.
- **"Fixing" something he asked for.** A heatmap layout change was
  reverted wholesale because the fix addressed a different problem than
  the one he raised. Fix the thing he pointed at.
- **Hook order.** `InvestmentChart` has an early return for the
  insufficient-data state; every ref and effect must sit above it. This
  app has shipped React error #310 once already.

## Third-party reviews

He runs another AI over the diffs and brings back findings. Take them
seriously — they have caught real bugs, including two of my own fresh
regressions in one pass. Also disagree when they are wrong, with the
reason (a CORS suggestion was rejected because CORS doesn't constrain
curl). Say which findings you accepted and which you didn't, and why.

## When he says it's still wrong

He is usually right, and usually about the data rather than the code you
were looking at. Don't re-explain the previous answer. Go and measure
something new — and prefer measuring the thing he pointed at over the
thing you think is responsible.
