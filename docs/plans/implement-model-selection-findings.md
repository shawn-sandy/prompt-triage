---
status: completed
type: feature
created: 2026-11-05
workflow: never
artifact-url: https://claude.ai/artifact/YHCLETXQ1sQCKmRuNf7Zwm
issue: https://github.com/shawn-sandy/prompt-triage/issues/15
glance: The mod picks a model from one blind guess at the first prompt, so it can lock a session on the wrong model, offer a downgrade to people already on the strongest one, and silently fail long prompt reviews. When this lands, ratings follow a written rubric that is checked against a labeled prompt set, Fable and Mythos are handled correctly, and a simple prompt is offered lower effort before a cheaper model.
---

# Plan: Make prompt-triage pick models the way Anthropic's guide says to

## Objective

Implement the model-selection review's findings in prompt-triage: rate prompts against a written rubric in one fast, low-effort call, add a Fable tier, fix the Mythos and unknown-model ranking, offer lower effort before Haiku for simple prompts, stop long prompt reviews from being cut off, and add a labeled eval set that scores the rating.

## Context

A findings-only review on 2026-11-05 compared `hooks/register.ts` with Anthropic's "Choosing the right model" guide. The recap is at `docs/plans/sessions/optimize-model-selection-session.md` and https://claude.ai/artifact/V44hgnbSkbxLUbubVgWEFR. The guide says effort is often a better lever than switching models, that Haiku 5.5 suits classification and subagent work rather than a main coding loop, and that a use-case eval set is the most important step in choosing a model.

What the review found, and what this plan does about each:

1. The classifier gets three bare labels with no definitions. This plan gives it a rubric.
2. A "simple" rating offers a Haiku switch that lasts the whole session. This plan offers "keep the model, effort low" first.
3. `rank()` returns -1 for `claude-mythos-5-1` and for any name it does not know, so a complex prompt on Mythos is offered a downgrade to opus. "use fable" typed under "Other" switches nothing. This plan fixes both.
4. The refine review uses the default `maxTokens` of 1024, so a long prompt's rewrite loses its closing `</prompt>` tag and the review reports failure. This plan sizes the cap to the prompt.
5. The `medium` effort minimum never changes anything on current models at their default effort. This plan documents that the minimums guard against a hand-lowered effort and leaves them as they are.
6. `$.model.classify` takes no effort or token cap, and it blocks the first prompt. This plan rates with `$.model.complete` at effort `low` with a small cap.
7. Nothing measures rating quality. This plan adds a labeled prompt set and a script that scores the rubric against the old bare-label prompt.
8. Fable is never suggested. This plan adds a fourth rating, `long-running`, that suggests it. The review had held this back until evals existed; the user chose to include it, and the eval set added here is what checks it.

Risks and mitigations:

- Open PR #14 ("Add one-line restatement of complex prompts before dialog") rewrites the dialog text in `choose()` and adds a second `haiku` call, `restate()`. This plan waits for that PR to merge and builds on its version, so step 1 is a sync gate.
- The rating call's `maxTokens` of 256 could still cut off the label if thinking tokens count against it. Step 6 treats a reply with no label as no rating, so the prompt still goes through unchanged, and the eval run in step 14 would show a high no-label count.
- `claude -p` in the eval script may load the installed prompt-triage mod and rate its own prompts. Step 10 checks for that before trusting the numbers.

## Decisions

