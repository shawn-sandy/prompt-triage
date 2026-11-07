---
session-id: "6af9ba43-aae4-46fb-b55e-69be00fbe354"
date: 2026-11-07
source: "6af9ba43-aae4-46fb-b55e-69be00fbe354.jsonl"
type: session-export
title: "Prompt-triage cost review"
artifact-url: https://claude.ai/artifact/Ewmc1wMx6jToMfZyikmPaR
---

# Prompt-triage cost review and the fable step-down fix

## Summary

An adversarial review of the mod's main workflow — the first-prompt rating in
`hooks/register.ts` — asking whether it actually reduces cost. The answer is
**conditional on your default model**, and the condition is knowable: the mod
saves money when your default sits above your typical task, and costs money
when it does not.

The first verdict given was a flat "no". That was calibrated to a Sonnet
default and was wrong for this repo's own setup. The user challenged the
reasoning (a variable rename running on Fable), the flaw was real, and the
verdict was corrected twice: first to a per-default table, then narrowed to
Opus 5.5 at effort `high`.

For Opus 5.5 at `high` the mod **nets a saving** while long-running sessions
stay rarer than roughly 1 in 43. Two of four ratings offer a real downgrade,
one does nothing, one is a decline-able upsell. All three effort floors are
dead code at that effort.

The direction by default model, from the `fits` logic in `choose()`:

| Default | Upsells it can offer | Net |
| --- | --- | --- |
| fable / mythos | none — both strong ratings already fit | saves on any mix |
| opus | long-running to fable | near break-even, flips past ~1 in 43 |
| sonnet | complex to opus, long-running to fable | net cost |
| haiku | all three | pure cost, no downgrade path exists |

One fix landed: commit `880548b`, local and unpushed.

## Decisions

- **Cost defined as dollars per *completed* task, at API list prices.** A
  cheaper request that needs more turns is not cheaper, so per-request pricing
  would have flattered the weak-model direction. Prices were read from the
  `claude-api` skill's model table (cached 2026-10-06) rather than recalled,
  because the whole verdict rests on the ratios between tiers.
- **Baseline is the same session with the mod uninstalled** — your own default
  model and effort, untouched. Not "haiku for everything" or "opus for
  everything". This measures the mod, not the model.
- **Finding 1 fixed with a one-tier step-down, not by removing the `fable`
  suggestion or adding a confirmation step.** The eval's recorded misses
  over-rate `complex` as `long-running` by exactly one tier, so the correction
  needed is exactly one tier. The existing free-text alias parser already
  routes `"Switch to opus"` to opus, so the change needed no new parsing.
- **`STEP_DOWN` derives its value from `SUGGEST.complex`** rather than
  hardcoding `'opus'`, so the suggestion and its step-down cannot drift apart.
- **Commit subject labelled `fix(hooks)`, not `feat(hooks)`.** `bump-version`
  reads the subject: `feat:` takes 0.4.0 to 0.5.0, anything else to 0.4.1. A
  36-line additive change closing a known failure mode is a patch, and the
  change is semantically a fix — the dialog was missing a recovery path for an
  error the eval had already measured.
- **The effort-level cost multiplier was left unquantified.** No measured
  figure for what `medium` to `high` costs in thinking tokens was available,
  and inventing one would have put a fabricated number into a cost argument.
  The claim was instead made robust to the unknown: even if low effort halved
  every output token, the model switch still wins by ~50x.

## Learnings

- **The session-shape assumption was the flaw in the analysis, and it is an
  easy one to repeat.** Modelling each rating with a session shape *matched to
  that rating* quietly assumes the user was already on a sensible model, so
  every switch only moves them a little. That hides the mismatch case — a
  trivial task sitting on an expensive default — which is exactly where the
  savings come from. A cost model that assumes the user is already roughly
  right cannot see the value of correcting them.
- **"Net if every rating occurs once" is a bad statistic.** It weights one
  200-turn migration equal to one variable rename. No real user has that mix,
  and it was what drove the wrong headline. The assumption-light replacement is
  a break-even *frequency*: on Opus 5.5, 42 moderate or 227 simple downgrades
  per accepted fable upsell, so the mod stays net-positive while migrations are
  rarer than about 1 session in 43.
