# Proposal: use live session usage to measure outcomes and catch a wrong rating

Status: nothing here is implemented. Written 2026-11-08 against the mod at
`0.4.2` and the
[Mods reference](https://code.claude.com/docs/en/plugins/mods/reference), read
the same day. It follows [cost-evidence.md](cost-evidence.md): that proposal's
P1 (the decision log and `/triage-stats`) and P2 (the option order for a
`simple` prompt) have shipped, and its P3-A and P4 have not. Its status line
still says nothing is implemented; it predates those merges.

## Summary

The decision log records what people chose. It cannot record what the session
then cost, and the mod looks at a session only once, on the first prompt. The
Mods reference documents `$.session.usage()`, which returns the session's cost,
context use and plan-limit use, and two events that carry it forward:
`session.end` and `session.measure`. This proposal uses them in four small
changes and rejects a fifth.

| | Change | Closes | Depends on (spikes below) |
| --- | --- | --- | --- |
| A | Record what each session cost next to its decision | The log counts choices, not outcomes | Spikes 1 and 3 |
| B | Keep the model override and effort minimum across mod reloads | A documented limit | Spike 2 |
| C | Say in the dialog when the plan limit is nearly used | The suggestion ignores headroom | Spike 3 |
| D | Notice, with one line, when a session outgrows its rating | The rating is read once | A's data, spikes 3 and 4 |

Rejected: a usage readout on the status line.

None of the four adds a model call. A and D add numbers, never text, to the
log.

## Problem

- **The log counts choices, not outcomes.** A logged `Decision` is
  `{ rating, from, to, chose }`. `/triage-stats` can say how often a switch was
  taken. It cannot say whether sessions that switched cost less. cost-evidence.md
  named this the finding the others depend on. P1 built the record; the outcome
  half is still missing.
- **The rating is read once.** The README says the effort minimum is set from
  the first prompt only. A session that starts `simple` and grows is never
  noticed. P3-A and P4 planned a turn counter for this and neither is built.
- **The suggestion ignores headroom.** The dialog names the rating and the model
  but not how much of the plan limit is left, which is the one fact that makes a
  pricier suggestion a worse idea right now.
- **A reload drops the override.** The README's Limits section says that if the
  mod reloads, the session goes back to its own model and effort.

## What the reference settles

Three of the "feasibility spike" questions in cost-evidence.md are touched by
the reference. Only some are answered.

| Question | What the reference says |
| --- | --- |
| Can the mod read usage? (cost-evidence.md spike 1) | Partly. `$.session.usage()` returns `{ startedAt, context: { tokens, window, percent }, rateLimits: [{ kind, percentUsed, resetsAt }], cost }`. That is per session. Per-request usage is not documented, so a real cost figure is session-level. |
| Can the mod show something mid-session? (cost-evidence.md spike 2) | Partly. A `turn.complete` hook may return `{ text }` to show a line under the answer. Whether a dialog can open mid-session is not documented. |
| How big can the store get? (cost-evidence.md spike 3) | Answered. `$.store` is shared by every session on the machine and holds 4 MiB of JSON in total. |

Also confirmed: `session.end` fires when the session ends and on `/clear`,
`/resume` and `/branch`, and all `session.end` hooks together get about 1.5
seconds. `session.measure` fires after each turn and when a plan limit's percent
used changes. `session.start` fires again after a reload of the mod, and not
after `/clear`, `/resume` or `/branch`.

Not settled by the page, to be read from the generated declarations in
`.claude-plugin/types/` (written only by an interactive session):

- whether `cost` includes the mod's own `$.model.complete` calls
- whether `rateLimits` can be empty, and which `kind` values exist
- whether `$.state` survives a reload of the mod

Since settled by the declarations Claude Code 2.1.319 writes: `cost` is
`{ usd }`, US dollars summed over every priced API response, as `/cost` totals
it; and `turn.complete` carries `agentId` on a subagent's turn and leaves it out
on the main loop.

## Goals and non-goals

**Goal.** Each change lets a later reader answer a question the repo cannot
answer today, or removes a way the mod misleads.

**Non-goals.** A dashboard, telemetry, prices in the mod, and a cleverer rubric.
cost-evidence.md rules all four out and nothing here changes that.

## A. Record what each session cost

Closes: "the log counts choices, not outcomes".

Shipped by `docs/plans/add-session-cost-to-decision-log.md`, in a different
shape from the one first proposed here.

`Decision` gains optional `id` and `cost`. The `id` is random
(`crypto.randomUUID()`), not `$.session.id()`: the session id is the transcript
file's name, so storing it would point at a private file, while a random id links
to nothing. When the `prompt.submit` hook logs an entry it also reads
`$.session.usage()` once as a baseline. A `turn.complete` hook, on the main loop
only, reads the cost again and writes the spend since the baseline, rounded down
to four places so it never exceeds `/cost`, onto the entry with that `id`, skipping the write when the figure
has not changed. It never appends. A `session.end` hook (which also fires on
`/clear`, `/resume` and `/branch`) and any new first prompt stop the earlier
entry's updates, so the baseline makes the figure right whether or
not the ledger resets, and the rating call is left out.

Why each turn and not `session.end`: an end-of-session write shares the 1.5
second `session.end` budget and is lost when the process is killed, while a
per-turn write always leaves the latest figure behind. A write lost to another
session's unlocked update is repaired by the next turn.

`/triage-stats` adds a second table when any entry has a cost: for each rating
and class (switched, low effort, kept, hand-off) with a costed session, the
session count and the average in US dollars. A hand-off gets its own row: the
task ran in another session. **Every average prints with its count beside it**,
and the output says once that sessions differ in task, so it shows association,
not cause.

`turns` and `ctx` were left out and remain the data D needs. If lost updates
show up, `log()`'s own upgrade path applies: a key per session, merged by
`/triage-stats` through `$.store.keys`.

## B. Keep the override across reloads

Closes: the README's "if the mod reloads, the session goes back to its own model
and effort".

Persist `model`, `effort`, `exact`, `running` and `raised` where they change (the
callers of `decide()` and the `/model` and `/effort` handlers) and restore them
in the existing `session.start` hook. On a first load nothing is stored and the
restore does nothing.

Where to keep them is the open part:

- `$.state` is reactive state. It needs `types/index.d.ts`, plus a `types` field
  in `plugin.json` before v2.1.299, and the reference does not say it survives a
  reload.
- `$.store` keyed by `$.session.id()` is documented, but it is shared across the
  machine and needs cleanup: delete the key in `session.end`, and accept
  orphans from sessions that never end.

Spike 2 decides. If `$.state` survives, use it. If not, use the keyed store.

**The value is narrow.** A reload mid-session happens when someone runs
`/reload-plugins`, or saves the mod while it loads from `--plugin-dir`. Both are
listed on the reference page. An installed user who never reloads sees no
change. Build it if mod development is a regular part of the work.

**Pitfall.** A restore must not resurrect an override the person already ended.
`/model` and `/effort` must clear the stored copy as well as the live one.

**Proof.** A test that runs `register` twice against one store and checks the
override returns, and that it does not return after `/model`. If the harness
cannot do that, the check is manual: set an override, run `/reload-plugins`,
read the status line.

## C. Say how much of the plan limit is used

Closes: "the suggestion ignores headroom".

In the first-prompt hook, read `$.session.usage()` alongside the rating call
(`Promise.all`, so it adds no wait). When the highest `rateLimits[].percentUsed`
is at or above a threshold, add one line to the dialog's question, such as
`Plan limit 85% used.`, using the `kind` as the host returns it. Below the
threshold, with an empty list, or when the call fails, add nothing.

**Informational only.** It changes neither the suggested model nor the options.
Dropping the `fable` suggestion when headroom is low would be the mod deciding
for the person, and nothing shows people want that. The line appears only when a
dialog is already shown, so it adds no dialog.

**The threshold is a guess.** 80 percent, as a constant with a comment, not a
setting. Nothing in A's data informs it. Do not show `resetsAt` until the
declarations confirm its type; the page names the field only.

**Proof.** Tests with stubbed usage: below the threshold, no line; at or above
it, one line with the highest percent and its kind; an empty list and a rejected
call, no line and an otherwise identical dialog.

## D. Notice when a session outgrows its rating

Closes: the one-shot finding (cost-evidence.md P4, and the trigger P3-A needs).

This keeps P4's idea, that the session's own size is a better signal than a
second model call, and changes two things:

1. The surface is a line from a `turn.complete` hook, which the reference
   documents, not a dialog opened mid-session, which it does not.
2. The signal is `context.percent` and the turn count together, with thresholds
   read from A's data rather than guessed.

**What the threshold can mean.** A's data says how large `simple` sessions
usually get and where `complex` ones start. It does not record whether a large
`simple` session needed a stronger model, since nothing logs that. So the line
is a size warning, not a detected rating error, and it should say the session is
large, not that the rating was wrong.

Once per session, when a session rated `simple` crosses the threshold, show one
line: the rating, how large the session is now, and `/model` or a new session as
the way out. If effort is still lowered by **Keep model, effort low**, say so and
name `/effort`; that is the harm a grown `simple` session does. Only `simple` is
covered. The opposite miss, a `complex` opener followed by trivial turns, has no
cheap signal, since a quiet session looks like any other.

**Blocked until** A has collected enough sessions that the thresholds are not
guesses, and spike 3 confirms whether `turn.complete` carries `agentId`, so
subagent turns are not counted.

**Proof.** Tests: a `simple` session over the threshold gets one line, once; under
it, none; a `complex` session, none; a subagent turn, none (if `agentId` is
present).

## What not to build

- **A usage readout on the status line.** cost-evidence.md rules out a
  dashboard. The reference does not say what happens when two mods call
  `$.ui.status`, and this mod already writes it through `line()`. C shows the
  one number that matters at the moment it matters.
- **Telemetry.** `$.telemetry` sends a record only when Claude Code or a built-in
  mod makes the call, so a mod people install cannot report through it. The repo
  says no telemetry in any case.
- **`$.model.classify` for the rating.** The mod used it in 0.1.0. Commit
  `df0f611` replaced it with `$.model.complete` and the written rubric, which also
  returns the restatement. It is not new.
- **A model choice for subagents through `agent.spawn`.** The reference says a
  hook can set a starting subagent's model, and the README says subagents keep
  their own. Nothing here shows subagents are where the cost is, and `cost` is
  per session, so A's data would not show it either. It would need its own
  measurement first.
- **Prices, or rubric changes.** As in cost-evidence.md.

## Cost and data

No change adds a model call. A adds one `$.session.usage()` call and one store
read-write at session end. C adds one `$.session.usage()` call per first prompt,
in parallel with the rating. D reads usage each turn, and whether that is cheap
enough is spike 4. B writes the store or state when an override changes.

New stored data is three numbers and one opaque id per decision. No prompt text
and no network request, as today.

## Feasibility spikes (before building)

1. **`session.end` in practice.** Does one usage read plus one store read-write
   finish inside the shared 1.5 seconds? After `/clear`, is the next
   conversation rated again? Decides A's shape.
2. **`$.state` across a reload.** Set a value from a throwaway hook under
   `claude --plugin-dir .`, save the file or run `/reload-plugins`, read it
   again. Decides B's store.
3. **Read the declarations.** The unit and scope of `cost`, whether `rateLimits`
   can be empty and which `kind` values exist, and whether `turn.complete`
   carries `agentId`. Needs an interactive session, since
   `.claude-plugin/types/` is written only by one.
4. **Cost of `$.session.usage()` every turn.** Decides whether D reads it on each
   `turn.complete` or only on `session.measure`.

## Phasing

1. Spikes 3 and 1. Read the declarations, run one throwaway hook. Ship nothing.
2. **A.** Everything else that needs data waits on it.
3. **C**, alongside A. It does not depend on A.
4. **B**, after spike 2, if reloads matter to the work.
5. **D**, once A has enough sessions to set its thresholds.

## Open questions

- Is logging `$.session.id()` consistent with the README's promise that no prompt
  text is logged? It is not text, but it is a new kind of identifier in the
  store. The alternative, `startedAt` from usage, is also an identifier.
- What threshold for C? 80 percent is a guess. What thresholds for D? A's data
  should set them; until then they are guesses.
- Should `/triage-stats` print cost by default, or only on request?
  cost-evidence.md asked this about a visible running cost; it is now concrete
  because the number exists.
- Is B worth building at all if nobody reloads mid-session?

## Sources

- [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference), read
  2026-11-08.
- [cost-evidence.md](cost-evidence.md).
- `hooks/register.ts`: `Decision`, `log()`, `tally()`, `decide()`, and the
  `prompt.submit`, `session.start` and `turn.step` hooks.
- The README's Limits section, for the reload behavior.
