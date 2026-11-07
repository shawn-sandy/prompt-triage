---
status: todo
type: feature
created: 2026-11-06
repo-name: prompt-triage
workflow: never
artifact-url: https://claude.ai/artifact/Q9ZN1Fr8DFDJGmjNqrPyu8
issue: https://github.com/shawn-sandy/prompt-triage/issues/19
glance: Today a task can only be handed to a new session from the first-prompt dialog, and only when the prompt is rated complex or long-running. When this lands, any prompt in the desktop app can be sent to a new session with one pick in the refine band, and a test proves the pick reaches start_session exactly once.
---

# Plan: Send any prompt to a new session from the refine band

## Objective

Add a "Run in: This session / New session" picker to the refine band that, when set to New session, sends the next prompt with the existing `HANDOFF` context so Claude starts a new session for it, in the desktop app only.

## Context

prompt-triage already hands work to a new session: the first-prompt model dialog offers **Open in a new session** (`NEW_SESSION` in `hooks/register.ts`), and choosing it adds the `HANDOFF` context, which asks the main model to call `start_session` with the prompt as its brief. That offer appears only on the first prompt of a session, only when the prompt is rated `complex` or `long-running` (`STRONG`), and only when a desktop surface is attached (`canHandOff`), because `start_session` exists only in the desktop app.

The refine band proposal (`docs/proposals/refine-band.md`, PR 18) adds a band of pickers above the prompt input. It currently says the new-session option "is not repeated here". This plan reverses that: the band gets a fifth picker, so the hand-off is available for any prompt at any point in the session.

Prerequisite and risks:

- The band does not exist yet. This plan builds on band phase 1 (the `AbovePrompt` render hook, the pick controls and how picks are stored). Step 1 is a gate: nothing else starts until phase 1 is on `main`.
- The `prompt.submit` hook returns early for every prompt after the first (`(await $.session.turns()) > 0`). The armed hand-off has to run before that check, or it would work only on the first prompt.
- A desktop surface can attach or detach mid-session. The picker checks `$.session.surfaces()` when drawing, and the submit hook checks again at send time; if no desktop surface is attached then, the prompt is sent normally and a toast says why.
- The hand-off still costs one main-model turn to call `start_session`, the same as the dialog option today.

## Decisions

- The pick is one-shot (confirmed by the user, 2026-11-06): it applies to the next send and then resets to This session. A sticky pick would silently hand off every later prompt.
- An armed send skips the rating and model dialog entirely (confirmed by the user, 2026-11-06). The prompt is leaving this session, and the new session's first prompt is rated there by prompt-triage anyway. This is also what keeps the dialog from offering **Open in a new session** a second time.
- The hand-off reuses the existing `HANDOFF` string and `NEW_SESSION` label; no second copy of the instruction.
- The prompt is still sent by the user pressing Enter, so the model reads an ordinary user turn. Sending from the band with `$.prompt.submit` was rejected: that marks the prompt as coming from the plugin, not the user.
- The picker is shown only when `$.session.surfaces()` includes `desktop`, matching `canHandOff`. It is not gated on the prompt's rating.
- The plan is red-green-verify: `claude plugin test .` runs `hooks/register.test.ts`, so every behavior change gets a failing test first.
- No lanes: the code changes are in `hooks/register.ts` and its one test file, and the docs steps are small, so the work runs as one chain.

## Files

- docs/proposals/refine-band.md (modified) — add the Run in picker, replace the "not repeated here" line, note the desktop-only and one-shot rules
- docs/prototypes/refine-prompt-band.html (modified) — add the Run in picker and show a hand-off line on send
- hooks/register.ts (modified) — the Run in pick, its band control, and the armed branch in the `prompt.submit` hook
- hooks/register.test.ts (modified) — tests for the armed hand-off, the reset, the desktop gate and the skipped dialog
- README.md (modified) — document the picker beside the dialog's **Open in a new session**

## Steps

### Phase: Prerequisite

1. Confirm band phase 1 is merged to `main` and sync this branch with it. Why: the picker is one more control in the band, and the submit hook change reads the band's pick state. Verify: `git log origin/main --oneline` shows the phase 1 merge, `grep -n "AbovePrompt" hooks/register.ts` matches, and `claude plugin test .` passes before any change.

### Phase: Docs

2. Update `docs/proposals/refine-band.md`: add a "Run in" picker table (This session, New session) after Run mode, replace the "Opening the task in a new session is already offered by the model dialog … not repeated here" paragraph with the one-shot, skip-the-dialog and desktop-only rules, and add Run in to the band layout line. Why: the proposal is the design record, and it currently says the opposite. Verify: `grep -n "not repeated here" docs/proposals/refine-band.md` finds nothing and `npx prettier --check docs/proposals/refine-band.md` passes.
3. Add the Run in picker to `docs/prototypes/refine-prompt-band.html`; when it is set to New session, Send adds a transcript line "(prototype: a new session would start with this prompt as its brief)", skips the model dialog, and resets the picker. Why: the prototype is what reviewers click through, and it should match the proposal. Verify: in the browser, set Run in to New session and press Send: the hand-off line appears, no dialog opens, the picker reads This session again, and `read_console_messages` shows no errors.

### Phase: RED

