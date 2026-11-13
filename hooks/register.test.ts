import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type {
  AgentSpawnInput,
  ModelCompleteInput,
  On,
  PromptOrigin,
  PromptChangeInput,
  PromptEditInput,
  PromptSubmitInput,
  RenderElement,
  RenderSurface,
  TurnStepInput,
} from 'claude-code'

type Setup = {
  turns?: number
  /** The rater's reply; undefined fails the call, TIMEOUT times it out and THROW rejects it. */
  rating?: string
  model?: string
  surfaces?: RenderSurface[]
  /** The label the person picks, or one per dialog in order; undefined dismisses the dialog. */
  answer?: string | string[]
  /** The reviewer's reply, or one per review call in order; undefined fails the review call, and THROW rejects it. */
  review?: string | string[]
  /** Whether a path the prompt names exists, or the only paths that do. */
  exists?: boolean | string[]
  /** Whether the prompt box takes the rewrite; undefined takes it. */
  isFilled?: boolean
  /** The restatement the rater adds on a second line under its label; none adds no line. */
  restate?: string
  /** The draft in the prompt box, read at each `$.prompt.read()`; empty when not given. */
  draft?: string
  /** What the mod's store holds at the start. */
  store?: Record<string, unknown>
  /** Every store write fails, as a full store would. */
  storeFails?: boolean
  /** Every store read fails, as an unreadable store file would; writes still land. */
  storeReadFails?: boolean
  /** Runs as each review call starts, as the person typing during the review would. */
  onReview?: () => void
  /** Runs, and is awaited, as each `$.prompt.fill()` call starts, as a /clear landing while the fill is pending would. */
  onFill?: () => Promise<unknown> | void
  /** The session's cost in US dollars, or one reading per `$.session.usage()` call in order; undefined leaves `cost` out. */
  usd?: number | number[]
  /** Every `$.session.usage()` call rejects. */
  usageFails?: boolean
  /** The context percent, or one reading per `$.session.usage()` call in order; undefined leaves `context.percent` out, as on a fresh session. */
  pct?: number | number[]
  /** The tokens the last response was answered over (`context.tokens`); undefined leaves them out, as on a fresh session. */
  tokens?: number
  /** Every `$.session.turns()` call rejects; set it after the first prompt, which reads the turn count too. */
  turnsFails?: boolean
  /** Holds each `$.session.turns()` answer until it settles, answering the count read when the call began. */
  turnsGate?: Promise<void>
  /** Runs as each `$.session.turns()` call begins, before the gate. */
  onTurns?: () => void
  /** Every slash command a test or the mod runs is refused, as a host past its limit would. */
  commandFails?: boolean
  /** Runs as the engine compacts, as the transcript shrinking to its summary would. */
  onCompact?: () => void
  /** `$.session.model()` rejects, so the first-prompt hook fails before it passes the prompt on. */
  modelFails?: boolean
  /** A prompt text the session refuses to enter, as another plugin's drop would. */
  refuse?: string
}

const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const REVIEWED =
  '<issues>\n- No done-criteria\n- Which services?\n</issues>\n<prompt>Redesign auth in api, web and admin; done when tests pass.</prompt>'

/** A review reply that makes the review call reject, as a dropped connection would. */
const THROW = '<throw>'
/** The value `$.session.id()` answers, so a test can show the store never holds it. */
const SESSION_ID = 'session-7f3a9c'
/** A rater reply that makes the call time out. */
const TIMEOUT = '<timeout>'

/** A setting's value for this call: a list gives out its items in order, then undefined. */
const take = (v: string | string[] | undefined) => (Array.isArray(v) ? v.shift() : v)

/** Runs what is due on the last engine's mocked clock, such as a band Refine's timer. */
let settle: () => Promise<void> = async () => {}

