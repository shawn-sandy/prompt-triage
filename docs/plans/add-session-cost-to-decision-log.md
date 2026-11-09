---
status: in-progress
modified: 2026-11-08
type: feature
created: 2026-11-08
repo-name: prompt-triage
artifact-url: https://claude.ai/artifact/Mivmv8KEg8YPZix498MUX4
workflow: never
glance: Today the decision log shows whether people take a model suggestion, but not what the session cost afterward, so nobody can say whether taking it saved money. After this, /triage-stats shows the average dollar cost of sessions for each rating and each choice, with the number of sessions behind every average, so the cost question is answered from real spend instead of arithmetic. It has worked when a real session's cost appears in that table after a few turns and sits at or below what /cost reports for the same session.
---

# Plan: Show what each session cost next to the model decision that started it

## Objective

Record what each rated session spends, in US dollars, on the decision-log entry that session created, and show the average per rating and per choice in `/triage-stats`, with no new model call and no prompt text stored.

## Context

The mod rates the first prompt of a session, may switch the model, and logs `{ rating, from, to, chose }` for every decision (built by `docs/plans/harden-cost-levers.md`). `/triage-stats` counts how often a switch was taken. It cannot say whether the sessions that switched cost less, so "did accepting the suggestion save money" is still answered with arithmetic. Section A of `docs/proposals/session-usage.md` names this measurement as the prerequisite for the proposal's other changes (B, C and D).

The facts below were checked against the generated type declarations, which Claude Code 2.1.319 wrote (the version CI pins and the installed CLI). This worktree has none, because `.claude-plugin/types/` is gitignored and written only when an interactive session loads the mod, so they were read from a sibling worktree: `.claude/worktrees/bundle-icon-setup-145aed/.claude-plugin/types/claude-code/index.d.ts`. `$.session.usage()` answers `{ startedAt, context, rateLimits, cost }`. `cost` is `{ usd: number }`: US dollars, summed over every priced API response this session, as `/cost` totals it, and absent only where the host keeps no cost ledger (the CLI always has one). The plain call costs nothing. A `turn.complete` event carries `agentId` only for a subagent's turn; on the main loop it is absent. It fires for every kind of ending (`answer`, `aborted`, `refusal`, `error`). `/clear` ends the conversation and continues the process under a new session id, with no `session.start`.

Not verified: whether the cost ledger resets on `/clear`; whether the ledger includes the mod's own `$.model.complete` calls (the declarations say only that a compaction's request is included); and whether the test harness accepts the minimal `session.usage` answer used here. The design does not depend on the first two (see Decisions). Step 1 confirms the third and step 10 observes the first.

The request reads cost on `turn.complete`. Section A of the proposal reads it once on `session.end` instead. This plan follows the request.

Risks and mitigations. First, the log is one list in the shared store that every session rewrites as a whole, with no lock, so an update that lands at the same instant as another session's new entry can lose that entry. The README already accepts this for appends; updates make it more frequent. Mitigation: skip the write when the figure has not changed, keep the 200-entry cap, and keep the upgrade path the code already names (a key per session, merged by `/triage-stats`). Second, sessions differ in task, so the averages show association, not cause; the command's output says so once. Third, an entry can roll off the cap before its session ends; the update then finds nothing and must not append.

## Decisions

