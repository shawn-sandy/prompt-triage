# prompt-triage

A Claude Code mod. [README.md](README.md) describes what it does. The entry point is
`hooks/register.ts`.

## Mods reference

Official reference: https://code.claude.com/docs/en/plugins/mods/reference
Interface reference: https://code.claude.com/docs/en/plugins/mods/interface

Read the official reference, or the TypeScript declarations Claude Code writes for the installed version, before
using any event or `$` method that `hooks/register.ts` does not already use. The page says the
declarations are the complete reference and win over the docs when the two disagree. They are in
`.claude-plugin/types/`, which `tsconfig.json` extends. The folder is gitignored and written only
by an interactive session, so a fresh clone, a new worktree and CI have none.

Read the interface reference before changing a UI render hook or any `$.ui` call.

The official reference was read on 2026-11-08. It covers the CLI and Desktop app as of v2.1.290 and the VS Code
extension as of v2.1.299. Version-gated entries say "requires v2.1.xxx" on the official reference.

### Events worth knowing (confirmed on the official reference)

- `session.start`: once per loaded mod, before the first prompt, and again after a reload of that
  mod. Not after `/clear`, `/resume` or `/branch`.
- `session.end`: the session ends, or `/clear`, `/resume` or `/branch` runs. `e.reason` says
  which. All `session.end` hooks together get about 1.5 seconds.
- `session.measure`: after each turn, and when a plan limit's percent used changes.
- `turn.complete`: a hook may return `{ text }` to show a line under the answer.
- `turn.step`: an async generator hook. May change `model` and `effort`.
- `agent.spawn`: may change the model of a subagent that is starting. Fires again for a resumed
  subagent, with `e.resume` set (requires v2.1.299).

### Calls worth knowing (confirmed on the official reference)

- `$.session.usage()` returns `{ startedAt, context: { tokens, window, percent }, rateLimits:
  [{ kind, percentUsed, resetsAt }], cost }`.
- `$.store` is a key-value store that every session on the machine shares, 4 MiB of JSON in
  total. It is not per session. Keep data that several sessions change here.
- `$.state` is reactive state. It needs `types/index.d.ts` declaring its values, and a `types`
  field in `plugin.json` on releases before v2.1.299.
- `$.model` has `complete`, `fork` and `classify`. `complete` defaults to `maxTokens` 1024.
- `$.telemetry`: a record is sent only when Claude Code or a built-in mod makes the call, so a
  mod people install cannot use it to report anything. Its hooks need the filter
  `{ to: 'collector' }` or `claude plugin validate` fails.

### Limits worth knowing (confirmed on the official reference)

A hook gets 10 seconds per event (50 ms for `prompt.edit`), not counting time inside `next` or a
mods API call other than `$.clock.sleep`. A `.catch` handler gets 1 second. `$.ui.toast` shows
for 4 seconds. One `claude plugin test` test gets 5 seconds.

### Not confirmed by the official reference

A third-party guide claimed these. Check the generated declarations before relying on any:

- That `$.state` survives a hot reload of the mod.
- That `cost` includes the mod's own `$.model.complete` calls.
- Which `rateLimits[].kind` values exist, and whether the list is ever empty.
- What happens when two mods call `$.ui.status`.
- What `$.model.classify` takes and returns. The page lists only its name.

## Model and cost references

Anthropic's docs for the choices this mod makes about models and effort. Read the matching page
before changing a rating, a model suggestion or an effort minimum.

- [Models overview](https://platform.claude.com/docs/en/models/overview): the current lineup,
  model IDs, default effort for each model, context windows and pricing.
- [Choosing a model](https://platform.claude.com/docs/en/about-claude/models/choosing-a-model):
  the criteria, two ways to pick a starting model, and why tuning effort is often a better
  lever than switching models.
- [Steering thinking](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost):
  how effort levels, prompt guidance and per-message steering control how often and how deeply
  Claude thinks, and what that costs.

## Commands

```bash
claude --plugin-dir .          # load the mod from this folder; reloads on save
claude plugin validate .       # CI runs this form; --strict is stricter
claude plugin test .           # runs hooks/register.test.ts
node scripts/eval-rating.mjs   # scores the rating rubric; --baseline scores bare labels
node scripts/eval-rating.mjs --runs 3   # the mean of 3 runs; one run varies by a few cases
```

The eval makes 160 `claude -p --model haiku` calls per run. One run of the unchanged rubric has
scored `complex` anywhere from 32/40 to 36/40, so compare rubric changes on the mean of several
runs. It needs Node 24, a signed-in `claude` and
network access to api.anthropic.com; in a sandbox, a timeout means that host is blocked. It
imports `RATER` and `parseRating` from `hooks/register.ts`, so both must stay exported.

`/reload-plugins` reloads plugins from the prompt.

## CI and releases

`check.yml` runs `claude plugin validate .` and `claude plugin test .` on every pull request,
with Claude Code pinned to 2.1.319, past every version gate on the page. There is no typecheck
step.

Do not edit `version` in `.claude-plugin/plugin.json`. The `bump-version` workflow does it when
a push to main changes `hooks/register.ts`, `hooks/hooks.json` or the workflow file. It reads
the subject of every commit since the current version's release tag, or since the push's
previous head when that tag is missing, not only the commits just pushed. If any of them starts
`feat:` or `feat(scope):`, the bump is minor; otherwise it is a patch. Changes that touch none
of those three files do not release, but their subjects still count toward the next bump.

## Files

`assets/` holds the source icon files. The root `icon.png`, which `plugin.json` points at, is a
byte-identical copy of `assets/icon.png`.