/** Answers, beneath the plugin, every engine call the mod makes. */
function engine(on: On, s: Setup) {
  const asked: string[][] = []
  const questions: string[] = []
  /** How many model.complete calls had happened when each dialog opened. */
  const completesAtAsk: number[] = []
  let completes = 0
  const submitted: PromptSubmitInput[] = []
  const steps: TurnStepInput[] = []
  const status: (string | undefined)[] = []
  const toasts: string[] = []
  const filled: string[] = []
  const reviewed: string[] = []
  const reviews: ModelCompleteInput[] = []
  const ratings: ModelCompleteInput[] = []
  /** Every agent.spawn input that reached the engine, after the mod's hook. */
  const spawned: AgentSpawnInput[] = []
  let classified = 0
  let writes = 0

  on('session.turns', async () => {
    if (s.turnsFails) throw new Error('turns unavailable')
    const value = s.turns ?? 0
    s.onTurns?.()
    await s.turnsGate
    return { value }
  })
  on('session.model', () => {
    if (s.modelFails) throw new Error('model unavailable')
    return { value: s.model ?? 'claude-sonnet-5-5' }
  })
  on('session.surfaces', () => ({ value: s.surfaces ?? ['terminal'] }))
  on('prompt.read', () => ({ value: { text: s.draft ?? '', cursor: (s.draft ?? '').length } }))
  on('session.id', () => ({ value: SESSION_ID }))
  on('session.usage', () => {
    if (s.usageFails) throw new Error('usage unavailable')
    const usd = Array.isArray(s.usd) ? s.usd.shift() : s.usd
    const percent = Array.isArray(s.pct) ? s.pct.shift() : s.pct
    return {
      value: {
        startedAt: 0,
        context: { window: 200_000, ...(percent === undefined ? {} : { percent }), ...(s.tokens === undefined ? {} : { tokens: s.tokens }) },
        rateLimits: [],
        ...(usd === undefined ? {} : { cost: { usd } }),
      },
    }
  })
  // The engine's own end of a turn beneath the plugin: the answer passes through as the text shown.
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  // The band's Refine runs from a timer; a test moves this clock to run it.
  const clock = mock.clock(on)
  settle = clock.settle
  // The mod's store, kept here so a test reads what was saved.
  const store: Record<string, unknown> = { ...s.store }
  on('store.get', (_$, e) => {
    if (s.storeReadFails) throw new Error('store unreadable')
    return { value: store[e.key] }
  })
  on('store.set', (_$, e) => {
    if (s.storeFails) throw new Error('store full')
    store[e.key] = JSON.parse(JSON.stringify(e.value))
    writes++
    return { value: undefined }
  })
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  // The engine's compaction beneath the plugin: it keeps the transcript as given, which is all a redraw test needs.
  on('session.compact', (_$, e) => {
    s.onCompact?.()
    return { messages: e.messages }
  })
  // The engine's measurement beneath the plugin: it echoes which figures moved.
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  // Counts band redraws and passes each one on, so a mounted band still redraws.
  let redraws = 0
  on('ui.invalidate', ($, e, next) => {
    redraws++
    return next(e)
  })
  // The mod rates with model.complete; a call here is counted so a test can show it never happens.
  on('model.classify', () => {
    classified++
    return { value: s.rating ?? 'complex' }
  })
  on('tool.call', (_$, e, next) => {
    if (e.tool !== 'AskUserQuestion') return next(e)
    const q = e.questions[0]!
    completesAtAsk.push(completes)
    asked.push(q.options.map(o => o.label))
    questions.push(q.question)
    const answer = take(s.answer)
    if (answer === undefined) return { deny: 'dismissed' }
    return { result: { questions: e.questions, answers: { [q.question]: answer } } }
  })
  on('ui.status', (_$, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  // The engine's own band beneath the plugin: the controls the engine and other mods draw there (the context ring, Compact), stood in for by one Text.
  on('ui.render', { component: 'AbovePrompt' }, $ => {
    const { Box, Text } = $.ui.resolve({ surface: 'terminal', component: 'AbovePrompt' })
    return h(Box, null, h(Text, null, ENGINE_BAND)) as RenderElement
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_$, e) => {
    if (e.text === s.refuse) return { drop: 'refused' }
    submitted.push(e)
    return { text: e.text, context: e.context }
  })
  on('turn.step', async function* (_$, e) {
    steps.push(e)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  // Every slash command that reaches the engine, by name, so a test sees the status row's Clear or Compact run.
  const ran: string[] = []
  on('command.run', (_$, e) => {
    if (s.commandFails) throw new Error('command refused')
    ran.push(e.command)
    return { text: '' }
  })
  // The engine's own spawn beneath the plugin: the subagent runs on the model the hook set, else the parent's.
  on('agent.spawn', (_$, e) => {
    spawned.push(e)
    return { model: e.model ?? e.parentModel ?? 'claude-sonnet-5-5', agentId: `agent-${spawned.length}` }
  })
  on('model.complete', (_$, e) => {
    completes++
    // The rater and the reviewer share this call; each one's system prompt tells them apart.
    const rating = e.system?.startsWith('You rate') ?? false
    if (rating) ratings.push(e)
    else {
      reviewed.push(e.prompt)
      reviews.push(e)
      s.onReview?.()
    }
    // The rater's label is on the first line and its restatement, when it gives one, on the second.
    const label = 'rating' in s ? s.rating : 'complex'
    const text = rating ? (s.restate && label && label !== THROW && label !== TIMEOUT ? `${label}\n${s.restate}` : label) : take(s.review)
    if (text === THROW) throw new Error('connection dropped')
    if (text === TIMEOUT) return { value: { isAnswered: false, reason: 'aborted', usage: USAGE } }
    return {
      value: text === undefined ? { isAnswered: false, reason: 'empty-reply', usage: USAGE } : { isAnswered: true, text, usage: USAGE },
    }
  })
  // The engine resolves each path against the working directory, so a listed path matches by its end.
  on('fs.exists', (_$, e) => ({ value: Array.isArray(s.exists) ? s.exists.some(p => e.path.endsWith(`/${p}`)) : (s.exists ?? true) }))
  on('prompt.fill', async (_$, e) => {
    await s.onFill?.()
    filled.push(e.text)
    return { isFilled: s.isFilled ?? true }
  })

  return {
    writes: () => writes,
    redraws: () => redraws,
    store,
    ran,
    asked,
    questions,
    submitted,
    steps,
    status,
    toasts,
    filled,
    reviewed,
    reviews,
    completesAtAsk,
    ratings,
    spawned,
    classified: () => classified,
  }
}

/** Submits a prompt as the person typing it. */
async function submit($: Engine, text: string) {
  return await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

/** Runs a slash command as the person typing it. */
async function command($: Engine, name: string, args = '') {
  return await $.command.run({ command: name, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
}

/** Runs one model request of the main loop, or of a subagent's. */
async function step($: Engine, agentId?: string, effort?: TurnStepInput['effort']) {
  const stream = $.turn.step({
    turnId: 't1',
    index: 0,
    model: 'claude-sonnet-5-5',
    messageCount: 1,
    ...(agentId ? { agentId } : {}),
    ...(effort !== undefined ? { effort } : {}),
  })
  for await (const _ of stream);
}

/** Ends one turn of the main loop, or of a subagent's, with `answer` as its text; returns the text shown. */
async function complete($: Engine, agentId?: string, answer = 'Done.') {
  return await $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', ...(agentId ? { agentId } : {}) })
}

test('a complex first prompt offers opus, and picking it routes main-loop requests to opus', async ($, on) => {
  const seen = engine(on, { answer: 'Switch to opus' })

  await submit($, 'Redesign the auth layer across three services')
  expect(seen.asked).toEqual([['Switch to opus', 'Keep claude-sonnet-5-5', 'Refine prompt']])
  expect(seen.status).toEqual(['running opus, not claude-sonnet-5-5'])

  await step($)
  await step($, 'sub-1')
  expect(seen.steps.map(s => s.model)).toEqual(['opus', 'claude-sonnet-5-5'])
})

test('keeping the current model leaves requests alone', async ($, on) => {
  const seen = engine(on, { answer: 'Keep claude-sonnet-5-5' })

  await submit($, 'Redesign the auth layer')
  await step($)
  expect(seen.steps[0]?.model).toBe('claude-sonnet-5-5')
})

test('free text under "Other" naming a model is taken', async ($, on) => {
  const seen = engine(on, { answer: 'use haiku please' })

  await submit($, 'Redesign the auth layer')
  await step($)
  expect(seen.steps[0]?.model).toBe('haiku')
})

test('free text naming two models switches nothing', async ($, on) => {
  const seen = engine(on, { answer: 'not haiku, use opus' })

  await submit($, 'Redesign the auth layer')
  await step($)
  expect(seen.steps[0]?.model).toBe('claude-sonnet-5-5')
  expect(seen.status).toEqual([])
})

test('free text that turns a model down switches nothing', async ($, on) => {
  const seen = engine(on, { answer: "no, don't use haiku" })

  await submit($, 'Redesign the auth layer')
  await step($)
  expect(seen.steps[0]?.model).toBe('claude-sonnet-5-5')
  expect(seen.status).toEqual([])
})

test('a complex prompt on a model above opus is not offered a step down', async ($, on) => {
  const seen = engine(on, { model: 'claude-fable-5-1', answer: 'Switch to opus' })

  await submit($, 'Redesign the auth layer')
  expect(seen.asked).toEqual([])
  await step($, undefined, 'low')
  expect(seen.steps[0]?.model).toBe('claude-sonnet-5-5')
  expect(seen.steps[0]?.effort).toBe('medium')
})

test('a later prompt in the session is not checked', async ($, on) => {
  const seen = engine(on, { turns: 1, answer: 'Switch to opus' })

  await submit($, 'Redesign the auth layer')
  expect(seen.ratings).toEqual([])
  expect(seen.asked).toEqual([])
})

test('nothing is asked when the rating matches the current model', async ($, on) => {
  const seen = engine(on, { rating: 'moderate', model: 'claude-sonnet-5-5', answer: 'Keep claude-sonnet-5-5' })

  await submit($, 'Rename this function')
  expect(seen.ratings.length).toBe(1)
  expect(seen.asked).toEqual([])
  expect(seen.submitted[0]?.text).toBe('Rename this function')
})

test('in the desktop app a complex prompt can be handed to a new session', async ($, on) => {
  const seen = engine(on, { surfaces: ['desktop'], answer: 'Open in a new session' })

  await submit($, 'Redesign the auth layer')
  expect(seen.asked[0]).toContain('Open in a new session')
  expect(seen.submitted[0]?.context?.some(c => c.includes('start_session'))).toBe(true)
  await step($)
  expect(seen.steps[0]?.model).toBe('claude-sonnet-5-5')
})

test('the terminal is not offered a new session', async ($, on) => {
  const seen = engine(on, { surfaces: ['terminal'], answer: 'Keep claude-sonnet-5-5' })

  await submit($, 'Redesign the auth layer')
  expect(seen.asked[0]).not.toContain('Open in a new session')
})

test('a dismissed dialog lets the prompt through unchanged', async ($, on) => {
  const seen = engine(on, {})

  await submit($, 'Redesign the auth layer')
  expect(seen.asked.length).toBe(1)
  expect(seen.submitted[0]?.text).toBe('Redesign the auth layer')
  expect(seen.submitted[0]?.context).toBeUndefined()
})

test("the person's own /model ends the override", async ($, on) => {
  const seen = engine(on, { answer: 'Switch to opus' })

  await submit($, 'Redesign the auth layer')
  await $.command.run({ command: 'model', args: 'sonnet', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  await step($)
  expect(seen.steps[0]?.model).toBe('claude-sonnet-5-5')
  expect(seen.status.at(-1)).toBeUndefined()
})

test('improving the first prompt holds it back and puts the rewrite in the prompt box', async ($, on) => {
  const seen = engine(on, { answer: 'Refine prompt', review: REVIEWED })

  const result = await submit($, 'Redesign the auth layer')
  expect(seen.submitted).toEqual([])
  expect(seen.filled).toEqual(['Redesign auth in api, web and admin; done when tests pass.'])
  expect(result.drop).toContain('No done-criteria')
  expect(result.drop).toContain('Which services?')
  // The app draws a drop reason on one row, where a newline shows as a stray glyph.
  expect(result.drop).not.toMatch(/\n/)
})

test('the improved prompt is rated again when sent, without offering another improvement', async ($, on) => {
  const seen = engine(on, { answer: 'Refine prompt', review: REVIEWED })

  await submit($, 'Redesign the auth layer')
  await submit($, seen.filled[0]!)
  expect(seen.asked[1]).toEqual(['Switch to opus', 'Keep claude-sonnet-5-5'])
  expect(seen.submitted[0]?.text).toBe('Redesign auth in api, web and admin; done when tests pass.')
})

test('a path the prompt names that does not exist is reported', async ($, on) => {
  const seen = engine(on, { answer: 'Refine prompt', review: REVIEWED, exists: false })

  const result = await submit($, 'Fix the bug in src/auth/session.ts')
  expect(result.drop).toContain('src/auth/session.ts')
  expect(seen.filled.length).toBe(1)
})

test('a word with a slash is not checked as a path unless it looks like one', async ($, on) => {
  engine(on, { answer: 'Refine prompt', review: REVIEWED, exists: false })

  const result = await submit($, 'Support and/or filters in ./src/filters.ts')
  expect(result.drop).toContain('./src/filters.ts')
  expect(result.drop).not.toContain('and/or')
})

test('a path the rewrite names that does not exist is reported, and a glob is checked by its folder', async ($, on) => {
  const review = '<issues>\n</issues>\n<prompt>Lint every *.md file in scripts/triage/*.py and tools/gen/*.py.</prompt>'
  engine(on, { answer: 'Refine prompt', review, exists: ['scripts/triage'] })

  const result = await submit($, 'Lint every *.md file')
  expect(result.drop).toContain('tools/gen/*.py')
  expect(result.drop).not.toContain('scripts/triage/*.py was not found')
  expect(result.drop).not.toContain('*.md was not found')
})

test('a path only the rewrite names is checked even when the prompt names ten', async ($, on) => {
  const named = Array.from({ length: 10 }, (_, i) => `a${i}.ts`)
  const review = `<issues>\n</issues>\n<prompt>Lint ${named.join(' ')} and ghost.ts.</prompt>`
  engine(on, { answer: 'Refine prompt', review, exists: named })

  const result = await submit($, `Lint ${named.join(' ')}`)
  expect(result.drop).toContain('ghost.ts')
})

test('a rewrite the prompt box could not take is shown exactly as written', async ($, on) => {
  const rewrite = 'Redesign auth:\n- api\n- web\n\n```\n  keep   this\n```'
  engine(on, { answer: 'Refine prompt', review: `<issues>\n- No done-criteria\n</issues>\n<prompt>${rewrite}</prompt>`, isFilled: false })

  const result = await submit($, 'Redesign the auth layer')
  expect(result.drop).toContain(rewrite)
})

test('a failed review sends the prompt unchanged', async ($, on) => {
  const seen = engine(on, { answer: 'Refine prompt' })

  const result = await submit($, 'Redesign the auth layer')
  expect(result.drop).toBeUndefined()
  expect(seen.filled).toEqual([])
  expect(seen.submitted[0]?.text).toBe('Redesign the auth layer')
})

test('a session start registers /refine-prompt, the name its command hook answers to', async ($, on) => {
  const registered: string[] = []
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(registered).toEqual(['refine-prompt', 'triage-stats'])
})

test('/refine-prompt reviews any prompt and puts the rewrite in the prompt box', async ($, on) => {
  const seen = engine(on, { turns: 3, review: REVIEWED })

  const result = await command($, 'refine-prompt', 'Redesign the auth layer')
  expect(seen.filled).toEqual(['Redesign auth in api, web and admin; done when tests pass.'])
  expect(result.text).toContain('\n- Which services?')
})

test('/refine-prompt with no prompt reviews nothing', async ($, on) => {
  const seen = engine(on, { review: REVIEWED })

  const result = await command($, 'refine-prompt')
  expect(seen.filled).toEqual([])
  expect(result.text).toBeTruthy()
})

test('/refine-prompt strips a long run of trailing punctuation in linear time', async ($, on) => {
  const seen = engine(on, { turns: 3, review: REVIEWED })

  // A run of closing punctuation that ends in a letter made the trailing-strip regex retry from every position: 80k took ~4.5 s.
  const started = performance.now()
  await command($, 'refine-prompt', `${')'.repeat(80_000)}x`)
  expect(performance.now() - started).toBeLessThan(1000)
  expect(seen.filled).toEqual(['Redesign auth in api, web and admin; done when tests pass.'])
})

const QUESTION = '<question>\nWhich files should the review cover?\n- Hook code\n- Whole repo\n</question>\n'
const ASKS = `<issues>\n- Placeholders left unfilled\n</issues>\n${QUESTION}<prompt>Review the workflow.</prompt>`
const ANSWERED = '<issues>\n</issues>\n<prompt>Review hooks/register.ts.</prompt>'

test('improving asks the questions only the person can answer, then rewrites with the answers', async ($, on) => {
  const seen = engine(on, { answer: ['Refine prompt', 'Hook code'], review: [ASKS, ANSWERED] })

  const result = await submit($, 'Review the workflow. [Specify the files.]')
  expect(seen.asked[1]).toEqual(['Hook code', 'Whole repo'])
  expect(seen.reviewed[1]).toContain('Which files should the review cover? Hook code')
  expect(seen.filled).toEqual(['Review hooks/register.ts.'])
  expect(result.drop).not.toContain('Placeholders left unfilled')
})

test('dismissing a question stops the questions and keeps the first rewrite', async ($, on) => {
  const two = ASKS.replace('<prompt>', '<question>\nDone when?\n- Tests pass\n- Reviewed\n</question>\n<prompt>')
  const seen = engine(on, { answer: ['Refine prompt'], review: [two, ANSWERED] })

  await submit($, 'Review the workflow.')
  expect(seen.asked.length).toBe(2)
  expect(seen.reviewed.length).toBe(1)
  expect(seen.filled).toEqual(['Review the workflow.'])
})

test('a question with fewer than two answers to pick from is not asked', async ($, on) => {
  const seen = engine(on, { turns: 3, review: '<issues>\n</issues>\n<question>\nWhich files?\n- All\n</question>\n<prompt>Review it.</prompt>' })

  await command($, 'refine-prompt', 'Review the workflow.')
  expect(seen.asked).toEqual([])
  expect(seen.filled).toEqual(['Review it.'])
})

test('only "- " lines count as answers to pick from', async ($, on) => {
  const review = '<issues>\n</issues>\n<question>\nWhich files?\n- All\n-\nIt depends on the scope.\n</question>\n<prompt>Review it.</prompt>'
  const seen = engine(on, { turns: 3, review })

  await command($, 'refine-prompt', 'Review the workflow.')
  expect(seen.asked).toEqual([])
})

test('a second review that throws keeps the first rewrite', async ($, on) => {
  const seen = engine(on, { answer: ['Refine prompt', 'Hook code'], review: [ASKS, THROW] })

  const result = await submit($, 'Review the workflow.')
  expect(seen.filled).toEqual(['Review the workflow.'])
  expect(seen.submitted).toEqual([])
  expect(result.drop).toBeTruthy()
})

test('/refine-prompt asks at most three questions', async ($, on) => {
  const many = `<issues>\n</issues>\n${QUESTION.repeat(4)}<prompt>Review the workflow.</prompt>`
  const seen = engine(on, { turns: 3, answer: ['Hook code', 'Hook code', 'Hook code', 'Hook code'], review: [many, ANSWERED] })

  await command($, 'refine-prompt', 'Review the workflow.')
  expect(seen.asked.length).toBe(3)
  expect(seen.filled).toEqual(['Review hooks/register.ts.'])
})

test('a complex prompt raises main-loop effort below medium, and leaves the rest alone', async ($, on) => {
  const seen = engine(on, { answer: 'Keep claude-sonnet-5-5' })

  await submit($, 'Redesign the auth layer')
  await step($, undefined, 'low')
  await step($, undefined, 'xhigh')
  await step($, 'sub-1', 'low')
  await step($)
  await step($, undefined, 2048)
  expect(seen.steps.map(s => s.effort)).toEqual(['medium', 'xhigh', 'low', undefined, 2048])
  expect(seen.status.at(-1)).toBe('effort raised to medium')
})

test('a moderate prompt raises effort to medium even when nothing is asked', async ($, on) => {
  const seen = engine(on, { rating: 'moderate', model: 'claude-sonnet-5-5' })

  await submit($, 'Rename this function')
  expect(seen.asked).toEqual([])
  await step($, undefined, 'low')
  expect(seen.steps[0]?.effort).toBe('medium')
})

test('a simple prompt leaves effort alone', async ($, on) => {
  const seen = engine(on, { rating: 'simple', answer: 'Keep claude-sonnet-5-5' })

  await submit($, 'Fix a typo')
  await step($, undefined, 'low')
  expect(seen.steps[0]?.effort).toBe('low')
})

test('a dismissed dialog leaves effort alone', async ($, on) => {
  const seen = engine(on, {})

  await submit($, 'Redesign the auth layer')
  await step($, undefined, 'low')
  expect(seen.steps[0]?.effort).toBe('low')
})

test("the person's own /effort ends the effort minimum but keeps the model override", async ($, on) => {
  const seen = engine(on, { answer: 'Switch to opus' })

  await submit($, 'Redesign the auth layer')
  await step($, undefined, 'low')
  await command($, 'effort', 'low')
  await step($, undefined, 'low')
  expect(seen.steps.map(s => [s.model, s.effort])).toEqual([
    ['opus', 'medium'],
    ['opus', 'low'],
  ])
  expect(seen.status.at(-1)).toBe('running opus, not claude-sonnet-5-5')
})

test('a prompt rated again replaces the effort minimum and its status', async ($, on) => {
  const s: Setup = { answer: 'Keep claude-sonnet-5-5' }
  const seen = engine(on, s)

  await submit($, 'Redesign the auth layer')
  await step($, undefined, 'low')
  // Complex and moderate share a minimum now, so a simple rating, which sets none, shows the first one was replaced.
  // After a /clear, since a later prompt of the same conversation is not rated.
  await $.session.end({ reason: 'clear', sessionId: 'ended', resume: { id: 'next' } })
  s.rating = 'simple'
  await submit($, 'Fix a typo')
  await step($, undefined, 'low')
  expect(seen.steps.map(x => x.effort)).toEqual(['medium', 'low'])
  expect(seen.status.at(-1)).toBeUndefined()
})

test('/model after a raise keeps the effort part of the status line', async ($, on) => {
  const seen = engine(on, { answer: 'Switch to opus' })

  await submit($, 'Redesign the auth layer')
  await step($, undefined, 'low')
  expect(seen.status.at(-1)).toBe('running opus, not claude-sonnet-5-5, effort raised to medium')
  await command($, 'model', 'sonnet')
  expect(seen.status.at(-1)).toBe('effort raised to medium')
})

test('a complex prompt makes exactly one model.complete call before the dialog, rating and restating together', async ($, on) => {
  const seen = engine(on, { answer: 'Keep claude-sonnet-5-5', restate: 'Redesign auth across three services.' })

  await submit($, 'Redesign the auth layer across three services')
  expect(seen.completesAtAsk).toEqual([1])
  expect(seen.ratings.length).toBe(1)
  expect(seen.reviews.length).toBe(0)
  expect(seen.questions[0]).toMatch(/^Read as: Redesign auth across three services\. Rated complex/)
})

test("only the restatement's first line is shown, and a long one is cut", async ($, on) => {
  const seen = engine(on, { answer: 'Keep claude-sonnet-5-5', restate: `${'word '.repeat(40)}\nA second line.` })

  await submit($, 'Redesign the auth layer')
  expect(seen.questions[0]).not.toContain('A second line')
  expect(seen.questions[0]).toContain('…')
  expect(seen.questions[0]!.indexOf('Rated complex')).toBeLessThan(140)
})

test('a restatement that uses a rating word does not change the rating', async ($, on) => {
  const seen = engine(on, {
    rating: 'moderate',
    model: 'claude-opus-5-5',
    answer: 'Keep claude-opus-5-5',
    restate: 'Untangle the complex retry logic.',
  })

  await submit($, 'Untangle the retry logic')
  expect(seen.questions[0]).toContain('Rated moderate')
})

test('a rating reply with no restatement still shows the dialog without one', async ($, on) => {
  const seen = engine(on, { answer: 'Keep claude-sonnet-5-5' })
  await submit($, 'Redesign the auth layer')
  expect(seen.completesAtAsk).toEqual([1])
  expect(seen.asked).toEqual([['Switch to opus', 'Keep claude-sonnet-5-5', 'Refine prompt']])
  expect(seen.questions[0]).toMatch(/^Rated complex/)
  expect(seen.submitted[0]?.text).toBe('Redesign the auth layer')
})

test('a simple prompt shows no restatement even if the reply carries one', async ($, on) => {
  const simple = engine(on, { rating: 'simple', answer: 'Keep claude-sonnet-5-5', restate: 'Fix a typo.' })
  await submit($, 'Fix a typo')
  expect(simple.asked.length).toBe(1)
  expect(simple.completesAtAsk).toEqual([1])
  expect(simple.questions[0]).not.toContain('Read as')
})

test('a prompt that needs no dialog makes the one call and shows nothing', async ($, on) => {
  const seen = engine(on, { rating: 'moderate', model: 'claude-sonnet-5-5', restate: 'Rename a function.' })
  await submit($, 'Rename this function')
  expect(seen.ratings.length).toBe(1)
  expect(seen.asked).toEqual([])
})

test('the rating call asks for the restatement only on a second line, and not for simple prompts', async ($, on) => {
  const seen = engine(on, { answer: 'Keep claude-sonnet-5-5' })

  await submit($, 'Redesign the auth layer')
  const system = seen.ratings[0]!.system!
  expect(system).toContain('first line')
  expect(system).toContain('For simple, stop there')
  expect(system).toContain('second line')
})

test('the first prompt is rated by one low-effort haiku call against a four-label rubric', async ($, on) => {
  const seen = engine(on, { answer: 'Keep claude-sonnet-5-5' })

  await submit($, 'Redesign the auth layer')
  expect(seen.classified()).toBe(0)
  expect(seen.ratings.length).toBe(1)
  const r = seen.ratings[0]!
  expect([r.model, r.effort, r.maxTokens, r.timeoutMs]).toEqual(['haiku', 'low', 256, 10_000])
  for (const label of ['simple', 'moderate', 'complex', 'long-running']) expect(r.system).toContain(label)
  expect(r.prompt).toContain('Redesign the auth layer')
})

test('a rating reply that names a label among other words is taken', async ($, on) => {
  const seen = engine(on, { rating: 'Rating: moderate.', model: 'claude-opus-5-5', answer: 'Keep claude-opus-5-5' })

  await submit($, 'Add a flag to the CLI')
  expect(seen.asked[0]).toContain('Switch to sonnet')
})

for (const [how, rating] of [
  ['names no label', 'unsure'],
  ['names two labels', 'simple or complex'],
  ['times out', TIMEOUT],
  ['fails', undefined],
  ['throws', THROW],
] as const) {
  test(`a rating call that ${how} sends the prompt with no dialog`, async ($, on) => {
    const seen = engine(on, { rating, answer: 'Switch to opus' })

    await submit($, 'Redesign the auth layer')
    expect(seen.ratings.length).toBe(1)
    expect(seen.asked).toEqual([])
    expect(seen.submitted[0]?.text).toBe('Redesign the auth layer')
    await step($, undefined, 'low')
    expect(seen.steps[0]?.effort).toBe('low')
  })
}

for (const model of ['claude-mythos-5-1', 'Default (recommended)']) {
  test(`a complex prompt on ${model} is not offered opus`, async ($, on) => {
    const seen = engine(on, { model, surfaces: ['desktop'], answer: `Keep ${model}` })

    await submit($, 'Redesign the auth layer')
    expect(seen.asked.flat()).not.toContain('Switch to opus')
    await step($)
    expect(seen.steps[0]?.model).toBe('claude-sonnet-5-5')
  })
}

test('"use fable" under "Other" routes main-loop requests to fable', async ($, on) => {
  const seen = engine(on, { answer: 'use fable' })

  await submit($, 'Redesign the auth layer')
  await step($)
  await step($, 'sub-1')
  expect(seen.steps.map(s => s.model)).toEqual(['fable', 'claude-sonnet-5-5'])
  expect(seen.status).toEqual(['running fable, not claude-sonnet-5-5'])
})

test('a long-running prompt on opus offers fable, and a new session in the desktop app', async ($, on) => {
  const seen = engine(on, { rating: 'long-running', model: 'claude-opus-5-5', surfaces: ['desktop'], answer: 'Switch to fable' })

  await submit($, 'Migrate the whole codebase from Express to Fastify')
  expect(seen.asked).toEqual([['Switch to fable', 'Keep claude-opus-5-5', 'Open in a new session', 'Refine prompt']])
  expect(seen.questions[0]).toContain('Rated long-running')
  await step($, undefined, 'medium')
  expect(seen.steps[0]?.model).toBe('fable')
})

test('a long-running prompt on sonnet offers opus as a step down from fable', async ($, on) => {
  const seen = engine(on, { rating: 'long-running', model: 'claude-sonnet-5-5', answer: 'Switch to opus' })

  await submit($, 'Migrate the whole codebase from Express to Fastify')
  expect(seen.asked).toEqual([['Switch to fable', 'Switch to opus', 'Keep claude-sonnet-5-5', 'Refine prompt']])
  await step($, undefined, 'medium')
  expect(seen.steps[0]?.model).toBe('opus')
})

test('a complex prompt on sonnet offers no step down, since opus is already the suggestion', async ($, on) => {
  const seen = engine(on, { rating: 'complex', model: 'claude-sonnet-5-5', answer: 'Keep claude-sonnet-5-5' })

  await submit($, 'Redesign the auth layer')
  expect(seen.asked).toEqual([['Switch to opus', 'Keep claude-sonnet-5-5', 'Refine prompt']])
})

for (const model of ['claude-fable-5-1', 'claude-mythos-5-1']) {
  test(`a long-running prompt on ${model} offers no switch`, async ($, on) => {
    const seen = engine(on, { rating: 'long-running', model, answer: 'Switch to fable' })

    await submit($, 'Migrate the whole codebase from Express to Fastify')
    expect(seen.asked.flat()).not.toContain('Switch to fable')
    await step($)
    expect(seen.steps[0]?.model).toBe('claude-sonnet-5-5')
  })
}

test('a long-running prompt raises main-loop effort to medium', async ($, on) => {
  const seen = engine(on, { rating: 'long-running', model: 'claude-opus-5-5', answer: 'Keep claude-opus-5-5' })

  await submit($, 'Migrate the whole codebase from Express to Fastify')
  await step($, undefined, 'low')
  expect(seen.steps[0]?.effort).toBe('medium')
  expect(seen.status.at(-1)).toBe('effort raised to medium')
})

test('a simple prompt offers to keep the model at low effort first', async ($, on) => {
  const seen = engine(on, { rating: 'simple', answer: 'Keep claude-sonnet-5-5' })

  await submit($, 'What does git rebase --onto do?')
  expect(seen.asked).toEqual([['Keep model, effort low', 'Switch to haiku', 'Keep claude-sonnet-5-5', 'Refine prompt']])
})

test('keeping the model at low effort lowers main-loop requests to low and leaves subagents alone', async ($, on) => {
  const seen = engine(on, { rating: 'simple', answer: 'Keep model, effort low' })

  await submit($, 'What does git rebase --onto do?')
  await step($, undefined, 'high')
  await step($, 'sub-1', 'high')
  await step($)
  expect(seen.steps.map(s => [s.model, s.effort])).toEqual([
    ['claude-sonnet-5-5', 'low'],
    ['claude-sonnet-5-5', 'high'],
    ['claude-sonnet-5-5', undefined],
  ])
  expect(seen.status.at(-1)).toBe('effort lowered to low')
})

test("the person's own /effort ends the lowered effort", async ($, on) => {
  const seen = engine(on, { rating: 'simple', answer: 'Keep model, effort low' })

  await submit($, 'What does git rebase --onto do?')
  await command($, 'effort', 'high')
  await step($, undefined, 'high')
  expect(seen.steps[0]?.effort).toBe('high')
  expect(seen.status.at(-1)).toBeUndefined()
})

test('a simple prompt on haiku shows no dialog', async ($, on) => {
  const seen = engine(on, { rating: 'simple', model: 'claude-haiku-5-5', answer: 'Keep model, effort low' })

  await submit($, 'What does git rebase --onto do?')
  expect(seen.asked).toEqual([])
  await step($, undefined, 'high')
  expect(seen.steps[0]?.effort).toBe('high')
})

test('the refine review gets a reply cap of at least 4096 tokens that grows with the prompt', async ($, on) => {
  const seen = engine(on, { turns: 3, review: [REVIEWED, REVIEWED] })

  await command($, 'refine-prompt', 'Redesign the auth layer')
  await command($, 'refine-prompt', 'x'.repeat(20_000))
  const [short, long] = seen.reviews.map(r => r.maxTokens ?? 0)
  expect(short).toBeGreaterThanOrEqual(4096)
  expect(long).toBeGreaterThan(short!)
})

/** The refine band's props as the engine draws it above an idle prompt. */
const BAND = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} }

/** Draws the refine band on `surface` and sets its Run in pick to New session. */
async function armHandOff($: Engine, surface: 'desktop' | 'terminal' = 'desktop') {
  const band = await $.ui.mount({ plugin: 'prompt-triage', surface, component: 'AbovePrompt', props: BAND })
  await band.select({ key: 'run-in', value: 'new' })
  return band
}

const handsOff = (e?: PromptSubmitInput) => e?.context?.some(c => c.includes('start_session')) ?? false

test('Run in: New session hands the next prompt to a new session without the model dialog', async ($, on) => {
  const seen = engine(on, { surfaces: ['desktop'] })

  await armHandOff($)
  await submit($, 'Redesign the auth layer')
  expect(handsOff(seen.submitted[0])).toBe(true)
  expect(seen.asked).toEqual([])
  expect(seen.ratings).toEqual([])
})

test('Run in is one-shot: the band reads This session after an armed send, and the next prompt stays here', async ($, on) => {
  const seen = engine(on, { surfaces: ['desktop'], turns: 1 })

  const band = await armHandOff($)
  await submit($, 'Redesign the auth layer')
  expect((await band.find({ key: 'run-in' }))?.props.value).toBe('here')
  await submit($, 'Now add tests')
  expect(handsOff(seen.submitted[0])).toBe(true)
  expect(handsOff(seen.submitted[1])).toBe(false)
})

test('Run in hands off a later prompt in the session, not only the first', async ($, on) => {
  const seen = engine(on, { surfaces: ['desktop'], turns: 3 })

  await armHandOff($)
  await submit($, 'Port the billing module')
  expect(handsOff(seen.submitted[0])).toBe(true)
})

// The desktop band stays up while a turn runs, so the pick is often made then, and the prompt sent over that turn carries its turnId.
test('Run in hands off a prompt typed over a running turn, and the next idle prompt stays here', async ($, on) => {
  const seen = engine(on, { surfaces: ['desktop'], turns: 1 })

  const band = await armHandOff($)
  await $.prompt.submit({ text: 'Redesign the auth layer', wait: false, origin: { kind: 'composer' }, turnId: 't1' } as never)
  expect(handsOff(seen.submitted[0])).toBe(true)
  expect((await band.find({ key: 'run-in' }))?.props.value).toBe('here')
  await submit($, 'Now add tests')
  expect(handsOff(seen.submitted[1])).toBe(false)
})

// A notification or a peer's message delivered into a running turn also carries a turnId; only the person's own prompt takes the pick.
test('Run in ignores a delivery the person did not send, and hands off their next prompt', async ($, on) => {
  const seen = engine(on, { surfaces: ['desktop'], turns: 1 })

  const band = await armHandOff($)
  await $.prompt.submit({ text: 'Background task finished', wait: false, origin: { kind: 'task-notification' }, turnId: 't1' } as never)
  expect(handsOff(seen.submitted[0])).toBe(false)
  expect((await band.find({ key: 'run-in' }))?.props.value).toBe('new')
  await submit($, 'Redesign the auth layer')
  expect(handsOff(seen.submitted[1])).toBe(true)
})

test('the terminal band has no Run in, and an armed pick with no desktop attached sends here with a toast', async ($, on) => {
  const s: { surfaces: RenderSurface[]; turns: number } = { surfaces: ['terminal'], turns: 1 }
  const seen = engine(on, s)

  const terminal = await $.ui.mount({ plugin: 'prompt-triage', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await terminal.find({ key: 'run-in' })).toBeUndefined()

  s.surfaces = ['desktop']
  await armHandOff($)
  s.surfaces = ['terminal']
  await submit($, 'Redesign the auth layer')
  expect(handsOff(seen.submitted[0])).toBe(false)
  expect(seen.toasts.length).toBe(1)
})

// Phase 1 of the refine band: Goal, Workflow and Scope pickers and a Refine button.

/** A draft of 40 characters or more, which the band's default `long` setting shows for. */
const LONG = 'Redesign the auth layer across every service we run'
const SURFACES = ['terminal', 'desktop'] as const
const PICKERS = ['goal', 'workflow', 'scope'] as const

/** Draws the refine band on `surface`, with `props` over an idle band's. */
async function band($: Engine, surface: 'desktop' | 'terminal' = 'terminal', props: Partial<typeof BAND> = {}) {
  return await $.ui.mount({ plugin: 'prompt-triage', surface, component: 'AbovePrompt', props: { ...BAND, ...props } })
}

/** Presses the band's Refine and runs the review it starts on a timer. */
async function refine(ui: Awaited<ReturnType<typeof band>>) {
  await ui.press({ key: 'refine' })
  await settle()
}

/** Whether the drawing holds the phase 1 pickers and the Refine button. */
async function hasPickers(ui: Awaited<ReturnType<typeof band>>) {
  const found = await Promise.all([...PICKERS, 'refine'].map(key => ui.find({ key })))
  expect(found.every(Boolean) || found.every(f => !f)).toBe(true)
  return found.every(Boolean)
}

test('a long draft shows Goal, Workflow, Scope and Refine on the terminal and the desktop', async ($, on) => {
  engine(on, { draft: LONG, surfaces: ['desktop'] })

  for (const surface of SURFACES) expect(await hasPickers(await band($, surface))).toBe(true)
  // Run in stays desktop-only beside them.
  expect(await (await band($, 'desktop')).find({ key: 'run-in' })).toBeDefined()
  expect(await (await band($, 'terminal')).find({ key: 'run-in' })).toBeUndefined()
})

test('the band shows only for a draft that is not empty, not a slash command and long or multi-line', async ($, on) => {
  const s: Setup = {}
  engine(on, s)

  for (const [draft, shown] of [
    ['', false],
    ['   ', false],
    ['Fix the typo', false],
    [`Fix the typo\nin the README`, true],
    // A line break at the end (Shift+Enter after the last word) counts too.
    ['Fix the typo\n', true],
    [LONG, true],
    [`/review ${LONG}`, false],
  ] as const) {
    s.draft = draft
    for (const surface of SURFACES) expect([draft, surface, await hasPickers(await band($, surface))]).toEqual([draft, surface, shown])
  }
})

/**
 * The prompt box's own events, raised as the editor raises them. The test kit runs them on `$.prompt`, but its declarations list
 * neither as a call there, so this one cast is where the tests reach them.
 */
const editor = ($: Engine) =>
  $.prompt as unknown as { edit: (e: PromptEditInput) => Promise<unknown>; change: (e: PromptChangeInput) => Promise<unknown> }

// Typing redraws the band only when the show rule's answer flips, not on every key.
test('an edit redraws the band only when the draft starts or stops meeting the show rule', async ($, on) => {
  const seen = engine(on, {})
  // The editor beneath the plugin applies the splice, as core does.
  on('prompt.edit', (_$, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
  const edit = (text: string, inputText: string) =>
    editor($).edit({ origin: { kind: 'composer' }, text, cursor: text.length, start: text.length, end: text.length, inputText })

  const before = seen.redraws()
  await edit('', LONG)
  expect(seen.redraws()).toBe(before + 1)
  await edit(LONG, '!')
  expect(seen.redraws()).toBe(before + 1)
  await edit('', 'Fix it')
  expect(seen.redraws()).toBe(before + 2)
})

test('a change to the box from outside an edit redraws the band only when the show rule flips', async ($, on) => {
  const seen = engine(on, {})
  on('prompt.change', (_$, e) => ({ text: e.text }))
  const change = (text: string) => editor($).change({ text, cursor: text.length, origin: { kind: 'history' } })

  const before = seen.redraws()
  await change(LONG)
  expect(seen.redraws()).toBe(before + 1)
  await change(`${LONG} again`)
  expect(seen.redraws()).toBe(before + 1)
  await change('')
  expect(seen.redraws()).toBe(before + 2)
})

test('band: always shows a short draft', { options: { band: 'always' } }, async ($, on) => {
  engine(on, { draft: 'Fix the typo' })
  expect(await hasPickers(await band($))).toBe(true)
})

test('band: never hides the pickers but keeps Run in on the desktop', { options: { band: 'never' } }, async ($, on) => {
  engine(on, { draft: LONG, surfaces: ['desktop'] })
  expect(await hasPickers(await band($, 'terminal'))).toBe(false)
  const desktop = await band($, 'desktop')
  expect(await hasPickers(desktop)).toBe(false)
  expect(await desktop.find({ key: 'run-in' })).toBeDefined()
})

test('the band yields to a survey, and shows while a turn runs', async ($, on) => {
  engine(on, { draft: LONG })
  expect(await hasPickers(await band($, 'terminal', { hasSurvey: true }))).toBe(false)
  expect(await hasPickers(await band($, 'terminal', { isWorking: true }))).toBe(true)
})

test('an empty desktop draft keeps Run in alone', async ($, on) => {
  engine(on, { surfaces: ['desktop'] })
  const desktop = await band($, 'desktop')
  expect(await hasPickers(desktop)).toBe(false)
  expect(await desktop.find({ key: 'run-in' })).toBeDefined()
})

test('picks are saved and drawn again from the store', async ($, on) => {
  const seen = engine(on, { draft: LONG, store: { picks: { goal: 'check', workflow: 'plan', scope: 'minimal' } } })

  const ui = await band($)
  expect((await ui.find({ key: 'goal' }))?.props.value).toBe('check')
  expect((await ui.find({ key: 'workflow' }))?.props.value).toBe('plan')
  expect((await ui.find({ key: 'scope' }))?.props.value).toBe('minimal')
  await ui.select({ key: 'scope', value: 'ambitious' })
  expect(seen.store.picks).toEqual({ goal: 'check', workflow: 'plan', scope: 'ambitious' })
  expect((await (await band($)).find({ key: 'scope' }))?.props.value).toBe('ambitious')
})

test('a stored pick that is not an option falls back to its default', async ($, on) => {
  engine(on, { draft: LONG, store: { picks: { goal: 'as-goal', workflow: 7 } } })
  const ui = await band($)
  const values = await Promise.all(PICKERS.map(async key => (await ui.find({ key }))?.props.value))
  expect(values).toEqual(['auto', 'written', 'written'])
})

test('every pick changes the reviewer instructions, and the defaults add none', async ($, on) => {
  const seen = engine(on, { draft: LONG, review: Array(20).fill(REVIEWED) })
  const ui = await band($)
  const options = { goal: ['check', 'off'], workflow: ['plan', 'interview', 'test'], scope: ['minimal', 'ambitious'] }

  await refine(ui)
  await ui.press({ key: 'done' })
  const plain = seen.reviews[0]!.system!
  // The defaults send the reviewer's instructions as /refine-prompt sent them before the band existed.
  await command($, 'refine-prompt', LONG)
  expect(seen.reviews[1]!.system).toBe(plain)

  const systems: string[] = []
  for (const key of PICKERS) {
    for (const value of options[key]) {
      await ui.select({ key, value })
      await refine(ui)
      await ui.press({ key: 'done' })
      systems.push(seen.reviews.at(-1)!.system!)
    }
    await ui.select({ key, value: key === 'goal' ? 'auto' : 'written' })
  }
  expect(new Set([plain, ...systems]).size).toBe(systems.length + 1)
  for (const system of systems) expect(system.startsWith(plain)).toBe(true)
})

test('Refine reviews the draft, puts the rewrite in the box and shows a result row', async ($, on) => {
  const seen = engine(on, { draft: LONG, review: REVIEWED })
  const ui = await band($)

  await refine(ui)
  expect(seen.reviewed[0]).toContain(LONG)
  expect(seen.filled).toEqual(['Redesign auth in api, web and admin; done when tests pass.'])
  expect(await hasPickers(ui)).toBe(false)
  expect((await ui.find({ key: 'result' }))?.text).toMatch(/\b2\b/)
  expect(await ui.find({ type: 'Text', text: /No done-criteria/ })).toBeUndefined()

  await ui.press({ key: 'show-issues' })
  expect(await ui.find({ type: 'Text', text: /No done-criteria/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Which services\?/ })).toBeDefined()

  await ui.press({ key: 'restore' })
  expect(seen.filled.at(-1)).toBe(LONG)
  expect(await hasPickers(ui)).toBe(true)
})

test('Done closes the result row without touching the prompt box', async ($, on) => {
  const seen = engine(on, { draft: LONG, review: REVIEWED })
  const ui = await band($)
  await refine(ui)
  await ui.press({ key: 'done' })
  expect(seen.filled.length).toBe(1)
  expect(await hasPickers(ui)).toBe(true)
})

// The Manage context button runs /clear with no prompt.submit, so the send that closes the row never comes.
test("a /clear closes the result row, so Restore original cannot put back the cleared conversation's draft", async ($, on) => {
  engine(on, { draft: LONG, review: REVIEWED })
  await refine(await band($))
  expect(await (await band($)).find({ key: 'result' })).toBeDefined()
  await $.session.end({ reason: 'clear', sessionId: 'ended', resume: { id: 'next' } })
  expect(await (await band($)).find({ key: 'result' })).toBeUndefined()
})

// The review runs from a timer, so a /clear can land while it is still running; its finish must not undo the /clear's reset.
test('a /clear during a band Refine drops that review: no fill, no result row, and Refine prompt is offered again', async ($, on) => {
  const seen = engine(on, { draft: LONG, review: REVIEWED, answer: 'Keep claude-sonnet-5-5' })
  const ui = await band($)
  await ui.press({ key: 'refine' })
  await $.session.end({ reason: 'clear', sessionId: 'ended', resume: { id: 'next' } })
  await settle()
  expect(seen.filled).toEqual([])
  expect(await (await band($)).find({ key: 'result' })).toBeUndefined()
  await submit($, 'Redesign the auth layer')
  expect(seen.asked.length).toBe(1)
  expect(seen.asked[0]).toContain('Refine prompt')
})

test('a /clear that lands while the band Refine fills the box brings back neither its result row nor a spent Refine offer', async ($, on) => {
  const s: Setup = { draft: LONG, review: REVIEWED, answer: 'Keep claude-sonnet-5-5' }
  const seen = engine(on, s)
  // Only the first fill: the clear runs once, mid-fill, after the review's own stale check passed.
  s.onFill = () => {
    s.onFill = undefined
    return $.session.end({ reason: 'clear', sessionId: 'ended', resume: { id: 'next' } })
  }
  await refine(await band($))
  expect(await (await band($)).find({ key: 'result' })).toBeUndefined()
  await submit($, 'Redesign the auth layer')
  expect(seen.asked.length).toBe(1)
  expect(seen.asked[0]).toContain('Refine prompt')
})

test('Plan first notes in the result row that Shift+Tab cycles to plan mode', async ($, on) => {
  engine(on, { draft: LONG, review: [REVIEWED, REVIEWED], store: { picks: { workflow: 'plan' } } })
  const ui = await band($)
  await refine(ui)
  expect(await ui.find({ type: 'Text', text: /shift\+tab/i })).toBeDefined()

  await ui.press({ key: 'done' })
  await ui.select({ key: 'workflow', value: 'written' })
  await refine(ui)
  expect(await ui.find({ type: 'Text', text: /shift\+tab/i })).toBeUndefined()
})

test('Refine asks the questions only the person can answer, then rewrites with the answers', async ($, on) => {
  const seen = engine(on, { draft: LONG, answer: 'Hook code', review: [ASKS, ANSWERED] })
  await refine(await band($))
  expect(seen.questions).toEqual(['Which files should the review cover?'])
  expect(seen.reviewed[1]).toContain('Hook code')
  expect(seen.filled).toEqual(['Review hooks/register.ts.'])
})

test('a draft changed during the review is left alone, with a toast and no result row', async ($, on) => {
  const s: Setup = { draft: LONG, review: REVIEWED, answer: ['Refine prompt'] }
  s.onReview = () => {
    s.draft = `${LONG}, and the admin app`
  }
  const seen = engine(on, s)
  const ui = await band($)

  await refine(ui)
  expect(seen.filled).toEqual([])
  expect(seen.toasts.length).toBe(1)
  expect(await ui.find({ key: 'result' })).toBeUndefined()
  // The first prompt was not refined, so the model dialog still offers to refine it.
  s.onReview = undefined
  await submit($, s.draft!)
  expect(seen.asked[0]).toContain('Refine prompt')
})

for (const [how, review] of [
  ['fails', undefined],
  ['throws', THROW],
] as const) {
  test(`a review that ${how} leaves the draft alone and says so in a toast`, async ($, on) => {
    const seen = engine(on, { draft: LONG, review })
    const ui = await band($)
    await refine(ui)
    expect(seen.filled).toEqual([])
    expect(seen.toasts.length).toBe(1)
    expect(await hasPickers(ui)).toBe(true)
  })
}

test('a band refine marks the first prompt refined, so the model dialog does not offer it again', async ($, on) => {
  const seen = engine(on, { draft: LONG, review: REVIEWED })
  await refine(await band($))
  await submit($, seen.filled[0]!)
  expect(seen.asked[0]).toEqual(['Switch to opus', 'Keep claude-sonnet-5-5'])
})

test('the result row outlasts a short draft until the prompt is sent', async ($, on) => {
  const s: Setup = { draft: LONG, review: REVIEWED, turns: 1 }
  engine(on, s)
  const ui = await band($)
  await refine(ui)

  s.draft = 'Fix it'
  expect(await (await band($)).find({ key: 'result' })).toBeDefined()
  await submit($, s.draft)
  expect(await (await band($)).find({ key: 'result' })).toBeUndefined()
})

test('Refine pressed twice while a review runs reviews once', async ($, on) => {
  const seen = engine(on, { draft: LONG, review: [REVIEWED, REVIEWED] })
  const ui = await band($)
  await Promise.all([ui.press({ key: 'refine' }), ui.press({ key: 'refine' })])
  await settle()
  expect(seen.reviews.length).toBe(1)
})

test('the model dialog and /refine-prompt refine with the stored picks', async ($, on) => {
  // Moderate, since a strong rating swaps an Auto Goal for Add a check in the dialog alone.
  const seen = engine(on, {
    rating: 'moderate',
    model: 'claude-opus-5-5',
    answer: 'Refine prompt',
    review: Array(3).fill(REVIEWED),
    draft: LONG,
    store: { picks: { scope: 'minimal' } },
  })

  await submit($, 'Redesign the auth layer')
  await command($, 'refine-prompt', 'Redesign the auth layer')
  await (await band($)).select({ key: 'scope', value: 'written' })
  await command($, 'refine-prompt', 'Redesign the auth layer')
  const [dialog, picked, plain] = seen.reviews.map(r => r.system!)
  expect(dialog).toBe(picked)
  expect(picked!.startsWith(plain!)).toBe(true)
  expect(picked).not.toBe(plain)
})

test('a prompt sent while the band reviews is not followed by the rewrite or a result row', async ($, on) => {
  const s: Setup = { draft: LONG, review: REVIEWED, turns: 1 }
  let sent: Promise<unknown> | undefined
  s.onReview = () => {
    sent = submit($, LONG)
  }
  const seen = engine(on, s)
  const ui = await band($)

  await refine(ui)
  await sent
  expect(seen.submitted.map(e => e.text)).toEqual([LONG])
  expect(seen.filled).toEqual([])
  expect(await ui.find({ key: 'result' })).toBeUndefined()
})

test('the Plan first note follows the pick the review used, not one changed during it', async ($, on) => {
  const s: Setup = { draft: LONG, review: REVIEWED, store: { picks: { workflow: 'plan' } } }
  let picked: Promise<unknown> | undefined
  const seen = engine(on, s)
  const ui = await band($)
  s.onReview = () => {
    picked = ui.select({ key: 'workflow', value: 'written' })
  }

  await refine(ui)
  await picked
  expect(seen.filled.length).toBe(1)
  expect(await ui.find({ type: 'Text', text: /shift\+tab/i })).toBeDefined()
})

test('the pickers are drawn Goal, Workflow, Scope, as the proposal lays them out', async ($, on) => {
  engine(on, { draft: LONG, surfaces: ['desktop'] })
  for (const surface of SURFACES) {
    const keys = (await (await band($, surface)).findAll({ type: 'Select' })).map(s => s.props.key)
    expect(keys.filter(k => k !== 'run-in')).toEqual(['goal', 'workflow', 'scope'])
  }
})

/** What the stand-in for the engine's own band draws; see `engine`. */
const ENGINE_BAND = 'engine band'
/** The element a mount's `find` returns, as far as these tests read it. */
type Node = { props?: Record<string, unknown>; children?: unknown[]; text?: string }
/** The key of every element drawn inside `node`, nested ones too. */
function keysIn(node: Node | undefined): string[] {
  const kids = (node?.children ?? []).filter((c): c is Node => typeof c === 'object' && c !== null)
  return kids.flatMap(c => [...(typeof c.props?.key === 'string' ? [c.props.key] : []), ...keysIn(c)])
}

/** Each string child of `node` that reads exactly `text`, nested ones too. */
function textsIn(node: Node | undefined, text: string): string[] {
  const kids = node?.children ?? []
  return kids.flatMap(c => (c === text ? [text] : typeof c === 'object' && c !== null ? textsIn(c as Node, text) : []))
}

// The mod's controls (Run in, the pickers, Refine or the result row, the status row and Manage context) are one bordered Triage section,
// so they read as the mod's own and not as part of the engine's band, which draws beneath them.
for (const surface of SURFACES) {
  test(`the mod's controls sit together in one bordered Triage section on the ${surface}`, async ($, on) => {
    engine(on, { draft: LONG, surfaces: ['desktop'], turns: 3, usd: 0.4, pct: 30 })
    const ui = await band($, surface)
    const section = (await ui.find({ key: 'triage' })) as Node | undefined

    expect(section?.props?.borderStyle).toBe('round')
    // Named once: a second label would crowd the first row.
    expect(textsIn(section, 'Triage')).toEqual(['Triage'])
    const inside = keysIn(section)
    for (const key of ['goal', 'workflow', 'scope', 'refine', 'status', 'tidy']) expect(inside).toContain(key)
    expect(inside.includes('run-in')).toBe(surface === 'desktop')
    // The engine's own band is drawn, and outside the section.
    expect(await ui.find({ type: 'Text', text: ENGINE_BAND })).toBeDefined()
    expect(section?.text).not.toContain(ENGINE_BAND)
  })
}

test('the Triage section holds the result row after a Refine', async ($, on) => {
  engine(on, { draft: LONG, review: REVIEWED, surfaces: ['desktop'] })
  const ui = await band($, 'desktop')
  await refine(ui)
  const result = keysIn((await ui.find({ key: 'triage' })) as Node | undefined)
  for (const key of ['result', 'done', 'restore', 'run-in']) expect(result).toContain(key)
})

test('the Triage section is Run in alone on an empty desktop draft before the first prompt', async ($, on) => {
  engine(on, { surfaces: ['desktop'] })
  const idle = (await (await band($, 'desktop')).find({ key: 'triage' })) as Node | undefined
  expect(keysIn(idle)).toEqual(['run-in'])
  expect(textsIn(idle, 'Triage')).toEqual(['Triage'])
})

test('with no controls row, the terminal section names itself in the status row', async ($, on) => {
  engine(on, { turns: 3, usd: 0.4, pct: 30 })
  const ui = await band($, 'terminal')
  const section = (await ui.find({ key: 'triage' })) as Node | undefined
  expect(textsIn(section, 'Triage')).toEqual(['Triage'])
  expect(textsIn((await ui.find({ key: 'status' })) as Node | undefined, 'Triage')).toEqual(['Triage'])
})

test('after a Refine the Triage label is in the result row, once', async ($, on) => {
  engine(on, { draft: LONG, review: REVIEWED, surfaces: ['desktop'] })
  const ui = await band($, 'desktop')
  await refine(ui)
  expect(textsIn((await ui.find({ key: 'triage' })) as Node | undefined, 'Triage')).toEqual(['Triage'])
  expect(textsIn((await ui.find({ key: 'result' })) as Node | undefined, 'Triage')).toEqual(['Triage'])
})

test('Refine returns at once and reviews from a timer, since a press has a 10 s budget the review and questions outlast', async ($, on) => {
  const seen = engine(on, { draft: LONG, review: REVIEWED })
  const ui = await band($)

  const idle = (await ui.find({ key: 'refine' }))?.props.label
  await ui.press({ key: 'refine' })
  expect(seen.reviews.length).toBe(0)
  // The button says a review is running until it ends.
  expect((await ui.find({ key: 'refine' }))?.props.label).not.toBe(idle)
  await settle()
  expect(seen.reviews.length).toBe(1)
  expect(seen.filled.length).toBe(1)
})

test('focusing the band starts on Refine, so r or Enter refines at once', async ($, on) => {
  engine(on, { draft: LONG, surfaces: ['desktop'] })
  for (const surface of SURFACES) {
    const ui = await band($, surface)
    const focused = [...(await ui.findAll({ type: 'Select' })), ...(await ui.findAll({ type: 'Button' }))].filter(e => e.props.autoFocus)
    expect(focused.map(e => e.props.key)).toEqual(['refine'])
  }
})

// A row that wraps (the band is too narrow for every control) needs a gap between its lines: on the desktop the buttons are taller than a text line,
// and with no gap the wrapped line, such as Run in, sat flush against the buttons above it.
for (const surface of SURFACES) {
  test(`a wrapping band row keeps a gap between its lines, idle and after a Refine, on the ${surface}`, async ($, on) => {
    engine(on, { draft: LONG, review: REVIEWED, surfaces: ['desktop'] })
    const ui = await band($, surface)
    const ungapped: string[] = []

    for (const stage of ['idle', 'result']) {
      if (stage === 'result') await refine(ui)
      const wrapping = (await ui.findAll({ type: 'Box' })).filter(box => box.props.flexWrap === 'wrap')
      // At least one wrapping row is drawn in each stage, so the loop below cannot pass by finding none.
      expect(wrapping.length).toBeGreaterThan(0)
      // The result stage must have drawn the result row, not the idle row again, or the result row would go unchecked.
      if (stage === 'result') expect(wrapping.some(box => box.props.key === 'result')).toBe(true)
      // A step name, not a number: a number is cells, which the terminal draws as blank rows, so the band would grow there.
      for (const box of wrapping) if (typeof box.props.rowGap !== 'string') ungapped.push(`${stage} ${String(box.props.key ?? 'row')}`)
    }
    expect(ungapped).toEqual([])
  })
}

// The Triage section's own rows (the controls row over the session estimate) sit on adjacent lines without a gap between them.
for (const surface of SURFACES) {
  test(`the Triage section keeps a gap between its rows, idle and after a Refine, on the ${surface}`, async ($, on) => {
    engine(on, { draft: LONG, review: REVIEWED, surfaces: ['desktop'] })
    const ui = await band($, surface)
    const ungapped: string[] = []

    for (const stage of ['idle', 'result']) {
      if (stage === 'result') await refine(ui)
      const sections = (await ui.findAll({ type: 'Box' })).filter(box => box.props.key === 'triage')
      // At least one section is drawn in each stage, so the check below cannot pass by finding none.
      expect(sections.length).toBeGreaterThan(0)
      // A step name, not a number, for the same reason as the wrapping rows above: a number is cells, which the terminal draws as blank rows.
      for (const box of sections) if (typeof box.props.gap !== 'string') ungapped.push(`${stage} triage`)
    }
    expect(ungapped).toEqual([])
  })
}

// --- The decision log and /triage-stats ---

/** One logged decision, as the store holds it. */
type Decision = {
  rating: string
  from: string
  to: string
  chose: string
  id?: string
  cost?: number
  prompts?: number
  /** What entries logged before `prompts` hold. */
  turns?: number
  ctx?: number
  effort?: string
  at?: string
}

test('a rated first prompt appends one decision naming the rating, the models before and after and the choice', async ($, on) => {
  const seen = engine(on, { answer: 'Switch to opus' })

  await submit($, 'Redesign the auth layer across three services')
  expect(seen.store.decisions).toEqual([
    expect.objectContaining({ rating: 'complex', from: 'claude-sonnet-5-5', to: 'opus', chose: 'Switch to opus' }),
  ])
})

test('a prompt that shows no dialog is logged as asked nothing, and a dismissed dialog as dismissed', async ($, on) => {
  const s: Setup = { rating: 'moderate', model: 'claude-sonnet-5-5' }
  const seen = engine(on, s)

  await submit($, 'Rename this function')
  await $.session.end({ reason: 'clear', sessionId: 'ended', resume: { id: 'next' } })
  s.rating = 'complex'
  await submit($, 'Redesign the auth layer')
  expect((seen.store.decisions as Decision[]).map(d => [d.rating, d.to, d.chose])).toEqual([
    ['moderate', 'claude-sonnet-5-5', 'none asked'],
    ['complex', 'claude-sonnet-5-5', 'dismissed'],
  ])
})

test('the decision log never holds more than its cap', async ($, on) => {
  const old: Decision[] = Array.from({ length: 200 }, (_, i) => ({ rating: 'simple', from: 'x', to: 'x', chose: `old ${i}` }))
  const seen = engine(on, { answer: 'Switch to opus', store: { decisions: old } })

  await submit($, 'Redesign the auth layer')
  const kept = seen.store.decisions as Decision[]
  expect(kept.length).toBe(200)
  expect(kept[0]?.chose).toBe('old 1')
  expect(kept.at(-1)?.chose).toBe('Switch to opus')
})

test('a failed store write does not hold up the prompt or the switch', async ($, on) => {
  const seen = engine(on, { answer: 'Switch to opus', storeFails: true })

  await submit($, 'Redesign the auth layer')
  expect(seen.submitted[0]?.text).toBe('Redesign the auth layer')
  await step($)
  expect(seen.steps[0]?.model).toBe('opus')
})

test('a failed store write still hands the prompt to a new session', async ($, on) => {
  // Without the log's own catch, the hook's outer catch would forward the prompt and silently drop the hand-off context.
  const seen = engine(on, { surfaces: ['desktop'], answer: 'Open in a new session', storeFails: true })

  await submit($, 'Redesign the auth layer')
  expect(seen.submitted[0]?.context?.some(c => c.includes('start_session'))).toBe(true)
})

test('free text under Other is logged as the model it names, never the text itself', async ($, on) => {
  const seen = engine(on, { answer: "use sonnet, it's the Stripe migration for acme" })

  await submit($, 'Redesign the auth layer')
  const [entry] = seen.store.decisions as Decision[]
  expect(entry).toEqual(expect.objectContaining({ rating: 'complex', from: 'claude-sonnet-5-5', to: 'sonnet', chose: 'other: sonnet' }))
  expect(JSON.stringify(seen.store)).not.toContain('Stripe')
})

test('free text naming no model is logged as other', async ($, on) => {
  const seen = engine(on, { answer: 'whatever you think' })

  await submit($, 'Redesign the auth layer')
  expect((seen.store.decisions as Decision[])[0]?.chose).toBe('other')
})

test('Keep is logged as its label when the model name has spaces', async ($, on) => {
  const seen = engine(on, { rating: 'moderate', model: 'Default (recommended)', answer: 'Keep Default (recommended)' })

  await submit($, 'Add a retry limit to the upload client')
  expect((seen.store.decisions as Decision[])[0]?.chose).toBe('Keep Default (recommended)')
})

test('free text under Other that starts with Keep and names another model is logged as other, not as Keep', async ($, on) => {
  const seen = engine(on, { answer: 'Keep opus' })

  await submit($, 'Redesign the auth layer')
  expect((seen.store.decisions as Decision[])[0]).toEqual(expect.objectContaining({ to: 'opus', chose: 'other: opus' }))
})

test('a failed store read never lets the next write replace the log', async ($, on) => {
  const old: Decision[] = [{ rating: 'simple', from: 'x', to: 'x', chose: 'old' }]
  const seen = engine(on, { answer: 'Switch to opus', store: { decisions: old }, storeReadFails: true })

  await submit($, 'Redesign the auth layer')
  expect(seen.store.decisions).toEqual(old)
  expect(seen.submitted[0]?.text).toBe('Redesign the auth layer')
  await step($)
  expect(seen.steps[0]?.model).toBe('opus')
})

test('a Refine whose review fails sends the prompt and logs the rated session as Refine prompt', async ($, on) => {
  const seen = engine(on, { answer: 'Refine prompt' })

  await submit($, 'Redesign the auth layer')
  expect(seen.submitted[0]?.text).toBe('Redesign the auth layer')
  expect(seen.store.decisions).toEqual([
    expect.objectContaining({ rating: 'complex', from: 'claude-sonnet-5-5', to: 'claude-sonnet-5-5', chose: 'Refine prompt' }),
  ])
})

test('refining then sending the rewrite logs one decision, for the rewrite', async ($, on) => {
  const seen = engine(on, { answer: ['Refine prompt', 'Switch to opus'], review: REVIEWED })

  await submit($, 'Redesign the auth layer')
  expect(seen.store.decisions).toBeUndefined()
  await submit($, seen.filled[0]!)
  expect((seen.store.decisions as Decision[]).map(d => d.chose)).toEqual(['Switch to opus'])
})

test('a session start registers /triage-stats beside /refine-prompt', async ($, on) => {
  const registered: string[] = []
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(registered).toContain('triage-stats')
})

test('/triage-stats tallies every rating and how often a switch was accepted', async ($, on) => {
  const decisions: Decision[] = [
    { rating: 'simple', from: 'claude-sonnet-5-5', to: 'haiku', chose: 'Switch to haiku' },
    { rating: 'simple', from: 'claude-sonnet-5-5', to: 'claude-sonnet-5-5', chose: 'Keep model, effort low' },
    { rating: 'complex', from: 'claude-sonnet-5-5', to: 'opus', chose: 'Switch to opus' },
    { rating: 'long-running', from: 'claude-opus-5-5', to: 'fable', chose: 'Switch to fable' },
    { rating: 'long-running', from: 'claude-opus-5-5', to: 'claude-opus-5-5', chose: 'dismissed' },
    // "use opus" typed while already on opus: the alias differs from the session's name, but the tier does not, so no switch.
    { rating: 'complex', from: 'claude-opus-5-5', to: 'opus', chose: 'other: opus' },
  ]
  engine(on, { turns: 3, store: { decisions } })

  const { text } = await command($, 'triage-stats')
  // Rated, switched, up, down.
  expect(text).toContain('| simple | 2 | 1 | 0 | 1 |')
  expect(text).toContain('| moderate | 0 | 0 | 0 | 0 |')
  expect(text).toContain('| complex | 2 | 1 | 1 | 0 |')
  expect(text).toContain('| long-running | 2 | 1 | 1 | 0 |')
})

test('/triage-stats with nothing logged says so', async ($, on) => {
  engine(on, { turns: 3 })

  const { text } = await command($, 'triage-stats')
  expect(text).toContain('No decisions')
})

// --- What each rated session cost, on the decision that started it ---

test('a main-loop turn records the spend since the decision on that entry, with an opaque id', async ($, on) => {
  // 0.25 is read when the decision is logged, 0.67 when the turn ends.
  const seen = engine(on, { answer: 'Switch to opus', usd: [0.25, 0.67] })

  await submit($, 'Redesign the auth layer across three services')
  await complete($)
  const [entry] = seen.store.decisions as Decision[]
  expect(entry?.cost).toBe(0.42)
  expect(typeof entry?.id).toBe('string')
  const { text } = await command($, 'triage-stats')
  expect(text).toContain('| complex | switched | 1 | $0.42 |')
})

test("a subagent's turn leaves the log as it was", async ($, on) => {
  const seen = engine(on, { answer: 'Switch to opus', usd: [0, 1] })

  await submit($, 'Redesign the auth layer')
  const before = JSON.stringify(seen.store)
  await complete($, 'sub-1')
  expect(JSON.stringify(seen.store)).toBe(before)
})

test('a second turn updates the same entry, and an unchanged figure writes nothing', async ($, on) => {
  const seen = engine(on, { answer: 'Switch to opus', usd: [0.1, 0.3, 0.5, 0.5] })

  await submit($, 'Redesign the auth layer')
  await complete($)
  await complete($)
  const list = seen.store.decisions as Decision[]
  expect(list.length).toBe(1)
  expect(list[0]?.cost).toBe(0.4)
  const writes = seen.writes()
  await complete($)
  expect(seen.writes()).toBe(writes)
})

test('a turn that spent nothing since the decision records no cost', async ($, on) => {
  // An aborted turn before any priced request: the ledger still reads the baseline.
  const seen = engine(on, { answer: 'Switch to opus', usd: [0.5, 0.5] })

  await submit($, 'Redesign the auth layer')
  const writes = seen.writes()
  await complete($)
  // The turn adds one prompt to the entry; no cost is written beside it.
  const [entry] = seen.store.decisions as Decision[]
  expect(entry && 'cost' in entry).toBe(false)
  expect(seen.writes()).toBe(writes + 1)
})

// Rounded down, so the stored figure never exceeds what /cost reports; a live session once stored 0.0116 against a 0.01155778 total.
for (const [base, now, cost] of [
  [0, 0.01155778, 0.0115],
  [0.1, 0.30000000000000004 + 0.123456, 0.3234],
  // 0.3 - 0.1 is 0.19999999999999998 in floating point, which must still store as 0.2.
  [0.1, 0.3, 0.2],
] as const) {
  test(`a spend of ${now} - ${base} is stored rounded down to four places, as ${cost}`, async ($, on) => {
    const seen = engine(on, { answer: 'Switch to opus', usd: [base, now] })

    await submit($, 'Redesign the auth layer')
    await complete($)
    expect((seen.store.decisions as Decision[])[0]?.cost).toBe(cost)
  })
}

test('the store holds neither the prompt text nor the session id', async ($, on) => {
  const seen = engine(on, { answer: 'Switch to opus', usd: [0, 2] })

  await submit($, 'Redesign the Zanzibar auth layer')
  await complete($)
  const all = JSON.stringify(seen.store)
  expect(all).not.toContain('Zanzibar')
  expect(all).not.toContain(SESSION_ID)
})

for (const [chose, setup] of [
  ['dismissed', {}],
  ['Open in a new session', { surfaces: ['desktop'], answer: 'Open in a new session' }],
  ['Refine prompt', { answer: 'Refine prompt' }],
  ['Switch to opus', { answer: 'Switch to opus' }],
] as [string, Setup][]) {
  test(`a decision logged as ${chose} carries an id`, async ($, on) => {
    const seen = engine(on, setup)

    await submit($, 'Redesign the auth layer')
    const [entry] = seen.store.decisions as Decision[]
    expect(entry?.chose).toBe(chose)
    expect(typeof entry?.id).toBe('string')
  })
}

for (const [name, setup] of [
  ['a rejected usage reading', { usageFails: true }],
  ['a usage reading with no cost', {}],
] as const) {
  test(`${name} writes nothing and the answer passes through`, async ($, on) => {
    const seen = engine(on, { answer: 'Switch to opus', ...setup })

    await submit($, 'Redesign the auth layer')
    const before = JSON.stringify(seen.store)
    const shown = await complete($, undefined, 'All done.')
    expect(shown.text).toBe('All done.')
    expect(JSON.stringify(seen.store)).toBe(before)
  })
}

test('a failed store read or write leaves the log as it was and the answer passes through', async ($, on) => {
  const s: Setup = { answer: 'Switch to opus', usd: [0, 1, 2] }
  const seen = engine(on, s)

  await submit($, 'Redesign the auth layer')
  const before = JSON.stringify(seen.store)
  s.storeReadFails = true
  expect((await complete($, undefined, 'All done.')).text).toBe('All done.')
  s.storeReadFails = false
  s.storeFails = true
  expect((await complete($, undefined, 'All done.')).text).toBe('All done.')
  expect(JSON.stringify(seen.store)).toBe(before)
})

// A live /clear left the next prompt unrated: the turn count can still include the cleared conversation's prompts.
test('the first prompt after /clear is rated and logged as its own decision, even while the turn count is not zero', async ($, on) => {
  const s: Setup = { answer: ['Switch to opus', 'Keep claude-sonnet-5-5'], usd: [0, 1, 1.5, 2] }
  const seen = engine(on, s)

  await submit($, 'Redesign the auth layer')
  await complete($)
  await $.session.end({ reason: 'clear', sessionId: 'ended', resume: { id: 'next' } })
  s.turns = 3
  await submit($, 'Redesign the billing layer')
  await complete($)
  // Only that one prompt counts as first: the next one in the cleared conversation is not rated.
  await submit($, 'Now add tests for it')
  const list = seen.store.decisions as Decision[]
  expect(list.map(d => [d.rating, d.chose, d.cost])).toEqual([
    ['complex', 'Switch to opus', 1],
    ['complex', 'Keep claude-sonnet-5-5', 0.5],
  ])
  expect(seen.ratings.length).toBe(2)
})

test('the next prompt after /resume is not rated, since it continues a conversation', async ($, on) => {
  const s: Setup = { answer: 'Switch to opus' }
  const seen = engine(on, s)

  await submit($, 'Redesign the auth layer')
  await $.session.end({ reason: 'resume', sessionId: 'ended', resume: { id: 'next' } })
  s.turns = 3
  await submit($, 'Redesign the billing layer')
  expect(seen.ratings.length).toBe(1)
  expect((seen.store.decisions as Decision[]).length).toBe(1)
})

// A /clear starts a new conversation, so the cleared one's model override, effort and spent Refine offer do not carry into it.
test('a /clear ends the model override, so a Keep on the next first prompt runs the session model', async ($, on) => {
  const seen = engine(on, { answer: ['Switch to opus', 'Keep claude-sonnet-5-5'] })

  await submit($, 'Redesign the auth layer')
  await $.session.end({ reason: 'clear', sessionId: 'ended', resume: { id: 'next' } })
  await submit($, 'Redesign the billing layer')
  await step($)
  expect(seen.steps.map(x => x.model)).toEqual(['claude-sonnet-5-5'])
  expect(seen.status.at(-1)).toBeUndefined()
  expect((seen.store.decisions as Decision[]).at(-1)).toEqual(expect.objectContaining({ from: 'claude-sonnet-5-5', to: 'claude-sonnet-5-5' }))
})

test('a /clear ends the effort minimum, even when the next first prompt is not rated', async ($, on) => {
  const s: Setup = { answer: 'Keep claude-sonnet-5-5' }
  const seen = engine(on, s)

  await submit($, 'Redesign the auth layer')
  await step($, undefined, 'low')
  await $.session.end({ reason: 'clear', sessionId: 'ended', resume: { id: 'next' } })
  s.rating = undefined
  await submit($, 'Redesign the billing layer')
  await step($, undefined, 'low')
  expect(seen.steps.map(x => x.effort)).toEqual(['medium', 'low'])
  expect(seen.status.at(-1)).toBeUndefined()
})

test('a /clear offers Refine prompt again on the next first prompt after one was refined', async ($, on) => {
  const seen = engine(on, { answer: ['Refine prompt', 'Keep claude-sonnet-5-5'], review: REVIEWED })

  await submit($, 'Redesign the auth layer')
  await $.session.end({ reason: 'clear', sessionId: 'ended', resume: { id: 'next' } })
  await submit($, 'Redesign the billing layer')
  // Two dialogs, so the one checked is the second prompt's and not the first's, which offered Refine too.
  expect(seen.asked.length).toBe(2)
  expect(seen.asked.at(-1)).toContain('Refine prompt')
})

test('a /resume keeps the model override: only a /clear starts afresh', async ($, on) => {
  const s: Setup = { answer: 'Switch to opus' }
  const seen = engine(on, s)

  await submit($, 'Redesign the auth layer')
  await $.session.end({ reason: 'resume', sessionId: 'ended', resume: { id: 'next' } })
  s.turns = 3
  await step($)
  expect(seen.steps.map(x => x.model)).toEqual(['opus'])
})

test('an entry pushed out by the cap is not added back', async ($, on) => {
  const seen = engine(on, { answer: 'Switch to opus', usd: [0, 1] })

  await submit($, 'Redesign the auth layer')
  const old: Decision[] = Array.from({ length: 200 }, (_, i) => ({ rating: 'simple', from: 'x', to: 'x', chose: `old ${i}`, id: `o${i}` }))
  seen.store.decisions = old
  await complete($)
  const list = seen.store.decisions as Decision[]
  expect(list.length).toBe(200)
  expect(list.some(d => d.cost !== undefined)).toBe(false)
})

test("another session's entries in the shared log are left alone", async ($, on) => {
  const seen = engine(on, { answer: 'Switch to opus', usd: [0, 1] })

  await submit($, 'Redesign the auth layer')
  // Another session logs its own decision between this session's turns.
  const theirs: Decision = { rating: 'simple', from: 'x', to: 'haiku', chose: 'Switch to haiku', id: 'theirs', cost: 0.05 }
  seen.store.decisions = [...(seen.store.decisions as Decision[]), theirs]
  await complete($)
  const list = seen.store.decisions as Decision[]
  expect(list.map(d => d.cost)).toEqual([1, 0.05])
  expect(list[1]).toEqual(theirs)
})

test('a new first prompt, as after /clear, gets its own id and a cost that leaves out the earlier spend', async ($, on) => {
  // The ledger never resets: 0 at A, 1 after its turn, 1.5 at B, 2 after its turn.
  const seen = engine(on, { answer: ['Switch to opus', 'Keep claude-sonnet-5-5'], usd: [0, 1, 1.5, 2] })

  await submit($, 'Redesign the auth layer')
  await complete($)
  await $.session.end({ reason: 'clear', sessionId: 'ended', resume: { id: 'next' } })
  await submit($, 'Redesign the billing layer')
  await complete($)
  const [a, b] = seen.store.decisions as Decision[]
  expect([a?.cost, b?.cost]).toEqual([1, 0.5])
  expect(a?.id).not.toBe(b?.id)
})

// /resume and /branch keep the mod loaded and move to a session that already has turns, so no first prompt resets the tracking.
for (const reason of ['resume', 'clear'] as const) {
  test(`after /${reason} the earlier decision gains none of the next session's spend`, async ($, on) => {
    // 5 at the decision, 6 after its turn; the next session's ledger reads 0.8.
    const s: Setup = { answer: 'Switch to opus', usd: [5, 6, 0.8] }
    const seen = engine(on, s)

    await submit($, 'Redesign the auth layer')
    await complete($)
    await $.session.end({ reason, sessionId: 'ended', resume: { id: 'next' } })
    s.turns = 4
    await complete($)
    expect((seen.store.decisions as Decision[]).map(d => d.cost)).toEqual([1])
  })
}

test('a first prompt that is not rated stops the earlier decision from gaining later spend', async ($, on) => {
  const s: Setup = { answer: 'Switch to opus', usd: [0, 1, 0.2] }
  const seen = engine(on, s)

  await submit($, 'Redesign the auth layer')
  await complete($)
  // After /clear the ledger may start over, and this prompt's rating fails, so nothing new is logged.
  await $.session.end({ reason: 'clear', sessionId: 'ended', resume: { id: 'next' } })
  s.rating = undefined
  await submit($, 'Redesign the billing layer')
  await complete($)
  expect((seen.store.decisions as Decision[]).map(d => d.cost)).toEqual([1])
})

test('/triage-stats averages cost per rating and class, with the session count beside each average', async ($, on) => {
  const decisions: Decision[] = [
    { rating: 'complex', from: 'claude-sonnet-5-5', to: 'opus', chose: 'Switch to opus', id: 'a', cost: 1 },
    { rating: 'complex', from: 'claude-sonnet-5-5', to: 'opus', chose: 'Switch to opus', id: 'b', cost: 2 },
    { rating: 'complex', from: 'claude-sonnet-5-5', to: 'claude-sonnet-5-5', chose: 'Keep claude-sonnet-5-5', id: 'c', cost: 0.5 },
    // No cost recorded: left out of every average.
    { rating: 'complex', from: 'claude-sonnet-5-5', to: 'claude-sonnet-5-5', chose: 'dismissed', id: 'd' },
    { rating: 'simple', from: 'claude-sonnet-5-5', to: 'claude-sonnet-5-5', chose: 'Keep model, effort low', id: 'e', cost: 0.004 },
    { rating: 'long-running', from: 'claude-opus-5-5', to: 'claude-opus-5-5', chose: 'Open in a new session', id: 'f', cost: 0.1 },
  ]
  engine(on, { turns: 3, store: { decisions } })

  const { text } = await command($, 'triage-stats')
  expect(text).toContain('| complex | switched | 2 | $1.50 |')
  expect(text).toContain('| complex | kept | 1 | $0.50 |')
  expect(text).toContain('| simple | low effort | 1 | $0.0040 |')
  expect(text).toContain('| long-running | hand-off | 1 | $0.10 |')
  // No row for a rating and class with no costed session.
  expect(text).not.toMatch(/\| moderate \| [a-z]/)
  expect(text).toMatch(/association, not cause/)
  // The rating table is unchanged.
  expect(text).toContain('| complex | 4 | 2 | 2 | 0 |')
})

test('/triage-stats shows no cost table when no entry has a cost', async ($, on) => {
  const decisions: Decision[] = [{ rating: 'complex', from: 'claude-sonnet-5-5', to: 'opus', chose: 'Switch to opus' }]
  engine(on, { turns: 3, store: { decisions } })

  const { text } = await command($, 'triage-stats')
  expect(text).not.toMatch(/cost/i)
  expect(text).not.toContain('$')
})

// --- How long each rated session ran and how full its context got, on the same entry as its cost ---

test('a main-loop turn records the turns since the decision and the context percent on that entry', async ($, on) => {
  const s: Setup = { answer: 'Switch to opus', usd: [0, 1], pct: [3, 42] }
  const seen = engine(on, s)

  await submit($, 'Redesign the auth layer across three services')
  await submit($, 'Now add the tests')
  await complete($)
  const [entry] = seen.store.decisions as Decision[]
  expect(entry?.prompts).toBe(2)
  expect(entry?.ctx).toBe(42)
  // Cost still lands in the same update.
  expect(entry?.cost).toBe(1)
})

test('a later turn replaces turns and ctx on the same entry, and unchanged figures write nothing', async ($, on) => {
  const s: Setup = { answer: 'Switch to opus', usd: [0, 1, 2, 2], pct: [3, 20, 35, 35] }
  const seen = engine(on, s)

  await submit($, 'Redesign the auth layer')
  await complete($)
  await submit($, 'Now add the tests')
  await submit($, 'And the docs')
  await complete($)
  const list = seen.store.decisions as Decision[]
  expect(list.length).toBe(1)
  expect([list[0]?.prompts, list[0]?.ctx]).toEqual([3, 35])
  const writes = seen.writes()
  await complete($)
  expect(seen.writes()).toBe(writes)
})

test("a subagent's turn records neither turns nor ctx", async ($, on) => {
  const s: Setup = { answer: 'Switch to opus', usd: [0, 1], pct: [3, 42] }
  const seen = engine(on, s)

  await submit($, 'Redesign the auth layer')
  s.turns = 3
  await complete($, 'sub-1')
  const [entry] = seen.store.decisions as Decision[]
  expect(entry && 'prompts' in entry).toBe(false)
  expect(entry && 'ctx' in entry).toBe(false)
})

test('turns counts from the decision, so a /clear whose turn count still holds the old conversation does not inflate it', async ($, on) => {
  const s: Setup = { answer: ['Switch to opus', 'Keep claude-sonnet-5-5'], usd: [0, 1, 1.5, 2], pct: [1, 10, 2, 8] }
  const seen = engine(on, s)

  await submit($, 'Redesign the auth layer')
  s.turns = 1
  await complete($)
  await $.session.end({ reason: 'clear', sessionId: 'ended', resume: { id: 'next' } })
  // The transcript's count still includes the cleared conversation's three prompts when the next first prompt arrives.
  s.turns = 3
  await submit($, 'Redesign the billing layer')
  s.turns = 5
  await complete($)
  expect((seen.store.decisions as Decision[]).map(d => [d.prompts, d.ctx])).toEqual([
    [1, 10],
    [1, 8],
  ])
})

test('a fresh session with no context percent yet records no ctx, and the cost still lands', async ($, on) => {
  const s: Setup = { answer: 'Switch to opus', usd: [0, 0.5] }
  const seen = engine(on, s)

  await submit($, 'Redesign the auth layer')
  s.turns = 1
  await complete($)
  const [entry] = seen.store.decisions as Decision[]
  expect(entry && 'ctx' in entry).toBe(false)
  expect(entry?.cost).toBe(0.5)
  expect(entry?.prompts).toBe(1)
})

test("a turn count that cannot be read at a turn's end changes nothing, since turns are the prompts sent", async ($, on) => {
  const s: Setup = { answer: 'Switch to opus', usd: [0, 1], pct: [3, 42] }
  const seen = engine(on, s)

  await submit($, 'Redesign the auth layer')
  s.turnsFails = true
  expect((await complete($, undefined, 'All done.')).text).toBe('All done.')
  const [entry] = seen.store.decisions as Decision[]
  expect([entry?.prompts, entry?.cost, entry?.ctx]).toEqual([1, 1, 42])
})

test('a usage reading that fails at the end of a turn still records turns, leaves cost and ctx out, and the answer passes through', async ($, on) => {
  const s: Setup = { answer: 'Switch to opus', usd: [0, 1], pct: [3, 42] }
  const seen = engine(on, s)

  await submit($, 'Redesign the auth layer')
  s.usageFails = true
  await submit($, 'Now add the tests')
  expect((await complete($, undefined, 'All done.')).text).toBe('All done.')
  const [entry] = seen.store.decisions as Decision[]
  expect(entry?.prompts).toBe(2)
  expect(entry && 'cost' in entry).toBe(false)
  expect(entry && 'ctx' in entry).toBe(false)
})

test('the store still holds neither the prompt text nor the session id once turns and ctx are recorded', async ($, on) => {
  const s: Setup = { answer: 'Switch to opus', usd: [0, 2], pct: [3, 42] }
  const seen = engine(on, s)

  await submit($, 'Redesign the Zanzibar auth layer')
  s.turns = 2
  await complete($)
  const all = JSON.stringify(seen.store)
  expect(all).not.toContain('Zanzibar')
  expect(all).not.toContain(SESSION_ID)
})

test('/triage-stats averages turns and context percent per rating, with the session count beside each', async ($, on) => {
  const decisions: Decision[] = [
    { rating: 'complex', from: 'claude-sonnet-5-5', to: 'opus', chose: 'Switch to opus', id: 'a', prompts: 3, ctx: 40 },
    { rating: 'complex', from: 'claude-sonnet-5-5', to: 'opus', chose: 'Switch to opus', id: 'b', prompts: 4, ctx: 50 },
    // Turns without a ctx, and an entry with neither: each is left out of the average it has no figure for.
    { rating: 'complex', from: 'claude-sonnet-5-5', to: 'claude-sonnet-5-5', chose: 'dismissed', id: 'c', prompts: 5 },
    { rating: 'complex', from: 'claude-sonnet-5-5', to: 'claude-sonnet-5-5', chose: 'dismissed', id: 'd' },
    // A rating with only a context figure.
    { rating: 'simple', from: 'claude-sonnet-5-5', to: 'haiku', chose: 'Switch to haiku', id: 'e', ctx: 10 },
  ]
  engine(on, { turns: 3, store: { decisions } })

  const { text } = await command($, 'triage-stats')
  // Average turns, sessions behind it, average context, sessions behind it.
  expect(text).toContain('| complex | 4.0 | 3 | 45% | 2 |')
  expect(text).toContain('| simple | - | 0 | 10% | 1 |')
  // No row for a rating with no figure.
  expect(text).not.toContain('| moderate | -')
  // The rating table is unchanged.
  expect(text).toContain('| complex | 4 | 2 | 2 | 0 |')
  // Nothing was costed, so no cost table.
  expect(text).not.toContain('$')
})

// Entries from before the count was of prompts hold transcript turns under `turns`, which also counted slash commands.
test('/triage-stats averages prompts sent only, leaving out the transcript turns older entries recorded', async ($, on) => {
  const decisions: Decision[] = [
    { rating: 'complex', from: 'claude-sonnet-5-5', to: 'opus', chose: 'Switch to opus', id: 'a', turns: 9, ctx: 40 },
    { rating: 'complex', from: 'claude-sonnet-5-5', to: 'opus', chose: 'Switch to opus', id: 'b', prompts: 1, ctx: 50 },
  ]
  engine(on, { turns: 3, store: { decisions } })

  const { text } = await command($, 'triage-stats')
  expect(text).toContain('| complex | 1.0 | 1 | 45% | 2 |')
})

test('/triage-stats shows the prompts table beside the cost table when entries have both', async ($, on) => {
  const decisions: Decision[] = [
    { rating: 'complex', from: 'claude-sonnet-5-5', to: 'opus', chose: 'Switch to opus', id: 'a', cost: 1, prompts: 2, ctx: 30 },
  ]
  engine(on, { turns: 3, store: { decisions } })

  const { text } = await command($, 'triage-stats')
  expect(text).toContain('| complex | switched | 1 | $1.00 |')
  expect(text).toContain('| complex | 2.0 | 1 | 30% | 1 |')
})

test('/triage-stats shows no turns table when no entry has turns or ctx', async ($, on) => {
  const decisions: Decision[] = [{ rating: 'complex', from: 'claude-sonnet-5-5', to: 'opus', chose: 'Switch to opus', id: 'a', cost: 1 }]
  engine(on, { turns: 3, store: { decisions } })

  const { text } = await command($, 'triage-stats')
  expect(text).not.toMatch(/prompts|context/i)
})

test('a simple prompt two tiers above haiku lists the switch before the low-effort option', async ($, on) => {
  const seen = engine(on, { rating: 'simple', model: 'claude-opus-5-5', answer: 'Keep claude-opus-5-5' })

  await submit($, 'What does git rebase --onto do?')
  expect(seen.asked).toEqual([['Switch to haiku', 'Keep model, effort low', 'Keep claude-opus-5-5', 'Refine prompt']])
})

test('a simple prompt one tier above haiku keeps the low-effort option first', async ($, on) => {
  const seen = engine(on, { rating: 'simple', model: 'claude-sonnet-5-5', answer: 'Keep claude-sonnet-5-5' })

  await submit($, 'What does git rebase --onto do?')
  expect(seen.asked).toEqual([['Keep model, effort low', 'Switch to haiku', 'Keep claude-sonnet-5-5', 'Refine prompt']])
})

// --- The dialog's wording: the rating and what it suggests, the model you are on, then the choice ---

test('a moderate prompt on opus says what the rating suggests and names the model, with no effort sentence', async ($, on) => {
  const seen = engine(on, {
    rating: 'moderate',
    model: 'claude-opus-5-5',
    restate: 'add a retry limit to the upload client',
    answer: 'Keep claude-opus-5-5',
  })

  await submit($, 'Add a retry limit to the upload client')
  expect(seen.questions[0]).toBe(
    'Read as: add a retry limit to the upload client. Rated moderate: a sonnet-sized task. You are on claude-opus-5-5. Run it how?',
  )
  expect(seen.asked[0]).toEqual(['Switch to sonnet', 'Keep claude-opus-5-5', 'Refine prompt'])
})

test('a complex prompt states no effort minimum in the dialog', async ($, on) => {
  const seen = engine(on, { rating: 'complex', model: 'claude-sonnet-5-5', restate: 'redesign auth', answer: 'Keep claude-sonnet-5-5' })

  await submit($, 'Redesign the auth layer')
  expect(seen.questions[0]).toBe('Read as: redesign auth. Rated complex: an opus-sized task. You are on claude-sonnet-5-5. Run it how?')
  expect(seen.questions[0]).not.toContain('Effort will be at least')
})

test('a simple prompt names both cheaper levers and no effort floor', async ($, on) => {
  const seen = engine(on, { rating: 'simple', model: 'claude-sonnet-5-5', answer: 'Keep claude-sonnet-5-5' })

  await submit($, 'What does git rebase --onto do?')
  expect(seen.questions[0]).toBe('Rated simple: haiku or low effort would do. You are on claude-sonnet-5-5. Run it how?')
})

test('keeping the named model switches nothing and is logged by its label', async ($, on) => {
  const seen = engine(on, { model: 'claude-opus-5-5', rating: 'moderate', answer: 'Keep claude-opus-5-5' })

  await submit($, 'Rename this function')
  await step($)
  expect(seen.steps[0]?.model).toBe('claude-sonnet-5-5')
  expect((seen.store.decisions as Decision[])[0]?.chose).toBe('Keep claude-opus-5-5')
})

// --- Tier-relative wording: a suggestion two or more tiers up says so, in tiers and never in prices ---

test('a suggestion two tiers above the current model says so, and states no price', async ($, on) => {
  const seen = engine(on, { rating: 'complex', model: 'claude-haiku-5-5', answer: 'Keep claude-haiku-5-5' })

  await submit($, 'Redesign the auth layer')
  expect(seen.questions[0]).toMatch(/two tiers above your current model/)
  // Prices go stale, so the dialog never carries a dollar amount.
  expect(seen.questions[0]).not.toContain('$')
})

test('a suggestion three tiers above the current model says three', async ($, on) => {
  const seen = engine(on, { rating: 'long-running', model: 'claude-haiku-5-5', answer: 'Keep claude-haiku-5-5' })

  await submit($, 'Migrate the whole codebase from Express to Fastify')
  expect(seen.questions[0]).toMatch(/three tiers above your current model/)
  expect(seen.questions[0]).not.toContain('$')
})

for (const [rating, model] of [
  ['complex', 'claude-sonnet-5-5'],
  ['moderate', 'claude-haiku-5-5'],
] as const) {
  test(`a ${rating} suggestion one tier above ${model} carries no tier wording`, async ($, on) => {
    const seen = engine(on, { rating, model, answer: `Keep ${model}` })

    await submit($, 'Redesign the auth layer')
    // A switch is offered, so the dialog did show; it just has nothing to add at one tier.
    expect(seen.asked.length).toBe(1)
    expect(seen.questions[0]).not.toMatch(/tier/i)
  })
}

test('a model the mod cannot rank gets no tier wording', async ($, on) => {
  const seen = engine(on, { rating: 'moderate', model: 'Default (recommended)', answer: 'Keep Default (recommended)' })

  await submit($, 'Add a retry limit to the upload client')
  expect(seen.questions[0]).not.toMatch(/tier/i)
})

// The status row: the session's cost, prompts and context fill, and a Clear or Compact button that asks which and runs it.

test('the status row waits for the first prompt', async ($, on) => {
  const s: Setup = { turns: 0, usd: 0, pct: 0 }
  engine(on, s)
  for (const surface of SURFACES) expect(await (await band($, surface)).find({ key: 'status' })).toBeUndefined()
  await submit($, 'Fix the login bug')
  for (const surface of SURFACES) expect(await (await band($, surface)).find({ key: 'status' })).toBeDefined()
})

test('band: never still draws the status row on the terminal', { options: { band: 'never' } }, async ($, on) => {
  engine(on, { turns: 2, usd: 0.1, pct: 40, draft: LONG })
  const ui = await band($)
  expect(await hasPickers(ui)).toBe(false)
  expect(await ui.find({ key: 'tidy' })).toBeDefined()
})

// session.measure redraws only when the cost or context moved; a turn that moves neither (an API error, a host with no cost ledger)
// still changes the prompt count, so the end of a main-loop turn redraws too.
test('a main-loop turn redraws the band for the prompt count, and a subagent turn does not', async ($, on) => {
  const seen = engine(on, { turns: 1 })
  const before = seen.redraws()
  await complete($, 'agent-1')
  expect(seen.redraws()).toBe(before)
  await complete($)
  expect(seen.redraws()).toBe(before + 1)
})

test('a measurement that moves the cost or context redraws the band, and one that moves only rate limits does not', async ($, on) => {
  const seen = engine(on, { turns: 2 })
  const measure = (changed: ('cost' | 'context' | 'rateLimits')[]) =>
    $.session.measure({ context: { window: 200_000, percent: 20 }, rateLimits: [], cost: { usd: 0.5 }, changed })
  const before = seen.redraws()
  await measure(['rateLimits'])
  expect(seen.redraws()).toBe(before)
  await measure(['cost'])
  expect(seen.redraws()).toBe(before + 1)
  await measure(['context'])
  expect(seen.redraws()).toBe(before + 2)
})

test('a typed /clear and a compaction each redraw the band, so the row drops the old figures', async ($, on) => {
  const seen = engine(on, { turns: 1 })
  const before = seen.redraws()
  await $.session.end({ reason: 'clear', sessionId: 'ended', resume: { id: 'next' } })
  expect(seen.redraws()).toBe(before + 1)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'Summary so far', toolUses: [] }] })
  expect(seen.redraws()).toBe(before + 2)
})

test('a typed label that is not one of the options runs nothing, even one naming the other command', async ($, on) => {
  const seen = engine(on, { turns: 2, usd: 0.1, pct: 70, answer: 'Clear (recommended)' })
  const ui = await band($)
  await ui.press({ key: 'tidy' })
  await settle()
  expect(seen.ran).toEqual([])
})

test('a compaction keeps the prompt count, though the summarized transcript holds fewer user turns', async ($, on) => {
  const s: Setup = { turns: 20, usd: 1.1, pct: 70, onCompact: () => (s.turns = 1) }
  engine(on, s)
  expect(await (await band($)).find({ type: 'Text', text: /\b20 prompts\b/ })).toBeDefined()
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'Summary so far', toolUses: [] }] })
  expect(await (await band($)).find({ type: 'Text', text: /\b20 prompts\b/ })).toBeDefined()
  // The transcript's own count moving (a summary turn, a command's record) changes nothing; a sent prompt does.
  s.turns = 4
  expect(await (await band($)).find({ type: 'Text', text: /\b20 prompts\b/ })).toBeDefined()
  await submit($, 'Now add the tests')
  expect(await (await band($)).find({ type: 'Text', text: /\b21 prompts\b/ })).toBeDefined()
  // A /clear starts the count over, though its own command record is a user turn of the new transcript.
  await $.session.end({ reason: 'clear', sessionId: 'ended', resume: { id: 'next' } })
  s.turns = 1
  expect(await (await band($)).find({ key: 'status' })).toBeUndefined()
  await submit($, 'Start on the billing page')
  expect(await (await band($)).find({ type: 'Text', text: /\b1 prompt\b/ })).toBeDefined()
})

// The count moves when the prompt enters, before the turn ends; without a redraw the row shows one prompt fewer for the whole turn.
test('a sent prompt redraws the band, and a slash command does not', async ($, on) => {
  const seen = engine(on, { turns: 2 })
  await band($)
  let before = seen.redraws()
  await $.prompt.submit({ text: '/compact', command: { name: 'compact', args: '' }, wait: false, origin: { kind: 'composer' } })
  expect(seen.redraws()).toBe(before)
  before = seen.redraws()
  await submit($, 'Now add the tests')
  expect(seen.redraws()).toBe(before + 1)
})

// A count that could not be read is not a count of zero: the row and the first-prompt check would keep it all session.
test('a prompt count that cannot be read is read again later, not kept as zero', async ($, on) => {
  const s: Setup = { turns: 3, turnsFails: true }
  engine(on, s)
  expect(await (await band($)).find({ key: 'status' })).toBeUndefined()
  s.turnsFails = false
  expect(await (await band($)).find({ type: 'Text', text: /\b3 prompts\b/ })).toBeDefined()
})

// A read that began before /resume answers for the conversation that ended.
test('a count read still running when the conversation ends is not kept for the next one', async ($, on) => {
  let open = () => {}
  let begun = () => {}
  const reading = new Promise<void>(r => (begun = r))
  const s: Setup = { turns: 7, turnsGate: new Promise<void>(r => (open = r)), onTurns: () => begun() }
  engine(on, s)
  const drawn = band($)
  await reading
  await $.session.end({ reason: 'resume', sessionId: 'ended', resume: { id: 'next' } })
  s.turns = 2
  s.turnsGate = undefined
  open()
  await drawn
  expect(await (await band($)).find({ type: 'Text', text: /\b2 prompts\b/ })).toBeDefined()
})

// A delivery is not the person's first prompt, so it opens no model dialog and logs no decision.
test('a delivery before the first prompt is not rated, and the first prompt after it is', async ($, on) => {
  const seen = engine(on, { turns: 0 })
  const delivered: PromptOrigin[] = [{ kind: 'scheduled-trigger' }, { kind: 'task-notification' }, { kind: 'plugin', name: 'other' }]
  for (const origin of delivered) await $.prompt.submit({ text: 'Redesign the auth layer across three services', wait: false, origin })
  expect(seen.ratings).toEqual([])
  expect(seen.asked).toEqual([])
  await submit($, 'Redesign the auth layer across three services')
  expect(seen.ratings).toHaveLength(1)
})

// On main a count that could not be read skipped the rating; reading it as zero would rate a later prompt as a first one.
test('a prompt sent while the prompt count cannot be read is not rated as a first prompt', async ($, on) => {
  const seen = engine(on, { turns: 4, turnsFails: true })
  await submit($, 'Redesign the auth layer across three services')
  expect(seen.ratings).toEqual([])
  expect(seen.asked).toEqual([])
})

// The transcript records a slash command as a user turn, so /compact read as one more prompt and /clear as the first.
test('the row counts prompts sent, not slash commands, hidden prompts or dropped ones', async ($, on) => {
  const s: Setup = { turns: 2, refuse: 'Dropped before it entered' }
  engine(on, s)
  expect(await (await band($)).find({ type: 'Text', text: /\b2 prompts\b/ })).toBeDefined()
  await $.prompt.submit({ text: '/compact', command: { name: 'compact', args: '' }, wait: false, origin: { kind: 'composer' } })
  await $.prompt.submit({ text: 'reminder', isMeta: true, wait: false, origin: { kind: 'composer' } })
  await submit($, 'Dropped before it entered')
  // Deliveries the person did not send: a background task, another session, a schedule, a plugin's own message.
  const delivered: PromptOrigin[] = [
    { kind: 'task-notification' },
    { kind: 'peer' },
    { kind: 'scheduled-trigger' },
    { kind: 'plugin', name: 'other' },
  ]
  for (const origin of delivered) await $.prompt.submit({ text: 'Delivered', wait: false, origin })
  s.turns = 5
  expect(await (await band($)).find({ type: 'Text', text: /\b2 prompts\b/ })).toBeDefined()
  // The person's own prompt counts from any surface: a phone, Slack, or a plugin sending their words.
  const person: PromptOrigin[] = [{ kind: 'bridge' }, { kind: 'slack-ping' }, { kind: 'plugin', name: 'other', asUser: true }]
  for (const origin of person) await $.prompt.submit({ text: 'From the person', wait: false, origin })
  expect(await (await band($)).find({ type: 'Text', text: /\b5 prompts\b/ })).toBeDefined()
})

// The transcript holds a slash command's record as a user turn, so a /model typed first made the first prompt look like a later one.
test('a slash command typed before the first prompt does not stop that prompt being rated', async ($, on) => {
  const s: Setup = { answer: 'Keep claude-sonnet-5-5' }
  const seen = engine(on, s)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  s.turns = 1
  await submit($, 'Redesign the auth layer')
  expect(seen.ratings.length).toBe(1)
})

test('the turns a decision records are the prompts sent since it, not transcript turns that also hold slash commands', async ($, on) => {
  const s: Setup = { answer: 'Switch to opus', usd: [0, 1] }
  const seen = engine(on, s)
  await submit($, 'Redesign the auth layer')
  // The prompt, then /compact and /model recorded as user turns.
  s.turns = 3
  await complete($)
  expect((seen.store.decisions as Decision[])[0]?.prompts).toBe(1)
})

test('a prompt sent through a failed hook still counts on the status row', async ($, on) => {
  const s: Setup = { modelFails: true }
  const seen = engine(on, s)
  await submit($, 'Redesign the auth layer')
  expect(seen.submitted.length).toBe(1)
  expect(await (await band($)).find({ type: 'Text', text: /\b1 prompt\b/ })).toBeDefined()
})

test('a compaction that leaves no user turn keeps the row and its prompt count', async ($, on) => {
  const s: Setup = { turns: 20, usd: 1.1, pct: 70, onCompact: () => (s.turns = 0) }
  engine(on, s)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'Summary so far', toolUses: [] }] })
  expect(await (await band($)).find({ type: 'Text', text: /\b20 prompts\b/ })).toBeDefined()
})

