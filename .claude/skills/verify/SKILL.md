---
name: verify
description: How to run this mod from the checkout and reach its hooks at a real surface. Use when verifying a change to hooks/register.ts.
---

# Verify a prompt-triage change

The mod loads from this checkout only with `--plugin-dir .`; a plain `claude` runs the installed copy
(see CLAUDE.md), which makes a handy before/after.

## Headless (works from an agent shell)

```bash
claude -p --plugin-dir . "/refine-prompt Fix the login bug in src/auth/session.ts and make it work"
```

- Reaches `improve` -> `fillBox` -> `$.prompt.fill`. Headless has no prompt box, so the engine refuses
  with `no_composer`: the real refusal cause, which `claude plugin test` cannot produce (the harness
  strips a cause a test hook writes).
- One haiku review: about 15 s, needs network to api.anthropic.com.
- `claude -p --plugin-dir . "/refine-prompt"` prints the usage line.

## Interactive only

The first-prompt dialog (Refine prompt), the Clarify questions, the drop line ("Held for review...")
and the band's Refine button need a person at the TUI or the desktop app. `$.ui.ask` does not run
headless, and the desktop app runs the installed copy, not this checkout. An agent without tmux
cannot drive these; report them as not verified.
