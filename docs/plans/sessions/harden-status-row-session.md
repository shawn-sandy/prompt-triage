---
session-id: "8ffc597a-0e16-41a5-8da8-4af2e18c46eb"
date: 2026-11-11
source: "8ffc597a-0e16-41a5-8da8-4af2e18c46eb.jsonl"
type: session-export
title: "Status row Clear/Compact hardening"
eng-artifact-url: https://claude.ai/artifact/JxgJ2Mhbbadwt4etYHjKV6
team-artifact-url: https://claude.ai/artifact/UFBvXLiQv1Ss3Cfm1DKiHT
---

# Status row Clear/Compact hardening

## At a glance

- Changes: 2 commits (`bdef91f`, `d9fe915`) on `claude/prompt-triage-status-row-1492b1`, pushed.
- Files: 3 (`hooks/register.ts`, `hooks/register.test.ts`, `README.md`).
- Decisions: 6. Open items: 5.

The session reviewed the status-row branch (session cost, prompt count, context %, and a Clear or Compact button in the `AbovePrompt` band), then fixed what the review found. That covered a double-press guard, the README hook count, a prompt count that dropped after compaction, a too-loose dialog-answer match, redraws on `precompute`, and tests locked to exact wording. There are now 179 tests passing, and `claude plugin validate .` is green.

## Architecture and code paths

Start in `hooks/register.ts`.

- `ui.render` (`AbovePrompt`) reads `$.session.turns()` and adds `compacted` to get `prompts`. When `prompts > 0` it also reads `$.session.usage()`, then builds the `status` Box (`key: 'status'`, `justifyContent: 'flex-end'`). The button (`key: 'tidy'`) is drawn only when `percent >= CLEAR_AT` (25). Its label is `Compact` from `COMPACT_AT` (60).
- `onPress` returns early if `tidying` is set. Otherwise it sets `tidying = true` and schedules `tidy($, percent)` with `$.clock.after(0, ...)`. The `.finally` clears `tidying` and redraws. The timer exists because the dialog and the command both outlast a press's 10 s budget.
- `tidy()` calls `$.ui.ask` with `[`${first} (recommended)`, other]`. Only an answer whose `options.indexOf(answer) >= 0` runs `$.command.run({ command: 'clear' | 'compact' })`. `command.run` is queued until the session is idle, as its declaration says.
- `session.compact` skips subagents and `trigger === 'precompute'`. Otherwise it reads `turns()` before and after `next(e)` and adds the drop to `compacted`, then invalidates `ui.render`.
- `session.end` resets `compacted = 0` along with `tracked` and `cleared`, then redraws.
- `turn.complete` redraws for main-loop turns. Its decision-log delta (`turns() - turns0`) still drops negative values rather than using `compacted`.

## Decisions

- **Guard the button with a closure flag set in `onPress`, not inside `tidy()`.** The flag is set synchronously, so a second press made before the timer fires is dropped. Setting it inside `tidy()` would race two timers.
- **Match dialog answers against the `options` array exactly.** Before this, typing `Clear (recommended)` under a Compact recommendation ran `/clear`, which contradicted the JSDoc. A wrong guess here loses or rewrites the conversation, so free text that is not an exact option runs nothing.
- **Count compacted prompts as an offset (`compacted += before - after`), not as a running max.** A max would freeze the count at the pre-compaction peak until new turns exceeded it. The offset keeps counting from where the session was.
- **Skip `precompute` in `session.compact`.** It compacts nothing yet, so redrawing on it was wasted and counting on it would be wrong.
- **Assert figures in tests, not wording.** This follows the user's global rule against assertions locked to exact wording. The regexes match `$0.42`, `3 prompts` and `30% context`, and option order and recommendation by prefix.
- **Rejected a review finding: "Clear/Compact runs mid-turn".** `$.command.run` is documented as "queued and run once the session is idle", so the README claim stands.

## Tradeoffs and rejected options

- **Deferred: read the live percent in `tidy()`.** The dialog uses the percent from the last draw. If the fill moves between draw and press, only the dialog text and the recommendation can be stale, never which command runs.
- **Deferred: run `turns()` and `usage()` together with `Promise.all`.** Each band render reads them one after the other. The cost is small and has not been measured.
- **Deferred: fix the status row's position.** The row sits above Run in when the pickers are hidden and below the refine rows when they show. That is a design call, not a bug.
- **Deferred: replace the fixed `CLEAR_AT`/`COMPACT_AT` percents.** They are percents of the full window, and the engine may auto-compact against a smaller one. The upgrade path is to read that window from `usage({ breakdown })`. A `ponytail:` comment marks this.

## Learnings

- **`session.compact` fires before the compaction happens.** The `SessionCompactInput` docs say "about to run", so figures are read only after `await next(e)`.
- **`$.session.turns()` counts user turns that are still in the transcript**, not prompts sent. That is why compaction made the count drop.
- **`sed -i` without `''` fails on macOS** with `invalid command code R`. The session switched to `perl -pi` and then to Python for multi-line edits.
- **Prettier flags `hooks/register.ts` on `main` too.** Formatting the touched files would have reformatted unrelated code, so it was skipped.
- **A commit (`52f930e`, which moved the Clear threshold to 25%) landed from elsewhere mid-session.** Re-read the branch before editing.

## Tests and verification

- **New regression tests**, each confirmed failing before its fix:
  - A double press asks once and runs once.
  - A non-option typed label runs nothing.
  - A compaction keeps the prompt count (20, then 21), and `/clear` resets it.
  - A `precompute` pass does not redraw.
- **Loosened tests:** the status-row wording assertions and the option-label assertions.
- **Verified with `claude plugin test .`** (179 pass) and `claude plugin validate .` (passed with warnings).
- **Not verified:**
  - No typecheck ran, because `tsc` is not installed.
  - Nothing was tested in a live session, including the assumption that `turns()` drops after a real compaction and the terminal focus behaviour when the button label flips.

## Review follow-ups and tech debt

- The `tidy()` percent can be stale between draw and press.
- `turns()` and `usage()` are read one after the other on every band render.
- The status row's position shifts relative to Run in.
- The `CLEAR_AT`/`COMPACT_AT` constants ignore the engine's auto-compact window (`ponytail:` comment).
- `turn.complete`'s decision-log turn delta does not use the `compacted` offset, so after a compaction it is dropped rather than corrected.

## Files touched

- `hooks/register.ts`:
  - `tidying` guard.
  - Exact option match in `tidy()`.
  - `compacted` offset, applied in `ui.render` and reset in `session.end`.
  - `session.compact` skips `precompute` and counts the drop.
- `hooks/register.test.ts`:
  - `onCompact` setup hook.
  - Four regression tests.
  - Wording assertions loosened.
- `README.md`: the hook count changed from twelve to thirteen in two places.
