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
   session**: Claude hands the prompt to a fresh session with `start_session`
   instead of doing it in this one.
4. Nothing is asked when the suggestion matches your current model, and
   dismissing the dialog sends the prompt unchanged.

The switch applies to the main conversation's requests for the rest of the
session; subagents keep their own models. The status line shows
`model: <name> (prompt-triage)` while it is in effect. `/model` still shows
the session's own setting, and running `/model` yourself ends the override.

## Install

Requires Claude Code 2.1.287 or newer.

```text
/plugin install prompt-triage --marketplace shawn-sandy/prompt-triage
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```bash
claude plugin install prompt-triage --marketplace shawn-sandy/prompt-triage
```

In the desktop app, where `/plugin` does not run: click + next to the prompt
box, then Plugins, Add marketplace with `shawn-sandy/prompt-triage`, then Add
plugin.

## Cost

One small classification request on the first prompt of each session. Later
prompts are not checked.

## Development

```bash
claude --plugin-dir .          # load the mod from this folder
claude plugin validate .       # check the manifest and hooks module
claude plugin test .           # run hooks/register.test.ts
```

## License

MIT