test('the prompt after a compaction that leaves no user turn is not rated as a first prompt', async ($, on) => {
  const s: Setup = { turns: 5, onCompact: () => (s.turns = 0) }
  const seen = engine(on, s)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'Summary so far', toolUses: [] }] })
  await submit($, 'Redesign the auth layer across three services')
  expect(seen.ratings).toEqual([])
  expect(seen.asked).toEqual([])
})

test('a precompute pass, which compacts nothing yet, does not redraw the band', async ($, on) => {
  const seen = engine(on, { turns: 1 })
  const before = seen.redraws()
  await $.session.compact({ trigger: 'precompute', messages: [{ role: 'user', text: 'Summary so far', toolUses: [] }] })
  expect(seen.redraws()).toBe(before)
})

test('a Clear or Compact the session refuses says so in a toast', async ($, on) => {
  const seen = engine(on, { turns: 2, pct: 40, answer: 'Clear (recommended)', commandFails: true })
  const ui = await band($)
  await ui.press({ key: 'tidy' })
  await settle()
  expect(seen.toasts.length).toBe(1)
})

test('the status row shows cost, prompts and tokens in context on both surfaces, with or without the pickers', async ($, on) => {
  const s: Setup = { turns: 3, surfaces: ['desktop'], tokens: 48_213 }
  engine(on, s)
  for (const [surface, draft] of [
    ['terminal', ''],
    ['desktop', ''],
    ['terminal', LONG],
  ] as const) {
    s.draft = draft
    s.usd = 0.4213
    s.pct = 30
    const ui = await band($, surface)
    // The context percent, which picks the Manage context button, follows the token count.
    expect(await ui.find({ type: 'Text', text: /\$0\.42\b.*\b3 prompts\b.*\b48\.2K tokens · 30% context\b/ })).toBeDefined()
    // The row is inside the Triage section, left-aligned with its controls.
    expect(keysIn((await ui.find({ key: 'triage' })) as Node | undefined)).toContain('status')
    expect((await ui.find({ key: 'status' }))?.props.justifyContent).toBeUndefined()
  }
})

