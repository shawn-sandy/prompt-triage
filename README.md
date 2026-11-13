# prompt-triage

A Claude Code mod that looks at the first prompt of each new session, rates
how complex it is, offers to switch models before the work starts, and raises
the effort level when it is too low for the task. It can
also review a prompt and put an improved one in the prompt box. In the Claude
desktop app it can also hand a complex or long-running task to a new session.

## What it does

1. On the first prompt of a session (not a slash command, not a resumed
   session), it rates the prompt `simple`, `moderate`, `complex` or
   `long-running` with one `haiku` call at effort `low`, against a written
   rubric that defines each rating by the shape of the task:
   - `simple`: a question with a short answer, a lookup, or a small edit in
     one known place.
   - `moderate`: an ordinary coding task with a clear goal in a few files.
   - `complex`: work that needs design judgment or reasoning across a system,
     done in one sitting.
   - `long-running`: a large job meant to run on its own for hours, such as a
     codebase-wide migration or a port to another framework.
2. Each rating suggests a model: simple to `haiku`, moderate to `sonnet`,
   complex to `opus`, long-running to `fable`. When the suggestion differs
   from the model you are on, a dialog says the rating and what it would
   take, names the model you are on, and asks how to run it, for example
   `Rated moderate: a sonnet-sized task. You are on claude-opus-5-5. Run it
   how?` with **Switch to sonnet**, **Keep claude-opus-5-5** and **Refine
   prompt**. Under "Other" you can type a model name, such as `use sonnet`
   or `use fable`.

   A `long-running` rating also offers **Switch to opus** under the `fable`
   suggestion, whenever opus is itself a step up from your current model.
   `fable` is the one suggestion two tiers above the next rating's, and the
   rating eval's misses over-rate `complex` prompts as `long-running` (see
   [Evaluating the rating](#evaluating-the-rating)), so the tier below is one
   click away rather than something to type under "Other". No other rating
   offers a step down.

   When the suggestion ranks two or more tiers above your current model, the
   question also says so, for example `Opus is two tiers above your current
   model.` (`three` for a `long-running` prompt on Haiku). The tiers are
   haiku, sonnet, opus, then fable (Mythos ranks with Fable). The wording is a
   count of tiers, never a price or dollar amount, since prices change and the
   mod would then state a wrong number. A one-tier step, or a model the mod
   cannot rank such as `Default (recommended)`, gets no such sentence.
3. For a `simple` prompt the dialog's first option is **Keep model, effort
   low**: it keeps your model and runs the main conversation at effort `low`,
   since lowering effort is often a better lever than switching models. The
   switch to `haiku` is offered after it, except when your model is two or
   more tiers above `haiku` (Opus, Fable or Mythos), where the switch is the
   far larger saving and so comes first.
4. In the desktop app, a `complex` or `long-running` rating also offers
   **Open in a new session**. Choosing it adds context containing an instruction asking Claude to
   start a fresh session with `start_session` instead of doing the task in
   this one, with the prompt as its brief plus a short written plan of the
   task, so the new session starts from the plan rather than from nothing. The
   mod cannot start the session itself, so it depends on Claude following that
   instruction.

   For any prompt, not only the first, the desktop app also draws a **Run in**
   picker in the band above the prompt input. Set it to **New session** and
   press Enter: the prompt is sent with the same instruction, with no rating
   and no model dialog, since the new session rates its own first prompt. The
   pick applies to that one send, then reads **This session** again. A prompt
   typed while Claude is still working is handed off the same way. Only a
   prompt you send takes the pick: a background task's notification or
   another session's message leaves it armed for your next send. If the
   desktop app has detached by the time you send, the prompt runs in this
   session and a toast says why. The terminal draws no Run in picker.

5. Whenever the dialog is shown, it also offers **Refine prompt** (see
   below). Neither it nor **Keep model, effort low** adds a dialog where none
   would be shown.
6. When the dialog is shown for a `moderate`, `complex` or `long-running`
   prompt, it opens
   with a one-line restatement of what the prompt asks for, such as
   `Read as: add a retry limit to the upload client`, from the same `haiku`
   call that rated it.
   The restatement is told to add no goal or reason you did not state, so a
   misread shows before the work starts; choose **Refine prompt** to fix it.
   If the reply has no restatement, the dialog is shown without it.
7. When the suggestion matches your current model, nothing is asked, except
   that in the desktop app a `complex` or `long-running` prompt still offers
   the new session. Dismissing the dialog, or a failed rating (an error, a
   timeout after 10 seconds, or a reply that names no single rating), sends
   the prompt unchanged.
8. Each rating also sets a minimum effort: none for simple, `medium` for
   moderate, complex and long-running. See [Effort](#effort).
9. Every decision is written to a log in the mod's store, along with its UTC
   date, what the session cost, how many prompts you sent after it, how full its context
   got and the effort it ran at, and `/triage-stats` prints the tally. See
   [The decision log](#the-decision-log).

The switch applies to the main conversation's requests for the rest of the
session; subagents keep their own models, with one exception: after a switch
up to `opus` or `fable`, the built-in Explore subagent runs on `haiku` when
the request that starts it names no model of its own. Exploration is read-only
and cheap to check, and would otherwise run at the pricier model's rate. A
resumed run, a teammate, a subagent of another type and an Explore agent that
a plugin or you defined are left alone. While it is in effect the status
line shows `running <name>, not <session model>`, followed by
`, effort raised to <level>` once the effort was raised, or
`, effort lowered to low` (see [Effort](#effort)). The model picker and
`/model` still show the session's own setting, which is why the text names
both. Running `/model` yourself ends the override. So does `/clear`, since
its next prompt is rated as a new first prompt; `/resume` and `/branch` keep it.

## Effort

After the first prompt is rated `moderate`, `complex` or `long-running`, any
main-loop request whose effort is below the minimum, `medium` for all three, is
sent at the minimum instead. Effort that is already at or above it is left
alone. The dialog does not mention the minimum, since no model's default effort
is below it. The minimum applies whichever model you choose, and also when no
dialog is shown.

The minimums guard against an effort lowered by hand. Opus 5.5 defaults to
`medium`, and Claude Code runs Fable 5.2 at `medium` by default, per
[Which Claude model should you build with?](https://claude.dev/blog/which-claude-model-should-you-build-with/),
which also notes that Claude Code's defaults can differ from the API's and that
`/effort status` shows yours. At those defaults the `medium` minimum changes
nothing; it acts only after you set `low`. The Claude API's own defaults are
`high` on Fable 5.2 and Sonnet 5.5 and `medium` on Opus 5.5 and Haiku 5.5, per
Anthropic's
[models overview](https://platform.claude.com/docs/en/about-claude/models/overview),
so a minimum of `high` would have raised effort on a default Fable session and
not only on a lowered one.

Choosing **Keep model, effort low** for a `simple` prompt is the one case
where the mod lowers effort: every main-loop request that names an effort
level is sent at exactly `low`, and the status line shows
`effort lowered to low` once a request was changed.

Nothing changes when the rating is `simple` and you choose another option,
when you dismiss the dialog, when you choose **Open in a new session** or
**Refine prompt**, or when the rating fails. Subagent requests, models that
take no effort setting, and effort set as a number rather than a level are
left alone.

The mod cannot read your effort before the first request, so it only knows it
was too low once that request is sent. From then on the status line shows
`effort raised to <level>`. The effort setting itself still shows the
session's own value. Running `/effort` yourself ends the minimum or the
lowered effort; any model override stays. `/clear` ends both, and its next
prompt sets them afresh.

## The decision log

Each time the mod rates a first prompt it appends one entry to a log in its
store: the rating, the main-loop model before and after, and the option
chosen (or `none asked` when no dialog was shown, `dismissed`, or **Open in
a new session**). Free text typed under "Other" is recorded as `other`, plus
the model alias it named if it named one, never the text itself. Choosing
**Refine prompt** logs nothing while the review succeeds; the rewrite is
logged when you send it, so one prompt counts once. If the review fails, the
original prompt is sent and that session is logged as **Refine prompt**. No prompt text is logged, and the log keeps the
newest 200 entries. `/triage-stats` prints it as a table, one row per
rating, with how many sessions it rated, how many of those changed model
tier, and how many of those changes went up to a pricier tier or down to a
cheaper one. That is the first record of whether a suggestion is ever taken,
so the question of whether the rating call pays for itself can be answered
from a count rather than from arithmetic.

Each entry also carries a random `id`, which links to nothing outside the
log, the UTC date it was logged as `at` (`YYYY-MM-DD`), and, once the session has spent anything, its `cost`: the US dollars the
session spent after the decision was logged, as `/cost` totals them, so the
rating call itself is left out. The figure is updated at the end of each
main-loop turn; subagent turns do not write it. When at least one entry has a
cost, `/triage-stats` adds a second table: for each rating and choice (switched
model, low effort, kept the model, or handed off to a new session), how many
sessions have a cost and their average.

The same update also sets two more optional numbers on the entry. `prompts` is
how many prompts you have sent since the decision was logged, counted from the
session's prompt count at that moment, and left out when that count could not be
read. A slash command is not a prompt, and a conversation that follows a `/clear`
does not inherit the cleared one's prompts. Entries logged by earlier versions
hold `turns` instead, the transcript's user turns including slash commands;
`/triage-stats` leaves those out of the prompts average, since the two count
different things. `ctx` is the share of the context window in use,
as a whole percent, at the end of the latest turn; it is left out until the
session has had its first response, and it can fall after a compaction. `ctx` is
left out when it cannot be read. When at least one entry has either,
`/triage-stats` adds a table with one row per rating: the average prompts sent, the
average context percent, and beside each the number of sessions that had that
figure. An entry missing one figure is left out of that average only, and a
rating with neither figure gets no row.

The same update sets one more: `effort`, the effort level the latest main-loop
request ran at, after any change the mod made (so `medium` after a raise, and
`low` after **Keep model, effort low**). A subagent's requests do not set it,
and a request with no named level, such as a numeric budget, leaves it out, or removes the level an earlier turn recorded.
When at least one entry has both an `effort` and a `cost`, `/triage-stats` adds
a table of rating, effort, sessions and average cost, which is how to see what
each effort level cost. Neither the log nor the command makes a model request.

The log has no version, but every entry has a date, so a change's effect on cost
can be split from the sessions before it:

```text
/triage-stats since 2026-11-12
```

counts only entries logged on that UTC date or later, and names the date in the
first line. A release's date is the date of its tag:
`git log -1 --format=%cs prompt-triage--v<version>`. The date must be a real
ISO date; anything else, such as `9/22/2026`, `2026-13-01` or `yesterday`,
prints a usage line and no table, since a misread date would print a confident,
wrong comparison. Entries logged before dates were added have no `at` and are
left out of a `since` tally.

## Improving a prompt

**Refine prompt** in the dialog holds the first prompt back instead of
sending it. One call to `haiku` reviews it for a missing goal, scope or
done-criteria, ambiguity, contradictions and unfilled placeholders such as
`[Specify the files]`, and rewrites it to fix them.

When the fix needs a fact only you know, such as which files are in scope, the
review asks you first: up to three questions, one dialog each, with likely
answers to pick or your own under "Other". It is told that the agent running
the prompt can read the repo and run commands, so it does not ask about, or list
as an issue, anything the agent can find that way. A second `haiku` call then rewrites
the prompt with your answers, and lists only the issues your answers left
unfixed. Dismissing a question skips the rest; the answers
given so far are still used, and with none the first rewrite is kept, as it is
when the second call fails.

Paths the prompt or the rewrite names, such as `src/auth.ts`, are checked
against the working directory, and any that are missing are listed, so a path
the review made up is caught. A glob such as `src/*.ts` is checked by its
folder. The issues are shown, and the
rewrite is put in the prompt box for you to edit or send with Enter. Sent, the
rewrite is rated again, without a second improvement offer. If the review
fails, the prompt is sent as typed. The review's reply is capped at 4096
tokens, or one token per two characters of the prompt when that is more (at
most 64,000), so a long prompt's rewrite is not cut off.

For any prompt, at any point in the session, run the review by hand:

```text
/refine-prompt <prompt>
```

It asks the same questions, shows the issues and puts the rewrite in the prompt
box. Nothing is sent until you press Enter. Versions up to 0.3.3 called this
command `/improve`; that name no longer runs.

### The refine band

In the terminal and the desktop app, a band above the prompt input offers the
review while you type, for any prompt in the session. Everything this mod
draws there is one bordered **Triage** section above whatever else draws the
band (the context ring, Compact), so the mod's controls read as a group:

```text
╭───────────────────────────────────────────────────────────────────────────────────────────────╮
│ Triage  Goal: Auto  Workflow: As written  Scope: As written  Run in: This session  [r] Refine │
│ Session estimate: $0.42 · 3 prompts · 52.6K tokens · 26% context   Manage context             │
╰───────────────────────────────────────────────────────────────────────────────────────────────╯
```

**Run in** is drawn in the desktop app only (see above). The band shows when the
draft is not empty, is not a slash command, and is 40 characters or longer or
has a line break. It shows while Claude is working too, and gives way to a
survey. The mod's `band` option in the config menu changes the rule: `always`
shows it for any draft, `never` hides it (Run in still shows in the desktop
app). The default is `long`.

Each picker adds one instruction to the review. Each one's default adds none,
so with no picks the review is the same as **Refine prompt** and
`/refine-prompt`.

| Picker | Pick | What the review does |
| --- | --- | --- |
| Goal | Auto (default) | Flags a missing done-condition, as the review always has. |
| Goal | Add a check | Ends the rewrite with what done looks like and a check Claude can run, and asks for the command and its output as evidence. |
| Goal | Off | Skips the goal and done-criteria checks. |
| Workflow | As written (default) | Adds no workflow. |
| Workflow | Plan first | Asks Claude to read the code and propose a plan, with no edits until you approve. |
| Workflow | Interview me | Rewrites the prompt as a request to interview you until Claude could write the spec, then write it to `SPEC.md`. |
| Workflow | Test first | For a bug: describe the symptom, write a failing test that reproduces it, then fix it. |
| Scope | As written (default) | No change. |
| Scope | Minimal | Limits the change to what was asked: no extra files, abstractions or refactors. |
| Scope | Ambitious | Adds "be ambitious:" and the fuller version you want, asking which extras rather than inventing them. |

Your picks are saved in the mod's store and come back next session.
**Refine prompt** in the model dialog and `/refine-prompt` use the same picks,
with one difference: for a `complex` or `long-running` prompt the dialog's
**Refine prompt** uses **Add a check** while Goal is Auto. The guide's order for
a hard task is a check first, then more effort, then a bigger model, so a strong
rating asks for the check before anything pricier. A Goal you set to Off or
Add a check is used as set, and `/refine-prompt` and the band's **Refine** always
use Goal as set.

Press **Refine** (`r` once the band has focus, from `ctrl+x tab` or a click) to
review the draft. It asks the same questions as **Refine prompt**, then puts
the rewrite in the prompt box, and the band shows the number of issues, **Show
issues**, **Restore original** (puts back the draft you had) and **Done**. With
**Plan first** it also notes that Shift+Tab cycles to plan mode. That row stays
until you press **Restore original** or **Done**, send a prompt, or run `/clear`.
If you keep typing, send a prompt or run `/clear` during the review, the prompt
box is left alone and a toast asks you to press **Refine** again. If the review fails, a toast says so and the draft is
unchanged. A refine from the band counts as refining the session's first
prompt, so the model dialog does not offer **Refine prompt** again for it.

### The status row

After the first prompt, the bottom row of the Triage section shows a **Session
estimate**: what the session has cost, how many prompts it has had and how
many tokens are in the context window and what share of it they fill, with a
**Manage context** button that the share decides. Only prompts you send count,
from any surface: slash commands such as `/compact` do not, nor do messages
delivered to the session (a background task's notification, a scheduled
prompt, another session's message). A compaction keeps the
count, and `/clear` starts it over:

```text
Session estimate: $0.42 · 3 prompts · 52.6K tokens · 26% context   Manage context
```

The figures update whenever the engine reports the cost or context moved,
after each turn, and after `/clear` and a compaction. Below 25% context, or before a fresh conversation's first
response, the row draws no button, since nothing needs clearing. From 25% the
button appears. Pressing it opens a dialog that offers both, recommending **Clear** below
60% context and **Compact** from 60%: **Compact**
keeps a summary to go on with the task, and **Clear** starts fresh for an
unrelated one. The choice runs `/compact` or `/clear` once the session is idle.
Closing the dialog runs nothing. The row shows whatever the `band` setting is.

## Hooks

The mod registers fifteen hooks in `hooks/register.ts`. `prompt.submit` and
`command.run` are also the names of calls, so these hooks run whenever a
prompt is submitted or `/model`, `/effort`, `/refine-prompt` or `/triage-stats` is run, whether you do it or
other code (the app, another mod) does. The mod runs `/clear` or `/compact`
itself, through `command.run`, when you pick one in the status row's dialog;
it never makes the `prompt.submit` call, and it runs no other command.

| Hook | When it acts | What it may change |
| --- | --- | --- |
| `session.start` | Each session start. | Registers the `/refine-prompt` and `/triage-stats` commands, and reads the conversation's prompt count once, before any slash command you type adds a user turn to the transcript. |
| `ui.render` (`AbovePrompt` only) | Each draw of the band above the prompt input, unless a survey holds the band. | Draws the bordered Triage section: the refine controls (Goal, Workflow and Scope pickers and **Refine**, or the result row after a refine) when the draft meets the `band` setting, after the first prompt the status row (cost, prompts, tokens in context and **Manage context**, which runs `/clear` or `/compact` when you pick one in its dialog), and in the desktop app the **Run in** picker. The section sits above whatever else draws the band. **Refine** puts its rewrite in the prompt box and **Restore original** puts the draft back; nothing else changes until you send. |
| `prompt.edit`, `prompt.change` | Each change to the prompt box. | Change nothing. Redraw the band when the draft starts or stops meeting the `band` setting. |
| `prompt.submit` | On any prompt you send (typed, including over a running turn, or through Remote Control) that is not a slash command or a meta prompt while **Run in** is set to **New session**; otherwise only on the first prompt of a fresh session or of the conversation after a `/clear`, when no turn is running. Every other submission passes through untouched. | Adds the new-session instruction to the prompt's context when **Run in** is set to **New session** (then resets the picker) or when you choose **Open in a new session**. When you choose **Refine prompt**, holds the prompt back, asks up to three clarifying questions, and puts the rewrite in the prompt box; the prompt text is otherwise never changed. Appends the decision to the log in the store. Counts each prompt that enters toward the status row's prompt count and the first-prompt check, and redraws the band so the row shows it at once; a slash command, a meta prompt, a dropped prompt and a delivery you did not send (a task notification, a scheduled prompt, another session's or a plugin's own message) are not counted. If the hook fails, the prompt is sent unchanged and still counted. |
| `turn.step` | Each model request while an override, an effort minimum or a lowered effort is set. | Sets the request's model to the one you picked, raises its effort to the minimum when it is lower, or sets it to `low` after **Keep model, effort low**. Subagent requests are left alone. Remembers the effort the request ran at, for the decision log. |
| `agent.spawn` | Each subagent about to start. | After a switch up to `opus` or `fable`, sets the built-in Explore subagent's model to `haiku` when its request names none. A resumed run, a teammate, another agent type and an Explore agent from a plugin or from you pass through untouched. |
| `turn.complete` | The end of each main-loop turn. Subagent turns pass through untouched. | Changes nothing in the turn. Redraws the band so the status row shows the prompt a send added even when the cost and context did not move. After a rated first prompt, reads the session's cost, context percent and effort, and works out the prompts sent since the decision, and, for each that changed, sets it on this session's entry in the decision log. If the hook fails, the turn ends unchanged. |
| `session.end` | The session ends, or `/clear`, `/resume` or `/branch` runs. | Lets the session end as it would. Redraws the band so the status row drops the ended conversation's figures. Stops recording onto the ended session's entry. After `/clear` sets the prompt count to zero, marks the next prompt to be rated as a first prompt, ends the model override, the effort minimum and a spent **Refine prompt** offer, clears their status line, and closes a band Refine's result row; after `/resume` or `/branch` reads the count afresh from the new conversation. |
| `session.measure` | After each main-loop turn whose figures moved, and when a rate-limit window moves. | Changes nothing. Redraws the band when the cost or context moved, so the status row shows the new figures. |
| `session.compact` | Each compaction of the main conversation: `/compact`, automatic, or picked in the **Manage context** dialog. | Changes nothing in the compaction. Redraws the band. The prompt count is kept, since a compaction sends no prompt; the user turns it summarized away are added only when the count is first read after it, as after a `/resume`. A precompute pass is passed through untouched. |
| `command.run` (`/refine-prompt` only) | Each run of `/refine-prompt`. | Reviews the prompt given with the band's picks, asks up to three clarifying questions, and puts the rewrite in the prompt box. Sends nothing. |
| `command.run` (`/triage-stats` only) | Each run of `/triage-stats`, with or without `since <date>`. | Reads the decision log from the store and prints the tally, or a usage line for a date that is not a real ISO date. Changes nothing. |
| `command.run` (`/model` only) | Each run of `/model`. | Leaves the command unchanged. Clears the mod's model override and its part of the status line. |
| `command.run` (`/effort` only) | Each run of `/effort`. | Leaves the command unchanged. Clears the effort minimum or lowered effort and its part of the status line. |

## Install

This is a Claude Code mod, so it needs a Claude Code release that supports
mods (a `modules` entry in `hooks/hooks.json`). It loads in Claude Code: the
terminal, the IDE extensions and the desktop app's Code tab. Chat and Cowork
do not load hooks.

```text
/plugin install prompt-triage --marketplace shawn-sandy/prompt-triage
```

From a shell:

```bash
claude plugin install prompt-triage --marketplace shawn-sandy/prompt-triage
```

A marketplace that is not added yet is added first, in user settings. The
default install scope is `user`; add `--scope project` or `--scope local` to
change it.

In the desktop app, where `/plugin` does not run, open Customize > Plugins and
add the marketplace `shawn-sandy/prompt-triage`.

## Cost

One `haiku` request at effort `low`, with its reply capped at 256 tokens, on
the first prompt of each session. Later prompts are not checked. The same
request returns the rating and, for a `moderate`, `complex` or `long-running`
prompt, the one-line restatement, so the dialog never waits on a second call.
A `simple` prompt gets the label only. Each **Refine prompt**,
`/refine-prompt` or band **Refine** adds one `haiku` request, and a second when
you answer its questions. The band makes no request while you type. `/triage-stats` makes no model
request at all.

## Limits

- The first prompt waits up to 10 seconds for the rating and, when a question
  is shown, for your answer before it is sent. The restatement comes in the
  same call, so it adds no wait.
- Free text under "Other" switches the model if it names exactly one of
  `haiku`, `sonnet`, `opus` or `fable`, so `keep opus` switches to opus. Text naming
  two, such as `not haiku, use opus`, switches nothing, and so does text with
  a no-word (no, not, don't, never, avoid, without), such as
  `no, don't use haiku`. That also means `no, use opus` switches nothing; use
  `/model` then.
- A `complex` prompt on a model above opus, such as Fable or Mythos, is not
  offered a switch to opus, and a `long-running` prompt on Fable or Mythos is
  not offered a switch to fable. A model name the mod does not recognize, such
  as `Default (recommended)`, counts as strong enough for both, so it is never
  offered a step down. `simple` and `moderate` prompts are still offered the
  cheaper model.
- The `long-running` step down to opus is skipped when opus is not a step up
  from your current model, so a `long-running` prompt already on opus is
  offered `fable` or nothing else, and one on Fable, Mythos or an unrecognized
  name is offered neither.
- The override and the effort minimum live in the mod's memory. If the mod
  reloads, the session goes back to its own model and effort. The decision
  log is in the store and survives.
- The decision log is one list that every session appends to without a lock,
  since the store has no atomic update. Two sessions rating their first
  prompt within the same few milliseconds can lose one entry. This is
  accepted: the log is a tally, and a missing row costs nothing else. Each
  turn that changes a session's cost, prompt count or context percent rewrites
  the list too, which makes such a loss more likely; a lost figure is put back
  by that session's next turn.
- A session's cost is everything the session spent after its decision was
  logged, including subagents and any other mod's model calls, until the
  session ends or `/clear`, `/resume` or `/branch` runs. An entry already pushed
  out by the 200-entry cap is not updated or added back.
- `prompts` and `ctx` are recorded only for a session that also has a cost
  baseline, which every session in the CLI has. `ctx` is the latest reading,
  not a peak, so a compaction late in a session lowers it.
- The prompt count is read from the conversation once, at session start, after
  `/resume` or `/branch`, and when the mod is reloaded mid-conversation, then
  kept by counting sends. A read taken mid-conversation includes the slash
  commands typed before it, which the transcript records as user turns, so the
  count can run high there until a `/clear`. A read that fails is tried again on
  the next draw or prompt, and a prompt sent while the count is unread is not
  rated as a first prompt. A read still running when the conversation ends is
  dropped.
- Sessions differ in task, so the cost table and the prompts and context table
  show which choices went with cheaper, shorter or fuller sessions, not that a
  choice made them so. `/triage-stats` says so under the tables.
- Whether a request takes effort is read from the session's model. If you
  switch to a model that takes no effort setting, the status line can still
  say effort was raised, though none is sent; if the session's own model takes
  none, the minimum is not applied after switching to one that does.
- On Amazon Bedrock, Google Cloud, Microsoft Foundry and Claude Platform on AWS,
  the `haiku` alias resolves to Haiku 4.5, which takes a thinking budget and no
  effort levels. The rating and review calls send an effort of `low` where the
  model takes one and drop it where it does not (the engine's documented
  behavior for `$.model.complete`), so the calls are expected to work, but the
  mod has not been run against those providers.
- The `opusplan` alias ranks as opus, because the mod matches the model family
  in the name. It plans with Opus and makes its edits with Sonnet, so a
  `complex` prompt on `opusplan` is treated as already on opus and is not offered
  the switch. Pick a model with `/model` if that is not what you want.
- The Explore routing matches the built-in agent by its type and by the engine
  providing it. It does not run when you set a model for the spawn yourself, and
  it ends when you run `/model`.
- The effort minimum is set from the first prompt only. A different task later
  in the session does not change it.
- The path check is a heuristic: it checks words that start with `./` or `../`
  or end in a common source extension, so a name such as `node.js` can be
  reported as missing. Words such as `and/or` are skipped, and so is a folder
  named without `./`, such as `src/components`.
- Choosing **Refine prompt** skips the model choice for that prompt. The
  choice is offered again when you send the rewrite.

## Data

The text of your first prompt is sent once per session to `haiku` through
`$.model.complete`, to get the rating and, for a `moderate`, `complex` or `long-running` prompt,
the one-line restatement. When you choose
**Refine prompt**, run `/refine-prompt` or press **Refine** in the band, that prompt is also sent to `haiku`
through `$.model.complete` for the review, and sent again with your answers
when you answer its questions. The path check reads only whether
files exist, not their contents. The mod does not persist prompt data, the
model override or the effort minimum; they are held in memory for the session.
Two things are saved in the mod's store across sessions: the band's Goal,
Workflow and Scope picks, and the decision log under the key `decisions`, a
list of at most 200 entries each holding the rating, the main-loop model
before and after, the option chosen, a random id, the UTC date it was logged,
the session's cost in US dollars, the prompts sent since the decision, the
context percent used and the effort level of the latest main-loop request.
The id is made by the mod and is not the session id, so it points at no
transcript. No prompt text is logged. `/triage-stats` reads it; nothing else
does. It writes no
files and makes no network requests of its own. The
only context it adds is the new-session instruction described above, and only
when you choose that option.

## Development

```bash
claude --plugin-dir .          # load the mod from this folder
claude plugin validate .       # check the manifest and hooks module
claude plugin test .           # run hooks/register.test.ts
npx --yes -p typescript@5.9 tsc --noEmit -p .   # typecheck
```

The typecheck needs `.claude-plugin/types/`, which Claude Code writes the first
time you run `claude --plugin-dir .` interactively in this folder. The folder is
in `.gitignore`, so a fresh clone or worktree has none until then, and CI does
not run the typecheck.

### Evaluating the rating

`evals/rating-prompts.json` holds 168 realistic first prompts, 40 each for `simple` and
`long-running` and 44 each for `moderate` and `complex`, each labeled with the rating it should get. `scripts/eval-rating.mjs` imports
the rubric (`RATER`) and the reply parser (`parseRating`) from
`hooks/register.ts`, rates each prompt through `claude -p` at `haiku` and
effort `low`, and prints per-rating accuracy with a Wilson 95% confidence
interval beside each percentage, a confusion table and the number of replies
that named no rating. The interval is the point: at the earlier 8 cases per
rating, `complex` scored 5/8, an interval of 31-86%, too wide to tell a
rubric change from noise; at 40 the same score would read 47-76%. `--baseline` scores bare labels with no
definitions instead, for comparison. The model's replies also vary between
runs: the unchanged rubric has scored `complex` 34/40 on one run and 36/40 on
the next. `--runs N` (1 to 20) rates every case N times and prints each rating's mean
score, the count on each run, and a confusion table summed over the runs; the
interval is taken on the mean over the cases, not over every call, since
rating one prompt again is not a fresh sample. Compare rubric changes on the
mean of several runs, not on one. It needs Node 24 and a signed-in Claude
Code, not an API key, and it turns off user settings, MCP servers and skills so
an installed prompt-triage cannot rate the eval's own prompts. The CLI adds its
own system context, so scores are close to the mod's call but not identical.

```bash
node scripts/eval-rating.mjs
node scripts/eval-rating.mjs --baseline
node scripts/eval-rating.mjs --runs 3
```

### Layout

| Path | What it is |
| --- | --- |
| `hooks/register.ts` | All of the mod's logic: the fifteen hooks and the `/refine-prompt` and `/triage-stats` commands. |
| `hooks/register.test.ts` | Tests for the hooks, run with `claude plugin test .`. |
| `evals/rating-prompts.json` | Labeled first prompts for scoring the rating. |
| `scripts/eval-rating.mjs` | Scores the rating rubric, or `--baseline`, against `evals/rating-prompts.json`, once or averaged over `--runs N`. |
| `hooks/hooks.json` | Points Claude Code at the mod: `{ "modules": ["./register.ts"] }`. |
| `.claude-plugin/plugin.json` | The plugin manifest: name, `version`, description, icon. |
| `.claude-plugin/marketplace.json` | Makes this repo a marketplace that lists the one plugin. |
| `icon.png` | The icon (512x512) that `plugin.json` points at. |
| `assets/` | The icon files. The SVGs and `icon.png` here are the source copies. |
| `tsconfig.json` | Extends `.claude-plugin/types/tsconfig.json`. That folder is in `.gitignore`, so a fresh clone does not contain it. |

### Releases

Installed users only get an update when `version` in
`.claude-plugin/plugin.json` changes. You do not edit it by hand: the
`bump-version` workflow does it when a push to `main` changes
`hooks/register.ts`, `hooks/hooks.json` or the workflow file itself. It raises
the minor number if a pushed commit subject starts with `feat:` or
`feat(scope):`, and the patch number otherwise. It commits the new version to a
`bump/v<version>` branch and opens a pull request for it. When that pull request
merges, the `release-version` workflow publishes a GitHub release tagged
`prompt-triage--v<version>`.

Three other workflows run on GitHub: `check.yml` runs `claude plugin validate .`
and `claude plugin test .` on every pull request, and `bump-version` runs it
first and releases only if it passes; `claude.yml` responds when `@claude` is
mentioned in an issue or pull request, and `claude-code-review.yml` reviews
pull requests.

## License

MIT
