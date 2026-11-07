import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelCompleteInput, On, PromptSubmitInput, RenderElement, RenderSurface, TurnStepInput } from 'claude-code'

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
}

const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const REVIEWED =
  '<issues>\n- No done-criteria\n- Which services?\n</issues>\n<prompt>Redesign auth in api, web and admin; done when tests pass.</prompt>'

/** A review reply that makes the review call reject, as a dropped connection would. */
const THROW = '<throw>'
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
  let classified = 0

  on('session.turns', () => ({ value: s.turns ?? 0 }))
  on('session.model', () => ({ value: s.model ?? 'claude-sonnet-5-5' }))
  on('session.surfaces', () => ({ value: s.surfaces ?? ['terminal'] }))
  on('prompt.read', () => ({ value: { text: s.draft ?? '', cursor: (s.draft ?? '').length } }))
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
    return { value: undefined }
  })
  // The mod rates with model.complete; a call here is counted so a test can show it never happens.
  on('model.classify', () => {
    classified++
    return { value: s.rating ?? 'complex' }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
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
  // The engine's own band beneath the plugin: empty, as when no survey or other mod draws there.
  on('ui.render', { component: 'AbovePrompt' }, $ => {
    const { Box } = $.ui.resolve({ surface: 'terminal', component: 'AbovePrompt' })
    return h(Box, null) as RenderElement
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_$, e) => {
    submitted.push(e)
    return { text: e.text, context: e.context }
  })
  on('turn.step', async function* (_$, e) {
    steps.push(e)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('command.run', () => ({ text: '' }))
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
      value:
        text === undefined
          ? { isAnswered: false, reason: 'empty-reply', usage: USAGE }
          : { isAnswered: true, text, usage: USAGE },
    }
  })
  // The engine resolves each path against the working directory, so a listed path matches by its end.
  on('fs.exists', (_$, e) => ({ value: Array.isArray(s.exists) ? s.exists.some(p => e.path.endsWith(`/${p}`)) : (s.exists ?? true) }))
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    return { isFilled: s.isFilled ?? true }
  })

  return { store, asked, questions, submitted, steps, status, toasts, filled, reviewed, reviews, completesAtAsk, ratings, classified: () => classified }
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

test('a complex first prompt offers opus, and picking it routes main-loop requests to opus', async ($, on) => {
  const seen = engine(on, { answer: 'Switch to opus' })

  await submit($, 'Redesign the auth layer across three services')
  expect(seen.asked).toEqual([['Switch to opus', 'Keep current model', 'Refine prompt']])
  expect(seen.status).toEqual(['running opus, not claude-sonnet-5-5'])

  await step($)
  await step($, 'sub-1')
  expect(seen.steps.map(s => s.model)).toEqual(['opus', 'claude-sonnet-5-5'])
})

test('keeping the current model leaves requests alone', async ($, on) => {
  const seen = engine(on, { answer: 'Keep current model' })

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
  expect(seen.steps[0]?.effort).toBe('high')
})

test('a later prompt in the session is not checked', async ($, on) => {
  const seen = engine(on, { turns: 1, answer: 'Switch to opus' })

  await submit($, 'Redesign the auth layer')
  expect(seen.ratings).toEqual([])
  expect(seen.asked).toEqual([])
})

