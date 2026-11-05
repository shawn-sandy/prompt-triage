import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, PromptSubmitInput, RenderSurface, TurnStepInput } from 'claude-code'

type Setup = {
  turns?: number
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
}

const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const REVIEWED =
  '<issues>\n- No done-criteria\n- Which services?\n</issues>\n<prompt>Redesign auth in api, web and admin; done when tests pass.</prompt>'

/** A review reply that makes the review call reject, as a dropped connection would. */
const THROW = '<throw>'

/** A setting's value for this call: a list gives out its items in order, then undefined. */
const take = (v: string | string[] | undefined) => (Array.isArray(v) ? v.shift() : v)

/** Answers, beneath the plugin, every engine call the mod makes. */
function engine(on: On, s: Setup) {
  const asked: string[][] = []
  const submitted: PromptSubmitInput[] = []
  const steps: TurnStepInput[] = []
  const status: (string | undefined)[] = []
  const filled: string[] = []
  const reviewed: string[] = []
  let classified = 0

  on('session.turns', () => ({ value: s.turns ?? 0 }))
  on('session.model', () => ({ value: s.model ?? 'claude-sonnet-5-5' }))
  on('session.surfaces', () => ({ value: s.surfaces ?? ['terminal'] }))
  on('model.classify', () => {
    classified++
    return { value: s.rating ?? 'complex' }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const q = e.questions[0]!
    asked.push(q.options.map(o => o.label))
    const answer = take(s.answer)
    if (answer === undefined) return { deny: 'dismissed' }
    return { result: { questions: e.questions, answers: { [q.question]: answer } } }
  })
  on('ui.status', (_$, e) => {
    status.push(e.text)
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
    reviewed.push(e.prompt)
    const text = take(s.review)
    if (text === THROW) throw new Error('connection dropped')
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

  return { asked, submitted, steps, status, filled, reviewed, classified: () => classified }
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
  expect(seen.classified()).toBe(0)
  expect(seen.asked).toEqual([])
})

test('nothing is asked when the rating matches the current model', async ($, on) => {
  const seen = engine(on, { rating: 'moderate', model: 'claude-sonnet-5-5', answer: 'Keep current model' })

  await submit($, 'Rename this function')
  expect(seen.classified()).toBe(1)
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
