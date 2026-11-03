# prompt-triage

A Claude Code mod that looks at the first prompt of each new session, rates
how complex it is, and offers to switch models before the work starts. In the
Claude desktop app it can also hand a complex task to a new session.

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
4. When the suggestion matches your current model, nothing is asked, except
   that in the desktop app a `complex` prompt still offers the new session.
   Dismissing the dialog, or a failed rating, sends the prompt unchanged.

The switch applies to the main conversation's requests for the rest of the
session; subagents keep their own models. While it is in effect the status
line shows `running <name>, not <session model>`. The model picker and
`/model` still show the session's own setting, which is why the text names
both. Running `/model` yourself ends the override.

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
prompts are not checked.

## Limits

- The first prompt waits for the rating and, when a question is shown, for your
  answer before it is sent.
- Free text under "Other" switches the model if it contains `haiku`, `sonnet`
  or `opus`, so `keep opus` switches to opus.
- The override lives in the mod's memory. If the mod reloads, the session goes
  back to its own model.

## Data

The text of your first prompt is sent once per session to Claude Code's small,
fast model through `$.model.classify`, to get the rating. The mod does not
persist prompt data or the model override; the override is held in memory for
the session. It writes no files and makes no network requests of its own. The
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
