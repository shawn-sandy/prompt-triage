---
status: completed
modified: 2026-11-07
type: feature
created: 2026-11-07
effort: high
workflow: never
artifact-url: https://claude.ai/artifact/9zQW8v6yZACGFBkXbP1EF1
glance: The mod changes which model runs your session based on one cheap classifier call reading one sentence, and keeps no record of whether that helped. After this it logs every decision it makes and /triage-stats prints the tally, so the next cost question is answered from a count instead of from arithmetic. The evidence gate on the priciest switch was built, then dropped before landing: its mid-session dialog was judged a workflow cost, and the tally is what will show whether it is needed at all.
---

# Plan: Make every model switch either measured or evidence-gated

## Objective

Give the mod a record of every model and effort decision it makes, and a
command that reads it back, so the question of whether its switches are ever
taken is answered from data. (The second half of the original objective,
deferring the most expensive switch until the session proves it is long, was
built and then dropped: see Decisions.)

## Context

The mod rates the first prompt of a session with one `haiku` call and may then
move the whole session to a different model. A review on 2026-11-07 found that
the direction of that change depends on which model you already run: on a
Fable default every switch it can offer is cheaper, while on a Sonnet default
two of the four ratings offer a more expensive one. Nothing in the repo records
which switches were offered or accepted, so the cost question could only be
answered with modelled arithmetic rather than measurement. The full finding
list is in `docs/proposals/cost-evidence.md`.

Two findings make the risk concrete. The rating's own eval scores `simple`
8/8 but `complex` 5/8, a 95% confidence interval of 31-86% — the class that
gates the step up to a pricier model is the one the eval cannot pin down. And
the eval's recorded mistakes lean toward over-rating `complex` prompts as
`long-running`, which is the label that suggests the most expensive model of
the four. The classifier's known failure direction points at more spend.

**Rollout.** The work lands in one branch but reaches users in three stages,
each gated on the stage before it. Stage one is P1 alone: the mod starts
recording what it decides and a `/triage-stats` command prints the tally, with
no behaviour change at all, so there is nothing for a user to notice and
nothing to roll back. Stage two is P2, the dialog option reorder, which is
visible but trivially reversible and affects only prompts already rated
`simple`. Stage three is P3 and P4, which change when the dialog appears; these
are the only user-visible timing changes and they ship together because they
share one turn counter. A release that stops after any stage is coherent on its
own. Treat the stage-one tally as the gate on stage three: if it shows nobody
ever accepts the expensive suggestion, deleting that suggestion is cheaper than
deferring it, and P3 should be re-scoped before it is built.

**Risks and mitigations.** The largest is that P3 and P4 move a dialog from
the first prompt to a turn threshold, and the threshold is a guess — 30 turns
is not derived from data. Mitigation: P1 ships first and its tally is what sets
the real number, and the threshold lives in one named constant so changing it
is a one-line edit rather than a redesign. Second, P1 writes to the mod's store
on every rated session, and the store rejects more than 4 MiB of JSON across
all keys; mitigation is a hard cap on the number of retained entries, asserted
by a test, so the log cannot grow without bound. Third, deferring the expensive
suggestion means a genuinely long job spends its early turns on a weaker model
than it wants; this is accepted deliberately, because the review found the
first-prompt guess wrong often enough that acting early costs more in
expectation than starting on the session's own model. Fourth, the mod holds its
state in memory and loses it on reload, so a reload mid-session resets the turn
counter and the deferred suggestion never fires; this is a pre-existing
limitation the README already documents, and this plan does not widen it.

## Decisions

