---
status: in-progress
type: refactor
created: 2026-11-18
repo-name: prompt-triage
artifact-url: https://claude.ai/artifact/K9G3XcMG68wuZPmXDEqi43
---

# Plan: split hooks/register.ts into modules (option A of the proposal)

## Context

`hooks/register.ts` (1280 lines) holds the whole mod. `docs/proposals/modularize-register.md` ranks
the ways to split it and recommends option A: move the engine-free leaves into `hooks/lib/`, one
file per commit, gated by a first change that proves Claude Code's mod loader follows relative
imports. This plan is the path for that recommendation only. Options B (per-feature registrars over a
`State` object), C (split the test file) and D (in-file tidy-ups) are out of scope; B and C are
listed under Next Steps.

Facts this plan depends on (all from the proposal, checked against `main` at 60155b7, which is also
`origin/main` for `hooks/`, `.github/`, `scripts/`, `README.md` and `CLAUDE.md`):

- Only `register()` holds state. Everything else is plain functions and constants, so the moves are
  verbatim cuts.
- Coupling is through constants: `kind()` reads `NEW_SESSION` and `LOW_EFFORT`; `decide()` reads
  `switchTo`, `keep`, `LOW_EFFORT`, `FLOOR` and `pickedModel`; `chosen()` reads the labels. So
  `hooks/lib/models.ts` (ratings, tiers, dialog labels) is the leaf every other file imports and
  must import nothing from the other lib files, or cycles appear.
- External consumers import only `REVIEWER`, `RATER`, `parseRating` (the eval scripts) and
  `REVIEWER`, `decide`, `dropModel`, `endOverride`, `retarget` (`hooks/register.test.ts`).
  `register.ts` keeps re-exporting those, plus `Override` and `Rating`, so no consumer changes.
- `hooks/hooks.json` is `{ "modules": ["./register.ts"] }` and stays unchanged.
- `bump-version.yml` releases only when `hooks/register.ts`, `hooks/hooks.json` or the workflow
  changes. Code moved to `hooks/lib/**` stops releasing until its `paths` filter lists it. That
  failure is silent.
- Registration order of the 16 `on(...)` hooks matters. No step here touches `register()` beyond
  its import lines.
- Not provable by `claude plugin test .`: desktop-only `ui.render` output (lines 843-1029). No step
  changes that code; the desktop check stays "pending" and is reported as such.
- `.claude/skills/verify/SKILL.md` gives a headless loader check that an agent can run:
  `claude -p --plugin-dir . "/refine-prompt ..."`. The first-prompt dialog and the band need a
  person at the TUI and are reported as not verified.

Rules this plan follows from the user's global `CLAUDE.md`: pure moves only (no drive-by cleanups, no
option D tidy-ups); no repo-wide formatting (`npx prettier --write <touched files>` only); the
regression check is named before each move; do not edit `version` in `.claude-plugin/plugin.json`;
one commit per extraction; no push or PR until the user asks.

## Objective

Move the pure, engine-free parts of `hooks/register.ts` into `hooks/lib/*.ts` one file at a time,
with behavior unchanged, `claude plugin test .` at 275 passing, the public exports of
`hooks/register.ts` identical, and the release workflow still triggered by a change to any moved
code.

## Steps