- The plan waits for PR #14 to merge and builds on its `choose()` — the user's choice, so two branches never rewrite the same dialog line.
- The plan is red-green-verify: `claude plugin test .` runs `hooks/register.test.ts`, so every behavior change gets a failing test first.
- No lanes: every code change is in `hooks/register.ts` and its one test file, and the eval script imports from that file, so the work is one chain.
- Rating moves from `$.model.classify` to `$.model.complete` with `model: 'haiku'`, `effort: 'low'`, `maxTokens: 256` and `timeoutMs: 10_000`, because `classify` takes none of these and blocks the first prompt. The cap is 256, not smaller, because only tokens actually produced are billed and a tight cap could cut off the label if thinking counts against it. The timeout matches PR #14's restate call; a slow rating sends the prompt unrated.
- The rubric (`RATER`) and the reply parser (`parseRating`) are exported from `hooks/register.ts` so the eval script scores the exact prompt the mod sends, not a copy that can drift.
- The fourth rating is named `long-running` and maps to `fable`, matching the guide's "agent sessions that run for hours" row. Its effort minimum is `high`, Fable's own default.
- `rank()` becomes a lookup in which `mythos` ranks with `fable`. A model name the mod does not recognize counts as already strong enough for `complex` and `long-running`, so an unknown name never produces a downgrade offer.
- The low-effort option for simple prompts is shown only when the dialog shows anyway (the current model is not Haiku), so it adds no new dialog. Choosing it sets main-loop effort to exactly `low`, which is the first time the mod lowers effort rather than raising it.
- The effort minimums stay as they are and the README says what they do — the user's choice; per-model minimums were declined.
- The eval runs through `claude -p` so it needs no API key; its scores are close to the mod's call but not identical, since the CLI adds its own context. The rubric passes when its overall accuracy is at least the bare-label baseline's on the same set, with no unlabeled replies.
- Fast mode is out of scope.
- Eval result (step 14, run 2026-11-05 through `claude -p` at `haiku`, effort `low`): the rubric scored 27/32 (84%) overall (simple 8/8, moderate 6/8, complex 5/8, long-running 8/8); the bare-label baseline scored 21/32 (66%) (simple 8/8, moderate 5/8, complex 8/8, long-running 0/8). Both runs had 0 replies with no label, which also answers the first unresolved question for this set: a 256-token cap left room for the label. The rubric's misses lean toward over-rating two cross-service `complex` prompts as `long-running`; the eval set was not tuned to hide this.
- The eval script runs the CLI with `--setting-sources project,local --strict-mcp-config --disable-slash-commands --tools ""`. Without them the installed prompt-triage 0.3.4 loaded (its debug log read "Read hooks.json for plugin prompt-triage (enabled=true)") and each call carried about 590k tokens of user context; with them the mod did not load and a call used about 1k tokens.
- Step 13: `.claude-plugin/types` is not laid out by `claude -p --plugin-dir .`, so `npx tsc --noEmit -p .` could not run as written. The same check ran instead with the plugin-authoring skill's documented tsconfig, kept in the scratchpad, against this Claude Code build's bundled `claude-code.d.ts` (2.1.317): `tsc` 5.9.3 exited 0 over `hooks/register.ts` and `hooks/register.test.ts`, and the same setup reported a planted type error.
- Step 15 ran three interactive sessions with `claude --plugin-dir .`, driven by `expect`: a one-line question on sonnet showed `Keep model, effort low` first and, once chosen, the status line read `effort lowered to low`; a cross-service refactor on sonnet read `This prompt looks complex` with `Switch to opus`; a multi-hour JavaScript-to-TypeScript migration on opus read `This prompt looks long-running` with `Switch to fable`.

## Files

- hooks/register.ts (modified) — rubric rating call, ranking lookup, Fable tier, low-effort option, review token cap
- hooks/register.test.ts (modified) — tests for each behavior change, and the rating mock moved to `model.complete`
- evals/rating-prompts.json (new) — about 30 prompts, each labeled with its expected rating
- scripts/eval-rating.mjs (new) — scores the rubric and the bare-label baseline against the labeled set
- README.md (modified) — four ratings, the low-effort option, Fable, what the effort minimums do, how to run the eval

## Steps

### Phase: RED