test('the status row leaves out what the session cannot read yet', async ($, on) => {
  engine(on, { turns: 1 })
  const ui = await band($)
  expect(await ui.find({ type: 'Text', text: /\b1 prompt\b/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$|context|tokens/ })).toBeUndefined()
})

// After /clear the window is empty (or not read yet) while the prompt count can still include the cleared conversation's prompts.
for (const pct of [undefined, 0, 24] as const) {
  test(`a context fill of ${pct ?? 'unknown'} needs no clear, so the row draws no button`, async ($, on) => {
    engine(on, { turns: 3, usd: 0.2, pct })
    const ui = await band($)
    expect(await ui.find({ key: 'status' })).toBeDefined()
    expect(await ui.find({ key: 'tidy' })).toBeUndefined()
  })
}

test('from 25% context the button reads Manage context', async ($, on) => {
  engine(on, { turns: 3, usd: 0.2, pct: 25 })
  expect((await (await band($)).find({ key: 'tidy' }))?.props.label).toBe('Manage context')
})

test('below the compact threshold the button reads Manage context and the dialog recommends Clear; picking it runs /clear', async ($, on) => {
  const seen = engine(on, { turns: 2, usd: 0.1, pct: 59, answer: 'Clear (recommended)' })
  const ui = await band($)
  expect((await ui.find({ key: 'tidy' }))?.props.label).toBe('Manage context')
  await ui.press({ key: 'tidy' })
  await settle()
  expect(seen.asked[0]?.[0]).toMatch(/^Clear\b.*recommended/)
  expect(seen.ran).toEqual(['clear'])
})

