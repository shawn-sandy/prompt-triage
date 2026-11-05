---
session-id: "4201b98c-22e4-43b8-bb14-92a0eb8f8c5f"
date: 2026-11-05
source: "4201b98c-22e4-43b8-bb14-92a0eb8f8c5f.jsonl"
type: session-export
title: "Model selection against cost, latency and quality"
artifact-url: https://claude.ai/artifact/V44hgnbSkbxLUbubVgWEFR
---

# Model selection against cost, latency and quality

## Summary

A findings-only review of how prompt-triage picks a model, measured against
Anthropic's "Choosing the right model" guide. No code changed.

The biggest wins are not in the model map. They are giving the classifier a
rubric, not letting a "simple" first prompt lock a whole session on Haiku,
fixing two ranking gaps (Mythos, and "use fable" doing nothing), and raising
the refine review's output cap. The session then turned every finding into a
red-green-verify implementation plan, including a Fable rating tier and an eval
set to check the new rubric: https://claude.ai/artifact/YHCLETXQ1sQCKmRuNf7Zwm

Nothing was measured. The claims come from reading the code, the mod API
types and the docs, plus one script run of the model-ranking logic.

## How model selection works today

All of it lives in `hooks/register.ts`.

- **When:** only the first prompt of a fresh session is rated (line 180).
  Slash commands, meta prompts and resumed sessions are skipped.
- **Rating:** `$.model.classify(text, ['simple','moderate','complex'])` on the
  engine's default small, fast model (line 128). The labels are bare words.
- **Model map:** simple to `haiku`, moderate to `sonnet`, complex to `opus`
  (line 4). Fable is never suggested.
- **When it asks:** a complex prompt counts as matched when the current model
  ranks at or above opus (line 136). Simple and moderate need an exact family
  match, so a cheaper model is offered even on a stronger one.
- **Switch:** `turn.step` rewrites the model on every main-loop request for the
  rest of the session (line 222). Subagents are left alone.
- **Effort minimum:** none for simple, `medium` for moderate, `high` for
  complex. Main loop only, and it only ever raises effort (lines 7 and 217).
- **Refine:** `$.model.complete` on `haiku`, default effort, default
  `maxTokens`, 30-second timeout (line 44).

## What the guide says that matters here

- "Tuning effort is often a better lever than switching models."
- Default effort differs by model: `medium` on Opus 5.5 and Haiku 5.5, `high`
  on Sonnet 5.5 and Fable 5.1.
- Most workloads should start on Opus 5.5. Move to Fable 5.1 only when Opus at
  `xhigh` or `max` effort still falls short.
- Haiku 5.5 is for classification, routing, high-volume work and subagents.
- A use-case evaluation set is "the most important step" in choosing a model.

| Model | Price per MTok (in / out) | Latency | Default effort |
| --- | --- | --- | --- |
| Fable 5.1 | $10 / $50 | Slower | high |
| Opus 5.5 | $4 / $20 | Moderate | medium |
| Sonnet 5.5 | $2 / $10 | Fast | high |
| Haiku 5.5 | from $0.10 / $0.50 | Fastest | medium |

## Findings, by priority

1. **The classifier has no rubric.** The three labels reach the classifier with
   no definitions, while the guide ranks models by task shape. `classify`
   returns the label string it picks, so descriptive labels (mapped back to a
   rating) or a `complete` call with a short rubric would fix it at no extra
   cost.
2. **A "simple" rating can lock the session on Haiku.** The rating uses the
   first prompt only, but the switch lasts the whole session. Offering "keep
   this model at effort `low`" first, or ending the Haiku switch after one turn,
   follows the guide's effort-first advice.
3. **The model ranking has gaps.** `claude-mythos-5-1` ranks -1, so a complex
   prompt on Mythos is offered a downgrade to opus. A picker label such as
   "Default (recommended)" would do the same, if `$.session.model()` ever
   returns one (unverified). "use fable" switches nothing, because `fable` is
   not an accepted name.
4. **The refine review can fail on long prompts.** `maxTokens` defaults to 1024
   per the API types. Issues, questions and a full rewrite can exceed it, the
   closing `</prompt>` tag is lost, and the person sees "The review failed".
5. **Effort minimums ignore each model's default.** At default effort the
   `medium` minimum changes nothing on any current model, and the `high`
   minimum only bites on Opus 5.5 and Haiku 5.5.
6. **Rating adds latency before the first prompt is sent.** `classify` takes no
   effort or token cap. A `complete` call at effort `low` with a small cap
   might be faster; measure first.
7. **No evals.** Tests cover the wiring, not rating quality. One script running
   about 30 labeled prompts through the classifier would cover the guide's main
   advice.
8. **Low priority:** a fourth rating for long-running agent work mapped to
   Fable, and fast mode, which the mod does not use.

## Recommendations

These are the changes the implementation plan commits to, after the scope
questions and the plan interview. Each test is written to fail first.

| Finding | Recommendation |
| --- | --- |
| 1 and 6 | Rate with `$.model.complete` on `haiku`: effort `low`, `maxTokens` 256, 10-second timeout, and a rubric that defines each label |
| 2 | For a simple prompt, offer "Keep model, effort low" first; Haiku stays as an option |
| 3 | Rank `mythos` with `fable`, treat unknown model names as strong enough, accept "use fable" |
| 4 | Size the refine review's `maxTokens` to the prompt, at least 4096 |
| 5 | Keep the effort minimums and document them as a guard against a hand-lowered effort |
| 7 | Add about 30 labeled prompts and a `claude -p` script that scores the rubric against the old bare-label prompt |
| 8 | Add a fourth rating, `long-running`, that suggests Fable at effort `high` |

Fast mode stays out of scope. Combining the rating with PR #14's restatement
call into one request is a follow-up in the plan.

## Decisions

- **Findings first, then a plan.** The brief asked for a report with no code
  changes. The plan came after and changes no code either.
- **Suggest Fable through a fourth rating.** The first recommendation held this
  back, since the guide says to move to Fable only after Opus at high effort
  falls short and Fable costs 2.5 times Opus per token. The user chose to
  include it; the plan's eval set is what checks it.
- **Add `mythos` to the ranking alongside `fable`.** This stops the wrong-way
  downgrade offer on Mythos.
- **Build on open PR #14.** It rewrites the same dialog and adds a `restate()`
  call, so the plan waits for it to merge.
- **A 256-token cap and a 10-second timeout on the rating call.** Only produced
  tokens are billed, so 256 costs nothing extra over 64 and leaves room if
  thinking counts against it. The timeout matches PR #14's restate call.
- **The rubric must at least match the baseline** on the labeled set, with no
  unlabeled replies, rather than an invented target number.

## Learnings

- **Fable is in the code only as a guard.** It entered the ranking list in the
  "Ask clarifying questions in Improve prompt" pull request (#9) to stop a
  complex prompt on Fable being offered opus. Nothing ever suggests it, and the
  commit history gives no reason it was left out of the model map.
- **The mod API types are not in this worktree.** `.claude-plugin/types` is
  gitignored. The types were read from a sibling worktree at a different
  commit, so API details may differ slightly.
- **Two other worktrees overlap this work.** `model-selection-optimization-623866`
  covers the same topic, and `prompt-review-optimize-a79564` likely touches the
  refine code from finding 4.

## Files touched

- `docs/plans/sessions/optimize-model-selection-session.md`: this recap.
- `docs/plans/implement-model-selection-findings.md`: the implementation plan spec.
- `docs/plans/index.html`: the plans gallery, regenerated. No source files
  changed.
