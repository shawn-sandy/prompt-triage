---
type: proposal
intent: Make prompt-triage's model switch apply to the whole session so Claude Code's background requests stop running on, and re-caching the conversation at, the original model.
techniques: Long-context grounding, XML structure, Comparison tables, Positive framing, Output format
created: 2026-11-15
modified: 2026-11-15
status: converged
generated-sha: 792b5cc0d8597db12128c34c33417f6388ca3cb284739826d3ddf0a4e2a81b6d
---

# Proposal: Make Model Switch Session Wide

> This is a proposal for review, not an execution plan. It carries the
> grounded research and the decisions already made; the final instruction
> below hands off to drafting an execution plan from it.

<tldr>
The mod switches models by rewriting main-loop requests in `turn.step`, so Claude Code's background
requests (compaction, `/recap`, prompt suggestions) stay on the session's original model and re-cache the
whole conversation there. In 35 sessions switched to haiku or sonnet, Opus still cost $47.06, more than
the $44.05 spent on the model they switched to. Proposal: after turn 1, queue a real `/model <pick>` with
`$.command.run` so the session itself switches and background requests follow. If a spike shows that is
unsafe, fall back to leading the dialog with lower effort.
</tldr>

<context>
- **What exists.** `hooks/register.ts:1135-1145` rewrites `model` (and `effort`) on every main-thread
  request in `turn.step` and skips subagents (`e.agentId`). The comment at `:1135` says it does this
  "rather than running /model, which cannot run while the prompt waits on this hook". `agent.spawn`
  (`:1150`) moves the built-in Explore to haiku after a switch up. The person's own `/model` clears the
  override (`:1159`).
- **Background requests.** Claude Code's changelog (`~/.claude/cache/changelog.md:4562`) names
  compaction, `/recap` and prompt suggestions as background requests that depend on the main
  conversation's prompt cache. A rewrite in `turn.step` does not reach them, so they keep the session
  model. Prompt suggestions are on in the desktop app (Code tab setting `prompt_suggestions` = true) and
  add one request after every reply.
- **Visibility.** `SessionCost.usd` in the mod declarations sums "every priced API response this
  session, a mod's `$.model` calls among them; the engine's own side queries stay out". The decision
  log's `cost`, and so `/triage-stats`, leave this spend out entirely and understate what a switched
  session costs. The mod cannot measure the leak itself.
- **Data source.** `~/.claude/scripts/token_cost_report.py` plus one-off transcript analysis on
  2026-11-15, covering sessions from 2026-11-03 to 2026-11-15 on installed mod 0.7.2 and earlier (main is
  now 0.7.5). Cost comes from each transcript's `cost-state` record, Claude Code's own `/cost` tally,
  which includes side queries.
- **Approach:** Real switch, over Effort first and Keep and document.
</context>

<finding>
A switch made by rewriting main-loop requests splits one session across two models, and the engine's
background requests stay on the original model, where each one pays to cache the whole conversation
again at that model's price.
</finding>

<comparison>
| Dimension | Real switch (chosen) | Effort first | Keep and document (current) |
|---|---|---|---|
| What changes model | The session itself, via a queued `/model` after turn 1; the `turn.step` rewrite covers turn 1 | Nothing new; the dialog leads with "Keep model, lower effort" and demotes switches | Only main-loop requests, via `turn.step` |
| Background requests (compaction, `/recap`, suggestions) | Follow the new model from turn 2 | Stay on the session model, which is also the main model for anyone who keeps it | Stay on the original model |
| Prompt cache | One miss at the switch, then one shared cache | One shared cache | Split: original-model side calls re-cache the conversation |
| Uses the lever the data ties to cost (effort) | No | Yes | No |
| API risk | Needs a spike: `$.command.run` timing, whether `/model` persists past the session | None | None |
| Fixes the measured leak | Yes, from turn 2 | Only for people who stop switching | No |
</comparison>

<decisions>
Locked and resolved — treat these as settled; do not reopen them:
1. **Approach: Real switch.** Chosen in the 2026-11-15 review over Effort first and Keep and document,
   because it removes the cause instead of steering around it.

Settled before this draft:
2. **Turn 1 keeps the `turn.step` rewrite.** `$.command.run` rejects "inside a hook the turn or the
   session's start waits on", so the real switch cannot happen before the first turn runs.
3. **Explore-to-haiku after a switch up is unchanged** (`agent.spawn`, `register.ts:1150`).

Resolved in the 2026-11-15 review:
4. **Fallback: Effort first.** If the spike shows a plugin-run `/model` changes the person's default
   model beyond the session, or cannot land before the next background request, ship Effort first
   instead: lead the dialog with "Keep model, lower effort" for simple and moderate prompts and demote
   model switches. Applies to Workstream C and Roadmap phase 2b.
</decisions>

