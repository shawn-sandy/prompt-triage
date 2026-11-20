# Proposal: split `hooks/register.ts` into modules

Status: proposal only, nothing implemented. Written 2026-11-18 against `main` at 60155b7
(version 0.9.0). Baseline before writing: `claude plugin test .` passed, 275 tests, 0 failed, exit 0.

## Summary

`hooks/register.ts` is 1280 lines and holds the whole mod: model rating, the model dialog, the
refine pipeline, the decision log and `/triage-stats`, prompt counting, the model/effort override,
and 16 hooks inside one `register()` closure that shares 13 `let` variables. `hooks/register.test.ts`
is 3053 lines against it.

Recommendation: do option A (extract engine-free leaves into `hooks/lib/`), gated by a one-change
spike that proves the mod loader follows relative imports. Do B only after A, and only if the
`register()` closure is still the part that hurts. Skip the rest for now.

## What is in the file today

Line numbers are for `hooks/register.ts` at 60155b7.

| Concern | Lines | Parts |
| --- | --- | --- |
| Ratings, tiers | 3-25, 57-63 | `SUGGEST`, `Rating`, `FLOOR`, `LEVELS`, `STRONG`, `STEP_DOWN`, `ALIASES`, `RANK`, `rank`, `familyOf`, `COUNT`, `SIZE` |
| Dialog labels | 65-74 | `keep`, `switchTo`, `LOW_EFFORT`, `NEW_SESSION`, `REFINE`, `HANDOFF` |
| Rater | 204-252 | `RATER`, `parseRating`, `rate` |
| Refine pipeline | 76-139, 176-202, 254-425 | `REVIEWER`, `PICKERS`, `loadPicks`, `reviewer`, `shows`, `PATH`, `review`, `interview`, `rework`, `fillBox`, `improve`, `refineDraft`, `asMarkdown`, `asLine` |
| Context tidy | 140-174 | `CLEAR_AT`, `COMPACT_AT`, `WINDOW_CAP`, `weight`, `tidy` |
| Decision log and stats | 26-56, 427-553 | `LOG`, `LOG_CAP`, `Decision`, `Spend`, `Tracked`, `decisions`, `log`, `record`, `amend`, `direction`, `KINDS`, `kind`, `usd`, `tally`, `isoDate` |
| Model dialog | 555-625 | `chosen`, `pickedModel`, `choose` |
| Prompt counting | 627-699 | `DELIVERED`, `isSent`, `readPrompts`, `Count`, `duration`, `seedCount`, `countSent`, `endCount` |
| Override | 701-813 | `Override`, `overrideLine`, `onModel`, `decide`, `stepEffort`, `dropModel`, `dropEffort`, `endOverride`, `retarget` |
| `register()` | 815-1280 | `ui.render` AbovePrompt 843-1029 (186 lines), `prompt.submit` 1081-1153, 14 smaller hooks |

Observations that drive the options:

- Most of the file is already plain functions that take `$` or plain data. Only `register()` holds
  state. The seams exist; they are just not files yet.
- Coupling is through constants, not logic. `kind()` (line 487) reads `NEW_SESSION` and `LOW_EFFORT`
  from the dialog; `decide()` (729) reads `switchTo`, `keep`, `LOW_EFFORT`, `FLOOR` and `pickedModel`;
  `chosen()` (560) reads the labels. A naive split by concern creates import cycles unless the labels
  and `Rating` live in one shared leaf.
- `register()` closes over 13 variables: `tidying`, `count`, `override`, `improved`, `handOff`,
  `picks`, `sends`, `shown`, `busy`, `result`, `tracked`, `ran`, `cleared`. The render hook and the
  submit hook both write several (`result`, `improved`, `handOff`, `sends`, `picks`).
- External consumers import only `REVIEWER`, `RATER`, `parseRating` (the two eval scripts) and
  `REVIEWER`, `decide`, `dropModel`, `endOverride`, `retarget` (the test file). Everything else is
  reached through `register()`, so moving internals does not break the tests' imports.
- Hook registration order matters: hooks chain through `next`, and the `prompt.submit` and
  `turn.step` bodies depend on state set by earlier hooks. Any split must keep the order of `on(...)` calls.

## Constraints that apply to every option

