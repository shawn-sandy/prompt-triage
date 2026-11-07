---
session-id: "3085a535-59f6-4aef-9924-be8023acc7ce"
date: 2026-11-07
source: "3085a535-59f6-4aef-9924-be8023acc7ce.jsonl"
type: session-export
title: "Mod release gate and retro"
eng-artifact-url: https://claude.ai/artifact/59ofi5qUuqNbDeoRdKqpLF
---

# Mod release gate and retro

## At a glance

- 3 commits on `claude/mattpocock-skills-retro-346972`, PR #23 (open, review required)
- 5 files changed: 2 workflows, README, 1 plan spec, the plans gallery
- 6 decisions, 5 open items
- Tracking issue #22 for the plan

`bump-version` can no longer release a mod that fails `claude plugin validate .` or `claude plugin test .`: it now calls `check.yml` as a job and its `bump` job `needs: check`. `check.yml` also runs on every pull request; on PR #23 at `55a745e` it ran 66 tests with 0 failures in 10s. The rest of the retro's in-repo fixes are planned, not built, in `docs/plans/harden-agent-environment-from-retro.md`.

## Architecture and code paths

Read `.github/workflows/check.yml` first, then the top of `.github/workflows/bump-version.yml`.

```
pull_request ───────────────► check.yml (job: check)
                                 checkout
                                 npm install -g @anthropic-ai/claude-code@2.1.319
                                 claude plugin validate .
                                 claude plugin test .

push to main (paths: hooks/register.ts, hooks/hooks.json, bump-version.yml)
  └► bump-version.yml
       job check:  uses: ./.github/workflows/check.yml   (workflow_call)
       job bump:   needs: check  → bump plugin.json → commit → gh release create
```

- `check.yml` triggers: `pull_request`, `workflow_call`. Permissions `contents: read`; no `${{ }}` interpolation of event data.
- `bump-version.yml` keeps `permissions: contents: write` at the top. The called workflow declares `contents: read`, which can only narrow what the caller grants.
- `claude plugin test .` runs `hooks/register.test.ts` against the engine's test kit (`claude-code/testing`). It needs no auth: verified locally with an empty `CLAUDE_CONFIG_DIR` and no `ANTHROPIC_API_KEY`.
- There is no typecheck in either workflow. `tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, and the engine writes that folder only when an interactive session loads the mod from the folder (`claude --plugin-dir .`). `validate` and `test` do not write it.

## Decisions

- **Gate the release by calling `check.yml` from `bump-version`, not by a parallel `push` trigger.** The first version of `check.yml` ran on `push` to `main` alongside `bump-version`; Codex flagged on PR #23 that the release did not wait for it. Fixed in `55a745e`; thread resolved.
- **`workflow_call` over `workflow_run`.** `bump-version` reads `github.event.before` to collect pushed commit subjects for the minor/patch decision, and `workflow_run` would not carry that push payload or the `paths` filter.
- **Dropped `push: main` from `check.yml`.** PRs run it, and the only push that matters (one that releases) runs it through `bump-version`. A non-hook push to `main` is no longer checked; it releases nothing.
- **Pin the CLI to `2.1.319`.** It is the version every local check ran against. The plugin API under test changes only when that line is edited.
- **The retro targeted the PR 20 session, not this one.** This session had no prior work, so the retro read transcript `a8655c3e` (the session that built and merged PR #20).
- **Plan scope: four in-repo steps.** Desktop branch-test docs were dropped during alignment; fixes outside the repo (the three global instruction files, plan-agent's render-script lookup) went to the plan's Next Steps.

## Tradeoffs and rejected options

- **Typecheck in CI** — rejected: no way to get `.claude-plugin/types/` on a runner. Revisit if the engine gains a command that writes the types non-interactively.
- **Unpinned `@anthropic-ai/claude-code`** — rejected for reproducibility. Cost: tests only see engine changes when someone bumps the pin.
- **Local pre-push hook** — deferred to the plan's Next Steps. GitHub Actions is often billing-blocked on this account, so CI alone may not run.
- **RED/GREEN phases for the planned `turnId` test** — rejected: the test pins behavior that already ships and passes on first run. A mutation check (remove `|| e.turnId` at `hooks/register.ts:254`, watch it fail, restore) replaces RED.

## Learnings

- **The first `check.yml` gated nothing.** Two workflows on the same `push` event run in parallel; "runs before release" needs `needs:` across jobs in one workflow, or a call. Caught by Codex, not by the in-session review agent.
- **`zsh` has no `PIPESTATUS`.** `echo ${PIPESTATUS[0]}` printed empty in the Bash tool; use `pipestatus` or drop the pipe to read an exit code.
- **BSD `sed` silently ignores the GNU `0,/re/` address.** The first attempt to break a test for the red-gate check changed nothing and the test still passed; Python string replace worked.
- **`claude plugin test` exits 1 on a failed assertion** — measured on a scratch copy with one broken `expect`. Without that check, a green CI job could have been vacuous.
- **A 10-second green CI job is worth opening.** The log at `55a745e` shows `Validation passed` and `Ran 66 tests across 1 file`, which is the only proof the job does what it claims.

## Tests and verification

- Local, signed out: `claude plugin validate .` passed; `claude plugin test .` 66 pass, 0 fail.
- Red gate: one broken assertion in a scratch copy → `claude plugin test` exit 1.
- `actionlint .github/workflows/*.yml` exits 0.
- GitHub: `check` on PR #23 at `55a745e` passed — 66 tests, 0 failures (run 42323288558).
- Fresh-context review agent: no defects. Claude review bot: no issues.
- **Knowingly untested:** the `bump-version` → `check` call path. It runs only on a push to `main`; the merge of PR #23 is its first run (this PR edits `bump-version.yml`, which is in its own `paths`, so the merge triggers it).

## Review follow-ups and tech debt

- PR #23 is blocked on a required approving review.
- Plan `harden-agent-environment-from-retro.md` (issue #22) is `todo`: `turnId` regression test, `CODING_STANDARDS.md`, pointer-only `CLAUDE.md`, typecheck command in README.
- Plan step 1 risk: the typings omit `turnId` from `$.prompt.submit`'s arguments, so the test kit may not let a test submit mid-turn. Confirm against `PromptSubmitInput` before writing the test.
- If PR #21 merges first it shifts `hooks/register.ts` by about 200 lines; the plan's `:254` reference goes stale, though it also quotes `|| e.turnId`.
- The CLI pin needs a periodic bump.

## Files touched

- `.github/workflows/check.yml` (new) — validate and test on PRs; reusable via `workflow_call`.
- `.github/workflows/bump-version.yml` — `check` job calling `check.yml`; `bump` now `needs: check`.
- `README.md` — Releases paragraph describes `check.yml` and the release gate.
- `docs/plans/harden-agent-environment-from-retro.md` (new) — the remaining retro fixes, issue #22, artifact-published.
- `docs/plans/index.html` — regenerated plans gallery (3 items).
