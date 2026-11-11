---
status: todo
type: fix
created: 2026-11-11
repo-name: prompt-triage
effort: high
workflow: never
artifact-url: https://claude.ai/artifact/UzkXN4LLbz2fUEZ7jNqffY
glance: The mod raises complex and long-running sessions to high effort, though Claude Code runs Opus 5.5 and Fable 5.2 at medium by default, and it leaves every subagent on the expensive model it just switched to. After this, the effort minimums only catch effort lowered by hand, exploration subagents run on haiku after a switch up, and /triage-stats shows what each effort level cost. Done means the suite is green, the eval mean holds, and a live complex prompt shows none of the old high-effort wording.
---

# Plan: Bring prompt-triage's model and effort choices in line with the selection guide

## Objective

Fix the nine places where prompt-triage disagrees with, or could do more of, what Addy Osmani's model-selection article recommends: the effort minimums, stale README defaults, subagent models, rubric wording, the self-verification step, the hand-off brief, effort in the decision log, the haiku alias on third-party providers, and `opusplan`.

## Context

A review of "Which Claude model should you build with?" (Addy Osmani, claude.dev, 2026-11-09) against `hooks/register.ts` found these issues:

1. `FLOOR` sets `complex` and `long-running` to `high`. The article recommends Opus 5.5 at `medium`, then `high`, for everyday engineering, and Fable 5.2 at `medium`, then `high`, for migrations. In Claude Code both models default to `medium`. So the `high` floor raises effort on default sessions, not only when the user lowered it by hand. The earlier plan `implement-model-selection-findings.md` kept the floors on the belief that they never change anything at default effort, which holds for the API defaults but not for Claude Code's.
2. The README Effort section says the API default is `high` on "Fable 5.1 and Sonnet 5.5". The current model is Fable 5.2, and Claude Code runs both at `medium`.
3. The mod never touches subagents. The article says Explore runs on the session's model, so after a switch up to opus or fable, exploration runs at that model's rate.
4. `RATER` doesn't mention performance work, and its `moderate` definition leans on "clear goal". The article says a clear spec alone doesn't justify Sonnet: migrations and performance optimizations can be well specified and still need Opus.
5. The article's escalation order is: self-verification, then one more effort level, then the next model up. The band's Goal "Add a check" is the self-verification step, but the model dialog never uses it.
6. The article says to start a fresh session "with a short written plan". `HANDOFF` asks Claude to pass the prompt alone.
7. Decision-log entries record cost, turns and context use, but not the effort the session ran at, so `/triage-stats` can't compare effort against spend.
8. On Bedrock, Google Cloud, Microsoft Foundry and Claude Platform on AWS, the `haiku` alias resolves to Haiku 4.5, which takes `budget_tokens`, not effort levels. The rating call sends `effort: 'low'`. Nobody has checked what happens there.
9. `rank()` matches on substrings, so `opusplan` ranks as opus, although it makes its edits with Sonnet.

