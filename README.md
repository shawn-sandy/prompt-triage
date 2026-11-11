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
   this one. The mod cannot start the session itself, so it depends on Claude
   following that instruction.

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
   moderate, `high` for complex and long-running. See [Effort](#effort).
9. Every decision is written to a log in the mod's store, along with what the
   session cost, how many turns it ran and how full its context got after it,
   and `/triage-stats` prints the tally. See
   [The decision log](#the-decision-log).

The switch applies to the main conversation's requests for the rest of the
session; subagents keep their own models. While it is in effect the status
line shows `running <name>, not <session model>`, followed by
`, effort raised to <level>` once the effort was raised, or
`, effort lowered to low` (see [Effort](#effort)). The model picker and
`/model` still show the session's own setting, which is why the text names
both. Running `/model` yourself ends the override.

## Effort

After the first prompt is rated `moderate`, `complex` or `long-running`, any
main-loop request whose effort is below the minimum is sent at the minimum
instead. Effort that is already at or above it is left alone. The dialog for
a `complex` or `long-running` prompt says `Effort will be at least high`; the
`medium` minimum is not mentioned, since no model's default effort is below
it. The minimum applies whichever model you choose, and also when no dialog
is shown.

The minimums guard against an effort lowered by hand. At the Claude API's
default effort (`high` on Fable 5.1 and Sonnet 5.5, `medium` on Opus 5.5 and
Haiku 5.5, per Anthropic's
[models overview](https://platform.claude.com/docs/en/about-claude/models/overview)),
the `medium` minimum changes nothing; it acts only after you set `low`.

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
lowered effort; any model override stays.

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
log, and, once the session has spent anything, its `cost`: the US dollars the
session spent after the decision was logged, as `/cost` totals them, so the
rating call itself is left out. The figure is updated at the end of each
main-loop turn; subagent turns do not write it. When at least one entry has a
cost, `/triage-stats` adds a second table: for each rating and choice (switched
model, low effort, kept the model, or handed off to a new session), how many
sessions have a cost and their average.

The same update also sets two more optional numbers on the entry. `turns` is how
many turns the session has completed since the decision was logged, counted from
the turn count at that moment, so a conversation that follows a `/clear` does not
inherit the cleared one's turns. `ctx` is the share of the context window in use,
as a whole percent, at the end of the latest turn; it is left out until the
session has had its first response, and it can fall after a compaction. Each is
left out when it cannot be read, and `turns` is also left out when the count has
fallen below what it was at the decision. When at least one entry has either,
`/triage-stats` adds a table with one row per rating: the average turns, the
average context percent, and beside each the number of sessions that had that
figure. An entry missing one figure is left out of that average only, and a
rating with neither figure gets no row. Neither the log nor the command makes a
model request.

## Improving a prompt

**Refine prompt** in the dialog holds the first prompt back instead of
sending it. One call to `haiku` reviews it for a missing goal, scope or
done-criteria, ambiguity, contradictions and unfilled placeholders such as
`[Specify the files]`, and rewrites it to fix them.

When the fix needs a fact only you know, such as which files are in scope, the
review asks you first: up to three questions, one dialog each, with likely
answers to pick or your own under "Other". A second `haiku` call then rewrites
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
review while you type, for any prompt in the session:

```text
Refine  Goal: Auto  Workflow: As written  Scope: As written  Run in: This session   [r] Refine
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
**Refine prompt** in the model dialog and `/refine-prompt` use the same picks.

Press **Refine** (`r` once the band has focus, from `ctrl+x tab` or a click) to
review the draft. It asks the same questions as **Refine prompt**, then puts
the rewrite in the prompt box, and the band shows the number of issues, **Show
issues**, **Restore original** (puts back the draft you had) and **Done**. With
**Plan first** it also notes that Shift+Tab cycles to plan mode. That row stays
until you press **Restore original** or **Done**, or send a prompt. If you keep
typing or send a prompt during the review, the prompt box is left alone and a
toast asks you to press **Refine** again. If the review fails, a toast says so and the draft is
unchanged. A refine from the band counts as refining the session's first
prompt, so the model dialog does not offer **Refine prompt** again for it.

### The status row

After the first prompt, the bottom row of the band shows what the session has
cost, how many prompts it has had and how full the context window is, with a
**Clear** or **Compact** button:

```text
$0.42 · 3 prompts · 48% context   Clear
```

The figures update at the end of each turn, after `/clear` and after a
compaction. Below 60% context the button reads
**Clear**, and from 60% it reads **Compact**. Pressing it opens a dialog that
offers both, with the one the button named marked recommended: **Compact**
keeps a summary to go on with the task, and **Clear** starts fresh for an
unrelated one. The choice runs `/compact` or `/clear` once the session is idle.
Closing the dialog runs nothing. The row shows whatever the `band` setting is.

## Hooks

The mod registers twelve hooks in `hooks/register.ts`. `prompt.submit` and
`command.run` are also the names of calls, so these hooks run whenever a
prompt is submitted or `/model`, `/effort`, `/refine-prompt` or `/triage-stats` is run, whether you do it or
other code (the app, another mod) does. The mod never makes either call
itself.

| Hook | When it acts | What it may change |
| --- | --- | --- |
| `session.start` | Each session start. | Registers the `/refine-prompt` and `/triage-stats` commands. |
| `ui.render` (`AbovePrompt` only) | Each draw of the band above the prompt input, unless a survey holds the band. | Draws the refine band (Goal, Workflow and Scope pickers and **Refine**, or the result row after a refine) when the draft meets the `band` setting, after the first prompt the status row (cost, prompts, context and **Clear** or **Compact**, which runs that command when you pick it in its dialog), and in the desktop app the **Run in** picker, above whatever else draws the band. **Refine** puts its rewrite in the prompt box and **Restore original** puts the draft back; nothing else changes until you send. |
| `prompt.edit`, `prompt.change` | Each change to the prompt box. | Change nothing. Redraw the band when the draft starts or stops meeting the `band` setting. |
| `prompt.submit` | On any prompt you send (typed, including over a running turn, or through Remote Control) that is not a slash command or a meta prompt while **Run in** is set to **New session**; otherwise only on the first prompt of a fresh session or of the conversation after a `/clear`, when no turn is running. Every other submission passes through untouched. | Adds the new-session instruction to the prompt's context when **Run in** is set to **New session** (then resets the picker) or when you choose **Open in a new session**. When you choose **Refine prompt**, holds the prompt back, asks up to three clarifying questions, and puts the rewrite in the prompt box; the prompt text is otherwise never changed. Appends the decision to the log in the store. If the hook fails, the prompt is sent unchanged. |
| `turn.step` | Each model request while an override, an effort minimum or a lowered effort is set. | Sets the request's model to the one you picked, raises its effort to the minimum when it is lower, or sets it to `low` after **Keep model, effort low**. Subagent requests are left alone. |
| `turn.complete` | The end of each main-loop turn. Subagent turns pass through untouched. | Changes nothing in the turn. Redraws the band so the status row's figures update. After a rated first prompt, reads the session's cost, turn count and context percent and, for each that changed, sets it on this session's entry in the decision log. If the hook fails, the turn ends unchanged. |
| `session.end` | The session ends, or `/clear`, `/resume` or `/branch` runs. | Changes nothing. Redraws the band so the status row drops the ended conversation's figures. Stops recording onto the ended session's entry, and after `/clear` marks the next prompt to be rated as a first prompt. |
| `session.compact` | Each compaction of the main conversation: `/compact`, automatic, or the status row's **Compact**. | Changes nothing in the compaction. Redraws the band so the status row shows the new context figures. |
| `command.run` (`/refine-prompt` only) | Each run of `/refine-prompt`. | Reviews the prompt given with the band's picks, asks up to three clarifying questions, and puts the rewrite in the prompt box. Sends nothing. |
| `command.run` (`/triage-stats` only) | Each run of `/triage-stats`. | Reads the decision log from the store and prints the tally. Changes nothing. |
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
  turn that changes a session's cost, turn count or context percent rewrites
  the list too, which makes such a loss more likely; a lost figure is put back
  by that session's next turn.
- A session's cost is everything the session spent after its decision was
  logged, including subagents and any other mod's model calls, until the
  session ends or `/clear`, `/resume` or `/branch` runs. An entry already pushed
  out by the 200-entry cap is not updated or added back.
- `turns` and `ctx` are recorded only for a session that also has a cost
  baseline, which every session in the CLI has. `ctx` is the latest reading,
  not a peak, so a compaction late in a session lowers it.
- Sessions differ in task, so the cost table and the turns and context table
  show which choices went with cheaper, shorter or fuller sessions, not that a
  choice made them so. `/triage-stats` says so under the tables.
- Whether a request takes effort is read from the session's model. If you
  switch to a model that takes no effort setting, the status line can still
  say effort was raised, though none is sent; if the session's own model takes
  none, the minimum is not applied after switching to one that does.
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
before and after, the option chosen, a random id, the session's cost in US
dollars, the turns completed since the decision and the context percent used.
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
```

### Evaluating the rating

`evals/rating-prompts.json` holds 160 realistic first prompts, 40 per rating,
each labeled with the rating it should get. `scripts/eval-rating.mjs` imports
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
| `hooks/register.ts` | All of the mod's logic: the twelve hooks and the `/refine-prompt` and `/triage-stats` commands. |
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