1. Unverified: whether Claude Code's mod loader follows relative imports from `register.ts`. The test
   runner does (the test file imports `./register`, and `claude plugin test .` passed), and Node does
   (the eval scripts import `register.ts`). The real loader is not confirmed, and `.claude-plugin/types/`
   is absent in a fresh worktree, so the declarations could not be read. `hooks.json` is
   `{ "modules": ["./register.ts"] }`, an array, so several entries may be an alternative. Must be
   checked with `claude --plugin-dir .` before any file is split for real.
2. `bump-version.yml` releases only when a push to main changes `hooks/register.ts`, `hooks/hooks.json`
   or the workflow file. Code moved into `hooks/lib/**` would stop triggering releases until that path
   filter is extended. This is a silent failure, not a loud one.
3. Behavior must stay unchanged: the proof is `claude plugin test .` (275 tests), `claude plugin
   validate .`, and the two evals still importing their symbols. `register.ts` should keep
   re-exporting `REVIEWER`, `RATER`, `parseRating`, `decide`, `dropModel`, `endOverride`, `retarget`,
   `Override` so no consumer changes in the same step.
4. Not provable by the existing checks: desktop-only `ui.render` output. Any change touching lines
   843-1029 needs visual verification in a real session, which is still pending.
5. `CLAUDE.md` says the entry point is `hooks/register.ts`, and the README files table (line 581)
   describes `hooks/`. Both need one line each when files are added.

## Options, ranked

### 1. Option A: extract engine-free leaves into `hooks/lib/`

What it changes. Move pure data and functions out; `register.ts` imports them and re-exports the
public names. Suggested files, each a mostly verbatim cut:

- `lib/models.ts`: ratings and tiers (lines 3-25, 57-63) plus the dialog labels (65-74). The shared
  leaf every other file imports, which is what prevents cycles.
- `lib/override.ts`: 701-813. `Override`, `decide`, `stepEffort`, `dropModel`, `dropEffort`,
  `endOverride`, `retarget`. Already exported and tested directly.
- `lib/stats.ts`: `Decision`, `Spend`, `Tracked`, `direction`, `kind`, `usd`, `tally`, `isoDate`
  (the pure half of 26-56 and 479-553). The store-touching `decisions`, `log`, `record`, `amend`
  (427-477) go in `lib/decision-log.ts`.
- `lib/count.ts`: 627-699, prompt counting and `isSent`.
- `lib/pickers.ts`: `PICKERS`, `loadPicks`, `reviewer`, `shows`, `REVIEWER` (76-139, 176-202).
- Later, `lib/refine.ts` (254-425) and `lib/rate.ts` (204-252) and `lib/dialog.ts` (555-625).

Tradeoffs.
- Pro: lowest risk of any option. These are pure moves with no state, covered by 275 tests that go
  through `register()`. Each file gets a reviewable size, and a rating, stats or override change
  stops touching a 1280-line file.
- Pro: reversible per file, so it can stop at any phase.
- Con: `register.ts` stays about the hardest part, since the closure and the 186-line render hook do
  not move. Expect it to shrink by roughly the lines in the table above, not to become small.
- Con: needs constraint 1 settled, and the workflow path filter (constraint 2) extended.
- Con: `lib/models.ts` becomes a hub; keep it free of imports from the other lib files.

Fit to the file: touches every row of the table except the `register()` body.

### 2. Option B: split `register()` into per-feature registrars over one state object

What it changes. Replace the 13 closure `let`s with one typed `State` object created at the top of
`register()`, then call feature registrars in the current order:
`registerBand(on, state, options)` (ui.render, prompt.edit, prompt.change, lines 843-1047),
`registerCommands` (1049-1079), `registerSubmit` (1081-1153), `registerTracking` (turn.complete,
session.end, session.measure, session.compact, 1155-1230), `registerOverrideHooks` (http.fetch,
turn.step, agent.spawn, model, effort, 1232-1279).

Tradeoffs.
- Pro: the only option that shrinks `register()` itself and makes the render hook (186 lines of
  nested closures over `result`, `busy`, `picks`, `tidying`) separately readable.
- Pro: the `State` type documents which hook writes what, which is currently implicit.
- Con: real risk. `state.x` for `x` changes nothing in behavior only if every closure keeps reading
  the live value, and registration order must stay identical. Stale-capture bugs (reading a value
  into a `const` that the closure used to read live) are easy to introduce and hard to see.
