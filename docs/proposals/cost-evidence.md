# Proposal: put evidence behind the mod's cost levers

Status: nothing here is implemented. Written 2026-11-07 against the mod at
`0.4.0` plus commit `880548b`, from the cost review recorded in
[docs/plans/sessions/add-fable-step-down-session.md](../plans/sessions/add-fable-step-down-session.md).
Prices quoted are Anthropic API list prices as of 2026-10-06.

Published as a page at https://claude.ai/artifact/8DVAFtXE1Cjtti2vkgjKX1 — pass
that URL back to republish to it rather than creating a second page.

## Summary

The mod's four open findings are one problem wearing four hats: **its most
expensive decisions rest on one Haiku call reading one sentence, and nothing
ever checks whether the decision helped.**

This proposes four changes, ranked by cost impact per unit of work, plus one
prerequisite. The order matters: measurement comes first because none of the
rest can be validated without it, and the cheapest fix (reordering two dialog
options) is second because it is a one-line change with a measured 35x
justification.

It also names what *not* to build. Three of the obvious moves — a smarter
rubric, a cost dashboard, prices in the dialog — look like they address these
findings and do not.

## Problem

The mod's goal is to put each task on a model that fits it. The review found
that it does this well in one direction and badly in the other, and cannot tell
the difference:

- **The upsell sits on the least reliable rating.** In the repo's own eval
  `simple` scored 8/8 but `complex` scored 5/8 — a Wilson 95% interval of
  31–86%, which does not distinguish a useful classifier from a coin flip. The
  cheap-direction switch runs on the reliable rating; the expensive one does
  not.
- **The eval's errors point at the expensive label.** The recorded misses
  over-rate `complex` prompts as `long-running`, and `long-running` suggests
  `fable` at $10/$50 per MTok. A classifier whose known failure mode is
  over-rating should not have its over-rating wired to the steepest price step.
- **One guess governs an unbounded number of requests.** The rating is taken
  from the first prompt and never revisited, so a session that starts
  `simple` and becomes hard runs the hard part on Haiku, and a `complex`
  opener pays Opus for fifty trivial follow-ups.
- **Nothing measures the outcome.** The eval scores agreement with hand
  labels, not cost per completed task. The cost question cannot currently be
  answered from inside the repo, which is why the review had to reach for
  modelled arithmetic.

`880548b` closed the recoverable half of the first point: a one-tier
over-rating now has a one-click correction. It did not make the evidence any
stronger.

## Goals and non-goals

**Goal.** Every switch the mod offers should be one that a later measurement
could justify, and the mod should keep enough record to run that measurement.

**Non-goal.** Making the rating cleverer. There is no evidence a better rubric
would help, and at 8 cases per class the eval cannot detect whether a change
did. Rubric work is gated on the eval growing, not the reverse.

## P1. Record what the mod did and what it cost

Closes: "nothing measures the outcome". **First because nothing else can be
validated without it.**

On each rated session, append one entry to the mod's store: the rating, the
model before and after, which option the person chose, and the session's turn
count. Add a `/triage-stats` command that prints the tally — how often each
rating fired, how often a switch was accepted, and how the sessions that
accepted one compare with those that did not.

The lazy version is a capped JSON array in `$.store` and a command that reads
it. No dashboard, no telemetry, no network call, no prompt text stored.

This is the change that converts "does this save money" from an argument into
a lookup. After a few weeks of real sessions it also answers, for free,
whether `complex` really is mis-rated in practice and whether anyone ever
accepts the `fable` suggestion.

**Spike needed:** whether `turn.step` can read per-request token usage. If it
can, record it and the tally becomes a real cost figure rather than a turn
count. If it cannot, turn count is a usable proxy and the rest of the proposal
is unaffected.

## P2. Put the big lever first for a simple prompt

Closes: the lever-ordering finding. **One-line change, measured 35x
justification.**

For a `simple` prompt the dialog's first option is `Keep model, effort low`
and the model switch is second. On an Opus default the model switch saves
97.1% of the session (35x); on Fable, 98.8% (82x). Staying on the expensive
model at low effort saves only thinking tokens — and even if low effort halved
every output token, the model switch would still win by roughly 50x.

The README justifies the current order with "lowering effort is often a better
lever than switching models". That is sound guidance at one tier of price gap
and wrong at two or three.

**Proposal:** when the suggested model is two or more tiers below the current
one, offer the model switch first and the effort option second. Keep the
present order when the gap is one tier, where the guidance holds.

This is a reorder inside the existing `options` array, gated on
`rank(current) - RANK[suggested] >= 2`. No new call, no new dialog.