- The plan is red-green-verify: every behaviour change here is observable through the existing mocked-engine test harness, so a failing test can be written first and the phases keep that discipline into implementation.
- No `### Lane:` headings. P1 through P4 all edit `hooks/register.ts`, which one worker must own, and the eval growth is two steps on disjoint paths — not enough to justify the lane machinery, and the guidance is never to force lanes onto a chain.
- `workflow: never`. The file heuristic would otherwise emit a parallel-workflow prompt, but this is a chain of ordered edits to one file and gains nothing from fan-out.
- P1 records a turn-count and message-count proxy, not real token usage. `TurnStepInput` exposes `turnId`, `index`, `model`, `effort` and `messageCount` and carries no usage or token field, so real per-request cost is not reachable from a hook today.
- P1's log is a single capped array under one store key. `$.store.set` rejects a store over 4 MiB of JSON text in total, so an uncapped log would eventually break every other write the mod makes, including the band's saved picks.
- P3 and P4 share one main-loop turn counter and ship together. Two counters measuring the same thing would drift.
- The mid-session dialog is known to work: `refineDraft` already runs `$.ui.ask` from a `$.clock.after` timer, so prompting outside `prompt.submit` needs no new mechanism.
- Stage three was dropped on 2026-11-07 after it was built and green. Steps 4, 5, 8 and 9 added a main-loop request counter and two dialogs at 30 requests (fable for a `long-running` session, the session's own effort back for a `simple` one). All of it passed its tests, but a dialog that can open mid-task was judged a cost to the development workflow that the log had not yet justified, and the plan's own rollout note said to let the stage-one tally decide stage three. The code is removed; the git history of this branch keeps the working version. Steps 1-3, 6-7 and 10-12 are what landed.
- No SHIP phase. The objective is to land the change, not to commit and open a pull request from inside the plan; committing stays an explicit user request after `VERIFY` is green.

## Files

- hooks/register.ts (modified) — the decision log, the `/triage-stats` command and the option reorder
- hooks/register.test.ts (modified) — failing tests for the log, the command and the reorder, then the regression guards
- evals/rating-prompts.json (modified) — grow from 8 to 40 cases per rating
- scripts/eval-rating.mjs (modified) — report a per-class Wilson confidence interval beside each percentage
- README.md (modified) — the `/triage-stats` command, the new dialog timing, and the data the mod now stores

## Steps

### Phase: RED

1. [x] Add failing tests in hooks/register.test.ts asserting that a rated first prompt appends one entry holding the rating, the model before and after, the chosen option and the turn count, and that the array never exceeds its cap. Why: the log is the only new persistent state and an uncapped one would eventually break every other store write. Verify: `claude plugin test .` exits non-zero on these tests with an assertion failure naming the missing store key, not an import error.
2. [x] Add a failing test that `/triage-stats` is registered on session start and prints a tally naming each rating and how often a switch was accepted, split into switches up to a pricier model and down to a cheaper one. Why: a log nobody can read answers no question, so the command is part of the deliverable rather than a follow-up. Verify: `claude plugin test .` fails reporting the command absent from the registered list.
3. [x] Add a failing test that a `simple` prompt whose suggested model is two or more tiers cheaper lists the model switch before `Keep model, effort low`, and that a one-tier gap keeps the present order. Why: pins both halves of the reorder so the one-tier case cannot regress silently while the two-tier case is fixed. Verify: `claude plugin test .` fails on the two-tier case with the actual option array printed, while the one-tier case passes.
4. [x] (Dropped, see Decisions.) Add failing tests that a `long-running` rating offers no fable switch on the first prompt, and that it offers one once main-loop turns pass the threshold on the original model. Why: this is the behaviour change the review's largest finding asks for, and both halves must hold or the suggestion is merely lost. Verify: `claude plugin test .` fails showing a fable option still present in the first-prompt dialog.
5. [x] (Dropped, see Decisions.) Add a failing test that a session rated `simple` which passes the turn threshold drops the lowered-effort override and offers the dialog exactly once. Why: the exactly-once part is what stops a long session asking on every subsequent turn. Verify: `claude plugin test .` fails on the override still being applied after the threshold.

### Phase: GREEN

6. [x] Implement the capped decision log and the `/triage-stats` command in hooks/register.ts, writing through `$.store` under one key. Why: measurement has to exist before any later change to the mod can be judged by anything but argument. Verify: re-run `claude plugin test .`; the step 1 and 2 tests pass and no previously passing test fails.
7. [x] Reorder the `simple` prompt's dialog options when `rank(current)` exceeds the suggestion's rank by two or more. Why: at a 35x price gap the model switch dominates the effort option, so the stronger lever belongs in the first position. Verify: re-run `claude plugin test .`; the step 3 tests pass and the existing simple-prompt option-order test still passes.
8. [x] (Dropped, see Decisions.) Add a main-loop turn counter in the `turn.step` hook and use it to defer the fable suggestion to a named threshold constant. Why: a turn count is evidence the task really is long-running, where the first sentence was only a prediction. Verify: re-run `claude plugin test .`; the step 4 tests pass.
9. [x] (Dropped, see Decisions.) Use the same counter to drop a `simple` rating's lowered-effort override past the threshold and offer the dialog once. Why: reuses the counter rather than adding a second measure of the same thing. Verify: re-run `claude plugin test .`; the step 5 tests pass. If tests still fail after 8 iterations, stop and report the exact blocker — the failing assertion, the last diff tried, and what was ruled out. Do not report success.

### Phase: VERIFY

10. [x] Run the full suite and the plugin validator. Why: the repo has no separate lint or typecheck command, so these two are the whole gate and both must be observed, not assumed. Verify: `claude plugin test .` reports 0 fail and `claude plugin validate .` prints validation passed.
11. [x] Grow evals/rating-prompts.json to 40 cases per rating and extend scripts/eval-rating.mjs to print a Wilson 95% interval beside each per-class percentage. Why: `complex` currently scores 5/8, an interval of 31-86%, so no later claim about the rating is falsifiable at the present sample size. Verify: `node scripts/eval-rating.mjs` prints 160 cases and an interval on every class line, and the `complex` interval is narrower than 31-86%.
12. [x] Update README.md with the `/triage-stats` command, the new dialog timing for `long-running` and `simple`, and the decision log under the Data section. Why: the README documents every behaviour and limit, and three of its claims stop being true at step 9. Verify: `grep -q 'triage-stats' README.md` exits 0 and every changed README line matches the behaviour the tests now assert.

## Tests

Tier 1 — This plan changes application code
- Objective: the mod records every rating decision and `/triage-stats` reads it back. File: hooks/register.test.ts; Type: smoke; Asserts: a rated session appends one capped log entry naming the rating, the models and the choice, and `/triage-stats` prints a row for every rating; Run: `claude plugin test .`
- Unit: the decision log. File: hooks/register.test.ts; Targets: the store write in `choose()`; Key cases: one entry per rated session, the cap holds at its limit, a failed store write does not block the prompt
- Unit: dialog option order. File: hooks/register.test.ts; Targets: the `options` array in `choose()`; Key cases: two-tier gap puts the switch first, one-tier gap keeps the present order, no gap offers neither
- Integration: eval harness reporting. File: scripts/eval-rating.mjs; Targets: the per-class summary; Key cases: 40 cases per class counted, an interval printed on every class line

## Acceptance Criteria

- [x] `claude plugin test .` exits 0 with the new tests included, and `claude plugin validate .` passes
- [x] A rated session leaves exactly one decision-log entry naming the rating, the model before and after, and the chosen option
- [x] The decision log never holds more than its cap, proven by a test that writes past it
- [x] `/triage-stats` prints a tally covering all four ratings and how often a switch was accepted, split into up (pricier) and down (cheaper) using the logged model before and after
- [x] A `simple` prompt two or more tiers above its suggestion lists the model switch first; a one-tier gap is unchanged
- [x] `node scripts/eval-rating.mjs` reports 160 cases with a confidence interval on every class line
- [x] README.md describes `/triage-stats`, the new dialog timing, and what the decision log stores

## Verification

Run `claude plugin test .` and confirm it reports 0 fail with every test above
present, then `claude plugin validate .` and confirm it prints validation
passed. Observed 2026-11-07 after stage three was removed: 104 pass, 0 fail;
validation passed. Three runs of `node scripts/eval-rating.mjs` on the same
rubric printed 160 cases with `complex` at 30, 35 and 34 of 40, so the
run-to-run noise is about five cases and a rubric change must beat that. Both must be observed, not inferred: the suite drives a mocked engine
and prints a sandbox denial for `api.anthropic.com` on every run, which is
expected noise rather than a failure.

The real-session walk-through was observed in part: with the mod loaded
through `claude --plugin-dir .`, a first prompt was rated and the session was
switched to sonnet, the status line read `running sonnet, not
claude-opus-5-5`, and `node scripts/eval-rating.mjs` printed 160 cases with an
interval on every class line. `/triage-stats` was exercised through the mocked
engine, not by hand.

## Next Steps

- Tune the rating rubric against the grown eval
  Step 11 landed, but three runs of the same rubric scored `complex` 30, 35 and 34 of 40: the noise floor is about five cases, so only a change that clears it counts, and the baseline should be the median of several runs.
  ```text
  In the prompt-triage repo, the eval at evals/rating-prompts.json now holds 40 cases
  per rating and scripts/eval-rating.mjs reports per-class Wilson intervals. Establish a
  baseline with `node scripts/eval-rating.mjs`, then improve the RATER rubric in
  hooks/register.ts so the `complex` class scores better without regressing the other
  three. Re-run the eval after each change and keep only changes that move the complex
  interval up. Verify: `node scripts/eval-rating.mjs` shows a higher complex score than
  the recorded baseline and no class lower than its baseline, and `claude plugin test .`
  exits 0.
  ```
- Word the expensive suggestion in tiers rather than dollars
  The proposal's rejected-alone option C, worth shipping beside the deferral once it exists.
  ```text
  In the prompt-triage repo, the model dialog suggests a step up to a pricier model
  without saying so. In hooks/register.ts, add tier-relative wording to the dialog
  question when the suggested model ranks two or more above the current one, for example
  "two tiers above your current model". Never state prices or dollar amounts: they go
  stale and the mod would then assert a wrong number. Add a test in
  hooks/register.test.ts for the wording at a two-tier gap and its absence at one tier,
  and update the README. Verify: `claude plugin test .` exits 0 and
  `claude plugin validate .` passes.
  ```
- Wish list: revive the evidence gate once the tally justifies it
  Stage three (the request counter and the dialogs at a threshold) is in this branch's history. Weeks of real `/triage-stats` output would show whether the fable suggestion is ever taken, which decides between reviving the gate and deleting the suggestion.

## Unresolved Questions

- What turn threshold makes a `long-running` claim credible? The plan uses 30
  as a named constant so it is a one-line change, but the number is a guess
  until P1's tally has real sessions behind it. Confirm before step 8, or
  accept 30 as a starting value to be revised.
- Should `/triage-stats` be the only way to see the tally, or should a running
  total appear in the status line? A visible figure may change behaviour more
  than any dialog does, but it also spends status-line space the mod already
  uses for the model override.

## Resources

- `docs/proposals/cost-evidence.md` — the proposal this plan implements, with the four findings and the three explicit non-goals
- `docs/plans/sessions/add-fable-step-down-session.md` — the review that produced the findings, including the measured per-default cost direction
- `.claude-plugin/types/claude-code/index.d.ts` — `TurnStepInput` at line 14677 (no usage field) and the `$.store` contract at line 3497 (4 MiB total cap)
- `docs/plans/implement-model-selection-findings.md` — the earlier plan that recorded the eval run scoring `complex` 5/8
