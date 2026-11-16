---
status: in-progress
type: fix
created: 2026-11-15
artifact-url: https://claude.ai/artifact/HFfMffZ2TyTnPBRB1zKzqq
issue: https://github.com/shawn-sandy/prompt-triage/issues/67
glance: Today a switch to a cheaper model leaves Claude Code's background requests on the original model, and in measured sessions that Opus spend ($47.06) exceeded the cheaper model's ($44.05). We will know it worked when a switched session's transcript shows the new model from the second prompt and its cost record stops adding original-model spend after turn 1.
---

# Plan: Make the model switch move the whole session, background requests included

## Objective

After a person picks "Switch to X" in the prompt-triage dialog, the session itself runs on X from the second prompt on, so compaction, /recap and prompt suggestions follow the switch instead of re-caching the conversation on the original model.

## Context

The mod switches models by rewriting the model on each main-conversation request in its `turn.step` hook (`hooks/register.ts:1135-1145`). Claude Code's background requests (compaction, /recap and prompt suggestions, per its changelog) never pass through that hook, so they keep the session's original model, and because each model keeps its own prompt cache, every one of them caches the whole conversation again at that model's price. Transcript measurements from 2026-11-03 to 2026-11-15 found that 35 sessions switched to haiku or sonnet spent $47.06 on Opus against $44.05 on the model they switched to. The mod cannot see this spend: its session cost excludes "the engine's own side queries".

The fix uses `$.command.run`, which runs a slash command "as if the person typed" it, queued until the session is idle, and rejects inside a hook the turn waits on. So turn 1 keeps the current request rewrite, and a queued `/model X` makes the switch real from turn 2. Three things are unproven and decide whether this ships: which call path actually runs, whether a `/model` run this way changes the person's default model beyond the session, and whether background requests then follow. Phase Spike answers them before any code changes; a failed spike stops the plan and hands off to the fallback in Next Steps.

Risk: the Code tab model picker remembers its choice per user, so a plugin-run `/model` could change the default for new sessions. Mitigation: spike step 3 checks exactly this, and a leak is a spike failure. Desktop-only behaviour cannot be checked against this checkout (desktop sessions run the installed copy, per `CLAUDE.md`), so desktop verification of the finished change is reported as pending rather than claimed.

Source proposal: `docs/prompts/proposal-make-model-switch-session-wide.md`.

## Decisions

- Real session switch, chosen in the 2026-11-15 proposal review over leading with lower effort and over documenting only, because it removes the cause.
- Turn 1 keeps the `turn.step` rewrite: `$.command.run` cannot run inside the hook the first prompt waits on.
- The plan is red-green-verify with a Spike phase first: the spike's answers pick the call path the RED tests encode, and a failure ends the plan before any source change.
- No SHIP phase: committing and opening a PR were not requested.
- The effort-first fallback lives in Next Steps, not in Steps, so a passing spike never leaves dead conditional steps behind.
- Explore-to-haiku after a switch up (`agent.spawn`, `register.ts:1150`) and the effort overrides are unchanged.
- `/clear` restores the session's original model by queuing `/model <original>`, chosen in the 2026-11-15 interview so the next conversation starts where it did before the switch, as `endOverride()` makes it do today.
- When more than one call path works in the spike, the plan uses the earliest one, chosen in the 2026-11-15 interview because fewer background requests then run on the original model.

## Files

- hooks/register.ts (modified) — queue the real `/model` after a switch, drop the request rewrite once the session model matches, keep it when the run is refused, restore the starting model on `/clear`
- hooks/register.test.ts (modified) — engine mock records command args and applies `/model`; new tests for the queued switch
- README.md (modified) — say the switch covers the whole session from the second prompt

## Steps

### Phase: Spike