<workstreams>
**A — Spike: plugin-run `/model`.** Answer with a throwaway mod or a branch of `register.ts`, in the
desktop app and the CLI:
1. Does `void $.command.run({ command: 'model', args: '<alias>' })`, called after `prompt.submit`
   returns, run once the session is idle after turn 1?
2. Does it change only this session, or also the Code tab model picker's remembered choice or `model`
   in `settings.json`?
3. Does the first post-turn prompt suggestion fire before or after it?
4. Does the mod's own `command.run` hook for `model` (`register.ts:1159`) stay silent for the mod's own
   run? The declarations say a plugin's run goes "through every hook but the calling one".
5. Do transcript `api-request` records show background requests on the new model afterward?

**B — Real switch.** After a "Switch to X" answer, keep the `turn.step` rewrite, queue `/model X`
through `$.command.run` without awaiting it inside `prompt.submit`, and drop the rewrite once
`$.session.model()` reads X. If the run rejects, keep the rewrite. Keep the status line truthful: once
the session model is X, "running X, not Y" no longer applies. Effort overrides are unchanged.

**C — Fallback: Effort first (only if A fails).** Offer "Keep model, lower effort" first for simple and
moderate ratings and list the switch after it. Today `LOW_EFFORT` is offered only for simple prompts
whose model does not fit (`register.ts:569`).

**D — Visibility and docs.** In the README paragraph on what the switch applies to, say that background
requests follow the switch from turn 2 (or, under C, that they keep the session model). In the README
decision-log section and the `/triage-stats` output, say `cost` excludes Claude Code's own side queries.
After release, re-run `~/.claude/scripts/token_cost_report.py` to compare Opus side spend in switched
sessions before and after.
</workstreams>

<risks>
- **A plugin-run `/model` may persist as the person's default model.** The Code tab picker remembers its
  choice per user. Stop condition: Workstream A item 2; fall back to C.
- **One prompt-cache miss when the switch lands at turn 2.** Smaller than the current cost, where every
  background request on the original model re-caches the conversation.
- **Turn 1's background requests still run on the original model.** In practice the first suggestion;
  a one-time cost per session.
- **Attribution is unconfirmed.** Prompt suggestions are the likely main source; compaction and `/recap`
  are the other named background requests. Turn suggestions off for a few switched sessions and check
  Opus spend.
- **Thin evidence.** The data is from mod 0.7.2 and earlier, with one or two sessions in some rows. The
  before/after comparison in D is what confirms the fix.
</risks>

<open-questions>
Decisions still owned by the human — surface them, do not answer them:
- Should the dialog say that a switch takes full effect from the second prompt?
- In the fallback, should "lower effort" for moderate prompts mean `low` or `medium`?
</open-questions>

<roadmap>
| Phase | Work | Size | Depends on |
|---|---|---|---|
| 1 | Spike: plugin-run `/model` (A) | S | — |
| 2a | Real switch (B) | M | 1 passes |
| 2b | Effort first (C) | S | 1 fails |
| 3 | Docs and before/after measurement (D) | S | 2a or 2b |
</roadmap>

<appendices>
Appendix A — Measurements (2026-11-03 to 2026-11-15, from transcripts' `cost-state` and `api-request` records)

| Group | Sessions | Opus side-call cache writes per session | Note |
|---|---|---|---|
| Stayed on Opus | 82 | 7,228 tokens | side calls reuse the main cache |
| Switched Opus to haiku | 15 | 58,068 tokens | |
| Switched Opus to sonnet | 16 | 241,632 tokens | |

- 35 sessions switched to haiku or sonnet: $44.05 on the target model, $47.06 on Opus. Opus produced
  47,506 output tokens in those sessions but wrote 5,527,388 tokens to cache.
- Example: one opus-to-sonnet session cost $6.09, of which Opus took $3.67 for 28 output tokens.
- Switch detection: the first main-thread request's model differs from the session's `model` attachment
  and carries most of its requests. 44 post-plugin sessions match; 0 of 248 pre-plugin sessions do.

Appendix B — API surface (generated declarations, `.claude-plugin/types/claude-code/index.d.ts`, written 2026-11-15)

- `$.command.run` runs a slash command "as if the person typed `/command args`", queued and run once the
  session is idle. It rejects inside a hook the turn waits on.
- `$.session.model()` is read-only: "Returns the main loop's model, as /model shows it." There is no
  setter.
- A `prompt.suggest` hook can drop a suggestion with `{ isShown: false }`, but it fires once the text
  exists, after the request is paid, so it cannot save cost.
- `SessionCost.usd` excludes "the engine's own side queries".
</appendices>

Author an execution plan for Workstreams A through D in roadmap order. Start with the spike in A and make
its five answers the gate: phase 2a when they pass, phase 2b when item 2 or item 3 fails. Draft real
steps that name the functions and lines in `hooks/register.ts` and the README sections each one touches,
plus the tests in `hooks/register.test.ts` that prove it; do not restate the headings above as steps.
Treat the locked decisions as settled inputs, and carry the open questions into the plan's
unresolved-questions section rather than answering them.