1. [x] Sync this branch with `main` once PR #14 has merged, by calling the app's sync-with-base-branch tool, and stop if PR #14 is still open. Why: the user chose to build on PR #14's version of `choose()`, and starting earlier means a conflicting rewrite of the same dialog line. Verify: `gh pr view 14 --json state --jq .state` prints `MERGED`, and `grep -c RESTATER hooks/register.ts` prints a number above 0.
2. [x] In `hooks/register.test.ts`, move the rating mock from `on('model.classify')` to the `on('model.complete')` handler, telling the rating call apart by its `system` text, and add failing tests that the rating request uses `model: 'haiku'`, `effort: 'low'`, a `maxTokens` of 256 and a `timeoutMs` of 10,000, that its system prompt defines all four labels, that a reply naming no label or a timed-out call sends the prompt with no dialog, and that `classify` is never called. Why: these pin the faster, rubric-based rating call before it exists. Verify: `claude plugin test .` fails on these new tests with assertion failures (for example, an expected `effort` of `low` against an actual of `undefined`), not import or syntax errors.
3. [x] Add failing tests for the ranking and the Fable tier: a `complex` prompt on `claude-mythos-5-1` or on an unrecognized name such as `Default (recommended)` gets no "Switch to opus", "use fable" under "Other" routes main-loop requests to `fable`, and a `long-running` prompt on opus offers "Switch to fable" (plus "Open in a new session" in the desktop app), offers no switch on Fable or Mythos, and raises effort to `high`. Why: these cover the -1 rank bug, the missing alias, and the new tier. Verify: `claude plugin test .` fails on each of these by name.
4. [x] Add failing tests for simple prompts: when the dialog shows, its first option is `Keep model, effort low`; choosing it sends main-loop requests at effort `low` even when the session's effort is `high`; subagent requests keep their own effort; running `/effort` ends it; and a simple prompt on Haiku still shows no dialog. Why: these pin the effort-first offer and prove it adds no dialog where none existed. Verify: `claude plugin test .` fails on these tests, and every existing simple-prompt test still passes.
5. [x] Add a failing test that the refine review's request carries a `maxTokens` of at least 4096, and higher for a 20,000-character prompt than for a short one. Why: this pins the fix for long prompts losing their closing `</prompt>` tag. Verify: `claude plugin test .` fails on this test with the actual value of `undefined` shown, and only the tests from steps 2 to 5 fail.

### Phase: GREEN

6. [x] In `hooks/register.ts`, replace the `$.model.classify` call in `choose()` with a `rate()` function that calls `$.model.complete({ model: 'haiku', system: RATER, prompt, effort: 'low', maxTokens: 256, timeoutMs: 10_000 })`. Export `RATER`, a rubric defining `simple`, `moderate`, `complex` and `long-running` by task shape, and `parseRating`, which returns the one label the reply names or undefined. Why: one low-effort call with written definitions is both faster and better grounded than bare labels. Verify: re-run `claude plugin test .` after the edit; the step 2 tests pass, and `grep -c 'model.classify' hooks/register.ts` prints 0.
7. [x] Replace `RANK` and `rank()` with a lookup that gives `mythos` the same rank as `fable`, treat an unrecognized model as already fitting `complex` and `long-running`, add `fable` to `ALIASES`, add `'long-running': 'fable'` to `SUGGEST` and `'long-running': 'high'` to `FLOOR`, and offer the new-session option for `long-running` as well as `complex`. Why: this fixes the wrong-way downgrade and gives Fable a path in. Verify: re-run `claude plugin test .`; the step 3 tests pass and no earlier test breaks.
8. [x] Add the `Keep model, effort low` option as the first choice for a `simple` rating whenever the dialog shows. Choosing it sets an exact effort that `turn.step` applies to main-loop requests (lowering as well as raising), shows `effort lowered to low` in the status line, and is cleared by `/effort`. Why: the guide prefers changing effort to changing models, and this keeps a simple opener from locking the session on Haiku by default. Verify: re-run `claude plugin test .`; the step 4 tests pass.
9. [x] In `review()`, pass `maxTokens: Math.min(64_000, Math.max(4096, Math.ceil(text.length / 2)))` to `$.model.complete`. Why: the reply holds a full rewrite plus issues and questions, so its cap has to grow with the prompt. Verify: re-run `claude plugin test .`; the step 5 test passes and the whole suite is green.
10. [x] Write `evals/rating-prompts.json` with about 30 realistic first prompts, at least 6 per rating, each with its expected label. Then write `scripts/eval-rating.mjs`, which imports `RATER` and `parseRating` from `hooks/register.ts` (Node 24 strips the type-only imports), runs each prompt through `claude -p --model haiku --effort low --system-prompt <RATER>`, and prints per-label accuracy, a confusion table and the count of replies with no label. With `--baseline`, it runs the same prompts with a bare-label system prompt like the one `classify` used. First run one prompt and confirm that the installed prompt-triage mod did not intercept the call; if it did, run the CLI with plugins turned off. Why: the guide calls a use-case eval set the most important step, and the baseline shows whether the rubric is actually better. Verify: `node scripts/eval-rating.mjs` and `node scripts/eval-rating.mjs --baseline` each finish with exit 0 and print an accuracy line for all four labels.
11. [x] Update `README.md`: the four ratings and the models they suggest, the `Keep model, effort low` option, typing `fable`, Mythos treated like Fable, the effort minimums described as a guard against an effort lowered by hand (with the per-model defaults that make `medium` a no-op today), the new review token cap, and an "Evaluating the rating" note under Development. Why: the README documents every behavior and limit, and several of its claims change here. Verify: every behavior claim in the changed README lines matches the code and tests; `claude plugin test .` still passes. If tests still fail after 8 iterations across this phase, stop and report the exact blocker: the failing assertion, the last diff tried, and what was ruled out. Do not report success.

