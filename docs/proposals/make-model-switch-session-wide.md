---
status: proposal
type: design
created: 2026-11-15
repo-name: prompt-triage
---

# Proposal: Make prompt-triage's model switch apply to the whole session

> **Deprecated.** The authoritative artifact is the saved prompt at
> `docs/prompts/proposal-make-model-switch-session-wide.md`. This copy is written for one deprecation
> release (plan-agent 6.0.0) and is removed in 6.1.0. Edit the prompt, not this file.

> This is a proposal for review, not an execution plan. It captures measurements from Claude Code
> transcripts and the mod's generated type declarations, and proposes a real session model switch. The
> load-bearing decisions are resolved (see Locked decisions); execution is handed off (see Next step).

## TL;DR

The mod switches models by rewriting main-loop requests in `turn.step`, so Claude Code's background
requests (compaction, `/recap`, prompt suggestions) stay on the session's original model and re-cache
the whole conversation there. In 35 sessions switched to haiku or sonnet, Opus still cost $47.06, more
than the $44.05 spent on the model they switched to. Proposal: after turn 1, queue a real
`/model <pick>` with `$.command.run`; fall back to leading the dialog with lower effort if a spike shows
that is unsafe.

## Context

- `hooks/register.ts:1135-1145` rewrites `model` and `effort` on every main-thread request in
  `turn.step` and skips subagents. The comment at `:1135` says it does this "rather than running /model,
  which cannot run while the prompt waits on this hook". The person's own `/model` clears the override
  (`:1159`).
- Claude Code's changelog (`~/.claude/cache/changelog.md:4562`) names compaction, `/recap` and prompt
  suggestions as background requests that depend on the main conversation's prompt cache. The
  `turn.step` rewrite does not reach them. Prompt suggestions are on in the desktop app and add one
  request after every reply.
- `SessionCost.usd` excludes "the engine's own side queries", so the decision log's `cost` and
  `/triage-stats` leave this spend out and understate what a switched session costs.
- Data: `~/.claude/scripts/token_cost_report.py` plus transcript analysis on 2026-11-15, sessions
  2026-11-03 to 2026-11-15, mod 0.7.2 and earlier. Cost comes from each transcript's `cost-state`
  record, which includes side queries.

## Core finding

> A switch made by rewriting main-loop requests splits one session across two models, and the engine's
> background requests stay on the original model, where each one pays to cache the whole conversation
> again at that model's price.

## Side-by-side

| Dimension | Real switch (chosen) | Effort first | Keep and document (current) |
|---|---|---|---|
| What changes model | The session itself, via a queued `/model` after turn 1 | Nothing new; the dialog leads with "Keep model, lower effort" | Only main-loop requests |
| Background requests | Follow the new model from turn 2 | Stay on the session model | Stay on the original model |
| Prompt cache | One miss at the switch, then shared | Shared | Split |
| Uses the effort lever | No | Yes | No |
| API risk | Needs a spike | None | None |
| Fixes the measured leak | Yes, from turn 2 | Only for people who stop switching | No |

## Locked & resolved decisions

1. **Approach: Real switch.** Chosen in the 2026-11-15 review over Effort first and Keep and document,
   because it removes the cause instead of steering around it.

Settled before this draft:

2. **Turn 1 keeps the `turn.step` rewrite.** `$.command.run` rejects inside a hook the turn waits on.
3. **Explore-to-haiku after a switch up is unchanged** (`register.ts:1150`).

Resolved in the 2026-11-15 review:

4. **Fallback: Effort first.** If the spike shows a plugin-run `/model` changes the person's default
   model beyond the session, or cannot land before the next background request, lead the dialog with
   "Keep model, lower effort" for simple and moderate prompts and demote model switches.

## Workstreams

### A — Spike: plugin-run `/model`

In the desktop app and the CLI: (1) does a non-awaited `$.command.run({ command: 'model', args })`
after `prompt.submit` run once the session is idle after turn 1; (2) does it change only this session,
or also the Code tab picker's remembered choice or `model` in `settings.json`; (3) does the first
post-turn prompt suggestion fire before or after it; (4) does the mod's own `/model` hook stay silent
for its own run; (5) do transcript `api-request` records show background requests on the new model
afterward.

### B — Real switch

Keep the `turn.step` rewrite, queue `/model X` without awaiting it inside `prompt.submit`, and drop the
rewrite once `$.session.model()` reads X. If the run rejects, keep the rewrite. Keep the status line
truthful. Effort overrides are unchanged.

### C — Fallback: Effort first (only if A fails)

Offer "Keep model, lower effort" first for simple and moderate ratings and list the switch after it.
Today it is offered only for simple prompts whose model does not fit (`register.ts:569`).

### D — Visibility and docs

README: say when background requests follow the switch. README decision-log section and
`/triage-stats`: say `cost` excludes Claude Code's own side queries. After release, re-run
`token_cost_report.py` to compare Opus side spend before and after.

## Risks & tensions

- **A plugin-run `/model` may persist as the person's default model.** Stop condition: A item 2; fall
  back to C.
- **One prompt-cache miss when the switch lands at turn 2.** Smaller than the current repeated cost.
- **Turn 1's background requests still run on the original model.** One-time per session.
- **Attribution is unconfirmed.** Turn suggestions off for a few switched sessions to check.
- **Thin evidence.** Mod 0.7.2 and earlier, small rows; D's before/after comparison confirms the fix.

## Open questions (decisions only)

- Should the dialog say that a switch takes full effect from the second prompt?
- In the fallback, should "lower effort" for moderate prompts mean `low` or `medium`?

## Roadmap

| Phase | Work | Size | Depends on |
|---|---|---|---|
| 1 | Spike (A) | S | — |
| 2a | Real switch (B) | M | 1 passes |
| 2b | Effort first (C) | S | 1 fails |
| 3 | Docs and measurement (D) | S | 2a or 2b |

## Appendix A — Measurements

| Group | Sessions | Opus side-call cache writes per session |
|---|---|---|
| Stayed on Opus | 82 | 7,228 tokens |
| Switched Opus to haiku | 15 | 58,068 tokens |
| Switched Opus to sonnet | 16 | 241,632 tokens |

35 sessions switched to haiku or sonnet: $44.05 on the target model, $47.06 on Opus, which produced
47,506 output tokens but wrote 5,527,388 tokens to cache.

## Next step

Convert to an execution plan:
`/plan-agent:implementation-plan Make prompt-triage's model switch apply to the whole session --from-prompt docs/prompts/proposal-make-model-switch-session-wide.md`