4. Add a test to `hooks/register.test.ts`: with `surfaces: ['desktop']` and the Run in pick set to New session, a submitted prompt carries a context entry containing `start_session`, and `seen.asked` is empty. Why: this is the objective (an armed send hands off without the dialog). Verify: `claude plugin test .` fails on this test with the context missing `start_session`, not on an import or setup error.
5. Add a test that the pick resets: after one armed send, a second submitted prompt carries no `start_session` context. Why: a sticky pick would hand off prompts the user meant to run here. Verify: `claude plugin test .` fails on this test for the expected reason.
6. Add a test that the hand-off works after the first prompt: with `$.session.turns()` above 0 and the pick armed, the prompt still carries the `HANDOFF` context. Why: the submit hook's early return currently skips every later prompt. Verify: `claude plugin test .` fails on this test because the context is missing.
7. Add a test that with `surfaces: ['terminal']` the band tree has no Run in control and an armed pick (set before the surface changed) sends the prompt without `HANDOFF` and calls `$.ui.toast`. Why: `start_session` does not exist outside the desktop app. Verify: `claude plugin test .` fails on this test for the expected reason.

### Phase: GREEN

8. Add the one-shot Run in pick to the band's pick state in `hooks/register.ts`, and draw its `Select` in the band only when `$.session.surfaces()` includes `desktop`. Why: the control and its state are what the tests read. Verify: `claude plugin test .` passes step 7's band-tree assertion.
9. In the `prompt.submit` hook, before the `turns() > 0` early return, handle an armed pick: reset it, then on desktop return `next({ ...e, context: [...(e.context ?? []), HANDOFF] })` without calling `choose()`, and off desktop toast "No desktop app attached; sent in this session" and fall through. Why: this is the hand-off itself, placed where every prompt reaches it. Verify: `claude plugin test .` passes steps 4 to 7. If tests still fail after 8 iterations, stop and report the exact blocker: the failing assertion, the last diff tried, and what was ruled out. Do not report success.

### Phase: VERIFY

10. Run the full suite and the type check. Why: the hand-off sits in the same hook as the rating, refine and effort paths. Verify: `claude plugin test .` exits 0 with every existing test passing, and `npx tsc --noEmit -p .` exits 0.
11. Document the picker in `README.md` next to **Open in a new session**, and update the `prompt.submit` row of the hooks table to say an armed Run in pick is handled on any prompt. Why: the README's hooks table currently says only the first prompt is touched. Verify: `grep -n "Run in" README.md` matches both places and `npx prettier --check README.md` passes.
12. Walk it by hand in the desktop app with `claude --plugin-dir .`: type a second prompt in a session, set Run in to New session, press Enter. Why: the tests mock the engine; only a real session proves `start_session` is called. Verify: a new session card appears with the prompt as its brief, no model dialog opened, and the band shows Run in: This session afterwards.

## Tests

Tier 1 — This plan changes application code
- Objective: an armed Run in pick hands the next prompt to a new session without the model dialog. File: hooks/register.test.ts; Type: mock; Asserts: the submitted prompt's context contains `start_session` and no dialog was asked; Run: claude plugin test .
- Unit: the pick is one-shot. File: hooks/register.test.ts; Targets: the `prompt.submit` hook; Key cases: second send after an armed one carries no hand-off
- Unit: the hand-off works on any prompt. File: hooks/register.test.ts; Targets: the `prompt.submit` hook; Key cases: `turns()` above 0 with the pick armed
- Unit: desktop gate. File: hooks/register.test.ts; Targets: the band render hook and the `prompt.submit` hook; Key cases: terminal surface hides the control; an armed pick off desktop sends normally and toasts

## Acceptance Criteria

- [ ] In the desktop app, the band shows a Run in picker with This session and New session; in the terminal it does not.
- [ ] With Run in set to New session, pressing Enter sends the prompt with the `HANDOFF` context and no model dialog, on the first prompt or any later one.
- [ ] After that send, the picker reads This session again and the next prompt runs in this session.
- [ ] With no desktop surface attached at send time, an armed prompt is sent normally and a toast explains why.
- [ ] `docs/proposals/refine-band.md` no longer says the new-session option is "not repeated here", and the prototype shows the picker.
- [ ] `claude plugin test .` and `npx tsc --noEmit -p .` exit 0.

## Verification

Run `claude plugin test .` and confirm it exits 0 with the four new tests listed. Then start `claude --plugin-dir .` in the desktop app, send one ordinary prompt so the session has a turn, type a second prompt, set Run in to New session and press Enter: a new session starts with that prompt as its brief, no model dialog appears, and the band's picker reads This session. Repeat in a terminal session and confirm the band has no Run in picker.

## Next Steps

- Offer the hand-off from `/refine-prompt`
  The slash command is the fallback where the band is not drawn; it could take a flag that arms the same hand-off.
  ```text
  In prompt-triage, add a --new-session flag to /refine-prompt that sends the refined prompt to a new session using the existing HANDOFF context in hooks/register.ts. Desktop app only. Write a failing test in hooks/register.test.ts first.
  ```

## Unresolved Questions

- Should the armed send still run the refine checks?
  ```text
  In prompt-triage's refine band plan (docs/plans/add-new-session-band-picker.md), an armed Run in: New session send skips the rating and model dialog. Investigate whether it should still offer the refine review before handing off, and recommend yes or no with the trade-off.
  ```

## Resources

- `docs/proposals/refine-band.md` — the band design this plan extends (PR 18: https://github.com/shawn-sandy/prompt-triage/pull/18)
- `hooks/register.ts` — `NEW_SESSION`, `HANDOFF`, `canHandOff` and the `prompt.submit` hook
- `hooks/register.test.ts` — the existing hand-off tests ("in the desktop app a complex prompt can be handed to a new session", "the terminal is not offered a new session")