test('pressing the button twice before the dialog closes asks and runs once', async ($, on) => {
  const seen = engine(on, { turns: 2, usd: 0.1, pct: 59, answer: ['Clear (recommended)', 'Clear (recommended)'] })
  const ui = await band($)
  await ui.press({ key: 'tidy' })
  await ui.press({ key: 'tidy' })
  await settle()
  expect(seen.asked).toHaveLength(1)
  expect(seen.ran).toEqual(['clear'])
})

test('at the compact threshold the button still reads Manage context and the dialog recommends Compact; picking it runs /compact', async ($, on) => {
  const seen = engine(on, { turns: 2, usd: 0.1, pct: 60, answer: 'Compact (recommended)' })
  const ui = await band($)
  expect((await ui.find({ key: 'tidy' }))?.props.label).toBe('Manage context')
  await ui.press({ key: 'tidy' })
  await settle()
  expect(seen.asked[0]?.[0]).toMatch(/^Compact\b.*recommended/)
  expect(seen.asked[0]?.[1]).toMatch(/^Clear\b/)
  expect(seen.ran).toEqual(['compact'])
})

for (const [answer, ran] of [
  ['Compact', ['compact']],
  [undefined, []],
  ['compact it please', []],
] as const) {
  test(`answering ${answer ?? 'nothing'} under a Clear recommendation runs ${ran[0] ?? 'nothing'}`, async ($, on) => {
    const seen = engine(on, { turns: 2, usd: 0.1, pct: 40, answer })
    const ui = await band($)
    await ui.press({ key: 'tidy' })
    await settle()
    expect(seen.ran).toEqual(ran)
  })
}