### Phase: VERIFY

12. [x] Run the full suite and the manifest check. Why: one green run over everything is the evidence that the change set works together. Verify: `claude plugin test .` exits 0, and `claude plugin validate .` exits 0.
13. [x] Typecheck `hooks/register.ts` with `npx tsc --noEmit -p .` when `.claude-plugin/types` is present; if that folder is missing (it is gitignored), say so instead of reporting a pass. Why: a green suite over code that does not typecheck is not verified. Verify: the command exits 0, or the step reports that the types folder is missing.
14. [x] Run the eval with and without `--baseline` and record both accuracy figures, and the no-label count, in this plan's Decisions section. Why: the eval is what shows the rubric and the `long-running` tier actually rate better than bare labels. Verify: the rubric's overall accuracy is at least the baseline's, and the no-label count is 0; if either fails, stop and report the numbers rather than tuning the eval set to pass.
15. [x] Load the mod with `claude --plugin-dir .`, then in three fresh sessions send a one-line question, a large multi-file refactor request, and an hours-long migration request. Why: the tests mock the engine, so only a live run proves the dialog, the switch and the effort change behave as documented. Verify: the first shows `Keep model, effort low` first; the second is rated `complex`; the third is rated `long-running` and offers `Switch to fable`; after choosing low effort, the status line reads `effort lowered to low`.

## Tests

Tier 1 — This plan changes application code
- Objective: the first prompt is rated by a rubric call and gets the right offer for its rating. File: hooks/register.test.ts; Type: mock; Asserts: the rating request is a `haiku` `complete` call at effort `low` with the four-label rubric, and each rating produces its documented options, model switch and effort; Run: claude plugin test .
- Unit: model ranking and aliases. File: hooks/register.test.ts; Targets: rank lookup, ALIASES, choose(); Key cases: Mythos on a complex prompt, an unrecognized model name, "use fable", long-running on opus and on Fable
- Unit: low-effort option. File: hooks/register.test.ts; Targets: choose(), turn.step hook, /effort hook; Key cases: option order, exact `low` on the main loop, subagent untouched, /effort clears it, no dialog on Haiku
- Unit: refine review token cap. File: hooks/register.test.ts; Targets: review(); Key cases: short prompt gets at least 4096, a 20,000-character prompt gets more
- Integration: rating eval against the live model. File: scripts/eval-rating.mjs; Targets: RATER, parseRating, evals/rating-prompts.json; Key cases: per-label accuracy, baseline comparison, replies with no label

