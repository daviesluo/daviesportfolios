# JEV-DRIFT: a standing check that Jev still answers as it was measured

Written 2026-09-28 (UTC). A monitor, not a hypothesis: it decides nothing about the strategies and changes no
decision. Frozen by the commit that adds this file; a change to it is recorded as a deviation. The code it describes is
`supabase/functions/agents/jev_bands.ts` (`jevBandCheck`, `jevDriftFlags`) and the JEV-DRIFT block of `decide` in
`agents/tick.ts`, as they stand at that commit.

Davies, 2026-09-27, choosing what the TESTING review ranked (`2026-09-27-testing-portfolio-review.md` §2.2 and §4,
appendix A §3 and §6).

## 1. Why

The live row and its control gate every entry on Jev's answer to the v2 question at 0.45 (`JEV_ENTER_MIN`, reference
§4.21). That threshold was chosen because the model's measured replies are deterministic around it: every state is
decided the same way on every call. That holds only while the replies stay where they were measured. A vendor update
that moved them by about 0.05 would flip decisions without any error. The same gate also vetoes an entry when the
caution score reaches 1.75, and it takes whichever transport answers. The paper rows' shadow cannot catch any of this
as a test: it would need 5–18 years of entries (review §2.2). A check against what was measured can.

## 2. What was measured

