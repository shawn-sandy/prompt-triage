# prompt-triage

A Claude Code mod that looks at the first prompt of each new session, rates
how complex it is, offers to switch models before the work starts, and raises
the effort level when it is too low for the task. It can
also review a prompt and put an improved one in the prompt box. In the Claude
desktop app it can also hand a complex task to a new session.

## What it does

1. On the first prompt of a session (not a slash command, not a resumed
   session), it rates the prompt `simple`, `moderate` or `complex` with one
   call to the small, fast model.
2. Each rating suggests a model: simple to `haiku`, moderate to `sonnet`,
   complex to `opus`. When the suggestion differs from the model you are on,
   a dialog asks whether to switch or keep the current model. Under "Other"
   you can type a model name, such as `use sonnet`.
3. In the desktop app, a `complex` rating also offers **Open in a new
   session**. Choosing it adds context containing an instruction asking Claude to
   start a fresh session with `start_session` instead of doing the task in
   this one. The mod cannot start the session itself, so it depends on Claude
   following that instruction.
4. Whenever the dialog is shown, it also offers **Improve prompt** (see
   below). It does not add a dialog where none would be shown.
5. When the suggestion matches your current model, nothing is asked, except
   that in the desktop app a `complex` prompt still offers the new session.
   Dismissing the dialog, or a failed rating, sends the prompt unchanged.
6. Each rating also sets a minimum effort: none for simple, `medium` for
   moderate, `high` for complex. See [Effort](#effort).

The switch applies to the main conversation's requests for the rest of the
session; subagents keep their own models. While it is in effect the status
line shows `running <name>, not <session model>`, followed by
`, effort raised to <level>` once the effort was raised (see [Effort](#effort)). The model picker and
`/model` still show the session's own setting, which is why the text names
both. Running `/model` yourself ends the override.

## Effort

After the first prompt is rated `moderate` or `complex`, any main-loop request
whose effort is below the minimum is sent at the minimum instead. Effort that
is already at or above it is left alone, so the mod only ever raises it. The
dialog, when shown, says what the minimum is if the prompt runs in this
session; it applies whichever model you choose, and also when no dialog is
shown.

Nothing changes when the rating is `simple`, when you dismiss the dialog, when
you choose **Open in a new session** or **Improve prompt**, or when the rating
fails. Subagent requests, models that take no effort setting, and effort set
as a number rather than a level are left alone.

The mod cannot read your effort before the first request, so it only knows it
was too low once that request is sent. From then on the status line shows
`effort raised to <level>`. The effort setting itself still shows the
session's own value. Running `/effort` yourself ends the minimum; any model
override stays.

## Improving a prompt

**Improve prompt** in the dialog holds the first prompt back instead of
sending it. One call to `haiku` reviews it for a missing goal, scope or
done-criteria, ambiguity and contradictions, and rewrites it to fix them.
Paths the prompt names, such as `src/auth.ts`, are checked against the working
directory, and any that are missing are listed. The issues are shown, and the
rewrite is put in the prompt box for you to edit or send with Enter. Sent, the
rewrite is rated again, without a second improvement offer. If the review
fails, the prompt is sent as typed.

For any prompt, at any point in the session, run the review by hand:

```text
/improve <prompt>
```

It shows the issues and puts the rewrite in the prompt box. Nothing is sent
until you press Enter.

## Hooks

The mod registers six hooks in `hooks/register.ts`. `prompt.submit` and
`command.run` are also the names of calls, so these hooks run whenever a
prompt is submitted or `/model`, `/effort` or `/improve` is run, whether you do it or
other code (the app, another mod) does. The mod never makes either call
itself.

| Hook | When it acts | What it may change |
| --- | --- | --- |
| `session.start` | Each session start. | Registers the `/improve` command. |
| `prompt.submit` | Only on the first prompt of a fresh session that is not a slash command, a meta prompt or part of a running turn. Every other submission passes through untouched. | Adds the new-session instruction to the prompt's context when you choose **Open in a new session**. When you choose **Improve prompt**, holds the prompt back and puts the rewrite in the prompt box; the prompt text is otherwise never changed. If the hook fails, the prompt is sent unchanged. |
| `turn.step` | Each model request while an override or an effort minimum is set. | Sets the request's model to the one you picked, and raises its effort to the minimum when it is lower. Subagent requests are left alone. |
| `command.run` (`/improve` only) | Each run of `/improve`. | Reviews the prompt given and puts the rewrite in the prompt box. Sends nothing. |
| `command.run` (`/model` only) | Each run of `/model`. | Leaves the command unchanged. Clears the mod's model override and its part of the status line. |
| `command.run` (`/effort` only) | Each run of `/effort`. | Leaves the command unchanged. Clears the effort minimum and its part of the status line. |

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
default install scope is `user`; pass `--scope project` or `--scope local` to
change it.

In the desktop app, where `/plugin` does not run, open Customize > Plugins and
add the marketplace `shawn-sandy/prompt-triage`.

## Cost

One small classification request on the first prompt of each session. Later
prompts are not checked. Each **Improve prompt** or `/improve` adds one `haiku`
request.

## Limits

- The first prompt waits for the rating and, when a question is shown, for your
  answer before it is sent.
- Free text under "Other" switches the model if it contains `haiku`, `sonnet`
  or `opus`, so `keep opus` switches to opus.
- The override and the effort minimum live in the mod's memory. If the mod
  reloads, the session goes back to its own model and effort.
- Whether a request takes effort is read from the session's model. If you
  switch to a model that takes no effort setting, the status line can still
  say effort was raised, though none is sent; if the session's own model takes
  none, the minimum is not applied after switching to one that does.
- The effort minimum is set from the first prompt only. A different task later
  in the session does not change it.
- The path check is a heuristic: it checks words that contain a slash or end in
  a common source extension, so a name such as `node.js` can be reported as
  missing.
- Choosing **Improve prompt** skips the model choice for that prompt. The
  choice is offered again when you send the rewrite.

## Data

The text of your first prompt is sent once per session to Claude Code's small,
fast model through `$.model.classify`, to get the rating. When you choose
**Improve prompt** or run `/improve`, that prompt is also sent to `haiku`
through `$.model.complete` for the review. The path check reads only whether
files exist, not their contents. The mod does not persist prompt data, the
model override or the effort minimum; they are held in memory for the session. It writes no
files and makes no network requests of its own. The
only context it adds is the new-session instruction described above, and only
when you choose that option.

## Development

```bash
claude --plugin-dir .          # load the mod from this folder
claude plugin validate .       # check the manifest and hooks module
claude plugin test .           # run hooks/register.test.ts
```

## License

MIT