// --- Self-verification first: Refine prompt on a strong rating adds a check unless the person set the Goal ---

const CHECK_LINE = 'a check the agent can run'

test('Refine prompt on a complex prompt with Goal Auto asks the reviewer to end with a check', async ($, on) => {
  const seen = engine(on, { answer: 'Refine prompt', review: REVIEWED })

  await submit($, 'Redesign the auth layer across three services')
  expect(seen.reviews[0]?.system).toContain(CHECK_LINE)
})

test('Refine prompt on a long-running prompt with Goal Auto asks the reviewer to end with a check', async ($, on) => {
  const seen = engine(on, { rating: 'long-running', model: 'claude-opus-5-5', answer: 'Refine prompt', review: REVIEWED })

  await submit($, 'Migrate the whole codebase from Express to Fastify')
  expect(seen.reviews[0]?.system).toContain(CHECK_LINE)
})

test('Refine prompt on a complex prompt respects a stored Goal of Off', async ($, on) => {
  const seen = engine(on, { answer: 'Refine prompt', review: REVIEWED, store: { picks: { goal: 'off' } } })

  await submit($, 'Redesign the auth layer across three services')
  expect(seen.reviews[0]?.system).not.toContain(CHECK_LINE)
  expect(seen.reviews[0]?.system).toContain('Skip the goal')
})