- The hook is `turn.complete` on the main loop only (no `agentId`), as the request says, not `session.end` as proposal A had: an end-of-session write has to fit the 1.5 second budget the whole `session.end` chain shares and is lost when the process is killed, while a per-turn write always leaves the latest figure behind. `session.measure` (pushed, carries `cost`, folds bursts) is the alternative if the write rate ever matters.
- The recorded cost is the spend since the decision was logged: `usd` read when the entry is logged is kept in memory as a baseline, and the stored value is the later reading minus the baseline. That keeps the number correct whether or not `/clear` resets the ledger, and leaves out the rating call, which happens before the entry is logged.
- Costs are stored rounded to four decimal places, so a float such as 0.30000000000000004 does not bloat every entry.
- The entry carries an opaque id made by the mod (the time from `$.clock.now()` plus a random string), not `$.session.id()`: the session id is the transcript file's name, so storing it would point at a private file on disk, while a random id links to nothing. The id exists only to find the entry again.
- Cost lives on the decision entry (`cost`, `id`), updated in place, not in a second store key: one record per decision matches the existing `Decision` shape and test style. A lost update repairs itself on the next turn, because each turn writes the latest figure.
- Writes are skipped when the figure equals the one last written, so a turn with no priced response costs no store write.
- Choices are grouped into four classes, because the raw `chose` text names the model (`Keep claude-opus-5-5`) and would split "kept" into many rows: `switched` (the model tier changed), `low effort` (Keep model, effort low), `hand-off` (Open in a new session, on its own line because the task ran in another session), and `kept` (everything else, including dismissed, none asked and a failed Refine).
- This plan is red-green-verify: the steps change application source and the project has a runner, `claude plugin test .`. There is no SHIP phase, because no one asked to commit or open a pull request. Documentation sits in the VERIFY phase, so it describes behaviour only after the tests have proven it.
- Out of scope: the proposal's `turns` and `ctx` fields, changes B, C and D, per-model prices, and a `session.end` hook.
- Built differently from the steps, on purpose: the id is `crypto.randomUUID()` (the hooks module's globals declare it), which is as opaque as the clock plus a random string and needs no helper.
- Added during the build: a new first prompt clears the tracked entry before it is rated, so a first prompt after `/clear` whose rating fails cannot pour the next conversation's spend into the earlier entry (or a negative figure, if the ledger resets). Covered by the test "a first prompt that is not rated stops the earlier decision from gaining later spend", which fails when the reset is removed.
- Changed during the build: costs are rounded down to four places, not to the nearest. A live headless session stored 0.0116 against a `total_cost_usd` of 0.01155778, which broke "no larger than /cost"; after the fix the next live session stored 0.0115 against 0.0115128.
- Observed live (step 10, headless `claude -p --plugin-dir . --model haiku`): the stored cost was within a hundredth of a cent of the session's whole total, so the baseline read after the rating call was at most $0.0000128. A haiku call carrying the rater prompt costs more than that, so the ledger and `total_cost_usd` most likely do not count the mod's own `$.model.complete` rating call. The mod's store writes need the sandbox off: a sandboxed run cannot write `~/.claude/plugins/store/`, so the log write fails silently and nothing is recorded.
- Not yet observed: what `/clear` does to the ledger, and an interactive session with the dialog answered and `/cost` read beside `/triage-stats`. Both need a person at an interactive `claude --plugin-dir .`, which this build could not drive. The design does not depend on the `/clear` answer (see the baseline decision above).

## Files

- hooks/register.ts (modified) — `Decision` gains `id` and `cost`; a `record()` helper at the three `log()` call sites; a `turn.complete` hook with `addCost()`; a cost table in `tally()`
- hooks/register.test.ts (modified) — usage and `turn.complete` helpers, the new tests, and three exact-match assertions relaxed for the new `id`
- README.md (modified) — the decision log, the hooks table and count, the limits and the data stored
- docs/proposals/session-usage.md (modified) — section A matches the design that shipped, and two settled facts leave its "not settled" list
- CLAUDE.md (modified) — the `turn.complete` `agentId` line leaves "Not confirmed by the page"
- docs/plans/add-session-cost-to-decision-log.md (new) — this plan

## Steps

### Phase: RED

1. [x] Add the test helpers in hooks/register.test.ts: a `usd` setting (a number, or a list giving one reading per call) and a `usageFails` setting on `Setup`, a `session.usage` stub in `engine()` that answers `{ startedAt: 0, context, rateLimits: [], cost: { usd } }` with no `cost` when `usd` is undefined (read the field types in the declarations), a count of store writes, and a `complete($, agentId?)` helper that calls `$.turn.complete` the way `step()` calls `$.turn.step`. Why: every later test needs a controllable usage reading and a way to end a turn, and the harness has neither yet. Verify: record the passing test count first, then `claude plugin test .` passes with the same count after the edit, so the helpers broke nothing.
2. [x] Write failing recording tests in hooks/register.test.ts: after a rated first prompt and one main-loop `turn.complete` the entry holds `cost` equal to the later reading minus the baseline and a string `id`; a `turn.complete` with an `agentId` leaves the log unchanged; a second turn updates the same entry instead of appending; an unchanged figure causes no store write; `JSON.stringify(store)` holds neither the prompt text nor the value of `$.session.id()`; and every `log()` path (dismissed, new session, failed Refine, switch) carries an id. Why: these pin the behaviour before any code exists, and the privacy promise is the part most likely to regress silently. Verify: `claude plugin test .` fails only the new tests, each with an assertion message such as `expected cost 0.42, received undefined` and not an import or type error; paste the output.
3. [x] Write failing edge-case tests in hooks/register.test.ts: `$.session.usage()` rejects or answers without `cost`, so nothing is written and nothing throws; a store read or write fails, so the log is unchanged and the turn's answer text passes through untouched; an entry already pushed out by the 200-entry cap is not added back; two sessions share one store and each updates only its own entry; and a second rated first prompt after the first (as after `/clear`) gets a new id and a cost that excludes the earlier spend, using a ledger that never resets. Why: each of these is a way the hook could hold up a turn or corrupt the shared log. Verify: `claude plugin test .` fails the new tests for the right reason, with the assertion text pasted.
4. [x] Write failing `/triage-stats` tests in hooks/register.test.ts: for each rating and class (switched, low effort, kept, hand-off) with a costed session the table shows the average and the session count; entries without a cost are left out of every average; no cost table and no mention of cost appears when no entry has a cost; and the original rating table and its three existing tests are unchanged. Why: the output is what a person reads, and an average without its count would mislead on a log capped at 200. Verify: `claude plugin test .` fails the new stats tests with assertion messages and the three original `/triage-stats` tests still pass.

### Phase: GREEN

5. [x] In hooks/register.ts add optional `id` and `cost` to `Decision`, and add a `record()` helper inside `register` that, at each of the three `log()` call sites in the `prompt.submit` hook (the dismissed and new-session entry, the failed-Refine entry and `decided.entry`), makes the opaque id, reads `$.session.usage()` once for the baseline, logs the entry with its id and remembers `{ id, base }` in a closure variable; then change the three existing exact-match assertions that now see an `id` to `expect.objectContaining`. Why: the entry needs a key to be found again and a starting point so the cost counts only what followed the decision. Verify: `claude plugin test .` passes the id tests from step 2 and the three relaxed assertions, and the cost tests still fail because the hook does not exist yet.
6. [x] Add `on('turn.complete', ...)` in hooks/register.ts that passes any event with an `agentId` straight to `next(e)`; otherwise, when `{ id, base }` is remembered, reads `$.session.usage()`, computes `cost` as the reading minus `base` rounded to four decimals, skips the write when it equals the last figure written, and calls a new `addCost()` beside `log()`, which reads the log (rejecting when the read fails, as `log()` does), sets `cost` on the entry with that id only, never appends, and writes the list back; end with `return next(e)` unchanged and a `.catch(($, e, next) => next(e))` so a failure never touches the turn. Why: this is the request itself, and every failure must leave the turn's text and the log exactly as they were. Verify: `claude plugin test .` passes the recording and edge-case tests from steps 2 and 3.
7. [x] Move the tier-direction helper out of `tally()` to module level, add a `kind()` that classes each entry as `hand-off`, `low effort`, `switched` or `kept`, make `tally()` append a second table with one row per rating and class that has at least one costed session (sessions with a cost, average in US dollars, count beside every average) followed by one line saying sessions differ in task so this shows association, not cause, append nothing when no entry has a cost, and add cost to the `triage-stats` description registered in `session.start`; if tests still fail after 8 iterations, stop and report the exact blocker (the failing assertion, the last diff tried and what was ruled out) and do not report success. Why: the table is how a person sees the result, and sharing one direction helper keeps the two tables from disagreeing. Verify: `claude plugin test .` passes the stats tests from step 4 and the three original `/triage-stats` tests unchanged.

### Phase: VERIFY

8. [x] Update README.md (the decision log section, the hooks table with a `turn.complete` row and the count "ten hooks" in both places it appears, the Limits section with the cost definition and the association caveat, the Data section with the new stored fields and the sentence saying only `/triage-stats` reads the log), update section A and the "not settled" list in docs/proposals/session-usage.md to the design that shipped, and remove the `turn.complete` `agentId` line from CLAUDE.md's "Not confirmed by the page" list. Why: the README documents every behaviour and the no-prompt-text promise, and the other two files would otherwise contradict what was just proven. Verify: `grep -n "ten hooks" README.md` prints nothing, `grep -n "turn.complete" README.md` shows the new hooks-table row, and `grep -n "No prompt text is logged" README.md` still matches.
9. [x] Run `claude plugin test .` and `claude plugin validate .`, and, if `.claude-plugin/types/` exists, `tsc --noEmit -p tsconfig.json` compared against the same command run once before step 1 (CI has no typecheck step, so only new errors count); the repo has no linter or formatter config, so match the surrounding style by eye. Why: CI runs the first two on every pull request, and a green suite over code that does not typecheck is not verified. Verify: both commands exit 0, the typecheck shows no error the baseline did not, and the final lines of each run are pasted.
10. [ ] Start `claude --plugin-dir .` interactively, send a first prompt of 40 or more characters, answer the dialog, let two turns finish, run `/cost` and then `/triage-stats`; then run `/clear`, send another first prompt and run `/triage-stats` again. Why: the harness stubs the usage reading, so only a live session shows the real unit, the real ledger and what `/clear` does to it. Verify: the first session's cost is above zero and no larger than the `/cost` total, the post-`/clear` session shows its own entry whose cost leaves out the first session's spend, and the turn's answer text looked unchanged; record what `/clear` did to the ledger in Decisions.

## Tests

Tier 1 — This plan changes application code
- Objective: a rated session's decision gains the session's spend and /triage-stats shows its average with a count. File: hooks/register.test.ts; Type: smoke; Asserts: after a first prompt and one main-loop turn.complete the stored entry's cost equals the usage reading minus the baseline and /triage-stats prints that cost with a session count of 1; Run: `claude plugin test .`
- Unit: the recording rules. File: hooks/register.test.ts; Targets: the turn.complete hook and addCost(); Key cases: a subagent turn is ignored, a second turn updates the same entry, an unchanged figure writes nothing, usage rejects or has no cost, a store read or write fails, an entry rolled off the cap is not added back, the answer text passes through unchanged, and the stored data holds neither the prompt text nor the session id
- Unit: the stats table. File: hooks/register.test.ts; Targets: tally() and kind(); Key cases: each class averaged separately with its count, entries without a cost left out of every average, no cost table when no entry has a cost, and the original rating rows unchanged
- Integration: first prompt to table. File: hooks/register.test.ts; Targets: the prompt.submit hook, the turn.complete hook and the /triage-stats command together; Key cases: two sessions sharing one store, a second first prompt after the first with a ledger that never resets, and a log at its cap

## Acceptance Criteria

- [x] `claude plugin test .` exits 0 with the new tests included, and the new recording tests fail when the `turn.complete` hook is removed.
- [x] `claude plugin validate .` exits 0.
- [x] After a rated first prompt and one main-loop turn, that session's entry holds a numeric `cost` in US dollars and a string `id`, and no other key in the store holds either.
- [x] A `turn.complete` carrying an `agentId` leaves the stored log identical to before.
- [x] A rejected or empty `$.session.usage()`, and a failed store read or write, never throw out of the hook and never change the answer text the turn shows.
- [x] `/triage-stats` prints, for every rating and class with at least one costed session, the average cost and the number of sessions behind it, and prints no cost table when no entry has a cost.
- [x] `JSON.stringify` of the store holds neither the prompt text nor the value of `$.session.id()`.
- [x] The log never holds more than 200 entries, and an update never adds an entry.
- [x] README.md states the new hook count, the new stored fields and that no prompt text is logged, and `grep -n "ten hooks" README.md` prints nothing.
- [x] `git diff --name-only main...HEAD` lists only the six files named under Files (plus docs/plans/index.html, the generated plans gallery, when it was rebuilt), and `version` in `.claude-plugin/plugin.json` is unchanged.

## Verification

Run `claude plugin test .` and `claude plugin validate .` from the repository root; both must exit 0, the same two commands CI runs on every pull request. Then check the objective in a live session with `claude --plugin-dir .` (step 10): send a first prompt, answer the dialog, let two turns finish, and run `/cost` and `/triage-stats`. The session's row in the cost table must show a cost above zero, a count of 1, and a figure no larger than `/cost` reported for the same session. Run `/clear`, send another first prompt, and run `/triage-stats` again: the new session must appear as its own entry with its own cost, not the running total. Finally run `git diff main...HEAD -- hooks/register.ts | grep -E "model\.complete|fetch|http"` and confirm no new model call or network request was added.

## Next Steps

- Record the turn count and context percent beside the cost (the data change D needs)
  Adds `turns` and `ctx` to the log entry, as section A of the proposal described, so D's thresholds can come from data. Not part of this plan.
  ```text
  In the prompt-triage repo (https://github.com/shawn-sandy/prompt-triage), after the plan docs/plans/add-session-cost-to-decision-log.md has shipped, extend the decision log entry written by hooks/register.ts with two optional numbers: `turns` (from `$.session.turns()`) and `ctx` (the context percent from `$.session.usage()`), updated in the same turn.complete hook that updates `cost`. Show the average turns and context percent per rating in /triage-stats. Write failing tests in hooks/register.test.ts first, update README.md, and do not edit `version` in .claude-plugin/plugin.json. Verify with `claude plugin test .` and `claude plugin validate .` and paste the final lines of both before reporting done.
  ```
- Give each session its own store key if lost updates show up (wish list)
  Only worth building if `/triage-stats` visibly undercounts sessions. The code comment on `log()` already names this upgrade.
  ```text
  In the prompt-triage repo, hooks/register.ts keeps the decision log as one list under the store key `decisions`, which every session rewrites without a lock. Change it to one key per session (for example `decision:<id>`), merged by /triage-stats using `$.store.keys()`, keeping the 200-entry cap by dropping the oldest keys. Write failing tests in hooks/register.test.ts first, including two sessions writing at once, and update the README Limits section. Do not edit `version` in .claude-plugin/plugin.json. Verify with `claude plugin test .` and `claude plugin validate .` before reporting done.
  ```

## Unresolved Questions

- Which identifier, if any, goes in the log
  The README promises no prompt text is logged. An opaque id the mod makes is not text and links to nothing, but it is a new kind of stored value.
  ```text
  In the prompt-triage repo, the decision log would gain a random opaque `id` per entry (made from `$.clock.now()` plus a random string) so a later turn can find the entry again. The alternatives are `$.session.id()`, which is the transcript file's name, and `startedAt` from `$.session.usage()`. Compare the three against the README's promise that no prompt text is logged and against what each would let someone infer from the store, recommend one, and say what the README should add.
  ```
- Whether /triage-stats prints the cost table by default
  The plan prints it whenever at least one entry has a cost, with no flag.
  ```text
  In the prompt-triage repo, /triage-stats currently prints one table of ratings. After the cost change it would append a second table whenever any entry has a recorded cost. Decide whether that should be the default or require an argument such as `/triage-stats cost`, weighing a longer default output against one more thing to remember, and recommend one.
  ```

## Resources

- [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference), read 2026-11-08
- Generated declarations written by Claude Code 2.1.319, read from `.claude/worktrees/bundle-icon-setup-145aed/.claude-plugin/types/claude-code/index.d.ts` (`SessionUsage`, `SessionCost`, `TurnCompleteInput`, the `claude-code/testing` module)
- `docs/proposals/session-usage.md`, section A and the open questions
- `docs/plans/harden-cost-levers.md`, which built the decision log and `/triage-stats`
