---
status: in-progress
type: fix
created: 2026-11-15
artifact-url: https://claude.ai/artifact/HFfMffZ2TyTnPBRB1zKzqq
issue: https://github.com/shawn-sandy/prompt-triage/issues/67
glance: Today a switch to a cheaper model leaves Claude Code's background requests on the original model, and in measured sessions that Opus spend ($47.06) exceeded the cheaper model's ($44.05). It worked when, in a switched session, every request Claude Code built on the original model left on the picked one, compaction included, and the person's default model in settings.json stayed unchanged.
---

# Plan: Make the model switch move the whole session, background requests included

## Objective

After a person picks "Switch to X" in the prompt-triage dialog, the whole session runs on X from the first prompt on, so compaction, /recap and prompt suggestions follow the switch instead of re-caching the conversation on the original model, and the person's default model for new sessions is left alone.

## Context

The mod switches models by rewriting the model on each main-conversation request in its `turn.step` hook (`hooks/register.ts:1135-1145`). Claude Code's background requests (compaction, /recap and prompt suggestions, per its changelog) never pass through that hook, so they keep the session's original model, and because each model keeps its own prompt cache, every one of them caches the whole conversation again at that model's price. Transcript measurements from 2026-11-03 to 2026-11-15 found that 35 sessions switched to haiku or sonnet spent $47.06 on Opus against $44.05 on the model they switched to. The mod cannot see this spend: its session cost excludes "the engine's own side queries".

The fix uses `$.command.run`, which runs a slash command "as if the person typed" it, queued until the session is idle, and rejects inside a hook the turn waits on. So turn 1 keeps the current request rewrite, and a queued `/model X` makes the switch real from turn 2. Three things are unproven and decide whether this ships: which call path actually runs, whether a `/model` run this way changes the person's default model beyond the session, and whether background requests then follow. Phase Spike answers them before any code changes; a failed spike stops the plan and hands off to the fallback in Next Steps.

Risk: the Code tab model picker remembers its choice per user, so a plugin-run `/model` could change the default for new sessions. Mitigation: spike step 3 checks exactly this, and a leak is a spike failure. Desktop-only behaviour cannot be checked against this checkout (desktop sessions run the installed copy, per `CLAUDE.md`), so desktop verification of the finished change is reported as pending rather than claimed.