1. Confirm the start state: `git fetch origin`, confirm `git diff HEAD origin/main -- hooks .github scripts` is empty, run `gh pr list --state open` and `git worktree list`, and name any open PR or worktree that edits `hooks/register.ts`. Why: a parallel edit to the same file would turn a pure move into a conflict. Verify: the diff is empty and the overlap list is written down, even if it says "none".
2. Record the baseline: run `claude plugin test .`, `claude plugin validate .`, `claude plugin validate . --strict`, and `node --input-type=module -e "import('./hooks/register.ts').then(m => console.log(Object.keys(m).sort().join(',')))"`, saving the output (including the exit codes and the export list) to the scratchpad. Why: every later step is compared to this, and the export list is the contract the re-exports must keep. Verify: tests report 275 pass and 0 fail, both validates exit 0, and the export list is non-empty and includes `REVIEWER`, `RATER`, `parseRating`, `decide`, `dropModel`, `endOverride`, `retarget`.
3. Read `.claude-plugin/types/` if an interactive session has written it, or note that it is absent, and search the mod reference at https://code.claude.com/docs/en/plugins/mods/reference for how `modules` entries resolve imports. Why: constraint 1 of the proposal is unconfirmed, and the declarations win over the docs. Verify: the finding is recorded as one of "imports resolve", "imports not supported" or "not documented, settle by step 6".
4. Add a test to `hooks/register.test.ts` named for the export contract that imports `* as mod from "./register"` and asserts the export names from step 2 are all present and each of `REVIEWER`, `RATER`, `parseRating`, `decide`, `dropModel`, `endOverride`, `retarget` has the expected type. Why: this is the regression test that must fail if a re-export is dropped during a move, and it goes in the file the runner is known to discover. Verify: it passes on the untouched tree, then fails when `retarget` is temporarily removed from the export in `register.ts` and passes again after the removal is reverted.
5. Create `hooks/lib/models.ts` with the verbatim code of lines 3-25 and 57-74 of `hooks/register.ts` (`SUGGEST`, `Rating`, `FLOOR`, `LEVELS`, `STRONG`, `STEP_DOWN`, `ALIASES`, `RANK`, `rank`, `familyOf`, `COUNT`, `SIZE`, and the dialog labels `keep`, `switchTo`, `LOW_EFFORT`, `NEW_SESSION`, `REFINE`, `HANDOFF`), export each, and replace the originals in `register.ts` with one import plus `export type { Rating }` where `Rating` was exported before. Why: it is the shared leaf that prevents import cycles and the smallest move that tests the loader. Verify: `grep -n "^import" hooks/lib/models.ts` prints nothing, and `claude plugin test .` reports 275 pass and 0 fail.
6. Run the loader check from `.claude/skills/verify/SKILL.md` against the working tree: `claude -p --plugin-dir . "/refine-prompt"` (prints the usage line) and then `claude -p --plugin-dir . "/refine-prompt Fix the login bug in src/auth/session.ts and make it work"`. Why: the test runner follows imports but the real mod loader is unconfirmed, and this is the gate for everything after it. Verify: the usage line prints and the second command reaches the `no_composer` refusal described in the skill, not a module-not-found or load error. If either fails, stop, revert the step 5 commit, and report that option E is the fallback.
7. Extend the `paths` filter in `.github/workflows/bump-version.yml` with `hooks/lib/**`, and update the sentences that name the triggering files in `README.md` (the Releases section, near line 593) and `CLAUDE.md` (the CI and releases section, near line 118). Why: without it, a merge that changes only moved code would not bump the version or release it. Verify: `git diff` shows the three one-line changes and `claude plugin validate .` still exits 0; the workflow itself can only be proven by its first merge to main, so state that it is unverified until then.
8. Run `node scripts/eval-rating.mjs` and stop it after its first output line, then re-run the step 2 export-list command. Why: the rating eval imports `RATER` and `parseRating` from `hooks/register.ts` and must work without edits; the full run makes 168 API calls and is not needed to prove an import. Verify: the first line is `Rubric: RATER from hooks/register.ts` with no import error, and the export list is byte-identical to step 2.
9. Run `npx prettier --write hooks/lib/models.ts hooks/register.ts hooks/register.test.ts` and then commit step 4, 5 and 7 as separate commits whose subjects use `refactor(hooks):` for the move and `ci:` for the workflow path (no `feat:`, so the bump stays a patch). Why: one reviewable change each, and a bad move reverts alone. Verify: `git log --oneline -3` shows the three commits and `git status` is clean.
10. Extract `hooks/lib/override.ts` from lines 701-813 (`Override`, `overrideLine`, `onModel`, `decide`, `stepEffort`, `dropModel`, `dropEffort`, `endOverride`, `retarget`), importing from `./models` and, if `pickedModel` is needed by `decide`, passing it in as already done today, and re-export `Override`, `decide`, `dropModel`, `endOverride` and `retarget` from `register.ts`. Why: this is already pure, already exported and already tested directly by name, so the test file proves it without a change. Verify: `claude plugin test .` reports 275 pass and 0 fail, the export-contract test from step 4 passes, and `hooks/lib/override.ts` imports only from `./models` and type-only imports.
11. Extract `hooks/lib/stats.ts` with `Decision`, `Spend`, `Tracked`, `direction`, `kind`, `usd`, `tally`, `isoDate` (the pure half of lines 26-56 and 479-553), and `hooks/lib/decision-log.ts` with `decisions`, `log`, `record`, `amend` and `LOG`, `LOG_CAP` (lines 427-477), importing from `./models` and `./stats` only. Why: stats is pure and tested through the `/triage-stats` output, and the store-touching functions are kept apart so the pure file needs no `$`. Verify: `claude plugin test .` reports 275 pass and 0 fail, the markdown the `/triage-stats` tests assert is unchanged, and `grep -n "^import" hooks/lib/stats.ts` shows only `./models`.
12. Extract `hooks/lib/count.ts` from lines 627-699 (`DELIVERED`, `isSent`, `readPrompts`, `Count`, `duration`, `seedCount`, `countSent`, `endCount`). Why: prompt counting is self-contained and its only inputs are the passed-in events. Verify: `claude plugin test .` reports 275 pass and 0 fail and `lib/count.ts` imports nothing from `register.ts`.
13. Extract `hooks/lib/pickers.ts` from lines 76-139 and 176-202 (`REVIEWER`, `PICKERS`, `loadPicks`, `reviewer`, `shows`), re-exporting `REVIEWER` from `register.ts`. Why: `REVIEWER` is imported by `scripts/eval-refine.mjs` and the test file, so its re-export is the riskiest name to lose. Verify: `claude plugin test .` reports 275 pass and 0 fail, the step 4 export test passes, and the step 2 export-list command still includes `REVIEWER`.
14. After steps 10 to 13, run the step 6 loader check again and commit each extraction separately, running `npx prettier --write` on only the touched files before each commit. Why: the loader proof in step 6 covered one import; this covers the whole graph before the work is called done. Verify: both `claude -p --plugin-dir .` commands behave as in step 6, and `git log --oneline` shows one `refactor(hooks):` commit per file.
15. Add one row per new file to the files table in `README.md` (near line 577) and change the `hooks/register.ts` row from "All of the mod's logic" to what it still holds, and add one sentence to `CLAUDE.md` that `hooks/register.ts` is the entry point and `hooks/lib/` holds what it imports. Why: both documents describe `hooks/register.ts` as the whole mod today. Verify: every file name and symbol cited in the new README rows exists (`ls hooks/lib` and `grep -n` for each symbol), and no version number or command is changed.
16. Measure the result and decide the stop point: run `wc -l hooks/register.ts hooks/lib/*.ts`, and write down whether `register()` (lines 815-1280 of the original) is now the dominant cost. Why: the proposal says to reassess option B only once `register.ts` is down to the closure, and the number is what the decision uses. Verify: the line counts are from the `wc` run, not estimated, and the sum of the lib files plus `register.ts` is within a few lines of the original 1280 plus the import and export lines.