test('Refine prompt on a moderate prompt with Goal Auto adds no check', async ($, on) => {
  const seen = engine(on, { rating: 'moderate', model: 'claude-opus-5-5', answer: 'Refine prompt', review: REVIEWED })

  await submit($, 'Add a retry limit to the upload client')
  expect(seen.reviews[0]?.system).not.toContain(CHECK_LINE)
})

// --- The hand-off brief carries a short written plan ---

const asksForPlan = (e?: PromptSubmitInput) => e?.context?.some(c => c.includes('start_session') && /short written plan/.test(c)) ?? false

test('Open in a new session asks Claude to put a short written plan in the brief', async ($, on) => {
  const seen = engine(on, { surfaces: ['desktop'], answer: 'Open in a new session' })

  await submit($, 'Redesign the auth layer')
  expect(asksForPlan(seen.submitted[0])).toBe(true)
})

test('Run in: New session asks Claude to put a short written plan in the brief', async ($, on) => {
  const seen = engine(on, { surfaces: ['desktop'] })

  await armHandOff($)
  await submit($, 'Redesign the auth layer')
  expect(asksForPlan(seen.submitted[0])).toBe(true)
})

// --- The effort a session ran at, and the date, on the decision entry ---

test('a main-loop turn records the effort the request ran at on the decision entry', async ($, on) => {
  const seen = engine(on, { answer: 'Keep claude-sonnet-5-5', usd: [0, 1] })

  await submit($, 'Redesign the auth layer')
  await step($, undefined, 'low')
  await complete($)
  expect((seen.store.decisions as Decision[])[0]?.effort).toBe('medium')
})