1. Write a throwaway mod in a scratch folder outside the repo (a minimal `.claude-plugin/plugin.json`, `hooks/hooks.json` and `hooks/register.ts`) that, on the first sent prompt, queues `$.command.run({ command: 'model', args: 'haiku' })` two ways, (a) not awaited inside `prompt.submit` and (b) from the first main-thread `turn.complete`, running (b) only when (a) is refused so each switch has one cause (to test (b) on its own, start a fresh session with (a) disabled), and on `session.end` with reason `clear` queues `/model` back to the starting model, logging each call's outcome with `$.ui.log`; it also registers a `command.run` hook for `model` that logs every firing with its `e.origin`. Why: the declarations say the call is queued until idle but refused inside a hook the turn waits on, and only a live run shows which paths actually switch the model, including the `/clear` restore. Verify: `claude --plugin-dir <scratch folder>` on an Opus session prints one log line per path, including one after a `/clear`, naming whether it resolved or rejected, with the rejection message, and the `command.run` log shows whether the mod's own `/model` runs reached that hook.
2. In that CLI session send three prompts, note the `cost-state` Opus entry after turn 1 as the baseline, and run `/compact` after the third so at least one background request is sure to run; then open the session's transcript under `~/.claude/projects/` and read its `model` attachments and its last `cost-state` record. Why: background requests never appear as transcript requests, only in `cost-state.modelUsage`, so that record is the only evidence they followed the switch. Also read `model` in `~/.claude/settings.json` before the session and after it ends. Verify: a `model` attachment names haiku after turn 1, the Opus entry in `modelUsage` still equals the turn-1 baseline after the `/compact`, the haiku entry grew across the `/compact`, and the settings `model` is unchanged by the plugin-run `/model`; record all three readings.
3. In the desktop app, type `/model haiku` in a throwaway session, then start a new session and note the model its picker shows, and compare `model` in `~/.claude/settings.json` before and after. Why: desktop sessions run the installed mod, not the scratch one, so the desktop picker is checked with a typed `/model`, which the declarations say a plugin-run one behaves exactly like; step 2 covers the plugin path itself for `settings.json`. Verify: the new session's picker and the `model` key both read what they did before the `/model`.
4. Record the spike result as a "Spike result" bullet in this spec's `## Decisions`: PASS when at least one call path from step 1 switches the model after turn 1 and the `/clear` restore resolves with the session model reading the starting model again (name the earliest that does, the restore's outcome, and whether the mod's own `/model` run fired its `command.run` hook for `model`, which step 6 depends on), step 2 shows background spend following it, and step 3 shows no leak; otherwise FAIL, set `status: in-progress`, stop, and run the fallback card in Next Steps. Why: the proposal locked effort-first as the fallback, and building the switch on a failed spike would ship the leak or a changed default. Verify: the bullet names PASS or FAIL, the call path that worked, whether the `command.run` hook fired for the mod's own run, and the readings from steps 2 and 3.

### Phase: RED

5. Extend the engine mock in `hooks/register.test.ts` so its `command.run` handler records each command with its args and, for `model`, sets the value `session.model` returns; then add tests that (a) after "Switch to haiku" and a finished first turn the mod runs `model` with args `haiku` through the path step 4 recorded, (b) once the session model reads the pick, later `turn.step` calls go through with no model rewrite and the status line drops its "running X, not Y" part, (c) with `commandFails` set the rewrite stays on every later step, (d) a "Keep" answer runs no `model` command, (e) a `/clear` after a real switch runs `model` with the session's starting model as args, but runs none when the person ran their own `/model` after the switch, and (f) after a real switch up to opus and the rewrite dropped, a built-in Explore spawn still gets haiku. Why: these pin the behaviour the objective needs before any source changes. Verify: `claude plugin test .` exits non-zero, and the new tests fail on their assertions (no `model` command recorded), not on a harness error; paste the output.

### Phase: GREEN

6. In `hooks/register.ts`, after `decide()` sets a picked model, queue `$.command.run({ command: 'model', args: <pick> })` through the call path from step 4, and when the spike showed the mod's own `command.run` hook for `model` (`register.ts:1159`) fires for the mod's own run, make that hook ignore runs whose `e.origin` is this plugin. Why: this is the switch itself, and the person's-own-/model hook would otherwise end the override the mod just made. Verify: `claude plugin test .` re-run after each edit; tests (a) and (d) pass.
7. When the queued run resolves and `$.session.model()` names the pick, call `dropModel(override)` and refresh the status line; when it rejects, leave the override in place; keep the Explore-to-haiku rule working once `override.model` is cleared, by having `agent.spawn` (`register.ts:1150`) read the switched-to model from a field `dropModel` does not clear when the drop is the mod's own; rewrite the comment at `register.ts:1135` to say the rewrite covers turn 1 only. Why: once the session model is right the rewrite is redundant, and a refused run must not undo a switch the person chose. Verify: `claude plugin test .` re-run; tests (b), (c) and (f) pass.
8. In the `session.end` hook (`register.ts:1098`), when the reason is `clear` and the mod's switch still owns the session model (the person has not run their own `/model` since, which already clears it at `register.ts:1159`), queue `/model <starting model>` through the path the spike showed works there, next to the existing `endOverride()` call. Why: today `/clear` ends the override so the next conversation starts on the original model, and a real switch would otherwise outlive the conversation that chose it. Verify: `claude plugin test .` exits 0 with test (e) passing; if tests still fail after 8 iterations of steps 6 to 8, stop and report the failing assertion, the last diff tried and what was ruled out, and do not report success.

### Phase: VERIFY

9. Update the README paragraph that starts "The switch applies to the main conversation's requests" to say the switch moves the whole session from the second prompt, background requests included, and that turn 1 runs through the request rewrite. Why: the README currently describes the request-only switch this plan replaces. Verify: `grep -n "second prompt" README.md` prints the updated paragraph.
10. Run `claude plugin test .`, `claude plugin validate .` and `npx --yes -p typescript@5.9 tsc --noEmit -p .`, one after another. Why: a green suite over code that fails validation or the typecheck is not verified. Verify: all three exit 0; paste the summary lines.
11. Repeat step 2 with `claude --plugin-dir .` against this checkout: an Opus session, a first prompt rated simple, "Switch to haiku", two more prompts, then `/clear`. Why: this exercises the real engine, not the mock. Verify: the transcript shows a haiku `model` attachment after turn 1, the `cost-state` Opus entry does not grow after turn 1, and after `/clear` the session model reads Opus again; record desktop verification as pending.