Five replies per entry state, measured on 2026-09-23 through the read-only `POST ?action=jev`, on one transport and
one model: **OpenRouter, `typesafe/jev-1.13-20260917`** (the files' `provenance`), the v2 question in its shared
wording (`jevQuestionsV2`):

- `docs/agents/backtests/jev_answers_v2.json`: 90 states of `trend-4h`, keyed by symbol, `trend_strength`,
  `volatility` and `momentum_30d`;
- `docs/agents/backtests/jev_answers_v2_other.json`: 54 states of `trend-1h` and 189 of `momentum-1d`, keyed by symbol,
  `trend_4h`, `trend_strength`, `breakout_4h`, `volatility` and `momentum_30d`.

A state's band is **[min − 0.02, max + 0.02]** of its five `healthy` replies, rounded to the cent
(`JEV_DRIFT_MARGIN`). `jev_bands.ts` holds a copy of the bands, because the Edge bundle cannot read `docs/`;
`jev_bands.test.ts` rebuilds them from the two files and fails on any difference. The same 1,665 replies carry a
caution score each, and the highest is **1.02**.

## 3. The check

**Which decisions.** Every decision whose rulebook said enter and that the model answered: a transport replied, so the
decision's `provider` is `openrouter` or `typesafe`. Not `rule`, for a rule that does not ask, nor `none`, when no
transport answered: on the gated rows the gate refuses that entry, and on the shadow rows it goes ahead unchecked. On
every row: those whose gate decides (`trend-4h-live`, `trend-4h`) and those in shadow (`trend-1h`, `momentum-1d`,
migration `0059`). The check runs on every entry signal the model answers, before the risk gate and its caps, so there
are more checks than entries. It reads the answers before `combineDecision` does, so an answer whose echo does not
match, which the gate then throws away, is still checked.

**Four flags** (`jevDriftFlags`), each one line:

1. **The healthy answer.** For a row of kind `trend-4h`, `trend-1h` or `momentum-1d` that was asked the v2 question in
   its shared wording, the `healthy_trend` answer is compared with its state's band. The result is recorded on every such
   decision, in band or not, as `numbers.jevBand = { key, min, max, inBand }`. Out of band is a flag, and so is a state
   with no measured replies (`min` and `max` null).
2. **The question.** The question checked is the one actually asked, as the decision records it
   (`numbers.jevQuestion`). A row of those kinds asked anything but `v2` — another `JEV_QUESTION_VERSION`, or the row's
   own wording, such as `v3-trend-1h` — has no band to be checked against, and that is itself a flag on every entry it
   answers, so the check can never go quiet without a word. A row's `params.jevQuestion` is asked only when it is a
   wording of that row's own rule (`questionsForRow`); otherwise the row is asked `v2` and checked as any other. No row
   asks its own wording today. The rules with no bands at all, rotation and dislocation, run on no row and are not
   flagged for it.
3. **Caution.** A caution score of **1.5** or more (`JEV_CAUTION_FLAG`): above every measured reply (1.02) and below
   the gate's veto (1.75), so a move toward the veto is seen before it decides.
4. **The transport and the model.** An answer from anything but `typesafe/jev-1.13-20260917` through OpenRouter: a new
   OpenRouter snapshot, or the fallback, TypeSafe direct (`jev-1.13.0`). The fallback was never measured on the v2 entry
   states (the 2026-09-20 key probe asked both transports one question on one state, and they agreed within 0.01–0.02),
   so it is flagged every time it answers an entry. The flag names both. Of the 16 entries the model answered from
   2026-09-20 to 2026-09-28, none came from the fallback.

**Where a flag goes.** Each flag carries the row, the pair and what differs; the decision itself records `provider`
and `model`. A tick's flags are reported apart from its errors, as one `ops_errors` row of kind **`agents.jev-drift`**
(not `agents.tick`), which the admin's errors pill in the site's header shows.

## 4. What a flag triggers

- **A re-measure.** After a flag on a decision of kind `trend-4h` (the rows `trend-4h-live` and `trend-4h`), or two
  flags in seven days on the same row, the next session re-measures every entry state of the flagged rows' kinds, five
  replies each, through `POST ?action=jev`, as the answer files were made. It asks on the transport that gave the
  flagged answer, and on OpenRouter too when that was another. A question flag (2) is answered by measuring that question
  on every entry state. The replies are committed beside the answer files, and Davies is told.
- **No repeat.** A flag whose cause — the transport, the model and the question — was re-measured in the seven days
  before it is logged in the ledger and not re-measured again.
- **What the re-measure concludes**, one of three:
  - **A false alarm**: the flagged states' re-measured replies all fall inside their bands. It is recorded in the
    ledger and the reference with the replies that show it.
  - **Drift, no decision changed**: some re-measured reply falls outside its band, and none of the conditions below
    holds. The bands are rebuilt from the re-measure: the new replies are committed, `jev_bands.ts` is rebuilt from them
    and its test re-pinned, and the change is recorded as a deviation of this file. Davies is told.
  - **Davies decides**, when the re-measure shows any of:
    - a `trend-4h` state whose decision at 0.45, over all five replies, differs from its decision of 2026-09-23;
    - a `trend-4h` state whose five replies do not all fall on the same side of 0.45;
    - a caution reply of 1.5 or more on any state;
    - another transport or model whose replies fall outside the bands.
    The threshold, the question and the gate are his. Nothing changes the gate on its own. The escalation always
    compares with the decisions of 2026-09-23, which are the ones the backtests priced, never with rebuilt bands.
- **One model answers every row.** Drift confirmed on any row's states also re-measures the `trend-4h` states, if they
  were not part of it.
- **A transport found faithful.** When the fallback's re-measured replies fall inside the bands, it is added to the
  measured transports in `jev_bands.ts` (a deviation, committed with the replies), and its answers stop being flagged.

## 5. It only alerts

Nothing in this monitor stops a buy. The live gate keeps running on the model as it answers, drifted or not, until a
session has re-measured and Davies has decided, and "the next session" has no deadline beyond this: from the moment a
flag is seen, the re-measure is the first item of the ledger's what-remains list.

Put to Davies in the briefing that reports this file (2026-09-28): should a flag on the live row stop its buys on its
own — clear `live_confirmed_at`, which leaves every exit armed — until the re-measure is in? Until he answers, the
monitor alerts only.

## 6. How often it is wrong, and what it cannot miss

**False alarms.** Leave one reply out and band the other four the same way: the fifth falls outside in 2 of 450
(`trend-4h`), 3 of 270 (`trend-1h`) and 0 of 945 (`momentum-1d`). That over-states the rate for a band of five. The
backtests' fill counts (reference §3.17) put the entries at roughly 30–54 a year on each `trend-4h` row and 64–114 on
`trend-1h`; the rows entered 4 times in the five days after v2 went in (2026-09-23 00:30 → 09-28). So flag 1 should give
at most one or two false flags a year across the rows, most of them on `trend-1h`; on the two `trend-4h` rows together
at most one every two to four years, and on each alone one every four to eight. Two things raise the count: the check
runs on every entry signal the model answers, and there are more of those than entries; and flag 4 fires on every
answer the fallback gives. A single flag is a reason to re-measure, not proof of drift.

**Sensitivity.** No `trend-4h` or `trend-1h` band, widened, straddles 0.45: the lowest widened lower edge above it is
exactly 0.45 and the highest widened upper edge below it is 0.43. So **every flip of an entry decision on those rows
caused by the healthy answer, on a measured state, is flagged** — pinned in `jev_bands.test.ts`. `momentum-1d`'s
bands straddle 0.45 on 18 of 189 states; its gate is in shadow, so its flips decide nothing.

## 7. What it cannot catch

- A move within the ±0.02 margin. On `trend-4h` and `trend-1h` such a move flips no decision (§6).
- A change in a state no entry has visited.
- A caution score that rises but stays below 1.5.
- An answer the model gives with the same numbers for a different reason.

Deviations are recorded in the review, the reference and the ledger.
