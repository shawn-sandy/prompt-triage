# prompt-triage

A Claude Code mod. [README.md](README.md) describes what it does. The entry point is
`hooks/register.ts`.

## Mods reference

Official reference: https://code.claude.com/docs/en/plugins/mods/reference

Read it, or the TypeScript declarations Claude Code writes for the installed version, before
using any event or `$` method that `hooks/register.ts` does not already use. The page says the
declarations are the complete reference and win over the docs when the two disagree. The repo's
`.gitignore` ignores `.claude-plugin/types/`; the page does not name the folder the
declarations land in.

The page was read on 2026-11-08. It covers the CLI and Desktop app as of v2.1.290 and the VS Code
extension as of v2.1.299. Claude Code 2.1.319 was installed then, past every version gate on the
page. Version-gated entries say "requires v2.1.xxx" on the page.

### Events worth knowing (confirmed on the page)

- `session.start`: once per loaded mod, before the first prompt, and again after a reload of that
  mod. Not after `/clear`, `/resume` or `/branch`.
- `session.end`: the session ends, or `/clear`, `/resume` or `/branch` runs. `e.reason` says
  which. All `session.end` hooks together get about 1.5 seconds.
- `session.measure`: after each turn, and when a plan limit's percent used changes.
- `turn.complete`: a hook may return `{ text }` to show a line under the answer.
- `turn.step`: an async generator hook. May change `model` and `effort`.
- `agent.spawn`: may change the model of a subagent that is starting. Fires again for a resumed
  subagent, with `e.resume` set (requires v2.1.299).

### Calls worth knowing (confirmed on the page)

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

### Limits worth knowing (confirmed on the page)

A hook gets 10 seconds per event (50 ms for `prompt.edit`), not counting time inside `next` or a
mods API call other than `$.clock.sleep`. A `.catch` handler gets 1 second. `$.ui.toast` shows
for 4 seconds. One `claude plugin test` test gets 5 seconds.

### Not confirmed by the page

A third-party guide claimed these. Check the generated declarations before relying on any:

- That `$.state` survives a hot reload of the mod.
- That `cost` includes the mod's own `$.model.complete` calls.
- That `e.agentId` is set on `turn.complete` events. The page documents it on `tool.check`.
- Which `rateLimits[].kind` values exist, and whether the list is ever empty.
- What happens when two mods call `$.ui.status`.
- What `$.model.classify` takes and returns. The page lists only its name.

## Commands

```bash
claude --plugin-dir .          # load the mod from this folder; reloads on save
claude plugin validate . --strict
claude plugin test
```

`/reload-plugins` reloads plugins from the prompt.
