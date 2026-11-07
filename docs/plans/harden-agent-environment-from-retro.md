---
status: todo
type: chore
created: 2026-11-06
repo-name: prompt-triage
workflow: never
artifact-url: https://claude.ai/artifact/MmGEhdqr2F1PFWVAngKYhB
issue: https://github.com/shawn-sandy/prompt-triage/issues/22
glance: The session that shipped PR 20 lost time finding the mod API, improvised its typecheck, and its review missed the mid-turn Run in case that CodeRabbit caught. When this lands, a fresh agent finds every one of those answers in the repo, and a test fails if the mid-turn behavior ever changes.
---

# Plan: Close the gaps the PR 20 retro found, so the next agent starts where this one finished

## Objective

Pin the documented mid-turn Run in behavior with a test, and give future agents and reviewers the pointers, review rule, and dev commands the PR 20 session had to work out by hand.

## Context

A retro of the session that built and merged PR 20 (the Run in picker) found seven environment gaps. This plan covers the ones that live in this repo and are not done yet.

- **Already done on this branch:** `.github/workflows/check.yml` (commit `c42f1c1`) runs `claude plugin validate .` and `claude plugin test .` on every pull request and push to `main`. It has not run on GitHub yet.
- **Untested documented behavior:** `hooks/register.ts:254` passes a prompt with `turnId` set straight through, and `:256` says it leaves an armed Run in pick armed. `README.md:41-43` documents it. None of the four Run in tests (`hooks/register.test.ts:691-733`) covers it. This is the exact case the in-session review missed and CodeRabbit flagged.
- **No navigation pointers:** the repo has no `CLAUDE.md`. The session spent about 10 Bash calls paging through `.claude-plugin/types/claude-code/index.d.ts` (17,305 lines), and its review brief had to repeat those pointers by hand.
- **No review standards:** no `CODING_STANDARDS.md` exists. The rule the review needed is a judgement call (which states a test must cover), not something a linter can check.
- **Undocumented commands:** `npx tsc` fails (no TypeScript in the repo). The session improvised `npx --yes -p typescript@5.9 tsc --noEmit -p .`. The `.claude-plugin/types/` folder it needs is gitignored and only written by an interactive `claude --plugin-dir .` session.
- **Risk:** the test kit's `$.prompt.submit` may not accept a `turnId` field. Step 1 confirms it against `PromptSubmitInput` in the types file before writing the test.

## Decisions