test('nothing is asked when the rating matches the current model', async ($, on) => {
  const seen = engine(on, { rating: 'moderate', model: 'claude-sonnet-5-5', answer: 'Keep current model' })

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
  const seen = engine(on, { surfaces: ['terminal'], answer: 'Keep current model' })

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
  expect(seen.asked[1]).toEqual(['Switch to opus', 'Keep current model'])
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

test('a complex prompt raises main-loop effort below high, and leaves the rest alone', async ($, on) => {
  const seen = engine(on, { answer: 'Keep current model' })

  await submit($, 'Redesign the auth layer')
  await step($, undefined, 'low')
  await step($, undefined, 'xhigh')
  await step($, 'sub-1', 'low')
  await step($)
  await step($, undefined, 2048)
  expect(seen.steps.map(s => s.effort)).toEqual(['high', 'xhigh', 'low', undefined, 2048])
  expect(seen.status.at(-1)).toBe('effort raised to high')
})

test('a moderate prompt raises effort to medium even when nothing is asked', async ($, on) => {
  const seen = engine(on, { rating: 'moderate', model: 'claude-sonnet-5-5' })

  await submit($, 'Rename this function')
  expect(seen.asked).toEqual([])
  await step($, undefined, 'low')
  expect(seen.steps[0]?.effort).toBe('medium')
})

test('a simple prompt leaves effort alone', async ($, on) => {
  const seen = engine(on, { rating: 'simple', answer: 'Keep current model' })

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
  expect(seen.steps.map(s => [s.model, s.effort])).toEqual([['opus', 'high'], ['opus', 'low']])
  expect(seen.status.at(-1)).toBe('running opus, not claude-sonnet-5-5')
})

test('a prompt rated again replaces the effort minimum and its status', async ($, on) => {
  const s: Setup = { answer: 'Keep current model' }
  const seen = engine(on, s)

  await submit($, 'Redesign the auth layer')
  await step($, undefined, 'low')
  s.rating = 'moderate'
  await submit($, 'Rename this function')
  await step($, undefined, 'low')
  expect(seen.steps.map(x => x.effort)).toEqual(['high', 'medium'])
  expect(seen.status.at(-1)).toBe('effort raised to medium')
})

test("/model after a raise keeps the effort part of the status line", async ($, on) => {
  const seen = engine(on, { answer: 'Switch to opus' })

  await submit($, 'Redesign the auth layer')
  await step($, undefined, 'low')
  expect(seen.status.at(-1)).toBe('running opus, not claude-sonnet-5-5, effort raised to high')
  await command($, 'model', 'sonnet')
  expect(seen.status.at(-1)).toBe('effort raised to high')
})

test('a complex prompt makes exactly one model.complete call before the dialog, rating and restating together', async ($, on) => {
  const seen = engine(on, { answer: 'Keep current model', restate: 'Redesign auth across three services.' })

  await submit($, 'Redesign the auth layer across three services')
  expect(seen.completesAtAsk).toEqual([1])
  expect(seen.ratings.length).toBe(1)
  expect(seen.reviews.length).toBe(0)
  expect(seen.questions[0]).toMatch(/^Read as: Redesign auth across three services\. This prompt looks complex/)
})

test('only the restatement\'s first line is shown, and a long one is cut', async ($, on) => {
  const seen = engine(on, { answer: 'Keep current model', restate: `${'word '.repeat(40)}\nA second line.` })

  await submit($, 'Redesign the auth layer')
  expect(seen.questions[0]).not.toContain('A second line')
  expect(seen.questions[0]).toContain('…')
  expect(seen.questions[0]!.indexOf('This prompt looks')).toBeLessThan(140)
})

test('a restatement that uses a rating word does not change the rating', async ($, on) => {
  const seen = engine(on, { rating: 'moderate', model: 'claude-opus-5-5', answer: 'Keep current model', restate: 'Untangle the complex retry logic.' })

  await submit($, 'Untangle the retry logic')
  expect(seen.questions[0]).toContain('This prompt looks moderate')
})

test('a rating reply with no restatement still shows the dialog without one', async ($, on) => {
  const seen = engine(on, { answer: 'Keep current model' })
  await submit($, 'Redesign the auth layer')
  expect(seen.completesAtAsk).toEqual([1])
  expect(seen.asked).toEqual([['Switch to opus', 'Keep current model', 'Refine prompt']])
  expect(seen.questions[0]).toMatch(/^This prompt looks complex/)
  expect(seen.submitted[0]?.text).toBe('Redesign the auth layer')
})

test('a simple prompt shows no restatement even if the reply carries one', async ($, on) => {
  const simple = engine(on, { rating: 'simple', answer: 'Keep current model', restate: 'Fix a typo.' })
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
  const seen = engine(on, { answer: 'Keep current model' })

  await submit($, 'Redesign the auth layer')
  const system = seen.ratings[0]!.system!
  expect(system).toContain('first line')
  expect(system).toContain('For simple, stop there')
  expect(system).toContain('second line')
})

test('the first prompt is rated by one low-effort haiku call against a four-label rubric', async ($, on) => {
  const seen = engine(on, { answer: 'Keep current model' })

  await submit($, 'Redesign the auth layer')
  expect(seen.classified()).toBe(0)
  expect(seen.ratings.length).toBe(1)
  const r = seen.ratings[0]!
  expect([r.model, r.effort, r.maxTokens, r.timeoutMs]).toEqual(['haiku', 'low', 256, 10_000])
  for (const label of ['simple', 'moderate', 'complex', 'long-running']) expect(r.system).toContain(label)
  expect(r.prompt).toContain('Redesign the auth layer')
})

test('a rating reply that names a label among other words is taken', async ($, on) => {
  const seen = engine(on, { rating: 'Rating: moderate.', model: 'claude-opus-5-5', answer: 'Keep current model' })

  await submit($, 'Add a flag to the CLI')
  expect(seen.asked[0]).toContain('Switch to sonnet')
})

for (const [how, rating] of [['names no label', 'unsure'], ['names two labels', 'simple or complex'], ['times out', TIMEOUT], ['fails', undefined], ['throws', THROW]] as const) {
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
    const seen = engine(on, { model, surfaces: ['desktop'], answer: 'Keep current model' })

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
  expect(seen.asked).toEqual([['Switch to fable', 'Keep current model', 'Open in a new session', 'Refine prompt']])
  expect(seen.questions[0]).toContain('looks long-running')
  await step($, undefined, 'medium')
  expect(seen.steps[0]?.model).toBe('fable')
})

test('a long-running prompt on sonnet offers opus as a step down from fable', async ($, on) => {
  const seen = engine(on, { rating: 'long-running', model: 'claude-sonnet-5-5', answer: 'Switch to opus' })

  await submit($, 'Migrate the whole codebase from Express to Fastify')
  expect(seen.asked).toEqual([['Switch to fable', 'Switch to opus', 'Keep current model', 'Refine prompt']])
  await step($, undefined, 'medium')
  expect(seen.steps[0]?.model).toBe('opus')
})

test('a complex prompt on sonnet offers no step down, since opus is already the suggestion', async ($, on) => {
  const seen = engine(on, { rating: 'complex', model: 'claude-sonnet-5-5', answer: 'Keep current model' })

  await submit($, 'Redesign the auth layer')
  expect(seen.asked).toEqual([['Switch to opus', 'Keep current model', 'Refine prompt']])
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

test('a long-running prompt raises main-loop effort to high', async ($, on) => {
  const seen = engine(on, { rating: 'long-running', model: 'claude-opus-5-5', answer: 'Keep current model' })

  await submit($, 'Migrate the whole codebase from Express to Fastify')
  await step($, undefined, 'medium')
  expect(seen.steps[0]?.effort).toBe('high')
  expect(seen.status.at(-1)).toBe('effort raised to high')
})

test('a simple prompt offers to keep the model at low effort first', async ($, on) => {
  const seen = engine(on, { rating: 'simple', answer: 'Keep current model' })

  await submit($, 'What does git rebase --onto do?')
  expect(seen.asked).toEqual([['Keep model, effort low', 'Switch to haiku', 'Keep current model', 'Refine prompt']])
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
const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} }

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

for (const [how, review] of [['fails', undefined], ['throws', THROW]] as const) {
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
  expect(seen.asked[0]).toEqual(['Switch to opus', 'Keep current model'])
})

test('the result row outlasts a short draft until the prompt is sent', async ($, on) => {
  const s: Setup = { draft: LONG, review: REVIEWED, turns: 1 }
  engine(on, s)
  const ui = await band($)
  await refine(ui)

  s.draft = 'Fix it'
  expect((await (await band($)).find({ key: 'result' }))).toBeDefined()
  await submit($, s.draft)
  expect((await (await band($)).find({ key: 'result' }))).toBeUndefined()
})

test('Refine pressed twice while a review runs reviews once', async ($, on) => {
  const seen = engine(on, { draft: LONG, review: [REVIEWED, REVIEWED] })
  const ui = await band($)
  await Promise.all([ui.press({ key: 'refine' }), ui.press({ key: 'refine' })])
  await settle()
  expect(seen.reviews.length).toBe(1)
})

test('the model dialog and /refine-prompt refine with the stored picks', async ($, on) => {
  const seen = engine(on, { answer: 'Refine prompt', review: Array(3).fill(REVIEWED), draft: LONG, store: { picks: { scope: 'minimal' } } })

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

// --- The decision log and /triage-stats ---

/** One logged decision, as the store holds it. */
type Decision = { rating: string; from: string; to: string; chose: string }

test('a rated first prompt appends one decision naming the rating, the models before and after and the choice', async ($, on) => {
  const seen = engine(on, { answer: 'Switch to opus' })

  await submit($, 'Redesign the auth layer across three services')
  expect(seen.store.decisions).toEqual([{ rating: 'complex', from: 'claude-sonnet-5-5', to: 'opus', chose: 'Switch to opus' }])
})

test('a prompt that shows no dialog is logged as asked nothing, and a dismissed dialog as dismissed', async ($, on) => {
  const s: Setup = { rating: 'moderate', model: 'claude-sonnet-5-5' }
  const seen = engine(on, s)

  await submit($, 'Rename this function')
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
  expect(entry).toEqual({ rating: 'complex', from: 'claude-sonnet-5-5', to: 'sonnet', chose: 'other: sonnet' })
  expect(JSON.stringify(seen.store)).not.toContain('Stripe')
})

test('free text naming no model is logged as other', async ($, on) => {
  const seen = engine(on, { answer: 'whatever you think' })

  await submit($, 'Redesign the auth layer')
  expect((seen.store.decisions as Decision[])[0]?.chose).toBe('other')
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
  expect(seen.store.decisions).toEqual([{ rating: 'complex', from: 'claude-sonnet-5-5', to: 'claude-sonnet-5-5', chose: 'Refine prompt' }])
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

test('a simple prompt two tiers above haiku lists the switch before the low-effort option', async ($, on) => {
  const seen = engine(on, { rating: 'simple', model: 'claude-opus-5-5', answer: 'Keep current model' })

  await submit($, 'What does git rebase --onto do?')
  expect(seen.asked).toEqual([['Switch to haiku', 'Keep model, effort low', 'Keep current model', 'Refine prompt']])
})

test('a simple prompt one tier above haiku keeps the low-effort option first', async ($, on) => {
  const seen = engine(on, { rating: 'simple', model: 'claude-sonnet-5-5', answer: 'Keep current model' })

  await submit($, 'What does git rebase --onto do?')
  expect(seen.asked).toEqual([['Keep model, effort low', 'Switch to haiku', 'Keep current model', 'Refine prompt']])
})