## P3. Stop offering fable on the strength of one sentence

Closes: the remaining half of finding 1.

### A. Defer the suggestion until the session proves long-running (recommended)

Keep rating the first prompt, but do not offer `fable` on it. Hold the
`long-running` label, count main-loop turns, and offer the switch once the
session has actually run long on its original model — a turn threshold, not a
prediction.

A `long-running` task is by definition one that runs for hours over many
steps. Thirty turns in, that claim is evidence rather than a guess, and the
remaining work still dwarfs the switch cost. The information arrives anyway;
the mod currently acts before it does.

Cost of being wrong drops to near zero: a session mis-rated `long-running`
that ends in four turns never sees the dialog at all.

Needs: a turn counter and the ability to open a dialog mid-session rather than
from `prompt.submit`. Both are small; the second needs the spike below.

### B. Require a second confirming call

Rejected. A second Haiku call reads the same sentence and returns a correlated
answer. It adds cost and no new evidence.

### C. Name the price step in the dialog

Rejected on its own, worth shipping beside A. Prices in the mod go stale and
the mod would then assert a wrong number; and telling someone a switch is
expensive does not tell them whether it is *right*. If it ships, word it in
tiers ("two tiers above your current model"), never in dollars.

## P4. Notice when the session contradicts its rating

Closes: the one-shot finding.

The lazy version adds no model call. Watch the turn count against the rating:
a session rated `simple` that passes a threshold was rated wrong. Drop the
`effort low` override, offer the dialog once, and leave it alone thereafter.

A counter, not a classifier. Re-rating with another Haiku call would cost more
and still be a guess; the session's own length is the better signal and it is
free.

This shares its counter with P3-A, so the two are cheaper built together than
apart.

## What not to build

- **Do not grow or tune the rubric yet.** At 8 cases per class the eval cannot
  tell whether a change helped. Any rubric work is unfalsifiable until the
  eval grows.
- **Do not add a cost dashboard or telemetry.** P1's tally is a printed
  command. Anything more is a product the repo has not asked for.
- **Do not hardcode prices.** They change, and a stale price asserted by the
  mod is worse than no price.
- **Do not add step-downs for other ratings.** `880548b` gave `long-running`
  one because the eval measured that specific over-rating. Give another rating
  a step-down when an eval shows it over-rating, not before.

## Prerequisite: grow the eval

Before any change to `RATER` or the rubric, raise
`evals/rating-prompts.json` from 8 to 40–50 cases per class, and have
`scripts/eval-rating.mjs` report per-class Wilson intervals rather than only
per-class percentages. The current overall 84% is carried by the two classes
that scored 8/8, and the class that gates the Opus upsell is the weakest.

This is independent of P1–P4 and can run in parallel. It gates only rubric
work.

## Cost and data

P2 and P4 add no model calls. P3-A moves an existing dialog later in the
session and adds none. P1 adds no model call and writes only counters and
labels to the mod's own store — no prompt text, no network request.

So the proposal is **net-neutral on the mod's own overhead** (which the review
measured at about $0.0002 per session) while strictly reducing the chance of
an unjustified upsell. The savings, if P1 confirms them, come from decisions
not taken.

## Feasibility spike (before building)

1. Can `turn.step` read per-request token usage? Decides whether P1 records
   real cost or a turn-count proxy.
2. Can the mod open a dialog mid-session — from `turn.step` or a timer —
   rather than only while `prompt.submit` holds the prompt? P3-A and P4 both
   depend on it. The refine band already runs work from `$.clock.after`, which
   suggests yes.
3. Does `$.store` hold a growing array reliably across sessions, and what is
   its practical size limit? Sets P1's cap.

## Phasing

1. **P1** — record and report. Everything else is unverifiable without it.
2. **P2** — reorder the simple-prompt options. One line, ship it alongside P1.
3. **P3-A** (+ optional C) — defer the fable suggestion to a turn threshold.
4. **P4** — contradict a wrong rating from the turn count. Shares P3-A's
   counter.

The eval growth runs in parallel and gates rubric work only.

## Open questions

- What turn threshold makes a `long-running` claim credible? 30 is a guess.
  P1's data would set it; until then the threshold is the proposal's weakest
  number.
- Should P1's tally be visible to the person by default, or only on
  `/triage-stats`? A visible running cost may change behaviour more than any
  dialog does.
- Does anyone accept the `fable` suggestion today? If P1 shows nobody does,
  P3 collapses into deleting the suggestion, which is cheaper than any option
  above.