- The CI job is not repeated here; it is already committed as `c42f1c1`.
- CI runs no typecheck: the engine writes `.claude-plugin/types/` only for an interactive session, so a CI runner never has it. The typecheck is documented as a local command instead.
- No RED/GREEN phases: the new test pins behavior that already ships, so it passes on first run. A mutation check (remove the `turnId` guard, watch the test fail, restore) stands in for RED.
- `CLAUDE.md` holds pointers only; the review rule lives in `CODING_STANDARDS.md`, which reviewers read and implementers do not need in every turn.
- Fixes outside this repo (the three global instruction files, plan-agent's render script lookup and republish refusal) go to Next Steps. The stale-worktree finding is dropped: no change in this repo fixes it.
- Documenting the desktop branch-test (marketplace swap and restore) is left out by choice during alignment.

## Files

- hooks/register.test.ts (modified) — `submit` helper takes an optional `turnId`; one new Run in test.
- CODING_STANDARDS.md (new) — one review rule for hook state that outlives a prompt.
- CLAUDE.md (new) — navigation pointers for the mod API, checks, and review standards.
- README.md (modified) — typecheck command in Development.

## Steps

1. Extend the `submit` helper in `hooks/register.test.ts` with an optional `turnId` argument, then add a test after the Run in tests: arm the pick with `armHandOff($)`, submit with `turnId: 't1'` and assert `handsOff` is false and the band's `run-in` value is still `new`, then submit again with no `turnId` and assert `handsOff` is true. Why: README.md documents this behavior and no test covers it, so a change to the `turnId` guard would pass CI silently. Verify: `claude plugin test .` reports 67 pass, 0 fail; then delete `|| e.turnId` from `hooks/register.ts:254`, rerun and see the new test fail with exit 1, and restore the line.
2. Write `CODING_STANDARDS.md` with one rule: any hook state that outlives a single prompt (the armed `handOff` pick, the `improved` flag) has a test for each `prompt.submit` path that can reach it — an idle prompt, a prompt typed over a running turn (`turnId` set), a slash command, a meta prompt — and for the desktop and terminal surfaces where the behavior differs. Why: the review of PR 20 missed the running-turn path, and no linter can check which states a test covers. Verify: the file exists and names all four paths and both surfaces.
3. Write a `CLAUDE.md` of at most 15 lines with three pointers: for the mod API, load the `plugin-authoring` skill and search `.claude-plugin/types/claude-code/index.d.ts` by symbol (`AbovePrompt`, `PromptSubmitInput`, `SelectProps`, `ui.mount`) rather than reading it; for checks, the Development section of `README.md`; for reviewing a diff, `CODING_STANDARDS.md`. Why: the PR 20 session spent about 10 calls finding the API, and the review brief had to carry the same pointers by hand. Verify: `wc -l CLAUDE.md` is 15 or less, and every path it names exists with `test -e`.
4. Add the typecheck to the Development code block in `README.md` as `npx --yes -p typescript@5.9 tsc --noEmit -p .`, with one sentence saying `.claude-plugin/types/` appears after one interactive `claude --plugin-dir .` session in the folder and is never committed. Why: plain `npx tsc` fails here and the session had to work out both the command and why the types folder was missing. Verify: in a fresh worktree, start `claude --plugin-dir .` in a terminal tab, exit, and the documented command exits 0.

## Tests

Tier 1 — This plan changes application code
- Objective: a prompt typed over a running turn stays in this session and leaves an armed Run in pick armed for the next idle prompt. File: hooks/register.test.ts; Type: mock; Asserts: with the pick armed, a `turnId` submit does not hand off and the band still reads `new`, and the next idle submit hands off; Run: claude plugin test .

## Acceptance Criteria

- [ ] `claude plugin test .` exits 0 with 67 tests, one more than before.
- [ ] With `|| e.turnId` removed from `hooks/register.ts:254`, `claude plugin test .` exits 1 on the new test.
- [ ] `CLAUDE.md` exists, is at most 15 lines, and every path in it exists.
- [ ] `CODING_STANDARDS.md` exists and its rule names the idle, running-turn, slash-command, and meta-prompt paths.
- [ ] `README.md` Development lists the typecheck command and says where `.claude-plugin/types/` comes from.
- [ ] No file outside this repo changes.

## Verification

Open a fresh worktree from this branch with no `.claude-plugin/types/`. Read only `CLAUDE.md` and follow its pointers: the checks in README Development should run without improvising (validate, test, and, after one interactive `claude --plugin-dir .`, the typecheck). Run the mutation check from step 1 and confirm the new test is the one that fails. Push the branch and open a pull request: the `check` workflow from `c42f1c1` runs green on GitHub with 67 tests.

## Next Steps

- Collapse the three global instruction files into one
  `~/.claude/CLAUDE.md`, `~/AGENTS.md`, and `~/.claude/AGENTS.md` are about 95% the same, all load in every session, and have drifted (the review-bot rule differs between them).
  ```text
  Compare ~/.claude/CLAUDE.md, ~/AGENTS.md and ~/.claude/AGENTS.md line by line and list every difference. Ask me which tool reads each file (Claude Code, Codex) and which wording wins for each difference. Then make ~/.claude/CLAUDE.md the single source of truth and reduce each other file to the smallest content its tool needs, ideally a one-line pointer. Delete lines that restate what permissions already enforce, such as "curl and rm are denied outright". Back up all three files to the scratchpad first. Verify by starting a new Claude Code session in ~/repos/prompt-triage and confirming only one copy of the global rules appears in its loaded instructions.
  ```
- Turn the mechanical global rules into PreToolUse hooks
  Rules like no `cd x && y`, no bare `git stash pop`, and no `--delete-branch` on merge are fixed command patterns that a hook can block every time.
  ```text
  In ~/.claude/settings.json, add PreToolUse hooks on Bash that block three command patterns with a message naming the alternative: a command starting with `cd <path> &&`, a bare `git stash pop` with no stash index, and `gh pr merge` with `--delete-branch`. Remove the matching prose lines from ~/.claude/CLAUDE.md once each hook is in place. Verify each hook by running one blocked command and one allowed variant and showing the hook's output for both.
  ```
- Fix plan-agent's render-script lookup and artifact republish
  The PR 20 session found build-plan-html.mjs with an `ls ... | sort -V | tail -1` glob five times, and an Artifact publish was refused twice because the live page was not read first.
  ```text
  In ~/repos/agentics, update the plan-agent skills that re-render and republish a plan (build, finalize-plan, and any that call scripts/build-plan-html.mjs) so they use the script path the skill loader substitutes instead of globbing ~/.claude/plugins/cache, and so they read an existing artifact-url with the Artifact tool's read action before republishing. Bump plan-agent's version in .claude-plugin/marketplace.json and add a CHANGELOG entry. Verify by running the updated build skill on a plan that has an artifact-url and confirming the publish succeeds on the first call.
  ```
- Add a local pre-push hook mirroring the CI check
  GitHub Actions is often blocked by billing on this account, so the CI job alone may not run.
  ```text
  In ~/repos/prompt-triage, add .githooks/pre-push that runs `claude plugin validate .` and `claude plugin test .` and exits non-zero if either fails, document `git config core.hooksPath .githooks` in README Development, and verify by breaking one assertion in hooks/register.test.ts and confirming `git push --dry-run` is refused, then restoring it.
  ```

## Resources

- Retro source: session transcript `a8655c3e-c714-409c-8ff2-e0e924681b2d` in the `model-selection-optimization-ce8188` worktree's project log, the session that built and merged PR 20.
- `hooks/register.ts:254-256` — the `turnId` pass-through and the comment stating the armed pick survives it.
- plugin-authoring skill `reference.md`, section "The types are the reference" — why `.claude-plugin/types/` exists only after an interactive session.