## Acceptance Criteria

- [x] `claude plugin test .` exits 0 with the tests from steps 2 to 5 included.
- [x] `hooks/register.ts` has no call to `$.model.classify`; the rating request is a `haiku` `complete` call with `effort: 'low'`, `maxTokens: 256` and a 10-second timeout.
- [x] A `complex` prompt on `claude-mythos-5-1`, or on a model name the mod does not recognize, is never offered "Switch to opus".
- [x] Typing "use fable" under "Other" routes main-loop requests to `fable`.
- [x] A `long-running` prompt on opus offers "Switch to fable"; on Fable or Mythos it offers no switch.
- [x] For a `simple` prompt that shows the dialog, the first option is `Keep model, effort low`, and choosing it sends main-loop requests at effort `low`.
- [x] The refine review's request carries a `maxTokens` of at least 4096 that grows with the prompt's length.
- [x] `node scripts/eval-rating.mjs` reports overall accuracy at least equal to `node scripts/eval-rating.mjs --baseline`, with no replies missing a label.
- [x] The README describes the four ratings, the low-effort option, Fable and Mythos handling, what the effort minimums do, and how to run the eval.

## Verification

Run `claude plugin test .` and `claude plugin validate .`; both exit 0. Run `node scripts/eval-rating.mjs` and `node scripts/eval-rating.mjs --baseline`; the rubric's overall accuracy is at least the baseline's and no reply lacks a label. Then load the mod with `claude --plugin-dir .` and walk the three fresh sessions from step 15: a one-line question shows `Keep model, effort low` first, and choosing it shows `effort lowered to low`; a large refactor request is rated `complex`; an hours-long migration request is rated `long-running` and offers `Switch to fable`. `grep -c 'model.classify' hooks/register.ts` prints 0.

## Next Steps

- Rate and restate the prompt in one call
  PR #14 adds a second blocking `haiku` call before the dialog. One call could return both.
  ```text
  In the prompt-triage repo, hooks/register.ts makes two blocking haiku calls before the first-prompt dialog: rate() for the rating and restate() for the "Read as:" line. Merge them into one $.model.complete call that returns the rating and the one-line restatement together, keeping the restatement skipped for simple prompts and when no dialog shows. Update hooks/register.test.ts and the README's Cost section. Verify: claude plugin test . exits 0, and a test asserts exactly one model.complete call happens before the dialog for a complex prompt.
  ```
- Offer fast mode for latency-sensitive sessions (wish list)
  The guide lists fast mode as a speed option at premium pricing; the review left it out of scope.
  ```text
  In the prompt-triage repo, investigate whether a Claude Code mod can turn on fast mode for the session (check the mod API types under .claude-plugin/types for a fast-mode setting) and, if it can, propose when hooks/register.ts should offer it. Write findings only, no code changes. Verify: the findings name the exact API, or state that none exists.
  ```

## Unresolved Questions

- Do thinking tokens count against `maxTokens` on a `complete` call to Haiku 5.5 at effort `low`? The cap is 256 to leave room either way; step 14's no-label count will show whether it is enough.
- Does `claude -p` load the installed prompt-triage mod and rate the eval's own prompts? Step 10 checks this before the numbers are trusted.
- Can `npx tsc --noEmit -p .` run in a fresh clone, given `.claude-plugin/types` is gitignored? Step 13 reports either way.

## Resources

- Choosing the right model — https://platform.claude.com/docs/en/about-claude/models/choosing-a-model — the source of the effort-first advice, the model table and the eval guidance.
- Models overview — https://platform.claude.com/docs/en/about-claude/models/overview — prices, latency and default effort per model.
- Session recap — https://claude.ai/artifact/V44hgnbSkbxLUbubVgWEFR — the findings this plan implements.
- PR #14 — https://github.com/shawn-sandy/prompt-triage/pull/14 — the restatement change this plan builds on.