- Con: the render hook's output cannot be verified by the test suite on the desktop surface
  (constraint 4).
- Con: needs A first, or the new files import a 1280-line module back.

Fit to the file: lines 815-1280 only. Alternative mechanism if constraint 1 allows it: separate
entries in `hooks.json` `modules`, one per feature. That loses the shared closure, so it only fits
features with no shared state, and chain order across modules is unconfirmed. Not recommended.

### 3. Option C: split the test file along the same seams

What it changes. `hooks/register.test.ts` (3053 lines, 225 `test(` blocks, 275 reported) shares one
`Setup` harness (header, lines 1-292). Move the harness into `hooks/testing/harness.ts` and group
tests into files per feature (rating and dialog, refine band, stats, override and retarget, counting).

Tradeoffs.
- Pro: the test file is as hard to navigate as the source; this follows A and B naturally.
- Con: unverified whether `claude plugin test .` discovers more than `hooks/register.test.ts`;
  CLAUDE.md says it runs that file. If it does not, split tests would silently not run, which would
  look green. Must be confirmed by a deliberately failing test in the new file.
- Con: large diff, low risk to production behavior, but high risk to coverage if done wrong.

Do it after A, and only after confirming discovery.

### 4. Option D: in-file tidy-ups with no file moves

What it changes. Remove repetition inside the file: the `Array.isArray(stored) ? stored : []` read
appears in `decisions`, `log` and `amend` (428-465); `(Object.keys(SUGGEST) as Rating[])` is
repeated in `parseRating` and four times in `tally` (496-546); `tally` builds four near-identical
markdown tables; the `PICKERS` option cast in `reviewer` (190).

Tradeoffs.
- Pro: no loader or release-gate risk.
- Con: small maintainability gain, and the 1280 lines stay one file. `tally` output is exact
  markdown tested by wording, so even a harmless refactor can break tests.
- Best folded into A where a function moves anyway, not done separately.

### 5. Option E: keep one file, add section banners and a table of contents

Cheapest, zero risk, and zero structural gain. Reasonable fallback if constraint 1 fails: the loader
cannot import, so the file stays whole.

### Rejected: bundler or build step, separate packages

CI has no build step and the loader reads `.ts` directly. Adding a bundler adds a generated artifact
to keep in sync for a 1280-line file.

## Comparison

| Rank | Option | Maintainability gain | Risk | Needs |
| --- | --- | --- | --- | --- |
| 1 | A: extract leaves to `hooks/lib/` | High for logic, none for `register()` | Low | Constraints 1, 2 |
| 2 | B: per-feature registrars over `State` | Highest | Medium-high | A, visual check |
| 3 | C: split tests | Medium | Medium (silent skip) | A, test discovery |
| 4 | D: in-file tidy-ups | Low | Low | Fold into A |
| 5 | E: banners only | Very low | None | Fallback |

## Recommended first step

One change, small enough to revert whole: extract `hooks/lib/models.ts` containing lines 3-25 and
57-74 (ratings, tiers, `RANK`, `rank`, `familyOf`, `COUNT`, `SIZE`, the dialog labels), with
`register.ts` importing from it and re-exporting `Rating`. No logic edit.

Why this first: it is the leaf every later file depends on, and it answers the one open question
(constraint 1) before anything bigger is built on it. If the loader rejects the import, the plan
falls back to option E and nothing else was spent.

Check before starting, named in advance:
1. `claude plugin test .` stays at 275 pass, 0 fail, exit 0.
2. `claude plugin validate .` and `--strict` pass.
3. `claude --plugin-dir .` loads the mod and a first prompt still shows the model dialog. This is the
   check the test runner cannot give; until it is done the step is not verified.
4. `node scripts/eval-rating.mjs` still imports `RATER` and `parseRating` (a single run is enough to
   prove the import works; scoring is not the point).
5. Extend the `bump-version.yml` path filter to `hooks/lib/**` in the same change, and say so in the
   commit.

If all five hold, continue with `lib/override.ts` and `lib/stats.ts` (already exported or pure, with
direct tests), then `lib/count.ts` and `lib/pickers.ts`, one file per commit. Reassess B once
`register.ts` is down to the closure.
