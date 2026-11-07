# Proposal: a prompt refinement band above the prompt input

Status: proposal, not implemented. Written 2026-11-06 against Claude Code build
2.1.317 (the mod API types that build ships) and the Anthropic docs pages listed
under [Sources](#sources), read the same day.

## Summary

Add a one-row band directly above the prompt input. While the prompt box holds
a draft, the band shows a few pickers (Goal, Workflow, Scope, Run mode) and a
**Refine** button. Pressing it sends the draft and the chosen options to the
review prompt-triage already has, asks up to three questions when a fact only
the user knows is missing, and puts the rewrite back in the prompt box for the
user to edit or send. Nothing is sent to the main model until the user presses
Enter.

**Recommendation:** build it as a mod, inside the existing `prompt-triage`
plugin, using the `AbovePrompt` render slot. Keep `/refine-prompt` as the path
for surfaces that do not draw the band (the VS Code extension, mobile, `-p`
runs). Reject a separate VS Code extension and a classic `UserPromptSubmit`
command hook; neither can draw above the prompt or write into it.

## Problem

prompt-triage can already refine a prompt, but only in two places:

- The model dialog's **Refine prompt** option, which appears only on the first
  prompt of a session, only after Enter, and only when the dialog is shown at
  all.
- `/refine-prompt <prompt>`, which means retyping or pasting the prompt as an
  argument.

Neither lets the user say _how_ to refine. The reviewer
(`REVIEWER` in [hooks/register.ts](../../hooks/register.ts)) checks for a
missing goal, scope, done-criteria, ambiguity, contradictions and placeholders,
then rewrites. It does not know the user wants a plan-first workflow, a
verifiable done-check, or a deliberately ambitious build, and it does not apply
the current Claude Code guidance on what to leave out of a prompt.

## Mechanism options

| Option                                                              | Above the prompt?                         | Reads the draft?        | Writes the draft?      | Surfaces                                   | Verdict                       |
| ------------------------------------------------------------------- | ----------------------------------------- | ----------------------- | ---------------------- | ------------------------------------------ | ----------------------------- |
| A. Mod band (`ui.render` on `AbovePrompt`)                          | Yes                                       | Yes, `$.prompt.read()`  | Yes, `$.prompt.fill()` | Terminal, desktop Code tab                 | **Recommended**               |
| B. Extend the existing first-prompt dialog (`$.ui.ask`)             | No, a dialog after Enter                  | Gets the submitted text | Yes, after the dialog  | Wherever the dialog draws                  | Keep as is; not the main path |
| C. Slash command or skill (`/refine-prompt --goal ...`)             | No                                        | Only its argument       | Yes (mod command)      | All, including where the band is not drawn | Keep as the fallback          |
| D. Classic plugin hook (`UserPromptSubmit` command in `hooks.json`) | No                                        | Gets the submitted text | No                     | All that load hooks                        | Reject                        |
| E. `PromptHint` tail text                                           | No, dim text on the hint line             | n/a                     | No                     | Terminal only                              | Optional nudge only           |
| F. Separate IDE extension (VS Code Marketplace)                     | Its own webview, not Claude Code's prompt | No API found            | No API found           | VS Code only                               | Reject                        |

### A. Mod band (recommended)

The mod API has a render slot for exactly this. From the build 2.1.317 types:

- `AbovePrompt` is "the band directly above the prompt input, where the surveys
  draw". A `ui.render` hook on `{ component: 'AbovePrompt' }` returns a tree,
  or calls `next(e)` to show nothing. Its props include `hasSurvey` (yield to a
  survey) and `isWorking` (a turn is running). It is "raised on the terminal and
  desktop surfaces only".
- The band can hold `Select` ("every surface's one-of-several picker"),
  `Button` (with an optional one-character `hotkey`), and `Text`. The plugin
  authoring kit ships a working example, `band.tsx`.
- `$.prompt.read()` returns the draft and cursor; it "never rejects" and gives
  `''` where there is no prompt box.
- `$.prompt.fill({ text })` replaces the draft. It answers `isFilled: false`
  "under a dialog or headless", so the fill must happen after any question
  dialog closes. prompt-triage's `improve()` already does this in that order.
- `prompt.edit` fires on each edit the user makes, and `prompt.change` on any
  other change (a fill, a clear, a submit). Either can recompute whether the
  band should show (the draft is non-empty, is not a slash command, and meets
  the `band` setting's length or line-break rule) and write that answer to an
  atom, so the band redraws only when the answer changes, not on every key.
  A result row, once shown, takes precedence over that rule until **Done**,
  **Restore original** or a send, so it stays after an `As /goal` rewrite or a
  short one. `band: never` and a survey still hide it.
- `$.store` keeps values across sessions, so the last-used picks can persist.

What it cannot do, or what is unverified:

- The band is one instance. A survey takes it (`hasSurvey`), and another mod
  whose `AbovePrompt` hook draws without calling `next` hides this one. The
  band must yield in both cases.
- Band buttons need the band focused (`ctrl+x tab` or a click). A bare digit in
  an _empty_ composer presses a band button, but our band only shows when the
  composer is not empty. `Button.action` can bind an existing engine
  keybinding so a chord presses Refine from the prompt; which action name to
  bind is an open question.
- Not verified on this build: that `$.ui.ask` works from a band button's
  `onPress` handler, and how `Select` lays out on the desktop surface. Both are
  in the spike below.

### B. The existing first-prompt dialog

Already shipped. It runs after Enter, on the first prompt only, and each
question is one dialog with 2 to 4 options. Adding four option pickers there
would mean four extra dialogs before every refine. Keep the dialog's
**Refine prompt** option, have it use the band's stored picks, and shorten the
message it leaves (see [Dialog path](#dialog-path)).

### C. Slash command or skill

`/refine-prompt` works on every surface that loads the mod and is the right
fallback where the band is not drawn. It can take the same options as flags
(`/refine-prompt --workflow plan --goal check <prompt>`), but flags are
something to remember, not something to pick. A plain skill (no mod) would run
the refinement in the main model's turn, costing a main-model turn instead of a
`haiku` call, and could not write the prompt box.

### D. Classic `UserPromptSubmit` hook

A command hook in `hooks.json` runs after Enter. Its output can block the
prompt (`decision: "block"`), add `additionalContext`, or show a
`systemMessage`; the hooks reference says it "can't replace the prompt". None
of its fields draws pickers or fills the prompt box, so it cannot offer options
or hand back an editable rewrite. Reject.

### E. `PromptHint` tail

`PromptHint.tail` adds dim text after the engine's hint line. The types say
"no other surface draws it yet" besides the terminal. Useful at most as a
one-line nudge ("ctrl+x tab: refine"); not a home for pickers.

### F. Separate IDE extension

A VS Code extension is distributed through the VS Code Marketplace, not the
Claude Code plugin marketplace, and I found no documented API for it to read or
write Claude Code's prompt box. Reject.

## Trigger and presentation

### When the band shows

- Shown when the prompt box holds a draft, no survey holds the band, and the
  draft is not a slash command. Hidden otherwise, by calling `next(e)`.
- Shown while a turn runs too (`isWorking`), since a user can type the next
  prompt during a turn; the review is a separate `haiku` call and does not
  touch the running turn.
- A `userConfig` field `band` with options `always`, `long` (default: drafts of
  40 characters or more, or with a newline) and `never`. `never` leaves
  `/refine-prompt` and the dialog option as the only paths.
- No review runs while typing. A review costs a model call, and a band that
  changes under the user's cursor is a distraction. The band only reacts to the
  button.

### Layout (terminal, one row; the desktop draws the same tree natively)

```text
Refine  Goal: Auto  Workflow: As written  Scope: As written  Run: Watching  Run in: This session   [r] Refine
```

Run in is drawn in the desktop app only (see [Run in](#run-in-this-session-or-a-new-one)).

Each label is a `Select`. Picks are saved to `$.store` and come back next
session. **Refine** has hotkey `r` once the band has focus.

### What pressing Refine does

1. Read the draft with `$.prompt.read()`. If it is empty, do nothing.
2. Save the original draft in an atom.
3. Run `review()` with the draft and the selected options (see below).
4. Ask up to three questions through `$.ui.ask`, as `/refine-prompt` does now.
5. Read the draft again. If it no longer matches the saved original, the user
   kept typing during the review: leave the draft alone and show a toast
   ("The draft changed during the review; press Refine again"), then stop:
   no result row, and the first prompt is not marked refined, so **Restore
   original** cannot overwrite the new edits. Otherwise put the rewrite in the
   box with `$.prompt.fill()`.
6. Switch the band to a result row: the issue count, **Show issues** (expands
   the list inside the band, which scrolls past `maxRows`), **Restore
   original**, and **Done**. Restore fills the saved original back. This does
   not rely on the prompt box's own undo, whose behavior after a fill I did not
   verify.
7. Mark the session's first prompt as already refined, so the model dialog
   does not offer **Refine prompt** a second time for the same text. The rating
   and model dialog still run when the user sends it.

If the review fails or times out, show a `$.ui.toast` ("Review failed; the
prompt was not changed") and leave the draft alone.

### Dialog path

Picking **Refine prompt** in the model dialog happens after Enter, so the
`prompt.submit` hook has to stop the send with `{ drop: reason }`. The app
draws that reason under its own "A hook blocked your prompt" heading. Today the
reason is the whole review joined into one sentence by `asLine`, because the
app draws it on a single row. That reads as an error, and a long issue list
does not fit the row.

Proposed:

- When `$.prompt.fill` answers `isFilled: true`, the reason is one line:
  "Held for review: N issues. The improved prompt is in the prompt box; the
  issues are listed below."
- The issue list always goes to a `$.session.append` notice of type `system`.
  The band may not be drawn at that moment: `band` set to `never`, a survey
  holding the band, or another mod's band hiding this one. The mod cannot tell
  the last case apart, so the notice is the one place the list is sure to be.
- Where the band does draw, it also switches to the result row (step 6 above),
  with **Show issues** and **Restore original**, the same as a band refine.
- When the fill answers `isFilled: false`, the reason keeps today's full text,
  rewrite included, since the drop reason is then the user's only copy of it.

The mod controls only the reason text. The heading and its styling belong to
the app, so the shorter line may still sit under "A hook blocked your prompt".
The prototype's proposed style hides that heading, which is the best case, not
a promise; spike check 6 settles it.

## Refinement options

Each pick adds one short instruction to the reviewer's system prompt. Every
option defaults to leaving the prompt as written, so the band with no picks
behaves like today's review plus the always-on checks.

### Always on (not a picker)

These come from the current docs and apply to every refine:

| Check                                                            | What the rewrite does                                                                                                                                                                                                                                                                                                                                                                                                               | Source                                                                        |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Missing goal, scope, done-criteria, contradictions, placeholders | Today's reviewer behavior, unchanged, except that Goal: Off drops the goal and done-criteria parts                                                                                                                                                                                                                                                                                                                                  | Existing `REVIEWER`                                                           |
| Tell Claude what it can't see                                    | Asks for facts not in the repo (a decision, a required env var, a preference between two approaches). Does not add file layout or conventions Claude can read itself.                                                                                                                                                                                                                                                               | CC best practices: "Tell Claude what it can't see", "Write a specific prompt" |
| Hand it over instead of describing it                            | Does not add `@` itself, since `@path` includes the file's contents before any instruction in the prompt is read: "do not read secrets.json" would send the file. Where the prompt asks Claude to read or change a path that `$.fs.exists` confirms (the check `review()` already runs on named paths), it lists an issue suggesting `@path`; the user adds it. A path the prompt excludes, or a file to create, gets no suggestion | CC best practices; Common workflows: "Reference files and directories"        |
| Drop advice current models no longer need                        | Removes `think hard` / `be thorough`, ALL CAPS and IMPORTANT emphasis, and "keep going / don't be lazy / loop until done" where they are advice to Claude, listing each removal as an issue with the reason. The same words as task data stay: quoted, in a code span, or named as text to find, replace or write                                                                                                                   | CC best practices: "What you can stop doing"                                  |
| Keep the why                                                     | Keeps a reason the user gave for a constraint; never invents one                                                                                                                                                                                                                                                                                                                                                                    | Prompting best practices: "Add context to improve performance"                |
| Rules that cannot bend                                           | Flags "never X / always Y" lines as an issue suggesting a hook or deny rule, without rewriting them                                                                                                                                                                                                                                                                                                                                 | CC best practices: "Deterministic and non-deterministic instructions"         |

### Goal: how the prompt says what done is

| Pick           | Effect on the rewrite                                                                                                                                                                                   | Source                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Auto (default) | Flags a missing done-condition; asks for it if only the user knows it                                                                                                                                   | Existing reviewer                               |
| Add a check    | Ends the prompt with what done looks like and a check Claude can run (a test file, a build's exit code, a linter, a screenshot next to the mockup), and asks for the command and its output as evidence | CC best practices: "Give Claude a check to run" |
| As `/goal`     | Rewrites into `/goal <condition>`: one measurable end state, the stated check, constraints that must not change, an optional turn cap; at most 4,000 characters                                         | `/goal` docs: "Write an effective condition"    |
| Off            | No goal or done-criteria checks. A Goal pick overrides the always-on row above                                                                                                                          |                                                 |

`As /goal` puts a slash command in the box. prompt-triage skips rating slash
commands, so sending it starts the goal directly, as `/goal` does.

### Workflow: the shape of the work

| Pick                 | Effect on the rewrite                                                                                                                        | Source                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| As written (default) | No workflow added                                                                                                                            |                                                                      |
| Plan first           | Adds "read the relevant code and propose a plan; make no edits until I approve", and the result row notes that Shift+Tab cycles to plan mode | Common workflows: "Plan before editing"                              |
| Interview me         | Rewrites into "interview me until you could write the spec, then write it to SPEC.md" around the user's topic                                | CC best practices: "Brainstorm with Claude first"                    |
| Test first           | For a bug: describe the symptom, write a failing test that reproduces it, then fix it                                                        | CC best practices: "Write a specific prompt" (the login-bug example) |

Opening the task in a new session is its own picker, Run in, below, so it is
not tied to a workflow or to the first prompt.

### Scope: how much to build

| Pick                 | Effect on the rewrite                                                                                                                                                                           | Source                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| As written (default) | No change                                                                                                                                                                                       |                                                               |
| Minimal              | Adds a line limiting the change to what was asked: no extra files, abstractions or refactors                                                                                                    | Prompting best practices: "Overeagerness"                     |
| Ambitious            | Adds "be ambitious:" followed by the fuller version the user wants. The reviewer asks which extras (empty and error states, keyboard navigation, the follow-on step) rather than inventing them | CC best practices: "Write a specific prompt" ("be ambitious") |

### Run mode: will someone be watching

| Pick               | Effect on the rewrite                                                                                                                                                                                                 | Source                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Watching (default) | No change                                                                                                                                                                                                             |                                                                                                       |
| Unattended         | Checks the five pre-run questions: what done looks like, how it checks its own work, what it may touch, what stops it, where the result goes and who signs off. Missing answers become questions, not invented values | CC best practices: "Let Claude run without you"; Prompting Claude Opus 5.5: "Unattended agentic runs" |

### Run in: this session or a new one

| Pick                   | Effect on the send                                                                                     | Source                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| This session (default) | None                                                                                                   |                                                                               |
| New session            | Enter sends the prompt with the `HANDOFF` context, so Claude starts a new session with it as the brief | prompt-triage's model dialog option **Open in a new session** (`NEW_SESSION`) |

Run in differs from the other pickers in three ways:

- It is one-shot: it applies to the next send and then reads This session
  again, so it never hands off a later prompt by surprise. It is not saved to
  `$.store`.
- An armed send skips the rating and the model dialog. The prompt is leaving
  this session, and the new session rates its own first prompt.
- It is drawn in the desktop app only, because `start_session` exists only
  there. If the desktop app has detached by the time the prompt is sent, the
  prompt runs in this session and a toast says why.

It works on any prompt, not only the first, and needs no Refine press.
Shipped ahead of the rest of the band; the other pickers join it in the same
`AbovePrompt` hook.

Picks that conflict (Interview me with Goal: As `/goal`) are resolved by the
reviewer instruction order: Workflow first, then Goal. The result row says
which pick was not applied.

## Where the recommendations come from

The refinement rules are written into the mod as text, not fetched at run
time. The mod's README promises "no network requests of its own", and a
rewrite should not change because a docs page changed overnight.

- **Bundled rubric.** The always-on checks and each option's instruction live
  next to `REVIEWER` in `hooks/register.ts`, each with a comment naming its
  source page and section.
- **Sources table.** The README lists each source URL with the date it was last
  read. This proposal's [Sources](#sources) section is the starting table.
- **Refresh.** On each release, re-read the pages and diff their section
  headings against the table. A changed or removed section is reviewed by hand.
  The model-specific prompting pages (Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable
  5.1) change with each model release and are checked then.
- **Eval.** Add `evals/refine-prompts.json`: drafts paired with picks and
  properties the rewrite must have, checked by a script modelled on
  `scripts/eval-rating.mjs`. Example properties: with Goal "Add a check", the
  rewrite names a runnable check; with no picks, no file path appears that
  the draft did not name or the working directory does not hold; no advice
  phrase (`think hard`, ALL CAPS) survives, while a quoted one (replace the
  text "think hard") does; no `@` is added to any path.

## Cost and data

- No model calls while typing. One `haiku` call per **Refine** press, a second
  when the user answers questions: the same as `/refine-prompt` today.
- The review prompt grows by roughly one line per non-default pick.
- Data handling is the same as today's review: the draft and answers go to
  `haiku` through `$.model.complete`; picks are kept in `$.store` (picks only,
  no prompt text).

## Feasibility spike (before building)

Each item is a pass/fail check, run with `claude plugin test` using the kit's
`mount` on `['terminal', 'desktop']`, then by hand in both surfaces:

1. A band with all four `Select`s and a `Button` draws and stays within one row
   in the terminal at 80 columns, and lays out readably on the desktop surface.
2. `$.ui.ask` called from the button's `onPress` opens the question dialog.
3. `$.prompt.fill` after that dialog closes answers `isFilled: true`.
4. The visibility atom changes when the draft becomes non-empty or empty,
   crosses 40 characters, gains or loses a line break, or starts or stops
   starting with `/`, and not on other keys.
5. The band yields to a survey (`hasSurvey`) and to another mod's band.
6. A `{ drop }` result can be shown without the "A hook blocked your prompt"
   heading, or with a neutral one.

If 2 fails, the band skips questions and lists them as issues instead. If 1
fails on either surface, the band shows only **Refine** and opens the pickers
as one `$.ui.ask` multi-select. If 6 fails, keep the heading and ship the
shorter reason line; the issue list still moves to the notice and the band.

## Phasing

1. Band with Goal, Workflow and Scope, using today's `review()` and
   `improve()`; picks saved in `$.store`; dialog option reads the same picks.
2. Run mode and the `/goal` output.
3. The refine eval and the sources check.

## Open questions

- Should the band's default be `long` drafts, as proposed, or `always`?
- Which engine keybinding action, if any, should press **Refine** from the
  prompt without focusing the band?
- Should `/refine-prompt` accept the picks as flags in phase 1, or keep using
  the stored picks only?

## Sources

All read 2026-11-06.

- Claude Code, Best practices: <https://code.claude.com/docs/en/best-practices>
- Claude Code, Common workflows: <https://code.claude.com/docs/en/common-workflows>
- Claude Code, Keep Claude working toward a goal (`/goal`): <https://code.claude.com/docs/en/goal>
- Claude Code, Hooks reference (`UserPromptSubmit` output fields): <https://code.claude.com/docs/en/hooks>
- Claude API, Prompting best practices: <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices>
- Claude API, Prompting Claude Opus 5.5: <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5>
- Claude Code mod API: the `claude-code` type declarations and the
  plugin-authoring kit's `band.tsx` example shipped with build 2.1.317
  (`AbovePrompt`, `PromptHint`, `SelectProps`, `ButtonProps`, `$.prompt.read`,
  `$.prompt.fill`, `prompt.edit`, `prompt.change`, `$.ui.ask`, `$.store`).