test('Keep model, effort low records low', async ($, on) => {
  const seen = engine(on, { rating: 'simple', answer: 'Keep model, effort low', usd: [0, 1] })

  await submit($, 'What does git rebase --onto do?')
  await step($, undefined, 'high')
  await complete($)
  expect((seen.store.decisions as Decision[])[0]?.effort).toBe('low')
})

test('a subagent step does not change the recorded effort', async ($, on) => {
  const seen = engine(on, { answer: 'Keep claude-sonnet-5-5', usd: [0, 1] })

  await submit($, 'Redesign the auth layer')
  await step($, undefined, 'xhigh')
  await step($, 'sub-1', 'low')
  await complete($)
  expect((seen.store.decisions as Decision[])[0]?.effort).toBe('xhigh')
})

test('a request with no named effort level records no effort', async ($, on) => {
  const seen = engine(on, { rating: 'simple', answer: 'Keep claude-sonnet-5-5', usd: [0, 1] })

  await submit($, 'What does git rebase --onto do?')
  await step($, undefined, 2048)
  await complete($)
  const [entry] = seen.store.decisions as Decision[]
  expect(entry && 'effort' in entry).toBe(false)
})

test('/triage-stats prints average cost by rating and effort, counting only entries with both', async ($, on) => {
  const base = { from: 'claude-sonnet-5-5', to: 'claude-sonnet-5-5', chose: 'Keep claude-sonnet-5-5' }
  const decisions: Decision[] = [
    { rating: 'complex', ...base, id: 'a', cost: 1, effort: 'medium' },
    { rating: 'complex', ...base, id: 'b', cost: 3, effort: 'medium' },
    { rating: 'complex', ...base, id: 'c', cost: 5, effort: 'high' },
    // No effort, or no cost: left out of the effort table.
    { rating: 'complex', ...base, id: 'd', cost: 9 },
    { rating: 'complex', ...base, id: 'e', effort: 'low' },
  ]
  engine(on, { turns: 3, store: { decisions } })

  const { text } = await command($, 'triage-stats')
  expect(text).toContain('| Rating | Effort | Sessions | Average cost |')
  expect(text).toContain('| complex | medium | 2 | $2.00 |')
  expect(text).toContain('| complex | high | 1 | $5.00 |')
  expect(text).not.toContain('| complex | low |')
})

test('/triage-stats shows no effort table when no entry has both an effort and a cost', async ($, on) => {
  const base = { from: 'claude-sonnet-5-5', to: 'claude-sonnet-5-5', chose: 'Keep claude-sonnet-5-5' }
  const decisions: Decision[] = [
    { rating: 'complex', ...base, cost: 1 },
    { rating: 'complex', ...base, effort: 'medium' },
  ]
  engine(on, { turns: 3, store: { decisions } })

  const { text } = await command($, 'triage-stats')
  expect(text).not.toContain('| Effort |')
})

test("a new decision entry carries today's UTC date as `at`", async ($, on) => {
  const seen = engine(on, { answer: 'Keep claude-sonnet-5-5' })

  await submit($, 'Redesign the auth layer')
  expect((seen.store.decisions as Decision[])[0]?.at).toBe(new Date().toISOString().slice(0, 10))
})

const DATED = (() => {
  const base = { rating: 'complex', from: 'claude-sonnet-5-5', to: 'opus', chose: 'Switch to opus' }
  return [
    { ...base, id: 'old', at: '2026-11-11', cost: 100 },
    { ...base, id: 'same', at: '2026-11-12', cost: 1 },
    { ...base, id: 'later', at: '2026-11-13', cost: 3 },
    // Logged before dates existed: left out of any since tally.
    { ...base, id: 'undated', cost: 200 },
  ] as Decision[]
})()

test('/triage-stats since a date counts only entries on or after it, and names the date', async ($, on) => {
  engine(on, { turns: 3, store: { decisions: DATED } })

  const { text } = await command($, 'triage-stats', 'since 2026-11-12')
  expect(text).toContain('2 decisions logged')
  expect(text).toContain('since 2026-11-12')
  expect(text).toContain('| complex | switched | 2 | $2.00 |')
})

test('/triage-stats with no argument still counts every entry', async ($, on) => {
  engine(on, { turns: 3, store: { decisions: DATED } })

  const { text } = await command($, 'triage-stats')
  expect(text).toContain('4 decisions logged')
})

for (const args of ['since 9/22/2026', 'since 2026-13-01', 'since 2026-02-30', 'since yesterday', 'since', 'since 2026-11-12 extra', 'whatever']) {
  test(`/triage-stats "${args}" prints a usage line and no table`, async ($, on) => {
    engine(on, { turns: 3, store: { decisions: DATED } })

    const { text } = await command($, 'triage-stats', args)
    expect(text).toContain('Usage: /triage-stats [since YYYY-MM-DD]')
    expect(text).not.toContain('| Rating |')
  })
}

// --- Exploration runs on haiku once the main loop has moved up ---

/** Spawns a subagent as the Agent tool would, with extra input fields the testing call type leaves out. */
async function spawn($: Engine, extra: Record<string, unknown> = {}) {
  return await ($.agent.spawn as (input: Record<string, unknown>) => Promise<unknown>)({
    prompt: 'Map the auth code',
    subagentType: 'Explore',
    ...extra,
  })
}

test('after Switch to opus an Explore spawn with no model of its own runs on haiku', async ($, on) => {
  const seen = engine(on, { answer: 'Switch to opus' })

  await submit($, 'Redesign the auth layer')
  await spawn($)
  expect(seen.spawned[0]?.model).toBe('haiku')
})

test('after Switch to fable an Explore spawn runs on haiku', async ($, on) => {
  const seen = engine(on, { rating: 'long-running', answer: 'Switch to fable' })

  await submit($, 'Migrate the whole codebase from Express to Fastify')
  await spawn($)
  expect(seen.spawned[0]?.model).toBe('haiku')
})

test('an Explore spawn after Keep, or with no decision at all, is left alone', async ($, on) => {
  const seen = engine(on, { answer: 'Keep claude-sonnet-5-5' })

  await spawn($)
  await submit($, 'Redesign the auth layer')
  await spawn($)
  expect(seen.spawned.map(e => e.model)).toEqual([undefined, undefined])
})

test('after Switch to sonnet an Explore spawn is left alone: only a switch up to opus or above routes it', async ($, on) => {
  const seen = engine(on, { rating: 'moderate', model: 'claude-haiku-5-5', answer: 'Switch to sonnet' })

  await submit($, 'Add a retry limit to the upload client')
  await spawn($)
  expect(seen.spawned[0]?.model).toBeUndefined()
})

test('after Switch to opus a spawn of another agent type is left alone', async ($, on) => {
  const seen = engine(on, { answer: 'Switch to opus' })

  await submit($, 'Redesign the auth layer')
  await spawn($, { subagentType: 'general-purpose' })
  expect(seen.spawned[0]?.model).toBeUndefined()
})

test('after Switch to opus a spawn that sets its own model keeps it', async ($, on) => {
  const seen = engine(on, { answer: 'Switch to opus' })

  await submit($, 'Redesign the auth layer')
  await spawn($, { model: 'sonnet' })
  expect(seen.spawned[0]?.model).toBe('sonnet')
})

test('after Switch to opus a resumed Explore run and a teammate are left alone', async ($, on) => {
  const seen = engine(on, { answer: 'Switch to opus' })

  await submit($, 'Redesign the auth layer')
  await spawn($, { resume: { agentId: 'agent-9' } })
  await spawn($, { isTeammate: true })
  // The engine saw the extra fields, so these cases test the hook and not a call that dropped them.
  expect(seen.spawned[0]?.resume?.agentId).toBe('agent-9')
  expect(seen.spawned[1]?.isTeammate).toBe(true)
  expect(seen.spawned.map(e => e.model)).toEqual([undefined, undefined])
})

test('a /model of the persons own ends the Explore routing', async ($, on) => {
  const seen = engine(on, { answer: 'Switch to opus' })

  await submit($, 'Redesign the auth layer')
  await command($, 'model', 'sonnet')
  await spawn($)
  expect(seen.spawned[0]?.model).toBeUndefined()
})

// --- The plan's Final check, end to end, with the prompt it names ---

test("the plan's Final check: refine with a check, switch to opus, Explore on haiku, effort logged and tallied", async ($, on) => {
  const PROMPT = 'Redesign the auth layer so sessions survive a server restart'
  const today = new Date().toISOString().slice(0, 10)
  const seen = engine(on, { answer: ['Refine prompt', 'Switch to opus'], review: REVIEWED, usd: [0, 2] })

  // First send: rated complex on Sonnet, no effort sentence, and Refine prompt asks the reviewer for a check.
  await submit($, PROMPT)
  expect(seen.questions[0]).toContain('Rated complex')
  expect(seen.questions[0]).not.toContain('Effort will be at least')
  expect(seen.reviews[0]?.system).toContain(CHECK_LINE)

  // Sent again: Switch to opus. Main-loop requests run on opus at the medium minimum, and Explore runs on haiku.
  await submit($, PROMPT)
  await step($, undefined, 'low')
  expect([seen.steps[0]?.model, seen.steps[0]?.effort]).toEqual(['opus', 'medium'])
  await spawn($)
  expect(seen.spawned[0]?.model).toBe('haiku')

  // The one session is logged once, with its effort and date, and /triage-stats tallies it from today on.
  await complete($)
  expect(seen.store.decisions).toMatchObject([{ rating: 'complex', chose: 'Switch to opus', effort: 'medium', cost: 2, at: today }])
  const { text } = await command($, 'triage-stats', `since ${today}`)
  expect(text).toContain(`1 decision logged since ${today}`)
  expect(text).toContain('| complex | medium | 1 | $2.00 |')
})

test('a later request with no named effort level clears the effort an earlier turn recorded', async ($, on) => {
  const seen = engine(on, { rating: 'simple', answer: 'Keep claude-sonnet-5-5', usd: [0, 1, 2] })

  await submit($, 'What does git rebase --onto do?')
  await step($, undefined, 'medium')
  await complete($)
  expect((seen.store.decisions as Decision[])[0]?.effort).toBe('medium')
  // A numeric budget (or a model with no effort) is no named level: the entry must not keep the old one beside the new cost.
  await step($, undefined, 2048)
  await complete($)
  const [entry] = seen.store.decisions as Decision[]
  expect(entry && 'effort' in entry).toBe(false)
  expect(entry?.cost).toBe(2)
})