## Tests

> Tier: 1 (code-touching: steps 5 and 10 to 13 move application source)

### Objective-Verification Test

- **File:** `hooks/register.test.ts`
- **Type:** smoke test
- **Asserts:** `hooks/register.ts` still exports `REVIEWER`, `RATER`, `parseRating`, `decide`, `dropModel`, `endOverride`, `retarget` with their expected types after the code moved to `hooks/lib/`, which is the contract the eval scripts and the test file rely on.
- **Run:** `claude plugin test .`

### Unit Tests

- **File:** `hooks/register.test.ts` (existing, unchanged except the new export test)
- **Targets:** `decide`, `dropModel`, `endOverride`, `retarget` (now in `hooks/lib/override.ts`), imported through `./register`
- **Key cases:** the existing 275 tests are the behavior proof for pure moves; none is edited or loosened. A step that needs a test edited to pass is a behavior change and stops the plan.

### Integration Tests

- **File:** `hooks/register.test.ts` (existing, unchanged)
- **Targets:** the hooks that call the moved code through `register()`: `prompt.submit`, `turn.complete`, the `/triage-stats` command and the override hooks
- **Key cases:** the existing tests that drive these hooks pass unchanged.

## Acceptance Criteria

- [x] `claude plugin test .` reports 275 passing plus the one export test (276 in all), 0 failing, and exits 0 after every extraction commit. After merging main (#80 added 2 tests), it reports 278 pass and 0 fail.
- [ ] `claude plugin validate .` and `claude plugin validate . --strict` exit 0. Blocked: `validate .` exits 0, but `--strict` exits 1. Two causes: the baseline (0a55926) warning "CLAUDE.md at the plugin root is not loaded as project context", which predates this plan, and 9 TS5097 warnings (in `register.ts` and three `hooks/lib/` files) that this split adds. The `.ts` import extensions are kept on purpose, so plain `node` can load the lib files for `scripts/eval-*.mjs`, and `validate` ignores the repo's `tsconfig.json`, so `allowImportingTsExtensions` cannot silence them.
- [x] The sorted export list of `hooks/register.ts` after the last step equals the list recorded in step 2.
- [x] No test in `hooks/register.test.ts` was edited, loosened or skipped, other than the one export test added in step 4.
- [x] `claude -p --plugin-dir .` loads the mod and the `/refine-prompt` commands behave as in step 6.
- [x] No file in `hooks/lib/` imports from `register.ts`, and only `models.ts` is imported by every other lib file (no cycles).
- [x] `.github/workflows/bump-version.yml` lists `hooks/lib/**` in its `paths` filter.
- [x] `hooks/hooks.json` and `.claude-plugin/plugin.json` are byte-identical to `main`.
- [x] The desktop `ui.render` output and the interactive dialogs are reported as not verified, not as passed (still pending: the first-prompt dialog, Clarify questions, drop line, Refine button, band, and the bump-version `paths` filter until its first merge to main).

## Verification

From the worktree root, in order:

1. `claude plugin test .` shows 276 pass (275 existing plus the export test), 0 fail, exit 0; 278 once main's 2 tests from #80 are merged in.
2. `claude plugin validate .` exits 0. `claude plugin validate . --strict` exits 1 on the untouched baseline over the CLAUDE.md-at-plugin-root warning, and now also over 9 TS5097 warnings for the `.ts` import extensions in `register.ts` and `hooks/lib/`. The extensions are a deliberate trade for plain-`node` loading; this check stays blocked.
3. The step 2 export-list command prints the same line as the baseline.
4. `claude -p --plugin-dir . "/refine-prompt"` prints the usage line, and the long form reaches `no_composer`.
5. `node scripts/eval-rating.mjs` starts and prints its header (one run is enough to prove the import).
6. `git diff main --stat -- hooks .github README.md CLAUDE.md` touches only `hooks/register.ts`, `hooks/register.test.ts`, `hooks/lib/*`, `.github/workflows/bump-version.yml`, `README.md` and `CLAUDE.md`.
7. `git diff main -- hooks/hooks.json .claude-plugin/plugin.json` is empty.

Not covered by any command above and therefore reported as pending: the first-prompt dialog, the
Clarify questions, the drop line and the Refine button (TUI), and anything the desktop app renders.

## Outcome

Done on branch `claude/codebase-modularity-optimization-44d90d`, 11 commits, nothing pushed. `hooks/register.ts` is 1280 to 807 lines;
`hooks/lib/` holds `models.ts` (100), `override.ts` (116), `stats.ts` (77), `decision-log.ts` (54), `count.ts` (77) and `pickers.ts` (91).
`register()` is now 466 of the 807 lines, so it dominates what is left; option B is the next lever.
Findings that changed the plan's text: the mod loader and `claude plugin test` follow relative imports; imports need the `.ts` extension
(plain `node`, which the eval scripts use, fails without it); a dynamic `import()` is refused, so the export test uses `import * as`; and `$` may
be passed only into function declarations past an import, so `readPrompts` became a `function` (the one non-verbatim edit). `LOG`, `LOG_CAP`,
`Decision`, `Spend`, `Tracked`, `chosen` and `pickedModel` went into `models.ts` so `override.ts` and `stats.ts` import only it. The stats and
decision-log moves share one commit. Prettier was run only on touched files.

## Next Steps _(optional)_

- Option B, split `register()` into per-feature registrars over one typed `State` object:
  ```text
  In the prompt-triage repo, after hooks/lib/ exists (see docs/plans/refactor-register-into-modules.md),
  write a plan for option B of docs/proposals/modularize-register.md: replace the 13 closure `let`
  variables in register() with one typed State object and split the 16 on(...) hooks into
  registerBand, registerCommands, registerSubmit, registerTracking and registerOverrideHooks, called
  in the current order. Name which closures read a value live and must not be captured into a const,
  and name the visual check the ui.render hook needs. Spec only; do not edit code.
  ```
- Option C, split hooks/register.test.ts along the same seams:
  ```text
  In the prompt-triage repo, write a plan for option C of docs/proposals/modularize-register.md.
  First prove whether `claude plugin test .` discovers a test file other than hooks/register.test.ts
  by adding a deliberately failing test in a new file and confirming the runner reports it, then
  revert it. Then plan moving the Setup harness (lines 1-292 of hooks/register.test.ts) into
  hooks/testing/harness.ts and grouping the tests per feature. Spec only; do not edit code.
  ```

## Unresolved Questions _(optional — omit if none)_

- Does the real mod loader resolve relative imports from `hooks/register.ts`?
  ```text
  In the prompt-triage repo, determine whether Claude Code's mod loader follows relative imports from
  a module listed in hooks/hooks.json. Read .claude-plugin/types/ if it exists, and
  https://code.claude.com/docs/en/plugins/mods/reference. If neither says, design the smallest
  throwaway check that settles it with `claude -p --plugin-dir .`. Recommend whether to proceed with
  hooks/lib/ or fall back to option E (section banners only) and say why.
  ```