After the spike failed, the declarations showed a second route: the `http.fetch` hook sees every model request the engine sends ("Every model request the engine sends raises this event too"), and may rewrite its body. Background requests reach it, so the mod moves them there, by rewriting the `model` in the request body, and runs no `/model` at all. A headless probe on 2026-11-16 showed a request built for `claude-opus-5-5` and rewritten to `claude-haiku-5-5` was answered by `claude-haiku-5-5` (the transcript's assistant `model`), and that a `/compact` request rewritten the same way returned 200 and wrote its summary. The engine still prices a rewritten request at the model it built it for, so `cost-state` and `$.session.usage()` overstate it; the API bills the model that answered.

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
- Spike result (2026-11-16): FAIL, so the effort-first fallback in Next Steps replaces phases RED to VERIFY. Path (a), `$.command.run` inside `prompt.submit`, was refused by a host check: "called from a prompt.submit hook, it would wait on the turn this hook is holding; run it from a later event (turn.complete)". Path (b), from the first `turn.complete`, resolved without switching: the queued `/model haiku` ran 1 min 46 s after turn 1, printed "Kept model as `Opus 5.5`", and `$.session.model()` still read `claude-opus-5-5`; the run instructions said to choose Keep if prompted, so this reading is confounded. The `/clear` restore resolved and printed "Set model to `Opus 5.5` and saved as your default for new sessions", and `model` in `~/.claude/settings.json` went from `sonnet` to `claude-opus-5-5`: a plugin-run `/model` changes the default beyond the session, the proposal's stop condition. The mod's own `command.run` hook for `model` fired for each of its own runs, with `e.origin` `{ kind: 'plugin', name: 'spike-model-switch' }`. Step 2: no haiku `model` attachment followed turn 1, because no switch landed and the spike's state survived `/clear`, so the three-prompt run tried none; after `/compact` the Opus entry showed 634 output tokens against 23 from the three main turns, so compaction ran on Opus, and the haiku entry stayed at 41; a turn-1 baseline was not readable because each transcript holds one `cost-state` record, written at session end. Step 3: the desktop picker reading was not reported.
- Route after the spike (2026-11-16): rewrite the `model` in the body of each engine request in an `http.fetch` hook, instead of the effort-first fallback, because it removes the cause the plan targets and runs no `/model`, so nothing reaches `settings.json`. This supersedes the `/model` decisions above (turn 1 through the rewrite, queuing `/model <original>` on `/clear`, the earliest call path); the `turn.step` rewrite stays for the main loop, and `/clear` and the person's own `/model` end the rewrite by ending the override, as they already did.
- Which requests move: an engine request (`next.origin.plugin === 'engine'`) whose body names a model in the family the switch left moves to the picked model's full id, read off the main loop's first request after the switch (turn.step already moved that one). Matching by family keeps the engine's haiku helper requests where they are after a switch to sonnet. A session on haiku is never rewritten, since its helper requests share the family; those re-cache at haiku's price. A subagent on the left family moves too, inheriting or pinned; Explore keeps its haiku.
- A rewritten request answered 400 (a field the engine built for the left model that the picked one refuses) is sent again as built, so a switch never fails a request.
- The decision logic is the exported `retarget()`, tested directly: the test kit refuses `$.http.fetch` from a test's hooks ("its hooks module does not call it"), so no test can raise `http.fetch`; the hook's wiring and its 400 resend are checked live.

## Files

- hooks/register.ts (modified) — `http.fetch` hook and exported `retarget()` move background requests to the picked model; `Override` records the left model and the picked model's id
- hooks/register.test.ts (modified) — tests for `retarget()`, alone and after `decide()`
- README.md (modified) — say the switch moves the whole session, background requests included, and name its two limits

## Steps

### Phase: Spike

1. [x] Write a throwaway mod in a scratch folder outside the repo (a minimal `.claude-plugin/plugin.json`, `hooks/hooks.json` and `hooks/register.ts`) that, on the first sent prompt, queues `$.command.run({ command: 'model', args: 'haiku' })` two ways, (a) not awaited inside `prompt.submit` and (b) from the first main-thread `turn.complete`, running (b) only when (a) is refused so each switch has one cause (to test (b) on its own, start a fresh session with (a) disabled), and on `session.end` with reason `clear` queues `/model` back to the starting model, logging each call's outcome with `$.ui.log`; it also registers a `command.run` hook for `model` that logs every firing with its `e.origin`. Why: the declarations say the call is queued until idle but refused inside a hook the turn waits on, and only a live run shows which paths actually switch the model, including the `/clear` restore. Verify: `claude --plugin-dir <scratch folder>` on an Opus session prints one log line per path, including one after a `/clear`, naming whether it resolved or rejected, with the rejection message, and the `command.run` log shows whether the mod's own `/model` runs reached that hook.
2. [x] In that CLI session send three prompts, note the `cost-state` Opus entry after turn 1 as the baseline, and run `/compact` after the third so at least one background request is sure to run; then open the session's transcript under `~/.claude/projects/` and read its `model` attachments and its last `cost-state` record. Why: background requests never appear as transcript requests, only in `cost-state.modelUsage`, so that record is the only evidence they followed the switch. Also read `model` in `~/.claude/settings.json` before the session and after it ends. Verify: a `model` attachment names haiku after turn 1, the Opus entry in `modelUsage` still equals the turn-1 baseline after the `/compact`, the haiku entry grew across the `/compact`, and the settings `model` is unchanged by the plugin-run `/model`; record all three readings.
3. Not run, and superseded by the route decision: the `http.fetch` route runs no `/model`, so there is no picker default to check. In the desktop app, type `/model haiku` in a throwaway session, then start a new session and note the model its picker shows, and compare `model` in `~/.claude/settings.json` before and after. Why: desktop sessions run the installed mod, not the scratch one, so the desktop picker is checked with a typed `/model`, which the declarations say a plugin-run one behaves exactly like; step 2 covers the plugin path itself for `settings.json`. Verify: the new session's picker and the `model` key both read what they did before the `/model`.
4. [x] Record the spike result as a "Spike result" bullet in this spec's `## Decisions`: PASS when at least one call path from step 1 switches the model after turn 1 and the `/clear` restore resolves with the session model reading the starting model again (name the earliest that does, the restore's outcome, and whether the mod's own `/model` run fired its `command.run` hook for `model`, which step 6 depends on), step 2 shows background spend following it, and step 3 shows no leak; otherwise FAIL, set `status: in-progress`, stop, and run the fallback card in Next Steps. Why: the proposal locked effort-first as the fallback, and building the switch on a failed spike would ship the leak or a changed default. Verify: the bullet names PASS or FAIL, the call path that worked, whether the `command.run` hook fired for the mod's own run, and the readings from steps 2 and 3.

### Phase: RED

5. [x] Add tests in `hooks/register.test.ts` that call an exported `retarget(override, body)` with the state a switch leaves: (a) after a switch to haiku from Opus, a body naming the main loop's `claude-haiku-5-5` is sent as built and teaches the id, and a later body naming `claude-opus-5-5` comes back naming `claude-haiku-5-5` with its other fields unchanged; (b) after a switch to sonnet, a `claude-haiku-5-5` body is left alone and an Opus one moves to sonnet; (c) a later switch learns its own id; (d) `decide()` with "Switch to haiku" moves an Opus body and with "Keep" moves none; plus guards that leave a body alone before the id is known, with no switch, on a haiku session, on a model the mod cannot rank, for a body with no model name, after `dropModel()` and after `endOverride()`. Why: these pin which requests move before the hook exists. Verify: with `retarget()` a stub returning undefined, `claude plugin test .` fails on assertions in (a) to (d).
   Result: 4 failed on `AssertionError: expect(received).toBe()`, 255 passed (the guards pass against a stub by design).

### Phase: GREEN

6. [x] In `hooks/register.ts`, add `from` and `sendAs` to `Override` (set by `decide()` on a pick, cleared by `dropModel()`), implement `retarget()`, and add an `http.fetch` hook that passes non-engine requests through, sends the rewritten body when `retarget()` returns one, and resends the original body when the rewritten one is answered 400. Why: this moves background requests without running `/model`. Verify: `claude plugin test .` exits 0.
   Result: 259 pass, 0 fail.

### Phase: VERIFY

7. [x] Update the README paragraph that started "The switch applies to the main conversation's requests" to say the switch moves the whole session, background requests included, how, and its two limits. Why: the README described the request-only switch. Verify: `grep -n "background requests" README.md` prints the new paragraph.
8. Run `claude plugin test .`, `claude plugin validate .` and `npx --yes -p typescript@5.9 tsc --noEmit -p .`. Why: a green suite over code that fails validation or the typecheck is not verified. Verify: all three exit 0.
   Result: test 259 pass, 0 fail; validate "Validation passed with warnings", exit 0; tsc fails with TS5097 on `hooks/register.test.ts` line 2 (an import path ending in `.ts` needs `allowImportingTsExtensions`). The same error appears at HEAD (16b91c1) with the same generated types, so it predates this plan; it stays open as a blocker.
9. [x] Drive a real session with `expect`: `claude --model opus --plugin-dir <logger above> --plugin-dir . --plugin-dir <logger below>` from a clean environment, a simple first prompt, "Switch to haiku", two more prompts, `/compact`, `/clear`. The two loggers are throwaway mods whose `http.fetch` hooks record each engine request's body model and status, one loaded before this checkout and one after (the debug log shows the chain as `wire-above, prompt-triage, wire-below`). Why: the test kit cannot raise `http.fetch`, so only a live session shows background requests moving. Verify: every request the outer logger saw on Opus after the switch, the inner logger saw on haiku with status 200; the transcript's assistant turns name haiku; `model` in `~/.claude/settings.json` is unchanged.
   Result (2026-11-16, session 0506ed70): the outer logger saw three requests on `claude-opus-5-5` (18:26:44 with 8 messages, the `/compact` at 18:27:14 with 8, and one at 18:27:17 with 1) and the inner logger saw the same three on `claude-haiku-5-5`, all status 200; the transcript's three assistant turns name `claude-haiku-5-5`, and its `compact_boundary` is `manual`; `model` in settings.json read `sonnet` before and after. `cost-state` still lists `claude-opus-5-5` at $0.0735, the engine pricing those three moved requests at Opus rates. Desktop verification stays pending until a release is installed.

## Tests

Tier 1 — This plan changes application code
- Objective: a switch moves background requests to the picked model. File: hooks/register.test.ts; Type: unit; Asserts: after `decide()` with "Switch to haiku" and the main loop's haiku request, `retarget()` turns a `claude-opus-5-5` body into a `claude-haiku-5-5` one with its other fields unchanged; Run: claude plugin test .
- Unit: only the left model's family moves. File: hooks/register.test.ts; Targets: `retarget()` in hooks/register.ts; Key cases: a haiku helper body after a switch to sonnet is left alone, a haiku session switched up is never rewritten, a model the mod cannot rank is never rewritten
- Unit: nothing moves without a switch. File: hooks/register.test.ts; Targets: `retarget()` and `decide()`; Key cases: "Keep" moves nothing, no override moves nothing, a body before the picked id is known is sent as built
- Unit: malformed bodies pass through. File: hooks/register.test.ts; Targets: `retarget()`; Key cases: text that is not JSON, JSON with no model, a numeric model, an undefined body, a base64 body
- Unit: the rewrite ends with the override. File: hooks/register.test.ts; Targets: `retarget()` after `dropModel()` and `endOverride()`; Key cases: the person's own /model, a /clear, a later switch learning its own id

## Acceptance Criteria

- [x] `## Decisions` holds a "Spike result" bullet naming the outcome, the call paths tried, and the readings from spike steps 1 and 2, and a "Route after the spike" bullet naming the approach taken instead.
- [x] `claude plugin test .` exits 0 with the new `retarget()` tests included.
- [x] `claude plugin validate .` exits 0.
- [ ] `npx --yes -p typescript@5.9 tsc --noEmit -p .` exits 0. Blocked: TS5097 on `hooks/register.test.ts` line 2 fails at HEAD too, before this plan.
- [x] In a live `claude --plugin-dir .` session on Opus switched to haiku, every engine request built on Opus after the switch, `/compact` included, leaves on `claude-haiku-5-5` with status 200, and every main turn is answered by `claude-haiku-5-5`.
- [x] The switch leaves `model` in `~/.claude/settings.json` unchanged, since the mod runs no `/model`.
- [x] After `/clear` the session runs on the model it started with: the override ends, so `retarget()` moves nothing and the session model was never changed.
- [x] README says the switch moves the whole session, background requests included, and names its limits.

## Verification

Start `claude --plugin-dir .` in this checkout on an Opus session, with a throwaway mod loaded before it and one after it that each log the body `model` and status of every engine request in an `http.fetch` hook. Send a prompt the mod rates simple, pick "Switch to haiku", send two more prompts, then run `/compact`. Every request the outer logger sees on Opus after the switch, the inner logger sees on haiku with status 200; the transcript's assistant turns name haiku; `model` in `~/.claude/settings.json` reads what it did before. `claude plugin test .` exits 0. `cost-state` keeps pricing moved requests at the session model's rate, so it is not the measure. Desktop behaviour cannot be checked from this checkout and stays pending until a release is installed.

## Next Steps

- Measure the fix after release
  Compare Opus side spend in switched sessions before and after the release. Read it from the API's answers, not `cost-state`, which prices moved requests at the session model's rate.
  ```text
  Run `python3 ~/.claude/scripts/token_cost_report.py --days 21` and, for prompt-triage sessions whose first main-thread request ran a model other than the session's `model` attachment, compare Opus cost and Opus cache writes per session for sessions started before and after the release that shipped the session-wide switch. Report the two medians with session counts, and say plainly if there are too few post-release sessions to compare. Done when the comparison table is printed from an actual run.
  ```
- Say in /triage-stats that its cost prices moved background requests at the session model's rate
  The engine prices a request the mod moved at the model it built it for, so the averages it prints overstate switched sessions.
  ```text
  In the prompt-triage repo, add one line to the /triage-stats output and to the README decision-log section saying the cost figures price Claude Code's background requests (compaction, /recap, prompt suggestions) at the session model's rate even after a switch moved them. Add a test in hooks/register.test.ts that the /triage-stats output includes that note, without asserting its exact wording. Done when `claude plugin test .` exits 0.
  ```

## Unresolved Questions

- Fix the pre-existing TS5097 typecheck error (an `allowImportingTsExtensions` setting in `tsconfig.json`, or a different test import), so step 8's typecheck can pass? It fails at HEAD and is outside this plan's files.

## Resources

- Proposal: `docs/prompts/proposal-make-model-switch-session-wide.md` — the measurements, the options weighed and the locked fallback.
- Mod type declarations: `.claude-plugin/types/claude-code/index.d.ts` (written by an interactive `claude --plugin-dir .` run) — the `$.command.run`, `$.session.model()` and `SessionCost` contracts this plan relies on.
- Claude Code changelog: `~/.claude/cache/changelog.md` line 4562 — names compaction, /recap and prompt suggestions as background requests that use the main conversation's prompt cache.
