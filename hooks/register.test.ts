import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, PromptSubmitInput, RenderSurface, TurnStepInput } from 'claude-code'

type Setup = {
  turns?: number
  rating?: string
  model?: string
  surfaces?: RenderSurface[]
  /** The label the person picks; undefined dismisses the dialog. */
  answer?: string
}

/** Answers, beneath the plugin, every engine call the mod makes. */
function engine(on: On, s: Setup) {
  const asked: string[][] = []
  const submitted: PromptSubmitInput[] = []
  const steps: TurnStepInput[] = []
  const status: (string | undefined)[] = []
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
    if (s.answer === undefined) return { deny: 'dismissed' }
    return { result: { questions: e.questions, answers: { [q.question]: s.answer } } }
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

  return { asked, submitted, steps, status, classified: () => classified }
}

/** Submits a prompt as the person typing it. */
async function submit($: Engine, text: string) {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

/** Runs one model request of the main loop, or of a subagent's. */
async function step($: Engine, agentId?: string) {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, ...(agentId ? { agentId } : {}) })
  for await (const _ of stream);
}

test('a complex first prompt offers opus, and picking it routes main-loop requests to opus', async ($, on) => {
  const seen = engine(on, { answer: 'Switch to opus' })

  await submit($, 'Redesign the auth layer across three services')
  expect(seen.asked).toEqual([['Switch to opus', 'Keep current model']])
  expect(seen.status).toEqual(['model: opus (prompt-triage)'])

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