## Tests

Tier 1 — This plan changes application code
- Objective: a switch moves the session itself after turn 1. File: hooks/register.test.ts; Type: mock; Asserts: after "Switch to haiku" and a finished first turn the mod runs `/model haiku`, and later main-loop steps run on the session model with no rewrite; Run: claude plugin test .
- Unit: refused switch keeps the rewrite. File: hooks/register.test.ts; Targets: the queued `/model` handling in hooks/register.ts; Key cases: `commandFails` set, every later step still rewritten to the pick
- Unit: no switch, no command. File: hooks/register.test.ts; Targets: the same handling; Key cases: a "Keep" answer runs no `model` command, a dismissed dialog runs none
- Unit: /clear restores the starting model. File: hooks/register.test.ts; Targets: the `session.end` hook in hooks/register.ts; Key cases: `/clear` after a real switch runs `model` with the starting model, `/clear` with no switch runs no `model` command, `/clear` after the person's own `/model` runs none
- Unit: Explore stays on haiku after a real switch up. File: hooks/register.test.ts; Targets: the `agent.spawn` hook in hooks/register.ts; Key cases: switch to opus, rewrite dropped, built-in Explore spawn gets haiku

## Acceptance Criteria

- [ ] `## Decisions` holds a "Spike result" bullet naming PASS, the working call path, and the readings from spike steps 2 and 3.
- [ ] `claude plugin test .` exits 0 with the six new tests included.
- [ ] After a real switch, `/clear` puts the session back on the model it started with.
- [ ] `claude plugin validate .` and `npx --yes -p typescript@5.9 tsc --noEmit -p .` both exit 0.
- [ ] In a `claude --plugin-dir .` session on Opus that switches to haiku, the transcript shows a haiku `model` attachment after turn 1 and `cost-state` Opus usage does not grow after turn 1.
- [ ] A `/model` run the way the mod runs it leaves a new session's picker and `model` in `~/.claude/settings.json` unchanged.
- [ ] README says the switch moves the whole session from the second prompt.

## Verification

Start `claude --plugin-dir .` in this checkout on an Opus session and send a prompt the mod rates simple, such as "what does `rank()` return for mythos". Pick "Switch to haiku", then send two more prompts. Open the session's transcript under `~/.claude/projects/`: a `model` attachment naming haiku appears after the first turn, and the final `cost-state` record's Opus entry equals what the first turn spent, with all later spend under haiku. Then start a fresh session and confirm its model is the one you started with. `claude plugin test .` exits 0. Desktop behaviour cannot be checked from this checkout and stays pending until a release is installed.

## Next Steps

- Fallback if the spike fails: lead the dialog with lower effort
  The proposal's locked fallback. Run it only when spike step 4 recorded FAIL.
  ```text
  In the prompt-triage repo (hooks/register.ts, hooks/register.test.ts, README.md), change the model dialog so "Keep model, effort low" (LOW_EFFORT) is offered first for simple and moderate ratings, with any "Switch to" option after it. Today choose() offers LOW_EFFORT only for simple prompts whose model does not fit (register.ts:569). Ask the user whether "lower effort" should mean low or medium for moderate prompts before coding. Write failing tests in hooks/register.test.ts for the new option order first, then make them pass, and update the README's Effort section. Done when `claude plugin test .`, `claude plugin validate .` and `npx --yes -p typescript@5.9 tsc --noEmit -p .` all exit 0.
  ```
- Measure the fix after release
  Compare Opus side spend in switched sessions before and after the release.
  ```text
  Run `python3 ~/.claude/scripts/token_cost_report.py --days 21` and, for prompt-triage sessions whose first main-thread request ran a model other than the session's `model` attachment, compare Opus cost and Opus cache writes per session for sessions started before and after the release that shipped the session-wide switch. Report the two medians with session counts, and say plainly if there are too few post-release sessions to compare. Done when the comparison table is printed from an actual run.
  ```
- Say in /triage-stats that its cost excludes Claude Code's side queries
  The mod's session cost leaves out background requests, so the averages it prints understate switched sessions.
  ```text
  In the prompt-triage repo, add one line to the /triage-stats output and to the README decision-log section saying the cost figures exclude Claude Code's own background requests (compaction, /recap, prompt suggestions). Add a test in hooks/register.test.ts that the /triage-stats output includes that note, without asserting its exact wording. Done when `claude plugin test .` exits 0.
  ```

## Unresolved Questions

- Should the dialog tell the person that a switch takes full effect from their second prompt?
- In the fallback, should "lower effort" for moderate prompts mean low or medium?

## Resources

- Proposal: `docs/prompts/proposal-make-model-switch-session-wide.md` — the measurements, the options weighed and the locked fallback.
- Mod type declarations: `.claude-plugin/types/claude-code/index.d.ts` (written by an interactive `claude --plugin-dir .` run) — the `$.command.run`, `$.session.model()` and `SessionCost` contracts this plan relies on.
- Claude Code changelog: `~/.claude/cache/changelog.md` line 4562 — names compaction, /recap and prompt suggestions as background requests that use the main conversation's prompt cache.
