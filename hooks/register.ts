import type { EngineInterface, PromptSubmitInput, Register } from 'claude-code'

// Each rating and the model alias it suggests.
const SUGGEST = { simple: 'haiku', moderate: 'sonnet', complex: 'opus' } as const
type Rating = keyof typeof SUGGEST

const ALIASES = ['haiku', 'sonnet', 'opus'] as const
const KEEP = 'Keep current model'
const NEW_SESSION = 'Open in a new session'
const HANDOFF =
  'The user chose to run this task in a new session. Start one with the start_session tool ' +
  '(initiation "user_asked", context "fresh"), using the prompt above as its brief, and do not do the task here.'

/** Rates the prompt and asks the person; undefined when there is nothing to ask or they dismissed it. */
async function choose($: EngineInterface, e: PromptSubmitInput): Promise<string | undefined> {
  try {
    const rating = (await $.model.classify(e.text, Object.keys(SUGGEST))) as Rating | undefined
    if (!rating) return undefined

    const current = await $.session.model()
    const suggested = SUGGEST[rating]
    // ponytail: start_session exists only in the desktop app, so the hand-off is offered there alone
    const canHandOff = rating === 'complex' && (await $.session.surfaces()).includes('desktop')
    const options = [
      ...(current.toLowerCase().includes(suggested) ? [] : [`Switch to ${suggested}`]),
      KEEP,
      ...(canHandOff ? [NEW_SESSION] : []),
    ]
    if (options.length < 2) return undefined

    return await $.ui.ask(`This prompt looks ${rating}. Keep running it on ${current}?`, {
      header: 'Model',
      options,
    })
  } catch {
    return undefined // classifier failed or the dialog was dismissed: leave the prompt alone
  }
}

export const register: Register = on => {
  // The model the person picked for the main loop; undefined leaves the session's own.
  let model: string | undefined

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta || e.turnId || (await $.session.turns()) > 0) return next(e)

    const answer = await choose($, e)
    if (answer === undefined) return next(e)
    if (answer === NEW_SESSION) return next({ ...e, context: [...(e.context ?? []), HANDOFF] })

    // A label or free text typed under "Other", such as "use sonnet".
    const picked = ALIASES.find(alias => answer.toLowerCase().includes(alias))
    if (picked) {
      model = picked
      $.ui.status(`model: ${picked} (prompt-triage)`)
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // a failure here never holds up the prompt

  // ponytail: rewrites each request rather than running /model, which cannot run while the prompt waits on this hook
  on('turn.step', async function* ($, e, next) {
    return yield* next(model && !e.agentId ? { ...e, model } : e)
  })

  // The person's own /model wins from then on.
  on('command.run', { command: 'model' }, ($, e, next) => {
    model = undefined
    $.ui.status(undefined)
    return next(e)
  }).catch(($, e, next) => next(e))
}