[PR 45](https://github.com/shawn-sandy/prompt-triage/pull/45) is open on `claude/prompt-triage-status-row-1492b1`. It adds a status row to the band, with session cost, prompt count, context fill and a Clear or Compact button, plus a thirteenth hook, `session.compact`. It edits the same places this plan does: the `ui.render` hook, the start of the `turn.complete` hook, and the README's Hooks table, hook count and Data section. Whichever merges second rebases onto the other.

The `agent.spawn` event's fields beyond `isTeammate`, `resume` and `model` aren't on the official reference. They are in the generated declarations under `.claude-plugin/types/`, which an interactive `claude --plugin-dir .` session writes and git ignores. Step 1 reads them before any subagent test is written.

## Decisions

- Both minimums become `medium`: chosen by the user. `medium` is at or below every model's Claude Code default, so the minimums go back to guarding against effort lowered by hand, which is what the earlier plan meant them to do. The dialog sentence "Effort will be at least high" is deleted, because no rating sets `high` any more.
- Subagent routing starts with a check of the declarations, then covers Explore only: chosen by the user. After a switch up to opus or fable, an Explore spawn that sets no model of its own runs on `haiku`. If the event can't name the agent type, the routing is dropped and the reason is written here.
- Self-verification works through Refine prompt, with no new dialog option: chosen by the user. For a `complex` or `long-running` prompt, Refine prompt uses Goal "Add a check" when the band's Goal is Auto. A Goal of Off or Add a check is respected as set.
- `opusplan` is documented as a limit, not re-ranked: chosen by the user.
- The plan uses the red-green-verify shape: the work changes `hooks/register.ts`, and `claude plugin test .` is a runner. There is no SHIP phase, because nobody asked to ship.
- The rubric change is kept only if the mean of `--runs 3` doesn't fall on `complex` or `moderate` by more than one case from the baseline run in step 7. A single eval run varies by a few cases, so one run can't decide this.
- Prices never appear in dialog text, as before.
- Build on PR 45 if it has merged before step 1 starts, and otherwise on `main` as it is. The rebase cost lands on whichever change merges second, and building on a merged PR 45 means this plan pays it once, up front.
- PR 45's own review findings stay out of this plan's steps: the stale "never makes either call itself" sentence, Clear recommended from context fill alone, and the status row showing under `band: never`. They belong to that PR, so they are under Next Steps. The one exception is the README sentence: step 15 fixes it if PR 45 merged without fixing it, since step 15 rewrites that section anyway.

## Files

- hooks/register.ts (modified) — FLOOR, the dialog floor sentence, the Refine goal for strong ratings, HANDOFF, effort in Decision and the tally, an agent.spawn hook, RATER wording, and a provider fallback if step 1 calls for one
- hooks/register.test.ts (modified) — updated floor tests, plus new tests for the refine goal, hand-off plan, effort log, Explore routing and provider fallback
- evals/rating-prompts.json (modified) — new complex and moderate cases about clear specs and performance work
- README.md (modified) — Effort, What it does, Improving a prompt, The decision log, Hooks (count and the sentence about the mod's own calls), Limits, Data and Evaluating the rating; PR 45 edits Hooks and Data too
- CLAUDE.md (modified) — the eval call count, if it changes

## Steps

### Phase: RED

1. Run `gh pr view 45 --json state --jq .state`; if it prints `MERGED`, sync this branch with `main` before anything else. Then run `claude --plugin-dir .` once interactively and quit, and read `.claude-plugin/types/` for the `agent.spawn` input fields (agent type or name, the subagent's own `model`) and for how `$.model.complete` documents `effort` on a model that takes none. Write both findings as bullets under Decisions. Why: the Explore routing and the provider fallback both depend on facts the official reference does not state. Verify: when PR 45 has merged, `grep -c "session.compact" hooks/register.ts` prints a number above 0; `ls .claude-plugin/types` lists files; and Decisions has the two new bullets. If the folder can't be produced, stop and ask the user to run `claude --plugin-dir .` once.
2. Change the effort expectations in the tests at `hooks/register.test.ts` named "a complex prompt on a model above opus is not offered a step down", "a complex prompt raises main-loop effort below high", "a prompt rated again replaces the effort minimum" and "a long-running prompt raises main-loop effort to high" from `high` to `medium`, and change "a complex prompt states the high effort floor" to assert that the question contains no "Effort will be at least" sentence. Why: these pin the medium minimum and the removed sentence before the code changes. Verify: `claude plugin test .` fails on exactly these tests, with the expected `medium` set against the actual `high`.
3. Add failing tests: Refine prompt chosen in a `complex` dialog, with the stored Goal pick `auto`, sends a reviewer `system` that contains the Add-a-check instruction; the same with the stored pick `off` does not; and a `moderate` prompt's Refine with `auto` does not. Why: this pins self-verification as the first lever for strong ratings without overriding a pick the user made. Verify: `claude plugin test .` fails on the first case only, and the other two pass.
4. Add a failing test that the new-session context, sent both from Open in a new session and from Run in, asks Claude to include a short written plan in the brief. Why: the article's advice is to start the fresh session from a plan, and both paths share `HANDOFF`. Verify: `claude plugin test .` fails on the new test, showing the current context string.
5. Add failing tests: after a rated first prompt and a main-loop step at effort `medium`, `turn.complete` sets `effort: 'medium'` on the decision entry; after Keep model, effort low, it sets `low`; a subagent step does not change it; and `/triage-stats` over a stored log with efforts and costs prints a table of rating, effort, sessions and average cost. Why: effort is the article's first dial, and the log can't show what it costs without it. Verify: `claude plugin test .` fails on these tests, naming the missing `effort` field and the missing table.
6. If step 1 found an agent-type field, add failing `agent.spawn` tests: after Switch to opus, an Explore spawn with no model of its own comes out with `model: 'haiku'`; unchanged are an Explore spawn after Keep, a spawn of another agent type, a spawn that sets its own model, a resumed spawn (`e.resume` set) and a teammate (`e.isTeammate`). If step 1 found no such field, skip this step and step 12, and say so in Decisions. Why: these pin a routing change that touches only cheap read-only work. Verify: `claude plugin test .` fails on the first case and passes the five unchanged cases, or Decisions records the skip.
7. If step 1 found that `effort` on a model without effort settings makes `$.model.complete` reject, add a failing test that a rating call rejected for its effort is retried once without `effort` and its rating is used. Then, whatever step 1 found, run `node scripts/eval-rating.mjs --runs 3` on the unchanged `RATER` and record the mean for each rating under Decisions. Why: the fallback keeps the rating working on third-party providers, and the baseline must be measured before the rubric changes. Verify: the new test fails, or Decisions records why there is none; Decisions holds four baseline means.

### Phase: GREEN

8. Set `FLOOR` to `medium` for `moderate`, `complex` and `long-running`, and delete the `floor` sentence code in `choose()` that this orphans. Why: the user chose a minimum that guards against effort lowered by hand without raising default sessions. Verify: re-run `claude plugin test .`; the step 2 tests pass.
9. Where the model dialog's Refine prompt answer calls `improve()` (the `prompt.submit` hook), pass `{ ...picks, goal: 'check' }` when the rating is `complex` or `long-running` and the stored Goal is `auto`. Why: self-verification comes before more effort or a bigger model. Verify: re-run `claude plugin test .`; the step 3 tests pass.
10. Extend `HANDOFF` to ask Claude to put a short written plan of the task in the `start_session` brief. Why: a fresh session that starts from a plan doesn't have to redo this session's reading. Verify: re-run `claude plugin test .`; the step 4 test passes, and so does every existing hand-off test.
11. Add an optional `effort` to `Decision` and `Spend`. Record the effort level of the latest main-loop request in `turn.step` (after any change the mod made), write it in `turn.complete` like the other figures (after PR 45's redraw call when that is present, leaving that call first), and add the effort table to `tally()`, counting only entries that have both an effort and a cost. Why: this is the article's "plot score against spend" method, applied to the data the log already keeps. Verify: re-run `claude plugin test .`; the step 5 tests pass, and the log-cap test still passes.
12. Add an `agent.spawn` hook that returns `next(e)` for a resumed run, a teammate, a spawn that sets its own model, or any agent type but Explore, and otherwise sets `model: 'haiku'` when the mod's model override ranks at opus or above. Why: exploration is cheap to check, so it belongs on the cheapest model once the main loop moves up. Verify: re-run `claude plugin test .`; the step 6 tests pass.
13. If step 7 added the fallback test, retry the rating call once without `effort` when it rejects for its effort. Why: on a provider where `haiku` is Haiku 4.5, the rating otherwise fails every time and the dialog never shows. Verify: re-run `claude plugin test .`; the step 7 test passes, and the timeout and failed-rating tests still pass.
14. Add to `RATER`: performance optimization and migrations as examples of `complex`, and a line saying a clear spec alone doesn't make a task `moderate`. Add 4 `complex` cases and 4 `moderate` cases about these to `evals/rating-prompts.json`, then run `node scripts/eval-rating.mjs --runs 3`. Why: the article names these as tasks that can be well specified and still need Opus. Verify: no mean for `complex` or `moderate` is more than one case below the step 7 baseline; if one is, revert the `RATER` change, keep the new cases, and record the numbers in Decisions.
15. Update `README.md`: the Effort section (the `medium` minimums, Claude Code defaults beside the API defaults, Fable 5.2), What it does items 6 and 8, Improving a prompt (the Add-a-check default for strong ratings), The decision log and Data (the `effort` field and the new table), the Hooks table and hook count (`agent.spawn`, if built: one more than the count `main` has, which is thirteen if PR 45 merged and twelve otherwise, in both the Hooks section and the Layout table), the Hooks section's "The mod never makes either call itself" sentence (rewrite it to say the mod runs `/clear` or `/compact` itself from the status row, if PR 45 merged and the sentence is still there), Limits (the `haiku` alias on third-party providers, `opusplan` ranked as opus), and the case counts under Evaluating the rating; update the call count in `CLAUDE.md` if it changed. Why: the README documents every behavior and limit, and steps 8 to 14 change several. Verify: `grep -c 'Effort will be at least high\|Fable 5.1' README.md` prints 0; the number of `on(` registrations in `hooks/register.ts` (counting the `command.run` hooks one per command, as the README does) matches the hook count the README states; and every changed line matches a test or the code. If tests still fail after 8 iterations across this phase, stop and report the exact blocker: the failing assertion, the last diff tried, and what was ruled out. Do not report success.

### Phase: VERIFY

16. Run the full suite and the manifest check. Why: these two commands are the whole CI gate. Verify: `claude plugin test .` exits 0 and `claude plugin validate .` exits 0, with both outputs observed.
17. Typecheck with `npx tsc --noEmit -p .`. Why: a green suite over code that doesn't typecheck is not verified, and CI has no typecheck. Verify: the command exits 0, or the step reports that `.claude-plugin/types` is missing instead of reporting a pass.
18. Load the mod with `claude --plugin-dir .` on Sonnet, send a multi-file redesign request, choose Refine prompt, then send it again and choose Switch to opus, ask for an exploration of the codebase, and run `/triage-stats`. Why: the tests mock the engine, so only a live run shows the dialog, the refine goal, the routing and the table together. Verify: the dialog has no "Effort will be at least high"; the rewrite ends with a check to run; the Explore subagent's requests report a haiku model (if step 12 was built); and `/triage-stats` prints the effort table.

## Tests

Tier 1 — This plan changes application code
- Objective: complex prompts run at the medium minimum, refine with a check, and log their effort. File: hooks/register.test.ts; Type: smoke; Asserts: a complex first prompt kept on Sonnet sends main-loop requests at `medium`, not `high`, its dialog has no high-effort sentence, its Refine prompt reviewer carries the Add-a-check line, and its decision entry gets `effort: 'medium'`; Run: claude plugin test .
- Unit: effort minimums. File: hooks/register.test.ts; Targets: FLOOR, choose(), turn.step; Key cases: complex and long-running raise `low` to `medium`, leave `medium` and `xhigh` alone, a re-rated prompt replaces the minimum
- Unit: refine goal for strong ratings. File: hooks/register.test.ts; Targets: prompt.submit Refine path; Key cases: stored Goal auto on complex, stored Goal off on complex, stored Goal auto on moderate
- Unit: hand-off brief. File: hooks/register.test.ts; Targets: HANDOFF via Open in a new session and Run in; Key cases: both paths carry the plan request
- Unit: effort in the log. File: hooks/register.test.ts; Targets: turn.step, turn.complete, tally(); Key cases: medium recorded, low after Keep model effort low, subagent step ignored, effort table printed only with effort and cost
- Unit: Explore routing. File: hooks/register.test.ts; Targets: agent.spawn hook; Key cases: Explore after Switch to opus, Explore after Keep, another agent type, its own model, resumed run, teammate
- Unit: provider fallback (if built). File: hooks/register.test.ts; Targets: rate(); Key cases: an effort rejection retried without effort, a timeout not retried
- Integration: rating rubric. File: scripts/eval-rating.mjs with evals/rating-prompts.json; Targets: RATER and parseRating against haiku; Key cases: new complex and moderate cases, mean of 3 runs against the step 7 baseline

## Acceptance Criteria

- [ ] `FLOOR` holds `medium` for moderate, complex and long-running, and no test expects `high` from a rating.
- [ ] The model dialog text never contains "Effort will be at least high".
- [ ] Refine prompt on a complex or long-running prompt with Goal Auto sends the Add-a-check instruction; Goal Off is respected.
- [ ] The new-session context asks for a short written plan in the brief.
- [ ] Decision entries gain an `effort` field, and `/triage-stats` prints effort against average cost when entries have both.
- [ ] Either an Explore spawn after a switch up runs on haiku, or Decisions records why the event can't support it.
- [ ] Either the rating call survives a provider whose `haiku` takes no effort, or Decisions records that the call needs no fallback.
- [ ] The `complex` and `moderate` eval means stay within one case of the baseline, or the rubric change is reverted with the numbers recorded.
- [ ] README has no "Fable 5.1", documents the Claude Code default efforts, and lists the `haiku` alias and `opusplan` limits.
- [ ] The README's hook count matches the hooks `hooks/register.ts` registers, with or without PR 45 merged.
- [ ] `claude plugin test .` and `claude plugin validate .` both exit 0.

## Verification

Run `claude plugin test .` and `claude plugin validate .`; both must exit 0 with their output observed. Run `node scripts/eval-rating.mjs --runs 3` and compare each mean with the baseline recorded in Decisions. Then load the mod with `claude --plugin-dir .` in a session on Sonnet and send "Redesign the auth layer so sessions survive a server restart". The dialog must read "Rated complex" with no high-effort sentence. Refine prompt must return a rewrite that ends with a check to run. Sent again with Switch to opus, a request to explore the codebase must show the Explore subagent on haiku (when step 12 was built). `/triage-stats` must print a table with an Effort column.

## Next Steps

- Measure the low-then-retry pattern on the eval set
  The article reports that Opus 5.5 at `low`, with only the failures re-run at `high`, beat all-`high` on cost. The rating call could try this pattern too.
  ```text
  In the prompt-triage repo, extend scripts/eval-rating.mjs with a --retry flag: rate each case once at effort low, re-rate only the replies that name no single rating at effort medium, and print accuracy and the number of retries beside the plain run. Do not change hooks/register.ts. Verify: node scripts/eval-rating.mjs --retry exits 0 and prints a retry count; record the result in the PR description.
  ```

- Fix PR 45's review findings before it merges
  Found when PR 45 was reviewed against the model-selection article. These are that PR's fixes, not this plan's.
  ```text
  In the prompt-triage repo, on PR 45 (branch claude/prompt-triage-status-row-1492b1), make three changes. (1) README.md's Hooks section says "The mod never makes either call itself" about prompt.submit and command.run, but tidy() in hooks/register.ts now runs /clear and /compact with $.command.run; rewrite the sentence to say so. (2) tidy() marks Clear "(recommended)" from 25% to 59% context fill, though fill can't tell whether the person is mid-task and Clear discards the conversation; recommend Compact below COMPACT_AT, or recommend nothing there, and update the test that asserts the option order. (3) After the first prompt, the terminal band now draws even under band: never; hide the status row under band: never, or add a separate config option for it, and update the README's "The row shows whatever the band setting is" line. Write each changed test before the fix and watch it fail. Verify: claude plugin test . and claude plugin validate . exit 0, and grep -c "never makes either call" README.md prints 0.
  ```
- Offer New session in the Clear or Compact dialog (wish list)
  The article's advice is to start a fresh session with a short written plan rather than clear in place. Depends on PR 45 having merged, and on step 10 of this plan.
  ```text
  In the prompt-triage repo, after PR 45 has merged, add a third option "New session" to the Clear or Compact dialog in tidy() in hooks/register.ts, on the desktop surface only (start_session exists only there). Choosing it sends a prompt carrying the HANDOFF instruction, asking Claude to start a fresh session with a short written plan of the work so far, instead of running /clear. Add tests that the option shows on desktop and not on the terminal, and that choosing it runs no /clear. Update the README's status row section. Verify: claude plugin test . exits 0, and a live desktop run of the option starts a new session whose brief contains a plan.
  ```

## Unresolved Questions

- Explore's agent-type name
  ```text
  In the prompt-triage repo, read .claude-plugin/types/ and report the exact field and value an agent.spawn event carries for the built-in Explore subagent, and whether a user-defined agent named Explore can be told apart from it. Recommend whether the routing should match the built-in only.
  ```

## Resources

- [Which Claude model should you build with?](https://claude.dev/blog/which-claude-model-should-you-build-with/) — Addy Osmani, 2026-11-09: starting model and effort by task, the escalation order, subagent models, haiku alias resolution
- [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference) — `agent.spawn`: `next({ ...e, model })`, `e.resume`, `e.isTeammate`
- [React to events](https://code.claude.com/docs/en/plugins/mods/events) — `turn.step` fields, and aliases need v2.1.309 or later in `turn.step`
- docs/plans/implement-model-selection-findings.md — the earlier decision to keep the effort minimums