- **On a Fable or Mythos default, no upsell path exists at all.** Both strong
  ratings already satisfy `fits` (rank 3 >= 2 and 3 >= 3), so every switch the
  dialog can offer is a downgrade. It saves on any prompt mix, with no
  break-even condition. Checking `fits` across all four defaults turned out to
  be the single most clarifying thing in the review.
- **On Opus 5.5 at effort `high`, all three effort floors are dead code.**
  `LEVELS.indexOf('high')` is 2, and no floor exceeds it: `moderate`'s medium,
  `complex`'s high and `long-running`'s high all fail the `<` comparison. The
  feature fires only after a hand-lowered effort, which is what the README
  claims — so the claim is accurate, and the feature is quieter than the space
  it gets.
- **The rating's accuracy asymmetry favours the cheap direction.** In the
  repo's own eval `simple` scored 8/8 while `complex` scored 5/8 (Wilson 95%
  CI 31–86%). The downgrade path runs on the most reliable rating; the upsell
  path runs on the least reliable one. That is a point in the mod's favour that
  the first review missed by attacking `complex` in isolation.
- **Wilson intervals on n=8 are too wide to act on.** 5/8 spans 31–86%, which
  cannot distinguish a good classifier from a coin flip. 40–50 cases per class
  would be needed before the per-class numbers support a 2x price decision.
- **The dialog puts the weaker lever first.** For a `simple` prompt the first
  option is `Keep model, effort low` and the model switch is second. At a 35x
  (opus) or 82x (fable) price gap the model switch dominates by a wide margin.
  The README justifies the order with "lowering effort is often a better lever
  than switching models", which is sound general guidance and wrong at those
  gaps. Left unfixed.
- **Gotcha: the shell safety check rejects long single-quoted `node -e`
  scripts.** A script containing `$` and backticks was refused with "could not
  be checked for dangerous rm operations: the shell may read it differently
  than it was parsed", despite containing no `rm`. Writing the script to the
  scratchpad and running `node <file>` is the reliable path, and the same
  applies to commit messages via `git commit -F <file>`.
- **Gotcha: the test suite runs fully offline.** Every `claude plugin test .`
  run reported a sandbox denial for `api.anthropic.com:443`, and all 93 tests
  still passed, because the suite drives the mocked engine. The denial is noise,
  not a failure — worth knowing before chasing it.
- **No `ant` CLI on this machine, so `count_tokens` was unavailable.** Prompt
  sizes came from exact character counts (`RATER` is 1,304 chars, `REVIEWER`
  823) with a stated 3.6 chars/token conversion, labelled as derived rather
  than measured.

## Open findings, not addressed

- The `long-running` upsell still fires on one Haiku call; the dialog is its
  only gate. Making the *evidence* stronger (a token or turn threshold crossed
  mid-session) is a different change.
- The rating is taken once, from the first prompt, and governs every main-loop
  request for the rest of the session. Already named in
  `docs/plans/implement-model-selection-findings.md` as "one blind guess".
- Nothing measures the outcome. The eval scores label agreement, not cost per
  completed task, so the cost question cannot be settled from the repo — which
  is why this review is modelled arithmetic rather than a measurement.
- The lever ordering for `simple` prompts, above.

## Files touched

| Path | What changed |
| --- | --- |
| `hooks/register.ts` | `STEP_DOWN` map (one entry, derived from `SUGGEST.complex`) and the `below` option in `choose()`, gated on the step-down being a step up from the current model |
| `hooks/register.test.ts` | Two tests: the step-down is offered for `long-running` on sonnet, and is not offered for `complex` |
| `README.md` | The new behaviour under "What it does", its boundary under "Limits" |

Verification: `claude plugin test .` 93 pass / 0 fail (two added, one written
to fail first and watched failing on the missing option), `claude plugin
validate .` passes. Committed as `880548b` on
`claude/plugin-cost-reduction-review-2beaea`; not pushed, no PR.
